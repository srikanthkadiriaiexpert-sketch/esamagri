import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  X,
  MapPin,
  ChevronRight,
  Search,
  ShoppingCart,
  Home,
  LayoutGrid,
  Package,
  User,
} from 'lucide-react';
import {
  CategorySidebar,
  type CategorySidebarGroup,
} from '../../../design-system/CategorySidebar';
import { usePifCart } from '../../../lib/cart/PifCartContext';
import { usePifCartTotal } from '../../../lib/cart/usePifCartTotal';
import { rupees } from '../../../lib/api/pif-api';
import { findBusiness } from '../../../lib/businesses/businesses';
import { categoryImage, type CategoryImage } from '../../../lib/businesses/category-images';
import { ACCENTS } from '../../../lib/businesses/accents';
import type { SubCategory } from '../../../lib/businesses/category-tree';

/**
 * What the header's location pin says. ONE constant, shown wherever a
 * location appears, so the two shops can never disagree.
 *
 * It names NO residential area and no organisation. What a shopper needs
 * from this pin is how the order reaches them, and the city; the specific
 * estate it used to print added nothing they did not already know, and is
 * not the app's to publish. The field names are unchanged so nothing that
 * reads this constant has to change with it.
 */
export const LOCATION = { name: 'Home delivery', city: 'Visakhapatnam' } as const;

/**
 * What the facility is called, in full, under the logo.
 *
 * PIF is the **Payment Issue Facility**. An approved mockup printed in
 * "Payment in Facility"; that wording was corrected in writing afterwards
 * and the correction wins, so the string lives here once rather than being
 * re-typed per screen where the old form could creep back in.
 */
export const FACILITY_LINE = 'Payment Issue Facility';

/** One step in the breadcrumb. Without `onClick` it is the current page. */
export interface Crumb {
  readonly label: string;
  readonly onClick?: () => void;
}

export interface ShopScreenProps {
  readonly businessSlug: 'grocers' | 'fresh-mart';
  /** A flat drawer. Mutually exclusive with `drawerGroups`. */
  readonly drawerItems?: readonly SubCategory[];
  /** A drawer in labelled sections. Mutually exclusive with `drawerItems`. */
  readonly drawerGroups?: readonly CategorySidebarGroup[];
  readonly drawerLabel: string;
  /**
   * The drawer's visible heading. Inside a main category this is that
   * category's name, because the drawer then holds ITS subcategories — a
   * panel headed "Categories" that lists Sunflower Oil would be lying about
   * what it is.
   */
  readonly drawerTitle?: string;
  /**
   * The always-visible narrow rail beside the content, on a phone as well as
   * a desktop. Supplied on a page where one category is open, so the reader
   * can move between its siblings without going back out to the drawer — the
   * approved mockup shows exactly this beside the product area. Omitted on a
   * shop home, where there is no sibling list to show.
   */
  readonly railItems?: readonly SubCategory[];
  readonly selectedSlug: string | null;
  readonly onSelect: (slug: string) => void;
  readonly searchPlaceholder: string;
  readonly breadcrumb: readonly Crumb[];
  readonly heroTitle: string;
  readonly heroBlurb: string;
  readonly heroImage?: CategoryImage | null;
  /** Everything below the hero: the shelf, the grid, the live categories. */
  readonly children: ReactNode;
}

/**
 * THE approved shop screen. One component, both shops.
 *
 * The supplied Fresh Mart screenshot is the standing standard, so this file
 * holds it exactly once: the compact header carrying the business's own
 * logo, the Payment Issue Facility line, the delivery pin and a cart
 * showing its real count and total; the search field; the category drawer on
 * a phone, docked open beside the content on a desktop; the breadcrumb; the
 * tinted hero; and the five-item bottom bar.
 *
 * GROCERS AND FRESH MART DIFFER ONLY in what they put in the drawer, what
 * the breadcrumb says, and what sits below the hero. Nothing about the
 * chrome is per-business except the logo, the accent colour and the wording,
 * all of which arrive as data. That is what makes "apply the same standard
 * to Grocers" true by construction rather than by two files being edited in
 * step and hoped to match.
 *
 * NO INVENTED CATALOGUE anywhere in here. There is no product row, no
 * "showing N products", no sort control and no price: the only number this
 * screen prints is the cart's own count and total, which come from the real
 * cart and are therefore zero until something real is added.
 */
