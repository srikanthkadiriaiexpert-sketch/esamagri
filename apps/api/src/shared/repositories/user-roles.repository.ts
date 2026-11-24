import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface ResolvedRolesAndPermissions {
  roles: string[];
  permissions: string[];
}

/**
 * Read access to the DB-backed authorization graph: shared.user_roles
 * -> shared.roles -> shared.role_permissions -> shared.permissions.
 * This is the STEP 7 "the actual authorization decision must
 * ultimately respect the approved database-backed permissions" query
 * — nothing about which roles grant which permissions is duplicated
 * or hardcoded in the application; this repository only ever reads
 * what the approved migrations (0003 schema, 0019/0023 seed data)
 * already assert, live, on every call (no caching beyond one request
 * — see AuthorizationService).
 *
 * A staff user with zero role grants (a real, valid state — e.g. a
 * brand-new account before a SUPER_ADMIN grants it a role) resolves
 * to empty roles/permissions, not an error.
 */
@Injectable()
export class UserRolesRepository {
  constructor(private readonly db: DatabaseService) {}

  async resolveForUser(userId: string): Promise<ResolvedRolesAndPermissions> {
    const rows = await this.db.query<{ role_name: string; permission_code: string | null }>(
      `SELECT DISTINCT r.name AS role_name, p.code AS permission_code
       FROM shared.user_roles ur
       JOIN shared.roles r ON r.id = ur.role_id
       LEFT JOIN shared.role_permissions rp ON rp.role_id = r.id
       LEFT JOIN shared.permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1`,
      [userId]
    );

    const roles = new Set<string>();
    const permissions = new Set<string>();
    for (const row of rows) {
      roles.add(row.role_name);
      if (row.permission_code) {
        permissions.add(row.permission_code);
      }
    }
    return { roles: [...roles], permissions: [...permissions] };
  }

  // ----------------------------------------------- staff administration

  /**
   * The roles held by each of the given users, as a map keyed by user id.
   *
   * One query for the whole list rather than one per row: the staff screen
   * shows roles in the table, and N+1 queries behind a list is how an admin
   * page becomes slow enough that somebody caches the answer and the cache
   * then disagrees with authorization.
   */
  async rolesForUsers(userIds: readonly string[]): Promise<Map<string, string[]>> {
    const byUser = new Map<string, string[]>();
    if (userIds.length === 0) return byUser;

    const rows = await this.db.query<{ user_id: string; role_name: string }>(
      `SELECT ur.user_id, r.name AS role_name
         FROM shared.user_roles ur
         JOIN shared.roles r ON r.id = ur.role_id
        WHERE ur.user_id = ANY($1::uuid[])
        ORDER BY r.name`,
      [[...userIds]]
    );
    for (const row of rows) {
      const existing = byUser.get(row.user_id);
      if (existing) existing.push(row.role_name);
      else byUser.set(row.user_id, [row.role_name]);
    }
    return byUser;
  }

  /**
   * Every role that exists, with the permission codes it carries.
   *
   * Read from shared.roles/role_permissions/permissions, so the staff screen
   * offers exactly the roles the database has and shows exactly what each one
   * confers. Nothing about the role list is hardcoded in the application: if a
   * migration adds a role, it appears here without a code change, and if one
   * is removed it stops being offered.
   */
  async listRolesWithPermissions(): Promise<
    Array<{ name: string; description: string | null; permissions: string[] }>
  > {
    const rows = await this.db.query<{
      name: string;
      description: string | null;
      permission_code: string | null;
    }>(
      `SELECT r.name,
              r.description,
              p.code AS permission_code
         FROM shared.roles r
         LEFT JOIN shared.role_permissions rp ON rp.role_id = r.id
         LEFT JOIN shared.permissions p ON p.id = rp.permission_id
        ORDER BY r.name, p.code`
    );

    const byName = new Map<string, { name: string; description: string | null; permissions: string[] }>();
    for (const row of rows) {
      let entry = byName.get(row.name);
      if (!entry) {
        entry = { name: row.name, description: row.description, permissions: [] };
        byName.set(row.name, entry);
      }
      if (row.permission_code) entry.permissions.push(row.permission_code);
    }
    return [...byName.values()];
  }

  /** Does this role name exist in shared.roles? The database decides, not a list in the code. */
  async roleExists(roleName: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>('SELECT id FROM shared.roles WHERE name = $1', [
      roleName,
    ]);
    return rows.length > 0;
  }

  /**
   * Grants a role, resolving the name to its id in the same statement.
   *
   * `ON CONFLICT DO NOTHING` against the composite primary key makes a repeat
   * grant a no-op rather than an error, so an administrator double-clicking
   * does not get a failure for something that is already true. The return
   * value says whether this call was the one that changed anything, which is
   * what the audit row should reflect.
   */
  async grant(params: {
    userId: string;
    roleName: string;
    grantedBy: string | null;
  }): Promise<boolean> {
    const rows = await this.db.query<{ user_id: string }>(
      `INSERT INTO shared.user_roles (user_id, role_id, granted_by)
       SELECT $1, r.id, $3
         FROM shared.roles r
        WHERE r.name = $2
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [params.userId, params.roleName, params.grantedBy]
    );
    return rows.length > 0;
  }

  /** Revokes a role. Returns whether a grant was actually removed. */
  async revoke(params: { userId: string; roleName: string }): Promise<boolean> {
    const rows = await this.db.query<{ user_id: string }>(
      `DELETE FROM shared.user_roles ur
        USING shared.roles r
        WHERE ur.role_id = r.id
          AND ur.user_id = $1
          AND r.name = $2
       RETURNING ur.user_id`,
      [params.userId, params.roleName]
    );
    return rows.length > 0;
  }
}
