import { ROLE_MODULE_SCOPE, isStaffRole, type ModuleScope } from '@esamagri/shared-types';
import type { AuthContext } from '../../auth/auth-context';
import type { AnnouncementAudience } from '../../shared/repositories/announcements.repository';

/**
 * Announcement audience scoping (STEP 10 kickoff Section 7).
 *
 * Why this exists as a separate rule rather than a permission check:
 * the approved seed grants `shared.announcement.manage` to SUPER_ADMIN,
 * RIK_ADMIN *and* PIF_ADMIN alike, and the permission carries no
 * audience dimension. So "RIK_ADMIN must not manage PIF-targeted
 * announcements" cannot be expressed by the permission alone — it is a
 * scope check against the role's own module, using the STEP 7
 * ROLE_MODULE_SCOPE map that already exists for exactly this purpose.
 * No new permission, role or database object is invented to achieve it.
 *
 * The rule:
 *
 *   role scope 'rik'  → may manage audience 'RIK' only
 *   role scope 'pif'  → may manage audience 'PIF' only
 *   role scope 'ANY'  → may manage 'ALL', 'RIK' and 'PIF'
 *
 * 'ALL' is deliberately reserved to an 'ANY'-scoped role: an ALL
 * announcement reaches PIF customers as well as RIK ones, so letting a
 * RIK_ADMIN publish one would be precisely the cross-module reach the
 * kickoff forbids, just by another route.
 *
 * Reading is wider than writing on purpose: a module admin may SEE the
 * 'ALL' announcements that apply to everyone (they are global notices
 * affecting that admin's own module too) but may not create or alter
 * them.
 */
export function moduleScopesOf(context: AuthContext): ReadonlySet<ModuleScope | 'ANY'> {
  const scopes = new Set<ModuleScope | 'ANY'>();
  for (const role of context.roles) {
    if (isStaffRole(role)) {
      scopes.add(ROLE_MODULE_SCOPE[role]);
    }
  }
  return scopes;
}

/** Audiences this staff member may CREATE or MODIFY. */
export function manageableAudiences(context: AuthContext): readonly AnnouncementAudience[] {
  const scopes = moduleScopesOf(context);
  if (scopes.has('ANY')) {
    return ['ALL', 'RIK', 'PIF'];
  }
  const allowed: AnnouncementAudience[] = [];
  if (scopes.has('rik')) allowed.push('RIK');
  if (scopes.has('pif')) allowed.push('PIF');
  return allowed;
}

/** Audiences this staff member may READ (their own, plus global notices). */
export function readableAudiences(context: AuthContext): readonly AnnouncementAudience[] {
  const manageable = manageableAudiences(context);
  if (manageable.includes('ALL')) {
    return ['ALL', 'RIK', 'PIF'];
  }
  return manageable.length > 0 ? (['ALL', ...manageable] as AnnouncementAudience[]) : [];
}

export function canManageAudience(context: AuthContext, audience: AnnouncementAudience): boolean {
  return manageableAudiences(context).includes(audience);
}
