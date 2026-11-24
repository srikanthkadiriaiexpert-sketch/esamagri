import { apiRequest } from './client';
import { mediaUrl } from './media-url';

/**
 * The RIK catalogue as a reference list — every active provision, the same
 * for every officer.
 *
 * NOT the entitlement API. `rik-entitlement-api.ts` answers what one officer
 * may take this period and carries the figures that decide it; this answers
 * what the facility stocks. Nothing here is scoped to a person, and nothing
 * here carries a ratio, a limit or a dietary rule — the server does not send
 * them.
 */
export interface CatalogueItem {
  /** The stable business key. Nutrition is matched on this, never on a uuid. */
  code: string;
  name: string;
  brand: string | null;
  /** Already resolved by the server; run through mediaUrl for the final address. */
  imageRef: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  isLoose: boolean;
  issuePeriod: 'FRESH' | 'DRY';
  poolCode: string | null;
  poolName: string | null;
}

export interface Catalogue {
  /** The date the server resolved the active window against. */
  asOf: string;
  items: CatalogueItem[];
}

export async function fetchRikCatalogue(signal?: AbortSignal): Promise<Catalogue> {
  // COMMON CONTENT. This moved from `/rik/catalogue` to `/content/catalogue`
  // under the common-customer-experience decision: a reference list of what
  // the food IS carries no entitlement rule — no ratio, no maximum, no
  // minimum eligible days, no dietary applicability — and so belongs to
  // every resident, not only the ration-approved ones. The response shape is
  // byte-for-byte what it was; only the address and the audience changed.
  const response = await apiRequest<Catalogue>('/content/catalogue', { signal });
  return {
    asOf: response.asOf,
    // The image address is settled here, once, so no screen has to know the
    // difference between a committed catalogue asset and an uploaded one.
    items: response.items.map((item) => ({ ...item, imageRef: mediaUrl(item.imageRef) })),
  };
}

/** "500 g", "1 piece", or null where the facility recorded no pack. */
export function packLabel(item: CatalogueItem): string | null {
  if (item.packSize === null) return null;
  const container = item.packUnit ?? item.unit;
  return `${item.packSize.toLocaleString()} ${container}`;
}
