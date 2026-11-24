import { apiRequest } from './client';

/**
 * The officer's own issue voucher, as they read it (PHASE D).
 *
 * READ ONLY. There are two functions here and both are GETs. A voucher is the
 * facility's operational document: an officer is shown it, and that is all.
 * This app has no write path to one — not a disabled control, not a guarded
 * one — and neither does the server, which exposes no customer write route to
 * a voucher at all. The application cannot even change a voucher's status
 * from the administrative side, because migration 0048 leaves it SELECT and
 * INSERT on the voucher table and nothing else.
 *
 * ONLY YOUR OWN. The server compares the voucher's officer to the
 * authenticated one and answers a voucher belonging to someone else exactly
 * as a voucher that does not exist, so an id reveals nothing — not even that
 * it is real. Nothing in this module tries to make that check itself;
 * ownership is the server's to enforce.
 *
 * Note what the shapes do NOT carry: no selection id, no issuing staff
 * member, no audit history, no internal note. Those are administrative
 * records and the server does not send them here.
 */

export type RationType = 'FRESH' | 'DRY';
export type FulfillmentMode = 'PICKUP' | 'DELIVERY';

export interface IssueVoucherListItem {
  voucherId: string;
  voucherNumber: string;
  rationType: RationType;
  fulfillmentMode: FulfillmentMode;
  status: string;
  periodName: string;
  issueDate: string | null;
}

