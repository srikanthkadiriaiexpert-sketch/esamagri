import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { EligibilityRationType } from '../dto/rik-eligibility.dto';

/**
 * Eligibility imports and the eligible-day ledger (STEP 15B Phase B).
 *
 * RECONSTRUCTED from the approved Phase B report after the working container
 * was lost. `applyBatch` below is the one method recovered VERBATIM from the
 * session transcript; the rest is a reconstruction from the report and from
 * the field names the recovered controller reads.
 *
 * THE ONE RULE THIS FILE OBEYS ABOVE ALL OTHERS
 *
 * It never updates rik.customer_period_eligibility. Not once. An officer's
 * eligible days move only because this repository INSERTED a row into
 * rik.eligibility_adjustments and migration 0045's trigger applied it. The
 * database refuses any other path, so this is not a convention that could
 * drift — it is the only path that works.
 *
 * STEP 16 / MIGRATION 0066 — A SECOND TABLE, AND THE FIRST ONE LEFT ALONE.
 *
 * Fresh and Dry eligible days live in their own table,
 * `rik.customer_period_ration_eligibility`, one row per officer per period
 * per ration type.
 *
 * WHY A SEPARATE TABLE RATHER THAN TWO MORE COLUMNS. The engine reads
 * eligibility through exactly one query, which selects
 * `customer_period_eligibility.eligible_days` and takes the first row. Adding
 * a ration type as ROWS there would have made that query return two rows and
 * pick one of them arbitrarily. Adding it as COLUMNS would have worked, but
 * writing a Fresh figure for an officer who has no legacy row at all means
 * INSERTING one, and `eligible_days` is NOT NULL with no default — so such an
 * insert would have had to invent a legacy figure of 0, which the engine
 * reads. A table of its own has no legacy column to satisfy.
 *
 * So `rik.customer_period_eligibility` IS NOT TOUCHED BY MIGRATION 0066 AT
 * ALL — no new column, no new constraint, no new trigger — and it keeps
 * driving the entitlement engine exactly as it did before. The two new
 * figures are stored, audited and displayed only. Nothing in this file reads
 * or writes the legacy column except `eligibilityForOfficer`, which reports
 * all three side by side because staff need to see them together.
 *
 * THE WRITE RULE HOLDS FOR THE NEW TABLE TOO. A Fresh or Dry figure moves
 * only because an adjustment row carrying `ration_type` was inserted here and
 * migration 0066's branch of the apply trigger wrote it. A `ration_type` of
 * NULL on an adjustment still means the legacy column and still behaves
 * exactly as it did before 0066.
 */

