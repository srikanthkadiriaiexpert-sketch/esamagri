import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResource } from '../../lib/api/resource';
import {
  fetchRikNewArrivals,
  packLabel,
  type NewArrivals,
  type NewArrivalItem,
} from '../../lib/api/rik-new-arrivals-api';
import { Header } from '../../design-system/Header';
import { RemoteImage } from '../../design-system/RemoteImage';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';

/**
 * New Arrivals — what the facility is currently highlighting.
 *
 * WHAT THIS SCREEN DOES NOT SAY. It does not say you may take any of this,
 * how much, or that any is in stock. Everything here is a product the
 * facility has chosen to point out, nothing more, and the screen says so in
 * as many words at the foot rather than leaving a customer to assume
 * otherwise. No quantity box, no cart, no entitlement figure — the link out
 * goes to Know Your Ration, which is the only screen that answers an
 * allowance.
 *
 * STAFF-MANAGED, LIVE. Every entry was published by a named member of RIK
 * staff through the Admin Portal and is fetched from the API on each visit.
 * There is no list of products in this file and none in the bundle: publish
 * something at 10am and it is here at 10am, with no rebuild and no deploy.
 *
 * AN EMPTY LIST IS A NORMAL STATE. Before staff feature anything — or after
 * they unpublish the last entry — this screen is empty, and says so plainly
 * instead of showing a spinner forever or inventing something to fill the
 * space.
 */
export function NewArrivalsPage() {
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const arrivals = useResource<NewArrivals>(() => fetchRikNewArrivals(), undefined, [reloadKey]);

  const items = arrivals.status === 'success' ? arrivals.data.items : [];

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Header title="New Arrivals" />

      <div className="px-4">
        <p className="text-sm text-slate-600">
          Products the facility has recently added to the RIK range.
        </p>
      </div>

      {arrivals.status === 'loading' ? <LoadingState label="Loading New Arrivals…" /> : null}

      {arrivals.status === 'error' ? (
        <ErrorState
          title="New Arrivals could not be loaded"
          description="Check your connection and try again."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

      {arrivals.status === 'success' && items.length === 0 ? (
        <EmptyState
          title="Nothing new just now"
          description="When the facility adds a new product to the RIK range, it will appear here."
        />
      ) : null}

      {arrivals.status === 'success' && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3 px-4" data-testid="new-arrivals-list">
            {items.map((item) => (
              <ArrivalCard key={item.id} item={item} />
            ))}
          </ul>

          {/*
            The honest footnote. Without it, a screen of products under the
            word "New" reads as an offer, and a customer could reasonably
            conclude that being listed means being available to them.
          */}
          <div className="px-4">
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Being listed here does not mean an item is part of your entitlement or available to you this period.
              Check <strong>Know Your Ration</strong> for what you may take.
            </p>
            <button
              type="button"
              onClick={() => navigate('/rik/ration')}
              className="mt-2 min-h-touch w-full rounded-xl bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2"
            >
              Open Know Your Ration
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ArrivalCard({ item }: { item: NewArrivalItem }) {
  const pack = packLabel(item);
  // Catalogue facts are absent on a standalone listing, which is the ordinary
  // case. The sub-line is built from whatever is actually present and is
  // omitted entirely when nothing is — better no line than "null · null".
  const details = [item.poolName, pack].filter((part): part is string => Boolean(part)).join(' · ');

  return (
    <li
      className="rounded-2xl border border-slate-200 bg-white p-3"
      data-testid={`new-arrival-${item.code ?? item.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <RemoteImage
            src={item.imageRef}
            alt={item.name}
            className="h-16 w-16 rounded-xl border border-slate-200 bg-white object-cover"
            fallback={
              <div
                role="img"
                aria-label={`No picture for ${item.name}`}
                className="flex h-16 w-16 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-[10px] text-slate-400"
              >
                No picture
              </div>
            }
          />
          <span className="absolute -left-1 -top-1 rounded-full bg-brand-amberDark px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
            New
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">{item.name}</p>
          {item.brand ? <p className="mt-0.5 text-xs font-medium text-slate-600">{item.brand}</p> : null}
          {details ? <p className="mt-0.5 text-xs text-slate-500">{details}</p> : null}
          {item.headline ? <p className="mt-1.5 text-sm text-slate-700">{item.headline}</p> : null}
          {item.publishedFrom ? (
            <p className="mt-1 text-[11px] text-slate-400">Added {item.publishedFrom}</p>
          ) : null}
        </div>
      </div>
    </li>
  );
}
