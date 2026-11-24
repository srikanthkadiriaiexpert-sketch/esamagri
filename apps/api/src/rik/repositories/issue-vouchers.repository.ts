import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/**
 * Issue vouchers (PHASE D).
 *
 * THE ONLY TABLE THIS FILE WRITES IS rik.issue_vouchers, AND ONLY BY INSERT.
 *
 * That is not a convention here, it is the privilege the application holds:
 * migration 0048 grants app_rik SELECT and INSERT and revokes UPDATE and
 * DELETE. So nothing in this repository can advance a voucher through its
 * lifecycle, mark a ration collected or delivered, or rewrite a snapshot —
 * the fulfilment phase grants UPDATE when it implements those transitions.
 *
 * It also touches no eligibility row, no entitlement ledger and no confirmed
 * selection. Creating a voucher consumes nothing.
 */

export type RationType = 'FRESH' | 'DRY';
export type FulfillmentMode = 'PICKUP' | 'DELIVERY';

export type VoucherStatus =
  | 'READY_FOR_PICKUP'
  | 'COLLECTED'
  | 'NOT_COLLECTED'
  | 'READY_FOR_DELIVERY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NOT_DELIVERED';

/** One voucher row, joined to the officer and period a reader needs. */
export interface IssueVoucherRecord {
  id: string;
  voucher_number: string;
  selection_id: string;
  selection_reference: string | null;
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
  ration_type: RationType;
  fulfillment_mode: FulfillmentMode;
  pickup_location_id: string | null;
  pickup_location_name: string | null;
  delivery_address: string | null;
  status: VoucherStatus;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
  released_at: string;
  released_by: string;
  updated_at: string;
}

export interface CreateVoucherInput {
  selectionId: string;
  customerId: string;
  periodId: string;
  rationType: RationType;
  fulfillmentMode: FulfillmentMode;
  pickupLocationId: string | null;
  pickupLocationName: string | null;
  deliveryAddress: string | null;
  status: VoucherStatus;
  staffId: string;
}

export interface VoucherSearchFilters {
  q?: string;
  rationType?: RationType;
  fulfillmentMode?: FulfillmentMode;
  status?: VoucherStatus;
  periodId?: string;
  /** Inclusive YYYY-MM-DD bounds on the voucher's issue date (v.created_at). */
  issuedFrom?: string;
  issuedTo?: string;
  limit: number;
  offset: number;
}

export type VoucherCountFilters = Omit<VoucherSearchFilters, 'limit' | 'offset'>;

export interface VoucherFilterClause {
  /** Either '' or a complete `WHERE ...` clause. */
  clause: string;
  /** Positional parameters, in the order the clause references them. */
  params: unknown[];
}

/**
 * Builds the WHERE clause shared by `search()` and `count()`.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT INLINE IN BOTH. It was inline in both,
 * and the two copies had already drifted: `search()` and `count()` each built
 * the same predicates separately, so a filter added to one and forgotten in the
 * other would return a page of rows with a total that disagreed with it. The
 * date range added here would have been exactly that bug. One builder, two
 * callers, and the total cannot disagree with the page again.
 *
 * It is also testable without a database, which is the only way the date
 * predicates can be checked at all while no test database exists.
 *
 * Every predicate references only v., c. or s. — never p., a. or u. — because
 * `count()` joins fewer tables than `VOUCHER_SELECT` does. Adding a predicate
 * on a period or address column here would break the count query, so don't.
 */
