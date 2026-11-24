/**
 * THE CATEGORIES THE CLIENT REJECTED, and the one place that knows them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THESE ARE
 * ---------------------------------------------------------------------------
 * They are the demonstration catalogue seeded by `database/demo/
 * demo-catalogue.sql`, whose own header says: "It is not the yard's
 * catalogue, it is not priced from any real price list, and nothing here
 * should survive the client's first import." The client has now said the
 * same thing in writing, naming all twelve. This module is how the customer
 * app stops showing them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FILTER AND NOT A DELETE
 * ---------------------------------------------------------------------------
 * These are rows in `pif.categories`, served by `/pif/categories`. Removing
 * them properly means deleting database records, which is explicitly out of
 * scope: no SQL, no migration, no schema change. So the customer app refuses
 * to surface them instead — on every path a customer can reach them by:
 * the shop listings, the category route, and search.
 *
 * The rows are untouched. An administrator can still see them, and the day
 * they are deleted or deactivated server-side this module quietly matches
 * nothing and can be removed.
 *
 * ---------------------------------------------------------------------------
 * WHY (name, parent) AND NOT NAME ALONE
 * ---------------------------------------------------------------------------
 * Two of the rejected names also exist in the APPROVED 19/135 taxonomy:
 *
 *   "Beverages"  — rejected as a demo top-level category,
 *                  approved as Grocers main category #11
 *   "Rice"       — rejected as a demo child of "Staples",
 *                  approved as a shelf under "Rice, Atta & Flour"
 *
 * Matching on the name alone would therefore hide approved categories the
 * day the real catalogue is imported. Every entry below is keyed on its
 * parent as well, exactly as the seed file defines it, so the demo "Rice"
 * under "Staples" is rejected and an approved "Rice" under anything else is
 * not.
 *
 * KNOWN LIMIT, and it is a real one: a product returned by `/pif/search`
 * carries only `categoryName`, never its parent. Search filtering therefore
 * has to match on the name, and it does so against the names of the
 * categories that are ACTUALLY REJECTED IN THE LIVE TREE rather than
 * against this list directly — so once the demo rows are gone from the
 * database the search filter matches nothing by itself. While both a demo
 * "Rice" and an approved "Rice" exist at the same time, search would hide
 * both. That window is the import, and it is flagged rather than hidden.
 */

/** The minimum shape this module needs; `PifCategoryNode` satisfies it. */
export interface CategoryLike {
  readonly id: string;
  readonly name: string;
}

export interface CategoryTreeLike extends CategoryLike {
  readonly subcategories: readonly CategoryLike[];
}

/** `parent: null` means a top-level category. Names as the seed spells them. */
const REJECTED: ReadonlyArray<{ readonly name: string; readonly parent: string | null }> = [
  { name: 'Staples', parent: null },
  { name: 'Pulses', parent: null },
  { name: 'Oils & Ghee', parent: null },
  { name: 'Dairy', parent: null },
  { name: 'Snacks & Biscuits', parent: null },
  { name: 'Beverages', parent: null },
  { name: 'Household', parent: null },
  { name: 'Rice', parent: 'Staples' },
  { name: 'Atta & Flours', parent: 'Staples' },
  { name: 'Sugar & Salt', parent: 'Staples' },
  { name: 'Dals', parent: 'Pulses' },
  { name: 'Milk & Curd', parent: 'Dairy' },
];

/** How many the client rejected. Asserted by the tests so the list can't drift. */
export const REJECTED_CATEGORY_COUNT = REJECTED.length;

const key = (name: string, parent: string | null): string =>
  `${(parent ?? '').trim().toLowerCase()}\u0000${name.trim().toLowerCase()}`;

const REJECTED_KEYS: ReadonlySet<string> = new Set(REJECTED.map((r) => key(r.name, r.parent)));

/** Is this top-level category one the client rejected? */
export function isRejectedMain(name: string): boolean {
  return REJECTED_KEYS.has(key(name, null));
}

/** Is this child of `parentName` one the client rejected? */
export function isRejectedChild(name: string, parentName: string): boolean {
  return REJECTED_KEYS.has(key(name, parentName));
}

/**
 * The live tree with every rejected entry taken out.
 *
 * A rejected top-level category takes its children with it — leaving "Rice"
 * on screen after removing "Staples" would be the "hid the tile, kept the
 * route" outcome the client ruled out. A main that survives keeps only its
 * approved children.
 */
export function approvedCategories<T extends CategoryTreeLike>(tree: readonly T[]): T[] {
  return tree
    .filter((node) => !isRejectedMain(node.name))
    .map((node) => ({
      ...node,
      subcategories: node.subcategories.filter((child) => !isRejectedChild(child.name, node.name)),
    }));
}

/**
 * Every category id in the live tree that the client rejected — mains and
 * children alike. Used to refuse `/pif/categories/:id`, which is reachable
 * by typed URL, by a stale link and by the back button regardless of what
 * any listing chooses to draw.
 */
export function rejectedCategoryIds(tree: readonly CategoryTreeLike[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of tree) {
    const mainRejected = isRejectedMain(node.name);
    if (mainRejected) ids.add(node.id);
    for (const child of node.subcategories) {
      if (mainRejected || isRejectedChild(child.name, node.name)) ids.add(child.id);
    }
  }
  return ids;
}

/**
 * The lower-cased NAMES of the rejected categories as they actually appear
 * in the live tree, for filtering search results by `categoryName`.
 *
 * Derived from live data on purpose: when the demo rows leave the database
 * this returns an empty set and the search filter stops doing anything,
 * rather than carrying a hard-coded blocklist forward into the real
 * catalogue. See the KNOWN LIMIT note at the top of this file.
 */
export function rejectedCategoryNames(tree: readonly CategoryTreeLike[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const node of tree) {
    const mainRejected = isRejectedMain(node.name);
    if (mainRejected) names.add(node.name.trim().toLowerCase());
    for (const child of node.subcategories) {
      if (mainRejected || isRejectedChild(child.name, node.name)) {
        names.add(child.name.trim().toLowerCase());
      }
    }
  }
  return names;
}

/** Does this product sit in a rejected category? `null` names are kept. */
export function isRejectedProduct(
  product: { readonly categoryName?: string | null },
  rejectedNames: ReadonlySet<string>
): boolean {
  const name = product.categoryName;
  if (name === null || name === undefined) return false;
  return rejectedNames.has(name.trim().toLowerCase());
}
