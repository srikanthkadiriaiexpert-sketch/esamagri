import { useNavigate } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { SearchInput } from '../../design-system/SearchInput';
import { CategoryCard } from '../../design-system/CategoryCard';
import { AnnouncementCard } from '../../design-system/AnnouncementCard';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import { useRikCart } from '../../lib/cart/RikCartContext';
import {
  fetchEligibilityDays,
  missingEligibilityRationTypes,
  type EligibilityDays,
} from '../../lib/api/rik-eligibility-days-api';
import type { Announcement, CategorySummary } from '../../lib/api/types';

/**
 * RIK module home (STEP 8 Section 5). Shows ONLY RIK content — no PIF
 * data anywhere on this screen, per the strict separation in Section 7.
 */
export function RikHomePage() {
  const navigate = useNavigate();
  const cart = useRikCart();

  const categories = useResource<CategorySummary[]>(() => apiRequest('/rik/categories'), undefined, []);
  const announcements = useResource<Announcement[]>(
    () => apiRequest<Announcement[]>('/announcements?audience=RIK'),
    undefined,
    []
  );

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="RIK — Ration in Kind"
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/rik/cart')} />}
      />

      <main className="p-4">
        <button type="button" onClick={() => navigate('/rik/search')} className="block w-full text-left">
          <SearchInput readOnly value="" placeholder="Search RIK products…" />
        </button>

        <EligibilityNotice />

        {/*
          Know Your Ration (STEP 11D). This was a "pending confirmation"
          note through STEP 8-10, because the entitlement scale and
          ratios genuinely were unconfirmed. They are configured now, so
          this is a real entry point to a real calculation.

          It still states no quantity itself. Every figure lives one tap
          away and comes from the engine, because what a given officer
          is entitled to depends on their dietary preference and their
          eligible days — neither of which this screen knows, and
          neither of which it should guess at.
        */}
        <button
          type="button"
          onClick={() => navigate('/rik/ration')}
          className="mt-4 flex w-full min-h-touch items-center gap-3 rounded-2xl border border-brand-blue/20 bg-brand-blueLight p-4 text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M5 4h14v16l-7-3-7 3V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M9 9h6M9 12.5h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-brand-blueDark">Know Your Ration</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-brand-blueDark/80">
              See what you are entitled to this period, choose your items and check what is left.
            </span>
          </span>
          <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-brand-blueDark/60" fill="none" aria-hidden="true">
            <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/*
          When you may collect (STEP 15C). A second entry point beside Know
          Your Ration, because "what am I entitled to" and "when can I come
          and get it" are the two questions an officer actually has. It states
          no date itself — every date lives one tap away and comes from the
          schedule the facility published.
        */}
        <button
          type="button"
          onClick={() => navigate('/rik/issue-schedule')}
          className="mt-3 flex w-full min-h-touch items-center gap-3 rounded-2xl border border-brand-green/25 bg-brand-greenLight p-4 text-left"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green text-white"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M4 7h16v13H4V7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M8 4v4M16 4v4M4 11h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-brand-greenDark">Issue schedule</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-brand-greenDark/80">
              The Fresh and Dry windows for this period, and the days the yard will be open.
            </span>
          </span>
          <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-brand-greenDark/60" fill="none" aria-hidden="true">
            <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/*
          The issue voucher (PHASE D). The third of the officer's three
          questions, after "what am I entitled to" and "when can I collect":
          "what exactly will I be given, and against what document". It
          states no voucher number, status or quantity itself — all of that
          lives one tap away and comes from the voucher the facility issued.
        */}
        <button
          type="button"
          onClick={() => navigate('/rik/issue-vouchers')}
          className="mt-3 flex w-full min-h-touch items-center gap-3 rounded-2xl border border-brand-amber/30 bg-brand-amberLight p-4 text-left"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-amber text-white"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <path d="M9 8h6M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-brand-amberDark">Issue vouchers</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-brand-amberDark/80">
              Your Fresh and Dry vouchers for this period, and exactly what will be issued.
            </span>
          </span>
          <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-brand-amberDark/60" fill="none" aria-hidden="true">
            <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <section className="mt-4" aria-labelledby="rik-announcements-heading">
          {announcements.status === 'success' && announcements.data.length > 0 ? (
            <div className="rounded-2xl bg-white p-3 shadow-card">
              <h2 id="rik-announcements-heading" className="sr-only">
                RIK announcements
              </h2>
              {announcements.data.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} />
              ))}
            </div>
          ) : null}
        </section>

        <section className="mt-4" aria-labelledby="rik-categories-heading">
          <h2 id="rik-categories-heading" className="mb-2 text-sm font-bold text-slate-900">
            Categories
          </h2>

          {categories.status === 'loading' ? <LoadingState /> : null}
          {categories.status === 'error' ? <ErrorState /> : null}
          {categories.status === 'not_implemented' ? (
            <ErrorState variant="not_implemented" description="The RIK catalog is being built and will appear here soon." />
          ) : null}
          {categories.status === 'success' && categories.data.length === 0 ? (
            <EmptyState title="No categories yet" />
          ) : null}
          {categories.status === 'success' && categories.data.length > 0 ? (
            <>
              <div className="mt-2 grid grid-cols-3 gap-3">
                {categories.data.map((c) => (
                  <CategoryCard key={c.id} category={c} accent="blue" onClick={() => navigate(`/rik/categories/${c.id}`)} />
                ))}
              </div>
            </>
          ) : null}
        </section>

        <section className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/rik/orders')}
            className="flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card"
          >
            <p className="text-sm font-bold text-slate-900">My RIK Orders</p>
            <p className="mt-0.5 text-xs text-slate-500">Track pickup / delivery status</p>
          </button>
        </section>
      </main>
    </div>
  );
}

