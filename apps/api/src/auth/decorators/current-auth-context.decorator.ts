import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '../auth-context';
import type { AuthorizedRequest } from '../guards/authorization.guard';

/**
 * Reads back the AuthContext AuthorizationGuard already resolved and
 * attached to the request — for a handler that needs to make its own
 * data-dependent authorization decision beyond what static route
 * metadata can express (e.g. the announcement-audience module-scope
 * check in the STEP 7 demo controller, where the target module comes
 * from the request itself, not a fixed decorator argument).
 */
export const CurrentAuthContext = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const request = ctx.switchToHttp().getRequest<AuthorizedRequest>();
  return request.authContext;
});