export interface ImportBatchRecord {
  id: string;
  batch_ref: string;
  period_id: string;
  period_name: string;
  /** NULL on a batch uploaded before migration 0066. */
  ration_type: EligibilityRationType | null;
  file_name: string;
  file_hash: string;
  file_size_bytes: string;
  status: 'PENDING_REVIEW' | 'APPLIED' | 'DISCARDED';
  total_rows: number;
  matched_changed: number;
  matched_no_change: number;
  exception_rows: number;
  applied_rows: number;
  uploaded_by: string;
  uploaded_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

export type RowOutcome =
  | 'MATCHED_CHANGED'
  | 'MATCHED_NO_CHANGE'
  | 'UNMATCHED_MOBILE_NOT_FOUND'
  | 'NAME_MISMATCH'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID_MOBILE'
  | 'INVALID_ELIGIBLE_DAYS'
  | 'MISSING_FIELD';

export interface ImportRowRecord {
  id: string;
  sheet_row: number;
  raw_name: string;
  raw_mobile: string;
  raw_eligible_days: string;
  normalised_mobile: string | null;
  matched_customer_id: string | null;
  matched_rik_id: string | null;
  system_name: string | null;
  system_official_name: string | null;
  previous_eligible_days: number | null;
  imported_eligible_days: number | null;
  delta: number | null;
  outcome: RowOutcome;
  exception_reason: string | null;
}

/** One row as the mapping stage produced it, before it is written. */
export interface PreparedRow {
  sheetRow: number;
  rawName: string;
  rawMobile: string;
  rawEligibleDays: string;
  normalisedMobile: string | null;
  matchedCustomerId: string | null;
  matchedRikId: string | null;
  systemName: string | null;
  systemOfficialName: string | null;
  previousEligibleDays: number | null;
  importedEligibleDays: number | null;
  delta: number | null;
  outcome: RowOutcome;
  exceptionReason: string | null;
}

export interface AdjustmentRecord {
  id: string;
  customer_id: string;
  period_id: string;
  period_name: string;
  /** NULL means this adjustment moved the legacy `eligible_days` column. */
  ration_type: EligibilityRationType | null;
  previous_eligible_days: number;
  delta: number;
  new_eligible_days: number;
  reason: string;
  source: 'IMPORT' | 'MANUAL';
  batch_ref: string | null;
  staff_id: string;
  staff_name: string | null;
  created_at: string;
}

export interface OfficerCandidate {
  customer_id: string;
  rik_id: string;
  name: string;
  official_name: string | null;
  mobile_number: string;
}

export interface OfficerPeriodEligibility {
  period_id: string;
  period_name: string;
  /**
   * The ORIGINAL figure, still the one the entitlement engine reads.
   *
   * NULL when the officer has no legacy eligibility row for this period at
   * all — which is a state Option A deliberately supports: a Fresh or Dry
   * figure can be published for an officer who has never had a legacy figure.
   * The column is NOT NULL; the ROW may be absent.
   */
  eligible_days: number | null;
  /** NULL until a Fresh sheet has been applied to this period (0066). */
  fresh_eligible_days: number | null;
  /** NULL until a Dry sheet has been applied to this period (0066). */
  dry_eligible_days: number | null;
  updated_at: string;
}

/**
 * Whether each of a period's two figures has been published yet, and by which
 * batch. Drives the per-type upload status panel, so that a period with Fresh
 * done and Dry outstanding says so instead of looking finished.
 */
export interface PeriodUploadStatus {
  ration_type: EligibilityRationType;
  batch_id: string | null;
  batch_ref: string | null;
  status: 'PENDING_REVIEW' | 'APPLIED' | 'DISCARDED' | null;
  total_rows: number | null;
  matched_changed: number | null;
  matched_no_change: number | null;
  exception_rows: number | null;
  applied_rows: number | null;
  uploaded_at: string | null;
  decided_at: string | null;
  officers_with_value: number;
}

const BATCH_SELECT = `
  SELECT b.id, b.batch_ref, b.period_id, p.name AS period_name, b.ration_type,
         b.file_name, b.file_hash, b.file_size_bytes::text AS file_size_bytes,
         b.status, b.total_rows, b.matched_changed, b.matched_no_change,
         b.exception_rows, b.applied_rows,
         b.uploaded_by, b.uploaded_at, b.decided_by, b.decided_at
    FROM rik.eligibility_import_batches b
    JOIN rik.entitlement_periods p ON p.id = b.period_id`;

const ADJUSTMENT_SELECT = `
  SELECT a.id, a.customer_id, a.period_id, p.name AS period_name, a.ration_type,
         a.previous_eligible_days, a.delta, a.new_eligible_days,
         a.reason, a.source, b.batch_ref,
         a.staff_id, u.display_name AS staff_name, a.created_at
    FROM rik.eligibility_adjustments a
    LEFT JOIN rik.entitlement_periods p ON p.id = a.period_id
    LEFT JOIN rik.eligibility_import_rows r ON r.id = a.import_row_id
    LEFT JOIN rik.eligibility_import_batches b ON b.id = r.batch_id
    LEFT JOIN shared.users u ON u.id = a.staff_id`;

/**
 * The Fresh/Dry eligibility table (migration 0066).
 *
 * Named once, here, so a reader can see at a glance which statements in this
 * file touch the new table and which touch the legacy one.
 *
 * Note what the ration type is now: a BOUND PARAMETER in an ordinary WHERE
 * clause. The columns-based design needed a column-name whitelist because a
 * column name cannot be a parameter in PostgreSQL; a table keyed by ration
 * type needs no such thing, and the whitelist is gone.
 */
const RATION_ELIGIBILITY = 'rik.customer_period_ration_eligibility';

@Injectable()
export class EligibilityImportRepository {
  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------- mapping reads

