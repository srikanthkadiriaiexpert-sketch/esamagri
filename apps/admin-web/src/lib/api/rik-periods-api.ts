import { apiRequest } from './client';

/**
 * Entitlement period administration.
 *
 * WHY `status` AND `state` ARE BOTH HERE, AND ARE NOT THE SAME THING.
 *
 *   `status` is the label the facility set: UPCOMING, ACTIVE or CLOSED.
 *   `state`  is what the period actually IS today, worked out by the server
 *            from its dates — with CLOSED overriding them.
 *
 * They can disagree, and when they do the disagreement is the useful fact: a
 * period labelled ACTIVE whose dates ended last week has `state: 'PAST'`, and
 * somebody needs to know that rather than trusting the label. The screen shows
 * `state` and offers to close the period; it never silently rewrites `status`.
 *
 * Nothing here computes an entitlement. A period is a name and two dates.
 */

/** UPCOMING and ACTIVE are labels. CLOSED is an explicit retirement. */
export type PeriodStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED';

/** What the period is today. CLOSED wins over the dates; otherwise the dates decide. */
export type PeriodState = 'CLOSED' | 'OPEN' | 'UPCOMING' | 'PAST';

/** What already references the period, and therefore pins its dates. */
export interface PeriodDependents {
  eligibility: number;
  import_batches: number;
  entitlements: number;
  selections: number;
  issue_windows: number;
  issue_vouchers: number;
  carry_forward: number;
  total: number;
}

export interface EntitlementPeriod {
  periodId: string;
  name: string;
  /** yyyy-mm-dd */
  startDate: string;
  /** yyyy-mm-dd */
  endDate: string;
  status: PeriodStatus;
  state: PeriodState;
  /** True for the one period that is operational today, if any. */
  isCurrent: boolean;
  /** False once any record references the period — see `dependents`. */
  datesEditable: boolean;
  dependents: PeriodDependents;
}

export interface PeriodListResponse {
  items: EntitlementPeriod[];
  /**
   * Null when NO period is operational today.
   *
   * That is a real answer, not an error and not a missing value. The screen
   * says so in words and asks for a period to be configured; it must never
   * fall back to "the most recent one", which is how a closed rehearsal period
   * would end up driving live operations.
   */
  currentPeriodId: string | null;
  total: number;
}

export interface CreatePeriodInput {
  name: string;
  startDate: string;
  endDate: string;
  /** Omitted by the screen; the server defaults it to UPCOMING. */
  status?: PeriodStatus;
}

export interface UpdatePeriodInput {
  name: string;
  startDate: string;
  endDate: string;
}

const BASE = '/admin/rik/entitlement-periods';

export function fetchPeriods(signal?: AbortSignal): Promise<PeriodListResponse> {
  return apiRequest<PeriodListResponse>(BASE, { signal });
}

export function createPeriod(input: CreatePeriodInput): Promise<EntitlementPeriod> {
  return apiRequest<EntitlementPeriod>(BASE, { method: 'POST', body: input });
}

export function updatePeriod(
  periodId: string,
  input: UpdatePeriodInput
): Promise<EntitlementPeriod> {
  return apiRequest<EntitlementPeriod>(`${BASE}/${periodId}`, { method: 'PATCH', body: input });
}

export function setPeriodStatus(
  periodId: string,
  status: PeriodStatus
): Promise<EntitlementPeriod> {
  return apiRequest<EntitlementPeriod>(`${BASE}/${periodId}/status`, {
    method: 'PATCH',
    body: { status },
  });
}
