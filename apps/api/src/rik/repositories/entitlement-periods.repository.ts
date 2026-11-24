import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * `rik.entitlement_periods` — the issue periods an entitlement is calculated
 * against.
 *
 * "Current" means the period whose date range contains today AND which has not
 * been CLOSED. There is no fallback to "the latest one" and no synthesised
 * period: if the facility has not opened a period, the customer has no current
 * entitlement, and the API says so rather than inventing a window.
 *
 * WHY `status` IS CONSULTED IN findCurrent AND NOWHERE ELSE. The dates decide
 * which period is operational; UPCOMING and ACTIVE are informational labels
 * that change nothing. CLOSED is the one exception — an explicit retirement
 * switch, approved by the project owner, so a period kept only for reference
 * can never be resolved as live merely because today falls inside its dates.
 * Because `rik_ent_periods_no_overlap` forbids overlapping periods, at most one
 * period can contain today, so this stays unambiguous.
 *
 * CREATING AND EDITING A PERIOD LIVES HERE TOO, so RIK staff manage periods
 * from the Admin Portal rather than by SQL. What this file does NOT do is
 * compute anything: entitlement figures, ratios, scales, dietary rules and
 * carry-forward are untouched by every method below.
 */

export interface EntitlementPeriodRecord {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
}

/** The statuses migration 0008's column CHECK allows. */
export const PERIOD_STATUSES = ['UPCOMING', 'ACTIVE', 'CLOSED'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/**
 * How many records already depend on this period.
 *
 * Used to decide whether its dates are still safe to move. Every table that
 * references `rik.entitlement_periods` is counted explicitly rather than
 * discovered from the catalog, so that adding a reference elsewhere and
 * forgetting this list shows up as a compile-time omission rather than a
 * silent under-count.
 */
export interface PeriodDependentCounts {
  eligibility: number;
  import_batches: number;
  entitlements: number;
  selections: number;
  issue_windows: number;
  issue_vouchers: number;
  carry_forward: number;
  total: number;
}

@Injectable()
export class EntitlementPeriodsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findCurrent(): Promise<EntitlementPeriodRecord | null> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM rik.entitlement_periods
        WHERE CURRENT_DATE BETWEEN start_date AND end_date
          AND status <> 'CLOSED'
        ORDER BY start_date DESC
        LIMIT 1`
    );
    return rows[0] ?? null;
  }

  /**
   * Every period, newest first (STEP 15B Phase B).
   *
   * Needed because an eligibility sheet carries no period column, so the
   * upload screen has to offer the administrator a choice. Every period is
   * returned, CLOSED ones included: a closed period must remain selectable for
   * a late eligibility correction, which the project owner confirmed is
   * required. It is the SCREEN that marks a closed period as historical, not
   * this query that hides it.
   */
  async listAll(limit = 60): Promise<EntitlementPeriodRecord[]> {
    return this.db.query<EntitlementPeriodRecord>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM rik.entitlement_periods
        ORDER BY start_date DESC
        LIMIT $1`,
      [limit]
    );
  }

  async findById(periodId: string): Promise<EntitlementPeriodRecord | null> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM rik.entitlement_periods
        WHERE id = $1`,
      [periodId]
    );
    return rows[0] ?? null;
  }

  /** The period with this name, if any. Used to refuse a duplicate by name. */
  async findByName(name: string): Promise<EntitlementPeriodRecord | null> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM rik.entitlement_periods
        WHERE lower(btrim(name)) = lower(btrim($1))`,
      [name]
    );
    return rows[0] ?? null;
  }

  /**
   * Any period whose inclusive date range overlaps this one.
   *
   * `rik_ent_periods_no_overlap` already forbids this at the database level, so
   * this query exists only to produce a sentence naming the period in the way,
   * instead of surfacing an exclusion-constraint error. The constraint remains
   * the authority; this is courtesy.
   */
  async findOverlapping(
    startDate: string,
    endDate: string,
    excludeId?: string
  ): Promise<EntitlementPeriodRecord[]> {
    return this.db.query<EntitlementPeriodRecord>(
      `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, status
         FROM rik.entitlement_periods
        WHERE daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        ORDER BY start_date`,
      [startDate, endDate, excludeId ?? null]
    );
  }

  /** Everything that already references this period. See PeriodDependentCounts. */
  async countDependents(periodId: string): Promise<PeriodDependentCounts> {
    const rows = await this.db.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM rik.customer_period_eligibility  WHERE period_id        = $1) AS eligibility,
         (SELECT count(*) FROM rik.eligibility_import_batches    WHERE period_id        = $1) AS import_batches,
         (SELECT count(*) FROM rik.entitlements                  WHERE period_id        = $1) AS entitlements,
         (SELECT count(*) FROM rik.entitlement_selections        WHERE period_id        = $1) AS selections,
         (SELECT count(*) FROM rik.issue_windows                 WHERE period_id        = $1) AS issue_windows,
         (SELECT count(*) FROM rik.issue_vouchers                WHERE period_id        = $1) AS issue_vouchers,
         (SELECT count(*) FROM rik.dry_carry_forward
           WHERE source_period_id = $1 OR target_period_id = $1)                             AS carry_forward`,
      [periodId]
    );
    const r = rows[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    const counts = {
      eligibility: n('eligibility'),
      import_batches: n('import_batches'),
      entitlements: n('entitlements'),
      selections: n('selections'),
      issue_windows: n('issue_windows'),
      issue_vouchers: n('issue_vouchers'),
      carry_forward: n('carry_forward'),
    };
    return {
      ...counts,
      total: Object.values(counts).reduce((sum, v) => sum + v, 0),
    };
  }

  /**
   * Create a period.
   *
   * `status` is supplied by the caller rather than derived from the dates,
   * because status is a label the facility chooses and the dates are the thing
   * that decides what is operational. The database's own CHECK is the backstop
   * on both the value and start_date < end_date.
   */
  async create(input: {
    name: string;
    startDate: string;
    endDate: string;
    status: PeriodStatus;
  }): Promise<EntitlementPeriodRecord> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `INSERT INTO rik.entitlement_periods (name, start_date, end_date, status)
       VALUES (btrim($1), $2::date, $3::date, $4)
       RETURNING id, name, start_date::text AS start_date, end_date::text AS end_date, status`,
      [input.name, input.startDate, input.endDate, input.status]
    );
    return rows[0]!;
  }

  /** Change a period's name and dates. The caller decides whether that is safe. */
  async update(
    periodId: string,
    input: { name: string; startDate: string; endDate: string }
  ): Promise<EntitlementPeriodRecord | null> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `UPDATE rik.entitlement_periods
          SET name = btrim($2), start_date = $3::date, end_date = $4::date
        WHERE id = $1
       RETURNING id, name, start_date::text AS start_date, end_date::text AS end_date, status`,
      [periodId, input.name, input.startDate, input.endDate]
    );
    return rows[0] ?? null;
  }

  /**
   * Change only the status label.
   *
   * Deliberately separate from `update`: closing a period is always allowed,
   * whatever depends on it, because it moves no dates and recalculates nothing.
   * It is the one safe operation on a period in use.
   */
  async setStatus(periodId: string, status: PeriodStatus): Promise<EntitlementPeriodRecord | null> {
    const rows = await this.db.query<EntitlementPeriodRecord>(
      `UPDATE rik.entitlement_periods
          SET status = $2
        WHERE id = $1
       RETURNING id, name, start_date::text AS start_date, end_date::text AS end_date, status`,
      [periodId, status]
    );
    return rows[0] ?? null;
  }
}
