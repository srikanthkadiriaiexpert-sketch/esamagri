import { apiRequest, apiUpload } from './client';

/**
 * The RIK entitlement configuration API (STEP 11C).
 *
 * Every shape here mirrors a real route on apps/api's
 * RikAdminController. There are no fixtures behind any of them and no
 * screen may substitute one — `useResource` in this workspace has no
 * fallback parameter by design.
 *
 * Nothing in this file decides what a rule means. Quantities, ratios,
 * dietary applicability, effective windows and every refusal are the
 * server's: these functions send what the administrator typed and
 * render what comes back. That is the whole reason the seven screens
 * can exist without duplicating a single line of the entitlement
 * engine.
 *
 * Numeric columns arrive as STRINGS, deliberately. PostgreSQL `numeric`
 * is arbitrary-precision; turning 8.214286 into a JavaScript double on
 * the way through would quietly change a stored ratio. The screens
 * display these strings as they are and only parse when the
 * administrator is editing a value they typed themselves.
 */

export type RationType = 'FRESH' | 'DRY';
export type DietaryPreference = 'PV' | 'EV' | 'NV';
export type ConversionMode = 'AUTOMATIC' | 'ELECTIVE';

export interface ConfigPool {
  id: string;
  code: string;
  name: string;
  rationType: RationType;
  unit: string;
  description: string | null;
  /**
   * The category's cover picture (STEP 14B). This is the picture for the
   * whole allowance, not for an item inside it — a provision's own
   * picture lives on the provision. Null is ordinary and the customer
   * card shows a placeholder.
   */
  imageRef: string | null;
  displayOrder: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface ConfigScale {
  id: string;
  poolId: string;
  poolCode: string;
  poolName: string;
  poolUnit: string;
  dietaryPreference: DietaryPreference;
  dailyQty: string;
  notes: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface ConfigConversion {
  id: string;
  code: string;
  fromPoolId: string;
  fromPoolCode: string;
  toPoolId: string;
  toPoolCode: string;
  fromQty: string;
  toQty: string;
  mode: ConversionMode;
  dietaryPreference: DietaryPreference | null;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface ConfigProvision {
  id: string;
  poolId: string;
  poolCode: string;
  poolName: string;
  poolRationType: RationType;
  code: string;
  name: string;
  /**
   * Catalogue description (STEP 12A). Brand is a field of its own, so
   * one provision can be stocked from several brands without being
   * duplicated. `packUnit` is what the container is called and is NOT
   * `unit`, which is the entitlement unit the engine calculates in.
   */
  brand: string | null;
  /**
   * What is recorded: either a committed `/catalogue/rik/...` path typed into
   * the reference box, or a `rik/provisions/<uuid>.png` key an upload stored.
   */
  imageRef: string | null;
  /** The same value, resolved by the API to something a browser can load. */
  imageUrl: string | null;
  packUnit: string | null;
  unit: string;
  consumptionRatio: string;
  packSize: string | null;
  isLoose: boolean;
  isCustomerSelectable: boolean;
  /** Whole units only — a physical coupon cannot be issued in halves. */
  wholeUnitsOnly: boolean;
  maxQuantity: string | null;
  maxPacks: number | null;
  minEligibleDays: number | null;
  issuePeriod: RationType;
  dietaryPreference: DietaryPreference | null;
  displayOrder: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export interface ConfigHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

interface Listed<T> {
  items: T[];
}

const BASE = '/admin/rik/config';

// ------------------------------------------------------------- reads

export function fetchPools(signal?: AbortSignal): Promise<Listed<ConfigPool>> {
  return apiRequest<Listed<ConfigPool>>(`${BASE}/pools`, { signal });
}

/**
 * The same pool list, behind `rik.product.manage` instead of
 * `rik.entitlement.adjust`. The provision screens need pool names for
 * their pool picker; this route means they do not have to hold the
 * entitlement-rule permission just to show one.
 */
export function fetchPoolsForProvisions(signal?: AbortSignal): Promise<Listed<ConfigPool>> {
  return apiRequest<Listed<ConfigPool>>(`${BASE}/provision-pools`, { signal });
}

export function fetchScales(poolId?: string | null, signal?: AbortSignal): Promise<Listed<ConfigScale>> {
  const query = poolId ? `?poolId=${encodeURIComponent(poolId)}` : '';
  return apiRequest<Listed<ConfigScale>>(`${BASE}/scales${query}`, { signal });
}

export function fetchConversions(signal?: AbortSignal): Promise<Listed<ConfigConversion>> {
  return apiRequest<Listed<ConfigConversion>>(`${BASE}/conversions`, { signal });
}

export function fetchProvisions(poolId?: string | null, signal?: AbortSignal): Promise<Listed<ConfigProvision>> {
  const query = poolId ? `?poolId=${encodeURIComponent(poolId)}` : '';
  return apiRequest<Listed<ConfigProvision>>(`${BASE}/provisions${query}`, { signal });
}

export function fetchHistory(
  params: { entityType?: string | null; entityId?: string | null; limit?: number } = {},
  signal?: AbortSignal
): Promise<Listed<ConfigHistoryEntry>> {
  const query = new URLSearchParams();
  if (params.entityType) query.set('entityType', params.entityType);
  if (params.entityId) query.set('entityId', params.entityId);
  if (params.limit) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<Listed<ConfigHistoryEntry>>(`${BASE}/history${suffix}`, { signal });
}

// ------------------------------------------------------------ writes

export interface PoolDraft {
  code: string;
  name: string;
  rationType: RationType;
  unit: string;
  description?: string | null;
  imageRef?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function createPool(input: PoolDraft): Promise<ConfigPool> {
  return apiRequest<ConfigPool>(`${BASE}/pools`, { method: 'POST', body: input });
}

export function updatePool(id: string, patch: Partial<Omit<PoolDraft, 'code'>> & { isActive?: boolean }): Promise<ConfigPool> {
  return apiRequest<ConfigPool>(`${BASE}/pools/${id}`, { method: 'PATCH', body: patch });
}

export function setPoolActive(id: string, isActive: boolean): Promise<ConfigPool> {
  return apiRequest<ConfigPool>(`${BASE}/pools/${id}/active`, { method: 'POST', body: { isActive } });
}

export interface ScaleDraft {
  poolId: string;
  dietaryPreference: DietaryPreference;
  dailyQty: number;
  notes?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function createScale(input: ScaleDraft): Promise<ConfigScale> {
  return apiRequest<ConfigScale>(`${BASE}/scales`, { method: 'POST', body: input });
}

export function updateScale(
  id: string,
  patch: { dailyQty?: number; notes?: string | null; effectiveFrom?: string; effectiveTo?: string | null; isActive?: boolean }
): Promise<ConfigScale> {
  return apiRequest<ConfigScale>(`${BASE}/scales/${id}`, { method: 'PATCH', body: patch });
}

export function setScaleActive(id: string, isActive: boolean): Promise<ConfigScale> {
  return apiRequest<ConfigScale>(`${BASE}/scales/${id}/active`, { method: 'POST', body: { isActive } });
}

/** Close the current rule and open a new one from a date, keeping both readable. */
export function supersedeScale(
  id: string,
  input: { dailyQty: number; effectiveFrom: string; notes?: string | null }
): Promise<{ closed: ConfigScale; created: ConfigScale }> {
  return apiRequest<{ closed: ConfigScale; created: ConfigScale }>(`${BASE}/scales/${id}/supersede`, {
    method: 'POST',
    body: input,
  });
}

export interface ConversionDraft {
  code: string;
  fromPoolId: string;
  toPoolId: string;
  fromQty: number;
  toQty: number;
  mode: ConversionMode;
  dietaryPreference?: DietaryPreference | null;
  description?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function createConversion(input: ConversionDraft): Promise<ConfigConversion> {
  return apiRequest<ConfigConversion>(`${BASE}/conversions`, { method: 'POST', body: input });
}

export function updateConversion(
  id: string,
  patch: Partial<Omit<ConversionDraft, 'code'>> & { isActive?: boolean }
): Promise<ConfigConversion> {
  return apiRequest<ConfigConversion>(`${BASE}/conversions/${id}`, { method: 'PATCH', body: patch });
}

export function setConversionActive(id: string, isActive: boolean): Promise<ConfigConversion> {
  return apiRequest<ConfigConversion>(`${BASE}/conversions/${id}/active`, { method: 'POST', body: { isActive } });
}

export const PACK_UNITS = ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'tin', 'box'] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

export interface ProvisionDraft {
  poolId: string;
  code: string;
  name: string;
  brand?: string | null;
  imageRef?: string | null;
  packUnit?: PackUnit | null;
  unit: string;
  consumptionRatio: number;
  packSize?: number | null;
  isLoose?: boolean;
  isCustomerSelectable?: boolean;
  wholeUnitsOnly?: boolean;
  maxQuantity?: number | null;
  maxPacks?: number | null;
  minEligibleDays?: number | null;
  issuePeriod: RationType;
  dietaryPreference?: DietaryPreference | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function createProvision(input: ProvisionDraft): Promise<ConfigProvision> {
  return apiRequest<ConfigProvision>(`${BASE}/provisions`, { method: 'POST', body: input });
}

/**
 * One PATCH for every provision editor. The SKU master, the pack sizes
 * & limits screen and the issue period & availability screen are three
 * views of one table, so they send subsets of the same body to the same
 * route rather than each having a contract of its own to drift.
 */
export function updateProvision(
  id: string,
  patch: Partial<Omit<ProvisionDraft, 'code'>> & { isActive?: boolean }
): Promise<ConfigProvision> {
  return apiRequest<ConfigProvision>(`${BASE}/provisions/${id}`, { method: 'PATCH', body: patch });
}

export function setProvisionActive(id: string, isActive: boolean): Promise<ConfigProvision> {
  return apiRequest<ConfigProvision>(`${BASE}/provisions/${id}/active`, { method: 'POST', body: { isActive } });
}

export interface UploadedProvisionImage {
  id: string;
  code: string;
  imageRef: string;
  imageUrl: string;
  bytes: number;
  contentType: string;
}

/**
 * The one multipart call on this screen: the administrator's own image file.
 *
 * The same route replaces a picture, because every upload is stored under a
 * fresh key — so there is nothing to overwrite and no cache to bust. The
 * server deletes the file it replaced, but only when it was one of its own:
 * a committed `/catalogue/...` asset that an upload supersedes is left on
 * disk where the customer app's bundle needs it.
 */
export function uploadProvisionImage(id: string, file: File): Promise<UploadedProvisionImage> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<UploadedProvisionImage>(`${BASE}/provisions/${id}/image`, form);
}

export function removeProvisionImage(
  id: string
): Promise<{ id: string; code: string; imageRef: null; imageUrl: null }> {
  return apiRequest(`${BASE}/provisions/${id}/image`, { method: 'DELETE' });
}


// ----------------------------------------------- pickup locations (11E)

/**
 * Where a customer may collect a RIK issue.
 *
 * Business configuration the facility maintains here — "Naval Park" and
 * "Dolphin Hill" are rows in a table, not names in any source file, so
 * opening a third counter is a form submission rather than a release.
 */
export interface ConfigPickupLocation {
  id: string;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
}

export function fetchPickupLocations(signal?: AbortSignal): Promise<Listed<ConfigPickupLocation>> {
  return apiRequest<Listed<ConfigPickupLocation>>(`${BASE}/pickup-locations`, { signal });
}

export interface PickupLocationDraft {
  code: string;
  name: string;
  description?: string | null;
  displayOrder?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function createPickupLocation(input: PickupLocationDraft): Promise<ConfigPickupLocation> {
  return apiRequest<ConfigPickupLocation>(`${BASE}/pickup-locations`, { method: 'POST', body: input });
}

export function updatePickupLocation(
  id: string,
  patch: Partial<Omit<PickupLocationDraft, 'code'>> & { isActive?: boolean }
): Promise<ConfigPickupLocation> {
  return apiRequest<ConfigPickupLocation>(`${BASE}/pickup-locations/${id}`, { method: 'PATCH', body: patch });
}

export function setPickupLocationActive(id: string, isActive: boolean): Promise<ConfigPickupLocation> {
  return apiRequest<ConfigPickupLocation>(`${BASE}/pickup-locations/${id}/active`, {
    method: 'POST',
    body: { isActive },
  });
}

// ------------------------------------------------------- new arrivals
//
// Staff-curated listings of EXISTING RIK provisions for the customer New
// Arrivals screen. A different base path from the rest of this file —
// /admin/rik/new-arrivals rather than /admin/rik/config — because it is a
// merchandising decision rather than an entitlement rule, but it sits behind
// the same `rik.product.manage` permission as the provisions it features.
//
// NOTHING HERE CREATES A PRODUCT. `provisionId` always names a provision that
// already exists; `removeNewArrival` deletes the listing and leaves the
// catalogue entry alone. The server re-checks both.

const NEW_ARRIVALS = '/admin/rik/new-arrivals';

export interface NewArrivalListing {
  id: string;
  /** True for the ordinary listing, which names no catalogue product. */
  standalone: boolean;
  /** Set only on a listing deliberately linked to a RIK provision. */
  provisionId: string | null;
  /** The staff-typed name; null on a linked listing. */
  productName: string | null;
  /** The catalogue code; null on a standalone listing. */
  code: string | null;
  /** What to display: the catalogue name when linked, the typed one otherwise. */
  name: string;
  brand: string | null;
  poolName: string | null;
  headline: string | null;
  /** The listing's OWN uploaded picture, or null when it has none. */
  imageRef: string | null;
  imageUrl: string | null;
  hasOwnImage: boolean;
  /** What the customer card actually shows: the uploaded picture, else the catalogue one. */
  effectiveImageRef: string | null;
  effectiveImageUrl: string | null;
  isPublished: boolean;
  publishedFrom: string | null;
  publishedUntil: string | null;
  displayOrder: number;
  /** Null on a standalone listing, which has no catalogue state. */
  provisionIsActive: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export function fetchNewArrivals(signal?: AbortSignal): Promise<Listed<NewArrivalListing>> {
  return apiRequest<Listed<NewArrivalListing>>(NEW_ARRIVALS, { signal });
}

/**
 * A new listing.
 *
 * `productName` is what staff type and is the ordinary path. `provisionId`
 * is the optional catalogue link and is normally omitted entirely — send one
 * or the other, never both.
 *
 * `isPublished` cannot be true at creation for a standalone listing: its
 * image is uploaded to the row after it exists, and nothing goes live
 * without a picture. Create the draft, upload, then publish.
 */
export interface NewArrivalDraft {
  productName?: string;
  provisionId?: string;
  headline?: string | null;
  publishedFrom?: string | null;
  publishedUntil?: string | null;
  displayOrder?: number;
  isPublished?: boolean;
}

export function createNewArrival(input: NewArrivalDraft): Promise<NewArrivalListing> {
  return apiRequest<NewArrivalListing>(NEW_ARRIVALS, { method: 'POST', body: input });
}

export function updateNewArrival(
  id: string,
  patch: Omit<NewArrivalDraft, 'provisionId' | 'isPublished'>
): Promise<NewArrivalListing> {
  return apiRequest<NewArrivalListing>(`${NEW_ARRIVALS}/${id}`, { method: 'PATCH', body: patch });
}

export function setNewArrivalPublished(id: string, isPublished: boolean): Promise<NewArrivalListing> {
  return apiRequest<NewArrivalListing>(`${NEW_ARRIVALS}/${id}/published`, {
    method: 'POST',
    body: { isPublished },
  });
}

/**
 * Removes the LISTING. Any linked provision stays in the catalogue — the
 * server says so in its reply, and `provisionCode` is null when the listing
 * was standalone and referenced nothing in the first place.
 */
export function removeNewArrival(
  id: string
): Promise<{ removed: boolean; name: string; provisionCode: string | null; provisionDeleted: boolean }> {
  return apiRequest<{ removed: boolean; name: string; provisionCode: string | null; provisionDeleted: boolean }>(
    `${NEW_ARRIVALS}/${id}`,
    { method: 'DELETE' }
  );
}

/**
 * The listing's own PROMOTIONAL picture — separate from the product's
 * catalogue photograph, which is managed on the Provisions screen and is not
 * reachable from here. Uploading, replacing or removing this one never
 * changes the product's.
 *
 * Sent through `apiUpload`, not `apiRequest`: the browser has to write the
 * Content-Type itself so it carries the multipart boundary it generated.
 */
export function uploadNewArrivalImage(id: string, file: File): Promise<NewArrivalListing> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<NewArrivalListing>(`${NEW_ARRIVALS}/${id}/image`, form);
}

/**
 * Drops the listing's picture.
 *
 * A LINKED listing falls back to the catalogue image. A STANDALONE one has
 * nothing to fall back to, so the server also unpublishes it rather than
 * leaving a blank card on the customer screen; `unpublished` reports whether
 * that happened so the screen can say so.
 */
export function removeNewArrivalImage(
  id: string
): Promise<NewArrivalListing & { provisionImageChanged: boolean; unpublished: boolean }> {
  return apiRequest<NewArrivalListing & { provisionImageChanged: boolean; unpublished: boolean }>(
    `${NEW_ARRIVALS}/${id}/image`,
    { method: 'DELETE' }
  );
}
