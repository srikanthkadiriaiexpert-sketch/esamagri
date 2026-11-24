import { useNavigate } from 'react-router-dom';
import { Header } from '../../../design-system/Header';
import { Card, CardBody } from '../../../design-system/Card';
import { CategoryImage } from './CatalogueItem';
import { Badge } from '../../../design-system/Badge';
import { EmptyState } from '../../../design-system/StateViews';
import { useResource } from '../../../lib/api/resource';
import { fetchMyProfile, type CustomerProfile } from '../../../lib/api/customer-api';
import {
  formatQuantity,
  type EntitlementCategory,
  type EntitlementResponse,
} from '../../../lib/api/rik-entitlement-api';
import {
  eligibleDaysLabel,
  fetchEligibilityDays,
  type EligibilityDays,
} from '../../../lib/api/rik-eligibility-days-api';
import { useEntitlement } from './useEntitlement';
import { RationStateView } from './RationStates';

/**
 * Know Your Ration — the customer's entitlement at a glance (STEP 11D).
 *
 * Every category on this screen comes from the backend's own FRESH and
 * DRY lists. There is no category list in this file, and there must
 * never be one: which pools apply to a customer is decided by their
 * dietary preference and the facility's configuration, so a hard-coded
 * list here would be a second, silently wrong copy of a rule that lives
 * in the database. A pure vegetarian sees no meat on this screen not
 * because of anything written here, but because the server did not send
 * it.
 *
 * Nor is a single figure computed here. Daily scale, eligible days,
 * total, used and remaining all arrive ready; this screen chooses the
 * words and the layout and nothing else.
 */
const DIET_LABELS: Record<string, string> = {
  PV: 'Pure vegetarian',
  EV: 'Egg-eating vegetarian',
  NV: 'Non-vegetarian',
};

