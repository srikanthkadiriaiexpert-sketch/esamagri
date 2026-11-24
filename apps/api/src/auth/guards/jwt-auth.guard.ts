import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { TokenService, type AccessTokenPrincipal } from '../services/token.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface AuthenticatedRequest extends Request {
  principal: AccessTokenPrincipal;
}

/**
 * The backend is the authority; the frontend is never trusted as the
 * security boundary. This guard is the enforcement point: it reads
 * `Authorization: Bearer <token>`, verifies it via TokenService (a
 * short-lived JWT — see token.service.ts for why refresh tokens are a
 * separate, opaque, DB-backed mechanism instead), and attaches the
 * verified `{principalType, principalId}` to the request for
 * `@CurrentPrincipal()` to read. Any missing/malformed/expired/
 * invalid-signature token is rejected the same way — a generic 401
 * with ERROR_CODES.UNAUTHENTICATED, never a reason that would help an
 * attacker distinguish "expired" from "forged" from "wrong audience".
 *
 * `@Public()` (checked on the handler, then the class) opts a route
 * out entirely — used for the routes that establish a session in the
 * first place (OTP request/verify, staff login, refresh).
 *
 * This guard is applied directly on AuthController in STEP 6 (proven
 * end-to-end via GET /auth/me). Making it the Nest APP_GUARD default
 * for every controller is STEP 7/8 scope, once RikModule/PifModule
 * routes exist to protect.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

    if (!token) {
      throw new UnauthorizedException({ code: ERROR_CODES.UNAUTHENTICATED, message: 'Authentication required.' });
    }

    const principal = this.tokens.verifyAccessToken(token);
    if (!principal) {
      throw new UnauthorizedException({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Invalid or expired session. Please sign in again.',
      });
    }

    request.principal = principal;
    return true;
  }
}
