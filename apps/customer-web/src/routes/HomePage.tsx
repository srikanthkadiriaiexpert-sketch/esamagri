import { useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Logo } from '../design-system/Logo';
import { ModuleEntryCard } from '../design-system/ModuleEntryCard';
import { HomeFeatureCard } from '../design-system/HomeFeatureCard';
import { ProduceBoxArt, NutritionChartArt, DeliveryVanArt } from '../design-system/illustrations/HomeFeatureArt';
import { AnnouncementCard } from '../design-system/AnnouncementCard';
import { AnnouncementSheet } from '../design-system/AnnouncementSheet';
import { SeasonalBanners } from '../design-system/SeasonalBanners';
import { ProductShowcase } from '../design-system/ProductShowcase';
import { LoadingState, EmptyState, ErrorState } from '../design-system/StateViews';
import { useResource } from '../lib/api/resource';
import { useRikVisibility } from '../lib/auth/AuthContext';
import { apiRequest } from '../lib/api/client';
import type { Announcement } from '../lib/api/types';

interface LayoutContext {
  openDrawer: () => void;
}

/**
 * Customer home screen (STEP 8 Section 4 / 30 — the first major
 * screen, RIK/PIF toggle front and center). Layout, hierarchy, card
 * structure, quick-action row and announcement presentation follow
 * the approved UI reference image exactly; the hero illustration below
 * is original artwork (not derived from the logo — see design-system
 * README) since the logo itself is never cropped/recomposited.
 */
