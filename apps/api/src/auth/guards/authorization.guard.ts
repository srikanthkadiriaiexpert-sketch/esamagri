import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, type PermissionCode } from '@esamagri/shared-types';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import type { AuthContext } from '../auth-context';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { REQUIRE_ANY_PERMISSION_KEY } from '../decorators/require-any-permission.decorator';
import { REQUIRE_CUSTOMER_KEY } from '../decorators/require-customer.decorator';
import { REQUIRE_RIK_CUSTOMER_KEY } from '../decorators/require-rik-customer.decorator';
import { OWN_RESOURCE_PARAM_KEY } from '../decorators/own-resource-param.decorator';
import { AuthorizationService } from '../services/authorization.service';

export interface AuthorizedRequest extends AuthenticatedRequest {
  authContext: AuthContext;
}

/**
 * "What are you allowed to do?" — strictly separate from, and always
 * runs after, JwtAuthGuard ("who are you?"). JwtAuthGuard has already
 * thrown 401 for anything short of a valid access token and attached
 * `request.principal` by the time this guard runs; this guard never
 * throws 401 itself, only 403 (ForbiddenException) or nothing at all.
 *
 * Resolves the live, DB-backed AuthContext (AuthorizationService —
 * shared.user_roles/role_permissions/permissions, queried fresh on
 * every request, never cached in the JWT) and attaches it to
 * `request.authContext` for `@CurrentAuthContext()` / any
 * handler-level check to use, THEN enforces whichever of
 * @RequireCustomer / @OwnResourceParam / @RequirePermissions the
 * route declares (a route with none of these is simply
 * "authenticated principal of any kind", the same bar STEP 6's
 * `GET /auth/me` already set).
 *
 * @Public() routes skip this guard entirely — same Reflector check
 * JwtAuthGuard uses, so "this route needs no auth at all" has exactly
 * one source of truth, never two guards that could disagree.
 *
 * Every denial is logged as a single, generic `AUTHORIZATION_DENIED`
 * audit event (module/action/entity identify the route, never the
 * specific missing permission in the response body — see the 403
 * bodies below, which are intentionally generic). Successful checks
 * are NOT audited — logging every allowed request would flood
 * shared.audit_log with routine traffic; STEP 7 kickoff Section 20
 * explicitly warns against that. A denial is, by definition, the rarer
 * and more security-relevant event.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly auditLog: AuditLogRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    // JwtAuthGuard is required to run before this guard on every
    // non-public route (enforced by controller-level @UseGuards
    // ordering) — request.principal is not optional here.
    request.authContext = await this.authorization.resolveContext(request.principal);

    const routeLabel = `${context.getClass().name}.${context.getHandler().name}`;

    const requireCustomer = this.reflector.getAllAndOverride<boolean>(REQUIRE_CUSTOMER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requireCustomer && request.authContext.principalType !== 'CUSTOMER') {
      await this.denyAndAudit(request.authContext, routeLabel, 'not_a_customer_principal');
    }

    /**
     * RIK authorisation for a CUSTOMER. Declared at class level on
     * RikController, so every one of its routes is covered and a route added
     * later is covered the day it is written.
     *
     * Checked here rather than in each handler for the same reason every other
     * rule in this guard is: hiding the RIK menu in the Customer App is a
     * courtesy to the person using it, not a security control. A PIF-only
     * resident who types the URL, or sends the request by hand, is refused by
     * this block.
     */
    const requireRikCustomer = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_RIK_CUSTOMER_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (requireRikCustomer) {
      const reason = await this.authorization.rikCustomerDenialReason(request.authContext);
      if (reason !== null) {
        await this.denyAndAudit(request.authContext, routeLabel, reason);
      }
    }

    const ownResourceParam = this.reflector.getAllAndOverride<string>(OWN_RESOURCE_PARAM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (ownResourceParam) {
      const httpRequest = context.switchToHttp().getRequest<{ params: Record<string, string> }>();
      const paramValue = httpRequest.params[ownResourceParam];
      if (request.authContext.principalType !== 'CUSTOMER' || paramValue !== request.authContext.principalId) {
        await this.denyAndAudit(request.authContext, routeLabel, 'resource_ownership_mismatch');
      }
    }

    const requiredPermissions = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRE_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredPermissions && requiredPermissions.length > 0) {
      if (!this.authorization.hasAllPermissions(request.authContext, requiredPermissions)) {
        await this.denyAndAudit(request.authContext, routeLabel, 'missing_required_permission');
      }
    }

    // PHASE F: "at least one of these" — for a route several roles with
    // deliberately different authority must all be able to open (see
    // RequireAnyPermission). Checked IN ADDITION to the ALL-of set above, so
    // a route carrying both decorators must satisfy both.
    const anyPermission = this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRE_ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (anyPermission && anyPermission.length > 0) {
      const holdsOne = anyPermission.some((code) =>
        this.authorization.hasAllPermissions(request.authContext, [code])
      );
      if (!holdsOne) {
        await this.denyAndAudit(request.authContext, routeLabel, 'missing_required_permission');
      }
    }

    return true;
  }

  private async denyAndAudit(context: AuthContext, routeLabel: string, reason: string): Promise<never> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: context.principalType,
      module: 'shared',
      action: 'AUTHORIZATION_DENIED',
      entityType: 'http_route',
      entityId: null,
      after: { route: routeLabel, reason },
    });
    // Deliberately generic — never echoes which permission/role was
    // actually required, only that the caller lacks it (STEP 7
    // kickoff Section 19: no internal permission-table structure in
    // the response).
    throw new ForbiddenException({
      code: ERROR_CODES.FORBIDDEN,
      message: 'You do not have permission to perform this action.',
    });
  }
}
