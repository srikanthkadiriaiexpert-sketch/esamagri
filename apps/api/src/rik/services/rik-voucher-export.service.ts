import { Injectable } from '@nestjs/common';
import {
  IssueVouchersRepository,
  type IssueVoucherRecord,
  type VoucherCountFilters,
} from '../repositories/issue-vouchers.repository';
import { RikIssueVoucherService } from './rik-issue-voucher.service';
import {
  buildVoucherWorkbook,
  type LineRow,
  type RegisterRow,
} from './issue-voucher-workbook';

/**
 * The RIK issue-voucher Excel export (PHASE C).
 *
 * READ-ONLY, STRUCTURALLY. This service calls two things: the voucher
 * repository's `search`/`count`, and RikIssueVoucherService's snapshot
 * replay. Neither writes. It records no outcome, advances no status and
 * opens no transaction — and could not change a voucher if it tried, since
 * the application holds only SELECT and INSERT on rik.issue_vouchers
 * (migration 0048) and status moves solely through the outcome trigger.
 * Exporting is therefore not "careful not to" mutate; it has nothing to
 * mutate with.
 *
 * NO SECOND FULFILMENT ENGINE. Quantities come from
 * `RikIssueVoucherService.poolsForExport`, which replays each selection's
 * frozen `rule_snapshot` through the one existing path. This file contains
 * no scale, no conversion, no ratio and no pack rule, and it does not read
 * the live configuration at all — so a provision renamed or retired today
 * cannot change what an already-issued voucher exports.
 *
 * THE SAME FILTERS AS THE SCREEN. `VoucherCountFilters` is passed straight
 * to the repository, which builds its predicates with the very
 * `buildVoucherFilterClause` the list endpoint uses. The export cannot
 * select a different set of vouchers from the one the operator is looking
 * at, because there is only one builder.
 */

export type VoucherExportErrorCode =
  | 'EXPORT_TOO_LARGE'
  | 'EXPORT_DETAIL_TOO_LARGE'
  | 'EXPORT_SNAPSHOT_UNAVAILABLE';

