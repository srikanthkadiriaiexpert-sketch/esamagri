import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { RationType } from './entitlement-config.repository';

/**
 * The two stored eligibility figures — the officer's own, and the facility's
 * view of where they are missing.
 *
 * WHY THIS IS ITS OWN FILE.
 *
 * `rik.customer_period_ration_eligibility` (migration 0066) holds one row per
 * officer per period per ration type, and it is the single source of truth for
 * eligible days. This file is the READ side of that table for screens: the
 * officer's own two figures, and the per-officer gap list RIK staff work from.
 *
 * It writes nothing. There is no write path to eligibility anywhere in the
 * customer-facing API, and this does not add one — figures arrive only through
 * the reviewed Excel import or a recorded manual adjustment.
 *
 * NULL IS RETURNED AS NULL, NEVER COALESCED TO ZERO. "The facility has not
 * published this figure" and "the facility published zero days" are different
 * statements, and nobody — officer or staff member — may be shown one when the
 * other is true. Every query below preserves that distinction end to end.
 *
 * (Historical note: when migration 0066 landed, the entitlement engine still
 * calculated from the single legacy `eligible_days` column, and this file
 * existed to keep the new figures strictly display-only. That condition was
 * lifted when the Fresh/Dry calculation change was approved: the engine now
 * reads both figures through `RikEligibilityService.resolveBasis`, which joins
 * this same table itself. This file is no longer a quarantine — it is simply
 * the read used by screens.)
 */

export interface CustomerEligibilityFigures {
  fresh_eligible_days: number | null;
  dry_eligible_days: number | null;
}

/**
 * One RIK officer's eligibility position for a period, as RIK staff see it.
 *
 * `*_eligible_days` is null for "not published" and 0 for "published zero".
 *
 * `*_in_latest_applied_batch` answers a narrower question, and answers it
 * with a null when it cannot be answered at all:
 *
 *   true   this officer was matched by a row of the most recently APPLIED
 *          Excel batch for that ration type.
 *   false  that batch exists and did NOT contain this officer — the one
 *          case where "absent from the latest upload" is a provable fact.
 *   null   no applied batch exists for that ration type in this period, so
 *          nothing is provable and the screen must fall back to the generic
 *          "eligibility verification required" wording.
 */
export interface OfficerEligibilityGapRow {
  customer_id: string;
  rik_id: string;
  name: string;
  official_name: string | null;
  fresh_eligible_days: number | null;
  dry_eligible_days: number | null;
  fresh_in_latest_applied_batch: boolean | null;
  dry_in_latest_applied_batch: boolean | null;
}

export interface OfficerEligibilityGapTotals {
  /** Every RIK officer on the roll (rik_id present, not deleted). */
  officers: number;
  /** Officers with both figures published and both above zero. */
  complete: number;
  /** Officers with a missing figure or a published zero — the gap population. */
  needsAttention: number;
}

export interface OfficerEligibilityGaps {
  totals: OfficerEligibilityGapTotals;
  rows: OfficerEligibilityGapRow[];
  /**
   * True when `rows` is a prefix of the gap population rather than all of
   * it. The screen says so; the list is never quietly cut short.
   */
  truncated: boolean;
}

/**
 * The gap list is capped so that a period whose sheets have not been
 * uploaded at all cannot try to render every officer on the roll in one
 * response. `truncated` reports when the cap bit.
 */
export const OFFICER_GAP_ROW_LIMIT = 500;

/**
 * Every RIK officer, with the two figures for one period beside them.
 *
 * The officer population is `shared.customers` where `rik_id IS NOT NULL`
 * and the row is not deleted — the same definition the officers module and
 * the import matcher use, so the gap list and the import cannot disagree
 * about who is an officer.
 */
const OFFICER_FIGURES = `
  WITH officers AS (
    SELECT c.id AS customer_id, c.rik_id, c.name, c.official_name
      FROM shared.customers c
     WHERE c.rik_id IS NOT NULL
       AND c.deleted_at IS NULL
  ),
  figures AS (
    SELECT e.customer_id,
           max(e.eligible_days) FILTER (WHERE e.ration_type = 'FRESH') AS fresh_eligible_days,
           max(e.eligible_days) FILTER (WHERE e.ration_type = 'DRY')   AS dry_eligible_days
      FROM rik.customer_period_ration_eligibility e
     WHERE e.period_id = $1
     GROUP BY e.customer_id
  ),
  joined AS (
    SELECT o.customer_id, o.rik_id, o.name, o.official_name,
           f.fresh_eligible_days,
           f.dry_eligible_days
      FROM officers o
      LEFT JOIN figures f ON f.customer_id = o.customer_id
  )`;

/**
 * An officer needs attention when either figure is absent, or either is a
 * published zero. A published zero is a real entitlement and not an error,
 * but it is the kind of figure staff are asked to eyeball before an issue
 * window opens, so it is listed and labelled as published rather than
 * hidden among the complete.
 */
const NEEDS_ATTENTION = `
  (j.fresh_eligible_days IS NULL
   OR j.dry_eligible_days IS NULL
   OR j.fresh_eligible_days = 0
   OR j.dry_eligible_days = 0)`;

