import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or an entire controller) as not requiring
 * authentication. JwtAuthGuard checks this via Reflector before
 * demanding a bearer token — see jwt-auth.guard.ts. Everything under
 * AuthController is guarded by default except the handful of routes
 * that start a session (OTP request/verify, staff login, refresh),
 * which carry this decorator explicitly rather than the guard having
 * an implicit allowlist.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
