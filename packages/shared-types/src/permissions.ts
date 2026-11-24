/**
 * Permission codes, verbatim from the approved Phase 2 seed data —
 * the original 18 from database/migrations/0019_seed_data.sql plus 2
 * more added by database/migrations/0023_revision2_permissions_and_grants.sql
 * (shared.announcement.manage, rik.issue_schedule.manage). This file
 * was missed when 0023 shipped; STEP 7 caught the drift while mapping
 * DB-backed permissions to application authorization and is updating
 * it here to match — the two new codes were already live in the
 * database, this is the TypeScript mirror catching up, not a new
 * grant of any kind.
 *
 * IMPORTANT: the seed migration's own comment says this set is
 * "representative", not necessarily an exhaustive production
 * permission set per role. As later Phase 3B/3C stages implement real
 * endpoints, additional permission codes will be needed — those are
 * DATABASE_CHANGE_REQUIRED items (new shared.permissions /
 * shared.role_permissions rows via a new, explicitly approved
 * migration), not something the application layer invents locally.
 * This file must stay in lockstep with the database, never ahead of it.
 */
export const PERMISSION_CODES = [
  'shared.user.manage',
  'shared.role.grant',
  'shared.settings.write',
  'shared.audit_log.view',
  'shared.announcement.manage',
  'rik.entitlement.allocate',
  'rik.entitlement.adjust',
  'rik.product.manage',
  'rik.order.manage',
  'rik.order.mark_ready',
  'rik.order.mark_collected',
  'rik.issue_schedule.manage',
  'pif.product.manage',
  'pif.purchase_order.approve',
  'pif.report.view',
  'pif.pos.open_bill',
  'pif.pos.finalize_bill',
  'pif.pos.return',
  'pif.order.mark_delivered',
  'pif.order.mark_not_delivered',
  // PHASE F. The corrected PIF scope is an order-management module, and the
  // Phase 2 seed had no permission that governed a PIF order at all: these
  // two are that gap, nothing more. `manage` accepts, cancels and records a
  // handover; `prepare` is the authorized staff member who picks and packs.
  'pif.order.manage',
  'pif.order.prepare',
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}
