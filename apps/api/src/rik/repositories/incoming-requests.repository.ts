import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Incoming RIK requests (PHASE B).
 *
 * WHAT AN "INCOMING REQUEST" IS, EXACTLY
 *
 * One confirmed selection, for one ration type, that has no issue voucher
 * yet. Not one row per selection: a voucher is unique per
 * (selection_id, ration_type) — migration 0048's constraint, which
 * IssueVouchersRepository.create relies on — so a selection whose Fresh
 * voucher exists and whose Dry voucher does not is HALF done, and the half
 * that remains is what belongs in a work queue. A per-selection row could
 * only have lied in one direction or the other.
 *
 * THIS FILE WRITES NOTHING. There is no INSERT, UPDATE or DELETE here and
 * no transaction. Converting a request into a voucher is
 * RikIssueVoucherService.create's job and stays there — the inbox finds
 * the work, it does not do it, so there is no second creation path to
 * drift out of step with the first or to get the duplicate rule wrong.
 *
 * WHY `rik.provisions` IS JOINED BY ID ALONE, WITH NO ACTIVE/EFFECTIVE FILTER
 *
 * EntitlementConfigRepository filters provisions on `is_active` and the
 * effective-date window, because it is reading the configuration in force
 * for a NEW calculation. This is reading what a customer ALREADY chose. A
 * provision retired last week does not retract a selection confirmed the
 * week before, and filtering it out here would silently drop a line — or a
 * whole request — from the queue, which is the one failure an operational
 * inbox must not have.
 *
 * WHY THE RATION TYPE COMES FROM `provisions.issue_period` AND NOT THE POOL
 *
 * The same distinction RikIssueVoucherService draws: FRESH and DRY here
 * mean the physical issue stream, which is the provision's own
 * `issue_period`, not its pool's `ration_type`. Bread sits in the CEREALS
 * pool (DRY) and is issued FRESH. Grouping by the pool would put bread in
 * the wrong queue.
 *
 * AND WHY THAT MAKES THIS A LIVE READ, NOT A SNAPSHOT READ — A KNOWN LIMIT
 *
 * The voucher service replays the selection's frozen `rule_snapshot`.
 * This reads today's `issue_period` on the chosen provisions instead,
 * because replaying a snapshot per row would mean one full entitlement
 * recalculation for every line of every page. The two agree unless a
 * provision's issue_period was changed after a selection was confirmed.
 * When they disagree the inbox may offer a ration type that creation then
 * declines with NOTHING_TO_ISSUE — a visible, explained refusal, never a
 * wrong voucher, because the snapshot still decides what is issued.
 */

export type RationType = 'FRESH' | 'DRY';
export type FulfillmentMode = 'PICKUP' | 'DELIVERY';
export type DietaryPreference = 'PV' | 'EV' | 'NV';

/** One unit of work: a confirmed selection awaiting one ration type's voucher. */
export interface IncomingRequestRecord {
  selection_id: string;
  reference_number: string | null;
  ration_type: RationType;
  customer_id: string;
  rik_id: string;
  officer_name: string;
  officer_official_name: string | null;
  mobile_number: string;
  quarter_block: string | null;
  quarter_number: string | null;
  landmark: string | null;
  period_id: string;
  period_name: string;
  period_start_date: string;
  period_end_date: string;
  confirmed_at: string | null;
  dietary_preference: DietaryPreference;
  eligible_days: number;
  fulfillment_type: FulfillmentMode | null;
  pickup_location_name: string | null;
  delivery_address: string | null;
  /**
   * True when the SAME selection already has a voucher of the OTHER ration
   * type. The operational meaning is "this officer has been served once
   * already this period" — worth seeing in a queue, and not inferable from
   * the row otherwise, since the issued half is by definition absent here.
   */
  other_type_issued: boolean;
}

/** One chosen provision, as the customer's confirmed selection records it. */
export interface IncomingRequestLineRecord {
  selection_id: string;
  ration_type: RationType;
  pool_code: string;
  pool_name: string;
  pool_unit: string;
  provision_id: string;
  provision_code: string;
  provision_name: string;
  provision_brand: string | null;
  quantity: string;
  unit: string;
  pack_size: string | null;
  pack_unit: string | null;
}

