import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ExternalLink, BookOpen, MapPin, Search, ChevronDown } from 'lucide-react';
import { Logo } from '../../design-system/Logo';
import { usePifCart } from '../../lib/cart/PifCartContext';
import { BUSINESSES, type Business } from '../../lib/businesses/businesses';
import { ACCENTS, actionLabel } from '../../lib/businesses/accents';

/**
 * The PIF brand directory — the approved mockup's main screen.
 *
 * SHAPE FROM THE MOCKUP: a dark header carrying the facility name and the
 * delivery point, a search field, the RIK / PIF pair, then the six
 * businesses as NUMBERED cards, each with one action button whose wording
 * says what tapping it does. On a phone the cards are a single column; from
 * `md` up they become the directory row the desktop mockup shows, each card
 * carrying its one-line summary.
 *
 * ROUTING IS UNCHANGED. This screen sits at /pif, where the grocery shop
 * used to be; the shop moved to /pif/grocers and every other /pif/* route —
 * cart, checkout, search, orders, products — resolves exactly as before.
 *
 * WHAT IS DELIBERATELY NOT COPIED from the mockup, and why:
 *  - the mockup's three-item bottom bar (Home / Orders / Profile). This app
 *    has a four-item bar shared with RIK, and changing it would change RIK's
 *    screens. The existing bar is kept.
 *  - the photographic banner behind each logo. No such photographs were
 *    supplied, and inventing them would put stock imagery of food these
 *    businesses may not sell in front of customers.
 */
