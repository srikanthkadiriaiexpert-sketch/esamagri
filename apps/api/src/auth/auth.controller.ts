import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { ApiEnv } from '@esamagri/config';
import { ERROR_CODES } from '@esamagri/shared-types';
import { RequestOtpDto } from './dto/request-otp.dto';
import {
  RegisterCustomerDto,
  RequestRegistrationOtpDto,
  hasConflictingCredentials,
  registrationCredentialOf,
} from './dto/register-customer.dto';
import { PIF_SELF_REGISTRATION_DISABLED_MESSAGE } from './pif-registration.gate';
import { PifRegistrationGate } from './pif-registration.gate.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import {
  CustomerAuthService,
  OtpExpiredError,
  OtpInvalidError,
  OtpLockedError,
  OtpRateLimitedError,
} from './services/customer-auth.service';
import {
  AccountInactiveError,
  AccountLockedError,
  InvalidCredentialsError,
  StaffAuthService,
  TotpInvalidError,
  TotpRequiredError,
} from './services/staff-auth.service';
import { RefreshTokenInvalidError, TokenService, type IssuedSession, type AccessTokenPrincipal } from './services/token.service';
import { RegistrationTicketInvalidError } from './services/registration-ticket.service';
import { Public } from './decorators/public.decorator';
import { CurrentPrincipal } from './decorators/current-principal.decorator';
import { JwtAuthGuard, type AuthenticatedRequest } from './guards/jwt-auth.guard';

/**
 * The customer OTP, staff login, refresh and logout endpoints, plus a
 * guarded GET /auth/me proving the JwtAuthGuard + @CurrentPrincipal()
 * identity/context mechanism end-to-end (this is what STEP 7's RBAC
 * guards will build on).
 *
 * Guarded by default (JwtAuthGuard at the controller level); every
 * route that must be reachable without a session already carries
 * @Public() explicitly, rather than the guard keeping its own
 * allowlist — see jwt-auth.guard.ts.
 *
 * A local ValidationPipe is applied here (whitelist + forbid unknown
 * fields + reject on unknown enum-ish values) ahead of STEP 8's global
 * one, so DTO validation is real in STEP 6 rather than deferred.
 */
