import { useNavigate, useParams } from 'react-router-dom';
import { CategoryTileGrid } from '../../../design-system/CategoryTileGrid';
import { ProductCard } from '../../../design-system/ProductCard';
import { LoadingState, EmptyState, ErrorState } from '../../../design-system/StateViews';
import type { CategorySidebarGroup } from '../../../design-system/CategorySidebar';
import { useResource } from '../../../lib/api/resource';
import { usePifCart } from '../../../lib/cart/PifCartContext';
import {
  fetchPifCategories,
  fetchPifCategoryProducts,
  type PifCategoryNode,
  type PifCategorySummary,
  type PifProductPage,
} from '../../../lib/api/pif-api';
import { categoryImage } from '../../../lib/businesses/category-images';
import { ACCENTS } from '../../../lib/businesses/accents';
import { findBusiness } from '../../../lib/businesses/businesses';
import {
  FRESH_MART_CATEGORIES,
  type MainCategory,
  type SubCategory,
} from '../../../lib/businesses/category-tree';
import { ShopScreen, type Crumb } from './ShopScreen';

/**
 * Fresh Mart — the approved mobile-first screen.
 *
 * All of the chrome (header, logo, Payment Issue Facility line, delivery pin
 * delivery point, real cart, search, drawer, breadcrumb, hero, five-item
 * bottom bar) lives in <ShopScreen>, which Grocers uses too. This file
 * supplies only what is Fresh Mart's: which categories go where, how a slug
 * becomes a URL, and what sits below the hero.
 *
 * CATEGORIES ARE ON THE SCREEN, NOT ONLY BEHIND THE MENU BUTTON. They used
 * to live solely in the drawer, so browsing Fresh Mart began with a tap on a
 * hamburger — the one interaction a shopping app should never require to see
 * what is for sale. The screen now follows the Grocers pattern exactly:
 *
 *   /pif/fresh-mart                      — every main category with ITS
 *                                          subcategories as a tile grid, so
 *                                          all ten entries are visible on
 *                                          arrival without opening anything
 *   /pif/fresh-mart/:mainSlug            — that main's subcategories as a
 *                                          grid, plus the sibling rail
 *   /pif/fresh-mart/:mainSlug/:subSlug   — the rail and the product area;
 *                                          no grid, because the rail already
 *                                          carries the same siblings
 *
 * WHY THE HOME SHOWS SUBCATEGORIES AND GROCERS' DOES NOT: Grocers has
 * nineteen mains, which fill a screen on their own. Fresh Mart has two, and
 * a home screen offering a choice between two tiles would be a wasted tap.
 * Same component, same tile, same interaction — a different amount of tree,
 * which is the same reason the two drawers already differ.
 *
 * THE DRAWER IS UNCHANGED: all ten entries under their two headings.
 *
 * THE PRODUCT AREA IS REAL. It used to be a fixed "catalogue not loaded"
 * notice, written when no Fresh Mart product existed and a product panel
 * would have been fiction. Products exist now, so opening a shelf resolves
 * its slug to the server's own category id and lists that category's
 * products through /pif/categories/:id/products — the same endpoint and the
 * same <ProductCard> that search, the home row and the Grocers shelves
 * already use, so a card, its price, its availability and its Add button
 * behave identically wherever the reader meets them.
 *
 * NOTHING IS INVENTED STILL. Every figure on a card comes from the server;
 * this file computes no price and counts no stock. An empty shelf now means
 * the catalogue returned nothing for that category, which is a fact, where
 * before it was a sentence.
 *
 * NO BLOCKLIST HERE, unlike Grocers. GrocersShopPage resolves against
 * approvedCategories() because "Beverages" is both an approved Grocers main
 * and one of the twelve rejected demo categories. No Fresh Mart name collides
 * with that list, so this file does not import it and resolves against the
 * live tree as served.
 *
 * NO PARENT FALLBACK. If a subcategory is open and its slug cannot be
 * resolved, this screen shows the empty state rather than quietly listing the
 * whole main category's products: a shelf must show its own stock or none.
 *
 * THE HOME SCREEN IS UNCHANGED, deliberately and by instruction.
 */