export function HomePage() {
  const { openDrawer } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  /**
   * WHAT THIS FLAG IS ALLOWED TO HIDE: the RIK MODULE CARD, and nothing else.
   *
   * It used to hide the New Arrivals and Nutrition Info cards too, for the
   * incidental reason that both navigated to a `/rik/...` path. The effect
   * was that a PIF-only resident's home screen lost two of its three feature
   * cards and rendered one lonely tile in a three-column grid — which, with
   * the promotional banners silently 403-ing behind it, is what made a newly
   * registered account look half-built.
   *
   * Those two pages are now common content on common addresses, so the only
   * thing left behind this flag is the one card that genuinely leads
   * somewhere a PIF-only resident cannot go.
   *
   * useRikVisibility, not useAuth: this screen is rendered directly by its own
   * tests with no AuthProvider, and needing one to decide whether to draw a
   * card would be the wrong dependency. Explicit false only — see the comment
   * at the RIK card below.
   */
  const hideRikModule = useRikVisibility() === false;

  // STEP 9 is production application code, so no dev fixture is
  // substituted here: the announcements module genuinely does not exist
  // yet (backlog NOT-1/NOT-2), and `useResource` therefore reports
  // `not_implemented`, which renders an honest empty state below. A
  // fixture would make an unbuilt feature look built.
  const announcements = useResource<Announcement[]>(
    () => apiRequest<Announcement[]>('/announcements'),
    undefined,
    []
  );

  /*
   * THE NOTICE BEING READ IN FULL, or null when the home screen is just the
   * home screen.
   *
   * The home feed shows the same one-line preview the notifications feed
   * does, and until now a tap on it did nothing here either: <AnnouncementCard>
   * is a full-width <button>, but its `onClick` is optional and this screen
   * never passed one. This is that missing wire.
   *
   * The object held here is the one `GET /announcements` already returned,
   * complete body and all. Nothing is re-fetched and nothing is looked up by
   * id, so the audience rules the server applied to this list are exactly the
   * rules that bound what can be opened from it.
   */
  const [reading, setReading] = useState<Announcement | null>(null);

  return (
    // Mobile-first column, widened at larger breakpoints so the approved
    // hero renders as the wide banner the brief calls for on desktop
    // (kickoff Section 3) instead of being boxed into a phone-width
    // column. Width only — hierarchy and order are unchanged.
    <div className="mx-auto w-full max-w-app md:max-w-2xl lg:max-w-4xl xl:max-w-5xl">
      {/*
        The brand bar. This was white on white with slate icons, which is
        what made the first screen after login read as unfinished. It now
        carries the brand green running into the teal at the forest hue —
        the same bar the PIF screens use, so the app has ONE header
        treatment rather than a pale one here and a dark one there.
        Order, controls and the centred logo are unchanged; only the
        colours and the logo's size differ.
      */}
      <header className="safe-top flex h-20 items-center justify-between bg-gradient-to-r from-brand-greenDark via-brand-green to-brand-teal px-4 text-white">
        <button
          type="button"
          onClick={openDrawer}
          aria-label="Open menu"
          className="flex h-touch w-touch items-center justify-center rounded-full hover:bg-white/10"
        >
          <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
            <path d="M3.5 6.5h15M3.5 11h15M3.5 15.5h15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
        {/* Larger, and on a white plate so the logo's own colours sit on the
            background it was drawn for rather than on the green. */}
        <Logo className="h-14 w-14 bg-white/95 p-0.5 shadow-sm" />
        <button
          type="button"
          onClick={() => navigate('/account/notifications')}
          aria-label="Notifications"
          className="relative flex h-touch w-touch items-center justify-center rounded-full hover:bg-white/10"
        >
          <svg aria-hidden="true" viewBox="0 0 22 22" className="h-6 w-6" fill="none">
            <path
              d="M5.5 15V10a5.5 5.5 0 1 1 11 0v5l1.3 2H4.2L5.5 15Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M9 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-semantic-danger" aria-hidden="true" />
        </button>
      </header>

      <main className="px-4 pb-6 pt-4 md:px-6">
        <HeroBanner />

        {/*
          Seasonal promotional banners, BELOW the permanent hero and never
          in place of it. HeroBanner above is unconditional and untouched;
          this renders nothing at all unless staff have a published banner
          whose date window covers today, which is why there is no wrapper,
          no spinner and no placeholder between the two.
        */}
        <SeasonalBanners />

        <div className="mt-4 flex gap-3">
          {/*
            RIK is offered only to a resident the facility has approved.

            `hideRik` is true ONLY when the server has explicitly said so. An
            unknown answer shows RIK, because the two mistakes are not equal:
            offering it to a PIF-only resident costs them one clear sentence on
            the next screen, while hiding it from an officer would produce no
            error anywhere and look like their ration had disappeared. The
            server refuses every RIK endpoint either way — see
            @RequireRikCustomer — so this is presentation, not protection.
          */}
          {hideRikModule ? null : (
          <ModuleEntryCard
            module="rik"
            title="RIK"
            subtitle="Ration in Kind"
            icon={<BasketIcon />}
            bullets={[
              { icon: <DocIcon />, label: 'View entitlement' },
              { icon: <BoxIcon />, label: 'Request ration' },
              { icon: <TruckIcon />, label: 'Pickup / Delivery' },
            ]}
            ctaLabel="Enter RIK"
            onClick={() => navigate('/rik')}
          />
          )}
          <ModuleEntryCard
            module="pif"
            title="PIF"
            subtitle="Payment Issue Facility"
            icon={<CartIcon />}
            bullets={[
              { icon: <BagIcon />, label: 'Shop groceries' },
              { icon: <CardIcon />, label: 'Place order' },
              { icon: <TruckIcon />, label: 'Cash on Delivery' },
            ]}
            ctaLabel="Enter PIF"
            onClick={() => navigate('/pif')}
          />
        </div>

        {/*
          The three approved shortcut cards, and the only shortcut row on this
          screen.

          Shop Now and Community Info were removed from the home screen by an
          approved requirement change. Nothing was orphaned by it: PIF is one
          tap away through "Enter PIF" directly above, and the account screens
          remain in the menu drawer. Neither has a hidden or duplicate tile
          anywhere on this page, which HomePage.test.tsx asserts.

          One column on a phone, three across from sm up, which is where the
          reference's side-by-side composition starts to fit.
        */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/*
            ALL THREE CARDS, FOR EVERY RESIDENT.

            New Arrivals and Nutrition Info are common content: a shop window
            and a reference page about the food. Neither reads an entitlement,
            a balance, a period or an eligibility row, which is exactly why
            they are safe for every customer and why they now live on
            `/new-arrivals` and `/nutrition` rather than under `/rik`.

            They were previously hidden alongside the RIK module card, and
            their old addresses sat inside the RIK route guard — so a PIF-only
            resident could neither see them nor reach them. That is the defect
            this fixes; the subtitles no longer say "RIK products" either,
            because the pages are not RIK's any more.
          */}
          <HomeFeatureCard
            tone="amber"
            title="New Arrivals"
            subtitle={['Discover the latest', 'products and offers']}
            art={ProduceBoxArt}
            onClick={() => navigate('/new-arrivals')}
          />
          <HomeFeatureCard
            tone="green"
            title="Nutrition Info"
            subtitle={['Know what you eat', 'Make healthier choices']}
            art={NutritionChartArt}
            onClick={() => navigate('/nutrition')}
          />
          <HomeFeatureCard
            tone="blue"
            title="Home Delivery"
            subtitle={['Fresh essentials', 'delivered to your home']}
            art={DeliveryVanArt}
            onClick={() => navigate('/pif')}
          />
        </div>

        {/*
          The moving product row. Like the banners above it, it renders
          nothing unless products actually arrived — a slow catalogue must
          not put a spinner or an error on the first screen after sign-in.
        */}
        <ProductShowcase />

        <section className="mt-4 rounded-2xl bg-white p-4 shadow-card" aria-labelledby="announcements-heading">
          <div className="flex items-center justify-between">
            <h2 id="announcements-heading" className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <span aria-hidden="true">📣</span> Announcements
            </h2>
            <button
              type="button"
              onClick={() => navigate('/account/notifications')}
              // min-h-touch with -my-2 so the hit area reaches 44px without
              // the heading row growing to match it.
              className="-my-2 inline-flex min-h-touch items-center px-1 text-xs font-semibold text-brand-green"
            >
              View All ›
            </button>
          </div>

          <div className="mt-1">
            {announcements.status === 'loading' ? <LoadingState compact label="Loading announcements…" /> : null}

            {announcements.status === 'error' ? (
              <ErrorState variant="error" description="Couldn't load announcements right now." />
            ) : null}

            {announcements.status === 'not_implemented' ? (
              <EmptyState title="No announcements yet" description="Check back here for RIK and PIF updates." />
            ) : null}

            {announcements.status === 'success' && announcements.data.length === 0 ? (
              <EmptyState title="No announcements" description="You're all caught up." />
            ) : null}

            {announcements.status === 'success' && announcements.data.length > 0 ? (
              <div className="mt-1">
                {announcements.data.map((a) => (
                  <AnnouncementCard key={a.id} announcement={a} onClick={setReading} />
                ))}
              </div>
            ) : null}
          </div>
        </section>
      </main>

      {/*
        Outside <main> on purpose, exactly as on the notifications screen:
        Sheet portals itself to document.body, and keeping the call here
        rather than inside the map means ONE panel for the whole feed
        instead of one per row. Closing it returns the reader to this page
        with its scroll position and every other section untouched, because
        nothing else on the home screen is involved.
      */}
      <AnnouncementSheet announcement={reading} onClose={() => setReading(null)} />
    </div>
  );
}