export interface IncomingRequestFilters {
  /** RIK ID, officer name, official name, mobile, or selection reference. */
  q?: string;
  rationType?: RationType;
  fulfillmentMode?: FulfillmentMode;
  periodId?: string;
  /** Inclusive YYYY-MM-DD bounds on the CONFIRMATION date. */
  confirmedFrom?: string;
  confirmedTo?: string;
}

export interface IncomingRequestPageFilters extends IncomingRequestFilters {
  limit: number;
  offset: number;
}

export interface IncomingRequestFilterClause {
  /** Either '' or a complete `AND ...` tail, to append after a fixed WHERE. */
  clause: string;
  params: unknown[];
}

/**
 * Builds the filter tail shared by `search()` and `count()`.
 *
 * ONE BUILDER, TWO CALLERS — the same rule buildVoucherFilterClause was
 * extracted for, and for the same reason: a predicate added to the page
 * query and forgotten in the count query shows a page of rows beside a
 * total that disagrees with it.
 *
 * EVERY PREDICATE REFERENCES ONLY `s.`, `c.` OR `p.`. Those three are in
 * both queries' FROM list. The page query additionally LEFT JOINs the
 * officer's address; a predicate on `a.` would compile there and fail in
 * count(), so do not add one — filter in the CTE or widen both queries.
 *
 * `startIndex` is the number of parameters the caller has already bound,
 * so the clause's placeholders continue the caller's numbering instead of
 * assuming it starts at $1.
 */
export function buildIncomingRequestFilterClause(
  filters: IncomingRequestFilters,
  startIndex = 0
): IncomingRequestFilterClause {
  const where: string[] = [];
  const params: unknown[] = [];
  const next = (): number => startIndex + params.length;

  if (filters.q !== undefined && filters.q.trim() !== '') {
    params.push(`%${filters.q.trim()}%`);
    const n = next();
    where.push(
      `(c.rik_id ILIKE $${n} OR c.name ILIKE $${n} OR c.official_name ILIKE $${n}
          OR c.mobile_number ILIKE $${n} OR s.reference_number ILIKE $${n})`
    );
  }

  for (const [column, value] of [
    ['p.ration_type', filters.rationType],
    ['s.fulfillment_type', filters.fulfillmentMode],
    ['s.period_id', filters.periodId],
  ] as const) {
    if (value !== undefined && value !== '') {
      params.push(value);
      where.push(`${column} = $${next()}`);
    }
  }

  // Inclusive calendar-day bounds. The ::date cast on BOTH sides matters:
  // confirmed_at is timestamptz, so comparing it to a bare '2026-11-10'
  // would drop everything confirmed after midnight on the closing day.
  if (filters.confirmedFrom !== undefined && filters.confirmedFrom !== '') {
    params.push(filters.confirmedFrom);
    where.push(`s.confirmed_at::date >= $${next()}::date`);
  }
  if (filters.confirmedTo !== undefined && filters.confirmedTo !== '') {
    params.push(filters.confirmedTo);
    where.push(`s.confirmed_at::date <= $${next()}::date`);
  }

  return { clause: where.length > 0 ? ` AND ${where.join(' AND ')}` : '', params };
}

/**
 * The work still outstanding, as a set of (selection, ration type) pairs.
 *
 * `NOT EXISTS` against rik.issue_vouchers is the whole definition of
 * "incoming": the moment a voucher is created the pair stops matching and
 * the row leaves the queue, with no status column to keep in step and
 * nothing to mark done. A request cannot be worked twice because, once
 * worked, it is not returned.
 */
const PENDING_CTE = `
  WITH pending AS (
    SELECT i.selection_id,
           pr.issue_period AS ration_type
      FROM rik.entitlement_selection_items i
      JOIN rik.provisions pr               ON pr.id  = i.provision_id
      JOIN rik.entitlement_selections sel  ON sel.id = i.selection_id
     WHERE sel.status = 'CONFIRMED'
       AND i.quantity > 0
       AND NOT EXISTS (
             SELECT 1
               FROM rik.issue_vouchers v
              WHERE v.selection_id = i.selection_id
                AND v.ration_type  = pr.issue_period
           )
     GROUP BY i.selection_id, pr.issue_period
  )`;