  /**
   * Every live officer holding any of these normalised mobile numbers.
   *
   * One query for the whole sheet rather than one per row: a 500-row upload
   * must not be 500 round trips. Soft-deleted officers are excluded — an
   * import must not resurrect one — and the service refuses a number that
   * resolves to more than one officer rather than choosing.
   *
   * THE MATCH IS BY WHOLE STRING, NOT BY STRIPPING A PREFIX IN SQL. An
   * earlier draft compared
   *
   *     regexp_replace(c.mobile_number, '^\+?91', '') = ANY($1)
   *
   * which silently mangles every perfectly ordinary number that BEGINS 91 —
   * 9150150010 became 50150010 and matched nobody. Both stored forms are
   * matched explicitly instead, and the authoritative normalisation stays in
   * the one TypeScript function that registration also uses.
   *
   * `rik_id IS NOT NULL` IS WHAT MAKES THIS "OFFICERS" RATHER THAN "CUSTOMERS",
   * AND IT HAS TO BE SAID OUT LOUD NOW.
   *
   * Until migration 0065, shared.customers.rik_id was NOT NULL: every customer
   * row was an officer row, so a query over shared.customers WAS a query over
   * officers and the predicate would have been noise. Migration 0065 made the
   * column nullable so that a PIF-only resident can exist, and that silently
   * changed what this query means — it began returning residents who hold no
   * RIK ID at all.
   *
   * Two things would then go wrong, and the second is why this is a defect
   * rather than a cosmetic slip:
   *
   *   * the row's matched_rik_id would be NULL on a MATCHED outcome, which
   *     rik_elig_rows_matched_chk forbids, so the ENTIRE upload would fail with
   *     a raw check_violation instead of reporting one clean exception row;
   *   * and had that constraint not existed, a spreadsheet would have been able
   *     to grant RIK eligibility to someone the facility never approved for
   *     rations — by nothing more than their mobile number appearing in it.
   *
   * A PIF-only resident is therefore not a candidate. Their row reports
   * UNMATCHED_MOBILE_NOT_FOUND, which is the truth: no OFFICER holds that
   * number. Becoming an officer happens in one place only — the officer
   * registration workflow, where a human with `rik.entitlement.allocate`
   * approves it — and never as a side effect of an import.
   */
  async findCandidatesByMobile(mobiles: string[]): Promise<OfficerCandidate[]> {
    if (mobiles.length === 0) return [];
    const withCountryCode = mobiles.map((m) => `+91${m}`);
    const withTrunk = mobiles.map((m) => `91${m}`);
    return this.db.query<OfficerCandidate>(
      `SELECT c.id AS customer_id, c.rik_id, c.name, c.official_name, c.mobile_number
         FROM shared.customers c
        WHERE c.deleted_at IS NULL
          AND c.rik_id IS NOT NULL
          AND (c.mobile_number = ANY($1::text[])
            OR c.mobile_number = ANY($2::text[])
            OR c.mobile_number = ANY($3::text[]))`,
      [mobiles, withCountryCode, withTrunk]
    );
  }

