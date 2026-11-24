import { Injectable } from '@nestjs/common';
import {
  IncomingRequestsRepository,
  type IncomingRequestLineRecord,
  type IncomingRequestPageFilters,
  type IncomingRequestRecord,
  type RationType,
} from '../repositories/incoming-requests.repository';

/**
 * Incoming RIK requests (PHASE B) — the queue of confirmed customer
 * selections that have not yet become issue vouchers.
 *
 * THIS SERVICE IS READ-ONLY, AND THAT IS THE DESIGN.
 *
 * It has no create method and no dependency on RikIssueVoucherService.
 * Converting a request is done by POSTing to the EXISTING
 * /admin/rik/issue-vouchers route, which already holds the whole rule:
 * the selection must be CONFIRMED, it must carry a snapshot and a
 * fulfilment, it must have something of that ration type to issue, and
 * the unique constraint on (selection_id, ration_type) makes a second
 * voucher impossible. Re-stating any of that here would be a second
 * implementation of the duplicate rule, and the two would eventually
 * disagree. The inbox finds the work; the voucher endpoint does it.
 *
 * SO "DUPLICATE PREVENTION" IN THIS PHASE IS NOT A NEW CHECK. It is
 * three existing mechanisms, unchanged: the queue excludes any pair that
 * already has a voucher, so a worked request stops being offered; the
 * voucher service returns the existing voucher with `created: false`
 * rather than erroring; and the database constraint refuses a second row
 * even under a race.
 */

export interface IncomingRequestLine {
  poolCode: string;
  poolName: string;
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  /** The quantity the customer selected, in this provision's own unit. */
  quantity: number;
  unit: string;
  /** Configured pack size and its noun. Never derived, never assumed. */
  packSize: number | null;
  packUnit: string | null;
}

export interface IncomingRequest {
  selectionId: string;
  selectionReference: string | null;
  /** FRESH or DRY: the physical issue stream this request is waiting on. */
  rationType: RationType;
  officer: {
    customerId: string;
    rikId: string;
    name: string;
    officialName: string | null;
    mobileNumber: string;
    residence: { quarterBlock: string | null; quarterNumber: string | null; landmark: string | null } | null;
  };
  period: { id: string; name: string; startDate: string; endDate: string };
  confirmedAt: string | null;
  dietaryPreference: string;
  eligibleDays: number;
  fulfillment: {
    mode: 'PICKUP' | 'DELIVERY' | null;
    pickupLocationName: string | null;
    deliveryAddress: string | null;
  };
  lines: IncomingRequestLine[];
  /**
   * Always 'AWAITING_VOUCHER'. A row only exists while no voucher does, so
   * there is no second value — and the field is here rather than implied so
   * the client never has to infer a status from an absence.
   */
  status: 'AWAITING_VOUCHER';
  /** The same selection's OTHER ration type already has a voucher. */
  otherRationTypeIssued: boolean;
}

@Injectable()
export class RikIncomingRequestService {
  constructor(private readonly requests: IncomingRequestsRepository) {}

  /**
   * One page of outstanding requests, each with the provisions the customer
   * actually chose.
   *
   * The page and the total are read with the SAME filters, and the lines are
   * fetched for the page's selections in one further query — so a page costs
   * three round trips whatever its size, not one per row.
   */
  async list(
    filters: IncomingRequestPageFilters
  ): Promise<{ items: IncomingRequest[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.requests.search(filters),
      this.requests.count(filters),
    ]);

    const selectionIds = [...new Set(rows.map((row) => row.selection_id))];
    const lines = await this.requests.listLines(selectionIds);

    // A selection appears on the page TWICE when both its streams are
    // outstanding — once for FRESH, once for DRY — so a line is attached by
    // selection AND ration type. Keying on the selection alone would put the
    // rice on the fresh-milk request.
    const byPair = new Map<string, IncomingRequestLine[]>();
    for (const line of lines) {
      const key = pairKey(line.selection_id, line.ration_type);
      const bucket = byPair.get(key);
      const mapped = toLine(line);
      if (bucket === undefined) byPair.set(key, [mapped]);
      else bucket.push(mapped);
    }

    return {
      items: rows.map((row) => toRequest(row, byPair.get(pairKey(row.selection_id, row.ration_type)) ?? [])),
      total,
    };
  }
}

function pairKey(selectionId: string, rationType: RationType): string {
  return `${selectionId}:${rationType}`;
}

/**
 * Numeric columns arrive as strings from `pg` (they are `numeric`, which
 * JavaScript cannot hold exactly), so they are converted once, here, rather
 * than in the browser. `pack_size` stays null when unconfigured — a missing
 * pack size is not a pack size of zero or one.
 */
function toLine(line: IncomingRequestLineRecord): IncomingRequestLine {
  return {
    poolCode: line.pool_code,
    poolName: line.pool_name,
    provisionId: line.provision_id,
    code: line.provision_code,
    name: line.provision_name,
    brand: line.provision_brand,
    quantity: Number(line.quantity),
    unit: line.unit,
    packSize: line.pack_size === null ? null : Number(line.pack_size),
    packUnit: line.pack_unit,
  };
}

function toRequest(row: IncomingRequestRecord, lines: IncomingRequestLine[]): IncomingRequest {
  return {
    selectionId: row.selection_id,
    selectionReference: row.reference_number,
    rationType: row.ration_type,
    officer: {
      customerId: row.customer_id,
      rikId: row.rik_id,
      name: row.officer_name,
      officialName: row.officer_official_name,
      mobileNumber: row.mobile_number,
      // All three null means no default address on file — reported as a
      // missing residence rather than an object of nulls the UI must unpick.
      residence:
        row.quarter_block === null && row.quarter_number === null && row.landmark === null
          ? null
          : {
              quarterBlock: row.quarter_block,
              quarterNumber: row.quarter_number,
              landmark: row.landmark,
            },
    },
    period: {
      id: row.period_id,
      name: row.period_name,
      startDate: row.period_start_date,
      endDate: row.period_end_date,
    },
    confirmedAt: row.confirmed_at,
    dietaryPreference: row.dietary_preference,
    eligibleDays: row.eligible_days,
    fulfillment: {
      mode: row.fulfillment_type,
      // Exactly one of these is meaningful, per the confirmation snapshot.
      pickupLocationName: row.pickup_location_name,
      deliveryAddress: row.delivery_address,
    },
    lines,
    status: 'AWAITING_VOUCHER',
    otherRationTypeIssued: row.other_type_issued,
  };
}
