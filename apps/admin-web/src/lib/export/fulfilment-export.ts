import { statusLabel, type IssueVoucherSummary, type VoucherSearchFilters } from '../api/rik-issue-vouchers-api';
import { outcomeLabel, type CounterView } from '../api/rik-fulfillment-api';
import { toCsvFromColumns, type CsvColumn } from './csv';

/**
 * The RIK fulfilment CSV export.
 *
 * WHERE THE DATA COMES FROM, AND WHY THERE ARE TWO SHAPES
 *
 * The voucher LIST endpoint (`GET /admin/rik/issue-vouchers`) returns exactly
 * the eleven voucher-level fields below and no more. Issued provisions and
 * quantities are not in it — they live in the per-voucher fulfilment view
 * (`GET /admin/rik/fulfillment/vouchers/:id/admin`), one request per voucher.
 *
 * So: exporting ALL filtered records gives voucher-level rows, because that is
 * what one query can answer. Exporting SELECTED records additionally fetches
 * each one's issued lines and gives a row per provision. Nothing here invents
 * a field, derives a quantity or computes a conversion — every column maps to
 * a value the server sent.
 *
 * AUTHORISATION IS NOT DONE HERE. Both endpoints require
 * `rik.order.manage`, which RIK_ADMIN holds and no PIF role does. This module
 * can only export what those endpoints already agreed to return to this
 * session, so there is no path by which it widens access. The screen hides the
 * buttons without the permission as a courtesy; the refusal is the server's.
 *
 * NO PIF DATA IS REACHABLE FROM HERE. The only two fetchers are the RIK
 * voucher list and the RIK fulfilment view, both passed in by the caller.
 */

/** The page shape the voucher list endpoint returns. */
export interface VoucherPageLike {
  items: IssueVoucherSummary[];
  total: number;
}

export type VoucherPageFetcher = (
  filters: VoucherSearchFilters,
  signal?: AbortSignal
) => Promise<VoucherPageLike>;

export type FulfilmentViewFetcher = (
  voucherId: string,
  signal?: AbortSignal
) => Promise<CounterView>;

/**
 * The server caps `limit` at 100 (VoucherSearchQueryDto), so "all filtered"
 * means paging. MAX_EXPORT_ROWS stops a careless unfiltered export from
 * issuing hundreds of requests; the caller is told when it bites rather than
 * being handed a silently short file.
 */
export const EXPORT_PAGE_SIZE = 100;
export const MAX_EXPORT_ROWS = 5000;

export interface CollectResult {
  vouchers: IssueVoucherSummary[];
  /** The server's total for the filter, which may exceed what we collected. */
  total: number;
  /** True when MAX_EXPORT_ROWS stopped us before the end. */
  truncated: boolean;
}

/**
 * Pages through every voucher matching the filter.
 *
 * Stops on three conditions, in this order: the cap, a short page, or having
 * collected the server's reported total. The short-page check is what makes it
 * terminate if `total` is ever stale or wrong — a loop that trusted only
 * `total` would spin forever against an empty final page.
 */
export async function collectFilteredVouchers(
  fetchPage: VoucherPageFetcher,
  filters: VoucherSearchFilters,
  options: { maxRows?: number; signal?: AbortSignal } = {}
): Promise<CollectResult> {
  const maxRows = options.maxRows ?? MAX_EXPORT_ROWS;
  const vouchers: IssueVoucherSummary[] = [];
  let total = 0;
  let offset = 0;

  for (;;) {
    const page = await fetchPage(
      { ...filters, limit: EXPORT_PAGE_SIZE, offset },
      options.signal
    );
    total = page.total;
    vouchers.push(...page.items);

    if (page.items.length < EXPORT_PAGE_SIZE) break;
    if (vouchers.length >= maxRows) break;
    if (vouchers.length >= total) break;
    offset += EXPORT_PAGE_SIZE;
  }

  const truncated = vouchers.length > maxRows || total > vouchers.length;
  return { vouchers: vouchers.slice(0, maxRows), total, truncated };
}

// ---------------------------------------------------------------------------
// Voucher-level columns — exactly the fields the list endpoint returns.
// ---------------------------------------------------------------------------

export const voucherColumns: readonly CsvColumn<IssueVoucherSummary>[] = [
  { header: 'Voucher number', value: (v) => v.voucherNumber },
  { header: 'Selection reference', value: (v) => v.selectionReference },
  { header: 'RIK ID', value: (v) => v.rikId },
  { header: 'Officer name', value: (v) => v.officerName },
  { header: 'Mobile number', value: (v) => v.mobileNumber },
  { header: 'Ration type', value: (v) => v.rationType },
  { header: 'Fulfilment mode', value: (v) => v.fulfillmentMode },
  // Same two columns, same names, same position as the line export: a reader
  // comparing the two files should not have to learn two layouts.
  { header: 'Pickup location', value: (v) => v.pickupLocationName ?? '' },
  { header: 'Delivery address', value: (v) => v.deliveryAddress ?? '' },
  { header: 'Status', value: (v) => statusLabel(v.status) },
  { header: 'Status code', value: (v) => v.status },
  { header: 'Period', value: (v) => v.periodName },
  { header: 'Issue date', value: (v) => v.issueDate },
  { header: 'Voucher created at', value: (v) => v.createdAt },
];

export function buildVoucherCsv(vouchers: readonly IssueVoucherSummary[]): string {
  return toCsvFromColumns(voucherColumns, vouchers);
}

