import type { StaffRole } from './roles';

/**
 * The three schemas the frozen Phase 2 database is split into — the
 * `module` column on shared.permissions and shared.audit_log
 * (CHECK ... IN ('shared','rik','pif')) is the actual authoritative
 * source for this set; this type just names it for the app layer.
 */
export type ModuleScope = 'shared' | 'rik' | 'pif';

/**
 * Which module(s) each staff role is scoped to, for authorization
 * rules that need more than "does this permission code exist" — the
 * clearest example is announcement audience targeting (Phase 2
 * Revision 2 / migration 0023's own comment: "the backend must
 * enforce which target_audience each [RIK_ADMIN/PIF_ADMIN] may set").
 * shared.roles has no module/scope column of its own — the database's
 * RBAC model is a flat role -> permission grant with no row/value-level
 * scoping anywhere (migration 0023's comment says this explicitly) —
 * so this mapping is an application-layer reading of the *existing*
 * approved role names (every seeded role name outside SUPER_ADMIN
 * already carries its module as a prefix: RIK_*, PIF_/DELIVERY_STAFF
 * being pif-scoped delivery), not a second, independently-editable
 * permission system. It must be extended only when a new role is
 * added via an approved migration, never invented ahead of one.
 *
 * SUPER_ADMIN is 'ANY': the one seeded role explicitly described as
 * shared-scope-but-cross-cutting in Section 23 ("only role that can
 * grant other roles"); it is not itself rik- or pif-scoped, so it is
 * modeled separately rather than folded into ModuleScope.
 */
// Typed as Record<StaffRole, ...> (not Partial) on purpose: if a role is
// ever added to roles.ts without a corresponding entry here, this
// object literal stops compiling instead of the gap surfacing as a
// runtime bug the first time that role hits an audience check.
export const ROLE_MODULE_SCOPE: Record<StaffRole, ModuleScope | 'ANY'> = {
  SUPER_ADMIN: 'ANY',
  RIK_ADMIN: 'rik',
  RIK_PICKUP_STAFF: 'rik',
  PIF_ADMIN: 'pif',
  PIF_CASHIER: 'pif',
  DELIVERY_STAFF: 'pif',
};
