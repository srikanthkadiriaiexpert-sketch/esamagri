import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  EntitlementCategory,
  EntitlementProvision,
  EntitlementResponse,
} from '../../../lib/api/rik-entitlement-api';

/**
 * STEP 11D — the two Know Your Ration screens.
 *
 * WHAT THESE TESTS ARE FOR. That each screen renders exactly what the
 * server sent, sends exactly what the customer chose, and repeats the
 * server's refusal without softening or reinterpreting it.
 *
 * WHAT THEY ARE NOT FOR, deliberately: any entitlement rule. There is
 * none in these screens to test. Several tests below assert the
 * NEGATIVE — that the screen does not compute a total, does not refuse
 * an over-large quantity itself, does not invent a pack size — because
 * that restraint is the requirement, and a regression would otherwise
 * pass silently while quietly creating a second, untested copy of the
 * entitlement rules in the browser.
 *
 * The API module is mocked; the real one is exercised over HTTP against
 * PostgreSQL in apps/api's `rik-know-your-ration.integration.spec.ts`.
 * No frontend mock stands in for an engine test.
 */

const api = {
  fetchEntitlement: vi.fn(),
  validateQuantity: vi.fn(),
  setProvisionQuantity: vi.fn(),
  setElections: vi.fn(),
  confirmSelection: vi.fn(),
};

vi.mock('../../../lib/api/rik-entitlement-api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api/rik-entitlement-api')>(
    '../../../lib/api/rik-entitlement-api'
  );
  // The display helpers are pure formatting and are exercised for real;
  // only the network calls are replaced.
  return { ...actual, ...api };
});

const fetchMyProfile = vi.fn();
vi.mock('../../../lib/api/customer-api', () => ({
  fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args),
}));

const navigate = vi.fn();
let routeParams: Record<string, string> = { poolId: 'pool-cereals' };
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useParams: () => routeParams };
});

const { KnowYourRationPage } = await import('./KnowYourRationPage');
const { RationCategoryPage } = await import('./RationCategoryPage');
const { ApiError } = await import('../../../lib/api/client');

// ---------------------------------------------------------------- data
// Shaped exactly like the real response, including the values that are
// easy to get wrong: a null pack size, a ratio above 1, a DRY-pool item
// issued on the FRESH day, and an item withheld with a reason.

function provision(over: Partial<EntitlementProvision> = {}): EntitlementProvision {
  return {
    provisionId: 'prov-rice',
    code: 'CER_RICE',
    name: 'Rice',
    brand: null,
    imageRef: null,
    packUnit: null,
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
    selectedQuantity: 0,
    selectedPoolEquivalentQty: 0,
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
  consumed: 0,
  remaining: 13_500,
  precise: { totalEntitlement: 13_500, consumed: 0, remaining: 13_500 },
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
      maxSelectableQuantity: 3000,
    }),
    provision({
      provisionId: 'prov-bread',
      code: 'CER_BREAD_SANDWICH',
      name: 'Sandwich Bread',
      issuePeriod: 'FRESH',
      isLoose: false,
      packSize: 400,
      maxSelectableQuantity: 13_500,
    }),
    provision({
      provisionId: 'prov-millets',
      code: 'CER_MILLETS',
      name: 'Millets',
      isLoose: false,
      packSize: null,
      maxQuantity: 1000,
      maxSelectableQuantity: 1000,
    }),
  ],
  unavailableProvisions: [],
};

const MILK_PV: EntitlementCategory = {
  poolId: 'pool-milk',
  code: 'MILK',
  name: 'Milk',
  unit: 'ml',
  description: null,
  imageRef: '/catalogue/rik/category/milk.png',
  dailyScale: 250,
  effectiveDailyQty: 1000,
  eligibleDays: 30,
  totalEntitlement: 30_000,
  consumed: 0,
  remaining: 30_000,
  precise: { totalEntitlement: 30_000, consumed: 0, remaining: 30_000 },
  automaticConversions: [
    { code: 'EGGS_TO_MILK_PV', fromDailyQty: 2, toDailyQty: 250, description: 'Pure veg: the egg entitlement is received as milk.' },
    { code: 'MEAT_TO_MILK_PV', fromDailyQty: 260, toDailyQty: 500, description: 'Pure veg: the meat entitlement is received as milk.' },
  ],
  conversionOptions: [],
  surrendered: false,
  provisions: [provision({ provisionId: 'prov-milk', code: 'MILK_TD', name: 'Milk TD / Milkmaid', unit: 'g', consumptionRatio: 2.5, maxSelectableQuantity: 12_000 })],
  unavailableProvisions: [],
};

/**
 * STEP 14C — Meat. A shared pool: Meat, Fish and Chicken / Fowl all draw
 * on the same meat-equivalent balance, and none of them has a picture of
 * its own. That makes it the category where a cover leaking onto a
 * provision row would be least visible and most misleading, so the tests
 * below check the separation on this fixture specifically.
 */
const MEAT: EntitlementCategory = {
  poolId: 'pool-meat',
  code: 'MEAT',
  name: 'Meat',
  unit: 'g',
  description: null,
  imageRef: '/catalogue/rik/category/meat.png',
  dailyScale: 260,
  effectiveDailyQty: 260,
  eligibleDays: 30,
  totalEntitlement: 7_800,
  consumed: 0,
  remaining: 7_800,
  precise: { totalEntitlement: 7_800, consumed: 0, remaining: 7_800 },
  automaticConversions: [],
  conversionOptions: [],
  surrendered: false,
  provisions: [
    provision({ provisionId: 'prov-meat', code: 'MEAT_MUTTON', name: 'Meat', maxSelectableQuantity: 7_800 }),
    provision({ provisionId: 'prov-fish', code: 'MEAT_FISH', name: 'Fish', maxSelectableQuantity: 7_800 }),
    provision({ provisionId: 'prov-chicken', code: 'MEAT_CHICKEN', name: 'Chicken / Fowl', maxSelectableQuantity: 7_800 }),
  ],
  unavailableProvisions: [],
};

const DALIYA: EntitlementCategory = {
  poolId: 'pool-daliya',
  code: 'DALIYA',
  name: 'Daliya',
  unit: 'g',
  description: null,
  imageRef: null,
  dailyScale: 20,
  effectiveDailyQty: 20,
  eligibleDays: 20,
  totalEntitlement: 400,
  consumed: 0,
  remaining: 400,
  precise: { totalEntitlement: 400, consumed: 0, remaining: 400 },
  automaticConversions: [],
  conversionOptions: [],
  surrendered: false,
  provisions: [],
  unavailableProvisions: [
    {
      provisionId: 'prov-oats',
      code: 'DAL_OATS',
      name: 'Oats',
      brand: null,
      imageRef: null,
      packUnit: null,
      unit: 'g',
      packSize: 600,
      minEligibleDays: 30,
      issuePeriod: 'DRY',
      reason: 'This provision requires at least 30 eligible days; you have 20.',
    },
  ],
};