// ---------------------------------------------------------------------------
// Line-level columns — the voucher, plus one row per provision issued.
// ---------------------------------------------------------------------------

/** One exported line: the voucher it belongs to, and the provision handed over. */
export interface FulfilmentLineRow {
  voucher: IssueVoucherSummary;
  view: CounterView;
  line: CounterView['issuedLines'][number] | null;
}

export const lineColumns: readonly CsvColumn<FulfilmentLineRow>[] = [
  { header: 'Voucher number', value: (r) => r.voucher.voucherNumber },
  { header: 'RIK ID', value: (r) => r.voucher.rikId },
  { header: 'Officer name', value: (r) => r.voucher.officerName },
  { header: 'Mobile number', value: (r) => r.voucher.mobileNumber },
  { header: 'Quarter block', value: (r) => r.view.officer.quarterBlock },
  { header: 'Quarter number', value: (r) => r.view.officer.quarterNumber },
  { header: 'Period', value: (r) => r.voucher.periodName },
  { header: 'Ration type', value: (r) => r.voucher.rationType },
  { header: 'Fulfilment mode', value: (r) => r.voucher.fulfillmentMode },
  // Where the ration actually goes. The server sets exactly one of these per
  // voucher and leaves the other NULL, according to fulfillment_mode, so a
  // PICKUP row carries a location and an empty address and a DELIVERY row the
  // reverse. Both columns are always present so the file has one stable shape.
  { header: 'Pickup location', value: (r) => r.view.destination.pickupLocationName ?? '' },
  { header: 'Delivery address', value: (r) => r.view.destination.deliveryAddress ?? '' },
  { header: 'Status', value: (r) => statusLabel(r.voucher.status) },
  { header: 'Status code', value: (r) => r.voucher.status },
  {
    header: 'Fulfilment outcome',
    value: (r) => (r.view.completion === null ? '' : outcomeLabel(r.view.completion.outcome)),
  },
  {
    header: 'Fulfilment recorded at',
    value: (r) => r.view.completion?.recordedAt ?? '',
  },
  {
    header: 'Fulfilment recorded by',
    value: (r) => r.view.completion?.recordedBy.name ?? '',
  },
  { header: 'Pool code', value: (r) => r.line?.poolCode ?? '' },
  { header: 'Pool name', value: (r) => r.line?.poolName ?? '' },
  { header: 'Provision code', value: (r) => r.line?.code ?? '' },
  { header: 'Provision name', value: (r) => r.line?.name ?? '' },
  { header: 'Brand', value: (r) => r.line?.brand ?? '' },
  { header: 'Quantity issued', value: (r) => r.line?.quantityIssued ?? '' },
  { header: 'Pool unit', value: (r) => r.line?.poolUnit ?? '' },
  { header: 'Pool equivalent quantity', value: (r) => r.line?.poolEquivalentQty ?? '' },
  { header: 'Carry-forward quantity', value: (r) => r.line?.carryForwardQty ?? '' },
  { header: 'Substituted for (code)', value: (r) => r.line?.substitutedFor?.code ?? '' },
  { header: 'Substituted for (name)', value: (r) => r.line?.substitutedFor?.name ?? '' },
  { header: 'Substitution reason', value: (r) => r.line?.substitutedFor?.reason ?? '' },
  { header: 'Issue date', value: (r) => r.voucher.issueDate },
];

/**
 * Flattens vouchers and their fulfilment views into one row per issued
 * provision.
 *
 * A voucher with NO issued lines — not yet collected, or recorded as not
 * collected — still produces ONE row, with the provision columns empty. An
 * export that silently dropped those would be read as "every voucher in the
 * range was fulfilled", which is the opposite of the truth.
 */
export function toLineRows(
  pairs: readonly { voucher: IssueVoucherSummary; view: CounterView }[]
): FulfilmentLineRow[] {
  const rows: FulfilmentLineRow[] = [];
  for (const { voucher, view } of pairs) {
    if (view.issuedLines.length === 0) {
      rows.push({ voucher, view, line: null });
      continue;
    }
    for (const line of view.issuedLines) {
      rows.push({ voucher, view, line });
    }
  }
  return rows;
}

export function buildLineCsv(rows: readonly FulfilmentLineRow[]): string {
  return toCsvFromColumns(lineColumns, rows);
}

/**
 * Fetches the fulfilment view for each selected voucher, one request each.
 *
 * Sequential on purpose. These are staff-triggered exports of a handful of
 * ticked rows, and firing fifty parallel requests at the API to save a second
 * is not a trade worth making on a shared server. A voucher whose view cannot
 * be read is reported rather than skipped silently.
 */
export async function collectSelectedLines(
  fetchView: FulfilmentViewFetcher,
  vouchers: readonly IssueVoucherSummary[],
  options: { signal?: AbortSignal } = {}
): Promise<{
  rows: FulfilmentLineRow[];
  failures: { voucherNumber: string; error: unknown }[];
}> {
  const pairs: { voucher: IssueVoucherSummary; view: CounterView }[] = [];
  const failures: { voucherNumber: string; error: unknown }[] = [];

  for (const voucher of vouchers) {
    try {
      const view = await fetchView(voucher.voucherId, options.signal);
      pairs.push({ voucher, view });
    } catch (error) {
      failures.push({ voucherNumber: voucher.voucherNumber, error });
    }
  }

  return { rows: toLineRows(pairs), failures };
}
