import { apiRequest } from './client';

/**
 * Know Your Ration — the customer's own RIK entitlement (STEP 11D).
 *
 * Every shape below mirrors the real `RikController` response exactly.
 * There is no fixture behind any of it and no fallback: an entitlement
 * figure the customer might act on must never be invented by the
 * browser.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE.
 *
 * The backend is the only thing that calculates. This module therefore
 * contains no arithmetic at all — no `dailyScale * eligibleDays`, no
 * `quantity * consumptionRatio`, no subtraction of consumed from total.
 * Every number the customer sees arrives already computed, and after
 * any change the client re-reads what the server says rather than
 * predicting it. If a figure is needed and is not in these types, the
 * answer is to return it from the engine, never to derive it here.
 *
 * NO CUSTOMER ID APPEARS ANYWHERE IN THIS FILE, deliberately. The
 * server resolves identity from the verified access token on every one
 * of these routes, so there is no id in the browser to tamper with and
 * no request shape that could carry someone else's.
 */

export type DietaryPreference = 'PV' | 'EV' | 'NV';
export type RationType = 'FRESH' | 'DRY';

export interface RationPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

/** An item the customer may take, with the limits the facility set on it. */
export interface EntitlementProvision {
  provisionId: string;
  code: string;
  name: string;
  /**
   * Catalogue description (STEP 12A). The brand is its own field so the
   * screen can show "Paneer / Amul / 200 g" without the brand ever being
   * written into the name, and so two dairies' paneer are two rows of
   * one item rather than two items. `packUnit` is what the container is
   * called; `unit` beside it is the entitlement unit. Each is null where
   * the facility has not recorded one, and nothing is ever invented to
   * fill the gap — an absent image shows a placeholder.
   */
  brand: string | null;
  imageRef: string | null;
  packUnit: string | null;
  unit: string;
  /** Pool units one unit of this item costs. Shown as an alternative's "rate". */
  consumptionRatio: number;
  /** null where the facility has not recorded one — never substitute a value. */
  packSize: number | null;
  isLoose: boolean;
  /**
   * Whole numbers only — a physical coupon cannot be issued in halves. The
   * server is the authority and refuses with WHOLE_UNITS_ONLY; this is here
   * so the box can step and round locally rather than letting an officer
   * type something that was always going to be rejected.
   */
  wholeUnitsOnly: boolean;
  maxQuantity: number | null;
  maxPacks: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  /** The ceiling the server will accept, already narrowed by every limit. */
  maxSelectableQuantity: number;
  selectedQuantity: number;
  /** What the selected quantity costs the shared balance — server-computed. */
  selectedPoolEquivalentQty: number;
}

/** Allowed by diet, blocked by a condition — carries the server's own reason. */
export interface UnavailableProvision {
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  imageRef: string | null;
  packUnit: string | null;
  unit: string;
  packSize: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  reason: string;
}

export interface AutomaticConversion {
  code: string;
  fromDailyQty: number;
  toDailyQty: number;
  description: string | null;
}

export interface ConversionOption {
  conversionId: string;
  code: string;
  fromPoolId: string;
  toPoolId: string;
  fromDailyQty: number;
  toDailyQty: number;
  description: string | null;
  selected: boolean;
}

/**
 * One entitlement balance. Everything in `provisions` draws on the same
 * `remaining`, which is what makes choosing one alternative reduce what
 * is left for the others.
 */
export interface EntitlementCategory {
  poolId: string;
  code: string;
  name: string;
  unit: string;
  description: string | null;
  /**
   * The category's cover picture (STEP 14B), or null where the facility
   * has not recorded one — the card then shows its placeholder. This is
   * the picture for the WHOLE allowance and is not a provision picture;
   * the two live on different rows and neither stands in for the other.
   */
  imageRef: string | null;
  dailyScale: number;
  /** Daily quantity after automatic and elected conversions are applied. */
  effectiveDailyQty: number;
  eligibleDays: number;
  totalEntitlement: number;
  consumed: number;
  remaining: number;
  /** Full-precision figures; the three above are the customer-facing ones. */
  precise: { totalEntitlement: number; consumed: number; remaining: number };
  automaticConversions: AutomaticConversion[];
  conversionOptions: ConversionOption[];
  surrendered: boolean;
  provisions: EntitlementProvision[];
  unavailableProvisions: UnavailableProvision[];
}

export type FulfillmentType = 'PICKUP' | 'DELIVERY';
export type SelectionStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

