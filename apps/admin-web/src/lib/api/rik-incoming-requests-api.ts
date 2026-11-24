import { apiRequest } from './client';
import type { FulfillmentMode, RationType } from './rik-issue-vouchers-api';

/**
 * Incoming RIK requests (PHASE B) — confirmed customer selections that have
 * not yet become issue vouchers.
 *
 * Every shape here mirrors the real `RikIncomingRequestsController`
 * response. Nothing in this module decides whether a request is
 * outstanding, works out a ration type, or derives a quantity: all of that
 * is the server's, read from the customer's own confirmed selection.
 *
 * WHAT THIS CLIENT CANNOT DO. There is no create, update, delete or
 * "mark processed" here, because no such route exists. A request leaves the
 * queue by acquiring a voucher through `createIssueVoucher` in
 * `rik-issue-vouchers-api`, which is the SAME endpoint the Issue vouchers
 * screen uses — one voucher-creation path for the whole portal, so the
 * duplicate rule cannot be implemented twice and drift.
 *
 * `RationType` and `FulfillmentMode` are imported rather than redeclared
 * for that same reason: two copies of a union are two things to forget.
 */

export type { RationType, FulfillmentMode };

export interface IncomingRequestLine {
  poolCode: string;
  poolName: string;
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  quantity: number;
  unit: string;
  /** Configured pack size and its noun, or null when none is configured. */
  packSize: number | null;
  packUnit: string | null;
}

export interface IncomingRequestOfficer {
  customerId: string;
  rikId: string;
  name: string;
  officialName: string | null;
  mobileNumber: string;
  /** Null when the officer has no default address on file. */
  residence: { quarterBlock: string | null; quarterNumber: string | null; landmark: string | null } | null;
}

export interface IncomingRequest {
  selectionId: string;
  selectionReference: string | null;
  rationType: RationType;
  officer: IncomingRequestOfficer;
  period: { id: string; name: string; startDate: string; endDate: string };
  confirmedAt: string | null;
  dietaryPreference: string;
  eligibleDays: number;
  fulfillment: {
    mode: FulfillmentMode | null;
    pickupLocationName: string | null;
    deliveryAddress: string | null;
  };
  lines: IncomingRequestLine[];
  /** Always 'AWAITING_VOUCHER' — a worked request is not returned at all. */
  status: 'AWAITING_VOUCHER';
  otherRationTypeIssued: boolean;
}

export interface IncomingRequestFilters {
  q?: string;
  rationType?: RationType | '';
  fulfillmentMode?: FulfillmentMode | '';
  periodId?: string;
  /**
   * Inclusive YYYY-MM-DD bounds on the CONFIRMATION date — when the customer
   * confirmed their selection. Not an issue date: nothing in this queue has
   * been issued, which is what puts it in the queue.
   */
  confirmedFrom?: string;
  confirmedTo?: string;
  limit?: number;
  offset?: number;
}

export interface IncomingRequestPage {
  items: IncomingRequest[];
  total: number;
  limit: number;
  offset: number;
}

const BASE = '/admin/rik/incoming-requests';

export function fetchIncomingRequests(
  filters: IncomingRequestFilters = {},
  signal?: AbortSignal
): Promise<IncomingRequestPage> {
  const query = new URLSearchParams();
  if (filters.q !== undefined && filters.q.trim() !== '') query.set('q', filters.q.trim());
  if (filters.rationType) query.set('rationType', filters.rationType);
  if (filters.fulfillmentMode) query.set('fulfillmentMode', filters.fulfillmentMode);
  if (filters.periodId) query.set('periodId', filters.periodId);
  if (filters.confirmedFrom) query.set('confirmedFrom', filters.confirmedFrom);
  if (filters.confirmedTo) query.set('confirmedTo', filters.confirmedTo);
  if (filters.limit !== undefined) query.set('limit', String(filters.limit));
  if (filters.offset !== undefined && filters.offset > 0) query.set('offset', String(filters.offset));
  const qs = query.toString();
  return apiRequest<IncomingRequestPage>(qs === '' ? BASE : `${BASE}?${qs}`, { signal });
}

/**
 * The officer's residence on one line, or null when there is nothing to show.
 *
 * Parts are joined only when present, so a landmark-only address reads as the
 * landmark rather than as ", , Near temple". Nothing is invented: an officer
 * with no address on file gets null and the screen says so plainly.
 */
export function residenceLabel(residence: IncomingRequestOfficer['residence']): string | null {
  if (residence === null) return null;
  const quarter = [residence.quarterBlock, residence.quarterNumber].filter((p) => p !== null && p !== '');
  const parts: string[] = [];
  if (quarter.length > 0) parts.push(`Qtr ${quarter.join('-')}`);
  if (residence.landmark !== null && residence.landmark !== '') parts.push(residence.landmark);
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * Where this request is to be fulfilled, in one phrase.
 *
 * Reads the SNAPSHOT the customer confirmed, never today's saved address —
 * the same rule the voucher follows. A confirmation that recorded no
 * fulfilment says so, because that request cannot be issued until it is
 * fixed, and the voucher endpoint will refuse it with FULFILLMENT_MISSING.
 */
export function fulfillmentLabel(fulfillment: IncomingRequest['fulfillment']): string {
  if (fulfillment.mode === 'PICKUP') {
    return fulfillment.pickupLocationName === null
      ? 'Pickup — no collection point recorded'
      : `Pickup — ${fulfillment.pickupLocationName}`;
  }
  if (fulfillment.mode === 'DELIVERY') {
    return fulfillment.deliveryAddress === null
      ? 'Delivery — no address recorded'
      : `Delivery — ${fulfillment.deliveryAddress}`;
  }
  return 'No fulfilment recorded';
}
