import { BadRequestException, Controller, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { ERROR_CODES, type ModuleScope } from '@esamagri/shared-types';
import { CustomersRepository } from '../shared/repositories/customers.repository';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { RequireCustomer } from './decorators/require-customer.decorator';
import { OwnResourceParam } from './decorators/own-resource-param.decorator';
import { CurrentAuthContext } from './decorators/current-auth-context.decorator';
import { AuthorizationService } from './services/authorization.service';
import type { AuthContext } from './auth-context';

const MODULE_SCOPES: readonly ModuleScope[] = ['shared', 'rik', 'pif'];

/**
 * STEP 7 proof-of-mechanism only — every route here exists solely to
 * exercise JwtAuthGuard + AuthorizationGuard end-to-end over real HTTP
 * (401 vs 403, permission-gating, ownership checks, module-scope
 * checks) against the real, approved role/permission seed data. None
 * of this is RIK/PIF business logic: no catalog, entitlement,
 * inventory, order, POS, purchasing, or announcement functionality
 * exists here — each handler returns a trivial `{ ok: true, ... }`
 * once the guards let it through. This controller is meant to be
 * DELETED once real endpoints in RikModule/PifModule/AdminModule
 * exercise the same guards on real business resources.
 *
 * `@UseGuards(JwtAuthGuard, AuthorizationGuard)` — order matters:
 * JwtAuthGuard (401) always runs first, AuthorizationGuard (403)
 * only runs for a request JwtAuthGuard already accepted.
 */
@Controller('demo/authz')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class AuthorizationDemoController {
  constructor(
    private readonly customers: CustomersRepository,
    private readonly authorization: AuthorizationService
  ) {}

  /**
   * Horizontal-privilege-escalation demo (STEP 7 kickoff Section 15):
   * a CUSTOMER may fetch their OWN profile only — changing the URL's
   * :customerId to someone else's id is 403, enforced server-side by
   * AuthorizationGuard via @OwnResourceParam before this handler ever
   * runs, never by trusting the id the client asked for.
   */
  @Get('customer/:customerId/profile')
  @RequireCustomer()
  @OwnResourceParam('customerId')
  async getOwnCustomerProfile(@Param('customerId') customerId: string) {
    const customer = await this.customers.findById(customerId);
    if (!customer) {
      // Ownership was already proven by the guard — a missing row here
      // means the account itself is gone (e.g. soft-deleted between
      // token issuance and this request), a safe 404, not a leak.
      throw new BadRequestException({ code: ERROR_CODES.NOT_FOUND, message: 'Customer not found.' });
    }
    return { customerId: customer.id, mobileNumber: customer.mobile_number, name: customer.name };
  }

  /** RIK_ADMIN-permitted demo — proves cross-module isolation: PIF_ADMIN must get 403 here. */
  @Get('rik/admin')
  @RequirePermissions('rik.product.manage')
  rikAdmin() {
    return { ok: true, module: 'rik' as const };
  }

  /** PIF_ADMIN-permitted demo — proves cross-module isolation: RIK_ADMIN must get 403 here. */
  @Get('pif/admin')
  @RequirePermissions('pif.product.manage')
  pifAdmin() {
    return { ok: true, module: 'pif' as const };
  }

  /**
   * PIF_CASHIER-permitted demo. Per the approved seed data
   * (migration 0019), pif.pos.open_bill is granted to PIF_CASHIER
   * ONLY — PIF_ADMIN does NOT hold it (its permissions are
   * pif.product.manage/pif.purchase_order.approve/pif.report.view).
   * There is no role hierarchy in the approved schema: a PIF_ADMIN
   * does not automatically inherit a PIF_CASHIER's permissions, or
   * vice versa. This route proves that faithfully rather than
   * assuming "admin implies cashier".
   */
  @Get('pif/pos')
  @RequirePermissions('pif.pos.open_bill')
  pifPos() {
    return { ok: true, module: 'pif' as const, area: 'pos' as const };
  }

  /** RIK_PICKUP_STAFF-permitted demo. */
  @Get('rik/pickup')
  @RequirePermissions('rik.order.mark_collected')
  rikPickup() {
    return { ok: true, module: 'rik' as const, area: 'pickup' as const };
  }

  /** DELIVERY_STAFF-permitted demo. */
  @Get('pif/delivery')
  @RequirePermissions('pif.order.mark_delivered')
  pifDelivery() {
    return { ok: true, module: 'pif' as const, area: 'delivery' as const };
  }

  /**
   * SUPER_ADMIN-permitted demo. Uses shared.user.manage, a permission
   * actually granted to SUPER_ADMIN by the approved seed data — NOT a
   * blanket "SUPER_ADMIN bypasses every check" shortcut (STEP 7
   * kickoff Section 13 explicitly forbids that). Worth noting: as
   * seeded, SUPER_ADMIN's own permissions are all shared.* (user
   * management, role grants, settings, audit log, announcements) —
   * it does NOT hold rik/pif operational permissions (e.g.
   * rik.product.manage), so SUPER_ADMIN gets 403 on rik/admin and
   * pif/admin above too, exactly like any other role without that
   * specific grant. That's a faithful read of the approved role model,
   * not a bug — see the STEP 7 report.
   */
  @Get('admin/users')
  @RequirePermissions('shared.user.manage')
  adminUsers() {
    return { ok: true, module: 'shared' as const, area: 'user_admin' as const };
  }

  /**
   * Announcement-audience-targeting demo (STEP 7 kickoff Section 16):
   * requires shared.announcement.manage AND a module-scope match via
   * AuthorizationService.canActOnModule — SUPER_ADMIN (scope 'ANY')
   * may target any audience; RIK_ADMIN only 'rik'; PIF_ADMIN only
   * 'pif'. The target audience is data (a route param), not something
   * a static decorator alone can express, so this one extra check runs
   * in the handler using the AuthContext AuthorizationGuard already
   * resolved — this IS the "reusable mechanism" the kickoff asks for;
   * no announcement CRUD exists here or anywhere yet.
   */
  @Get('announcements/:audience')
  @RequirePermissions('shared.announcement.manage')
  manageAnnouncementAudience(@Param('audience') audience: string, @CurrentAuthContext() authContext: AuthContext) {
    if (!isModuleScope(audience)) {
      throw new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `audience must be one of: ${MODULE_SCOPES.join(', ')}`,
      });
    }
    if (!this.authorization.canActOnModule(authContext, audience)) {
      throw new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: 'You may not manage announcements for this audience.',
      });
    }
    return { ok: true, audience };
  }
}

function isModuleScope(value: string): value is ModuleScope {
  return (MODULE_SCOPES as readonly string[]).includes(value);
}