/**
 * STEP 14E — Fresh Vegetables. The first category whose PROVISIONS already
 * carry pictures of their own, so it is the one where a cover leaking onto
 * a provision row, or a provision picture borrowed upward as the cover,
 * would show as the WRONG picture rather than as a picture where there had
 * been a placeholder. The fixture therefore gives its provisions real
 * picture paths, which earlier category fixtures did not.
 */
const VEGETABLES: EntitlementCategory = {
  poolId: 'pool-vegetables',
  code: 'VEGETABLES',
  name: 'Fresh Vegetables',
  unit: 'g',
  description: null,
  imageRef: '/catalogue/rik/category/vegetables.png',
  dailyScale: 275,
  effectiveDailyQty: 275,
  eligibleDays: 30,
  totalEntitlement: 8_250,
  consumed: 0,
  remaining: 8_250,
  precise: { totalEntitlement: 8_250, consumed: 0, remaining: 8_250 },
  automaticConversions: [],
  conversionOptions: [],
  surrendered: false,
  provisions: [
    provision({
      provisionId: 'prov-tomato',
      code: 'VEG_TOMATO_RED',
      name: 'Tomato Red',
      imageRef: '/catalogue/rik/fresh/42_tomato-red.png',
      issuePeriod: 'FRESH',
      maxSelectableQuantity: 8_250,
    }),
    provision({
      provisionId: 'prov-broccoli',
      code: 'VEG_BROCCOLI',
      name: 'Broccoli',
      imageRef: '/catalogue/rik/fresh/10_broccoli.png',
      issuePeriod: 'FRESH',
      maxSelectableQuantity: 8_250,
    }),
  ],
  unavailableProvisions: [],
};

const EGGS_WITH_OPTIONS: EntitlementCategory = {
  poolId: 'pool-eggs',
  code: 'EGGS',
  name: 'Eggs',
  unit: 'piece',
  description: null,
  imageRef: '/catalogue/rik/category/eggs.png',
  dailyScale: 2,
  effectiveDailyQty: 2,
  eligibleDays: 30,
  totalEntitlement: 60,
  consumed: 0,
  remaining: 60,
  precise: { totalEntitlement: 60, consumed: 0, remaining: 60 },
  automaticConversions: [],
  conversionOptions: [
    {
      conversionId: 'conv-meat-eggs',
      code: 'MEAT_TO_EGGS_EV',
      fromPoolId: 'pool-meat',
      toPoolId: 'pool-eggs',
      fromDailyQty: 260,
      toDailyQty: 4,
      description: 'Four additional Eggs per day in lieu of meat',
      selected: false,
    },
  ],
  surrendered: false,
  provisions: [provision({ provisionId: 'prov-eggs', code: 'EGG_TABLE', name: 'Table Eggs', unit: 'piece', isLoose: false, maxSelectableQuantity: 60 })],
  unavailableProvisions: [],
};

function response(over: Partial<EntitlementResponse> = {}): EntitlementResponse {
  return {
    period: { id: 'period-1', name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30' },
    dietaryPreference: 'NV',
    eligibleDays: 30,
    fresh: [MILK_PV],
    dry: [CEREALS],
    ...over,
  };
}

function renderPage(element: React.ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  navigate.mockReset();
  fetchMyProfile.mockReset();
  routeParams = { poolId: 'pool-cereals' };
  api.fetchEntitlement.mockResolvedValue(response());
  fetchMyProfile.mockResolvedValue({
    customerId: 'cust-1',
    name: 'Lt Cdr A. Sharma',
    mobileNumber: '+919876543210',
    residence: null,
  });
});

// ===================================================================
describe('KnowYourRationPage', () => {
  it('shows who the customer is, their diet, period and eligible days', async () => {
    renderPage(<KnowYourRationPage />);
    expect(await screen.findByText('Lt Cdr A. Sharma')).toBeInTheDocument();
    expect(screen.getByText('Non-vegetarian')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
  });

  it('builds both sections from the response, never from a list of its own', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ fresh: [MILK_PV], dry: [CEREALS, DALIYA] })
    );
    renderPage(<KnowYourRationPage />);

    expect(await screen.findByRole('heading', { name: 'Fresh' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dry' })).toBeInTheDocument();
    expect(screen.getByText('Milk')).toBeInTheDocument();
    expect(screen.getByText('Cereals')).toBeInTheDocument();
    expect(screen.getByText('Daliya')).toBeInTheDocument();
  });

  it('shows only what the server sent — a pure vegetarian sees no meat', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'PV', fresh: [MILK_PV], dry: [CEREALS] })
    );
    renderPage(<KnowYourRationPage />);

    await screen.findByText('Milk');
    expect(screen.getByText('Pure vegetarian')).toBeInTheDocument();
    expect(screen.queryByText('Meat')).not.toBeInTheDocument();
    expect(screen.queryByText('Eggs')).not.toBeInTheDocument();
  });

  it('shows the server’s entitlement figure rather than recomputing one', async () => {
    // A response whose total is deliberately NOT dailyScale x days. The
    // screen must show the server's number — if it ever multiplies for
    // itself, this test fails, which is the whole point.
    api.fetchEntitlement.mockResolvedValue(
      response({ dry: [{ ...CEREALS, totalEntitlement: 9_999, remaining: 9_999 }] })
    );
    renderPage(<KnowYourRationPage />);

    expect(await screen.findByText(/9,999 g/)).toBeInTheDocument();
    expect(screen.queryByText(/13,500 g/)).not.toBeInTheDocument();
  });

  it('shows what is left once something has been chosen', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dry: [{ ...CEREALS, consumed: 4_500, remaining: 9_000 }] })
    );
    renderPage(<KnowYourRationPage />);

    const row = await screen.findByRole('button', { name: /Cereals/ });
    expect(within(row).getByText(/9,000 g left/)).toBeInTheDocument();
    expect(within(row).getByText(/Selected 4,500 g/)).toBeInTheDocument();
  });

  it('opens a category by its pool id', async () => {
    const user = userEvent.setup();
    renderPage(<KnowYourRationPage />);
    await user.click(await screen.findByRole('button', { name: /Cereals/ }));
    expect(navigate).toHaveBeenCalledWith('/rik/ration/pool-cereals');
  });

  it('shows a loading state while it waits', () => {
    api.fetchEntitlement.mockReturnValue(new Promise(() => {}));
    renderPage(<KnowYourRationPage />);
    expect(screen.getByText(/loading your ration details/i)).toBeInTheDocument();
  });
});

