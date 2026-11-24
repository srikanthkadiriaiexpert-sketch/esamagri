import { Injectable } from '@nestjs/common';
import { ROLE_MODULE_SCOPE, isStaffRole, type ModuleScope, type PermissionCode } from '@esamagri/shared-types';
import { UserRolesRepository } from '../../shared/repositories/user-roles.repository';
import {
  CustomersRepository,
  isRikAuthorised,
} from '../../shared/repositories/customers.repository';
import type { AccessTokenPrincipal } from './token.service';
import type { AuthContext } from '../auth-context';

/**
 * "What are you allowed to do?" — the STEP 7 counterpart to STEP 6's
 * TokenService/JwtAuthGuard ("who are you?"). Every decision here is
 * ultimately backed by a live read of shared.user_roles/roles/
 * role_permissions/permissions (via UserRolesRepository) — this
 * service resolves and interprets that data, it never stores or
 * invents a competing copy of it. Nothing here is cached beyond the
 * single request that resolved it (see AuthorizationGuard): a role or
 * permission change takes effect on a principal's very next request,
 * never waiting for a stale access token to expire.
 */
/** Why a caller was refused a customer-facing RIK route. Audit detail only. */
export type RikCustomerDenialReason =
  | 'not_a_customer_principal'
  | 'customer_record_missing'
  | 'customer_inactive'
  | 'customer_not_rik_authorised';

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly userRoles: UserRolesRepository,
    private readonly customers: CustomersRepository
  ) {}

  async resolveContext(principal: AccessTokenPrincipal): Promise<AuthContext> {
    if (principal.principalType === 'CUSTOMER') {
      // No shared.user_roles row is possible for a customer (FK is to
      // shared.users only) — no query needed, the answer is always empty.
      return {
        principalType: 'CUSTOMER',
        principalId: principal.principalId,
        roles: new Set(),
        permissions: new Set(),
      };
    }

    const { roles, permissions } = await this.userRoles.resolveForUser(principal.principalId);
    return {
      principalType: 'STAFF',
      principalId: principal.principalId,
      roles: new Set(roles),
      permissions: new Set(permissions),
    };
  }

  /**
   * Why this context may NOT use customer-facing RIK, or null if it may.
   *
   * Customers hold no roles and no permissions, so RIK authorisation cannot be
   * a permission code: it is a property of the customer's own
   * `shared.customers` row. This resolves it live, for the routes that ask —
   * `@RequireRikCustomer()` — and only for those, so a PIF-only request pays
   * no query it does not need.
   *
   * It returns a REASON rather than a boolean because the four cases are
   * operationally different and an auditor needs to tell them apart. The
   * reason reaches the audit log only; the HTTP response stays generic, as
   * AuthorizationGuard's denyAndAudit explains.
   *
   * A STAFF principal is refused here, SUPER_ADMIN included. Staff use the
   * permission-gated `admin/rik/...` routes; this is the customer surface.
   */
  async rikCustomerDenialReason(context: AuthContext): Promise<RikCustomerDenialReason | null> {
    if (context.principalType !== 'CUSTOMER') {
      return 'not_a_customer_principal';
    }

    const authorisation = await this.customers.findRikAuthorisation(context.principalId);
    if (authorisation === null) {
      // Authenticated against a row that no longer exists, or has been
      // soft-deleted since the token was issued.
      return 'customer_record_missing';
    }
    if (!authorisation.isActive) {
      return 'customer_inactive';
    }
    if (authorisation.rikId === null) {
      // A PIF-only resident. The ordinary case, and the one this whole check
      // exists for.
      return 'customer_not_rik_authorised';
    }

    // Belt and braces, and the reason isRikAuthorised exists: the three
    // branches above and this predicate must agree exactly. If a future edit
    // makes them diverge, this REFUSES rather than admitting someone the
    // shared predicate would have turned away, and the spec beside it fails.
    return isRikAuthorised(authorisation) ? null : 'customer_not_rik_authorised';
  }

  hasPermission(context: AuthContext, code: PermissionCode): boolean {
    return context.principalType === 'STAFF' && context.permissions.has(code);
  }

  /** ALL of the given codes must be present — there is no ANY-of variant yet; add one only when a real route needs it. */
  hasAllPermissions(context: AuthContext, codes: readonly PermissionCode[]): boolean {
    return codes.every((code) => this.hasPermission(context, code));
  }

  /**
   * The module scope(s) this context's roles cover, per
   * @esamagri/shared-types' ROLE_MODULE_SCOPE (an application-layer
   * reading of the approved role names — see that file's doc for why
   * this isn't a second permission system). A CUSTOMER, or a STAFF
   * principal with no roles, resolves to an empty set.
   */
  moduleScopes(context: AuthContext): Set<ModuleScope | 'ANY'> {
    const scopes = new Set<ModuleScope | 'ANY'>();
    if (context.principalType !== 'STAFF') {
      return scopes;
    }
    for (const role of context.roles) {
      if (isStaffRole(role)) {
        scopes.add(ROLE_MODULE_SCOPE[role]);
      }
    }
    return scopes;
  }

  /**
   * Whether this context may act on resources scoped to `module` —
   * the reusable mechanism the STEP 7 kickoff asks for behind
   * announcement audience targeting (migration 0023's own comment:
   * "the backend must enforce which target_audience each may set"),
   * usable by any future module-scoped check, not just announcements.
   * SUPER_ADMIN's 'ANY' scope always passes; everyone else needs an
   * exact module match.
   */
  canActOnModule(context: AuthContext, module: ModuleScope): boolean {
    const scopes = this.moduleScopes(context);
    return scopes.has('ANY') || scopes.has(module);
  }
}
