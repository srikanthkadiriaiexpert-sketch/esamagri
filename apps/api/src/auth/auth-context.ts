import type { PrincipalType } from '../shared/repositories/auth-sessions.repository';

/**
 * The resolved authorization context for one request: STEP 6's
 * authenticated principal (who you are), plus — for STAFF — the
 * live, DB-resolved set of roles/permissions (what you're allowed to
 * do). Deliberately minimal, per the STEP 7 kickoff's "principal/
 * context shape containing only what is required": no denormalized
 * business data, no cached-from-JWT permission set (see
 * AuthorizationService — this is always a fresh query).
 *
 * A CUSTOMER principal always has empty roles/permissions — customers
 * have no row in shared.user_roles at all (that table's FK is to
 * shared.users only); customer authorization is ownership-based
 * (principalId match), never permission-code-based.
 */
export interface AuthContext {
  principalType: PrincipalType;
  principalId: string;
  roles: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
}