/**
 * "YOUR FRESH DAYS HAVE NOT BEEN PUBLISHED YET."
 *
 * Fresh and Dry eligible days are two independent figures the facility
 * publishes from its sheets, and each one scales its own half of the ration.
 * A type with no published figure has nothing to calculate, so that half of
 * Know Your Ration is empty — and an empty screen is exactly where an officer
 * concludes the app is broken, or that they are entitled to nothing. Neither
 * is true, so it is said plainly, on the first screen they open, before they
 * tap through to a category that will not be there.
 *
 * WHAT THIS CARD DOES NOT DO:
 *
 *   * it states no quantity and no day count of its own — the figures live on
 *     Know Your Ration, where they come from the server;
 *   * it does not appear for a PUBLISHED ZERO. Zero days is a figure the
 *     facility published, and the officer is shown "0 days" rather than being
 *     warned that something is missing;
 *   * it does not appear while the read is loading or if it fails, because a
 *     warning the officer cannot act on, raised by a network error, is worse
 *     than silence. The home screen is never gated on this read;
 *   * it blames nobody and promises no date. It says which figure is awaited
 *     and who to ask.
 */
function EligibilityNotice() {
  const navigate = useNavigate();
  // No dev fallback: a fabricated figure here would warn an officer about a
  // sheet that is not actually missing, or hide one that is.
  const days = useResource<EligibilityDays>(() => fetchEligibilityDays(), undefined, []);
  if (days.status !== 'success') return null;

  const missing = missingEligibilityRationTypes(days.data);
  if (missing.length === 0) return null;

  const which = missing.join(' and ');
  const plural = missing.length > 1;

  return (
    <div
      role="status"
      className="mt-4 rounded-2xl border border-brand-amber/40 bg-brand-amberLight p-4"
    >
      <p className="text-sm font-bold text-brand-amberDark">
        {which} eligible days not yet published
      </p>
      <p className="mt-1 text-xs leading-relaxed text-brand-amberDark/90">
        The facility has not published your {which} eligible days for{' '}
        <span className="font-semibold">{days.data.period.name}</span>, so your {which}{' '}
        {plural ? 'entitlements' : 'entitlement'} cannot be shown or selected yet. This is not a nil
        entitlement — the {plural ? 'figures have' : 'figure has'} not arrived. Please contact the RIK
        office.
      </p>
      <button
        type="button"
        onClick={() => navigate('/rik/ration')}
        className="mt-2 text-xs font-bold text-brand-amberDark underline"
      >
        See what has been published
      </button>
    </div>
  );
}
