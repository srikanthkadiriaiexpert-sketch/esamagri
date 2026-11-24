import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * RIK issue windows — the configured physical issue schedule (STEP 15C).
 *
 * The database (migration 0047) owns every rule this repository could get
 * wrong, and deliberately so:
 *
 *   * `rik_issue_windows_identity_chk` ties `window_code` to `ration_type`
 *     and `sequence_no`: FRESH_1/2/3, DRY, and — since migration 0058 —
 *     MISS_MUSTER_FRESH and MISS_MUSTER_DRY. Nothing else is expressible.
 *
 *     THE TWO MISS MUSTER SCHEDULES ARE SEPARATE RATION TYPES, each with
 *     sequence_no 1, which is the exact shape of DRY. That is not cosmetic:
 *     the overlap exclusion and the ordering trigger below are both scoped
 *     BY ration_type, so a single shared type would stop the Fresh and Dry
 *     miss-muster schedules covering the same day and would impose an order
 *     between two schedules that have none.
 *   * `rik_issue_windows_no_overlap` is a GiST exclusion over
 *     (period, ration type, date range) among ACTIVE windows, so two live
 *     Fresh windows cannot cover the same day however they are written.
 *   * `issue_window_within_period` refuses a window that runs outside its
 *     entitlement period.
 *   * `issue_window_sequence_order` refuses Fresh windows numbered against
 *     the calendar — window 2 may not start before window 1.
 *   * `issue_window_no_delete` refuses DELETE outright, and the application
 *     role holds no DELETE privilege either.
 *   * `record_issue_window_revision` writes the revision history itself, on
 *     INSERT and on any material UPDATE. This repository never writes a
 *     revision row: history is a consequence of the change, not a courtesy
 *     the application remembers to perform.
 *
 * So this file inserts, updates, and reads. It enforces nothing on its own,
 * which is why none of those rules can be bypassed by a future caller.
 *
 * OPERATING DAYS ARE ACTUAL DATES, not weekday names. That is the whole point
 * of the model: the facility normally issues on Tuesday, Wednesday and Friday,
 * but a holiday or a local condition moves a day, so the schedule records the
 * days it will actually open. Nothing in this application assumes a seven-day
 * week, a thirty-day month or any particular weekday.
 */

export type RationType = 'FRESH' | 'DRY' | 'MISS_MUSTER_FRESH' | 'MISS_MUSTER_DRY';
export type WindowCode =
  | 'FRESH_1'
  | 'FRESH_2'
  | 'FRESH_3'
  | 'DRY'
  | 'MISS_MUSTER_FRESH'
  | 'MISS_MUSTER_DRY';
export type RevisionChangeType = 'CREATED' | 'UPDATED' | 'ACTIVATED' | 'DEACTIVATED';

export interface IssueWindowRecord {
  id: string;
  period_id: string;
  period_name: string;
  period_start_date: string;
  period_end_date: string;
  ration_type: RationType;
  window_code: WindowCode;
  sequence_no: number;
  start_date: string;
  end_date: string;
  /** ISO dates, ascending — the days the facility will actually issue on. */
  operating_days: string[];
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string | null;
  updated_by: string;
  updated_by_name: string | null;
}

export interface IssueWindowRevisionRecord {
  id: string;
  window_id: string;
  revision_no: number;
  change_type: RevisionChangeType;
  period_id: string;
  ration_type: RationType;
  window_code: WindowCode;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown>;
  changed_by: string;
  changed_by_name: string | null;
  changed_at: string;
}

export interface CreateIssueWindowInput {
  periodId: string;
  rationType: RationType;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  notes: string | null;
  staffId: string;
}

export interface UpdateIssueWindowInput {
  startDate?: string;
  endDate?: string;
  operatingDays?: string[];
  notes?: string | null;
  isActive?: boolean;
  staffId: string;
}

const WINDOW_SELECT = `
  SELECT w.id,
         w.period_id,
         p.name               AS period_name,
         p.start_date::text   AS period_start_date,
         p.end_date::text     AS period_end_date,
         w.ration_type,
         w.window_code,
         w.sequence_no,
         w.start_date::text   AS start_date,
         w.end_date::text     AS end_date,
         (SELECT array_agg(d::text ORDER BY d) FROM unnest(w.operating_days) AS d) AS operating_days,
         w.is_active,
         w.notes,
         w.created_at,
         w.updated_at,
         w.created_by,
         cu.display_name AS created_by_name,
         w.updated_by,
         uu.display_name AS updated_by_name
    FROM rik.issue_windows w
    JOIN rik.entitlement_periods p ON p.id = w.period_id
    LEFT JOIN shared.users cu ON cu.id = w.created_by
    LEFT JOIN shared.users uu ON uu.id = w.updated_by`;

