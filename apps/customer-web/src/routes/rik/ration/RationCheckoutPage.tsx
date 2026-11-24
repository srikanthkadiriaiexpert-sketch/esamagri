import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../../design-system/Header';
import { Card, CardBody } from '../../../design-system/Card';
import { Badge } from '../../../design-system/Badge';
import { Button } from '../../../design-system/Button';
import { EmptyState } from '../../../design-system/StateViews';
import { ApiError, NetworkError } from '../../../lib/api/client';
import { useResource } from '../../../lib/api/resource';
import { useTransactionGuard } from '../../../lib/pwa/update-state';
import { fetchMyProfile, type CustomerProfile } from '../../../lib/api/customer-api';
import {
  confirmSelection,
  fetchPickupLocations,
  formatPack,
  formatProvisionQuantity,
  formatQuantity,
  type EntitlementCategory,
  type EntitlementResponse,
  type FulfillmentType,
  type PickupLocation,
  type SelectionState,
} from '../../../lib/api/rik-entitlement-api';
import {
  eligibleDaysLabel,
  fetchEligibilityDays,
  type EligibilityDays,
} from '../../../lib/api/rik-eligibility-days-api';
import { useEntitlement } from './useEntitlement';
import { ProvisionBrand, ProvisionImage } from './CatalogueItem';
import { RationStateView } from './RationStates';

/**
 * RIK checkout — review, acknowledge, choose fulfillment, confirm
 * (STEP 11E).
 *
 * THIS IS NOT A SHOPPING CART. There is no price on this screen, no
 * total, no tax, no payment step and no invoice, because a RIK issue is
 * an entitlement being drawn rather than something bought. A test
 * scans the rendered page for currency and payment words and fails if
 * any appear.
 *
 * FOUR STAGES, one screen. Review what was chosen, accept that a
 * provision may not be there on the day, say where to collect it or
 * where to deliver it, then confirm. They are stages rather than
 * separate routes so the customer can always see what they are
 * confirming while they answer the questions about it — and so a
 * refresh cannot strand them halfway through a wizard.
 *
 * NOTHING IS CALCULATED HERE, exactly as in the rest of Know Your
 * Ration. Every quantity, equivalent and balance on this page is the
 * figure the engine returned.
 *
 * THE ACKNOWLEDGEMENT IS NOT A FORMALITY. The customer is agreeing that
 * what they chose may not be available on the issue day. So the
 * checkbox starts unticked, the confirm button is disabled until it is
 * ticked, and the value is sent to the server — which refuses anything
 * but an explicit true. Scrolling past the box is not agreement.
 */

const DIET_LABELS: Record<string, string> = {
  PV: 'Pure vegetarian',
  EV: 'Egg-eating vegetarian',
  NV: 'Non-vegetarian',
};

