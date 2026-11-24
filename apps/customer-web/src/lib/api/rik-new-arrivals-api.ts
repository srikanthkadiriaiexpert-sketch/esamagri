import { apiRequest } from './client';
import { mediaUrl } from './media-url';

/**
 * What RIK staff are currently featuring as newly introduced.
 *
 * A SHOP WINDOW, NOT AN ALLOWANCE. Appearing here means one thing: a member
 * of staff chose to highlight this. It says nothing about eligibility,
 * quantity or stock, and this module carries no field that could be mistaken
 * for one — the server does not send any.
 *
 * MOST LISTINGS STAND ALONE. Since the New Arrivals rework, staff type a
 * product name, write an optional line of copy and upload a picture. Such a
 * listing is not tied to the entitlement catalogue at all, so `code`,
 * `brand`, `unit`, `packSize`, `packUnit`, `issuePeriod` and `poolName` are
 * ALL NULL for it. A listing may still optionally be linked to a RIK
 * provision, and then those fields are populated from the catalogue.
 *
 * Every screen must therefore treat the catalogue fields as optional and
 * show them only when present, rather than rendering "null" or inventing a
 * placeholder. `id`, `name` and `imageRef` are the three that always matter.
 *
 * FETCHED, NEVER COMPILED IN. The list comes from the API on each visit, so a
 * listing published by staff appears the next time the screen is opened and
 * an unpublished one disappears just as quickly. Nothing about New Arrivals
 * is baked into the front-end bundle, which is why staff never need a
 * developer or a rebuild to change what customers see.
 */
export interface NewArrivalItem {
  /** The listing's own id. Stable, and present on every kind of listing. */
  id: string;
  /** The catalogue code, or null for a standalone listing. */
  code: string | null;
  /** The staff-typed name, or the catalogue name on a linked listing. */
  name: string;
  brand: string | null;
  /** Already resolved by the server; run through mediaUrl for the final address. */
  imageRef: string | null;
  /** The optional line of staff copy, or null. */
  headline: string | null;
  // Catalogue facts. All null on a standalone listing.
  unit: string | null;
  packSize: number | null;
  packUnit: string | null;
  issuePeriod: 'FRESH' | 'DRY' | null;
  poolName: string | null;
  /** The date it started being featured, or null if it was shown immediately. */
  publishedFrom: string | null;
}

export interface NewArrivals {
  /** The date the server resolved the published window against. */
  asOf: string;
  items: NewArrivalItem[];
}

export async function fetchRikNewArrivals(signal?: AbortSignal): Promise<NewArrivals> {
  const response = await apiRequest<NewArrivals>('/content/new-arrivals', { signal });
  return {
    asOf: response.asOf,
    // The image address is settled here, once, so no screen has to know the
    // difference between a committed catalogue asset and an uploaded one.
    items: response.items.map((item) => ({ ...item, imageRef: mediaUrl(item.imageRef) })),
  };
}

/**
 * "500 g", "1 piece", or null.
 *
 * Null for every standalone listing, because there is no pack to describe —
 * which is the ordinary case now, so callers must handle it.
 */
export function packLabel(item: NewArrivalItem): string | null {
  if (item.packSize === null) return null;
  const container = item.packUnit ?? item.unit;
  if (container === null) return null;
  return `${item.packSize.toLocaleString()} ${container}`;
}
