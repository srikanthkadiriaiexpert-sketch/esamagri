import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  EntitlementCategory,
  EntitlementProvision,
  EntitlementResponse,
  SelectionState,
} from '../../../lib/api/rik-entitlement-api';

/**
 * STEP 11E — the RIK checkout screen.
 *
 * WHAT THESE TESTS ARE FOR. That the customer cannot confirm without
 * genuinely acknowledging the availability notice, that what they chose
 * is sent exactly as chosen, and that a confirmed ration becomes a
 * receipt rather than a form.
 *
 * THREE NEGATIVES ARE ASSERTED DELIBERATELY, because each is a rule the
 * screen must NOT quietly break:
 *
 *   - no price, total, tax or payment word appears anywhere;
 *   - the confirm button is disabled until the box is actually ticked,
 *     not merely until the warning has been rendered;
 *   - a repeated confirmation shows the existing one instead of sending
 *     a second.
 */

const api = {
  fetchEntitlement: vi.fn(),
  validateQuantity: vi.fn(),
  setProvisionQuantity: vi.fn(),
  setElections: vi.fn(),
  confirmSelection: vi.fn(),
  fetchPickupLocations: vi.fn(),
};

vi.mock('../../../lib/api/rik-entitlement-api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/rik-entitlement-api')>(
    '../../../lib/api/rik-entitlement-api'
  );
  return { ...actual, ...api };
});

const fetchMyProfile = vi.fn();
vi.mock('../../../lib/api/customer-api', () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useParams: () => ({}) };
});

const { RationCheckoutPage } = await import('./RationCheckoutPage');
const { ApiError, NetworkError } = await import('../../../lib/api/client');

// ---------------------------------------------------------------- data

function provision(over: Partial<EntitlementProvision> = {}): EntitlementProvision {
  return {
    provisionId: 'prov-rice',
    code: 'CER_RICE',
    brand: null,
    imageRef: null,
    packUnit: null,
    name: 'Rice',
    unit: 'g',
    consumptionRatio: 1,
    packSize: null,
    isLoose: true,
    wholeUnitsOnly: false,
    maxQuantity: null,
    maxPacks: null,
    minEligibleDays: null,
    issuePeriod: 'DRY',
    maxSelectableQuantity: 13_500,
    selectedQuantity: 2_000,
    selectedPoolEquivalentQty: 2_000,
    ...over,
  };
}

const CEREALS: EntitlementCategory = {
  poolId: 'pool-cereals',
  code: 'CEREALS',
  name: 'Cereals',
  unit: 'g',
  description: null,
  imageRef: null,
  dailyScale: 450,
  effectiveDailyQty: 450,
  eligibleDays: 30,
  totalEntitlement: 13_500,
  consumed: 4_250,
  remaining: 9_250,
  precise: { totalEntitlement: 13_500, consumed: 4_250, remaining: 9_250 },
  automaticConversions: [],
  conversionOptions: [],
  surrendered: false,
  provisions: [
    provision(),
    provision({
      provisionId: 'prov-pizza',
      code: 'CER_PIZZA_BASE',
      name: 'Pizza Base',
      consumptionRatio: 4.5,
      isLoose: false,
      packSize: null,
      selectedQuantity: 500,
      selectedPoolEquivalentQty: 2_250,
    }),
    provision({ provisionId: 'prov-maggi', code: 'CER_MAGGI', name: 'Maggi', packSize: 280, isLoose: false, selectedQuantity: 0, selectedPoolEquivalentQty: 0 }),
  ],
  unavailableProvisions: [],
};

const MILK: EntitlementCategory = {
  poolId: 'pool-milk',
  code: 'MILK',
  name: 'Milk',
  unit: 'ml',
  description: null,
  imageRef: '/catalogue/rik/category/milk.png',
  dailyScale: 250,
  effectiveDailyQty: 250,
  eligibleDays: 30,
  totalEntitlement: 7_500,
  consumed: 0,
  remaining: 7_500,
  precise: { totalEntitlement: 7_500, consumed: 0, remaining: 7_500 },
  automaticConversions: [],
  conversionOptions: [],
  surrendered: false,
  provisions: [provision({ provisionId: 'prov-milk', code: 'MILK_TD', name: 'Milk TD / Milkmaid', unit: 'g', consumptionRatio: 2.5, selectedQuantity: 0, selectedPoolEquivalentQty: 0 })],
  unavailableProvisions: [],
};