export class VoucherExportError extends Error {
  readonly code: VoucherExportErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: VoucherExportErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'VoucherExportError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The outer guard. Above this the request is refused outright, whatever the
 * filters — a five-sheet workbook of this size is not an operational
 * document, it is an accident.
 */
export const REGISTER_MAX = 5000;

/**
 * The replay ceiling. Sheets 2 to 5 need every voucher's snapshot replayed,
 * one replay each, so this bounds real work rather than file size.
 *
 * A REQUEST BETWEEN THIS AND REGISTER_MAX IS REFUSED, NOT DOWNGRADED. The
 * approved scope is a five-sheet workbook; handing back one with four
 * sheets empty and no explanation is exactly the silent truncation that was
 * ruled out. The refusal names both numbers so the operator knows how far
 * to narrow.
 */
export const DETAIL_MAX = 750;

/** Vouchers fetched per repository round trip while paging the register. */
export const EXPORT_PAGE_SIZE = 250;

/** Snapshot replays in flight at once. Bounded so an export cannot swamp the pool. */
export const REPLAY_CONCURRENCY = 8;

const STATUS_LABELS: Readonly<Record<string, string>> = {
  READY_FOR_PICKUP: 'Ready for pickup',
  COLLECTED: 'Collected',
  NOT_COLLECTED: 'Not collected',
  READY_FOR_DELIVERY: 'Ready for delivery',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** A human sentence naming what the file covers, written into every sheet. */
export function describeFilters(filters: VoucherCountFilters): string {
  const parts: string[] = [];
  if (filters.q !== undefined && filters.q.trim() !== '') parts.push(`search "${filters.q.trim()}"`);
  if (filters.rationType !== undefined) parts.push(`ration type ${filters.rationType}`);
  if (filters.fulfillmentMode !== undefined) parts.push(`fulfilment ${filters.fulfillmentMode}`);
  if (filters.status !== undefined) parts.push(`status ${statusLabel(filters.status)}`);
  if (filters.periodId !== undefined) parts.push('one issue period');
  if (filters.issuedFrom !== undefined && filters.issuedFrom !== '') parts.push(`issued from ${filters.issuedFrom}`);
  if (filters.issuedTo !== undefined && filters.issuedTo !== '') parts.push(`issued to ${filters.issuedTo}`);
  return parts.length === 0 ? 'All issued vouchers' : `Filtered: ${parts.join(', ')}`;
}

@Injectable()
export class RikVoucherExportService {
  constructor(
    private readonly vouchers: IssueVouchersRepository,
    private readonly voucherService: RikIssueVoucherService
  ) {}

  /**
   * Build the workbook, or refuse with a reason the operator can act on.
   *
   * ORDER MATTERS. The size check runs BEFORE any voucher is read and long
   * before any snapshot is replayed, so an over-large request costs one
   * count query rather than hundreds of replays that are then thrown away.
   */
  async build(filters: VoucherCountFilters, now: Date = new Date()): Promise<Buffer> {
    const total = await this.vouchers.count(filters);

    if (total > REGISTER_MAX) {
      throw new VoucherExportError(
        'EXPORT_TOO_LARGE',
        `That filter matches ${total} vouchers, which is beyond the ${REGISTER_MAX} this export will produce. Narrow it by issue period or issue date.`,
        { total, limit: REGISTER_MAX }
      );
    }
    if (total > DETAIL_MAX) {
      throw new VoucherExportError(
        'EXPORT_DETAIL_TOO_LARGE',
        `That filter matches ${total} vouchers. The provision sheets replay one frozen snapshot per voucher, so an export covers at most ${DETAIL_MAX}. Narrow it by issue period, ration type or issue date — nothing has been truncated.`,
        { total, limit: DETAIL_MAX }
      );
    }

    const records = await this.collect(filters, total);
    const lines = await this.replay(records);

    return buildVoucherWorkbook({
      register: records.map(toRegisterRow),
      lines,
      filterSummary: describeFilters(filters),
      generatedAt: now.toISOString(),
    });
  }

  /**
   * Every voucher matching the filter, in pages.
   *
   * Stops on a short page as well as on the reported total. A loop that
   * trusted `total` alone would spin against an empty final page if a
   * voucher were created between the count and the first page — the same
   * belt-and-braces the existing CSV exporter uses.
   */
  private async collect(filters: VoucherCountFilters, total: number): Promise<IssueVoucherRecord[]> {
    const all: IssueVoucherRecord[] = [];
    for (let offset = 0; offset < total; offset += EXPORT_PAGE_SIZE) {
      const page = await this.vouchers.search({ ...filters, limit: EXPORT_PAGE_SIZE, offset });
      all.push(...page);
      if (page.length < EXPORT_PAGE_SIZE) break;
      if (all.length >= DETAIL_MAX) break;
    }
    return all;
  }

  /**
   * Replay every voucher's frozen snapshot into provision lines.
   *
   * A VOUCHER WHOSE SNAPSHOT CANNOT BE REPLAYED FAILS THE WHOLE EXPORT, by
   * name. The alternative — dropping it and carrying on — produces a file
   * that looks complete, and a store that packs from it would be short by
   * exactly one officer's ration with nothing on the sheet to say so. A
   * refusal naming the voucher is recoverable; a quietly incomplete
   * packing list is not.
   *
   * An empty replay counts as unavailable too: a voucher is only ever
   * created when there is something of its ration type to issue, so a
   * voucher that now replays to nothing is a voucher whose basis has gone,
   * not a voucher for nothing.
   */
  private async replay(records: readonly IssueVoucherRecord[]): Promise<LineRow[]> {
    const lines: LineRow[] = [];

    for (let i = 0; i < records.length; i += REPLAY_CONCURRENCY) {
      const batch = records.slice(i, i + REPLAY_CONCURRENCY);
      const replayed = await Promise.all(
        batch.map(async (voucher) => ({
          voucher,
          pools: await this.voucherService.poolsForExport(
            voucher.selection_id,
            voucher.customer_id,
            voucher.ration_type
          ),
        }))
      );

      for (const { voucher, pools } of replayed) {
        if (pools === null || pools.length === 0) {
          throw new VoucherExportError(
            'EXPORT_SNAPSHOT_UNAVAILABLE',
            `Voucher ${voucher.voucher_number} could not be read back from its confirmed selection, so its provisions are unknown. The export was stopped rather than leaving that voucher out. Investigate selection ${voucher.selection_reference ?? voucher.selection_id} before exporting again.`,
            {
              voucherNumber: voucher.voucher_number,
              voucherId: voucher.id,
              selectionId: voucher.selection_id,
              selectionReference: voucher.selection_reference,
              rikId: voucher.rik_id,
            }
          );
        }

        for (const pool of pools) {
          for (const line of pool.lines) {
            lines.push({
              voucherNumber: voucher.voucher_number,
              rikId: voucher.rik_id,
              officerName: voucher.officer_official_name ?? voucher.officer_name,
              mobileNumber: voucher.mobile_number,
              // The snapshot's destination, not today's saved address — the
              // same value the voucher itself carries.
              destination:
                voucher.fulfillment_mode === 'PICKUP'
                  ? (voucher.pickup_location_name ?? 'No collection point recorded')
                  : (voucher.delivery_address ?? 'No address recorded'),
              periodName: voucher.period_name,
              rationType: voucher.ration_type,
              fulfillmentMode: voucher.fulfillment_mode,
              poolCode: line.poolCode,
              poolName: line.poolName,
              provisionId: line.provisionId,
              provisionCode: line.code,
              provisionName: line.name,
              brand: line.brand,
              quantity: line.quantityToIssue,
              unit: line.unit,
              packSize: line.packSize,
              packUnit: line.packUnit,
              status: voucher.status,
              statusLabel: statusLabel(voucher.status),
            });
          }
        }
      }
    }

    return lines;
  }
}

/**
 * The register projection.
 *
 * Mirrors `summaryView`'s field choices — including `officer_official_name`
 * before `officer_name`, and `released_at` as the issue date — so a row in
 * the workbook says the same thing as the same row on the screen.
 */
function toRegisterRow(v: IssueVoucherRecord): RegisterRow {
  return {
    voucherNumber: v.voucher_number,
    selectionReference: v.selection_reference,
    rikId: v.rik_id,
    officerName: v.officer_official_name ?? v.officer_name,
    mobileNumber: v.mobile_number,
    rationType: v.ration_type,
    fulfillmentMode: v.fulfillment_mode,
    pickupLocationName: v.pickup_location_name,
    deliveryAddress: v.delivery_address,
    status: v.status,
    statusLabel: statusLabel(v.status),
    periodName: v.period_name,
    issueDate: v.released_at,
    createdAt: v.created_at,
  };
}