export function FreshMartShopPage() {
  const navigate = useNavigate();
  const { mainSlug, subSlug } = useParams<{ mainSlug?: string; subSlug?: string }>();

  const business = findBusiness('fresh-mart')!;
  const accent = ACCENTS[business.accent];
  const tree: readonly MainCategory[] = FRESH_MART_CATEGORIES;

  const main = tree.find((m) => m.slug === mainSlug) ?? null;
  const sub: SubCategory | null =
    main === null ? null : (main.subcategories.find((s) => s.slug === subSlug) ?? null);

  const cart = usePifCart();

  /*
   * ONE REQUEST PER VISIT. The deps are `[]`, so moving between shelves
   * re-uses the tree already in hand; only the product call below repeats,
   * keyed on the category actually selected.
   */
  const liveCategories = useResource<PifCategoryNode[]>(() => fetchPifCategories(), undefined, []);
  const liveTree: readonly PifCategoryNode[] =
    liveCategories.status === 'success' ? liveCategories.data : [];

  /*
   * SLUG -> REAL CATEGORY ID. BY SLUG, NEVER BY NAME.
   *
   * Migration 0061 added pif.categories.slug and 0062 filled it from this very
   * tree, so both sides share one stable key. Matching on name would be wrong:
   * "Rice" is an approved Grocers shelf AND a demo subcategory of "Staples",
   * and "Beverages" exists twice too. Fresh Mart has no such collision today,
   * but the rule is the rule.
   */
  const apiMain = bySlug(liveTree, main?.slug);
  const apiSub =
    apiMain === null || sub === null ? null : bySlug(apiMain.subcategories, sub.slug);

  /*
   * NO PARENT FALLBACK: with a subcategory open, an unresolved slug yields
   * null and the empty state, never the parent's whole product list.
   */
  const selectedCategoryId = sub !== null ? (apiSub?.id ?? null) : (apiMain?.id ?? null);

  const products = useResource<PifProductPage>(
    () =>
      selectedCategoryId === null
        ? Promise.resolve({ items: [], total: 0, page: 1, pageSize: 0 })
        : fetchPifCategoryProducts(selectedCategoryId),
    undefined,
    [selectedCategoryId]
  );

  const shelfLoading = liveCategories.status === 'loading' || products.status === 'loading';
  const shelfFailed = liveCategories.status === 'error' || products.status === 'error';
  const shelfUnbuilt =
    liveCategories.status === 'not_implemented' || products.status === 'not_implemented';
  const shelfItems = products.status === 'success' ? products.data.items : null;

  const groups: readonly CategorySidebarGroup[] = tree.map((m) => ({
    label: m.name,
    head: asEntry(m),
    items: m.subcategories,
  }));

  /** Where a slug lives in the tree, so the drawer can jump to any level. */
  const hrefFor = (slug: string): string => {
    const asMain = tree.find((m) => m.slug === slug);
    if (asMain !== undefined) return `/pif/fresh-mart/${asMain.slug}`;
    const parent = tree.find((m) => m.subcategories.some((s) => s.slug === slug));
    return `/pif/fresh-mart/${parent?.slug ?? tree[0]!.slug}/${slug}`;
  };

  const breadcrumb: Crumb[] = [
    main === null
      ? { label: 'Fresh Mart' }
      : { label: 'Fresh Mart', onClick: () => navigate('/pif/fresh-mart') },
  ];
  if (main !== null) {
    breadcrumb.push(
      sub === null
        ? { label: main.name }
        : { label: main.name, onClick: () => navigate(`/pif/fresh-mart/${main.slug}`) }
    );
  }
  if (sub !== null) breadcrumb.push({ label: sub.name });

  const heroSlug = sub?.slug ?? main?.slug ?? null;

  return (
    <ShopScreen
      businessSlug="fresh-mart"
      drawerGroups={groups}
      drawerLabel="Fresh Mart categories"
      drawerTitle={main === null ? 'Fresh Mart categories' : main.name}
      {...(main === null ? {} : { railItems: main.subcategories })}
      selectedSlug={sub?.slug ?? main?.slug ?? null}
      onSelect={(slug) => navigate(hrefFor(slug), { replace: true })}
      searchPlaceholder="Search fruits, vegetables…"
      breadcrumb={breadcrumb}
      heroTitle={sub?.name ?? main?.name ?? business.name}
      heroBlurb={
        main === null
          ? 'Fresh produce from the facility, delivered to your quarters.'
          : `${main.name} from the facility, delivered to your quarters.`
      }
      heroImage={heroSlug === null ? null : categoryImage('fresh-mart', heroSlug)}
    >
      {main === null ? (
        // The home: every main, each above its own subcategories.
        <div className="flex flex-col">
          {tree.map((m) => (
            <section
              key={m.slug}
              className="px-4 pb-1 pt-4"
              aria-labelledby={`fresh-mart-${m.slug}-heading`}
            >
              <h2
                id={`fresh-mart-${m.slug}-heading`}
                className="mb-2.5 text-sm font-bold text-slate-900"
              >
                {m.name}
              </h2>
              <CategoryTileGrid
                testId={`category-grid-${m.slug}`}
                items={m.subcategories}
                selectedSlug={null}
                onSelect={(slug) => navigate(`/pif/fresh-mart/${m.slug}/${slug}`)}
                label={`${m.name} subcategories`}
                imageFor={(slug) => categoryImage('fresh-mart', slug)}
                wash={accent.wash}
                heading={accent.heading}
              />
            </section>
          ))}
          <div className="px-4 pb-4 pt-4">
            <EmptyState
              title="Catalogue not loaded yet"
              description="No products have been added to Fresh Mart. Prices and availability appear here once the real Fresh Mart catalogue is supplied."
              action={{ label: 'Back to all businesses', onClick: () => navigate('/pif') }}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Inside a main, the grid is the way to a shelf. Once a shelf is
              open the rail beside the content carries the same siblings, so
              repeating them as cards would push the product area off the
              screen for nothing. This is the Grocers rule, unchanged. */}
          {sub !== null ? null : (
            <section className="p-4" aria-labelledby="fresh-mart-subcategories-heading">
              <h2
                id="fresh-mart-subcategories-heading"
                className="mb-2.5 text-sm font-bold text-slate-900"
              >
                {main.name}
              </h2>
              {main.subcategories.length === 0 ? (
                <EmptyState title="This category has no subcategories" />
              ) : (
                <CategoryTileGrid
                  items={main.subcategories}
                  selectedSlug={null}
                  onSelect={(slug) => navigate(`/pif/fresh-mart/${main.slug}/${slug}`)}
                  label={`${main.name} subcategories`}
                  imageFor={(slug) => categoryImage('fresh-mart', slug)}
                  wash={accent.wash}
                  heading={accent.heading}
                />
              )}
            </section>
          )}

          <section className="px-4 pb-4 pt-4" aria-labelledby="fresh-mart-products-heading">
            {/* The hero already names the shelf; this is for screen readers,
                and keeps the visual layout exactly as approved. */}
            <h2 id="fresh-mart-products-heading" className="sr-only">
              {sub?.name ?? main.name} products
            </h2>

            {shelfLoading ? <LoadingState /> : null}

            {!shelfLoading && shelfFailed ? (
              <ErrorState onRetry={() => window.location.reload()} />
            ) : null}

            {!shelfLoading && !shelfFailed && shelfUnbuilt ? (
              <ErrorState
                variant="not_implemented"
                description="The catalogue is being built and will appear here soon."
              />
            ) : null}

            {/* EMPTY ONLY WHEN IT REALLY IS EMPTY. This renders after a
                successful call that returned no rows — never while loading,
                never after a failure, and never because the screen declined
                to ask. */}
            {!shelfLoading && !shelfFailed && !shelfUnbuilt && shelfItems?.length === 0 ? (
              <EmptyState
                title="Catalogue not loaded yet"
                description={`No products have been added to ${sub?.name ?? main.name}. Prices and availability appear here once the real Fresh Mart catalogue is supplied.`}
                action={{ label: 'Back to all businesses', onClick: () => navigate('/pif') }}
              />
            ) : null}

            {shelfItems !== null && shelfItems.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {shelfItems.map((p) => (
                  <ProductCard
                    key={p.id}
                    module="pif"
                    product={p}
                    quantity={cart.quantityOf(p.id)}
                    onAdd={() => cart.addOne(p)}
                    onQuantityChange={(qty) => cart.setQuantity(p, qty)}
                    onClick={() => navigate(`/pif/products/${p.id}`)}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </>
      )}
    </ShopScreen>
  );
}

/**
 * Find the live category whose slug is `slug`. A row with no slug (one of the
 * 14 pre-business legacy rows) can never match, and neither can an undefined
 * slug, so an unresolvable shelf resolves to null rather than to the wrong
 * category.
 */
function bySlug<T extends PifCategorySummary>(
  items: readonly T[],
  slug: string | undefined
): T | null {
  if (slug === undefined) return null;
  return items.find((item) => typeof item.slug === 'string' && item.slug === slug) ?? null;
}

function asEntry(main: MainCategory): SubCategory {
  return { slug: main.slug, name: main.name, icon: main.icon };
}
