/**
 * The category slug rule — one rule, in one place, for the whole project.
 *
 * WHAT A SLUG IS. The stable navigation key for a PIF category:
 * "Rice, Atta & Flour" becomes `rice-atta-and-flour`. The Customer App's
 * approved category tree already carries one for each of its 164 entries, and
 * the URLs the two shop screens navigate on are built from them.
 *
 * WHY THIS FILE EXISTS. The slug is about to live in the database as well
 * (`pif.categories.slug`, added by migration 0061), so the server has to be
 * able to derive one when a staff member creates a category through the Admin
 * Portal. There must be exactly one rule: if the server derived slugs even
 * slightly differently from the approved tree, a category typed in the portal
 * and the same category in the tree would navigate to two different URLs.
 *
 * THE RULE IS NOT NEW. It is transcribed, character for character, from
 * `scripts/gen-categories.cjs`, which generated the approved tree:
 *
 *     s.toLowerCase()
 *      .replace(/&/g, ' and ')
 *      .replace(/[/,]/g, ' ')
 *      .replace(/[^a-z0-9]+/g, '-')
 *      .replace(/^-+|-+$/g, '')
 *
 * `category-slug.spec.ts` asserts that this function reproduces all 164 slugs
 * in the approved tree exactly. That test reads the tree file itself rather
 * than a copied list, so the two cannot drift apart without the test failing.
 *
 * NOTHING CALLS THIS YET. It is deliberately unwired: the Admin Portal path
 * that will use it (`prepareCategory` in pif-catalogue.service.ts) also needs
 * the `slug` column, which does not exist until migration 0061. Wiring it in
 * is a later, separately approved step. This file adds the rule and its proof,
 * and changes no existing behaviour.
 *
 * ORDER OF THE FOUR STEPS MATTERS, and each one is doing a job:
 *
 *   1. lowercase first, so the character class in step 3 only has to admit
 *      lowercase letters.
 *   2. `&` becomes the word " and " — spaces on both sides, so "Salt & Sugar"
 *      gives `salt-and-sugar` and not `saltandsugar`. This must run before
 *      step 3, which would otherwise delete the `&` entirely.
 *   3. `/` and `,` become spaces rather than hyphens, so "Rava/Sooji" gives
 *      `rava-sooji` and "Rice, Atta" gives `rice-atta` — one separator, not
 *      two. Without this they would collapse to a run and step 4 would still
 *      be right, but the intent is clearer stated than inferred.
 *   4. every remaining run of non-slug characters becomes a single hyphen,
 *      then leading and trailing hyphens are trimmed.
 */

/**
 * Derive a category's slug from its display name.
 *
 * Returns the empty string for a name with no slug-able characters at all
 * (`""`, `"   "`, `"&&&"`). Callers must treat that as invalid rather than
 * store it: `pif_categories_slug_format_chk` (migration 0061) refuses it, and
 * `prepareCategory` will reject it with a message before the database has to.
 */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[/,]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
