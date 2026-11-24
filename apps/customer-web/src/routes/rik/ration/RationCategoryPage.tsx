import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../../../design-system/Header';
import { Card, CardBody } from '../../../design-system/Card';
import { Badge } from '../../../design-system/Badge';
import { Button } from '../../../design-system/Button';
import { EmptyState } from '../../../design-system/StateViews';
import {
  countNoun,
  describeRate,
  formatPack,
  formatProvisionQuantity,
  formatQuantity,
  quantityFieldLabel,
  setElections,
  setProvisionQuantity,
  type ConversionOption,
  type EntitlementCategory,
  type EntitlementProvision,
  type ValidationResult,
} from '../../../lib/api/rik-entitlement-api';
import { findCategory, useEntitlement } from './useEntitlement';
import { ProvisionBrand, ProvisionImage } from './CatalogueItem';
import { RationStateView } from './RationStates';

/**
 * One ration category, and the choices inside it (STEP 11D).
 *
 * THE POINT OF THIS SCREEN is that everything in it draws on ONE
 * balance. Rice, atta, bread and pizza base are not four allowances;
 * they are four ways to spend the same one, and an officer who cannot
 * see that will over-plan and be refused at the counter. So the balance
 * sits at the top, updates after every change, and every chosen item
 * shows what it costs that balance rather than only what was taken.
 *
 * NOTHING HERE IS CALCULATED. Not the entitlement, not the running
 * total, not what an item costs, not the ceiling on a quantity box.
 * Each of those arrives from the engine, and after every change this
 * screen adopts the entitlement the server sends back rather than
 * predicting it. The only arithmetic in the file is composing a
 * REQUESTED quantity from pack steps — an input the server then
 * validates like any other.
 */