export interface VoucherLine {
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

export interface VoucherPool {
  poolCode: string;
  poolName: string;
  unit: string;
  eligibleDays: number;
  totalEntitlement: number;
  lines: VoucherLine[];
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

/**
 * Where the entitlement on this voucher came from — a LIST, with one entry
 * today: this period. It is a list so that a component from another period
 * can be shown as its own line by the phase that defines one, rather than
 * being added into a single figure the officer cannot take apart.
 */
export interface VoucherSourceComponent {
  kind: 'CURRENT_PERIOD';
  periodId: string;
  periodName: string;
  eligibleDays: number;
}

/**
 * What was PHYSICALLY ISSUED against this voucher, and what has lapsed
 * (PHASE E). Read only, like everything else here.
 *
 * Note what the server does NOT send to this app: no staff member's name, no
 * internal note, no event sequence, no correction detail. The officer is
 * shown the state of their own ration, not the facility's audit trail. A
 * correction therefore appears here only as a changed state — a reversed
 * collection simply reads as not completed again.
 *
 * `issued` is empty until something is actually handed over. It is never
 * inferred from the status, from the officer opening this screen, or from a
 * window having passed.
 */
export interface IssuedProvision {
  poolName: string;
  poolUnit: string;
  name: string;
  brand: string | null;
  quantityIssued: number;
  substitutedFor: { name: string; reason: string } | null;
}

/**
 * A previous month's unissued Dry balance carried into this period — shown as
 * its OWN line, never added into the current month's figures.
 */
export interface CarriedBalance {
  sourcePeriodName: string;
  poolName: string;
  quantity: number;
  remaining: number;
  unit: string;
  lapsedAt: string | null;
}

export interface VoucherIssueStatus {
  status: string;
  completedAt: string | null;
  completedOutcome: string | null;
  outcomeReason: string | null;
  issued: IssuedProvision[];
  carryForward: CarriedBalance[];
  lapsed: boolean;
  lapseReason: string | null;
  finalWindowCode: string | null;
  finalWindowEndDate: string | null;
  reminderDue: boolean;
  daysToFinalWindowClose: number | null;
}

export interface IssueVoucherDocument {
  voucherNumber: string;
  selectionReference: string | null;
  rationType: RationType;
  status: string;
  issueDate: string | null;
  period: { name: string; startDate: string; endDate: string };
  officer: {
    rikId: string | null;
    name: string | null;
    mobileNumber: string | null;
    residence: {
      quarterBlock: string | null;
      quarterNumber: string | null;
      landmark: string | null;
    } | null;
  };
  fulfillment: {
    mode: FulfillmentMode;
    pickupLocationName: string | null;
    deliveryAddress: string | null;
  };
  sourceComponents: VoucherSourceComponent[];
  windows: VoucherWindow[];
  currentWindowCode: string | null;
  pools: VoucherPool[];
  /**
   * PHASE E — what physically happened. Named `issueStatus` and NOT
   * `fulfillment`, because `fulfillment` above is the DESTINATION and has
   * been since PHASE D. Optional: a server that predates fulfilment
   * recording sends no such block, and the screen simply shows none.
   */
  issueStatus?: VoucherIssueStatus;
}

export function fetchMyIssueVouchers(
  signal?: AbortSignal
): Promise<{ items: IssueVoucherListItem[] }> {
  return apiRequest<{ items: IssueVoucherListItem[] }>('/rik/issue-vouchers', { signal });
}

export function fetchMyIssueVoucher(
  voucherId: string,
  signal?: AbortSignal
): Promise<IssueVoucherDocument> {
  return apiRequest<IssueVoucherDocument>(`/rik/issue-vouchers/${voucherId}`, { signal });
}

/** The facility's own words for a status. Display only. */
const STATUS_WORDS: Readonly<Record<string, string>> = {
  READY_FOR_PICKUP: 'Ready for pickup',
  COLLECTED: 'Collected',
  NOT_COLLECTED: 'Not collected',
  READY_FOR_DELIVERY: 'Ready for delivery',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
};

export function statusWords(status: string): string {
  return STATUS_WORDS[status] ?? status;
}

export function rationWords(rationType: RationType): string {
  return rationType === 'FRESH' ? 'Fresh ration' : 'Dry ration';
}

export function fulfillmentWords(mode: FulfillmentMode): string {
  return mode === 'PICKUP' ? 'Pickup at the yard' : 'Home delivery';
}

/** A date as the officer reads it: "Tue 14 Mar 2027". Display only. */
export function formatVoucherDate(isoDate: string | null): string {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A window's range as one line: "2 Mar – 8 Mar". Display only. */
export function formatWindowRange(startDate: string, endDate: string): string {
  const part = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return `${startDate} – ${endDate}`;
  }
  return `${part(startDate)} – ${part(endDate)}`;
}

/** A recorded moment as the officer reads it: "Tue 14 Mar 2027, 10:30". */
export function formatVoucherMoment(iso: string | null): string {
  if (iso === null) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * The reminder sentence for a Fresh voucher whose final window is closing.
 *
 * EVERY DATE AND EVERY COUNT IS THE SERVER'S. Nothing here knows the
 * facility's calendar, its operating days or how close "close" is — the
 * server decides whether a reminder is due and this turns its figures into a
 * sentence. Returns null when no reminder is due, so the screen shows nothing
 * rather than an empty banner.
 */
export function finalWindowReminder(fulfillment: VoucherIssueStatus): string | null {
  if (!fulfillment.reminderDue) return null;
  const days = fulfillment.daysToFinalWindowClose;
  const closes =
    fulfillment.finalWindowEndDate === null
      ? null
      : formatVoucherDate(fulfillment.finalWindowEndDate);
  const when =
    days === null
      ? closes === null
        ? 'soon'
        : `on ${closes}`
      : days <= 0
        ? 'today'
        : days === 1
          ? 'tomorrow'
          : `in ${days} days${closes === null ? '' : ` (${closes})`}`;
  return `This is your last chance to collect this Fresh ration. The final Fresh window closes ${when}. Anything not issued by then lapses.`;
}

/**
 * A quantity with its unit: "2000 g".
 *
 * Trailing zeros are dropped, because the server sends a numeric column and
 * "2000.0000 g" is not how anybody reads a weight. No rounding, no unit
 * conversion and no arithmetic of any kind happens here — every figure on the
 * voucher is the entitlement engine's, replayed from the snapshot the
 * officer's own confirmation froze.
 */
export function formatQuantity(quantity: number, unit: string): string {
  const text = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
  return `${text} ${unit}`;
}

/**
 * Units that name a container rather than a measure — the same list the
 * entitlement screens use, for the same reason: "5 piece" is not something
 * anybody says, and a voucher is read aloud at a counter.
 */
const COUNTED_PACK_UNITS = ['piece', 'packet', 'tin', 'box', 'coupon'];

/** What one of this line is called when counted, or null if it is measured. */
export function lineCountNoun(line: { unit: string; packUnit: string | null }): string | null {
  if (line.unit !== 'piece') return null;
  if (line.packUnit === null || !COUNTED_PACK_UNITS.includes(line.packUnit)) return null;
  return line.packUnit;
}

/**
 * A voucher line's quantity: "5 coupons", "1 coupon", "2000 g".
 *
 * Still no arithmetic — the figure is the engine's, replayed from the
 * snapshot the officer's own confirmation froze. Only the noun is chosen
 * here, and it is chosen from configuration, never from the line's name.
 */
export function formatLineQuantity(
  line: { unit: string; packUnit: string | null },
  quantity: number
): string {
  const noun = lineCountNoun(line);
  if (noun === null) return formatQuantity(quantity, line.unit);
  const text = Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(4)));
  return `${text} ${quantity === 1 ? noun : `${noun}s`}`;
}

/** The officer's quarter as one line, or null when none is recorded. */
export function formatResidence(
  residence: IssueVoucherDocument['officer']['residence']
): string | null {
  if (residence === null) return null;
  const quarter = [residence.quarterBlock, residence.quarterNumber].filter(Boolean).join('-');
  if (quarter === '') return residence.landmark ?? null;
  return residence.landmark === null ? quarter : `${quarter} · ${residence.landmark}`;
}
