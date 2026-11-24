import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Read/write access to the frozen `shared.settings` table.
 *
 * THE TABLE IS NOT NEW. It has existed since migration 0003 — key (text
 * primary key), value (jsonb), updated_at, updated_by (FK to
 * shared.users) — and `app_shared` has held SELECT/INSERT/UPDATE/DELETE
 * on it since migration 0018. This file is the first application code to
 * use it; no migration, grant or schema change was required or made.
 *
 * WHY A TYPED `value` IS NOT OFFERED HERE. `value` is jsonb and this
 * repository returns it as `unknown`, deliberately. A repository that
 * cast it to a shape would be asserting something about bytes that any
 * `psql` session can change underneath it. Interpreting the payload is
 * the caller's job, and the caller is expected to fail closed when it
 * cannot — see pif-registration.gate.ts.
 *
 * NO AUTHORIZATION HAPPENS HERE, following the pattern
 * AnnouncementsRepository sets: who may write a setting is enforced one
 * layer up by @RequirePermissions('shared.settings.write'), so the rule
 * lives in one auditable place rather than being spread across queries.
 */

export interface SettingRecord {
  key: string;
  /** Raw jsonb. Interpret it in the caller, and fail closed if it will not interpret. */
  value: unknown;
  updated_at: string;
  updated_by: string | null;
}

/** A setting plus the staff member who last wrote it, for an audit-facing read. */
export interface SettingWithActor extends SettingRecord {
  updated_by_username: string | null;
  updated_by_display_name: string | null;
}

@Injectable()
export class SettingsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * One setting, or null when the key has no row.
   *
   * NULL IS A MEANINGFUL ANSWER, not an error: a key that was never
   * written has no row, and every caller is expected to have a defined
   * default for that case. This is what lets "absent means OFF" be true
   * without a seed row, and therefore without a migration.
   */
  async findByKey(key: string): Promise<SettingRecord | null> {
    const rows = await this.db.query<SettingRecord>(
      `SELECT key, value, updated_at, updated_by
         FROM shared.settings
        WHERE key = $1`,
      [key]
    );
    return rows[0] ?? null;
  }

  /**
   * The same row, plus the name of whoever last changed it.
   *
   * LEFT JOIN, not JOIN: `updated_by` is nullable (the two rows seeded by
   * migration 0019 have none), and a row written before any staff user
   * existed must still be readable rather than vanishing from the result.
   */
  async findByKeyWithActor(key: string): Promise<SettingWithActor | null> {
    const rows = await this.db.query<SettingWithActor>(
      `SELECT s.key, s.value, s.updated_at, s.updated_by,
              u.username     AS updated_by_username,
              u.display_name AS updated_by_display_name
         FROM shared.settings s
         LEFT JOIN shared.users u ON u.id = s.updated_by
        WHERE s.key = $1`,
      [key]
    );
    return rows[0] ?? null;
  }

  /**
   * Writes one setting, creating the row if this key has never been set.
   *
   * ON CONFLICT rather than a read-then-decide: the key is the primary
   * key, so two administrators pressing the control at the same moment
   * cannot both insert — the second updates, and the row that survives is
   * whichever was applied last. Nothing is lost either way, because the
   * audit entry for each attempt is written separately.
   *
   * `updated_at = now()` is restated in the UPDATE branch on purpose: the
   * column's DEFAULT only applies to an INSERT, so without this an UPDATE
   * would keep the original timestamp and the screen would report the
   * wrong "last changed" time.
   */
  async upsert(input: { key: string; value: unknown; updatedBy: string | null }): Promise<SettingRecord> {
    const rows = await this.db.query<SettingRecord>(
      `INSERT INTO shared.settings (key, value, updated_by)
            VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE
              SET value      = EXCLUDED.value,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()
         RETURNING key, value, updated_at, updated_by`,
      [input.key, JSON.stringify(input.value), input.updatedBy]
    );
    const row = rows[0];
    if (!row) {
      // Unreachable in practice: the statement always returns the row it
      // wrote. Throwing rather than returning a fabricated record keeps a
      // silent write failure from being reported to an administrator as a
      // success.
      throw new Error(`shared.settings upsert returned no row for key ${input.key}`);
    }
    return row;
  }
}