// ===================================================================
/**
 * STEP 14B — the category cover picture on Know Your Ration.
 *
 * THE RISK THESE TESTS GUARD. The catalogue has two levels of picture
 * and they are not interchangeable: a PROVISION picture shows the item
 * an officer takes home, a CATEGORY picture is the cover of a whole
 * allowance — Milk, Meat, Cereals. They live in different columns on
 * different tables and arrive in different parts of the response. A
 * regression that quietly used one where the other belonged would look
 * plausible on screen and be wrong: an officer browsing "Milk" would be
 * shown a particular carton as though it were the allowance, or the
 * allowance cover would appear against a specific SKU.
 *
 * AND THE ORDINARY CASE IS NO PICTURE. Seventeen of the eighteen
 * categories have none today, by design. The list must stay even and the
 * row must stay openable — a category without a cover is not a category
 * that is unavailable.
 */
describe('KnowYourRationPage — the category picture', () => {
  it('shows the cover the server recorded for a category', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MILK_PV], dry: [CEREALS] }));
    renderPage(<KnowYourRationPage />);

    const image = await screen.findByRole('img', { name: 'Milk' });
    expect(image).toHaveAttribute('src', '/catalogue/rik/category/milk.png');
  });

  it('takes the path from the server and never builds one from the code', async () => {
    // Same category, a different recorded path. If the screen ever
    // composed a path out of the pool code this would still render
    // milk.png and the test would fail.
    api.fetchEntitlement.mockResolvedValue(
      response({
        fresh: [{ ...MILK_PV, imageRef: '/catalogue/rik/category/somewhere-else.png' }],
        dry: [],
      })
    );
    renderPage(<KnowYourRationPage />);

    const image = await screen.findByRole('img', { name: 'Milk' });
    expect(image).toHaveAttribute('src', '/catalogue/rik/category/somewhere-else.png');
  });

  it('shows the placeholder for a category with no picture, and still opens it', async () => {
    const user = userEvent.setup();
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [], dry: [CEREALS, DALIYA] }));
    renderPage(<KnowYourRationPage />);

    expect(
      await screen.findByRole('img', { name: /no picture recorded for cereals/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /no picture recorded for daliya/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Cereals' })).not.toBeInTheDocument();

    // The category is ordinary in every other respect.
    expect(screen.getByText(/13,500 g/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cereals/ }));
    expect(navigate).toHaveBeenCalledWith('/rik/ration/pool-cereals');
  });

  it('falls back to the placeholder when a recorded cover fails to load', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MILK_PV], dry: [] }));
    renderPage(<KnowYourRationPage />);

    const image = await screen.findByRole('img', { name: 'Milk' });
    fireEvent.error(image);

    expect(screen.getByRole('img', { name: /no picture recorded for milk/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Milk' })).not.toBeInTheDocument();
    // The allowance is still on offer. A missing cover is not a missing
    // entitlement.
    expect(screen.getByRole('button', { name: /Milk/ })).toBeInTheDocument();
    expect(screen.getByText(/30,000 ml/)).toBeInTheDocument();
  });

  it('never puts a category cover on a provision row', async () => {
    // Milk has a category cover; its one provision has no picture of its
    // own. Inside the category the officer must see the provision
    // placeholder, NOT the allowance cover.
    routeParams = { poolId: 'pool-milk' };
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MILK_PV], dry: [] }));
    renderPage(<RationCategoryPage />);

    expect(
      await screen.findByRole('img', { name: /no picture recorded for milk td \/ milkmaid/i })
    ).toBeInTheDocument();
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '/catalogue/rik/category/milk.png');
    }
  });

  it('shows Meat its own cover, and Milk its own, on the same list', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MILK_PV, MEAT], dry: [CEREALS] }));
    renderPage(<KnowYourRationPage />);

    const milkImage = await screen.findByRole('img', { name: 'Milk' });
    const meatImage = screen.getByRole('img', { name: 'Meat' });
    expect(milkImage).toHaveAttribute('src', '/catalogue/rik/category/milk.png');
    expect(meatImage).toHaveAttribute('src', '/catalogue/rik/category/meat.png');
    // Two covers, two files. One shared picture would satisfy a weaker
    // assertion and tell an officer nothing.
    expect(meatImage.getAttribute('src')).not.toBe(milkImage.getAttribute('src'));
    // Cereals, alongside them, is still the ordinary no-picture case.
    expect(screen.getByRole('img', { name: /no picture recorded for cereals/i })).toBeInTheDocument();
  });

  it('falls back to the placeholder when the Meat cover fails to load', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MEAT], dry: [] }));
    renderPage(<KnowYourRationPage />);

    fireEvent.error(await screen.findByRole('img', { name: 'Meat' }));

    expect(screen.getByRole('img', { name: /no picture recorded for meat/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Meat' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Meat/ })).toBeInTheDocument();
    expect(screen.getByText(/7,800 g/)).toBeInTheDocument();
  });

  it('never puts the Meat cover on Meat, Fish or Chicken inside the category', async () => {
    routeParams = { poolId: 'pool-meat' };
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [MEAT], dry: [] }));
    renderPage(<RationCategoryPage />);

    // Each of the three shared-pool items shows the provision placeholder.
    for (const name of ['Meat', 'Fish', 'Chicken / Fowl']) {
      expect(
        await screen.findByRole('img', { name: new RegExp(`no picture recorded for ${name}`, 'i') })
      ).toBeInTheDocument();
    }
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '/catalogue/rik/category/meat.png');
    }
  });

  it('gives Milk, Meat and Eggs three different covers on one list', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'EV', fresh: [MILK_PV, MEAT, EGGS_WITH_OPTIONS], dry: [CEREALS] })
    );
    renderPage(<KnowYourRationPage />);

    const srcs = await Promise.all(
      ['Milk', 'Meat', 'Eggs'].map(async (name) => (await screen.findByRole('img', { name })).getAttribute('src'))
    );
    expect(srcs).toEqual([
      '/catalogue/rik/category/milk.png',
      '/catalogue/rik/category/meat.png',
      '/catalogue/rik/category/eggs.png',
    ]);
    // Three covers, three files — one shared picture would pass a weaker check.
    expect(new Set(srcs).size).toBe(3);
    // And Cereals, on the same list, is still the ordinary no-picture case.
    expect(screen.getByRole('img', { name: /no picture recorded for cereals/i })).toBeInTheDocument();
  });

  it('falls back to the placeholder when the Eggs cover fails to load', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'EV', fresh: [EGGS_WITH_OPTIONS], dry: [] })
    );
    renderPage(<KnowYourRationPage />);

    fireEvent.error(await screen.findByRole('img', { name: 'Eggs' }));

    expect(screen.getByRole('img', { name: /no picture recorded for eggs/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Eggs' })).not.toBeInTheDocument();
    // The allowance, and the alternative it offers, survive a missing cover.
    expect(screen.getByRole('button', { name: /Eggs/ })).toBeInTheDocument();
    expect(screen.getByText(/60 piece/)).toBeInTheDocument();
  });

  it('never puts the Eggs cover on the Table Eggs provision row', async () => {
    routeParams = { poolId: 'pool-eggs' };
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'EV', fresh: [EGGS_WITH_OPTIONS], dry: [] })
    );
    renderPage(<RationCategoryPage />);

    expect(
      await screen.findByRole('img', { name: /no picture recorded for table eggs/i })
    ).toBeInTheDocument();
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '/catalogue/rik/category/eggs.png');
    }
  });

  it('gives all four pictured categories their own cover on one list', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'EV', fresh: [MILK_PV, MEAT, EGGS_WITH_OPTIONS, VEGETABLES], dry: [CEREALS] })
    );
    renderPage(<KnowYourRationPage />);

    const srcs = await Promise.all(
      ['Milk', 'Meat', 'Eggs', 'Fresh Vegetables'].map(async (name) =>
        (await screen.findByRole('img', { name })).getAttribute('src')
      )
    );
    expect(srcs).toEqual([
      '/catalogue/rik/category/milk.png',
      '/catalogue/rik/category/meat.png',
      '/catalogue/rik/category/eggs.png',
      '/catalogue/rik/category/vegetables.png',
    ]);
    expect(new Set(srcs).size).toBe(4);
    // Cereals, on the same list, is still the ordinary no-picture case.
    expect(screen.getByRole('img', { name: /no picture recorded for cereals/i })).toBeInTheDocument();
  });

  it('falls back to the placeholder when the Fresh Vegetables cover fails to load', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [VEGETABLES], dry: [] }));
    renderPage(<KnowYourRationPage />);

    fireEvent.error(await screen.findByRole('img', { name: 'Fresh Vegetables' }));

    expect(
      screen.getByRole('img', { name: /no picture recorded for fresh vegetables/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Fresh Vegetables' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fresh Vegetables/ })).toBeInTheDocument();
    expect(screen.getByText(/8,250 g/)).toBeInTheDocument();
  });

  it('shows each vegetable its own picture, never the category cover', async () => {
    routeParams = { poolId: 'pool-vegetables' };
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [VEGETABLES], dry: [] }));
    renderPage(<RationCategoryPage />);

    // Each provision keeps the picture the facility recorded for it.
    expect(await screen.findByRole('img', { name: 'Tomato Red' })).toHaveAttribute(
      'src',
      '/catalogue/rik/fresh/42_tomato-red.png'
    );
    expect(screen.getByRole('img', { name: 'Broccoli' })).toHaveAttribute(
      'src',
      '/catalogue/rik/fresh/10_broccoli.png'
    );
    // And the whole-allowance cover appears on none of them.
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '/catalogue/rik/category/vegetables.png');
    }
  });

  it('never puts a provision picture on a category row', async () => {
    // The reverse crossover. Cereals has no cover of its own but its
    // items have pictures; the category row must show the placeholder
    // rather than borrowing the first item's photograph.
    api.fetchEntitlement.mockResolvedValue(
      response({
        fresh: [],
        dry: [
          {
            ...CEREALS,
            provisions: [provision({ name: 'Rice', imageRef: '/catalogue/rik/dry/cereals/rice.png' })],
          },
        ],
      })
    );
    renderPage(<KnowYourRationPage />);

    expect(
      await screen.findByRole('img', { name: /no picture recorded for cereals/i })
    ).toBeInTheDocument();
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '/catalogue/rik/dry/cereals/rice.png');
    }
  });
});

