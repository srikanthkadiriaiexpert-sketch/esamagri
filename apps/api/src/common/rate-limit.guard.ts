import {
  CanActivate,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import type { ApiEnv } from '@esamagri/config';
import type { CorrelatedRequest } from './correlation-id.middleware';

export const RATE_LIMIT_CLASS_KEY = 'rateLimitClass';

export type RateLimitClass = 'auth' | 'write' | 'read' | 'none';

/**
 * Overrides the class a route is counted under, or exempts it entirely.
 *
 * `'none'` exists for exactly one kind of route: an unauthenticated,
 * cacheable, read-only one that a page legitimately requests many times in a
 * burst — the product-image route being the case in hand, where one catalogue
 * screen asks for twenty-five pictures at once.
 */
export const RateLimit = (limitClass: RateLimitClass): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_CLASS_KEY, limitClass);

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * The routes where someone could be GUESSING, and therefore the only ones
 * held to the strict allowance.
 *
 * WHY THIS IS A LIST AND NOT "everything under /auth". It was, and that was
 * wrong in a way only a rehearsal showed: `/auth/refresh` lives under
 * /auth, every page load calls it once, and the allowance is counted per
 * CLIENT ADDRESS for an unauthenticated route — so a facility behind one
 * NAT would have shared a twenty-a-minute budget for ordinary page loads
 * and begun signing people out mid-shift. A refresh is not a guess: it
 * presents a cryptographic token that is verified against
 * shared.auth_sessions and rotated, and a stolen or stale one is already
 * refused by reuse detection. Sign-in and OTP are guesses, so they keep the
 * strict number; everything else under /auth is counted as an ordinary
 * write or read.
 *
 * The OTP request route additionally keeps its own per-mobile-number limit
 * in the database (five an hour), which no amount of IP rotation evades.
 */
const CREDENTIAL_PATHS: ReadonlySet<string> = new Set([
  '/auth/staff/login',
  '/auth/customer/otp/request',
  '/auth/customer/otp/verify',
]);

/**
 * The numbers this guard enforces, as an injected value rather than a
 * ConfigService read inside the guard.
 *
 * WHY A SEPARATE PROVIDER. `ConfigModule.forRoot`'s validation runs the
 * moment `app.module.ts` is imported, so by the time any test body executes,
 * the environment has already been read and frozen — a suite cannot set
 * `RATE_LIMIT_AUTH_PER_WINDOW=3` and boot an app that honours it. With the
 * settings behind a token, a test overrides this one provider and proves the
 * guard's real behaviour over real HTTP, while production still gets its
 * numbers from the validated environment and nothing else.
 */
export const RATE_LIMIT_SETTINGS = 'RATE_LIMIT_SETTINGS';

export interface RateLimitSettings {
  enabled: boolean;
  windowMs: number;
  limits: Readonly<Record<Exclude<RateLimitClass, 'none'>, number>>;
}

/** The only place the environment becomes rate-limit numbers. */
export const rateLimitSettingsFromConfig = (
  config: ConfigService<ApiEnv, true>
): RateLimitSettings => ({
  enabled: config.get('RATE_LIMIT_ENABLED', { infer: true }),
  windowMs: config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true }) * 1000,
  limits: {
    auth: config.get('RATE_LIMIT_AUTH_PER_WINDOW', { infer: true }),
    write: config.get('RATE_LIMIT_WRITE_PER_WINDOW', { infer: true }),
    read: config.get('RATE_LIMIT_READ_PER_WINDOW', { infer: true }),
  },
});