/**
 * Approved hero (client-supplied production asset, 12 Sep 2026 — this
 * closes ASSET_REQUIRED AS-1).
 *
 * The artwork is used exactly as supplied: `hero-home.png` in
 * public/brand is byte-identical to the delivered file, and the .webp
 * entries are uniform downscales of it for bandwidth — no crop, no
 * recomposition, no redraw, nothing added to or removed from the
 * composition. The hero and the header logo are separate assets; this
 * component never touches the logo.
 *
 * Responsive behaviour (kickoff Section 3):
 *  - the image keeps its own 1842×854 aspect ratio at every width, so
 *    the headline and the grocery imagery are always fully visible —
 *    nothing is cropped away on any screen;
 *  - width is 100% of the content column and height is derived, so
 *    there is no fixed-height container to clip it and no horizontal
 *    overflow at any width;
 *  - `sizes`/`srcSet` hand the browser the smallest adequate file:
 *    ~640px on a phone, up to the full-resolution asset on desktop.
 *
 * The image carries the headline as part of the artwork, so its `alt`
 * text repeats that line for screen-reader and no-image parity.
 */
function HeroBanner() {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card">
      <picture>
        <source
          type="image/webp"
          sizes="(min-width: 1024px) 960px, 100vw"
          srcSet="/brand/hero-home-640.webp 640w, /brand/hero-home-920.webp 920w, /brand/hero-home-1200.webp 1200w, /brand/hero-home-1842.webp 1842w"
        />
        <img
          src="/brand/hero-home.png"
          alt="e Samagri — Everyday Essentials for a Brighter Tomorrow. Fresh choices, convenient ordering, happier homes."
          width={1842}
          height={854}
          decoding="async"
          fetchPriority="high"
          className="block h-auto w-full"
        />
      </picture>
    </div>
  );
}

function BasketIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path d="M4 10h16l-1.5 9.5a1.5 1.5 0 0 1-1.5 1.3H7a1.5 1.5 0 0 1-1.5-1.3L4 10Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 10 6 5M16 10l2-5M9.5 13.5v5M14.5 13.5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none">
      <path d="M4 6h1.6L7 15.2A2 2 0 0 0 9 17h7.4a2 2 0 0 0 2-1.7L19.5 8.5H6.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="19.5" r="1.3" fill="currentColor" />
      <circle cx="16" cy="19.5" r="1.3" fill="currentColor" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <rect x="4" y="2.5" width="12" height="15" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M10 2.5 17 6.5v7L10 17.5 3 13.5v-7L10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3 6.5 10 10.5 17 6.5M10 10.5v7" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
function TruckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M2 5.5h9v8H2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 8.5h3.5L17 11v2.5h-6v-5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="6" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="14" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
function BagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <path d="M5 6h10l-1 10.5a1.5 1.5 0 0 1-1.5 1.3h-5a1.5 1.5 0 0 1-1.5-1.3L5 6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.5 6a2.5 2.5 0 0 1 5 0" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function CardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
      <rect x="2.5" y="5" width="15" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