export function KnowYourRationPage() {
  const navigate = useNavigate();
  const { state, reload } = useEntitlement();
  const profile = useResource<CustomerProfile>(() => fetchMyProfile(), undefined, []);
  /**
   * The two figures the facility publishes separately (STEP 16).
   *
   * A SEPARATE, OPTIONAL READ. It is not part of the entitlement response and
   * must not become a gate: if this one route fails, the rest of the screen is
   * unaffected and the two lines simply do not appear. An officer who can see
   * their entitlement must never be shown an error page because a
   * supplementary figure could not be fetched.
   */
  const days = useResource<EligibilityDays>(() => fetchEligibilityDays(), undefined, []);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Know Your Ration" tone="forest" showBack onBack={() => navigate('/rik')} />

      <main className="p-4 pb-8">
        {state.status !== 'ready' ? (
          <RationStateView state={state} onRetry={reload} />
        ) : (
          <>
            <Card className="mb-4">
              <CardBody>
                <p className="text-base font-bold text-slate-900">
                  {profile.status === 'success' ? profile.data.name : 'Your ration'}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Dietary preference</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      {DIET_LABELS[state.data.dietaryPreference] ?? state.data.dietaryPreference}
                    </dd>
                  </div>
                  {/*
                    The facility publishes fresh and dry eligibility
                    separately, so both are shown separately. "Not yet
                    published" is spelled out rather than shown as 0 or a
                    dash: a sheet that has not arrived is not the same as a
                    sheet saying nought days, and an officer must not read one
                    as the other.
                  */}
                  {days.status === 'success' ? (
                    <>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Fresh eligible days</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                          {eligibleDaysLabel(days.data.freshEligibleDays)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-medium text-slate-500">Dry eligible days</dt>
                        <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                          {eligibleDaysLabel(days.data.dryEligibleDays)}
                        </dd>
                      </div>
                    </>
                  ) : null}
                  <div className="col-span-2">
                    <dt className="text-xs font-medium text-slate-500">Ration period</dt>
                    <dd className="mt-0.5 font-semibold text-slate-900">
                      {state.data.period.name}
                      <span className="ml-1 font-normal tabular-nums text-slate-500">
                        ({state.data.period.startDate} to {state.data.period.endDate})
                      </span>
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <p className="mb-4 text-sm leading-relaxed text-slate-600">
              Tap a category to see what you may take and to choose your items. Anything you choose is checked against
              your entitlement before it is saved.
            </p>

            <CategorySection
              heading="Fresh"
              description="Issued on the fresh ration day."
              categories={state.data.fresh}
              onOpen={(poolId) => navigate(`/rik/ration/${poolId}`)}
            />

            <CategorySection
              heading="Dry"
              description="Issued on the dry ration day."
              categories={state.data.dry}
              onOpen={(poolId) => navigate(`/rik/ration/${poolId}`)}
            />

            <ConfirmBar entitlement={state.data} onReview={() => navigate('/rik/ration/confirm')} />

            {state.data.fresh.length === 0 && state.data.dry.length === 0 ? (
              <EmptyState
                title="Nothing is applicable to you this period"
                description="No ration category applies to your dietary preference for this period. Please speak to the facility if you think that is wrong."
              />
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

/**
 * The way out of Know Your Ration: review what has been chosen and
 * confirm it. Or, once confirmed, the reference and a way back to it.
 *
 * It counts nothing and decides nothing — whether anything is chosen is
 * read from the server's own `consumed` figures, and whether the
 * selection is confirmed is the server's `selection.status`.
 */
function ConfirmBar({
  entitlement,
  onReview,
}: {
  entitlement: EntitlementResponse;
  onReview: () => void;
}) {
  const confirmed = entitlement.selection?.status === 'CONFIRMED';
  const anythingChosen = [...entitlement.fresh, ...entitlement.dry].some((c) => c.consumed > 0);

  if (confirmed) {
    return (
      <section className="mb-6 rounded-2xl border border-brand-green/40 bg-brand-greenLight p-4" aria-labelledby="confirmed-heading">
        <h2 id="confirmed-heading" className="text-sm font-bold text-brand-greenDark">
          Your ration for this period is confirmed
        </h2>
        <p className="mt-1 text-xs text-brand-greenDark/90">
          Reference{' '}
          <span className="font-mono font-bold">{entitlement.selection?.referenceNumber ?? '—'}</span>. A confirmed
          selection cannot be changed.
        </p>
        <button
          type="button"
          onClick={onReview}
          className="mt-3 min-h-touch w-full rounded-lg border border-brand-greenDark/30 bg-white px-4 py-2 text-sm font-semibold text-brand-greenDark"
        >
          View your confirmation
        </button>
      </section>
    );
  }

  if (!anythingChosen) return null;

  return (
    <section className="mb-6 rounded-2xl border border-brand-blue/20 bg-white p-4 shadow-card">
      <p className="text-sm font-bold text-slate-900">Ready to confirm?</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Review everything you have chosen, then confirm and tell us how you would like to receive it.
      </p>
      <button
        type="button"
        onClick={onReview}
        className="mt-3 min-h-touch w-full rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-bold text-white"
      >
        Review and confirm
      </button>
    </section>
  );
}

function CategorySection({
  heading,
  description,
  categories,
  onOpen,
}: {
  heading: string;
  description: string;
  categories: EntitlementCategory[];
  onOpen: (poolId: string) => void;
}) {
  if (categories.length === 0) return null;
  const headingId = `ration-section-${heading.toLowerCase()}`;

  return (
    <section className="mb-6" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-bold uppercase tracking-wide text-slate-900">
        {heading}
      </h2>
      <p className="mb-2 text-xs text-slate-500">{description}</p>

      <ul className="flex flex-col gap-2" role="list">
        {categories.map((category) => (
          <li key={category.poolId}>
            <button
              type="button"
              onClick={() => onOpen(category.poolId)}
              className="flex w-full min-h-touch items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card hover:border-brand-blue"
            >
              <CategoryImage name={category.name} imageRef={category.imageRef} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{category.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Your entitlement: {formatQuantity(category.totalEntitlement, category.unit)}
                </p>
              </div>

              <div className="shrink-0 text-right">
                {category.consumed > 0 ? (
                  <>
                    <Badge tone={category.remaining > 0 ? 'green' : 'amber'}>
                      {category.remaining > 0
                        ? `${formatQuantity(category.remaining, category.unit)} left`
                        : 'Fully used'}
                    </Badge>
                    <p className="mt-1 text-xs tabular-nums text-slate-500">
                      Selected {formatQuantity(category.consumed, category.unit)}
                    </p>
                  </>
                ) : (
                  <Badge tone="neutral">Nothing selected</Badge>
                )}
              </div>

              <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-400" fill="none" aria-hidden="true">
                <path
                  d="M7.5 4.5l6 5.5-6 5.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