@Injectable()
export class IssueWindowsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Every window of one period, Fresh before Dry and in sequence order.
   *
   * Retired windows are included by default because an administrator needs to
   * see that a window was withdrawn rather than find it simply absent; the
   * customer-facing read asks for active only.
   */
  /**
   * How many ACTIVE windows one period has. For the dashboard tile.
   *
   * A count rather than `listByPeriod(id, true).length`, because the tile
   * wants a number and the list query carries the period join, the
   * operating-day array and a four-way ration-type ordering that a count
   * has no use for.
   *
   * SCOPED BY period_id, WHICH IS THE WHOLE POINT. The tile answers "is
   * THIS period's timetable configured", so a window belonging to last
   * month or to a period not yet started must not be counted. The caller
   * supplies the period; this does not decide which period is current —
   * EntitlementPeriodsRepository.findCurrent() owns that, and nothing
   * here second-guesses it.
   *
   * `is_active` is the only state consulted. Issue windows have no
   * publication flag; `is_published` belongs to the legacy
   * rik.issue_schedules table and has no meaning here.
   */
  async countActiveForPeriod(periodId: string): Promise<number> {
    const rows = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM rik.issue_windows
        WHERE period_id = $1
          AND is_active`,
      [periodId]
    );
    return Number(rows[0]?.count ?? '0');
  }

  async listByPeriod(periodId: string, activeOnly = false): Promise<IssueWindowRecord[]> {
    return this.db.query<IssueWindowRecord>(
      `${WINDOW_SELECT}
        WHERE w.period_id = $1
          AND ($2::boolean IS NOT TRUE OR w.is_active)
        ORDER BY CASE w.ration_type
                   WHEN 'FRESH' THEN 1
                   WHEN 'DRY' THEN 2
                   WHEN 'MISS_MUSTER_FRESH' THEN 3
                   WHEN 'MISS_MUSTER_DRY' THEN 4
                 END,
                 w.sequence_no, w.start_date`,
      [periodId, activeOnly]
    );
  }

  async findById(windowId: string): Promise<IssueWindowRecord | null> {
    const rows = await this.db.query<IssueWindowRecord>(`${WINDOW_SELECT} WHERE w.id = $1`, [
      windowId,
    ]);
    return rows[0] ?? null;
  }

  /** The live window carrying this code in this period, if there is one. */
  async findActiveByCode(periodId: string, windowCode: WindowCode): Promise<IssueWindowRecord | null> {
    const rows = await this.db.query<IssueWindowRecord>(
      `${WINDOW_SELECT} WHERE w.period_id = $1 AND w.window_code = $2 AND w.is_active`,
      [periodId, windowCode]
    );
    return rows[0] ?? null;
  }

  /**
   * Live windows of the same ration type whose dates overlap the given range.
   *
   * The POLITE refusal, not the boundary. `rik_issue_windows_no_overlap` is
   * the boundary and cannot be talked past; this read exists so an
   * administrator is told which window clashes instead of being handed a
   * constraint name — the same division migration 0043 established for
   * overlapping pool scales.
   */
  async findOverlapping(
    periodId: string,
    rationType: RationType,
    startDate: string,
    endDate: string,
    excludeWindowId?: string
  ): Promise<IssueWindowRecord[]> {
    return this.db.query<IssueWindowRecord>(
      `${WINDOW_SELECT}
        WHERE w.period_id = $1
          AND w.ration_type = $2
          AND w.is_active
          AND ($5::uuid IS NULL OR w.id <> $5)
          AND daterange(w.start_date, w.end_date, '[]')
           && daterange($3::date, $4::date, '[]')
        ORDER BY w.start_date`,
      [periodId, rationType, startDate, endDate, excludeWindowId ?? null]
    );
  }

  /**
   * Live windows that this one would be mis-numbered against.
   *
   * Mirrors `issue_window_sequence_order`: window 1 must run before window 2
   * and window 2 before window 3, judged only between windows that do NOT
   * overlap (an overlap is reported as an overlap, which is the clearer
   * complaint). Again a diagnosis, not the enforcement.
   */
  async findOutOfOrder(
    periodId: string,
    rationType: RationType,
    sequenceNo: number,
    startDate: string,
    endDate: string,
    excludeWindowId?: string
  ): Promise<IssueWindowRecord[]> {
    return this.db.query<IssueWindowRecord>(
      `${WINDOW_SELECT}
        WHERE w.period_id = $1
          AND w.ration_type = $2
          AND w.is_active
          AND ($6::uuid IS NULL OR w.id <> $6)
          AND NOT (daterange(w.start_date, w.end_date, '[]')
                && daterange($4::date, $5::date, '[]'))
          AND (
               (w.sequence_no > $3::smallint AND w.start_date < $4::date)
            OR (w.sequence_no < $3::smallint AND w.start_date > $4::date)
          )
        ORDER BY w.sequence_no`,
      [periodId, rationType, sequenceNo, startDate, endDate, excludeWindowId ?? null]
    );
  }

  /**
   * Create a window.
   *
   * `window_code` is NOT supplied: the identity CHECK derives what it must be
   * from the ration type and the sequence number, so composing it here would
   * be a second statement of a rule the database already holds. It is written
   * as the expression the constraint demands, which keeps the two in step by
   * construction.
   */
  async create(input: CreateIssueWindowInput): Promise<IssueWindowRecord> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO rik.issue_windows
         (period_id, ration_type, window_code, sequence_no, start_date, end_date,
          operating_days, is_active, notes, created_by, updated_by)
       VALUES ($1, $2,
               -- Only FRESH numbers its schedules. For every other ration
               -- type the code IS the type (DRY, MISS_MUSTER_FRESH,
               -- MISS_MUSTER_DRY), which the identity CHECK also requires.
               CASE WHEN $2 = 'FRESH' THEN 'FRESH_' || $3::smallint::text ELSE $2 END,
               $3::smallint, $4::date, $5::date, $6::date[], true, $7, $8, $8)
       RETURNING id`,
      [
        input.periodId,
        input.rationType,
        input.sequenceNo,
        input.startDate,
        input.endDate,
        input.operatingDays,
        input.notes,
        input.staffId,
      ]
    );
    const created = await this.findById(rows[0]!.id);
    if (created === null) {
      throw new Error(`Issue window ${rows[0]!.id} was created but cannot be read back.`);
    }
    return created;
  }

  /**
   * Update the configurable fields. `period_id`, `ration_type`, `window_code`
   * and `sequence_no` are NOT updatable here — a window is that window, and
   * moving one into another slot would rewrite history that the customer was
   * already shown. A different schedule shape is a new window plus the
   * retirement of the old one.
   *
   * COALESCE on each field so an absent field means "leave it alone", which
   * is what a PATCH means; `notes` is handled separately because null there
   * means "clear it".
   */
  async update(windowId: string, input: UpdateIssueWindowInput): Promise<IssueWindowRecord | null> {
    await this.db.query(
      `UPDATE rik.issue_windows
          SET start_date     = coalesce($2::date, start_date),
              end_date       = coalesce($3::date, end_date),
              operating_days = coalesce($4::date[], operating_days),
              notes          = CASE WHEN $5::boolean THEN $6::text ELSE notes END,
              is_active      = coalesce($7::boolean, is_active),
              updated_by     = $8,
              updated_at     = now()
        WHERE id = $1`,
      [
        windowId,
        input.startDate ?? null,
        input.endDate ?? null,
        input.operatingDays ?? null,
        input.notes !== undefined,
        input.notes ?? null,
        input.isActive ?? null,
        input.staffId,
      ]
    );
    return this.findById(windowId);
  }

  /**
   * The revision history of one window, newest first.
   *
   * Read-only, and there is no write method: migration 0047's AFTER trigger
   * writes every row, and the application role holds only SELECT and INSERT
   * on the table while an append-only guard refuses UPDATE and DELETE.
   */
  async listRevisions(windowId: string): Promise<IssueWindowRevisionRecord[]> {
    return this.db.query<IssueWindowRevisionRecord>(
      `SELECT r.id, r.window_id, r.revision_no, r.change_type, r.period_id,
              r.ration_type, r.window_code, r.before_state, r.after_state,
              r.changed_by, u.display_name AS changed_by_name, r.changed_at
         FROM rik.issue_window_revisions r
         LEFT JOIN shared.users u ON u.id = r.changed_by
        WHERE r.window_id = $1
        ORDER BY r.revision_no DESC`,
      [windowId]
    );
  }

  /** Every revision in a period, newest first — the period's schedule history. */
  async listRevisionsByPeriod(periodId: string, limit = 200): Promise<IssueWindowRevisionRecord[]> {
    return this.db.query<IssueWindowRevisionRecord>(
      `SELECT r.id, r.window_id, r.revision_no, r.change_type, r.period_id,
              r.ration_type, r.window_code, r.before_state, r.after_state,
              r.changed_by, u.display_name AS changed_by_name, r.changed_at
         FROM rik.issue_window_revisions r
         LEFT JOIN shared.users u ON u.id = r.changed_by
        WHERE r.period_id = $1
        ORDER BY r.changed_at DESC, r.revision_no DESC
        LIMIT $2`,
      [periodId, limit]
    );
  }
}