/**
 * The FROM list shared by the page and the count, so filters cannot diverge.
 *
 * The address join is INSIDE this shared list rather than only in the page
 * query. A LEFT JOIN LATERAL ... LIMIT 1 cannot add or remove a row, so
 * count() is unaffected by its presence — and keeping one FROM list means a
 * predicate on `a.` compiles in both places instead of passing review in the
 * page query and failing at runtime in the total. An officer with no default
 * address still appears, which is what LEFT makes true.
 *
 * It ends with `WHERE true` so the filter builder's tail can be appended as
 * ` AND ...` without the caller having to know whether it is the first
 * predicate.
 */
const PENDING_FROM = `
    FROM pending p
    JOIN rik.entitlement_selections s  ON s.id   = p.selection_id
    JOIN shared.customers c            ON c.id   = s.customer_id
    JOIN rik.entitlement_periods per   ON per.id = s.period_id
    LEFT JOIN LATERAL (
      SELECT quarter_block, quarter_number, landmark
        FROM shared.customer_addresses
       WHERE customer_id = c.id AND is_default
       LIMIT 1
    ) a ON true
   WHERE true`;

@Injectable()
export class IncomingRequestsRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * One page of outstanding requests, OLDEST CONFIRMATION FIRST.
   *
   * A work queue, so the officer who has waited longest is at the top. The
   * id and ration type break ties so paging is stable when several
   * confirmations share a timestamp — without them, two pages could show
   * the same row and omit another.
   */
  async search(filters: IncomingRequestPageFilters): Promise<IncomingRequestRecord[]> {
    const { clause, params } = buildIncomingRequestFilterClause(filters);
    const all = [...params, filters.limit, filters.offset];
    return this.db.query<IncomingRequestRecord>(
      `${PENDING_CTE}
       SELECT p.selection_id,
              s.reference_number,
              p.ration_type,
              s.customer_id,
              c.rik_id,
              c.name          AS officer_name,
              c.official_name AS officer_official_name,
              c.mobile_number,
              a.quarter_block,
              a.quarter_number,
              a.landmark,
              s.period_id,
              per.name               AS period_name,
              per.start_date::text   AS period_start_date,
              per.end_date::text     AS period_end_date,
              s.confirmed_at::text   AS confirmed_at,
              s.dietary_preference,
              s.eligible_days,
              s.fulfillment_type,
              s.pickup_location_name,
              s.delivery_address,
              EXISTS (
                SELECT 1 FROM rik.issue_vouchers v2
                 WHERE v2.selection_id = p.selection_id
                   AND v2.ration_type <> p.ration_type
              ) AS other_type_issued
         ${PENDING_FROM}${clause}
        ORDER BY s.confirmed_at ASC NULLS LAST, p.selection_id, p.ration_type
        LIMIT $${all.length - 1} OFFSET $${all.length}`,
      all
    );
  }

  async count(filters: IncomingRequestFilters): Promise<number> {
    const { clause, params } = buildIncomingRequestFilterClause(filters);
    const rows = await this.db.query<{ total: string }>(
      `${PENDING_CTE}
       SELECT count(*)::text AS total
         ${PENDING_FROM}${clause}`,
      params
    );
    return Number(rows[0]?.total ?? '0');
  }

  /**
   * The chosen provisions for a page of selections, in ONE round trip.
   *
   * Deliberately not one query per row: a page of 25 requests would
   * otherwise be 26 queries, and the inbox is the screen staff keep open.
   * Lines carry their own ration type so the caller can attach each line to
   * the right request when a selection appears twice on the page — once for
   * Fresh and once for Dry.
   */
  async listLines(selectionIds: readonly string[]): Promise<IncomingRequestLineRecord[]> {
    if (selectionIds.length === 0) return [];
    return this.db.query<IncomingRequestLineRecord>(
      `SELECT i.selection_id,
              pr.issue_period AS ration_type,
              po.code AS pool_code,
              po.name AS pool_name,
              po.unit AS pool_unit,
              i.provision_id,
              pr.code  AS provision_code,
              pr.name  AS provision_name,
              pr.brand AS provision_brand,
              i.quantity::text  AS quantity,
              pr.unit,
              pr.pack_size::text AS pack_size,
              pr.pack_unit
         FROM rik.entitlement_selection_items i
         JOIN rik.provisions pr        ON pr.id = i.provision_id
         JOIN rik.entitlement_pools po ON po.id = i.pool_id
        WHERE i.selection_id = ANY($1::uuid[])
          AND i.quantity > 0
        ORDER BY po.display_order, po.code, pr.display_order, pr.code`,
      [[...selectionIds]]
    );
  }
}