/** Where a customer may collect. Configuration, never a hard-coded list. */
export interface PickupLocation {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

/**
 * What was chosen at confirmation, as it was recorded.
 *
 * `pickupLocationName` and `deliveryAddress` are the server's
 * snapshots. Renaming a collection point or moving house does not
 * change what a confirmed issue says.
 */
export interface SelectionFulfillment {
  type: FulfillmentType;
  pickupLocationName: string | null;
  deliveryAddress: string | null;
}

/**
 * The state of this customer's selection. `null` until they choose
 * something. Once CONFIRMED it is read-only, and the server refuses
 * every change — the screens reflect that, they do not enforce it.
 */
export interface SelectionState {
  selectionId: string;
  status: SelectionStatus;
  referenceNumber: string | null;
  confirmedAt: string | null;
  availabilityAcknowledged: boolean;
  acknowledgedAt: string | null;
  fulfillment: SelectionFulfillment | null;
}

export interface EntitlementResponse {
  period: RationPeriod;
  dietaryPreference: DietaryPreference;
  eligibleDays: number;
  fresh: EntitlementCategory[];
  dry: EntitlementCategory[];
  selection: SelectionState | null;
}

export type ValidationFailureReason =
  | 'PROVISION_NOT_FOUND'
  | 'PROVISION_UNAVAILABLE'
  | 'POOL_NOT_APPLICABLE'
  | 'EXCEEDS_ENTITLEMENT'
  | 'EXCEEDS_MAX_QUANTITY'
  | 'EXCEEDS_MAX_PACKS'
  | 'WHOLE_UNITS_ONLY'
  | 'MIN_ELIGIBLE_DAYS_NOT_MET'
  | 'CONFLICTING_ELECTIONS'
  | 'SELECTION_NOT_OPEN';

export interface ValidationFailure {
  ok: false;
  reason: ValidationFailureReason;
  message: string;
  detail: {
    provisionId?: string;
    provisionCode?: string;
    poolId?: string;
    poolCode?: string;
    unit?: string;
    entitlement?: number;
    alreadyConsumed?: number;
    requestedEquivalent?: number;
    remaining?: number;
    maxQuantity?: number;
    maxPacks?: number;
    minEligibleDays?: number;
  };
}

export interface ValidationSuccess {
  ok: true;
  provisionId?: string;
  poolId?: string;
  quantity?: number;
  consumptionRatio?: number;
  poolEquivalentQty?: number;
  remainingAfter?: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * A refused change comes back with HTTP 200 and `ok: false`, alongside
 * the entitlement as it still stands. That is not an error condition —
 * it is the server declining and saying why, which is exactly what the
 * screen needs in order to explain itself without guessing.
 */
export interface SelectionResponse {
  result: ValidationResult;
  entitlement: EntitlementResponse;
}

export interface ConfirmResponse {
  selectionId: string;
  status: 'CONFIRMED';
  confirmation: SelectionState;
  entitlement: EntitlementResponse;
}

/**
 * Everything the customer must supply to confirm.
 *
 * Note what is absent: no price, no total, no payment reference, no
 * tax. A RIK issue is an entitlement being drawn, not a purchase, and
 * this contract has no room to pretend otherwise.
 */
export interface ConfirmRequest {
  /** Must be explicitly true. The server refuses anything else. */
  availabilityAcknowledged: boolean;
  fulfillmentType: FulfillmentType;
  /** Required for PICKUP — an id, so the server snapshots its own name. */
  pickupLocationId?: string;
  /** Required for DELIVERY. Stored verbatim as the historical record. */
  deliveryAddress?: string;
}

// ------------------------------------------------------------- calls

export function fetchEntitlement(
  options: { periodId?: string; issuePeriod?: RationType } = {},
  signal?: AbortSignal
): Promise<EntitlementResponse> {
  const query = new URLSearchParams();
  if (options.periodId) query.set('periodId', options.periodId);
  if (options.issuePeriod) query.set('issuePeriod', options.issuePeriod);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<EntitlementResponse>(`/rik/entitlements/current${suffix}`, { signal });
}

/** Ask whether a quantity would be accepted, without writing anything. */
export function validateQuantity(provisionId: string, quantity: number): Promise<{ result: ValidationResult }> {
  return apiRequest<{ result: ValidationResult }>('/rik/entitlements/validate', {
    method: 'POST',
    body: { provisionId, quantity },
  });
}

/**
 * Set the absolute quantity of one item. Zero removes it.
 *
 * Absolute, not a delta — so a stale screen or a double tap cannot
 * accumulate a quantity the customer never chose.
 */
export function setProvisionQuantity(provisionId: string, quantity: number): Promise<SelectionResponse> {
  return apiRequest<SelectionResponse>('/rik/selections/quantity', {
    method: 'POST',
    body: { provisionId, quantity },
  });
}

/** Replace the chosen alternatives. Sending [] takes none of them. */
export function setElections(conversionIds: string[]): Promise<SelectionResponse> {
  return apiRequest<SelectionResponse>('/rik/selections/elections', {
    method: 'POST',
    body: { conversionIds },
  });
}

/** The collection points on offer right now, from configuration. */
export function fetchPickupLocations(signal?: AbortSignal): Promise<{ items: PickupLocation[] }> {
  return apiRequest<{ items: PickupLocation[] }>('/rik/fulfillment/pickup-locations', { signal });
}

/**
 * Confirm the selection. The SAME endpoint the engine has always used,
 * now carrying the acknowledgement and the fulfillment.
 *
 * Calling it twice is safe: the second call is refused with
 * ALREADY_CONFIRMED and the existing reference, never a second record.
 */
export function confirmSelection(request: ConfirmRequest): Promise<ConfirmResponse> {
  return apiRequest<ConfirmResponse>('/rik/selections/confirm', { method: 'POST', body: request });
}

// ------------------------------------------------- display helpers
// Formatting only. Nothing below decides what a customer is entitled
// to, computes a balance or applies a rule — each takes a number the
// server already produced and makes it readable.

/** "13,500 g" — grouping and a unit, nothing more. */
export function formatQuantity(value: number, unit: string): string {
  return `${value.toLocaleString()} ${unit}`;
}

/**
 * How an alternative's rate reads to a customer: "1 g = 4.5 g of your
 * Cereals entitlement". The ratio itself comes from the server; this
 * only chooses the words.
 */
export function describeRate(provision: EntitlementProvision, categoryUnit: string): string {
  // "1 coupon uses 500 ml" where the facility recorded what one of them is
  // called, "1 g uses 2.5 ml" where it is a measure. Same sentence, same
  // figure from the server; only the noun differs.
  const noun = countNoun(provision) ?? provision.unit;
  return `1 ${noun} uses ${provision.consumptionRatio.toLocaleString()} ${categoryUnit}`;
}

/**
 * Units that name a container rather than a measure. The distinction
 * matters because `packSize` is always recorded in the item's own
 * entitlement `unit` — a 500 in the pack size column of an item
 * measured in grams is five hundred grams, whatever the pack unit says.
 *
 * So a container pack unit is *added* to the measure ("500 g tin") and
 * a measure pack unit is left off, because the measure is already
 * there and reprinting the pack size against a second measure would
 * state a quantity nobody recorded.
 */
const CONTAINER_PACK_UNITS = ['piece', 'packet', 'tin', 'box', 'coupon'];

/**
 * What ONE of this item is called when you count it.
 *
 * An entitlement unit of `piece` is a count, not a measure, and "3 piece"
 * is not something anyone says. Where the facility has recorded what the
 * thing actually is — a coupon, a packet, a tin — that noun is used; where
 * it has not, the entitlement unit stands, which is what every item did
 * before this existed. Nothing here reads a provision's NAME or CODE: the
 * noun is configuration, exactly like the ratio beside it.
 *
 * Measures are left alone. Milk TD is weighed, so it stays "g".
 */
export function countNoun(provision: { unit: string; packUnit: string | null }): string | null {
  if (provision.unit !== 'piece') return null;
  if (provision.packUnit === null || !CONTAINER_PACK_UNITS.includes(provision.packUnit)) return null;
  return provision.packUnit;
}

/** "3 coupons", "1 coupon", "1,500 ml" — the quantity as a customer reads it. */
export function formatProvisionQuantity(
  provision: { unit: string; packUnit: string | null },
  value: number
): string {
  const noun = countNoun(provision);
  if (noun === null) return formatQuantity(value, provision.unit);
  return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
}

/** The label above the quantity box: "Number of coupons" or "Quantity in ml". */
export function quantityFieldLabel(provision: { unit: string; packUnit: string | null }): string {
  const noun = countNoun(provision);
  return noun === null ? `Quantity in ${provision.unit}` : `Number of ${noun}s`;
}

/**
 * The pack, as a customer reads it (STEP 12A). Returns null where the
 * facility recorded neither a size nor a container, so the caller can
 * say "not specified" rather than print an invented pack.
 */
export function formatPack(provision: {
  packSize: number | null;
  unit: string;
  packUnit: string | null;
}): string | null {
  const container =
    provision.packUnit !== null && CONTAINER_PACK_UNITS.includes(provision.packUnit) ? provision.packUnit : null;

  if (provision.packSize === null) return container === null ? null : `1 ${container}`;

  const measure = formatQuantity(provision.packSize, provision.unit);
  return container === null ? measure : `${measure} ${container}`;
}

/** The category a provision is listed under, for the two issue-day tabs. */
export function issuePeriodLabel(issuePeriod: RationType): string {
  return issuePeriod === 'FRESH' ? 'Fresh issue' : 'Dry issue';
}
