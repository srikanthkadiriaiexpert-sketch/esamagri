import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccessTokenPrincipal } from '../services/token.service';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

/**
 * The authentication identity/context mechanism STEP 6 was asked to
 * establish so STEP 7's RBAC guards have something to consume:
 * `{ principalType: 'STAFF'|'CUSTOMER', principalId }` only — no
 * roles/permissions yet (that's the STEP 7 matrix). JwtAuthGuard
 * attaches this to the request after verifying the access token;
 * this decorator just reads it back out for a controller handler.
 */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessTokenPrincipal => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.principal;
});
