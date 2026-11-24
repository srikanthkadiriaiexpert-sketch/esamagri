/**
 * Staff roles, verbatim from the approved Phase 2 seed data
 * (database/migrations/0019_seed_data.sql, shared.roles). Do not add,
 * rename, or remove a role here without a corresponding, explicitly
 * approved database migration — this list must always match
 * shared.roles exactly, because the database's own grants are the
 * final authority (defense-in-depth layer of the 3-layer RBAC model).
 *
 * Customers are NOT in this list — see shared.customers, an entirely
 * separate identity with no role at all (blueprint Section 09).
 */
export const STAFF_ROLES = [
  'SUPER_ADMIN',
  'RIK_ADMIN',
  'PIF_ADMIN',
  'PIF_CASHIER',
  'RIK_PICKUP_STAFF',
  'DELIVERY_STAFF',
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}
