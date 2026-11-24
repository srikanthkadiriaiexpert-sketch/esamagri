import { useNavigate, useParams } from 'react-router-dom';
import { CategoryTileGrid } from '../../../design-system/CategoryTileGrid';
import { CategoryCard } from '../../../design-system/CategoryCard';
import { ProductCard } from '../../../design-system/ProductCard';
import { LoadingState, EmptyState, ErrorState } from '../../../design-system/StateViews';
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
import { approvedCategories } from '../../../lib/businesses/unapproved-pif-categories';
import {
  GROCERS_CATEGORIES,
  findMain,
  type MainCategory,
  type SubCategory,
} from '../../../lib/businesses/category-tree';
import { ShopScreen, type Crumb } from './ShopScreen';

/**
 * Grocers — the same approved screen as Fresh Mart, with Grocers branding.
 *
 * The chrome is <ShopScreen>, shared with Fresh Mart, so the Grocers logo,
 * the Payment Issue Facility line, the delivery pin, the real cart,
 * the drawer, the breadcrumb and the five-item bottom bar are the identical
 * components rather than a second copy that can drift. Only three things are
 * Grocers': what the drawer holds, what the URL means, and what sits below
 * the hero.
 *
 * THE DRAWER HOLDS THE NINETEEN MAIN CATEGORIES, not all 154 entries. Fresh
 * Mart's whole catalogue is ten entries and fits; Grocers' does not, and a
 * drawer you scroll for a page and a half is not navigation. The
 * subcategories of the open main appear in the content area as a grid —
 * which is what the approved Grocers mockup draws.
 *
 * THREE URLS, one screen:
 *   /pif/grocers                        — the nineteen mains, plus the
 *                                         shelves that genuinely hold stock
 *   /pif/grocers/:mainSlug              — that main's subcategories
 *   /pif/grocers/:mainSlug/:subSlug     — one subcategory selected
 *
 * THE THIRD PANEL IS NOW REAL. It used to be a fixed "no stock loaded"
 * notice, because no Grocers product existed and a product panel would have
 * been fiction. Products exist now, so the panel asks the catalogue: opening
 * a shelf resolves its slug to the server's own category id and lists that
 * category's products through /pif/categories/:id/products — the same
 * endpoint and the same <ProductCard> the category route and search already
 * use, so a card, its price, its availability and its Add button behave
 * identically wherever the reader meets them.
 *
 * NOTHING IS INVENTED STILL. Every figure on a card comes from the server;
 * this file computes no price and counts no stock. An empty shelf now means
 * the catalogue returned nothing for that category, which is a fact, where
 * before it was a sentence.
 *
 * "Currently stocked" is unchanged and still only on the shop home.
 */
