import { apiRequest } from './client';

/**
 * Category navigation foundation for BOTH modules (STEP 9 kickoff
 * Section 10; spec RIK-2 and PIF-3).
 *
 * What this is: the reusable client + shape that category screens call.
 * What this is NOT: a catalogue. No taxonomy is hardcoded here — not
 * the 18 PIF examples the client listed, not a RIK category list.
 * Categories are administered data (backlog ADM-2), so this module's
 * job is to ask the server and render honestly when the server has
 * nothing to give yet.
 *
 * Today `/rik/categories` and `/pif/categories` do not exist —
 * RikModule and PifModule are still empty placeholders — so these
 * calls raise NotImplementedError and `useResource` reports
 * `not_implemented`. Screens show a "not built yet" state rather than
 * inventing categories to fill the space. When the catalogue phase
 * lands, only the server changes; these call sites do not.
 *
 * Subcategories are represented in the shape because the specification
 * requires them (PIF-3), but whether the frozen PIF schema can express
 * a parent/child hierarchy is an open risk (DR-2) to be settled at the
 * start of the catalogue phase — not decided here, and never by
 * altering the database.
 */
export type CatalogModule = 'rik' | 'pif';

export interface CategorySummary {
  id: string;
  name: string;
  /** Optional image supplied by the backend; absent today (AS-3). */
  imageUrl?: string | null;
  /** Present only where the module and schema support a hierarchy (PIF-3 / DR-2). */
  subcategories?: CategorySummary[];
}

/**
 * Categories for one module. The module is part of the path, never a
 * query flag the browser could flip to cross the RIK/PIF boundary:
 * the server owns that separation, and a RIK customer's request can
 * never be re-pointed at PIF data by editing a parameter.
 */
export function fetchCategories(module: CatalogModule, signal?: AbortSignal): Promise<CategorySummary[]> {
  return apiRequest<CategorySummary[]>(`/${module}/categories`, { signal });
}

/**
 * Products within a category. Paginated from the first call — the PIF
 * catalogue is specified for ~3,000+ SKUs (PIF-5), so there is no
 * "fetch everything" variant of this function to reach for later.
 */
export interface CategoryProductsQuery {
  categoryId: string;
  page?: number;
  pageSize?: number;
}

export function categoryProductsPath(module: CatalogModule, query: CategoryProductsQuery): string {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    pageSize: String(query.pageSize ?? 20),
  });
  return `/${module}/categories/${encodeURIComponent(query.categoryId)}/products?${params.toString()}`;
}
