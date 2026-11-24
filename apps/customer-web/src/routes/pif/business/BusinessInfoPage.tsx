import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ExternalLink, MapPin, Clock, CalendarX, Phone } from 'lucide-react';
import { Header } from '../../../design-system/Header';
import { ErrorState } from '../../../design-system/StateViews';
import { MenuGallery } from './MenuGallery';
import { ACCENTS } from '../../../lib/businesses/accents';
import { findBusiness, type Business, type BusinessLocation } from '../../../lib/businesses/businesses';

/**
 * A business that does not sell through this app.
 *
 * FROM THE APPROVED MOCKUP: the logo on a tinted hero, then two actions —
 * "View Menu" and "Outlet Details" — then the outlet card with address,
 * hours, closed day and clickable numbers. Fit Food Bay replaces the menu
 * action with its external ordering button and shows no menu section,
 * because its menu lives in its own app.
 *
 * NO COMMERCE REACHES THIS SCREEN. No Add to Cart, no Buy Now, no quantity,
 * no price, no stock, no order, and no cart button in the header — these
 * businesses have nothing to put in one.
 *
 * EVERY DETAIL IS THE CLIENT'S. Nothing here is inferred or filled in.
 */
export function BusinessInfoPage({ businessSlug }: { businessSlug: string }) {
  const navigate = useNavigate();
  const business = findBusiness(businessSlug);
  const menuRef = useRef<HTMLElement | null>(null);
  const detailsRef = useRef<HTMLElement | null>(null);

  if (business === null) {
    return (
      <div className="app-shell min-h-screen bg-slate-50">
        <Header title="Not found" showBack tone="forest" />
        <main className="p-4">
          <ErrorState title="That business does not exist" onRetry={() => navigate('/pif')} />
        </main>
      </div>
    );
  }

  const accent = ACCENTS[business.accent];
  const menuImages = business.menuImages ?? [];
  const scrollTo = (el: HTMLElement | null) =>
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title={business.name} showBack onBack={() => navigate('/pif')} tone="forest" />

      <main className="px-4 pb-4">
        <section className={['mt-3 overflow-hidden rounded-2xl p-5 text-center', accent.wash].join(' ')}>
          <img
            src={business.logo}
            alt={`${business.name} logo`}
            className="mx-auto max-h-28 max-w-[82%] object-contain"
            width={320}
            height={112}
          />
          <p className="mt-2 text-xs font-semibold text-slate-600">{business.tagline}</p>
        </section>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {business.kind === 'external' && business.externalUrl !== undefined ? (
            <a
              href={business.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={[
                'col-span-2 inline-flex min-h-touch items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold',
                accent.button,
              ].join(' ')}
            >
              <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={2} />
              Open {business.name} App
            </a>
          ) : (
            <button
              type="button"
              onClick={() => scrollTo(menuRef.current)}
              className="inline-flex min-h-touch items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 shadow-card"
            >
              <BookOpen aria-hidden className="h-4 w-4" strokeWidth={2} />
              View Menu
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollTo(detailsRef.current)}
            className={[
              'inline-flex min-h-touch items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 shadow-card',
              business.kind === 'external' ? 'col-span-2' : '',
            ].join(' ')}
          >
            <MapPin aria-hidden className="h-4 w-4" strokeWidth={2} />
            Outlet Details
          </button>
        </div>

        {business.kind === 'external' ? (
          <p className="mt-3 rounded-xl bg-brand-blueLight px-3 py-2.5 text-center text-xs font-medium text-brand-blueDark">
            Opens the existing {business.name} delivery app externally. Your order is placed on
            their site, not here.
          </p>
        ) : null}

        <section ref={detailsRef} className="mt-4 flex scroll-mt-20 flex-col gap-3">
          {(business.locations ?? []).map((location, i) => (
            <LocationCard key={location.label ?? String(i)} location={location} />
          ))}
        </section>

        {business.kind === 'info' ? (
          <section ref={menuRef} className="mt-5 scroll-mt-20" aria-labelledby="menu-heading">
            <h3 id="menu-heading" className="mb-2.5 text-sm font-bold text-slate-900">
              Menu
            </h3>
            {menuImages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
                <p className="text-sm font-semibold text-slate-700">Menu not available yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  The menu artwork for {business.name} has not been supplied. Please call the
                  number above for today&apos;s items and prices.
                </p>
              </div>
            ) : (
              <MenuGallery images={menuImages} businessName={business.name} />
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function LocationCard({ location }: { location: BusinessLocation }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      {location.label === undefined ? null : (
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-brand-green">
          {location.label}
        </p>
      )}

      <div className="flex items-start gap-2">
        <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{location.address}</p>
      </div>

      <dl className="mt-2.5 flex flex-col gap-1.5">
        {location.hours.map((h) => {
          const closed = h.time === 'Closed';
          return (
            <div key={h.days} className="flex items-start gap-2 text-xs">
              {closed ? (
                <CalendarX aria-hidden className="mt-px h-4 w-4 shrink-0 text-slate-300" strokeWidth={2} />
              ) : (
                <Clock aria-hidden className="mt-px h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
              )}
              <dt className="min-w-0 flex-1 text-slate-500">{h.days}</dt>
              <dd
                className={[
                  'shrink-0 font-semibold tabular-nums',
                  closed ? 'text-slate-400' : 'text-slate-800',
                ].join(' ')}
              >
                {h.time}
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {location.phones.map((phone) => (
          <a
            key={phone}
            href={`tel:${phone}`}
            className="inline-flex min-h-touch items-center gap-1.5 rounded-xl border border-brand-green px-3 py-1.5 text-sm font-bold tabular-nums text-brand-greenDark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          >
            <Phone aria-hidden className="h-3.5 w-3.5" strokeWidth={2.2} />
            {phone}
          </a>
        ))}
      </div>
    </article>
  );
}

export type { Business };
