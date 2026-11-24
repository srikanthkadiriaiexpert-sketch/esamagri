import { apiRequest } from './client';

/**
 * RIK physical fulfilment (PHASE E).
 *
 * Every shape mirrors `RikFulfillmentController`. Nothing here decides a
 * status, computes a pool equivalent, works out what a carried balance
 * covers or judges whether a substitution is allowed — all of that is the
 * server's, and the screen sends what the counter saw and displays what it
 * is told.
 *
 * THE TWO LANES ARE SEPARATE CALLS because they carry different authority:
 * the pickup counter holds `rik.order.mark_collected`, the delivery lane
 * `rik.order.manage`. A single call would have to be granted the weaker of
 * the two.
 */

export type FulfillmentOutcome =
  | 'COLLECTED'
  | 'NOT_COLLECTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'NOT_DELIVERED'
  | 'REVERSED';

export interface FulfillmentEvent {
  outcomeId: string;
  sequenceNo: number;
  eventType: 'OUTCOME' | 'CORRECTION';
  outcome: FulfillmentOutcome;
  reason: string | null;
  windowCode: string | null;
  supersedesId: string | null;
  recordedAt: string;
  recordedBy: { staffId: string | null; name: string | null; role: string };
  notes: string | null;
  reversed: boolean;
}

export interface IssuedLine {
  lineId: string;
  poolCode: string;
  poolName: string;
  poolUnit: string;
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  quantityIssued: number;
  consumptionRatio: number;
  poolEquivalentQty: number;
  carryForwardQty: number;
  substitutedFor: { provisionId: string; code: string; name: string; reason: string } | null;
}

export interface CarryForwardComponent {
  carryForwardId: string;
  sourcePeriodName: string;
  targetPeriodName: string;
  sourceSelectionReference: string | null;
  poolCode: string;
  poolName: string;
  quantity: number;
  remaining: number;
  unit: string;
  establishedAt: string;
  lapsedAt: string | null;
  lapseReason: string | null;
}

export interface SubstituteOption {
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  unit: string;
  packUnit: string | null;
  packSize: number | null;
  consumptionRatio: number;
  equivalentQuantity: number;
}

export interface SubstitutionGroup {
  poolCode: string;
  poolName: string;
  poolUnit: string;
  originalProvisionId: string;
  originalCode: string;
  originalName: string;
  originalQuantity: number;
  poolEquivalentQty: number;
  alternatives: SubstituteOption[];
}

export interface CounterView {
  voucherId: string;
  voucherNumber: string;
  rationType: 'FRESH' | 'DRY';
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  status: string;
  officer: {
    rikId: string | null;
    name: string | null;
    mobileNumber: string | null;
    quarterBlock: string | null;
    quarterNumber: string | null;
    landmark: string | null;
  };
  destination: {
    mode: 'PICKUP' | 'DELIVERY';
    pickupLocationName: string | null;
    deliveryAddress: string | null;
  };
  period: { id: string; name: string };
  lapsed: boolean;
  lapseReason: string | null;
  finalWindowCode: string | null;
  finalWindowEndDate: string | null;
  reminderDue: boolean;
  daysToFinalWindowClose: number | null;
  completion: FulfillmentEvent | null;
  events: FulfillmentEvent[];
  issuedLines: IssuedLine[];
  carryForward: CarryForwardComponent[];
  substitutionOptions: SubstitutionGroup[];
}

export interface IssueLineInput {
  provisionId: string;
  quantity: number;
  originalProvisionId?: string;
  substitutionReason?: string;
}

const BASE = '/admin/rik/fulfillment';

export function fetchCounterView(voucherId: string, signal?: AbortSignal): Promise<CounterView> {
  return apiRequest<CounterView>(`${BASE}/vouchers/${voucherId}`, { signal });
}

/** The same view for the delivery lane, which the counter permission cannot reach. */
export function fetchAdminView(voucherId: string, signal?: AbortSignal): Promise<CounterView> {
  return apiRequest<CounterView>(`${BASE}/vouchers/${voucherId}/admin`, { signal });
}

export function recordPickup(
  voucherId: string,
  body: { outcome: 'COLLECTED' | 'NOT_COLLECTED'; reason?: string; notes?: string; lines?: IssueLineInput[] }
): Promise<{ outcomeId: string; voucherNumber: string; status: string }> {
  return apiRequest(`${BASE}/vouchers/${voucherId}/pickup`, { method: 'POST', body });
}

export function recordDelivery(
  voucherId: string,
  body: {
    outcome: 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'NOT_DELIVERED';
    reason?: string;
    notes?: string;
    lines?: IssueLineInput[];
  }
): Promise<{ outcomeId: string; voucherNumber: string; status: string }> {
  return apiRequest(`${BASE}/vouchers/${voucherId}/delivery`, { method: 'POST', body });
}

/** Reverse a completion. Not an edit and not a delete — a recorded correction. */
export function reverseCompletion(
  voucherId: string,
  body: { outcomeId: string; reason: string; notes?: string }
): Promise<{ correctionId: string; voucherNumber: string; status: string }> {
  return apiRequest(`${BASE}/vouchers/${voucherId}/corrections`, { method: 'POST', body });
}

export function settleLapse(voucherId: string): Promise<{ lapsed: boolean; reason: string }> {
  return apiRequest(`${BASE}/vouchers/${voucherId}/lapse`, { method: 'POST' });
}

export function establishCarryForward(body: {
  customerId: string;
  sourcePeriodId: string;
  targetPeriodId: string;
}): Promise<{ established: CarryForwardComponent[]; skipped: string[] }> {
  return apiRequest(`${BASE}/carry-forward`, { method: 'POST', body });
}

export function lapseCarryForward(body: {
  customerId: string;
  targetPeriodId: string;
}): Promise<{ lapsed: number; skipped: string[] }> {
  return apiRequest(`${BASE}/carry-forward/lapse`, { method: 'POST', body });
}

/** The facility's own words for a fulfilment event. One list, one place. */
export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  COLLECTED: 'Collected',
  NOT_COLLECTED: 'Not collected',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  NOT_DELIVERED: 'Not delivered',
  REVERSED: 'Reversed',
  READY_FOR_PICKUP: 'Ready for pickup',
  READY_FOR_DELIVERY: 'Ready for delivery',
};

export function outcomeLabel(code: string): string {
  return OUTCOME_LABELS[code] ?? code;
}

/** What the lane allows next, so the screen offers nothing the server would refuse. */
export function nextSteps(status: string): FulfillmentOutcome[] {
  switch (status) {
    case 'READY_FOR_PICKUP':
      return ['COLLECTED', 'NOT_COLLECTED'];
    case 'READY_FOR_DELIVERY':
      return ['OUT_FOR_DELIVERY', 'NOT_DELIVERED'];
    case 'OUT_FOR_DELIVERY':
      return ['DELIVERED', 'NOT_DELIVERED'];
    default:
      return [];
  }
}

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