// ===================================================================
describe('KnowYourRationPage — when the basis is incomplete', () => {
  const failWith = (status: number, reason: string, message: string) =>
    api.fetchEntitlement.mockRejectedValue(
      new ApiError(status, { code: status === 400 ? 'VALIDATION_FAILED' : 'NOT_FOUND', message, details: { reason } })
    );

  it('asks the customer to set a dietary preference, and offers no ration at all', async () => {
    failWith(400, 'DIETARY_PREFERENCE_NOT_SET', 'Please set your dietary preference before viewing your ration.');
    renderPage(<KnowYourRationPage />);

    expect(await screen.findByText(/tell us your dietary preference/i)).toBeInTheDocument();
    // Emphatically no default: nothing that looks like an entitlement.
    expect(screen.queryByText(/Cereals/)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\d+,\d+\s?(g|ml)/);
  });

  it('sends the customer to their profile to fix it', async () => {
    const user = userEvent.setup();
    failWith(400, 'DIETARY_PREFERENCE_NOT_SET', 'Please set your dietary preference before viewing your ration.');
    renderPage(<KnowYourRationPage />);

    await user.click(await screen.findByRole('button', { name: /go to your profile/i }));
    expect(navigate).toHaveBeenCalledWith('/account/profile');
  });

  it('explains missing eligible days without blaming the customer', async () => {
    failWith(404, 'ELIGIBILITY_NOT_RECORDED', 'Your eligible days for this period have not been recorded yet.');
    renderPage(<KnowYourRationPage />);
    expect(await screen.findByText(/eligible days are not recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/the facility records this/i)).toBeInTheDocument();
  });

  it('treats no open period as ordinary, not as an error', async () => {
    failWith(404, 'NO_OPEN_PERIOD', 'No ration period is open at the moment.');
    renderPage(<KnowYourRationPage />);
    expect(await screen.findByText(/no ration period is open/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing is wrong with your account/i)).toBeInTheDocument();
  });

  it('offers a retry on a genuine failure, and shows no stack trace', async () => {
    api.fetchEntitlement.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'TypeError: cannot read property x of undefined' })
    );
    renderPage(<KnowYourRationPage />);

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/TypeError|undefined|at Object/);
  });
});

