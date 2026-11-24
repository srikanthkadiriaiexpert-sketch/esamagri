import { apiDownload, apiRequest } from './client';

/**
 * RIK issue vouchers — the operational document the yard works from (PHASE D).
 *
 * Every shape here mirrors the real `RikIssueVouchersController` response.
 * Nothing in this module composes a voucher number, decides a status, derives
 * a quantity or works out which issue window is current: all of that is the
 * server's, and the screen displays what it is told.
 *
 * WHAT THIS CLIENT CANNOT DO. There is no update, no status action, no
 * collection or delivery, no substitution and no delete — not because they
 * were left out of this file, but because no such route exists and the
 * application holds no UPDATE privilege on the voucher table at all. Phase D
 * creates and reads vouchers; the fulfilment transitions are a later phase.
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

export interface IssueVoucherSummary {
  voucherId: string;
  voucherNumber: string;
  selectionId: string;
  selectionReference: string | null;
  officerId: string;
  rikId: string | null;
  officerName: string | null;
  mobileNumber: string | null;
  rationType: RationType;
  fulfillmentMode: FulfillmentMode;
  /**
   * Exactly one of these is set per voucher, according to `fulfillmentMode`.
   * A PICKUP voucher carries `pickupLocationName` and a null
   * `deliveryAddress`; a DELIVERY voucher the reverse. Both are declared so
   * the CSV export has one stable column set whatever the mode.
   */
  pickupLocationName: string | null;
  deliveryAddress: string | null;
  status: VoucherStatus;
  periodId: string;
  periodName: string;
  issueDate: string | null;
  createdAt: string;
}

export interface VoucherOfficer {
  rikId: string | null;
  name: string | null;
  officialName: string | null;
  mobileNumber: string | null;
  residence: { quarterBlock: string | null; quarterNumber: string | null; landmark: string | null } | null;
}

export interface VoucherProvisionLine {
  poolCode: string;
  poolName: string;
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  packSize: number | null;
  packUnit: string | null;
  unit: string;
  poolEntitlement: number;
  quantityToIssue: number;
  poolEquivalentQty: number;
  consumptionRatio: number;
}

export interface VoucherPoolGroup {
  poolCode: string;
  poolName: string;
  unit: string;
  eligibleDays: number;
  totalEntitlement: number;
  lines: VoucherProvisionLine[];
}

/**
 * Where the voucher's entitlement came from — a LIST, with one entry today:
 * the voucher's own period. The list shape is what lets a previous-month
 * component be shown as a SECOND entry by the phase that defines one, instead
 * of being merged into a single balance nobody can take apart.
 */
export interface VoucherSourceComponent {
  kind: 'CURRENT_PERIOD';
  periodId: string;
  periodName: string;
  eligibleDays: number;
}

export interface VoucherWindow {
  windowCode: string;
  label: string;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  isCurrent: boolean;
}

export interface IssueVoucherDetail extends IssueVoucherSummary {
  officer: VoucherOfficer;
  period: { id: string; name: string; startDate: string; endDate: string };
  fulfillment: {
    mode: FulfillmentMode;
    pickupLocationName: string | null;
    deliveryAddress: string | null;
  };
  sourceComponents: VoucherSourceComponent[];
  /** Every configured window of this ration type, in sequence order. */
  windows: VoucherWindow[];
  /** The window containing today, or null when none is open. */
  currentWindowCode: string | null;
  pools: VoucherPoolGroup[];
  issuedBy: { staffId: string | null; name: string | null };
}

