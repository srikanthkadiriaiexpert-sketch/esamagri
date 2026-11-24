import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface StaffUserRecord {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  totp_secret: string | null;
  totp_enabled: boolean;
  last_login_at: Date | null;
}

/** One staff account as the administration screens show it. */
export interface StaffAccountRecord {
  id: string;
  username: string;
  display_name: string;
  status: string;
  totp_enabled: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
}

/**
 * Read/write access to shared.users (staff accounts only — see that
 * table's own comment; customers never appear here). Built on
 * DatabaseService; owns no connection of its own. Every query here is
 * against the frozen Phase 2 columns exactly as migration 0003 defines
 * them — no schema assumption beyond that.
 *
 * TWO CLASSES OF READ, DELIBERATELY SEPARATE. `findByUsername` selects
 * `password_hash` and `totp_secret` because authentication cannot work
 * without them. Everything the administration screens use selects
 * neither — see `StaffAccountRecord`, which has no field for either, so
 * a handler cannot accidentally serialize one into a response. That is
 * not a convention to remember; the type makes it unavailable.
 *
 * THE WRITES ADDED FOR STAFF ADMINISTRATION are deliberately narrow: create
 * an account, rename it, set its status, replace its password hash. There is
 * no `update(anything)`, no username rename (a username is an identity that
 * every audit row points at) and no DELETE at all — an account that must stop
 * working is SUSPENDED, which is reversible and leaves its audit trail
 * attributable. `shared.users.created_by` is a self-FK, so a deletion would
 * also orphan every account the deleted administrator had created.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * STEP 10 — looks up a staff member by id for the admin session
   * endpoint. Deliberately returns only identity columns: the password
   * hash and TOTP secret are never selected here, because nothing that
   * renders a staff header needs them.
   */
  async findById(userId: string): Promise<{ id: string; username: string; display_name: string; status: string } | null> {
    const rows = await this.db.query<{ id: string; username: string; display_name: string; status: string }>(
      `SELECT id, username, display_name, status
       FROM shared.users
       WHERE id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<StaffUserRecord | null> {
    const rows = await this.db.query<StaffUserRecord>(
      `SELECT id, username, password_hash, display_name, status, totp_secret, totp_enabled, last_login_at
       FROM shared.users
       WHERE username = $1`,
      [username]
    );
    return rows[0] ?? null;
  }

  async markLoginSuccessful(userId: string): Promise<void> {
    await this.db.query('UPDATE shared.users SET last_login_at = now(), updated_at = now() WHERE id = $1', [
      userId,
    ]);
  }

  // ---------------------------------------------------------------- reads

  /** The columns the administration screens may see, and only those. */
  private static readonly SAFE_COLUMNS = `id, username, display_name, status,
            totp_enabled, last_login_at, created_at, updated_at, created_by`;

  /**
   * The staff list, filtered.
   *
   * `q` matches display name or username case-insensitively. `role` filters on
   * a live grant in shared.user_roles rather than on anything denormalized
   * here, so the filter can never disagree with what authorization resolves.
   */
  async list(params: {
    q?: string | null;
    role?: string | null;
    status?: string | null;
    limit: number;
    offset: number;
  }): Promise<StaffAccountRecord[]> {
    const pattern = params.q && params.q.trim() !== '' ? `%${params.q.trim()}%` : null;
    return this.db.query<StaffAccountRecord>(
      `SELECT ${UsersRepository.SAFE_COLUMNS}
         FROM shared.users u
        WHERE ($1::text IS NULL OR u.display_name ILIKE $1 OR u.username ILIKE $1)
          AND ($2::text IS NULL OR u.status = $2)
          AND ($3::text IS NULL OR EXISTS (
                SELECT 1
                  FROM shared.user_roles ur
                  JOIN shared.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.name = $3))
        ORDER BY u.display_name ASC, u.username ASC
        LIMIT $4 OFFSET $5`,
      [pattern, params.status ?? null, params.role ?? null, params.limit, params.offset]
    );
  }

  /** How many staff rows match the same filters, for the list's total. */
  async countMatching(params: {
    q?: string | null;
    role?: string | null;
    status?: string | null;
  }): Promise<number> {
    const pattern = params.q && params.q.trim() !== '' ? `%${params.q.trim()}%` : null;
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM shared.users u
        WHERE ($1::text IS NULL OR u.display_name ILIKE $1 OR u.username ILIKE $1)
          AND ($2::text IS NULL OR u.status = $2)
          AND ($3::text IS NULL OR EXISTS (
                SELECT 1
                  FROM shared.user_roles ur
                  JOIN shared.roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND r.name = $3))`,
      [pattern, params.status ?? null, params.role ?? null]
    );
    return Number(rows[0]?.count ?? '0');
  }

  /** One staff account, safe columns only. */
  async findAccountById(userId: string): Promise<StaffAccountRecord | null> {
    const rows = await this.db.query<StaffAccountRecord>(
      `SELECT ${UsersRepository.SAFE_COLUMNS} FROM shared.users u WHERE u.id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  /**
   * How many ACTIVE accounts hold a given role.
   *
   * Backs the rule that the last active SUPER_ADMIN cannot be suspended or
   * have that role revoked. Counted live, in the database, at the moment of
   * the check — not from a cached number that could be stale by the time the
   * write lands.
   */
  async countActiveWithRole(roleName: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(DISTINCT u.id)::text AS count
         FROM shared.users u
         JOIN shared.user_roles ur ON ur.user_id = u.id
         JOIN shared.roles r ON r.id = ur.role_id
        WHERE r.name = $1 AND u.status = 'ACTIVE'`,
      [roleName]
    );
    return Number(rows[0]?.count ?? '0');
  }

  // --------------------------------------------------------------- writes

  /**
   * Creates a staff account. `passwordHash` is already bcrypt — this
   * repository never sees a plaintext password and never hashes one; that is
   * PasswordService's job and the service layer's call.
   *
   * Uniqueness is left to `users_username_uq` rather than checked first: a
   * SELECT-then-INSERT would still let two concurrent creates through, and the
   * constraint cannot. The caller maps the resulting 23505 to a 409.
   */
  async create(params: {
    username: string;
    passwordHash: string;
    displayName: string;
    status: string;
    createdBy: string | null;
  }): Promise<StaffAccountRecord> {
    const rows = await this.db.query<StaffAccountRecord>(
      `INSERT INTO shared.users (username, password_hash, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${UsersRepository.SAFE_COLUMNS}`,
      [params.username, params.passwordHash, params.displayName, params.status, params.createdBy]
    );
    const created = rows[0];
    if (!created) throw new Error('INSERT INTO shared.users returned no row');
    return created;
  }

  async updateDisplayName(userId: string, displayName: string): Promise<StaffAccountRecord | null> {
    const rows = await this.db.query<StaffAccountRecord>(
      `UPDATE shared.users
          SET display_name = $2, updated_at = now()
        WHERE id = $1
      RETURNING ${UsersRepository.SAFE_COLUMNS}`,
      [userId, displayName]
    );
    return rows[0] ?? null;
  }

  /**
   * Sets the account status. The `users_status_chk` constraint is the final
   * authority on the allowed values, so an unexpected string fails in the
   * database rather than being silently stored.
   */
  async updateStatus(userId: string, status: string): Promise<StaffAccountRecord | null> {
    const rows = await this.db.query<StaffAccountRecord>(
      `UPDATE shared.users
          SET status = $2, updated_at = now()
        WHERE id = $1
      RETURNING ${UsersRepository.SAFE_COLUMNS}`,
      [userId, status]
    );
    return rows[0] ?? null;
  }

  /** Replaces the bcrypt hash. Returns false if there was no such account. */
  async updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE shared.users
          SET password_hash = $2, updated_at = now()
        WHERE id = $1
      RETURNING id`,
      [userId, passwordHash]
    );
    return rows.length > 0;
  }
}