// ===================================================================
describe('RationCategoryPage', () => {
  it('leads with the balance every item draws on', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dry: [{ ...CEREALS, consumed: 4_500, remaining: 9_000 }] })
    );
    renderPage(<RationCategoryPage />);

    // The figure appears in the headline and again in the per-item
    // hints; the headline is what this test is about.
    expect((await screen.findAllByText(/13,500 g/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4,500 g/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9,000 g/).length).toBeGreaterThan(0);
    expect(screen.getByText(/every item below draws on this one entitlement/i)).toBeInTheDocument();
  });

  it('shows each item’s rate against the shared balance', async () => {
    renderPage(<RationCategoryPage />);
    const card = (await screen.findByText('Pizza Base')).closest('div');
    expect(card).not.toBeNull();
    expect(screen.getByText(/1 g uses 4.5 g/)).toBeInTheDocument();
  });

  it('says "Not specified" instead of inventing a pack size', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Pizza Base');
    expect(screen.getAllByText('Not specified').length).toBeGreaterThan(0);
    // And never a zero standing in for "unknown".
    expect(screen.queryByText(/Pack size\s*0/)).not.toBeInTheDocument();
  });

  it('shows a pack size only where the server sent one', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Sandwich Bread');
    expect(screen.getByText(/400 g/)).toBeInTheDocument();
  });

  it('shows a per-item maximum where the facility set one', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Millets');
    expect(screen.getByText(/most you may take/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1,000 g/).length).toBeGreaterThan(0);
  });

  it('says which day an item is collected on, independently of its category', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Sandwich Bread');
    // Bread is a dry entitlement issued on the fresh day.
    expect(screen.getAllByText(/fresh ration day/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/dry ration day/i).length).toBeGreaterThan(0);
  });

  it('lists a withheld item with the server’s own reason, and does not restate the rule', async () => {
    routeParams = { poolId: 'pool-daliya' };
    api.fetchEntitlement.mockResolvedValue(response({ dry: [DALIYA] }));
    renderPage(<RationCategoryPage />);

    expect(await screen.findByText(/not available to you this period/i)).toBeInTheDocument();
    expect(screen.getByText('Oats')).toBeInTheDocument();
    expect(
      screen.getByText('This provision requires at least 30 eligible days; you have 20.')
    ).toBeInTheDocument();
    // It is not offered for selection.
    expect(screen.queryByLabelText(/quantity in g/i)).not.toBeInTheDocument();
  });

  it('explains an entitlement that was increased automatically', async () => {
    routeParams = { poolId: 'pool-milk' };
    api.fetchEntitlement.mockResolvedValue(response({ dietaryPreference: 'PV', fresh: [MILK_PV] }));
    renderPage(<RationCategoryPage />);

    expect(await screen.findByText(/included automatically/i)).toBeInTheDocument();
    expect(screen.getByText(/the egg entitlement is received as milk/i)).toBeInTheDocument();
    expect(screen.getByText(/the meat entitlement is received as milk/i)).toBeInTheDocument();
    // Base 250, total 1,000 — both the server's, neither derived here.
    // "250 ml a day" is also one conversion's contribution, so the base
    // row is located by its own label rather than by the figure alone.
    const breakdown = screen.getByText(/included automatically/i).parentElement as HTMLElement;
    const baseRow = within(breakdown).getByText('Base scale').parentElement as HTMLElement;
    expect(within(baseRow).getByText(/250 ml a day/)).toBeInTheDocument();
    const totalRow = within(breakdown).getByText(/your daily total/i).parentElement as HTMLElement;
    expect(within(totalRow).getByText(/1,000 ml a day/)).toBeInTheDocument();
  });

  /**
   * STEP 12A §12 — what a catalogue item shows an officer, and what it
   * must never show. Picture, name, brand, pack size and unit; no id,
   * no code, no pool id, and no word out of the database.
   */
  it('shows the picture, the name, the brand and the pack, and no internal identifier', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        dry: [
          {
            ...CEREALS,
            provisions: [
              provision({
                provisionId: 'prov-paneer',
                code: 'CH_PANEER',
                name: 'Paneer',
                brand: 'Amul',
                packUnit: 'packet',
                packSize: 200,
                isLoose: false,
              }),
            ],
          },
        ],
      })
    );
    renderPage(<RationCategoryPage />);

    const name = await screen.findByText('Paneer');
    const card = name.closest('div')!.parentElement as HTMLElement;

    // The brand is shown as a line of its own, never folded into the name.
    expect(within(card).getByText('Amul')).toBeInTheDocument();
    expect(name.textContent).toBe('Paneer');

    // The pack reads as the measure plus the container.
    expect(screen.getByText('200 g packet')).toBeInTheDocument();

    // No picture was recorded, so the officer gets the placeholder —
    // not a stand-in photograph of somebody else's packet.
    expect(screen.getByRole('img', { name: /no picture recorded for paneer/i })).toBeInTheDocument();

    // And nothing on the screen exposes how the facility files the item.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('prov-paneer');
    expect(page).not.toContain('pool-cereals');
    expect(page).not.toContain('CH_PANEER');
    expect(page).not.toMatch(/\bSKU\b|provision id|pool id|consumption ratio/i);
  });

  it('shows a recorded picture when the facility has one', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        dry: [
          {
            ...CEREALS,
            provisions: [
              provision({
                provisionId: 'prov-ghee',
                name: 'Ghee',
                brand: 'Amul',
                imageRef: 'rik/catalogue/ghee.jpg',
                packUnit: 'tin',
                packSize: 500,
                isLoose: false,
              }),
            ],
          },
        ],
      })
    );
    renderPage(<RationCategoryPage />);

    const image = await screen.findByRole('img', { name: 'Ghee' });
    expect(image).toHaveAttribute('src', 'rik/catalogue/ghee.jpg');
    expect(screen.getByText('500 g tin')).toBeInTheDocument();
  });

  /**
   * STEP 12B §6 — the fallback has to cover a picture that is RECORDED but
   * cannot be loaded, not only one that was never recorded. A path that has
   * gone stale, a file removed from the asset folder and a request that
   * fails on a poor connection all arrive as the same thing: the image
   * errors. The officer must still see the item, never a broken-image icon
   * and never an empty gap where the picture should be.
   */
  /**
   * STEP 12C-2 — two provisions can share a name and differ only by pack
   * size, which is exactly the oil case: Sunflower Refined Oil is two
   * SKUs, 500 and 1000, and each has a picture of its own showing its
   * own pack. The screen must show each row its OWN picture. If the two
   * ever render the same image an officer cannot tell the packs apart,
   * and the name alone will not help them.
   */
  it('shows each pack size of one item its own picture', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        dry: [
          {
            ...CEREALS,
            provisions: [
              provision({
                provisionId: 'prov-oil-500',
                code: 'OIL_SUNFLOWER_500',
                name: 'Sunflower Refined Oil',
                packSize: 500,
                isLoose: false,
                imageRef: '/catalogue/rik/dry/oil/oil__sunflower-refined-oil__500ml.png',
              }),
              provision({
                provisionId: 'prov-oil-1000',
                code: 'OIL_SUNFLOWER_1000',
                name: 'Sunflower Refined Oil',
                packSize: 1000,
                isLoose: false,
                imageRef: '/catalogue/rik/dry/oil/oil__sunflower-refined-oil__1litre.png',
              }),
            ],
          },
        ],
      })
    );
    renderPage(<RationCategoryPage />);

    const images = await screen.findAllByRole('img', { name: 'Sunflower Refined Oil' });
    expect(images).toHaveLength(2);
    const srcs = images.map((i) => i.getAttribute('src'));
    expect(new Set(srcs).size).toBe(2);
    expect(srcs).toContain('/catalogue/rik/dry/oil/oil__sunflower-refined-oil__500ml.png');
    expect(srcs).toContain('/catalogue/rik/dry/oil/oil__sunflower-refined-oil__1litre.png');

    // Both rows are offered, and the pack sizes the SERVER sent are what
    // is shown — the screen reads no figure off the picture.
    expect(screen.getByText('500 g')).toBeInTheDocument();
    expect(screen.getByText('1,000 g')).toBeInTheDocument();
    // And no internal identifier leaks alongside them.
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('OIL_SUNFLOWER_500');
    expect(page).not.toContain('prov-oil-500');
  });

  it('falls back to the placeholder when a recorded picture fails to load', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        dry: [
          {
            ...CEREALS,
            provisions: [
              provision({
                provisionId: 'prov-missing',
                name: 'Tomato Red',
                imageRef: '/catalogue/rik/fresh/42_tomato-red.png',
              }),
            ],
          },
        ],
      })
    );
    renderPage(<RationCategoryPage />);

    const image = await screen.findByRole('img', { name: 'Tomato Red' });
    expect(image).toHaveAttribute('src', '/catalogue/rik/fresh/42_tomato-red.png');

    fireEvent.error(image);

    expect(screen.getByRole('img', { name: /no picture recorded for tomato red/i })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Tomato Red' })).not.toBeInTheDocument();
    // The item itself is still offered — a missing picture is not a
    // missing provision.
    expect(screen.getByText('Tomato Red')).toBeInTheDocument();
  });
});