function response(over: Partial<EntitlementResponse> = {}): EntitlementResponse {
  return {
    period: { id: 'period-1', name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' },
    dietaryPreference: 'NV',
    eligibleDays: 30,
    fresh: [MILK],
    dry: [CEREALS],
    selection: {
      selectionId: 'sel-1',
      status: 'DRAFT',
      referenceNumber: null,
      confirmedAt: null,
      availabilityAcknowledged: false,
      acknowledgedAt: null,
      fulfillment: null,
    },
    ...over,
  };
}

const CONFIRMED_PICKUP: SelectionState = {
  selectionId: 'sel-1',
  status: 'CONFIRMED',
  referenceNumber: 'RIK-001042',
  confirmedAt: '2026-09-23T08:00:00.000Z',
  availabilityAcknowledged: true,
  acknowledgedAt: '2026-09-23T08:00:00.000Z',
  fulfillment: { type: 'PICKUP', pickupLocationName: 'Naval Park', deliveryAddress: null },
};

const LOCATIONS = {
  items: [
    { id: 'loc-naval', code: 'NAVAL_PARK', name: 'Naval Park', description: null },
    { id: 'loc-dolphin', code: 'DOLPHIN_HILL', name: 'Dolphin Hill', description: null },
  ],
};

function renderCheckout() {
  return render(
    <MemoryRouter>
      <RationCheckoutPage />
    </MemoryRouter>
  );
}

/** Get to the point where only the confirm tap is left. */
async function readyToConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('checkbox', { name: /subject to availability/i }));
  await user.click(screen.getByRole('button', { name: /collect it/i }));
  await user.click(await screen.findByRole('radio', { name: /Naval Park/i }));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  navigate.mockReset();
  fetchMyProfile.mockReset();
  api.fetchEntitlement.mockResolvedValue(response());
  api.fetchPickupLocations.mockResolvedValue(LOCATIONS);
  fetchMyProfile.mockResolvedValue({
    customerId: 'cust-1',
    name: 'Lt Cdr A. Sharma',
    mobileNumber: '+919876543210',
    dietaryPreference: 'NV',
    residence: null,
  });
});

// ===================================================================
describe('the review', () => {
  it('shows who it is for, the period, diet and eligible days', async () => {
    renderCheckout();
    expect(await screen.findByText('Lt Cdr A. Sharma')).toBeInTheDocument();
    // The diet appears in the header card and again in the final
    // summary; both are the server's value, neither is derived.
    expect(screen.getAllByText('Non-vegetarian').length).toBeGreaterThan(0);
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getAllByText(/September 2026/).length).toBeGreaterThan(0);
  });

  it('lists every chosen provision with its quantity and what it used', async () => {
    renderCheckout();
    await screen.findByText('Cereals');
    expect(screen.getByText('Rice')).toBeInTheDocument();
    expect(screen.getByText('Pizza Base')).toBeInTheDocument();
    expect(screen.getByText(/uses 2,250 g/)).toBeInTheDocument();
  });

  it('leaves out a category nothing was chosen from', async () => {
    renderCheckout();
    await screen.findByText('Cereals');
    // Milk is in the entitlement but nothing was taken from it.
    expect(screen.queryByText('Toned Milk')).not.toBeInTheDocument();
  });

  it('shows pack size only where the server sent one', async () => {
    renderCheckout();
    await screen.findByText('Rice');
    // Rice is loose; Maggi has a pack size but was not chosen.
    expect(screen.getByText(/Issued loose/)).toBeInTheDocument();
  });

  it('shows the balance from the server, used and remaining', async () => {
    renderCheckout();
    await screen.findByText('Cereals');
    expect(screen.getByText(/4,250 g/)).toBeInTheDocument();
    expect(screen.getByText(/9,250 g/)).toBeInTheDocument();
  });

  it('says which day each item is collected on', async () => {
    renderCheckout();
    await screen.findByText('Rice');
    expect(screen.getAllByText(/dry ration day/i).length).toBeGreaterThan(0);
  });

  it('mentions no price, total, tax or payment anywhere', async () => {
    renderCheckout();
    await screen.findByText('Cereals');
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const word of ['price', 'payment', 'pay now', 'invoice', 'gst', 'tax', '₹', 'total value']) {
      expect(text).not.toContain(word);
    }
  });

  it('sends the customer back when nothing has been chosen', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        dry: [{ ...CEREALS, consumed: 0, provisions: CEREALS.provisions.map((p) => ({ ...p, selectedQuantity: 0, selectedPoolEquivalentQty: 0 })) }],
        fresh: [],
      })
    );
    renderCheckout();
    expect(await screen.findByText(/have not chosen anything yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm rik selection/i })).not.toBeInTheDocument();
  });
});