@Controller('auth')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AuthController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>,
    private readonly customerAuth: CustomerAuthService,
    private readonly staffAuth: StaffAuthService,
    private readonly tokens: TokenService,
    private readonly selfRegistration: PifRegistrationGate
  ) {}

  @Public()
  @Post('customer/otp/request')
  @HttpCode(HttpStatus.OK)
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request): Promise<{ message: string }> {
    try {
      await this.customerAuth.requestOtp(dto.mobileNumber, requestIp(req), requestDeviceInfo(req));
    } catch (err) {
      if (err instanceof OtpRateLimitedError) {
        throw new HttpException({ code: ERROR_CODES.OTP_RATE_LIMITED, message: err.message }, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }
    // Deliberately identical whether or not the number is registered —
    // see CustomerAuthService's class doc.
    return { message: 'If this number is registered, a verification code has been sent.' };
  }

  @Public()
  @Post('customer/otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ accessToken: string; principal: AccessTokenPrincipal }> {
    try {
      const outcome = await this.customerAuth.verifyOtp({
        mobileNumber: dto.mobileNumber,
        code: dto.code,
        ipAddress: requestIp(req),
        deviceInfo: requestDeviceInfo(req),
      });

      /**
       * ONE LOGIN, THREE HONEST ANSWERS.
       *
       * The switch is exhaustive and the union has no default branch, so a
       * fourth outcome added later fails to compile here rather than falling
       * through to a wrong response.
       */
      switch (outcome.kind) {
        case 'SESSION':
          return this.respondWithSession(res, outcome.session);

        case 'NOT_REGISTERED':
          /**
           * The code was CORRECT and this number has no account. 404 rather
           * than 400: nothing the caller sent was invalid, the account simply
           * does not exist. The app reads `code` and goes straight to the
           * registration form with the ticket — no second OTP.
           *
           * The ticket is returned in the body and NOT set as a cookie: it is
           * a one-step credential for a form the resident is about to submit,
           * not session state, and a cookie would attach it to every
           * subsequent request for no reason.
           */
          throw new HttpException(
            {
              code: ERROR_CODES.ACCOUNT_NOT_REGISTERED,
              message: 'This number is not registered yet. Please complete your registration.',
              details: {
                registrationTicket: outcome.registrationTicket,
                mobileNumber: outcome.mobileNumber,
              },
            },
            HttpStatus.NOT_FOUND
          );

        case 'REGISTRATION_CLOSED':
          // Correct code, no account, and no self-registration to offer. The
          // gate's own wording, so the Customer App shows one sentence
          // whichever route refused it.
          throw new HttpException(
            {
              code: ERROR_CODES.REGISTRATION_UNAVAILABLE,
              message: PIF_SELF_REGISTRATION_DISABLED_MESSAGE,
            },
            HttpStatus.SERVICE_UNAVAILABLE
          );
      }
    } catch (err) {
      if (err instanceof OtpExpiredError) {
        throw new HttpException({ code: ERROR_CODES.OTP_EXPIRED, message: err.message }, HttpStatus.BAD_REQUEST);
      }
      if (err instanceof OtpLockedError) {
        throw new HttpException({ code: ERROR_CODES.OTP_LOCKED, message: err.message }, HttpStatus.BAD_REQUEST);
      }
      if (err instanceof OtpInvalidError) {
        throw new HttpException({ code: ERROR_CODES.OTP_INVALID, message: err.message }, HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // PIF CUSTOMER SELF-REGISTRATION (Task 2 Stage 2)
  //
  // BOTH ROUTES ARE GATED BY A RUNTIME SETTING. The gate reads
  // `pif.self_registration_enabled` from shared.settings on every request and
  // refuses with 503 unless an administrator holding
  // `shared.settings.write` has turned it on. There is no seed row, so the
  // shipped state is OFF; a missing row, an uninterpretable value and a failed
  // query are all OFF too. See pif-registration.gate.ts for the three
  // fail-closed controls that replaced the old compile-time constant.
  //
  // The gate is checked FIRST in each handler, before the DTO's work matters,
  // so nothing downstream — not the OTP table, not the SMS provider, not
  // shared.customers — can be touched while it is off.
  // ------------------------------------------------------------------

  @Public()
  @Post('customer/register/otp/request')
  @HttpCode(HttpStatus.OK)
  async requestRegistrationOtp(
    @Body() dto: RequestRegistrationOtpDto,
    @Req() req: Request
  ): Promise<{ message: string }> {
    await this.assertSelfRegistrationEnabled();
    try {
      await this.customerAuth.requestRegistrationOtp(
        dto.mobileNumber,
        requestIp(req),
        requestDeviceInfo(req)
      );
    } catch (err) {
      if (err instanceof OtpRateLimitedError) {
        throw new HttpException(
          { code: ERROR_CODES.OTP_RATE_LIMITED, message: err.message },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
      throw err;
    }
    // Deliberately identical whether or not the number is already registered,
    // for the same reason the login request is — see CustomerAuthService.
    return { message: 'A verification code has been sent to that number.' };
  }

  @Public()
  @Post('customer/register')
  @HttpCode(HttpStatus.OK)
  async registerCustomer(
    @Body() dto: RegisterCustomerDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ accessToken: string; principal: AccessTokenPrincipal }> {
    await this.assertSelfRegistrationEnabled();

    /**
     * WHICH CREDENTIAL, SETTLED BEFORE ANYTHING ELSE HAPPENS.
     *
     * Both refusals are plain validation failures and neither touches the OTP
     * table, the ticket verifier or `shared.customers`.
     */
    if (hasConflictingCredentials(dto)) {
      throw new HttpException(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message:
            'Send either a registration ticket or a mobile number and code, not both.',
          details: { field: 'registrationTicket' },
        },
        HttpStatus.BAD_REQUEST
      );
    }
    const credential = registrationCredentialOf(dto);
    if (credential === null) {
      throw new HttpException(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'A registration ticket, or a mobile number and code, is required.',
          details: { field: 'registrationTicket' },
        },
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      const session = await this.customerAuth.registerCustomer({
        credential,
        name: dto.name,
        quarterBlock: dto.quarterBlock,
        quarterNumber: dto.quarterNumber,
        ipAddress: requestIp(req),
        deviceInfo: requestDeviceInfo(req),
      });
      return this.respondWithSession(res, session);
    } catch (err) {
      if (err instanceof RegistrationTicketInvalidError) {
        /**
         * The ticket is gone or was never ours. 401 rather than 400: the
         * body is well-formed and the problem is the credential, and the
         * app's remedy is to start the login again rather than to correct a
         * field. Nothing here says whether the number has an account.
         */
        throw new HttpException(
          { code: ERROR_CODES.REGISTRATION_TICKET_INVALID, message: err.message },
          HttpStatus.UNAUTHORIZED
        );
      }
      if (err instanceof OtpExpiredError) {
        throw new HttpException(
          { code: ERROR_CODES.OTP_EXPIRED, message: err.message },
          HttpStatus.BAD_REQUEST
        );
      }
      if (err instanceof OtpLockedError) {
        throw new HttpException(
          { code: ERROR_CODES.OTP_LOCKED, message: err.message },
          HttpStatus.BAD_REQUEST
        );
      }
      if (err instanceof OtpInvalidError) {
        throw new HttpException(
          { code: ERROR_CODES.OTP_INVALID, message: err.message },
          HttpStatus.BAD_REQUEST
        );
      }
      if (err instanceof Error && err.message === 'MOBILE_NUMBER_UNAVAILABLE') {
        throw new HttpException(
          {
            code: ERROR_CODES.VALIDATION_FAILED,
            message:
              'That mobile number cannot be registered. Please ask the facility for help.',
          },
          HttpStatus.CONFLICT
        );
      }
      throw err;
    }
  }

  /**
   * Refuses unless an administrator has switched self-registration on.
   *
   * WHAT CHANGED, AND WHAT DID NOT. The answer now comes from
   * `shared.settings` at request time instead of from a compile-time
   * constant, so the Admin Portal control takes effect immediately and
   * across every API instance. The REFUSAL IS IDENTICAL: same 503, same
   * message, same position — first in each handler, before the DTO's
   * contents matter — so nothing downstream is touched while the switch
   * is off, and the Customer App's existing copy still matches.
   *
   * The gate fails closed on a missing row, an uninterpretable value and a
   * failed query alike, so there is no error path here to handle: a
   * problem reading the setting arrives as `false`, which is exactly the
   * answer this method already knows what to do with.
   */
  private async assertSelfRegistrationEnabled(): Promise<void> {
    if (!(await this.selfRegistration.isEnabled())) {
      throw new HttpException(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: PIF_SELF_REGISTRATION_DISABLED_MESSAGE,
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async staffLogin(
    @Body() dto: StaffLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ accessToken: string; principal: AccessTokenPrincipal }> {
    try {
      const session = await this.staffAuth.login({
        username: dto.username,
        password: dto.password,
        totpCode: dto.totpCode,
        ipAddress: requestIp(req),
        deviceInfo: requestDeviceInfo(req),
      });
      return this.respondWithSession(res, session);
    } catch (err) {
      if (err instanceof AccountLockedError) {
        throw new HttpException({ code: ERROR_CODES.ACCOUNT_LOCKED, message: err.message }, HttpStatus.FORBIDDEN);
      }
      if (err instanceof AccountInactiveError) {
        throw new HttpException({ code: ERROR_CODES.ACCOUNT_INACTIVE, message: err.message }, HttpStatus.FORBIDDEN);
      }
      if (err instanceof TotpRequiredError) {
        throw new HttpException({ code: ERROR_CODES.TOTP_REQUIRED, message: err.message }, HttpStatus.UNAUTHORIZED);
      }
      if (err instanceof TotpInvalidError) {
        throw new HttpException({ code: ERROR_CODES.TOTP_INVALID, message: err.message }, HttpStatus.UNAUTHORIZED);
      }
      if (err instanceof InvalidCredentialsError) {
        throw new HttpException(
          { code: ERROR_CODES.INVALID_CREDENTIALS, message: err.message },
          HttpStatus.UNAUTHORIZED
        );
      }
      throw err;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<{ accessToken: string; principal: AccessTokenPrincipal }> {
    const presented = this.readRefreshCookie(req);
    if (!presented) {
      throw new HttpException(
        { code: ERROR_CODES.REFRESH_TOKEN_INVALID, message: 'No refresh session present.' },
        HttpStatus.UNAUTHORIZED
      );
    }
    try {
      const session = await this.tokens.rotateSession({
        presentedRefreshToken: presented.token,
        ipAddress: requestIp(req),
        deviceInfo: requestDeviceInfo(req),
      });
      return this.respondWithSession(res, session);
    } catch (err) {
      if (err instanceof RefreshTokenInvalidError) {
        this.clearRefreshCookie(res, presented.name);
        throw new HttpException({ code: ERROR_CODES.REFRESH_TOKEN_INVALID, message: err.message }, HttpStatus.UNAUTHORIZED);
      }
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const presented = this.readRefreshCookie(req);
    if (presented) {
      await this.tokens.revokeSessionFamily(presented.token);
      this.clearRefreshCookie(res, presented.name);
    }
  }

  @Get('me')
  me(@CurrentPrincipal() principal: AccessTokenPrincipal): AccessTokenPrincipal {
    return principal;
  }

  private respondWithSession(
    res: Response,
    session: IssuedSession
  ): { accessToken: string; principal: AccessTokenPrincipal } {
    res.cookie(this.tokens.refreshCookieName(session.session.principal_type), session.refreshToken, {
      ...this.refreshCookieOptions(),
      expires: session.refreshTokenExpiresAt,
    });
    return {
      accessToken: session.accessToken,
      principal: { principalType: session.session.principal_type, principalId: session.session.principal_id },
    };
  }

  /**
   * Which refresh cookie this request means (LAUNCH PREPARATION).
   *
   * A browser may now legitimately hold TWO refresh cookies for this API —
   * one staff, one customer — because a yard clerk may also be a resident
   * who shops. So "the refresh cookie" is a question, and it is answered in
   * this order:
   *
   *   1. The app says which it is, with `X-Esamagri-Session: staff` or
   *      `customer`. Both of this project's web apps send it on every
   *      request, so this is the normal path. The header is a HINT ONLY: it
   *      selects which cookie to read and can grant nothing, because the
   *      token it selects is still verified against shared.auth_sessions.
   *   2. If only one of the two cookies is present, that is the one meant.
   *   3. Otherwise the legacy un-suffixed cookie, so a session issued
   *      before this change still refreshes once rather than logging
   *      someone out at deploy time.
   *
   * If two cookies are present and the caller gives no hint, nothing is
   * guessed: answering with the wrong principal's session would hand a
   * shopper a staff token, which is the one outcome worth refusing.
   */
  private readRefreshCookie(req: Request): { token: string; name: string } | null {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const staffName = this.tokens.refreshCookieName('STAFF');
    const customerName = this.tokens.refreshCookieName('CUSTOMER');
    const legacyName = this.tokens.refreshCookieName();

    const hintHeader = req.headers['x-esamagri-session'];
    const hint = (Array.isArray(hintHeader) ? hintHeader[0] : hintHeader)?.toLowerCase();
    if (hint === 'staff' && cookies[staffName]) {
      return { token: cookies[staffName], name: staffName };
    }
    if (hint === 'customer' && cookies[customerName]) {
      return { token: cookies[customerName], name: customerName };
    }

    const present = [staffName, customerName].filter((name) => Boolean(cookies[name]));
    if (present.length === 1) {
      const name = present[0]!;
      return { token: cookies[name]!, name };
    }
    if (present.length === 0 && cookies[legacyName]) {
      return { token: cookies[legacyName], name: legacyName };
    }
    return null;
  }

  /**
   * Clears ONLY the cookie this request used.
   *
   * Signing out of the shop must not sign the same person out of the admin
   * portal, which is exactly what clearing every refresh cookie would do.
   */
  private clearRefreshCookie(res: Response, name: string): void {
    // Clearing must present the SAME attributes the cookie was set with
    // — a browser matches name, domain and path before it will remove
    // one. Sharing refreshCookieOptions() with respondWithSession is
    // what keeps the two in step; when they drifted, a sign-out could
    // leave the cookie in place.
    res.clearCookie(name, this.refreshCookieOptions());
  }

  /**
   * The attributes every refresh cookie carries, set and cleared alike.
   *
   * `domain` is present only when REFRESH_COOKIE_DOMAIN is configured.
   * Left empty — the staging default — the attribute is omitted and the
   * cookie becomes HOST-ONLY: the browser binds it to exactly the host
   * that was asked, so http://localhost:5173 and http://<lan-ip>:5173
   * each get a working session from one unchanged configuration. A
   * `Domain=localhost` cookie is refused outright by any other host,
   * and an IP address is not a legal Domain value, so omitting it is
   * not a shortcut — it is the only correct form here.
   *
   * `sameSite: 'strict'` is kept. A port is not part of a "site", so
   * the app on :5173 and the API on :3000 are the same site and the
   * cookie travels. Moving the API to a different registrable domain
   * would be what breaks that, not this change.
   */
  private refreshCookieOptions(): CookieOptions {
    const domain = this.tokens.refreshCookieDomain();
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/auth',
      ...(domain === '' ? {} : { domain }),
    };
  }
}

/**
 * `req.ip` depends on Express's `trust proxy` setting for correctness
 * behind a load balancer — that's deployment-config scope (STEP 8/
 * infra), not invented here. Falls back to the raw socket address.
 */
function requestIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

function requestDeviceInfo(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 500) : null;
}

// Re-exported only so AuthModule/tests can reference the request shape
// without importing the guard file directly for typing purposes.
export type { AuthenticatedRequest };