// ===================================================================
describe('RationCategoryPage — choosing quantities', () => {
  it('sends an absolute quantity and adopts the entitlement that comes back', async () => {
    const user = userEvent.setup();
    const chosen: EntitlementCategory = {
      ...CEREALS,
      consumed: 2_000,
      remaining: 11_500,
      provisions: CEREALS.provisions.map((p) =>
        p.provisionId === 'prov-rice' ? { ...p, selectedQuantity: 2_000, selectedPoolEquivalentQty: 2_000 } : p
      ),
    };
    api.setProvisionQuantity.mockResolvedValue({
      result: { ok: true },
      entitlement: response({ dry: [chosen] }),
    });

    renderPage(<RationCategoryPage />);
    const input = await screen.findByLabelText(/quantity in g/i, { selector: '#qty-prov-rice' });
    await user.clear(input);
    await user.type(input, '2000');
    await user.tab();

    await waitFor(() => expect(api.setProvisionQuantity).toHaveBeenCalledWith('prov-rice', 2000));
    expect((await screen.findAllByText(/11,500 g/)).length).toBeGreaterThan(0);
  });

  it('steps by a pack where the facility recorded one', async () => {
    const user = userEvent.setup();
    api.setProvisionQuantity.mockResolvedValue({ result: { ok: true }, entitlement: response() });
    renderPage(<RationCategoryPage />);

    await screen.findByText('Sandwich Bread');
    await user.click(screen.getByRole('button', { name: /take one more pack of Sandwich Bread/i }));
    // 0 + one 400 g pack.
    await waitFor(() => expect(api.setProvisionQuantity).toHaveBeenCalledWith('prov-bread', 400));
  });

  it('offers no stepper where there is no pack size and no countable unit', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Pizza Base');
    expect(screen.queryByRole('button', { name: /take one more pack of Pizza Base/i })).not.toBeInTheDocument();
  });

  it('takes the server’s advertised ceiling when asked for the maximum', async () => {
    const user = userEvent.setup();
    api.setProvisionQuantity.mockResolvedValue({ result: { ok: true }, entitlement: response() });
    renderPage(<RationCategoryPage />);

    await screen.findByText('Millets');
    const millets = screen.getByText('Millets').closest('.rounded-2xl') as HTMLElement;
    await user.click(within(millets).getByRole('button', { name: /take max/i }));
    await waitFor(() => expect(api.setProvisionQuantity).toHaveBeenCalledWith('prov-millets', 1000));
  });

  it('shows what a chosen item costs the shared balance, using the server’s figure', async () => {
    const chosen: EntitlementCategory = {
      ...CEREALS,
      consumed: 2_250,
      remaining: 11_250,
      provisions: CEREALS.provisions.map((p) =>
        // 500 g of pizza base at 4.5 — the server says it costs 2,250 g.
        p.provisionId === 'prov-pizza' ? { ...p, selectedQuantity: 500, selectedPoolEquivalentQty: 2_250 } : p
      ),
    };
    api.fetchEntitlement.mockResolvedValue(response({ dry: [chosen] }));
    renderPage(<RationCategoryPage />);

    expect(await screen.findByText(/what you have chosen/i)).toBeInTheDocument();
    expect(screen.getAllByText(/uses 2,250 g/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11,250 g/).length).toBeGreaterThan(0);
  });

  it('shows a split across several items adding up to the server’s total', async () => {
    const split: EntitlementCategory = {
      ...CEREALS,
      consumed: 7_700,
      remaining: 5_800,
      provisions: CEREALS.provisions.map((p) => {
        if (p.provisionId === 'prov-rice') return { ...p, selectedQuantity: 2_000, selectedPoolEquivalentQty: 2_000 };
        if (p.provisionId === 'prov-bread') return { ...p, selectedQuantity: 3_000, selectedPoolEquivalentQty: 3_000 };
        if (p.provisionId === 'prov-pizza') return { ...p, selectedQuantity: 600, selectedPoolEquivalentQty: 2_700 };
        return p;
      }),
    };
    api.fetchEntitlement.mockResolvedValue(response({ dry: [split] }));
    renderPage(<RationCategoryPage />);

    const summary = (await screen.findByText(/what you have chosen/i)).parentElement as HTMLElement;
    expect(within(summary).getByText('Rice')).toBeInTheDocument();
    expect(within(summary).getByText('Sandwich Bread')).toBeInTheDocument();
    expect(within(summary).getByText('Pizza Base')).toBeInTheDocument();
    expect(within(summary).getByText(/7,700 g/)).toBeInTheDocument();
    expect(within(summary).getByText(/5,800 g/)).toBeInTheDocument();
  });
});