/**
 * Request rate limiting (LAUNCH HARDENING).
 *
 * WHAT WAS THERE BEFORE. Exactly one limit, in the database: an OTP could be
 * requested five times an hour per mobile number. Everything else — the
 * staff password form, the refresh endpoint, every catalogue and order route
 * — could be called without bound. A password form with no rate limit is an
 * offline-speed online guessing oracle, and that is the single most
 * launch-critical gap this guard closes.
 *
 * THREE CLASSES, because one number cannot be right for all of them:
 *
 *   auth   sign-in, OTP request/verify, refresh.  Strict: these are the
 *          routes an attacker repeats, and a human signs in a handful of
 *          times a day.
 *   write  every POST/PATCH/DELETE elsewhere. Moderate: a busy order desk
 *          and a catalogue editor are bursty but not fast.
 *   read   every GET. Generous: one screen can legitimately make a dozen
 *          calls, and the customer app is a PWA that refetches.
 *
 * COUNTED PER CALLER AND PER CLASS. The key is the authenticated principal
 * when there is one, and the client IP otherwise — so one signed-in officer
 * hammering the API cannot exhaust the allowance of everyone behind the same
 * facility NAT, and an unauthenticated flood is still bounded by IP.
 *
 * HONEST ABOUT ITS LIMITS. The counters are in this process's memory. For
 * the single API process this application deploys as, that is exactly right
 * and needs no Redis; behind two instances each would allow its own share,
 * which is a scaling decision to make when a second instance exists and is
 * written down in the deployment notes rather than pretended away. The OTP
 * limit remains in the database, so that one is shared whatever happens.
 *
 * SWITCHED OFF FOR THE TEST SUITES by default (NODE_ENV=test), because they
 * deliberately make hundreds of requests a second against one address; the
 * guard's own tests turn it back on explicitly.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');
  private readonly enabled: boolean;
  private readonly limits: Readonly<Record<Exclude<RateLimitClass, 'none'>, number>>;
  private readonly windowMs: number;
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = Date.now();

  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_SETTINGS) settings: RateLimitSettings
  ) {
    this.enabled = settings.enabled;
    this.windowMs = settings.windowMs;
    this.limits = settings.limits;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.enabled) return true;
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<CorrelatedRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    const limitClass = this.classOf(context, req);
    if (limitClass === 'none') return true;

    const limit = this.limits[limitClass];
    const key = `${limitClass}:${callerKey(req)}`;
    const now = Date.now();
    this.pruneOccasionally(now);

    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      setHeaders(res, limit, limit - 1, now + this.windowMs);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      setHeaders(res, limit, 0, bucket.resetAt);
      res.setHeader('Retry-After', String(retryAfter));
      // Logged once per breach, with the class and the caller key's shape —
      // never the token, never a password.
      this.logger.warn(
        `rate limit exceeded: ${limitClass} ${req.method} ${req.originalUrl ?? req.url} (${bucket.count}/${limit})`
      );
      throw new HttpException(
        {
          code: ERROR_CODES.RATE_LIMITED,
          message: `Too many requests. Please wait ${retryAfter} second(s) and try again.`,
          details: { retryAfterSeconds: retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    setHeaders(res, limit, limit - bucket.count, bucket.resetAt);
    return true;
  }

  /** The decorator wins; otherwise the method and the path decide. */
  private classOf(context: ExecutionContext, req: Request): RateLimitClass {
    const declared = this.reflector.getAllAndOverride<RateLimitClass>(RATE_LIMIT_CLASS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (declared) return declared;

    const path = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (CREDENTIAL_PATHS.has(path)) return 'auth';
    return req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
  }

  /**
   * Keep the map bounded. A bucket is dead once its window has passed, and
   * an API that has served a million distinct IPs must not hold a million
   * entries for ever.
   */
  private pruneOccasionally(now: number): void {
    if (now - this.lastPrune < this.windowMs) return;
    this.lastPrune = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Who is being counted.
 *
 * The authenticated principal if the guards have resolved one by now, else
 * the client address. `req.ip` already honours the proxy configuration set
 * in main.ts, so behind the facility's reverse proxy this is the real client
 * rather than the proxy itself.
 */
function callerKey(req: Request & { authContext?: { principalId?: string } }): string {
  const principal = req.authContext?.principalId;
  if (typeof principal === 'string' && principal.length > 0) return `p:${principal}`;
  return `i:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
}

function setHeaders(res: Response, limit: number, remaining: number, resetAt: number): void {
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
}