// ===================================================================
describe('the availability warning', () => {
  /**
   * WHAT THIS TEST USED TO ASSERT, AND WHY IT NO LONGER DOES.
   *
   * Until 2026-11-06 the screen carried a large amber panel: a heading
   * ("IMPORTANT — PROVISIONS ARE SUBJECT TO AVAILABILITY") and a paragraph of
   * the facility's wording, with the tick box nested inside it. This test
   * pinned all four of those strings.
   *
   * The panel was removed at the client's request on 2026-11-06, restored on
   * 2026-11-11, and removed again the same day as the settled decision: the
   * small checkbox disclaimer is the whole notice. The test was simply left
   * behind by the first removal and had been failing ever since — it was
   * describing a screen that no longer existed, not catching a regression.
   *
   * So it now pins the wording that IS approved. Please do not "restore" the
   * panel assertions above from version history: the panel's absence is a
   * decision, taken twice.
   *
   * The acknowledgement itself is unchanged and is still covered in full by
   * the three tests below — it starts unticked, confirm stays disabled until
   * it is ticked, and `availabilityAcknowledged: true` is what reaches the
   * server (asserted in 'choosing how to receive it' and 'after confirming').
   * Nothing about agreeing was made easier by this edit.
   */
  it('is shown in full, word for word', async () => {
    renderCheckout();

    // An exact string, not a regex: the point of this test is the wording, so
    // a partial match would let it drift a word at a time.
    expect(
      await screen.findByText('I understand that selected provisions are subject to availability.')
    ).toBeInTheDocument();

    // And it is the label of the box being ticked, not loose text elsewhere on
    // the page — the resident agrees to this sentence rather than merely
    // scrolling past it.
    expect(
      screen.getByRole('checkbox', { name: /subject to availability/i })
    ).toBeInTheDocument();
  });

  it('starts unticked — seeing it is not agreeing to it', async () => {
    renderCheckout();
    const box = await screen.findByRole('checkbox', { name: /subject to availability/i });
    expect(box).not.toBeChecked();
  });

  it('keeps confirm disabled until it is ticked', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    const confirm = screen.getByRole('button', { name: /confirm rik selection/i });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/tick the box above/i)).toBeInTheDocument();

    // Ticking alone is not enough — fulfillment is still unanswered.
    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/choose how you would like to receive/i)).toBeInTheDocument();
  });

  it('enables confirm once it is ticked and fulfillment is chosen', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    expect(screen.getByRole('button', { name: /confirm rik selection/i })).toBeEnabled();
  });
});