export function ShopScreen({
  businessSlug,
  drawerItems,
  drawerGroups,
  drawerLabel,
  drawerTitle = 'Categories',
  railItems,
  selectedSlug,
  onSelect,
  searchPlaceholder,
  breadcrumb,
  heroTitle,
  heroBlurb,
  heroImage = null,
  children,
}: ShopScreenProps) {
  const navigate = useNavigate();
  const cart = usePifCart();
  const total = usePifCartTotal();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const business = findBusiness(businessSlug)!;
  const accent = ACCENTS[business.accent];

  /*
   * The drawer opens BELOW the header rather than over it, so the branding,
   * the delivery point, the search field and the cart stay reachable — the
   * approved mockup shows all of them above an open drawer. The header's
   * height is measured rather than guessed, because it grows when a logo
   * wraps or the phone's text size is turned up, and a hard-coded offset
   * would then either cover the search field or leave a white stripe.
   */
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    if (!drawerOpen) return;
    setHeaderHeight(headerRef.current?.getBoundingClientRect().height ?? 0);
  }, [drawerOpen]);

  // Escape closes the drawer, and the page behind it must not scroll.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const select = (slug: string) => {
    onSelect(slug);
    setDrawerOpen(false); // on a phone the drawer must get out of the way
  };

  const sidebar = (
    <CategorySidebar
      items={drawerItems}
      groups={drawerGroups}
      layout="list"
      selectedSlug={selectedSlug}
      label={drawerLabel}
      imageFor={(slug) => categoryImage(businessSlug, slug)}
      onSelect={select}
    />
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-app flex-col bg-slate-50 md:max-w-6xl md:border-x md:border-slate-200">
      {/* ------------------------------------------------------ header --- */}
      {/* The band was plain white, which left a large blank block above every
          shop screen. The tint comes from the business's own accent, so
          Grocers reads warm and Fresh Mart reads leafy without this
          component learning either business's name. */}
      <header
        ref={headerRef}
        className={['sticky top-0 z-30 border-b border-slate-200 safe-top', accent.shopHeader].join(' ')}
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open categories"
            aria-expanded={drawerOpen}
            className="flex h-touch w-touch shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 md:hidden"
          >
            <Menu aria-hidden className="h-6 w-6" strokeWidth={2} />
          </button>

          {/* The logo is the home control, as it is on every shopping app. */}
          <button
            type="button"
            onClick={() => navigate(`/pif/${businessSlug}`)}
            aria-label={`${business.name} home`}
            className="flex min-h-touch min-w-0 shrink-0 flex-col items-center justify-center rounded-xl px-0.5 py-0.5 hover:bg-slate-50"
          >
            <img
              src={business.logo}
              alt={`${business.name} logo`}
              className="h-9 w-auto max-w-[128px] object-contain"
              width={128}
              height={36}
            />
            <span className="mt-0.5 whitespace-nowrap text-[9px] font-semibold text-slate-500">
              {FACILITY_LINE}
            </span>
          </button>

          {/*
            THE DELIVERY POINT IS TEXT, NOT A PICKER.
            The mockup draws a chevron beside it, which promises a choice.
            This facility has exactly one delivery point and the app stores
            no address to switch to, so a picker here would open nothing —
            the one thing the standing standard forbids. It becomes a control
            the day a second delivery point exists.
          */}
          <p
            className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1"
            aria-label={`Home delivery in ${LOCATION.city}`}
          >
            <MapPin aria-hidden className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold leading-tight text-slate-900">
                {LOCATION.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-slate-500">
                {LOCATION.city}
              </span>
            </span>
          </p>

          <button
            type="button"
            onClick={() => navigate('/pif/cart')}
            aria-label={`Cart, ${cart.itemCount} items`}
            // min-h/min-w-touch: with an empty cart this button is only its
            // 24px icon plus 8px of padding — about 32px, under the 44px
            // minimum a thumb needs. The floor costs nothing once the total
            // line appears and makes the empty state tappable.
            className="relative flex min-h-touch min-w-touch shrink-0 flex-col items-center justify-center rounded-xl px-1.5 py-1 hover:bg-slate-50"
          >
            <ShoppingCart aria-hidden className="h-6 w-6 text-slate-700" strokeWidth={2} />
            {/* The count is shown even at zero: an empty basket is a real
                answer, and hiding the badge made the control look like it
                had nothing behind it. The total only appears once there is
                one, because a price of zero would be a claim about
                catalogue data that does not exist. */}
            <span
              className={[
                'absolute right-0 top-0 min-w-[17px] rounded-full px-1 text-[10px] font-bold leading-[17px] text-white',
                cart.itemCount > 0 ? 'bg-brand-amberDark' : 'bg-slate-400',
              ].join(' ')}
            >
              {cart.itemCount}
            </span>
            {cart.itemCount > 0 ? (
              <span className="mt-0.5 whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-700">
                {/* Same guard as StickyCartBar, for the same reason: a
                    missing figure is undefined, not null. */}
                {typeof total.total === 'number' ? rupees(total.total) : ''}
              </span>
            ) : null}
          </button>
        </div>

        <div className="px-3 pb-2.5">
          <button
            type="button"
            onClick={() => navigate('/pif/search')}
            // bg-white, not bg-slate-100: the band behind it is now tinted,
            // and a grey field on a tinted band read as disabled.
            className="flex min-h-touch w-full items-center gap-2 rounded-2xl border border-white bg-white/85 px-3 py-2.5 text-left text-[13px] text-slate-500 shadow-sm"
          >
            <Search aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{searchPlaceholder}</span>
          </button>
        </div>
      </header>

      {/*
        THE BREADCRUMB SPANS THE FULL WIDTH, above the rail rather than
        inside the content column. Squeezed beside an 85px rail on a 390px
        phone, "Home > Grocers > Oil & Ghee > Sunflower Oil" had nowhere to
        go and the open shelf's own name was the part that got clipped —
        the one word the reader most needs. Full width, it fits.
      */}
          {/* py-0 with 44px-tall crumbs, rather than py-2 with 16px-tall
              ones: the bar ends up the same sort of height either way, but
              this way each crumb is a real thumb target instead of a line
              of text you have to aim at. */}
          <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-slate-200 bg-white px-4 text-[12px]"
        >
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.label} className="flex shrink-0 items-center gap-1">
              {i === 0 ? null : (
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-slate-300" />
              )}
              {crumb.onClick === undefined ? (
                <span
                  aria-current="page"
                  className="inline-flex min-h-touch items-center font-bold text-slate-900"
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className={[
                    'inline-flex min-h-touch min-w-touch items-center justify-center px-1 font-semibold',
                    accent.heading,
                  ].join(' ')}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          ))}
        </nav>

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------- the rail, phone width --- */}
        {/* On a phone the reader still needs to get from Sunflower Oil to
            Sesame Oil without opening the drawer, so the siblings stay in
            a narrow column beside the content. Above `md` the docked panel
            below does the same job with room for full names. */}
        {railItems === undefined ? null : (
          <div className="shrink-0 border-r border-slate-200 bg-white md:hidden" data-testid="shop-rail">
            <CategorySidebar
              items={railItems}
              layout="rail"
              selectedSlug={selectedSlug}
              label={drawerLabel}
              imageFor={(slug) => categoryImage(businessSlug, slug)}
              onSelect={onSelect}
            />
          </div>
        )}

        {/* ---------------------------------------- categories, docked --- */}
        <aside className="hidden w-[260px] shrink-0 border-r border-slate-200 bg-white md:block">
          {sidebar}
        </aside>

        {/* --------------------------------------------------- content --- */}
        <main className="min-w-0 flex-1 pb-24">

          <section className={['relative overflow-hidden', accent.wash].join(' ')}>
            <div className="relative z-10 max-w-[62%] px-4 py-4">
              <h1 className={['text-xl font-extrabold leading-tight', accent.heading].join(' ')}>
                {heroTitle}
              </h1>
              <p className="mt-1 text-xs font-medium text-slate-600">{heroBlurb}</p>
            </div>
            {heroImage === null ? null : (
              <img
                src={heroImage.src}
                alt=""
                className="absolute inset-y-0 right-0 h-full w-[42%] object-cover"
                width={320}
                height={160}
              />
            )}
          </section>

          {children}
        </main>
      </div>

      {/* ----------------------------------------- drawer, phone only --- */}
      {drawerOpen ? (
        // z-20 keeps the drawer BELOW the sticky header's z-30, so the logo,
        // the facility line, the delivery point, the search field and the
        // cart stay visible and usable while it is open — which is what the
        // approved mockup shows. Only the content is dimmed.
        <div
          className="fixed inset-x-0 bottom-0 z-20 md:hidden"
          style={{ top: headerHeight }}
          role="dialog"
          aria-modal="true"
          aria-label={drawerTitle}
        >
          <button
            type="button"
            aria-label="Close categories"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full bg-slate-900/40"
          />
          <div
            className="absolute inset-y-0 left-0 flex w-[86%] max-w-[330px] flex-col bg-white shadow-xl"
            data-testid="shop-drawer"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-extrabold text-slate-900">{drawerTitle}</p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close categories"
                className="flex h-touch w-touch items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"
              >
                <X aria-hidden className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebar}</div>
          </div>
        </div>
      ) : null}

      <ShopBottomNav
        itemCount={cart.itemCount}
        categoriesTo={`/pif/${businessSlug}`}
        label={business.name}
        activeClass={accent.heading}
      />
    </div>
  );
}