// ===================================================================
describe('RationCategoryPage — when the server refuses', () => {
  it('repeats the server’s over-entitlement message word for word', async () => {
    const user = userEvent.setup();
    const message = 'Your remaining entitlement is 2,000 g. This selection requires 2,250 g.';
    api.setProvisionQuantity.mockResolvedValue({
      result: {
        ok: false,
        reason: 'EXCEEDS_ENTITLEMENT',
        message,
        detail: { entitlement: 13_500, alreadyConsumed: 11_500, requestedEquivalent: 2_250, remaining: 2_000 },
      },
      entitlement: response(),
    });

    renderPage(<RationCategoryPage />);
    const input = await screen.findByLabelText(/quantity in g/i, { selector: '#qty-prov-pizza' });
    await user.clear(input);
    await user.type(input, '500');
    await user.tab();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
  });

  /**
   * The negative case that matters most: the screen must NOT decide for
   * itself that a quantity is too large. It sends it and reports what
   * comes back.
   */
  it('sends an over-large quantity to the server instead of blocking it', async () => {
    const user = userEvent.setup();
    api.setProvisionQuantity.mockResolvedValue({
      result: { ok: false, reason: 'EXCEEDS_ENTITLEMENT', message: 'Too much.', detail: {} },
      entitlement: response(),
    });

    renderPage(<RationCategoryPage />);
    const input = await screen.findByLabelText(/quantity in g/i, { selector: '#qty-prov-millets' });
    await user.clear(input);
    // Far beyond the advertised 1,000 g ceiling.
    await user.type(input, '99999');
    await user.tab();

    await waitFor(() => expect(api.setProvisionQuantity).toHaveBeenCalledWith('prov-millets', 99999));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too much.');
  });

  it('keeps the entitlement on screen when a refused change comes back', async () => {
    const user = userEvent.setup();
    api.setProvisionQuantity.mockResolvedValue({
      result: { ok: false, reason: 'EXCEEDS_MAX_QUANTITY', message: 'Above the limit.', detail: { maxQuantity: 1000 } },
      entitlement: response({ dry: [{ ...CEREALS, consumed: 0, remaining: 13_500 }] }),
    });

    renderPage(<RationCategoryPage />);
    const input = await screen.findByLabelText(/quantity in g/i, { selector: '#qty-prov-millets' });
    await user.clear(input);
    await user.type(input, '5000');
    await user.tab();

    await screen.findByRole('alert');
    expect(screen.getAllByText(/13,500 g/).length).toBeGreaterThan(0);
  });

  it('reports a network failure without discarding the ration on screen', async () => {
    const user = userEvent.setup();
    api.setProvisionQuantity.mockRejectedValue(new Error('offline'));

    renderPage(<RationCategoryPage />);
    const input = await screen.findByLabelText(/quantity in g/i, { selector: '#qty-prov-rice' });
    await user.clear(input);
    await user.type(input, '100');
    await user.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    expect(screen.getAllByText(/13,500 g/).length).toBeGreaterThan(0);
  });
});

// ===================================================================
describe('RationCategoryPage — alternatives', () => {
  beforeEach(() => {
    routeParams = { poolId: 'pool-eggs' };
    api.fetchEntitlement.mockResolvedValue(
      response({ dietaryPreference: 'EV', fresh: [EGGS_WITH_OPTIONS], dry: [] })
    );
  });

  it('offers the choice in the customer’s language, not the database’s', async () => {
    renderPage(<RationCategoryPage />);
    expect(await screen.findByText(/choose an alternative/i)).toBeInTheDocument();
    expect(screen.getByText(/four additional Eggs per day in lieu of meat/i)).toBeInTheDocument();
    // No internal vocabulary anywhere on the screen.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/entitlement pool|conversion engine|rule snapshot|consumption ratio/i);
  });

  it('says only one may be taken', async () => {
    renderPage(<RationCategoryPage />);
    expect(await screen.findByText(/only one can be chosen/i)).toBeInTheDocument();
  });

  it('sends the chosen alternative and adopts the new entitlement', async () => {
    const user = userEvent.setup();
    const taken = {
      ...EGGS_WITH_OPTIONS,
      effectiveDailyQty: 6,
      totalEntitlement: 180,
      remaining: 180,
      conversionOptions: EGGS_WITH_OPTIONS.conversionOptions.map((o) => ({ ...o, selected: true })),
    };
    api.setElections.mockResolvedValue({
      result: { ok: true },
      entitlement: response({ dietaryPreference: 'EV', fresh: [taken], dry: [] }),
    });

    renderPage(<RationCategoryPage />);
    await user.click(await screen.findByRole('button', { name: /four additional Eggs per day in lieu of meat/i }));

    await waitFor(() => expect(api.setElections).toHaveBeenCalledWith(['conv-meat-eggs']));
    expect((await screen.findAllByText(/180 piece/)).length).toBeGreaterThan(0);
  });

  it('takes the choice back by sending an empty set', async () => {
    const user = userEvent.setup();
    api.fetchEntitlement.mockResolvedValue(
      response({
        dietaryPreference: 'EV',
        fresh: [
          {
            ...EGGS_WITH_OPTIONS,
            conversionOptions: EGGS_WITH_OPTIONS.conversionOptions.map((o) => ({ ...o, selected: true })),
          },
        ],
        dry: [],
      })
    );
    api.setElections.mockResolvedValue({ result: { ok: true }, entitlement: response({ fresh: [EGGS_WITH_OPTIONS], dry: [] }) });

    renderPage(<RationCategoryPage />);
    await user.click(await screen.findByRole('button', { name: /four additional Eggs per day in lieu of meat/i }));
    await waitFor(() => expect(api.setElections).toHaveBeenCalledWith([]));
  });

  it('shows the server’s refusal when two would clash', async () => {
    const user = userEvent.setup();
    api.setElections.mockResolvedValue({
      result: {
        ok: false,
        reason: 'CONFLICTING_ELECTIONS',
        message: 'Only one alternative may be taken for the same entitlement.',
        detail: {},
      },
      entitlement: response({ dietaryPreference: 'EV', fresh: [EGGS_WITH_OPTIONS], dry: [] }),
    });

    renderPage(<RationCategoryPage />);
    await user.click(await screen.findByRole('button', { name: /four additional Eggs per day in lieu of meat/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/only one alternative may be taken/i);
  });
});

// ===================================================================
describe('the screens are usable and accessible', () => {
  it('labels every quantity control with the item it belongs to', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Rice');
    expect(screen.getByRole('button', { name: /take one more pack of Sandwich Bread/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/quantity in g/i, { selector: '#qty-prov-rice' })).toBeInTheDocument();
  });

  it('states remaining and over-limit in words, not only in colour', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({ dry: [{ ...CEREALS, consumed: 13_500, remaining: 0 }] })
    );
    renderPage(<RationCategoryPage />);
    expect(await screen.findByText(/fully used/i)).toBeInTheDocument();
    expect(screen.getByText(/still available/i)).toBeInTheDocument();
  });

  it('uses customer language throughout, never internal vocabulary', async () => {
    renderPage(<RationCategoryPage />);
    await screen.findByText('Rice');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/entitlement pool|conversion engine|rule snapshot|consumption ratio|provision_id|pool_id/i);
    expect(text).toMatch(/your entitlement/i);
    expect(text).toMatch(/still available/i);
  });
});