@Injectable()
export class CustomerEligibilityFiguresRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Both figures for one officer in one period.
   *
   * ONE ROW OUT, UP TO TWO ROWS IN. The table holds one row per ration type,
   * so the two figures are pivoted here with FILTER rather than fetched as two
   * rows and reassembled in TypeScript — one round trip, and a shape the route
   * can return as it stands.
   *
   * A type with no row comes back as `null`, which is the whole point: the
   * screen says "not yet published" rather than "0 days". The aggregate always
   * produces exactly one row, so an officer with neither figure published gets
   * `{ fresh: null, dry: null }` rather than no row — the caller treats both
   * the same way, and neither is ever coerced to zero.
   */
  async forCustomerPeriod(
    customerId: string,
    periodId: string
  ): Promise<CustomerEligibilityFigures | null> {
    const rows = await this.db.query<CustomerEligibilityFigures>(
      `SELECT max(eligible_days) FILTER (WHERE ration_type = 'FRESH') AS fresh_eligible_days,
              max(eligible_days) FILTER (WHERE ration_type = 'DRY')   AS dry_eligible_days
         FROM rik.customer_period_ration_eligibility
        WHERE customer_id = $1 AND period_id = $2`,
      [customerId, periodId]
    );
    return rows[0] ?? null;
  }

  /**
   * The per-officer eligibility gaps for one period, for the Admin Portal's
   * eligibility panel.
   *
   * THE TOTALS AND THE ROWS COME FROM THE SAME DEFINITION. `joined` is built
   * once and used by both halves, and both halves apply the identical
   * `NEEDS_ATTENTION` predicate, so the count in the panel's heading can
   * never disagree with the list beneath it — a divergence that is easy to
   * introduce by writing the count as a second, similar query.
   *
   * WHAT "ABSENT FROM THE LATEST UPLOAD" IS ALLOWED TO MEAN. The two
   * `*_in_latest_applied_batch` flags are computed only from the most
   * recently APPLIED batch for each ration type. When no such batch exists
   * the flag is NULL rather than false, because an officer cannot be shown
   * as missing from a sheet that was never applied. A PENDING_REVIEW or
   * DISCARDED batch proves nothing either and is not consulted.
   */
  async officerGapsForPeriod(
    periodId: string,
    limit: number = OFFICER_GAP_ROW_LIMIT
  ): Promise<OfficerEligibilityGaps> {
    const [totals] = await this.db.query<{
      officers: number;
      complete: number;
      needs_attention: number;
    }>(
      `${OFFICER_FIGURES}
       SELECT count(*)::int                                       AS officers,
              count(*) FILTER (
                WHERE j.fresh_eligible_days > 0
                  AND j.dry_eligible_days   > 0
              )::int                                              AS complete,
              count(*) FILTER (WHERE ${NEEDS_ATTENTION})::int     AS needs_attention
         FROM joined j`,
      [periodId]
    );

    const rows = await this.db.query<OfficerEligibilityGapRow>(
      `${OFFICER_FIGURES},
       latest_applied AS (
         SELECT DISTINCT ON (b.ration_type) b.ration_type, b.id
           FROM rik.eligibility_import_batches b
          WHERE b.period_id = $1
            AND b.ration_type IS NOT NULL
            AND b.status = 'APPLIED'
          ORDER BY b.ration_type, b.decided_at DESC NULLS LAST, b.uploaded_at DESC
       ),
       in_batch AS (
         SELECT DISTINCT la.ration_type, r.matched_customer_id AS customer_id
           FROM rik.eligibility_import_rows r
           JOIN latest_applied la ON la.id = r.batch_id
          WHERE r.matched_customer_id IS NOT NULL
       )
       SELECT j.customer_id,
              j.rik_id,
              j.name,
              j.official_name,
              j.fresh_eligible_days,
              j.dry_eligible_days,
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM latest_applied WHERE ration_type = 'FRESH')
                  THEN NULL
                ELSE EXISTS (
                  SELECT 1 FROM in_batch b
                   WHERE b.customer_id = j.customer_id AND b.ration_type = 'FRESH'
                )
              END AS fresh_in_latest_applied_batch,
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM latest_applied WHERE ration_type = 'DRY')
                  THEN NULL
                ELSE EXISTS (
                  SELECT 1 FROM in_batch b
                   WHERE b.customer_id = j.customer_id AND b.ration_type = 'DRY'
                )
              END AS dry_in_latest_applied_batch
         FROM joined j
        WHERE ${NEEDS_ATTENTION}
        ORDER BY j.rik_id
        LIMIT $2`,
      [periodId, limit]
    );

    const needsAttention = totals?.needs_attention ?? 0;
    return {
      totals: {
        officers: totals?.officers ?? 0,
        complete: totals?.complete ?? 0,
        needsAttention,
      },
      rows,
      truncated: rows.length < needsAttention,
    };
  }
}

/**
 * The derived verification status of one officer for one ration type.
 *
 * DERIVED, NOT STORED. Nothing in the database records "verified" — this is
 * read off the figure that is there, plus the import history, exactly as
 * approved. No column was added and no migration was needed.
 *
 * Kept here, beside the query that feeds it, and exported as a pure function
 * so the Admin Portal and any test can agree on the labels without either
 * reimplementing the rule.
 */
export type EligibilityVerificationStatus =
  | 'PUBLISHED'
  | 'PUBLISHED_ZERO'
  | 'MISSING_PROVEN_ABSENT'
  | 'MISSING';

export function verificationStatusFor(
  row: Pick<
    OfficerEligibilityGapRow,
    | 'fresh_eligible_days'
    | 'dry_eligible_days'
    | 'fresh_in_latest_applied_batch'
    | 'dry_in_latest_applied_batch'
  >,
  rationType: RationType
): EligibilityVerificationStatus {
  const days = rationType === 'FRESH' ? row.fresh_eligible_days : row.dry_eligible_days;
  const inLatest =
    rationType === 'FRESH' ? row.fresh_in_latest_applied_batch : row.dry_in_latest_applied_batch;

  if (days === null) {
    // Only a batch that exists and did not match this officer proves
    // absence. A null flag means no applied sheet to be absent from.
    return inLatest === false ? 'MISSING_PROVEN_ABSENT' : 'MISSING';
  }
  return days === 0 ? 'PUBLISHED_ZERO' : 'PUBLISHED';
}