export function GrocersShopPage() {
  const navigate = useNavigate();
  const { mainSlug, subSlug } = useParams<{ mainSlug?: string; subSlug?: string }>();

  const business = findBusiness('grocers')!;
  const accent = ACCENTS[business.accent];
  const tree: readonly MainCategory[] = GROCERS_CATEGORIES;

  const main = findMain(tree, mainSlug);
  const sub: SubCategory | null =
    main === null ? null : (main.subcategories.find((s) => s.slug === subSlug) ?? null);

  const cart = usePifCart();

  /*
   * THE LIVE TREE IS READ ON EVERY VIEW OF THIS SCREEN now, not only on the
   * shop home. It feeds two things: "Currently stocked" below, and the
   * slug -> category id resolution the product listing needs.
   *
   * ONE REQUEST PER VISIT. The deps are `[]`, so moving between shelves
   * re-uses the tree already in hand instead of fetching it again; only the
   * product call below repeats, keyed on the category actually selected.
   */
  const liveCategories = useResource<PifCategoryNode[]>(() => fetchPifCategories(), undefined, []);

  /*
   * ONLY THE APPROVED SHELVES ARE SHOWN. The live tree still contains the
   * twelve categories the client rejected (they are database rows and this
   * app does not delete those), so they are filtered out here rather than
   * drawn and then explained away. Their products are refused on the
   * category route and in search too — see unapproved-pif-categories.ts.
   */
  const stocked = approvedCategories(liveCategories.status === 'success' ? liveCategories.data : []);

  /*
   * SLUG -> REAL CATEGORY ID. BY SLUG, NEVER BY NAME.
   *
   * Migration 0061 added pif.categories.slug and 0062 filled it from this very
   * tree, so both sides share one stable key. Matching on name instead would
   * be wrong and this project has already been caught by it twice: "Rice" is
   * an approved Grocers shelf AND a demo subcategory of "Staples", and
   * "Beverages" is an approved Grocers main AND a demo main.
   *
   * Resolution runs against `stocked` — the approved tree — and not the raw
   * one, so this listing obeys exactly the same visibility rules as every
   * other customer surface. A shelf that resolves to nothing shows the empty
   * state, which is the honest answer: the server is not offering it.
   */
  const apiMain = bySlug(stocked, main?.slug);
  const apiSub = apiMain === null ? null : bySlug(apiMain.subcategories, sub?.slug);
  const selectedCategoryId = apiSub?.id ?? apiMain?.id ?? null;

  /*
   * The selected shelf's products. Keyed on the resolved id, so choosing
   * another subcategory loads that one and useResource cancels the call in
   * flight; with no id resolved (the shop home, or a shelf the server does
   * not offer) it settles empty without asking the network at all.
   */
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

  // An unknown :mainSlug must not silently become a different category.
  if (mainSlug !== undefined && main === null) {
    return (
      <ShopScreen
        businessSlug="grocers"
        drawerItems={tree.map(asEntry)}
        drawerLabel="Grocers categories"
        selectedSlug={null}
        onSelect={(slug) => navigate(`/pif/grocers/${slug}`)}
        searchPlaceholder="Search groceries, staples…"
        drawerTitle="Grocers categories"
        breadcrumb={[
          { label: 'Home', onClick: () => navigate('/') },
          { label: 'Grocers', onClick: () => navigate('/pif/grocers') },
          { label: 'Not found' },
        ]}
        heroTitle="Category not found"
        heroBlurb="That category does not exist. Choose one from the list."
      >
        <div className="p-4">
          <ErrorState
            title="That category does not exist"
            description="It may have been renamed. Choose a category from the Grocers home."
            onRetry={() => navigate('/pif/grocers')}
          />
        </div>
      </ShopScreen>
    );
  }

  /*
   * WHAT THE DRAWER HOLDS depends on where the reader is, and this is the
   * correction the approved mockup called for.
   *
   *   on the shop home   — the 19 main categories, which is how you get in;
   *   inside a main      — THAT main's approved subcategories, headed with
   *                        its name.
   *
   * It held the 19 mains everywhere before. That made the drawer the only
   * way between siblings an indirect one: from Sunflower Oil you had to go
   * out to Grocers, back into Oil & Ghee, then pick. The same list is also
   * kept beside the content as a narrow rail, so moving between siblings
   * costs one tap and no drawer at all.
   */
  const insideMain = main !== null;
  const drawerItems = insideMain ? main.subcategories : tree.map(asEntry);
  const drawerLabel = insideMain ? `${main.name} subcategories` : 'Grocers categories';
  const selectedSlug = insideMain ? (sub?.slug ?? null) : null;
  const onSelect = (slug: string) =>
    navigate(insideMain ? `/pif/grocers/${main.slug}/${slug}` : `/pif/grocers/${slug}`);

  const breadcrumb: Crumb[] = [
    { label: 'Home', onClick: () => navigate('/') },
    main === null
      ? { label: 'Grocers' }
      : { label: 'Grocers', onClick: () => navigate('/pif/grocers') },
  ];
  if (main !== null) {
    breadcrumb.push(
      sub === null
        ? { label: main.name }
        : { label: main.name, onClick: () => navigate(`/pif/grocers/${main.slug}`) }
    );
  }
  if (sub !== null) breadcrumb.push({ label: sub.name });

  const heroSlug = sub?.slug ?? main?.slug ?? null;

  return (
    <ShopScreen
      businessSlug="grocers"
      drawerItems={drawerItems}
      drawerLabel={drawerLabel}
      drawerTitle={insideMain ? main.name : 'Grocers categories'}
      {...(insideMain ? { railItems: main.subcategories } : {})}
      selectedSlug={selectedSlug}
      onSelect={onSelect}
      searchPlaceholder="Search groceries, staples…"
      breadcrumb={breadcrumb}
      heroTitle={sub?.name ?? main?.name ?? business.name}
      heroBlurb={
        main === null
          ? 'Groceries and staples from the facility, delivered to your quarters.'
          : `${main.name} from the facility, delivered to your quarters.`
      }
      heroImage={heroSlug === null ? null : categoryImage('grocers', heroSlug)}
    >
      {main === null ? (
        <>
          <section className="p-4" aria-labelledby="grocers-categories-heading">
            <h2 id="grocers-categories-heading" className="mb-2.5 text-sm font-bold text-slate-900">
              Shop by category
            </h2>
            <CategoryTileGrid
              items={tree.map(asEntry)}
              onSelect={(slug) => navigate(`/pif/grocers/${slug}`)}
              label="Grocers categories"
              imageFor={(slug) => categoryImage('grocers', slug)}
              wash={accent.wash}
              heading={accent.heading}
            />
          </section>

          <section className="px-4 pb-4" aria-labelledby="stocked-heading">
            <h2 id="stocked-heading" className="text-sm font-bold text-slate-900">
              Currently stocked
            </h2>
            <p className="mb-2.5 mt-0.5 text-xs text-slate-500">
              The shelves holding stock today. The categories above are being filled as the
              catalogue is loaded.
            </p>

            {liveCategories.status === 'loading' ? <LoadingState /> : null}
            {liveCategories.status === 'error' ? <ErrorState /> : null}
            {liveCategories.status === 'not_implemented' ? (
              <ErrorState
                variant="not_implemented"
                description="The catalogue is being built and will appear here soon."
              />
            ) : null}
            {liveCategories.status === 'success' && stocked.length === 0 ? (
              <EmptyState title="Nothing stocked yet" />
            ) : null}
            {liveCategories.status === 'success' && stocked.length > 0 ? (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {stocked.flatMap((group) => [
                  <CategoryCard
                    key={group.id}
                    category={group}
                    accent="green"
                    size="lg"
                    onClick={() => navigate(`/pif/categories/${group.id}`)}
                  />,
                  ...group.subcategories.map((child) => (
                    <CategoryCard
                      key={child.id}
                      category={child}
                      accent="green"
                      size="lg"
                      onClick={() => navigate(`/pif/categories/${child.id}`)}
                    />
                  )),
                ])}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <>
          {/*
            THE GRID IS THE WAY IN, not a permanent fixture. On the main
            category it is how the reader picks a shelf. Once a shelf is
            open the rail beside the content carries the same seven entries,
            so repeating them as cards above the products would push the
            products off the screen for nothing — the approved mockup shows
            the rail and the listing, and no grid.
          */}
          {sub !== null ? null : (
          <section className="p-4" aria-labelledby="grocers-subcategories-heading">
            <h2
              id="grocers-subcategories-heading"
              className="mb-2.5 text-sm font-bold text-slate-900"
            >
              {main.name}
            </h2>
            {main.subcategories.length === 0 ? (
              <EmptyState title="This category has no subcategories" />
            ) : (
              <CategoryTileGrid
                items={main.subcategories}
                // Nothing is selected here by construction: the grid only
                // renders while no subcategory is open.
                selectedSlug={null}
                onSelect={(slug) => navigate(`/pif/grocers/${main.slug}/${slug}`)}
                label={`${main.name} subcategories`}
                imageFor={(slug) => categoryImage('grocers', slug)}
                wash={accent.wash}
                heading={accent.heading}
              />
            )}
          </section>
          )}

          <section className="px-4 pb-4 pt-4" aria-labelledby="grocers-products-heading">
            {/* The hero already names the shelf; this is for screen readers,
                and keeps the visual layout exactly as approved. */}
            <h2 id="grocers-products-heading" className="sr-only">
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
                title="No products on this shelf yet"
                description={`${sub?.name ?? main.name} has no stock loaded. Prices and availability appear here once the Grocers catalogue is supplied.`}
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

/** A main category as a drawer entry, so the drawer treats both levels alike. */
function asEntry(main: MainCategory): SubCategory {
  return { slug: main.slug, name: main.name, icon: main.icon };
}