// ===================================================================
/**
 * Migration 0053 — Fresh Milk as a PHYSICAL 500 ml coupon.
 *
 * The arithmetic belongs to the server and is tested against real
 * PostgreSQL. What these tests are for is the WORDING, which is the part an
 * officer at a counter actually acts on: "3 coupons" is a thing you can hand
 * over, "3 piece" is not. The noun comes from the facility's own
 * configuration (`packUnit`), never from the provision's name, so a renamed
 * provision cannot change it and a new counted item needs no code change.
 */
describe('RationCategoryPage — the Fresh Milk coupon reads as coupons, not pieces', () => {
  const coupon = (over: Partial<EntitlementProvision> = {}) =>
    provision({
      provisionId: 'prov-milk-coupon',
      code: 'MILK_FRESH_COUPON',
      name: 'Fresh Milk (500 ml coupon)',
      unit: 'piece',
      packUnit: 'coupon',
      consumptionRatio: 500,
      isLoose: false,
      wholeUnitsOnly: true,
      issuePeriod: 'FRESH',
      maxSelectableQuantity: 5,
      ...over,
    });

  const milkWithCoupon = (over: Partial<EntitlementProvision> = {}): EntitlementCategory => ({
    ...MILK_PV,
    totalEntitlement: 2500,
    consumed: 0,
    remaining: 2500,
    precise: { totalEntitlement: 2500, consumed: 0, remaining: 2500 },
    automaticConversions: [],
    provisions: [coupon(over)],
  });

  beforeEach(() => {
    routeParams = { poolId: 'pool-milk' };
  });

  it('labels the box "Number of coupons", not "Quantity in piece"', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [milkWithCoupon()], dry: [] }));
    renderPage(<RationCategoryPage />);

    expect(await screen.findByLabelText(/number of coupons/i)).toBeInTheDocument();
    expect(screen.queryByText(/quantity in piece/i)).not.toBeInTheDocument();
  });

  it('offers a whole number of coupons and steps the box by one', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [milkWithCoupon()], dry: [] }));
    renderPage(<RationCategoryPage />);

    const box = await screen.findByLabelText(/number of coupons/i);
    expect(box).toHaveAttribute('step', '1');
    expect(screen.getByText(/5 coupons/)).toBeInTheDocument();
  });

  it('says what one coupon is worth against the allowance', async () => {
    api.fetchEntitlement.mockResolvedValue(response({ fresh: [milkWithCoupon()], dry: [] }));
    renderPage(<RationCategoryPage />);

    // The rate, in the officer's words, from the server's own ratio.
    expect(await screen.findByText(/1 coupon uses 500 ml/i)).toBeInTheDocument();
    // And the same figure again as the item's own description, in place of a
    // pack size it does not have.
    expect(screen.getByText(/each coupon/i)).toBeInTheDocument();
  });

  it('writes a single coupon in the singular', async () => {
    api.fetchEntitlement.mockResolvedValue(
      response({
        fresh: [
          milkWithCoupon({ selectedQuantity: 1, selectedPoolEquivalentQty: 500, maxSelectableQuantity: 5 }),
        ],
        dry: [],
      })
    );
    renderPage(<RationCategoryPage />);

    expect(await screen.findByText(/1 coupon uses 500 ml/i)).toBeInTheDocument();
    expect(screen.getByText(/your 1 coupon uses/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 coupons/)).not.toBeInTheDocument();
  });

  it('says coupons in the "what you have chosen" summary as well as on the row', async () => {
    // The category screen renders a selected quantity TWICE — once in the
    // summary panel and once on the item itself. Only the second was changed
    // at first, and the summary went on reading "15 piece" in the running
    // demo. Both are asserted here so one cannot drift from the other.
    api.fetchEntitlement.mockResolvedValue(
      response({
        fresh: [
          {
            ...milkWithCoupon({ selectedQuantity: 3, selectedPoolEquivalentQty: 1500 }),
            consumed: 1500,
            remaining: 1000,
            precise: { totalEntitlement: 2500, consumed: 1500, remaining: 1000 },
          },
        ],
        dry: [],
      })
    );
    renderPage(<RationCategoryPage />);

    await screen.findByText(/number of coupons/i);
    // Two renderings of the same figure, both in coupons, and no "piece"
    // anywhere on the screen.
    expect(screen.getAllByText(/3 coupons/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/\bpiece\b/i)).not.toBeInTheDocument();
  });

  it('leaves a measured provision alone — Milk TD is still grams', async () => {
    const td = provision({
      provisionId: 'prov-td',
      code: 'MILK_TD',
      name: 'Milk TD / Milkmaid',
      unit: 'g',
      consumptionRatio: 2.5,
      isLoose: false,
      maxSelectableQuantity: 1000,
    });
    api.fetchEntitlement.mockResolvedValue(
      response({ fresh: [{ ...milkWithCoupon(), provisions: [td] }], dry: [] })
    );
    renderPage(<RationCategoryPage />);

    expect(await screen.findByLabelText(/quantity in g/i)).toBeInTheDocument();
    expect(screen.getByText(/1 g uses 2.5 ml/i)).toBeInTheDocument();
    expect(screen.queryByText(/coupon/i)).not.toBeInTheDocument();
  });
});