  /**
   * The current eligible days for these officers in one period, as a map, for
   * ONE ration type.
   *
   * Reads the NEW table only. The legacy `eligible_days` column is not
   * consulted and must not be: a Fresh sheet is compared against the Fresh
   * figure, and the legacy figure is a third, separate number that the
   * entitlement engine owns.
   *
   * AN OFFICER WITH NO ROW IS ABSENT FROM THE MAP, and the caller treats that
   * as 0 for the delta — the same `?? 0` the caller has always applied, so the
   * delta arithmetic, the 0045 shape CHECK on a matched row and the apply
   * trigger's stale-previous-value guard all keep working unchanged.
   *
   * The distinction a human needs is preserved where it belongs: the
   * officer-facing read and the admin status panel look for the row itself, so
   * a missing figure still reports as "not yet published" rather than as
   * "0 days".
   *
   * One consequence, stated rather than hidden: a sheet that gives an officer
   * 0 days when no figure has ever been published computes a delta of 0, so
   * the row reports MATCHED_NO_CHANGE and no row is created — the officer
   * still reads as "not yet published". Publishing a 0 for someone who has
   * never had a figure needs the single-officer adjustment path, which records
   * a reason. That is deliberate: `rik_elig_adj_values_chk` refuses a delta of
   * zero, so an import cannot record a change that changes nothing.
   */
  async currentEligibleDays(
    periodId: string,
    customerIds: string[],
    rationType?: EligibilityRationType
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (customerIds.length === 0) return map;

    // NO RATION TYPE MEANS THE LEGACY FIGURE, and this is the ORIGINAL query,
    // restored unchanged. The single-officer adjustment screen still corrects
    // `customer_period_eligibility.eligible_days` — the figure the entitlement
    // engine reads — and that has to keep working exactly as it did, so the
    // statement it depends on is the same statement, not a reimplementation.
    const rows =
      rationType === undefined
        ? await this.db.query<{ customer_id: string; eligible_days: number }>(
            `SELECT customer_id, eligible_days
               FROM rik.customer_period_eligibility
              WHERE period_id = $1 AND customer_id = ANY($2::uuid[])`,
            [periodId, customerIds]
          )
        : await this.db.query<{ customer_id: string; eligible_days: number }>(
            `SELECT customer_id, eligible_days
               FROM ${RATION_ELIGIBILITY}
              WHERE period_id = $1
                AND ration_type = $2
                AND customer_id = ANY($3::uuid[])`,
            [periodId, rationType, customerIds]
          );

    for (const row of rows) map.set(row.customer_id, row.eligible_days);
    return map;
  }

  /**
   * Per-type upload status for one period.
   *
   * Two rows, always — one for FRESH and one for DRY — whether or not a sheet
   * has been uploaded for either. A type with nothing uploaded comes back with
   * nulls and `officers_with_value = 0`, which is what lets the screen say
   * "not uploaded" instead of rendering an empty panel that looks like a
   * loading failure.
   *
   * The batch reported per type is the most recent APPLIED one, falling back
   * to the most recent of any status, so a pending review is visible too.
   */
  async uploadStatusForPeriod(periodId: string): Promise<PeriodUploadStatus[]> {
    return this.db.query<PeriodUploadStatus>(
      `WITH types(ration_type) AS (VALUES ('FRESH'), ('DRY')),
            latest AS (
              SELECT DISTINCT ON (b.ration_type)
                     b.ration_type, b.id, b.batch_ref, b.status,
                     b.total_rows, b.matched_changed, b.matched_no_change,
                     b.exception_rows, b.applied_rows, b.uploaded_at, b.decided_at
                FROM rik.eligibility_import_batches b
               WHERE b.period_id = $1 AND b.ration_type IS NOT NULL
               ORDER BY b.ration_type,
                        (b.status = 'APPLIED') DESC,
                        b.uploaded_at DESC
            ),
            counts AS (
              SELECT e.ration_type, count(*)::int AS n
                FROM ${RATION_ELIGIBILITY} e
               WHERE e.period_id = $1
               GROUP BY e.ration_type
            )
       SELECT t.ration_type,
              l.id          AS batch_id,
              l.batch_ref,
              l.status,
              l.total_rows,
              l.matched_changed,
              l.matched_no_change,
              l.exception_rows,
              l.applied_rows,
              l.uploaded_at,
              l.decided_at,
              COALESCE(c.n, 0) AS officers_with_value
         FROM types t
         LEFT JOIN counts c ON c.ration_type = t.ration_type
         LEFT JOIN latest l ON l.ration_type = t.ration_type
        ORDER BY t.ration_type DESC`,
      [periodId]
    );
  }

  // ------------------------------------------------------------------ batches