/**
 * The shop's own bottom bar.
 *
 * The approved mockup's five items include Cart, which the app's shared bar
 * does not carry — and must not, because that bar is also shown on every RIK
 * screen and RIK keeps a separate basket. So this bar is scoped to the two
 * PIF shops and the shared one steps aside there, leaving RIK untouched.
 */
function ShopBottomNav({
  itemCount,
  categoriesTo,
  label,
  activeClass,
}: {
  itemCount: number;
  categoriesTo: string;
  label: string;
  activeClass: string;
}) {
  const navigate = useNavigate();
  const items = [
    { label: 'Home', icon: Home, to: '/' },
    { label: 'Categories', icon: LayoutGrid, to: categoriesTo, active: true },
    { label: 'Cart', icon: ShoppingCart, to: '/pif/cart', badge: itemCount },
    { label: 'Orders', icon: Package, to: '/pif/orders' },
    { label: 'Account', icon: User, to: '/account' },
  ];

  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom"
      data-testid="shop-bottom-nav"
    >
      <div className="mx-auto flex w-full max-w-app md:max-w-6xl">
        {items.map(({ label: itemLabel, icon: Icon, to, active, badge }) => (
          <button
            key={itemLabel}
            type="button"
            onClick={() => navigate(to)}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative flex min-h-touch flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold',
              active ? activeClass : 'text-slate-500',
            ].join(' ')}
          >
            <span className="relative">
              <Icon aria-hidden className="h-6 w-6" strokeWidth={1.9} />
              {badge !== undefined && badge > 0 ? (
                <span className="absolute -right-2 -top-1 min-w-[16px] rounded-full bg-brand-amberDark px-1 text-[9px] font-bold leading-4 text-white">
                  {badge}
                </span>
              ) : null}
            </span>
            {itemLabel}
          </button>
        ))}
      </div>
    </nav>
  );
}