export function buildVoucherFilterClause(filters: VoucherCountFilters): VoucherFilterClause {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.q !== undefined && filters.q.trim() !== '') {
    params.push(`%${filters.q.trim()}%`);
    const n = params.length;
    where.push(
      `(v.voucher_number ILIKE $${n} OR c.rik_id ILIKE $${n} OR c.name ILIKE $${n}
          OR c.official_name ILIKE $${n} OR c.mobile_number ILIKE $${n}
          OR s.reference_number ILIKE $${n})`
    );
  }

  for (const [column, value] of [
    ['v.ration_type', filters.rationType],
    ['v.fulfillment_mode', filters.fulfillmentMode],
    ['v.status', filters.status],
    ['v.period_id', filters.periodId],
  ] as const) {
    if (value !== undefined) {
      params.push(value);
      where.push(`${column} = $${params.length}`);
    }
  }

  // Inclusive calendar-day bounds. The ::date cast on BOTH sides is the whole
  // point: created_at is timestamptz, so comparing it directly to '2026-11-10'
  // would silently drop every voucher issued after midnight on the closing day.
  if (filters.issuedFrom !== undefined && filters.issuedFrom !== '') {
    params.push(filters.issuedFrom);
    where.push(`v.created_at::date >= $${params.length}::date`);
  }
  if (filters.issuedTo !== undefined && filters.issuedTo !== '') {
    params.push(filters.issuedTo);
    where.push(`v.created_at::date <= $${params.length}::date`);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

const VOUCHER_SELECT = `
  SELECT v.id,
         v.voucher_number,
         v.selection_id,
         s.reference_number AS selection_reference,
         v.customer_id,
         c.rik_id,
         c.name          AS officer_name,
         c.official_name AS officer_official_name,
         c.mobile_number,
         a.quarter_block,
         a.quarter_number,
         a.landmark,
         v.period_id,
         p.name                 AS period_name,
         p.start_date::text     AS period_start_date,
         p.end_date::text       AS period_end_date,
         v.ration_type,
         v.fulfillment_mode,
         v.pickup_location_id,
         v.pickup_location_name,
         v.delivery_address,
         v.status,
         v.created_at,
         v.created_by,
         u.display_name AS created_by_name,
         v.released_at,
         v.released_by,
         v.updated_at
    FROM rik.issue_vouchers v
    JOIN rik.entitlement_selections s ON s.id = v.selection_id
    JOIN shared.customers c ON c.id = v.customer_id
    JOIN rik.entitlement_periods p ON p.id = v.period_id
    LEFT JOIN shared.customer_addresses a ON a.customer_id = c.id AND a.is_default
    LEFT JOIN shared.users u ON u.id = v.created_by`;

@Injectable()
export class IssueVouchersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(voucherId: string): Promise<IssueVoucherRecord | null> {
    const rows = await this.db.query<IssueVoucherRecord>(`${VOUCHER_SELECT} WHERE v.id = $1`, [
      voucherId,
    ]);
    return rows[0] ?? null;
  }

  async findByNumber(voucherNumber: string): Promise<IssueVoucherRecord | null> {
    const rows = await this.db.query<IssueVoucherRecord>(
      `${VOUCHER_SELECT} WHERE v.voucher_number = $1`,
      [voucherNumber]
    );
    return rows[0] ?? null;
  }

  /** The one voucher of this ration type for this selection, if it exists. */
  async findForSelection(
    selectionId: string,
    rationType: RationType
  ): Promise<IssueVoucherRecord | null> {
    const rows = await this.db.query<IssueVoucherRecord>(
      `${VOUCHER_SELECT} WHERE v.selection_id = $1 AND v.ration_type = $2`,
      [selectionId, rationType]
    );
    return rows[0] ?? null;
  }

  async listForSelection(selectionId: string): Promise<IssueVoucherRecord[]> {
    return this.db.query<IssueVoucherRecord>(
      `${VOUCHER_SELECT} WHERE v.selection_id = $1 ORDER BY v.ration_type`,
      [selectionId]
    );
  }

  /** An officer's own vouchers, newest first. */
  async listForCustomer(customerId: string, limit = 50): Promise<IssueVoucherRecord[]> {
    return this.db.query<IssueVoucherRecord>(
      `${VOUCHER_SELECT} WHERE v.customer_id = $1 ORDER BY v.created_at DESC LIMIT $2`,
      [customerId, limit]
    );
  }

  /**
   * The operational search: voucher number, RIK ID, officer name or mobile,
   * narrowed by ration type, fulfilment mode, status or period.
   *
   * A plain case-insensitive substring match. It is a lookup aid, not a
   * matching rule — nothing here resolves an officer's identity by name.
   */
  async search(filters: VoucherSearchFilters): Promise<IssueVoucherRecord[]> {
    const { clause, params } = buildVoucherFilterClause(filters);
    const all = [...params, filters.limit, filters.offset];
    return this.db.query<IssueVoucherRecord>(
      `${VOUCHER_SELECT} ${clause} ORDER BY v.created_at DESC
        LIMIT $${all.length - 1} OFFSET $${all.length}`,
      all
    );
  }

  async count(filters: VoucherCountFilters): Promise<number> {
    const { clause, params } = buildVoucherFilterClause(filters);
    const rows = await this.db.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM rik.issue_vouchers v
         JOIN rik.entitlement_selections s ON s.id = v.selection_id
         JOIN shared.customers c ON c.id = v.customer_id
        ${clause}`,
      params
    );
    return Number(rows[0]!.total);
  }

  /**
   * Create the voucher. The number is drawn inside the statement, so a
   * refused insert — a duplicate, an unconfirmed selection, a snapshot that
   * disagrees — consumes no number and leaves no gap that reads as a deleted
   * voucher.
   *
   * `ON CONFLICT (selection_id, ration_type) DO NOTHING` is what makes
   * creation idempotent against a concurrent duplicate: two simultaneous
   * requests cannot both insert, and the loser returns no row so the caller
   * reads the winner's voucher instead of failing.
   */
  async create(input: CreateVoucherInput): Promise<IssueVoucherRecord | null> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO rik.issue_vouchers
         (voucher_number, selection_id, customer_id, period_id, ration_type,
          fulfillment_mode, pickup_location_id, pickup_location_name, delivery_address,
          status, created_by, released_by)
       VALUES (rik.format_issue_voucher_number(nextval('rik.issue_voucher_seq'),
                                               extract(year from now())::integer),
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (selection_id, ration_type) DO NOTHING
       RETURNING id`,
      [
        input.selectionId,
        input.customerId,
        input.periodId,
        input.rationType,
        input.fulfillmentMode,
        input.pickupLocationId,
        input.pickupLocationName,
        input.deliveryAddress,
        input.status,
        input.staffId,
      ]
    );
    if (rows.length === 0) return null;
    return this.findById(rows[0]!.id);
  }
}