export function RationCategoryPage() {
  const navigate = useNavigate();
  const { poolId = '' } = useParams<{ poolId: string }>();
  const { state, reload, reconcile, handleMutationError } = useEntitlement();

  /** The server's last refusal, kept next to the item it refused. */
  const [refusal, setRefusal] = useState<{ provisionId: string | null; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const category = state.status === 'ready' ? findCategory(state.data, poolId) : null;

  const applyResult = (provisionId: string | null, result: ValidationResult) => {
    setRefusal(result.ok ? null : { provisionId, message: result.message });
  };

  const changeQuantity = async (provision: EntitlementProvision, quantity: number) => {
    setBusyId(provision.provisionId);
    setRefusal(null);
    try {
      const response = await setProvisionQuantity(provision.provisionId, quantity);
      // Adopt the server's entitlement whether it accepted or refused —
      // on a refusal it returns the balance as it still stands, which is
      // exactly what should be on screen.
      reconcile(response.entitlement);
      applyResult(provision.provisionId, response.result);
    } catch (err: unknown) {
      handleMutationError(err);
      setRefusal({ provisionId: provision.provisionId, message: 'That change could not be saved. Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  const chooseAlternative = async (option: ConversionOption, take: boolean) => {
    if (!category) return;
    setBusyId(option.conversionId);
    setRefusal(null);

    // Replace the whole choice for this category: taking one alternative
    // means not taking the other, which is the server's rule and the
    // reason this sends a set rather than a toggle.
    const keptElsewhere = alternativesChosenOutside(state, category.poolId);
    const next = take ? [...keptElsewhere, option.conversionId] : keptElsewhere;

    try {
      const response = await setElections(next);
      reconcile(response.entitlement);
      applyResult(null, response.result);
    } catch (err: unknown) {
      handleMutationError(err);
      setRefusal({ provisionId: null, message: 'That choice could not be saved. Please try again.' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title={category?.name ?? 'Your ration'}
        tone="forest"
        showBack
        onBack={() => navigate('/rik/ration')}
      />

      <main className="p-4 pb-8">
        {state.status !== 'ready' ? (
          <RationStateView state={state} onRetry={reload} />
        ) : category === null ? (
          <EmptyState
            title="This category is not part of your ration"
            description="It may not apply to your dietary preference, or the period may have changed."
            action={{ label: 'Back to Know Your Ration', onClick: () => navigate('/rik/ration') }}
          />
        ) : (
          <>
            <BalanceCard category={category} />

            {category.automaticConversions.length > 0 ? <AutomaticNote category={category} /> : null}

            {category.conversionOptions.length > 0 ? (
              <Alternatives
                category={category}
                busyId={busyId}
                onChoose={(option, take) => void chooseAlternative(option, take)}
              />
            ) : null}

            {refusal && refusal.provisionId === null ? <Refusal message={refusal.message} /> : null}

            <SelectionSummary category={category} />

            <section className="mt-5" aria-labelledby="provisions-heading">
              <h2 id="provisions-heading" className="mb-2 text-sm font-bold text-slate-900">
                Available items
              </h2>

              {category.provisions.length === 0 ? (
                <EmptyState
                  title="No items are available in this category"
                  description="Your entitlement applies, but the facility has not made any item available for it yet."
                />
              ) : (
                <ul className="flex flex-col gap-3" role="list">
                  {category.provisions.map((provision) => (
                    <li key={provision.provisionId}>
                      <ProvisionRow
                        provision={provision}
                        category={category}
                        busy={busyId === provision.provisionId}
                        refusal={refusal?.provisionId === provision.provisionId ? refusal.message : null}
                        onChange={(quantity) => void changeQuantity(provision, quantity)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {category.unavailableProvisions.length > 0 ? <NotAvailableYet category={category} /> : null}

            <div className="mt-6">
              <Button variant="outline" accent="blue" fullWidth onClick={() => navigate('/rik/ration')}>
                Back to all categories
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Alternatives chosen in OTHER categories, which this change must not disturb. */
function alternativesChosenOutside(
  state: ReturnType<typeof useEntitlement>['state'],
  poolId: string
): string[] {
  if (state.status !== 'ready') return [];
  return [...state.data.fresh, ...state.data.dry]
    .filter((c) => c.poolId !== poolId)
    .flatMap((c) => c.conversionOptions.filter((o) => o.selected).map((o) => o.conversionId))
    .filter((id, index, all) => all.indexOf(id) === index);
}

/**
 * Entitlement, used and remaining — the three numbers everything else
 * on the screen refers back to. Remaining is given the most weight
 * because it is the one that decides what the customer can still do.
 */
function BalanceCard({ category }: { category: EntitlementCategory }) {
  const fullyUsed = category.remaining <= 0;

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500">Your entitlement this period</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
              {formatQuantity(category.totalEntitlement, category.unit)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {formatQuantity(category.effectiveDailyQty, category.unit)} per day × {category.eligibleDays} eligible
              days
            </p>
          </div>
          <Badge tone={fullyUsed ? 'amber' : 'green'}>{fullyUsed ? 'Fully used' : 'Available'}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs font-medium text-slate-500">Selected so far</dt>
            <dd className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">
              {formatQuantity(category.consumed, category.unit)}
            </dd>
          </div>
          <div className={['rounded-xl p-3', fullyUsed ? 'bg-brand-amberLight' : 'bg-brand-greenLight'].join(' ')}>
            <dt className={['text-xs font-medium', fullyUsed ? 'text-brand-amberDark' : 'text-brand-greenDark'].join(' ')}>
              Still available
            </dt>
            <dd
              className={[
                'mt-0.5 text-lg font-bold tabular-nums',
                fullyUsed ? 'text-brand-amberDark' : 'text-brand-greenDark',
              ].join(' ')}
            >
              {formatQuantity(category.remaining, category.unit)}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Every item below draws on this one entitlement. Choosing more of one leaves less for the others.
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Why the daily figure is larger than the base scale. Shown because an
 * officer who does not know an automatic conversion happened will read
 * the total as a mistake.
 */
function AutomaticNote({ category }: { category: EntitlementCategory }) {
  return (
    <section className="mt-4 rounded-2xl border border-semantic-info/20 bg-semantic-infoLight p-4" aria-labelledby="auto-conv-heading">
      <h2 id="auto-conv-heading" className="text-sm font-bold text-semantic-info">
        Included automatically
      </h2>
      <p className="mt-1 text-xs text-slate-600">
        Your daily {category.name.toLowerCase()} already includes entitlement carried over from items you do not take.
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700" role="list">
        <li className="flex justify-between gap-3">
          <span>Base scale</span>
          <span className="tabular-nums font-semibold">{formatQuantity(category.dailyScale, category.unit)} a day</span>
        </li>
        {category.automaticConversions.map((conversion) => (
          <li key={conversion.code} className="flex justify-between gap-3">
            <span className="min-w-0 flex-1">{conversion.description ?? 'Carried over automatically'}</span>
            <span className="tabular-nums font-semibold text-semantic-info">
              + {formatQuantity(conversion.toDailyQty, category.unit)} a day
            </span>
          </li>
        ))}
        <li className="mt-1 flex justify-between gap-3 border-t border-semantic-info/20 pt-1 font-bold">
          <span>Your daily total</span>
          <span className="tabular-nums">{formatQuantity(category.effectiveDailyQty, category.unit)} a day</span>
        </li>
      </ul>
    </section>
  );
}

/**
 * Elective conversions — "choose one". The server refuses two that
 * spend the same entitlement, and taking one here replaces the other
 * rather than adding to it, so the customer cannot construct a
 * combination that will only be rejected.
 */
function Alternatives({
  category,
  busyId,
  onChoose,
}: {
  category: EntitlementCategory;
  busyId: string | null;
  onChoose: (option: ConversionOption, take: boolean) => void;
}) {
  const chosen = category.conversionOptions.find((o) => o.selected) ?? null;

  return (
    <section className="mt-4" aria-labelledby="alternatives-heading">
      <h2 id="alternatives-heading" className="mb-1 text-sm font-bold text-slate-900">
        Choose an alternative
      </h2>
      <p className="mb-2 text-xs text-slate-500">
        You may take one of these instead. Only one can be chosen, because they all come out of the same entitlement.
      </p>

      <ul className="flex flex-col gap-2" role="list">
        {category.conversionOptions.map((option) => {
          const isChosen = option.selected;
          return (
            <li key={option.conversionId}>
              <button
                type="button"
                aria-pressed={isChosen}
                disabled={busyId !== null}
                onClick={() => onChoose(option, !isChosen)}
                className={[
                  'flex w-full min-h-touch items-center gap-3 rounded-2xl border p-4 text-left',
                  isChosen ? 'border-brand-blue bg-brand-blueLight' : 'border-slate-200 bg-white',
                  busyId !== null ? 'opacity-60' : '',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    isChosen ? 'border-brand-blue bg-brand-blue text-white' : 'border-slate-300',
                  ].join(' ')}
                >
                  {isChosen ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">
                    {option.description ?? `Take ${formatQuantity(option.toDailyQty, category.unit)} a day instead`}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Adds {formatQuantity(option.toDailyQty, category.unit)} a day to this entitlement
                  </span>
                </span>
                {isChosen ? <Badge tone="info">Chosen</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {chosen ? (
        <p className="mt-2 text-xs text-slate-500">
          Tap your chosen alternative again to take it back. Your entitlement above already reflects this choice.
        </p>
      ) : null}
    </section>
  );
}

/**
 * What has been chosen so far, and what each choice costs the shared
 * balance. This is the screen's answer to "why is there less left than
 * I expected" — every figure is the server's.
 */
function SelectionSummary({ category }: { category: EntitlementCategory }) {
  const chosen = category.provisions.filter((p) => p.selectedQuantity > 0);
  if (chosen.length === 0) return null;

  return (
    <section className="mt-4" aria-labelledby="selection-summary-heading">
      <h2 id="selection-summary-heading" className="mb-2 text-sm font-bold text-slate-900">
        What you have chosen
      </h2>
      <Card>
        <CardBody className="p-0">
          <ul role="list">
            {chosen.map((provision) => (
              <li
                key={provision.provisionId}
                className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0"
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                  {provision.name}
                  {provision.brand === null ? null : (
                    <span className="block text-xs font-normal text-slate-500">{provision.brand}</span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-slate-900">
                    {formatProvisionQuantity(provision, provision.selectedQuantity)}
                  </span>
                  <span className="block text-xs tabular-nums text-slate-500">
                    uses {formatQuantity(provision.selectedPoolEquivalentQty, category.unit)}
                  </span>
                </span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-3 bg-slate-50 px-4 py-3">
              <span className="text-sm font-bold text-slate-900">Total used</span>
              <span className="text-sm font-bold tabular-nums text-slate-900">
                {formatQuantity(category.consumed, category.unit)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-3 bg-slate-50 px-4 pb-3">
              <span className="text-sm font-bold text-brand-greenDark">Still available</span>
              <span className="text-sm font-bold tabular-nums text-brand-greenDark">
                {formatQuantity(category.remaining, category.unit)}
              </span>
            </li>
          </ul>
        </CardBody>
      </Card>
    </section>
  );
}

/**
 * One item. The quantity box is the authority; the plus and minus keys
 * step by a pack where the facility recorded one, and by a single piece
 * for anything counted in pieces. Where neither applies the box stands
 * alone rather than stepping by an invented amount.
 */
function ProvisionRow({
  provision,
  category,
  busy,
  refusal,
  onChange,
}: {
  provision: EntitlementProvision;
  category: EntitlementCategory;
  busy: boolean;
  refusal: string | null;
  onChange: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState<string>(String(provision.selectedQuantity));
  const [dirty, setDirty] = useState(false);

  // The server is the record; unless the customer is mid-edit, show it.
  const shown = dirty ? draft : String(provision.selectedQuantity);
  const step = provision.packSize ?? (provision.unit === 'piece' ? 1 : null);
  // How the pack reads, from the facility's own catalogue data. The
  // stepper above still works in the entitlement unit, which is what
  // the server validates; this only chooses words for the same figure.
  const packLabel = formatPack(provision);
  // What one of these is called when counted — "coupon" for the Fresh Milk
  // coupon, null for anything measured. Drives the wording below and
  // nothing else; the figures all come from the server.
  const countedAs = countNoun(provision);

  const commit = (value: number) => {
    setDirty(false);
    // A whole number where the item is counted rather than measured. Rounded
    // DOWN, for the same reason every other figure on this screen is: a
    // rounding that gave an officer more than the entitlement allows would
    // be refused by the server anyway, and offering it first is worse than
    // not offering it. The server remains the authority and answers
    // WHOLE_UNITS_ONLY if a fraction ever reaches it.
    const stepped = provision.wholeUnitsOnly ? Math.floor(value) : value;
    onChange(Math.max(0, stepped));
  };

  const inputId = `qty-${provision.provisionId}`;

  return (
    <Card className={provision.selectedQuantity > 0 ? 'border-brand-blue/40' : ''}>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <ProvisionImage item={provision} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900">{provision.name}</p>
            <ProvisionBrand brand={provision.brand} />
            <p className="mt-0.5 text-xs text-slate-500">{describeRate(provision, category.unit)}</p>
          </div>
          {provision.selectedQuantity > 0 ? (
            <Badge tone="info">{formatProvisionQuantity(provision, provision.selectedQuantity)}</Badge>
          ) : null}
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {/* Pack size is shown ONLY where the facility recorded one, and
              is never confused with the entitlement — see the label. */}
          {countedAs !== null ? (
            /* A counted item has no pack SIZE in its own unit — one coupon
               is one coupon. What an officer needs is what one of them is
               worth against the allowance, which is the ratio the server
               already sent. */
            <div className="flex gap-1">
              <dt className="text-slate-500">Each {countedAs}</dt>
              <dd className="font-semibold tabular-nums text-slate-700">
                {formatQuantity(provision.consumptionRatio, category.unit)}
              </dd>
            </div>
          ) : packLabel !== null ? (
            <div className="flex gap-1">
              <dt className="text-slate-500">Pack size</dt>
              <dd className="font-semibold tabular-nums text-slate-700">{packLabel}</dd>
            </div>
          ) : provision.isLoose ? (
            <div className="flex gap-1">
              <dt className="text-slate-500">Issued</dt>
              <dd className="font-semibold text-slate-700">Loose</dd>
            </div>
          ) : (
            <div className="flex gap-1">
              <dt className="text-slate-500">Pack size</dt>
              <dd className="font-semibold text-slate-700">Not specified</dd>
            </div>
          )}

          {provision.maxQuantity !== null ? (
            <div className="flex gap-1">
              <dt className="text-slate-500">Most you may take</dt>
              <dd className="font-semibold tabular-nums text-slate-700">
                {formatProvisionQuantity(provision, provision.maxQuantity)}
              </dd>
            </div>
          ) : null}

          {provision.maxPacks !== null ? (
            <div className="flex gap-1">
              <dt className="text-slate-500">Most packs</dt>
              <dd className="font-semibold tabular-nums text-slate-700">{provision.maxPacks}</dd>
            </div>
          ) : null}

          {/* Which day it is handed over on. Always shown, because it is
              genuinely independent of the entitlement it is drawn from —
              bread comes out of a dry entitlement but is issued fresh —
              and an officer who turns up on the wrong day has been
              failed by the screen. */}
          <div className="flex gap-1">
            <dt className="text-slate-500">Collect on</dt>
            <dd className="font-semibold text-slate-700">
              {provision.issuePeriod === 'FRESH' ? 'fresh ration day' : 'dry ration day'}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor={inputId} className="block text-xs font-medium text-slate-500">
              {quantityFieldLabel(provision)}
            </label>
            <div className="mt-1 flex items-center gap-2">
              {step !== null ? (
                <button
                  type="button"
                  aria-label={`Take one less ${step === 1 ? '' : 'pack '}of ${provision.name}`}
                  disabled={busy || provision.selectedQuantity <= 0}
                  onClick={() => commit(provision.selectedQuantity - step)}
                  className="flex h-touch w-touch shrink-0 items-center justify-center rounded-lg border border-slate-300 text-lg font-bold text-slate-700 disabled:opacity-40"
                >
                  −
                </button>
              ) : null}

              <input
                id={inputId}
                type="number"
                inputMode={provision.wholeUnitsOnly ? 'numeric' : 'decimal'}
                min={0}
                step={provision.wholeUnitsOnly ? 1 : undefined}
                value={shown}
                disabled={busy}
                onChange={(e) => {
                  setDirty(true);
                  setDraft(e.target.value);
                }}
                onBlur={() => {
                  if (!dirty) return;
                  const parsed = Number(draft);
                  if (Number.isNaN(parsed)) {
                    setDirty(false);
                    return;
                  }
                  commit(parsed);
                }}
                className="min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-semibold tabular-nums"
              />

              {step !== null ? (
                <button
                  type="button"
                  aria-label={`Take one more ${step === 1 ? '' : 'pack '}of ${provision.name}`}
                  disabled={busy}
                  onClick={() => commit(provision.selectedQuantity + step)}
                  className="flex h-touch w-touch shrink-0 items-center justify-center rounded-lg border border-slate-300 text-lg font-bold text-slate-700 disabled:opacity-40"
                >
                  +
                </button>
              ) : null}
            </div>
          </div>

          <Button
            variant="outline"
            accent="blue"
            size="sm"
            disabled={busy || provision.maxSelectableQuantity <= 0}
            onClick={() => commit(provision.maxSelectableQuantity)}
          >
            Take max
          </Button>
        </div>

        <p className="mt-1.5 text-xs text-slate-500">
          You may take up to{' '}
          <span className="font-semibold tabular-nums">
            {formatProvisionQuantity(provision, provision.maxSelectableQuantity)}
          </span>{' '}
          of this right now.
          {provision.selectedQuantity > 0 ? (
            <>
              {' '}
              Your {formatProvisionQuantity(provision, provision.selectedQuantity)} uses{' '}
              <span className="font-semibold tabular-nums">
                {formatQuantity(provision.selectedPoolEquivalentQty, category.unit)}
              </span>{' '}
              of your {category.name.toLowerCase()}.
            </>
          ) : null}
        </p>

        {refusal ? <Refusal message={refusal} /> : null}
      </CardBody>
    </Card>
  );
}

/**
 * Items the customer's diet allows that a condition currently blocks,
 * with the server's own explanation. Listed rather than hidden so the
 * customer learns the item exists and what would make it available.
 */
function NotAvailableYet({ category }: { category: EntitlementCategory }) {
  return (
    <section className="mt-5" aria-labelledby="unavailable-heading">
      <h2 id="unavailable-heading" className="mb-2 text-sm font-bold text-slate-900">
        Not available to you this period
      </h2>
      <ul className="flex flex-col gap-2" role="list">
        {category.unavailableProvisions.map((provision) => (
          <li
            key={provision.provisionId}
            className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <ProvisionImage item={provision} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-600">{provision.name}</p>
              <ProvisionBrand brand={provision.brand} />
              <p className="mt-0.5 text-xs text-slate-500">{provision.reason}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The server's refusal, verbatim. It already explains itself in
 * numbers — "your remaining entitlement is 2,000 g; this needs
 * 2,250 g" — and rewording it here would risk saying something the
 * server did not.
 */
function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-lg border border-semantic-danger/30 bg-semantic-dangerLight px-3 py-2 text-sm text-semantic-danger"
    >
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 6v4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="13.75" r="0.9" fill="currentColor" />
      </svg>
      <span>{message}</span>
    </p>
  );
}