  /**
   * Record the batch and every one of its rows in ONE transaction.
   *
   * A batch whose rows did not all land would present a preview that is not
   * the sheet, so either the whole upload is on record or none of it is. The
   * batch reference is drawn inside the transaction too, so a failed upload
   * does not leave a gap in the sequence that looks like a deleted batch.
   */
  async createBatch(input: {
    periodId: string;
    rationType: EligibilityRationType;
    fileName: string;
    fileHash: string;
    fileSizeBytes: number;
    uploadedBy: string;
    rows: PreparedRow[];
  }): Promise<string> {
    return this.db.withTransaction(async (client) => {
      const counts = input.rows.reduce(
        (acc, r) => {
          if (r.outcome === 'MATCHED_CHANGED') acc.changed += 1;
          else if (r.outcome === 'MATCHED_NO_CHANGE') acc.noChange += 1;
          else acc.exceptions += 1;
          return acc;
        },
        { changed: 0, noChange: 0, exceptions: 0 }
      );

      const batch = await client.query<{ id: string }>(
        `INSERT INTO rik.eligibility_import_batches
           (batch_ref, period_id, ration_type, file_name, file_hash, file_size_bytes,
            status, total_rows, matched_changed, matched_no_change, exception_rows,
            applied_rows, uploaded_by)
         VALUES (rik.format_import_batch_ref(nextval('rik.eligibility_import_seq'),
                                             extract(year from now())::integer),
                 $1, $2, $3, $4, $5, 'PENDING_REVIEW', $6, $7, $8, $9, 0, $10)
         RETURNING id`,
        [
          input.periodId,
          input.rationType,
          input.fileName,
          input.fileHash,
          input.fileSizeBytes,
          input.rows.length,
          counts.changed,
          counts.noChange,
          counts.exceptions,
          input.uploadedBy,
        ]
      );
      const batchId = batch.rows[0]!.id;

      for (const row of input.rows) {
        await client.query(
          `INSERT INTO rik.eligibility_import_rows
             (batch_id, sheet_row, raw_name, raw_mobile, raw_eligible_days,
              normalised_mobile, matched_customer_id, matched_rik_id,
              system_name, system_official_name, previous_eligible_days,
              imported_eligible_days, delta, outcome, exception_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            batchId,
            row.sheetRow,
            row.rawName,
            row.rawMobile,
            row.rawEligibleDays,
            row.normalisedMobile,
            row.matchedCustomerId,
            row.matchedRikId,
            row.systemName,
            row.systemOfficialName,
            row.previousEligibleDays,
            row.importedEligibleDays,
            row.delta,
            row.outcome,
            row.exceptionReason,
          ]
        );
      }

      return batchId;
    });
  }

  async findBatch(batchId: string): Promise<ImportBatchRecord | null> {
    const rows = await this.db.query<ImportBatchRecord>(`${BATCH_SELECT} WHERE b.id = $1`, [
      batchId,
    ]);
    return rows[0] ?? null;
  }

  async listBatches(limit = 25): Promise<ImportBatchRecord[]> {
    return this.db.query<ImportBatchRecord>(
      `${BATCH_SELECT} ORDER BY b.uploaded_at DESC LIMIT $1`,
      [limit]
    );
  }

  async listRows(batchId: string): Promise<ImportRowRecord[]> {
    return this.db.query<ImportRowRecord>(
      `SELECT id, sheet_row, raw_name, raw_mobile, raw_eligible_days,
              normalised_mobile, matched_customer_id, matched_rik_id,
              system_name, system_official_name, previous_eligible_days,
              imported_eligible_days, delta, outcome, exception_reason
         FROM rik.eligibility_import_rows
        WHERE batch_id = $1
        ORDER BY sheet_row`,
      [batchId]
    );
  }

  /**
   * Apply every changed row of a PENDING_REVIEW batch, in one transaction.
   *
   * IDEMPOTENCY is structural, not a check that could be forgotten. The batch
   * is moved out of PENDING_REVIEW by an UPDATE whose WHERE still says
   * PENDING_REVIEW, inside the same transaction that writes the adjustments.
   * A second confirmation — a double-click, a retry, two administrators —
   * finds no pending batch, updates nothing, and returns null. The caller
   * then shows the batch as it already stands rather than applying it twice.
   *
   * Rows with outcome MATCHED_NO_CHANGE are deliberately not adjusted: a
   * delta of zero is not a change, and migration 0045 refuses to record one.
   * Exception rows are not applied at all — that is the whole point of them.
   */
  async applyBatch(
    batchId: string,
    staffId: string
  ): Promise<{ appliedRows: number; batch: ImportBatchRecord } | null> {
    const applied = await this.db.withTransaction(async (client) => {
      const claim = await client.query<{ id: string; batch_ref: string }>(
        `UPDATE rik.eligibility_import_batches
            SET status = 'APPLIED', decided_by = $2, decided_at = now()
          WHERE id = $1 AND status = 'PENDING_REVIEW'
          RETURNING id, batch_ref`,
        [batchId, staffId]
      );
      if (claim.rows.length === 0) return null;
      const batchRef = claim.rows[0]!.batch_ref;

      const rows = await client.query<{
        id: string;
        matched_customer_id: string;
        previous_eligible_days: number;
        imported_eligible_days: number;
        delta: number;
      }>(
        `SELECT r.id, r.matched_customer_id, r.previous_eligible_days,
                r.imported_eligible_days, r.delta
           FROM rik.eligibility_import_rows r
          WHERE r.batch_id = $1 AND r.outcome = 'MATCHED_CHANGED'
          ORDER BY r.sheet_row`,
        // No row lock, deliberately. The claiming UPDATE above holds the
        // batch row for the whole transaction, so a second confirmation is
        // already serialised behind it and finds nothing pending. An import
        // row is also immutable in its own right — migration 0045 leaves
        // app_rik with INSERT and SELECT on the table and nothing else — so
        // there is no writer to lock against, and asking for FOR UPDATE would
        // require the very privilege that was removed to keep it immutable.
        [batchId]
      );

      // The ration type is read from the BATCH, never passed in by the
      // caller. A batch is the sheet plus the decision the administrator made
      // when they uploaded it; taking the type from anywhere else would allow
      // a Fresh sheet to be confirmed against the Dry figure between upload
      // and confirm, which is precisely the mix-up the two buttons exist to
      // prevent.
      const periodRow = await client.query<{
        period_id: string;
        ration_type: EligibilityRationType | null;
      }>(`SELECT period_id, ration_type FROM rik.eligibility_import_batches WHERE id = $1`, [
        batchId,
      ]);
      const periodId = periodRow.rows[0]!.period_id;
      const rationType = periodRow.rows[0]!.ration_type;

      let count = 0;
      for (const row of rows.rows) {
        // Inserting the adjustment is what MOVES the value: migration 0045's
        // trigger applies it and refuses a stale previous value, so a batch
        // prepared against figures that have since changed fails here rather
        // than overwriting someone else's correction. Migration 0066 adds the
        // branch that routes a FRESH or DRY adjustment to its own column; a
        // NULL ration_type keeps the original behaviour exactly.
        await client.query(
          `INSERT INTO rik.eligibility_adjustments
             (customer_id, period_id, ration_type, previous_eligible_days, delta,
              new_eligible_days, reason, source, import_row_id, staff_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'IMPORT', $8, $9)`,
          [
            row.matched_customer_id,
            periodId,
            rationType,
            row.previous_eligible_days,
            row.delta,
            row.imported_eligible_days,
            `Eligibility import ${batchRef}`,
            row.id,
            staffId,
          ]
        );
        count += 1;
      }

      await client.query(`UPDATE rik.eligibility_import_batches SET applied_rows = $2 WHERE id = $1`, [
        batchId,
        count,
      ]);

      return count;
    });

    if (applied === null) return null;
    const batch = await this.findBatch(batchId);
    return { appliedRows: applied, batch: batch! };
  }

  /**
   * Discard a reviewed batch. A STATUS, never a deletion: the sheet, its
   * rows and the decision stay on record (migration 0046 removes the
   * application's DELETE privilege entirely).
   */
  async discardBatch(batchId: string, staffId: string): Promise<ImportBatchRecord | null> {
    const claim = await this.db.query<{ id: string }>(
      `UPDATE rik.eligibility_import_batches
          SET status = 'DISCARDED', decided_by = $2, decided_at = now()
        WHERE id = $1 AND status = 'PENDING_REVIEW'
        RETURNING id`,
      [batchId, staffId]
    );
    if (claim.length === 0) return null;
    return this.findBatch(batchId);
  }

  // ------------------------------------------------------------------ ledger

  /**
   * The manual adjustment path. One INSERT — the trigger does the rest.
   */
  /**
   * `rationType` is OPTIONAL and `undefined` is written as SQL NULL, which is
   * what makes migration 0066's legacy trigger branch run. A legacy
   * adjustment is therefore byte-for-byte the row this method always wrote,
   * with one extra column holding NULL.
   */
  async insertAdjustment(input: {
    customerId: string;
    periodId: string;
    rationType?: EligibilityRationType;
    previous: number;
    delta: number;
    next: number;
    reason: string;
    staffId: string;
  }): Promise<string> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO rik.eligibility_adjustments
         (customer_id, period_id, ration_type, previous_eligible_days, delta,
          new_eligible_days, reason, source, staff_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'MANUAL', $8)
       RETURNING id`,
      [
        input.customerId,
        input.periodId,
        input.rationType ?? null,
        input.previous,
        input.delta,
        input.next,
        input.reason,
        input.staffId,
      ]
    );
    return rows[0]!.id;
  }

  async listAdjustments(customerId: string): Promise<AdjustmentRecord[]> {
    return this.db.query<AdjustmentRecord>(
      `${ADJUSTMENT_SELECT} WHERE a.customer_id = $1 ORDER BY a.created_at DESC`,
      [customerId]
    );
  }

  /**
   * Every period's eligibility for one officer, as staff read it.
   *
   * All three figures travel: the legacy `eligible_days` that still drives the
   * entitlement engine, and the two new ones. A staff member looking at an
   * officer needs to see all three, because until the engine change is
   * approved they can differ, and a screen that showed only two of them would
   * make that difference invisible.
   */
  async eligibilityForOfficer(customerId: string): Promise<OfficerPeriodEligibility[]> {
    // A FULL OUTER JOIN over the two tables, keyed by period, because an
    // officer may legitimately appear in either one alone:
    //
    //   * a legacy row with no Fresh or Dry figure yet — every officer today;
    //   * a Fresh or Dry figure with NO legacy row at all, which is exactly
    //     the case Option A exists to support and which an inner or left join
    //     from the legacy table would silently hide.
    //
    // `eligible_days` is reported as NULL when there is no legacy row. The
    // interface types it `number | null` for that reason: the column itself is
    // NOT NULL, but the ROW may not exist.
    return this.db.query<OfficerPeriodEligibility>(
      `WITH legacy AS (
         SELECT period_id, eligible_days, updated_at
           FROM rik.customer_period_eligibility
          WHERE customer_id = $1
       ),
       by_type AS (
         SELECT period_id,
                max(eligible_days) FILTER (WHERE ration_type = 'FRESH') AS fresh_eligible_days,
                max(eligible_days) FILTER (WHERE ration_type = 'DRY')   AS dry_eligible_days,
                max(updated_at)                                          AS updated_at
           FROM ${RATION_ELIGIBILITY}
          WHERE customer_id = $1
          GROUP BY period_id
       )
       SELECT COALESCE(l.period_id, t.period_id)      AS period_id,
              p.name                                   AS period_name,
              l.eligible_days,
              t.fresh_eligible_days,
              t.dry_eligible_days,
              GREATEST(COALESCE(l.updated_at, t.updated_at),
                       COALESCE(t.updated_at, l.updated_at)) AS updated_at
         FROM legacy l
         FULL OUTER JOIN by_type t ON t.period_id = l.period_id
         JOIN rik.entitlement_periods p ON p.id = COALESCE(l.period_id, t.period_id)
        ORDER BY p.start_date DESC`,
      [customerId]
    );
  }
}