// ===================================================================
describe('choosing how to receive it', () => {
  it('offers the collection points the server sent, by name', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    await user.click(screen.getByRole('button', { name: /collect it/i }));
    expect(await screen.findByRole('radio', { name: /Naval Park/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dolphin Hill/i })).toBeInTheDocument();
  });

  it('sends the chosen collection point by id, never by name', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockResolvedValue({
      selectionId: 'sel-1',
      status: 'CONFIRMED',
      confirmation: CONFIRMED_PICKUP,
      entitlement: response({ selection: CONFIRMED_PICKUP }),
    });

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    await waitFor(() => expect(api.confirmSelection).toHaveBeenCalledTimes(1));
    expect(api.confirmSelection.mock.calls[0][0]).toEqual({
      availabilityAcknowledged: true,
      fulfillmentType: 'PICKUP',
      pickupLocationId: 'loc-naval',
    });
  });

  it('confirms at Dolphin Hill when that is the one chosen', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockResolvedValue({
      selectionId: 'sel-1',
      status: 'CONFIRMED',
      confirmation: { ...CONFIRMED_PICKUP, fulfillment: { type: 'PICKUP', pickupLocationName: 'Dolphin Hill', deliveryAddress: null } },
      entitlement: response(),
    });

    renderCheckout();
    await screen.findByText('Cereals');
    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /collect it/i }));
    await user.click(await screen.findByRole('radio', { name: /Dolphin Hill/i }));
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    await waitFor(() => expect(api.confirmSelection).toHaveBeenCalledTimes(1));
    expect(api.confirmSelection.mock.calls[0][0].pickupLocationId).toBe('loc-dolphin');
  });

  it('will not confirm a pickup with no location chosen', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /collect it/i }));

    expect(screen.getByRole('button', { name: /confirm rik selection/i })).toBeDisabled();
  });

  it('asks for a delivery address, and will not confirm without one', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /have it delivered/i }));

    expect(await screen.findByLabelText(/delivery address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm rik selection/i })).toBeDisabled();
  });

  it('will not accept a whitespace-only address', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /have it delivered/i }));
    await user.type(await screen.findByLabelText(/delivery address/i), '    ');

    expect(screen.getByRole('button', { name: /confirm rik selection/i })).toBeDisabled();
  });

  it('sends the delivery address exactly as typed', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockResolvedValue({
      selectionId: 'sel-1',
      status: 'CONFIRMED',
      confirmation: {
        ...CONFIRMED_PICKUP,
        fulfillment: { type: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'Block 7, Qtr 214' },
      },
      entitlement: response(),
    });

    renderCheckout();
    await screen.findByText('Cereals');
    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /have it delivered/i }));
    await user.type(await screen.findByLabelText(/delivery address/i), 'Block 7, Qtr 214');
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    await waitFor(() => expect(api.confirmSelection).toHaveBeenCalledTimes(1));
    expect(api.confirmSelection.mock.calls[0][0]).toEqual({
      availabilityAcknowledged: true,
      fulfillmentType: 'DELIVERY',
      deliveryAddress: 'Block 7, Qtr 214',
    });
  });

  it('says the address is kept as typed, so the customer knows it is not their profile', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');
    await user.click(screen.getByRole('button', { name: /have it delivered/i }));
    expect(await screen.findByText(/kept with your confirmed ration exactly as you type it/i)).toBeInTheDocument();
  });
});

// ===================================================================
describe('the final summary', () => {
  it('repeats the period, diet and chosen fulfillment before confirming', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);

    const summary = screen.getByText(/rik selection summary/i).parentElement as HTMLElement;
    expect(within(summary).getByText(/September 2026/)).toBeInTheDocument();
    expect(within(summary).getByText('Non-vegetarian')).toBeInTheDocument();
    expect(within(summary).getByText(/Collection — Naval Park/)).toBeInTheDocument();
  });

  it('says it is ready only once everything is answered', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');

    expect(screen.queryByText(/ready to be confirmed/i)).not.toBeInTheDocument();
    await readyToConfirm(user);
    expect(screen.getByText(/your rik selection is ready to be confirmed/i)).toBeInTheDocument();
  });

  it('shows the typed address in the summary before confirming', async () => {
    const user = userEvent.setup();
    renderCheckout();
    await screen.findByText('Cereals');
    await user.click(screen.getByRole('checkbox', { name: /subject to availability/i }));
    await user.click(screen.getByRole('button', { name: /have it delivered/i }));
    await user.type(await screen.findByLabelText(/delivery address/i), 'Block 7, Qtr 214');

    const summary = screen.getByText(/rik selection summary/i).parentElement as HTMLElement;
    expect(within(summary).getByText('Block 7, Qtr 214')).toBeInTheDocument();
  });
});