export function PifBusinessesPage() {
  const navigate = useNavigate();
  const cart = usePifCart();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* The flat #10282C slab here was the "large black header". Same
          treatment as the shared <Header>: the brand green running into the
          teal at the forest colour's hue. */}
      <header className="sticky top-0 z-30 bg-gradient-to-r from-brand-greenDark via-brand-green to-brand-teal text-white safe-top">
        <div className="mx-auto w-full max-w-app px-4 pb-3 pt-3 md:max-w-6xl md:px-6">
          <div className="flex items-start gap-3">
            {/* The approved logo asset itself, not the words "e Samagri".
                This screen printed the name as plain text, so the brand was
                absent from the one screen that introduces the brands. */}
            <Logo className="h-11 w-11 shrink-0 bg-white/95 p-0.5 shadow-sm" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-extrabold leading-tight">e Samagri</p>
              <p className="text-[11px] font-medium text-white/70">Naval Residential Area</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/pif/cart')}
              className="relative flex h-touch w-touch items-center justify-center rounded-full hover:bg-white/10"
              aria-label={`Cart, ${cart.itemCount} items`}
            >
              <ShoppingCart aria-hidden className="h-5 w-5" strokeWidth={1.8} />
              {cart.itemCount > 0 ? (
                <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-brand-amber px-1 text-[10px] font-bold leading-[18px]">
                  {cart.itemCount}
                </span>
              ) : null}
            </button>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-white/80">
            <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">Deliver to</span>
            <span className="truncate font-semibold text-white">Dolphin Hill (PIF)</span>
            <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/60" />
          </div>

          <button
            type="button"
            onClick={() => navigate('/pif/search')}
            className="mt-3 flex min-h-touch w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-left text-[13px] text-white/70"
          >
            <Search aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="truncate">Search for products, brands or categories…</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-app px-4 pb-4 md:max-w-6xl md:px-6">
        {/* The two facilities, as the mockup pairs them. PIF is the one in
            view, so it carries the selected state; RIK navigates away. */}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/rik')}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-card"
          >
            <p className="text-sm font-bold text-slate-900">RIK</p>
            <p className="text-[11px] text-slate-500">Entitlement</p>
          </button>
          <div
            aria-current="page"
            className="rounded-xl border border-brand-blue bg-brand-blueLight px-3 py-2.5"
          >
            <p className="text-sm font-bold text-brand-blueDark">PIF</p>
            <p className="text-[11px] text-brand-blueDark/70">Payment Issue Facility</p>
          </div>
        </div>

        <h2 className="mb-2.5 mt-5 text-base font-extrabold text-slate-900">PIF Brands</h2>

        {/* One column on a phone; three on a tablet; the six-across
            directory row the desktop mockup shows only from xl, because six
            cards narrower than about 180px truncate their own names. */}
        <ol className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
          {BUSINESSES.map((business, index) => (
            <li key={business.slug} className="min-w-0">
              <BusinessCard
                business={business}
                position={index + 1}
                onOpen={() => navigate(business.route)}
              />
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => navigate('/pif/orders')}
          className="mt-5 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
        >
          <p className="text-sm font-bold text-slate-900">My orders</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Track delivery status for Grocers and Fresh Mart
          </p>
        </button>
      </main>
    </div>
  );
}

function ActionIcon({ kind }: { kind: Business['kind'] }) {
  if (kind === 'shop') return <ShoppingCart aria-hidden className="h-4 w-4" strokeWidth={2} />;
  if (kind === 'external') return <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={2} />;
  return <BookOpen aria-hidden className="h-4 w-4" strokeWidth={2} />;
}

/**
 * One numbered business card.
 *
 * Phone: logo and text as a row, with the action button on its own full
 * width line beneath them.
 * Desktop (`md` and up): the same card stacks into the directory tile the
 * desktop mockup shows, with the summary line underneath. Unchanged.
 *
 * WHY THE PHONE LAYOUT CHANGED (customer report: names cut off with "…").
 * Three things combined to clip "Kelvin Scale Creamery", measured in a
 * browser at 320–430px with Inter loaded:
 *
 *   1. The name carried `truncate` below `md`, so it could only ever
 *      ellipsis — it had no second line to fall back to. That is the
 *      defect. A brand directory whose longest brand name is unreadable
 *      is not doing its one job.
 *   2. The logo panel was sized `h-22 w-32`, which is REM-based, so on a
 *      phone set to larger text the panel grew while the text beside it
 *      shrank. At root 20px the panel took 160px of a 360px screen and
 *      left the name 113px. Pinned to px, it no longer competes.
 *   3. The action button sat inside that same narrowing column, so its
 *      longest label, "Menu & Information", had to share the squeeze.
 *
 * At the default text size only a 320px screen clipped. At the larger
 * text sizes phones are routinely set to, 360px and 390px clipped too,
 * which is what the customer saw.
 */
function BusinessCard({
  business,
  position,
  onOpen,
}: {
  business: Business;
  position: number;
  onOpen: () => void;
}) {
  const accent = ACCENTS[business.accent];
  const label = actionLabel(business.kind);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${business.name} — ${label}`}
      className={[
        'relative flex h-full w-full flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-card transition',
        'md:gap-3 md:p-4',
        'focus:outline-none focus-visible:ring-2',
        accent.ring,
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={[
          'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold tabular-nums md:left-3 md:top-3',
          accent.badge,
        ].join(' ')}
      >
        {position}
      </span>

      {/*
        LOGO PANEL, enlarged. These were 64x96 on a phone with the logo
        capped at 56px tall, which on a 390px screen made six recognisable
        brands unrecognisable. The panel is now 88x128 (md: 128 tall) and
        the logo may fill 72px of it.
        object-contain and max-h/max-w are what keep every logo its own
        shape: nothing is stretched, cropped or redrawn — a wide wordmark
        and a square badge both scale uniformly until one edge meets the
        panel, which is why the panel grew in BOTH directions.
      */}
      {/* Logo and text share a row on a phone and stack from md, which is
          what the desktop tile has always done. flex-1 lets this absorb
          the card's spare height so the action still sits at the bottom
          of every tile in the six-across row. */}
      <span className="flex w-full min-w-0 flex-1 items-center gap-3 md:flex-col md:items-stretch md:gap-3">
        {/*
          LOGO PANEL. Same 88x128 it has always been at the default text
          size — h-22/w-32 resolve to exactly these — but written in px so
          a phone set to larger text cannot inflate the panel at the
          expense of the brand name beside it.
          object-contain and max-h/max-w are what keep every logo its own
          shape: nothing is stretched, cropped or redrawn.
        */}
        <span
          className={[
            'flex h-[88px] w-[112px] shrink-0 items-center justify-center overflow-hidden rounded-xl md:h-32 md:w-full',
            accent.wash,
          ].join(' ')}
        >
          <img
            src={business.logo}
            alt=""
            className="max-h-[72px] max-w-[88%] object-contain md:max-h-28"
            loading="lazy"
            width={176}
            height={88}
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          {/* Wraps, never truncates. A name that needs two lines gets two
              lines; "Kelvin Scale Creamery" clipped to "Kelvin Scale…" is
              worse than useless, because it reads as a different brand. */}
          <span className="break-words text-sm font-extrabold leading-tight text-slate-900 md:text-[15px]">
            {business.name}
          </span>
          {/* Wraps freely on a phone. The two-line clamp is kept from md
              up, where six cards sit in one row and uneven summaries
              would stagger the buttons. */}
          <span className="mt-1 text-[11px] leading-snug text-slate-500 md:line-clamp-2">
            {business.summary}
          </span>
        </span>
      </span>

      {/* Full card width on every size. Inside the text column, the
          longest label — "Menu & Information" — was competing with the
          logo for horizontal space; here it has the whole card. */}
      <span
        className={[
          'inline-flex min-h-touch w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-center text-[12px] font-bold leading-tight',
          accent.button,
        ].join(' ')}
      >
        <ActionIcon kind={business.kind} />
        <span>{label}</span>
      </span>
    </button>
  );
}