export function RationCheckoutPage() {
  const navigate = useNavigate();
  const { state, reload, reconcile } = useEntitlement();
  const profile = useResource<CustomerProfile>(() => fetchMyProfile(), undefined, []);
  const locations = useResource<{ items: PickupLocation[] }>(() => fetchPickupLocations(), undefined, []);

  const [acknowledged, setAcknowledged] = useState(false);
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType | null>(null);
  const [pickupLocationId, setPickupLocationId] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<SelectionState | null>(null);

  // No update prompt mid-confirmation. A reload here is already harmless —
  // the server answers ALREADY_CONFIRMED and this screen reloads rather than
  // erroring (see onConfirm's catch) — so this is about not interrupting
  // someone mid-task, not about data safety.
  useTransactionGuard(busy);

  const entitlement = state.status === 'ready' ? state.data : null;

  // A selection confirmed before this screen opened — a refresh, a
  // shared link, or a second tab. Shown as the confirmation it is,
  // never as a form that could be submitted again.
  useEffect(() => {
    if (entitlement?.selection?.status === 'CONFIRMED') {
      setConfirmed(entitlement.selection);
    }
  }, [entitlement]);

  const chosen = useMemo(() => (entitlement ? chosenCategories(entitlement) : []), [entitlement]);
  const nothingChosen = entitlement !== null && chosen.length === 0;

  const fulfillmentReady =
    fulfillmentType === 'PICKUP'
      ? pickupLocationId !== ''
      : fulfillmentType === 'DELIVERY'
        ? deliveryAddress.trim() !== ''
        : false;

  const canConfirm = acknowledged && fulfillmentReady && !busy && !nothingChosen;

  const onConfirm = async () => {
    if (!fulfillmentType) return;
    setBusy(true);
    setError(null);
    try {
      const response = await confirmSelection({
        availabilityAcknowledged: acknowledged,
        fulfillmentType,
        ...(fulfillmentType === 'PICKUP' ? { pickupLocationId } : { deliveryAddress: deliveryAddress.trim() }),
      });
      reconcile(response.entitlement);
      setConfirmed(response.confirmation);
    } catch (err: unknown) {
      // A second confirmation is not a failure — it means the customer
      // already has one, so show it rather than an error they cannot
      // act on. This is what makes a double tap or a refresh harmless.
      if (err instanceof ApiError && err.details?.reason === 'ALREADY_CONFIRMED') {
        reload();
        setError(null);
      } else {
        setError(messageFor(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title={confirmed ? 'Ration confirmed' : 'Review your ration'}
        tone="forest"
        showBack
        onBack={() => navigate('/rik/ration')}
      />

      <main className="p-4 pb-8">
        {state.status !== 'ready' ? (
          <RationStateView state={state} onRetry={reload} />
        ) : confirmed ? (
          <ConfirmationReceipt
            confirmation={confirmed}
            entitlement={entitlement!}
            profile={profile.status === 'success' ? profile.data : null}
            chosen={chosen}
            onDone={() => navigate('/rik/ration')}
          />
        ) : nothingChosen ? (
          <EmptyState
            title="You have not chosen anything yet"
            description="Open a category from Know Your Ration and choose your provisions before confirming."
            action={{ label: 'Back to Know Your Ration', onClick: () => navigate('/rik/ration') }}
          />
        ) : (
          <>
            <SelectionSummary
              entitlement={entitlement!}
              profile={profile.status === 'success' ? profile.data : null}
              chosen={chosen}
            />

            <AvailabilityWarning acknowledged={acknowledged} onChange={setAcknowledged} />

            <FulfillmentChooser
              locations={locations.status === 'success' ? locations.data.items : []}
              fulfillmentType={fulfillmentType}
              pickupLocationId={pickupLocationId}
              deliveryAddress={deliveryAddress}
              onType={(type) => {
                setFulfillmentType(type);
                setError(null);
              }}
              onPickupLocation={setPickupLocationId}
              onDeliveryAddress={setDeliveryAddress}
            />

            <FinalSummary
              entitlement={entitlement!}
              fulfillmentType={fulfillmentType}
              pickupLocationName={
                locations.status === 'success'
                  ? (locations.data.items.find((l) => l.id === pickupLocationId)?.name ?? null)
                  : null
              }
              deliveryAddress={deliveryAddress}
              ready={canConfirm}
            />

            {error ? (
              <p role="alert" className="mt-4 rounded-lg border border-semantic-danger/30 bg-semantic-dangerLight px-3 py-2 text-sm text-semantic-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4">
              <Button
                variant="primary"
                accent="blue"
                fullWidth
                size="lg"
                disabled={!canConfirm}
                loading={busy}
                onClick={() => void onConfirm()}
              >
                Confirm RIK selection
              </Button>
              {!acknowledged ? (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Tick the box above to confirm you understand the availability notice.
                </p>
              ) : !fulfillmentReady ? (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Choose how you would like to receive your ration.
                </p>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Only the categories the customer actually drew on. */
function chosenCategories(entitlement: EntitlementResponse): EntitlementCategory[] {
  return [...entitlement.fresh, ...entitlement.dry].filter((c) =>
    c.provisions.some((p) => p.selectedQuantity > 0)
  );
}

/**
 * Who this is for, and what they chose. Every figure comes from the
 * server; this reads them back in the order a person checks them.
 */
function SelectionSummary({
  entitlement,
  profile,
  chosen,
}: {
  entitlement: EntitlementResponse;
  profile: CustomerProfile | null;
  chosen: EntitlementCategory[];
}) {
  /**
   * The two figures the facility publishes separately (STEP 16).
   *
   * Optional and non-blocking, exactly as on Know Your Ration: if this one
   * route fails, the checkout summary is unaffected and the two lines do not
   * appear. Nothing on the path to confirming a selection may depend on it.
   */
  const days = useResource<EligibilityDays>(() => fetchEligibilityDays(), undefined, []);

  return (
    <>
      <Card className="mb-4">
        <CardBody>
          <p className="text-base font-bold text-slate-900">{profile?.name ?? 'Your ration'}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-500">Dietary preference</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {DIET_LABELS[entitlement.dietaryPreference] ?? entitlement.dietaryPreference}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-500">Eligible days</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{entitlement.eligibleDays}</dd>
            </div>
            {/*
              Fresh and dry are published separately by the facility, so both
              are shown. A figure that has not been published says so in words
              rather than appearing as 0.
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
                {entitlement.period.name}
                <span className="ml-1 font-normal tabular-nums text-slate-500">
                  ({entitlement.period.startDate} to {entitlement.period.endDate})
                </span>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <IssueSection
        heading="Fresh"
        categories={chosen.filter((c) => entitlement.fresh.some((f) => f.poolId === c.poolId))}
      />
      <IssueSection
        heading="Dry"
        categories={chosen.filter((c) => entitlement.dry.some((d) => d.poolId === c.poolId))}
      />
    </>
  );
}

function IssueSection({ heading, categories }: { heading: string; categories: EntitlementCategory[] }) {
  if (categories.length === 0) return null;
  const headingId = `checkout-${heading.toLowerCase()}`;

  return (
    <section className="mb-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-900">
        {heading}
      </h2>

      <div className="flex flex-col gap-3">
        {categories.map((category) => (
          <Card key={category.poolId}>
            <CardBody className="p-0">
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-bold text-slate-900">{category.name}</p>
                <p className="text-xs tabular-nums text-slate-500">
                  {formatQuantity(category.totalEntitlement, category.unit)} entitlement
                </p>
              </div>

              <ul role="list">
                {category.provisions
                  .filter((p) => p.selectedQuantity > 0)
                  .map((provision) => (
                    <li
                      key={provision.provisionId}
                      className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0"
                    >
                      <ProvisionImage item={provision} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{provision.name}</p>
                        <ProvisionBrand brand={provision.brand} />
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatPack(provision) !== null
                            ? `Pack size ${formatPack(provision)} · `
                            : provision.isLoose
                              ? 'Issued loose · '
                              : ''}
                          Collect on the {provision.issuePeriod === 'FRESH' ? 'fresh' : 'dry'} ration day
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums text-slate-900">
                          {formatProvisionQuantity(provision, provision.selectedQuantity)}
                        </p>
                        <p className="text-xs tabular-nums text-slate-500">
                          uses {formatQuantity(provision.selectedPoolEquivalentQty, category.unit)}
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>

              {category.automaticConversions.length > 0 || category.conversionOptions.some((o) => o.selected) ? (
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  {category.automaticConversions.map((c) => (
                    <p key={c.code}>
                      Included automatically: {c.description ?? 'carried over'} (+
                      {formatQuantity(c.toDailyQty, category.unit)} a day)
                    </p>
                  ))}
                  {category.conversionOptions
                    .filter((o) => o.selected)
                    .map((o) => (
                      <p key={o.conversionId} className="font-medium text-brand-blueDark">
                        Alternative you chose: {o.description ?? o.code}
                      </p>
                    ))}
                </div>
              ) : null}

              <div className="flex items-baseline justify-between gap-3 bg-slate-50 px-4 py-2.5">
                <span className="text-xs font-semibold text-slate-700">Used</span>
                <span className="text-xs font-bold tabular-nums text-slate-900">
                  {formatQuantity(category.consumed, category.unit)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 bg-slate-50 px-4 pb-3">
                <span className="text-xs font-semibold text-brand-greenDark">Remaining</span>
                <span className="text-xs font-bold tabular-nums text-brand-greenDark">
                  {formatQuantity(category.remaining, category.unit)}
                </span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </section>
  );
}

/**
 * The availability acknowledgement.
 *
 * WHAT CHANGED, AND WHAT DID NOT. This used to be an amber panel carrying a
 * heading and a paragraph of the facility's wording, with the tick box inside
 * it. The explanatory panel has been removed at the client's request; the
 * acknowledgement itself is untouched and remains mandatory. The input keeps
 * the same `checked` and `onChange` wiring, the same label text, and so the
 * same accessible name, which is what the confirm button's enabled state and
 * the server's own check both ultimately hang on. Nothing about agreeing was
 * made easier: the box still starts unticked and still has to be ticked by
 * hand.
 *
 * It is now an ordinary white card, matching the fulfilment and summary
 * sections below it rather than shouting over them, and it carries the `mb-4`
 * the removed panel used to carry, so the gap to the next heading is
 * unchanged.
 */
function AvailabilityWarning({
  acknowledged,
  onChange,
}: {
  acknowledged: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="mb-4 flex min-h-touch cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <input
        type="checkbox"
        checked={acknowledged}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0"
      />
      <span className="text-sm font-medium text-slate-800">
        I understand that selected provisions are subject to availability.
      </span>
    </label>
  );
}

/**
 * Collect it, or have it delivered.
 *
 * The collection points come from the server — the facility maintains
 * them, and this screen names none of its own. A location that is
 * retired tomorrow simply stops appearing.
 */
function FulfillmentChooser({
  locations,
  fulfillmentType,
  pickupLocationId,
  deliveryAddress,
  onType,
  onPickupLocation,
  onDeliveryAddress,
}: {
  locations: PickupLocation[];
  fulfillmentType: FulfillmentType | null;
  pickupLocationId: string;
  deliveryAddress: string;
  onType: (type: FulfillmentType) => void;
  onPickupLocation: (id: string) => void;
  onDeliveryAddress: (address: string) => void;
}) {
  return (
    <section className="mb-4" aria-labelledby="fulfillment-heading">
      <h2 id="fulfillment-heading" className="mb-2 text-sm font-bold text-slate-900">
        How would you like to receive your ration?
      </h2>

      <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="fulfillment-heading">
        <FulfillmentOption
          label="Collect it"
          description="Pick it up yourself"
          selected={fulfillmentType === 'PICKUP'}
          onSelect={() => onType('PICKUP')}
        />
        <FulfillmentOption
          label="Have it delivered"
          description="To an address you give"
          selected={fulfillmentType === 'DELIVERY'}
          onSelect={() => onType('DELIVERY')}
        />
      </div>

      {fulfillmentType === 'PICKUP' ? (
        <fieldset className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">Where will you collect it?</legend>

          {locations.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No collection point is available at the moment. Please choose delivery, or try again shortly.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2" role="list">
              {locations.map((location) => (
                <li key={location.id}>
                  <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 has-[:checked]:border-brand-blue has-[:checked]:bg-brand-blueLight">
                    <input
                      type="radio"
                      name="pickupLocation"
                      value={location.id}
                      checked={pickupLocationId === location.id}
                      onChange={() => onPickupLocation(location.id)}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{location.name}</span>
                      {location.description ? (
                        <span className="mt-0.5 block text-xs text-slate-500">{location.description}</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      ) : null}

      {fulfillmentType === 'DELIVERY' ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
          <label htmlFor="delivery-address" className="block text-sm font-semibold text-slate-800">
            Delivery Address
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            This address is kept with your confirmed ration exactly as you type it here.
          </p>
          <textarea
            id="delivery-address"
            rows={4}
            value={deliveryAddress}
            maxLength={1000}
            onChange={(e) => onDeliveryAddress(e.target.value)}
            className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Block, quarter number, and any landmark that helps the delivery staff find you"
          />
        </div>
      ) : null}
    </section>
  );
}

function FulfillmentOption({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={[
        'flex min-h-touch flex-col items-start rounded-2xl border p-4 text-left',
        selected ? 'border-brand-blue bg-brand-blueLight' : 'border-slate-200 bg-white',
      ].join(' ')}
    >
      <span className="text-sm font-bold text-slate-900">{label}</span>
      <span className="mt-0.5 text-xs text-slate-500">{description}</span>
    </button>
  );
}

/** The last thing read before confirming. */
function FinalSummary({
  entitlement,
  fulfillmentType,
  pickupLocationName,
  deliveryAddress,
  ready,
}: {
  entitlement: EntitlementResponse;
  fulfillmentType: FulfillmentType | null;
  pickupLocationName: string | null;
  deliveryAddress: string;
  ready: boolean;
}) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4" aria-labelledby="final-summary-heading">
      <h2 id="final-summary-heading" className="text-sm font-bold text-slate-900">
        RIK selection summary
      </h2>

      <dl className="mt-2 flex flex-col gap-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Ration period</dt>
          <dd className="font-medium text-slate-800">{entitlement.period.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Dietary preference</dt>
          <dd className="font-medium text-slate-800">
            {DIET_LABELS[entitlement.dietaryPreference] ?? entitlement.dietaryPreference}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Receiving by</dt>
          <dd className="font-medium text-slate-800">
            {fulfillmentType === 'PICKUP'
              ? `Collection${pickupLocationName ? ` — ${pickupLocationName}` : ''}`
              : fulfillmentType === 'DELIVERY'
                ? 'Delivery'
                : 'Not chosen yet'}
          </dd>
        </div>
        {fulfillmentType === 'DELIVERY' && deliveryAddress.trim() !== '' ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-slate-500">Delivery address</dt>
            <dd className="whitespace-pre-wrap font-medium text-slate-800">{deliveryAddress.trim()}</dd>
          </div>
        ) : null}
      </dl>

      {ready ? (
        <p className="mt-3 rounded-lg bg-brand-greenLight px-3 py-2 text-sm font-semibold text-brand-greenDark">
          Your RIK selection is ready to be confirmed.
        </p>
      ) : null}
    </section>
  );
}

/**
 * After confirmation. Read-only, and safe to reload — the reference,
 * the fulfillment and the quantities all come from the server's
 * confirmed record rather than from anything held in this page.
 */
function ConfirmationReceipt({
  confirmation,
  entitlement,
  profile,
  chosen,
  onDone,
}: {
  confirmation: SelectionState;
  entitlement: EntitlementResponse;
  profile: CustomerProfile | null;
  chosen: EntitlementCategory[];
  onDone: () => void;
}) {
  return (
    <>
      <Card className="mb-4 border-brand-green/40">
        <CardBody>
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-greenLight text-brand-greenDark"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none">
                <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-slate-900">Your RIK selection is confirmed</p>
              <p className="mt-0.5 text-sm text-slate-600">
                Quote this reference when you collect or receive your ration.
              </p>
            </div>
          </div>

          <dl className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Reference</dt>
              <dd className="font-mono font-bold tabular-nums text-slate-900">
                {confirmation.referenceNumber ?? '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Status</dt>
              <dd>
                <Badge tone="green">Confirmed</Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Ration period</dt>
              <dd className="font-medium text-slate-800">{entitlement.period.name}</dd>
            </div>
            {profile ? (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">For</dt>
                <dd className="font-medium text-slate-800">{profile.name}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">Receiving by</dt>
              <dd className="font-medium text-slate-800">
                {confirmation.fulfillment?.type === 'PICKUP'
                  ? `Collection — ${confirmation.fulfillment.pickupLocationName ?? ''}`
                  : 'Delivery'}
              </dd>
            </div>
            {confirmation.fulfillment?.type === 'DELIVERY' ? (
              <div className="flex flex-col gap-0.5">
                <dt className="text-slate-500">Delivery address</dt>
                <dd className="whitespace-pre-wrap font-medium text-slate-800">
                  {confirmation.fulfillment.deliveryAddress}
                </dd>
              </div>
            ) : null}
          </dl>

          <p className="mt-4 rounded-lg bg-brand-amberLight px-3 py-2 text-xs leading-relaxed text-brand-amberDark">
            You accepted that the provisions you chose are subject to availability on the date of issue. If something
            is unavailable, an applicable alternative may be provided as per RIK rules.
          </p>
        </CardBody>
      </Card>

      <section aria-labelledby="confirmed-items-heading">
        <h2 id="confirmed-items-heading" className="mb-2 text-sm font-bold text-slate-900">
          What you confirmed
        </h2>
        <IssueSection heading="Fresh" categories={chosen.filter((c) => entitlement.fresh.some((f) => f.poolId === c.poolId))} />
        <IssueSection heading="Dry" categories={chosen.filter((c) => entitlement.dry.some((d) => d.poolId === c.poolId))} />
      </section>

      <p className="mt-2 text-xs text-slate-500">
        A confirmed selection cannot be changed. If something is wrong, please speak to the facility.
      </p>

      <div className="mt-4">
        <Button variant="outline" accent="blue" fullWidth onClick={onDone}>
          Back to Know Your Ration
        </Button>
      </div>
    </>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    // The server explains its own refusals — "choose where you will
    // collect your ration" says more than anything invented here.
    if (err.status === 400 && err.message) return err.message;
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    return 'Your ration could not be confirmed. Please try again.';
  }
  if (err instanceof NetworkError) {
    return 'The server could not be reached. Your ration has NOT been confirmed. Check your connection and try again.';
  }
  return 'Your ration could not be confirmed. Please try again.';
}
