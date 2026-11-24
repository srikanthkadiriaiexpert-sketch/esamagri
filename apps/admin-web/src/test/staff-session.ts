import type { StaffSession } from '../lib/api/admin-api';

/**
 * Staff sessions for tests, transcribed from the REAL approved seed.
 *
 * Every role name and permission code below was read back from
 * shared.role_permissions in the real database — not assumed from the role's
 * name. That distinction still matters: RIK_ADMIN does not hold the pickup
 * staff's mark_ready / mark_collected codes, PIF_CASHIER holds no catalogue
 * code, and a fixture that granted the permissions a role "obviously" ought
 * to have would make these tests prove something about an imagined system
 * rather than the shipped one.
 *
 * PHASE F changed two things in that seed, deliberately and by migration
 * 0050: SUPER_ADMIN now holds every rik.* and pif.* permission that governs a
 * built function (the Phase F authorization requires the overall
 * administrator to reach both modules from one portal), and two PIF order
 * permissions were added because the seed had none that governed a PIF order
 * at all. The four superseded codes — pif.pos.* and
 * pif.purchase_order.approve — are still NOT granted to SUPER_ADMIN, because
 * the corrected PIF scope has no point of sale and no purchasing.
 *
 * Verified 12 Sep 2026, and again 9 Oct 2026 after migration 0050, against:
 *   SELECT r.name, p.code FROM shared.roles r
 *     JOIN shared.role_permissions rp ON rp.role_id = r.id
 *     JOIN shared.permissions p ON p.id = rp.permission_id;
 */
export const SUPER_ADMIN_PERMISSIONS = [
  'shared.announcement.manage',
  'shared.audit_log.view',
  'shared.role.grant',
  'shared.settings.write',
  'shared.user.manage',
  // PHASE F — both modules, explicitly.
  'rik.entitlement.adjust',
  'rik.entitlement.allocate',
  'rik.issue_schedule.manage',
  'rik.order.manage',
  'rik.order.mark_collected',
  'rik.order.mark_ready',
  'rik.product.manage',
  'pif.order.manage',
  'pif.order.mark_delivered',
  'pif.order.mark_not_delivered',
  'pif.order.prepare',
  'pif.product.manage',
  'pif.report.view',
] as const;

export const RIK_ADMIN_PERMISSIONS = [
  'rik.entitlement.adjust',
  'rik.entitlement.allocate',
  'rik.issue_schedule.manage',
  'rik.order.manage',
  'rik.product.manage',
  'shared.announcement.manage',
] as const;

export const PIF_ADMIN_PERMISSIONS = [
  'pif.order.manage',
  'pif.order.prepare',
  'pif.product.manage',
  'pif.purchase_order.approve',
  'pif.report.view',
  'shared.announcement.manage',
] as const;

export const PIF_CASHIER_PERMISSIONS = [
  // The authorized PIF staff member picks and packs. The three pos.* codes
  // remain granted in the seed and are used by no route in the product.
  'pif.order.prepare',
  'pif.pos.finalize_bill',
  'pif.pos.open_bill',
  'pif.pos.return',
] as const;

export const RIK_PICKUP_STAFF_PERMISSIONS = ['rik.order.mark_collected', 'rik.order.mark_ready'] as const;

export const DELIVERY_STAFF_PERMISSIONS = ['pif.order.mark_delivered', 'pif.order.mark_not_delivered'] as const;

export function sessionFor(role: string, permissions: readonly string[]): StaffSession {
  return {
    userId: '00000000-0000-0000-0000-0000000000aa',
    username: role.toLowerCase(),
    displayName: `Test ${role}`,
    roles: [role],
    permissions: [...permissions],
  };
}

export const superAdmin = () => sessionFor('SUPER_ADMIN', SUPER_ADMIN_PERMISSIONS);
export const rikAdmin = () => sessionFor('RIK_ADMIN', RIK_ADMIN_PERMISSIONS);
export const pifAdmin = () => sessionFor('PIF_ADMIN', PIF_ADMIN_PERMISSIONS);
export const pifCashier = () => sessionFor('PIF_CASHIER', PIF_CASHIER_PERMISSIONS);
export const rikPickupStaff = () => sessionFor('RIK_PICKUP_STAFF', RIK_PICKUP_STAFF_PERMISSIONS);
export const deliveryStaff = () => sessionFor('DELIVERY_STAFF', DELIVERY_STAFF_PERMISSIONS);

/** A real, valid situation: a staff account created but not yet granted a role. */
export const noRoleStaff = (): StaffSession => ({
  userId: '00000000-0000-0000-0000-0000000000ff',
  username: 'newstaff',
  displayName: 'Newly created staff',
  roles: [],
  permissions: [],
});