export interface IssueVoucherHistoryEntry {
  entryId: string;
  action: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface VoucherSearchFilters {
  q?: string;
  rationType?: RationType | '';
  fulfillmentMode?: FulfillmentMode | '';
  status?: VoucherStatus | '';
  periodId?: string;
  /**
   * Inclusive YYYY-MM-DD bounds on the voucher's ISSUE date, which is the date
   * the voucher was created. NOT the date a ration was collected or
   * delivered — that lives in the fulfilment outcome log and the list endpoint
   * does not join it. The screen labels these "Issued from/to" so the
   * distinction is visible to whoever reads the export.
   */
  issuedFrom?: string;
  issuedTo?: string;
  limit?: number;
  offset?: number;
}

export interface VoucherPage {
  items: IssueVoucherSummary[];
  total: number;
  limit: number;
  offset: number;
}

const BASE = '/admin/rik/issue-vouchers';

export function fetchIssueVouchers(
  filters: VoucherSearchFilters = {},
  signal?: AbortSignal
): Promise<VoucherPage> {
  const query = new URLSearchParams();
  if (filters.q !== undefined && filters.q.trim() !== '') query.set('q', filters.q.trim());
  if (filters.rationType) query.set('rationType', filters.rationType);
  if (filters.fulfillmentMode) query.set('fulfillmentMode', filters.fulfillmentMode);
  if (filters.status) query.set('status', filters.status);
  if (filters.periodId) query.set('periodId', filters.periodId);
  if (filters.issuedFrom) query.set('issuedFrom', filters.issuedFrom);
  if (filters.issuedTo) query.set('issuedTo', filters.issuedTo);
  if (filters.limit !== undefined) query.set('limit', String(filters.limit));
  if (filters.offset !== undefined && filters.offset > 0) query.set('offset', String(filters.offset));
  const qs = query.toString();
  return apiRequest<VoucherPage>(qs === '' ? BASE : `${BASE}?${qs}`, { signal });
}

export function fetchIssueVoucher(
  voucherId: string,
  signal?: AbortSignal
): Promise<IssueVoucherDetail> {
  return apiRequest<IssueVoucherDetail>(`${BASE}/${voucherId}`, { signal });
}

export function fetchIssueVoucherHistory(
  voucherId: string,
  signal?: AbortSignal
): Promise<{ items: IssueVoucherHistoryEntry[] }> {
  return apiRequest<{ items: IssueVoucherHistoryEntry[] }>(`${BASE}/${voucherId}/history`, {
    signal,
  });
}

/**
 * Create the voucher for a confirmed selection, or receive the one that
 * already exists — `created` says which happened. Repeating the request is
 * never an error and never a second document.
 *
 * The request carries the selection and the ration type and NOTHING else:
 * the number, the status, the fulfilment and the ration itself are not the
 * caller's to send, and the server's validation pipe rejects any field that
 * tries.
 */
export function createIssueVoucher(input: {
  selectionId: string;
  rationType: RationType;
}): Promise<IssueVoucherSummary & { created: boolean }> {
  return apiRequest<IssueVoucherSummary & { created: boolean }>(BASE, {
    method: 'POST',
    body: input,
  });
}

/**
 * The five-sheet operational workbook, for exactly the filters on screen
 * (PHASE C).
 *
 * THE SERVER BUILDS THE FILE, not this module. There is no spreadsheet
 * library in the Admin Portal and this adds none: `exceljs` already sits in
 * the API, where the frozen selection snapshots are, and shipping a second
 * copy to every browser to re-derive quantities the server already has
 * would be both slower and a second place for the numbers to differ.
 *
 * `limit` and `offset` are STRIPPED, deliberately. The export covers
 * everything the filter matches and the server pages internally — sending
 * the screen's paging would quietly export one page and call it the answer.
 *
 * `apiDownload` is the project's existing authenticated-download path: it
 * carries the bearer token, retries once through refresh on a 401, and
 * reads the filename the server chose from Content-Disposition. The browser's
 * own navigation cannot carry an Authorization header, which is why a plain
 * link would not work here.
 *
 * A REFUSAL ARRIVES AS A NORMAL ApiError, because the server throws before
 * it writes a single byte — so an over-large request or an unreplayable
 * snapshot is a message, never a half-written file on the operator's disk.
 */
export function downloadIssueVoucherExport(
  filters: VoucherSearchFilters = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const query = new URLSearchParams();
  if (filters.q !== undefined && filters.q.trim() !== '') query.set('q', filters.q.trim());
  if (filters.rationType) query.set('rationType', filters.rationType);
  if (filters.fulfillmentMode) query.set('fulfillmentMode', filters.fulfillmentMode);
  if (filters.status) query.set('status', filters.status);
  if (filters.periodId) query.set('periodId', filters.periodId);
  if (filters.issuedFrom) query.set('issuedFrom', filters.issuedFrom);
  if (filters.issuedTo) query.set('issuedTo', filters.issuedTo);
  const qs = query.toString();
  return apiDownload(qs === '' ? `${BASE}/export` : `${BASE}/export?${qs}`);
}

/** The facility's own words for a status. One list, one place. */
export const STATUS_LABELS: Readonly<Record<VoucherStatus, string>> = {
  READY_FOR_PICKUP: 'Ready for pickup',
  COLLECTED: 'Collected',
  NOT_COLLECTED: 'Not collected',
  READY_FOR_DELIVERY: 'Ready for delivery',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
};

/** The statuses of each fulfilment lane, for the status filter. */
export const STATUSES_BY_MODE: Readonly<Record<FulfillmentMode, readonly VoucherStatus[]>> = {
  PICKUP: ['READY_FOR_PICKUP', 'COLLECTED', 'NOT_COLLECTED'],
  DELIVERY: ['READY_FOR_DELIVERY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NOT_DELIVERED'],
};

export const ALL_STATUSES: readonly VoucherStatus[] = [
  ...STATUSES_BY_MODE.PICKUP,
  ...STATUSES_BY_MODE.DELIVERY,
];

export function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/**
 * A quantity as the facility writes it: the number, then its unit.
 *
 * Trailing zeros are dropped because the server sends a numeric column —
 * 1000 grams should read "1000 g", not "1000.0000 g". No rounding and no unit
 * conversion happens here; both belong to the entitlement engine.
 */
export function quantityLabel(quantity: number, unit: string): string {
  const text = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
  return `${text} ${unit}`;
}

/**
 * Units that name a container rather than a measure. A counted item reads as
 * what it is — "4 coupons" — because a clerk hands over coupons, not pieces.
 * The noun is configuration (`packUnit`), never derived from a name.
 */
const COUNTED_PACK_UNITS = ['piece', 'packet', 'tin', 'box', 'coupon'];

export function countNoun(line: { unit: string; packUnit: string | null }): string | null {
  if (line.unit !== 'piece') return null;
  if (line.packUnit === null || !COUNTED_PACK_UNITS.includes(line.packUnit)) return null;
  return line.packUnit;
}

/** "4 coupons", "1 coupon", "2000 g". No arithmetic, only the noun. */
export function countedQuantityLabel(
  line: { unit: string; packUnit: string | null },
  quantity: number
): string {
  const noun = countNoun(line);
  if (noun === null) return quantityLabel(quantity, line.unit);
  const text = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
  return `${text} ${quantity === 1 ? noun : `${noun}s`}`;
}

/** An ISO date as dd MMM yyyy, for display only. */
export function dateLabel(isoDate: string | null): string {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