// ===================================================================
describe('after confirming', () => {
  it('shows the reference, the fulfillment and a read-only receipt', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockResolvedValue({
      selectionId: 'sel-1',
      status: 'CONFIRMED',
      confirmation: CONFIRMED_PICKUP,
      entitlement: response({ selection: CONFIRMED_PICKUP }),
    });

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    expect(await screen.findByText(/your rik selection is confirmed/i)).toBeInTheDocument();
    expect(screen.getByText('RIK-001042')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText(/Collection — Naval Park/)).toBeInTheDocument();

    // The form is gone: nothing left to submit.
    expect(screen.queryByRole('button', { name: /confirm rik selection/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /subject to availability/i })).not.toBeInTheDocument();
    expect(screen.getByText(/a confirmed selection cannot be changed/i)).toBeInTheDocument();
  });

  it('repeats the availability acceptance on the receipt', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ selection: CONFIRMED_PICKUP }));
    renderCheckout();
    expect(await screen.findByText(/you accepted that the provisions you chose are subject to availability/i)).toBeInTheDocument();
  });

  it('shows the receipt straight away on a reload, without confirming again', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ selection: CONFIRMED_PICKUP }));
    renderCheckout();

    expect(await screen.findByText(/your rik selection is confirmed/i)).toBeInTheDocument();
    expect(screen.getByText('RIK-001042')).toBeInTheDocument();
    // Critically: no second confirmation was sent.
    expect(api.confirmSelection).not.toHaveBeenCalled();
  });

  it('shows the delivery address on the receipt when that is what was chosen', async () => {
    const confirmedDelivery: SelectionState = {
      ...CONFIRMED_PICKUP,
      fulfillment: { type: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'Block 7, Qtr 214' },
    };
    api.fetchEntitlement.mockResolvedValue(response({ selection: confirmedDelivery }));
    renderCheckout();

    await screen.findByText(/your rik selection is confirmed/i);
    expect(screen.getByText('Block 7, Qtr 214')).toBeInTheDocument();
  });

  it('turns a repeated confirmation into the existing one, not a second', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'This ration selection has already been confirmed.',
        details: { reason: 'ALREADY_CONFIRMED', referenceNumber: 'RIK-001042' },
      })
    );
    // The reload that follows finds the confirmation.
    api.fetchEntitlement
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response({ selection: CONFIRMED_PICKUP }));

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    expect(await screen.findByText(/your rik selection is confirmed/i)).toBeInTheDocument();
    // No scary error for something that is not a failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ===================================================================
describe('when something goes wrong', () => {
  it('repeats the server’s refusal word for word', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'That collection point is not available. Please choose another.',
        details: { reason: 'PICKUP_LOCATION_INVALID' },
      })
    );

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That collection point is not available. Please choose another.'
    );
  });

  it('says plainly that nothing was confirmed when the network fails', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockRejectedValue(new NetworkError());

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/has NOT been confirmed/i);
    // And the form is still there to try again.
    expect(screen.getByRole('button', { name: /confirm rik selection/i })).toBeInTheDocument();
  });

  it('leaves the review on screen after a failure, so nothing has to be re-entered', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockRejectedValue(new NetworkError());

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    await screen.findByRole('alert');
    expect(screen.getByRole('checkbox', { name: /subject to availability/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Naval Park/i })).toBeChecked();
  });

  it('shows no stack trace to the customer', async () => {
    const user = userEvent.setup();
    api.confirmSelection.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'TypeError: cannot read property x of undefined' })
    );

    renderCheckout();
    await screen.findByText('Cereals');
    await readyToConfirm(user);
    await user.click(screen.getByRole('button', { name: /confirm rik selection/i }));

    await screen.findByRole('alert');
    expect(document.body.textContent ?? '').not.toMatch(/TypeError|at Object|undefined/);
  });

  it('shows the honest state when the ration itself cannot be loaded', async () => {
    api.fetchEntitlement.mockRejectedValue(
      new ApiError(404, {
        code: 'NOT_FOUND',
        message: 'No ration period is open at the moment.',
        details: { reason: 'NO_OPEN_PERIOD' },
      })
    );
    renderCheckout();
    expect(await screen.findByText(/no ration period is open/i)).toBeInTheDocument();
  });
});
