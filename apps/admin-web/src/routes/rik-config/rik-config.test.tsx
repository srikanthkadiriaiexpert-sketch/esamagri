import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { ApiError } from '../../lib/api/client';
import type { StaffSession } from '../../lib/api/admin-api';
import { rikAdmin, pifAdmin, rikPickupStaff } from '../../test/staff-session';
import type {
  ConfigConversion,
  ConfigHistoryEntry,
  ConfigPool,
  ConfigProvision,
  ConfigScale,
} from '../../lib/api/rik-config-api';

/**
 * STEP 11C — the seven RIK configuration screens.
 *
 * What these tests are for, and what they are deliberately NOT for.
 *
 * They check that each screen renders exactly what the server returned,
 * sends exactly what the administrator typed, and shows the server's
 * own refusal when it refuses. They do NOT check any entitlement rule,
 * because no entitlement rule lives here — the screens compute nothing,
 * validate no quantity and decide no applicability. A test asserting
 * "the form rejects a negative ratio" would be asserting a behaviour
 * the frontend must not have; the API suite proves the server rejects
 * it, and the test below proves the screen surfaces that refusal.
 *
 * One test states the negative case explicitly: a rejected change must
 * leave the screen showing the server's message, with the value the
 * administrator typed still in the box, and no optimistic update.
 */

const api = {
  fetchPools: vi.fn(),
  fetchPoolsForProvisions: vi.fn(),
  fetchScales: vi.fn(),
  fetchConversions: vi.fn(),
  fetchProvisions: vi.fn(),
  fetchHistory: vi.fn(),
  createPool: vi.fn(),
  updatePool: vi.fn(),
  setPoolActive: vi.fn(),
  createScale: vi.fn(),
  updateScale: vi.fn(),
  setScaleActive: vi.fn(),
  supersedeScale: vi.fn(),
  createConversion: vi.fn(),
  updateConversion: vi.fn(),
  setConversionActive: vi.fn(),
  createProvision: vi.fn(),
  updateProvision: vi.fn(),
  setProvisionActive: vi.fn(),
  uploadProvisionImage: vi.fn(),
  removeProvisionImage: vi.fn(),
};

/**
 * The mock replaces the module wholesale, so the one value export the
 * screens read — the list of pack units offered in the pack-unit box —
 * has to be handed back too. It is kept out of `api` because the reset
 * below walks that object expecting every entry to be a spy.
 */
vi.mock('../../lib/api/rik-config-api', () => ({
  ...api,
  PACK_UNITS: ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'tin', 'box'],
}));

let session: StaffSession = rikAdmin();
vi.mock('../../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ session, status: 'authenticated' }),
}));

// Imported after the mocks so the modules under test pick them up.
const { RikConfigLayout } = await import('./RikConfigLayout');
const { PoolsPage } = await import('./PoolsPage');
const { ScalesPage } = await import('./ScalesPage');
const { ConversionsPage } = await import('./ConversionsPage');
const { ProvisionsPage } = await import('./ProvisionsPage');
const { PackSizesPage } = await import('./PackSizesPage');
const { AvailabilityPage } = await import('./AvailabilityPage');
const { RuleHistoryPage } = await import('./RuleHistoryPage');

const POOL: ConfigPool = {
  id: 'pool-1',
  code: 'CEREALS',
  name: 'Cereals',
  rationType: 'DRY',
  unit: 'g',
  description: null,
  imageRef: null,
  displayOrder: 1,
  isActive: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const RETIRED_POOL: ConfigPool = {
  ...POOL,
  id: 'pool-2',
  code: 'OLD_POOL',
  name: 'Retired pool',
  isActive: false,
};

const SCALE: ConfigScale = {
  id: 'scale-1',
  poolId: 'pool-1',
  poolCode: 'CEREALS',
  poolName: 'Cereals',
  poolUnit: 'g',
  dietaryPreference: 'NV',
  dailyQty: '450.0000',
  notes: null,
  isActive: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const CONVERSION: ConfigConversion = {
  id: 'conv-1',
  code: 'MEAT_TO_MILK_PV',
  fromPoolId: 'pool-3',
  fromPoolCode: 'MEAT',
  toPoolId: 'pool-4',
  toPoolCode: 'MILK',
  fromQty: '260.0000',
  toQty: '500.0000',
  mode: 'AUTOMATIC',
  dietaryPreference: 'PV',
  description: null,
  displayOrder: 1,
  isActive: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const PROVISION: ConfigProvision = {
  id: 'prov-1',
  poolId: 'pool-1',
  poolCode: 'CEREALS',
  poolName: 'Cereals',
  poolRationType: 'DRY',
  code: 'PIZZA_BASE',
  name: 'Pizza base',
  brand: null,
  imageRef: null,
  imageUrl: null,
  packUnit: null,
  unit: 'g',
  consumptionRatio: '4.500000',
  packSize: '500.0000',
  isLoose: false,
  isCustomerSelectable: true,
  maxQuantity: null,
  maxPacks: null,
  minEligibleDays: null,
  issuePeriod: 'DRY',
  dietaryPreference: null,
  displayOrder: 1,
  isActive: true,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A DRY pool item handed over on the fresh day — the bread case. */
const BREAD: ConfigProvision = {
  ...PROVISION,
  id: 'prov-2',
  code: 'SANDWICH_BREAD',
  name: 'Sandwich bread',
  issuePeriod: 'FRESH',
  consumptionRatio: '1.000000',
};

const HISTORY: ConfigHistoryEntry = {
  id: 'audit-1',
  action: 'RIK_CONFIG_SCALE_UPDATED',
  entityType: 'rik.pool_scales',
  entityId: 'scale-1',
  actorId: 'user-1',
  actorName: 'A. Administrator',
  actorRole: 'RIK_ADMIN',
  before: { poolCode: 'CEREALS', dietaryPreference: 'NV', dailyQty: '450.0000' },
  after: { poolCode: 'CEREALS', dietaryPreference: 'NV', dailyQty: '500.0000' },
  createdAt: '2026-09-23T06:00:00.000Z',
};

function renderPage(element: ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  session = rikAdmin();
  api.fetchPools.mockResolvedValue({ items: [POOL, RETIRED_POOL] });
  api.fetchPoolsForProvisions.mockResolvedValue({ items: [POOL] });
  api.fetchScales.mockResolvedValue({ items: [SCALE] });
  api.fetchConversions.mockResolvedValue({ items: [CONVERSION] });
  api.fetchProvisions.mockResolvedValue({ items: [PROVISION, BREAD] });
  api.fetchHistory.mockResolvedValue({ items: [HISTORY] });
});

// ===================================================================
describe('RikConfigLayout — who sees which area', () => {
  const layout = (
    <MemoryRouter initialEntries={['/rik/config']}>
      <Routes>
        <Route path="/rik/config" element={<RikConfigLayout />}>
          <Route index element={<p>pools screen</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

  it('shows all eleven areas to a RIK administrator', () => {
    session = rikAdmin();
    render(layout);
    const nav = screen.getByRole('navigation', { name: /configuration areas/i });
    // Seven from STEP 11C, collection points from STEP 11E, New Arrivals, and
    // Seasonal banners (migration 0057). Those last two are merchandising
    // rather than entitlement rules, but are gated by `rik.product.manage`
    // like the provisions they feature.
    //
    // The eleventh is Entitlement periods, added for operational readiness so
    // RIK staff open and retire periods from this portal instead of by SQL. It
    // is gated by `rik.entitlement.allocate` — a THIRD permission on this nav,
    // alongside adjust and product.manage, and the same one the eligibility
    // import uses. The two tests below are what prove it is gated at all: a
    // PIF administrator and RIK pickup staff hold none of the three and see no
    // navigation whatsoever.
    expect(within(nav).getAllByRole('link')).toHaveLength(11);
    expect(within(nav).getByRole('link', { name: /entitlement periods/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /collection points/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /new arrivals/i })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: /seasonal banners/i })).toBeInTheDocument();
  });

  it('shows nothing at all to a PIF administrator', () => {
    session = pifAdmin();
    render(layout);
    expect(screen.getByText(/do not have access to this area/i)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /configuration areas/i })).not.toBeInTheDocument();
  });

  it('shows nothing to RIK pickup staff, who hold neither configuration permission', () => {
    session = rikPickupStaff();
    render(layout);
    expect(screen.getByText(/do not have access to this area/i)).toBeInTheDocument();
  });

  it('says a change takes effect on the next calculation, with no publish step', () => {
    render(layout);
    expect(screen.getByText(/applies to the next calculation/i)).toBeInTheDocument();
  });
});

// ===================================================================
describe('PoolsPage', () => {
  it('lists live and retired pools, and says which is which', async () => {
    renderPage(<PoolsPage />);
    const live = await screen.findByRole('row', { name: /Cereals/ });
    expect(within(live).getByText('In force')).toBeInTheDocument();
    const retired = screen.getByRole('row', { name: /Retired pool/ });
    expect(within(retired).getByText('Retired')).toBeInTheDocument();
  });

  it('sends exactly what was typed when a pool is created', async () => {
    const user = userEvent.setup();
    api.createPool.mockResolvedValue({ ...POOL, id: 'new', code: 'SPICES', name: 'Spices' });
    renderPage(<PoolsPage />);
    await screen.findByRole('row', { name: /Cereals/ });

    await user.click(screen.getByRole('button', { name: /add an entitlement pool/i }));
    await user.type(screen.getByLabelText(/^Code/), 'spices');
    await user.type(screen.getByLabelText(/^Name/), 'Spices');
    await user.click(screen.getByRole('button', { name: /add pool/i }));

    await waitFor(() => expect(api.createPool).toHaveBeenCalledTimes(1));
    expect(api.createPool.mock.calls[0][0]).toMatchObject({
      code: 'SPICES',
      name: 'Spices',
      rationType: 'DRY',
      unit: 'g',
    });
  });

  it('retires a pool rather than deleting it, and offers no delete anywhere', async () => {
    const user = userEvent.setup();
    api.setPoolActive.mockResolvedValue({ ...POOL, isActive: false });
    renderPage(<PoolsPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /retire/i }));
    await waitFor(() => expect(api.setPoolActive).toHaveBeenCalledWith('pool-1', false));
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  it('shows the server’s own refusal, and does not invent one of its own', async () => {
    const user = userEvent.setup();
    api.createPool.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'A pool with code "CEREALS" already exists.',
        details: { reason: 'DUPLICATE_CODE', field: 'code' },
      })
    );
    renderPage(<PoolsPage />);
    await screen.findByRole('row', { name: /Cereals/ });

    await user.click(screen.getByRole('button', { name: /add an entitlement pool/i }));
    await user.type(screen.getByLabelText(/^Code/), 'CEREALS');
    await user.type(screen.getByLabelText(/^Name/), 'Duplicate');
    await user.click(screen.getByRole('button', { name: /add pool/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A pool with code "CEREALS" already exists.');
    expect(alert).toHaveTextContent('code');
    // The typed value stays put: nothing was saved, so nothing is cleared.
    expect(screen.getByLabelText(/^Code/)).toHaveValue('CEREALS');
  });

  it('shows the unauthorized state on a real 403', async () => {
    api.fetchPools.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    renderPage(<PoolsPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
  });

  /**
   * STEP 14B — the category picture.
   *
   * A pool's cover picture is a presentation field and is edited on its
   * own. The tests below pin three things: the recorded path is shown as
   * it was returned, saving sends ONLY the picture, and clearing the box
   * sends null rather than an empty string — the column's CHECK rejects
   * blank, so an empty string would be a 400 for something the
   * administrator is entitled to do.
   *
   * A category picture is NOT a provision picture. Provision pictures are
   * managed on the SKU master; nothing on this screen touches them.
   */
  it('shows the recorded category image path, and says so when there is none', async () => {
    api.fetchPools.mockResolvedValue({
      items: [{ ...POOL, imageRef: '/catalogue/rik/category/milk.png' }, RETIRED_POOL],
    });
    renderPage(<PoolsPage />);

    const live = await screen.findByRole('row', { name: /Cereals/ });
    expect(within(live).getByText('/catalogue/rik/category/milk.png')).toBeInTheDocument();
    const retired = screen.getByRole('row', { name: /Retired pool/ });
    expect(within(retired).getByText('No image')).toBeInTheDocument();
  });

  it('sends only the category image when one is saved', async () => {
    const user = userEvent.setup();
    api.updatePool.mockResolvedValue({ ...POOL, imageRef: '/catalogue/rik/category/milk.png' });
    renderPage(<PoolsPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /^image$/i }));
    await user.type(screen.getByLabelText(/category image for CEREALS/i), '/catalogue/rik/category/milk.png');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePool).toHaveBeenCalledTimes(1));
    expect(api.updatePool).toHaveBeenCalledWith('pool-1', { imageRef: '/catalogue/rik/category/milk.png' });
    // The rule-bearing fields are not offered here and must not be sent.
    const payload = api.updatePool.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['imageRef']);
  });

  it('clears a category image by sending null, not an empty string', async () => {
    const user = userEvent.setup();
    api.fetchPools.mockResolvedValue({
      items: [{ ...POOL, imageRef: '/catalogue/rik/category/milk.png' }],
    });
    api.updatePool.mockResolvedValue({ ...POOL, imageRef: null });
    renderPage(<PoolsPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /^image$/i }));
    await user.clear(screen.getByLabelText(/category image for CEREALS/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePool).toHaveBeenCalledWith('pool-1', { imageRef: null }));
  });

  it('shows the server’s refusal of a category image without clearing the row', async () => {
    const user = userEvent.setup();
    api.updatePool.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'imageRef must be shorter than or equal to 500 characters',
        details: { field: 'imageRef' },
      })
    );
    renderPage(<PoolsPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /^image$/i }));
    await user.type(screen.getByLabelText(/category image for CEREALS/i), 'x');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('imageRef must be shorter than or equal to 500 characters');
    expect(screen.getByRole('row', { name: /Cereals/ })).toBeInTheDocument();
  });

  /**
   * STEP 14C — a second category gets a picture. The editor is per row, so
   * the assertion that matters once more than one pool has a cover is that
   * editing one names only that pool: a patch that carried the other
   * category's id, or its path, would quietly move a picture an
   * administrator never opened.
   */
  it('edits one category’s image without touching another that already has one', async () => {
    const user = userEvent.setup();
    const MILK: ConfigPool = {
      ...POOL,
      id: 'pool-milk',
      code: 'MILK',
      name: 'Milk',
      rationType: 'FRESH',
      unit: 'ml',
      imageRef: '/catalogue/rik/category/milk.png',
    };
    const MEAT: ConfigPool = { ...POOL, id: 'pool-meat', code: 'MEAT', name: 'Meat', rationType: 'FRESH' };
    api.fetchPools.mockResolvedValue({ items: [MILK, MEAT] });
    api.updatePool.mockResolvedValue({ ...MEAT, imageRef: '/catalogue/rik/category/meat.png' });
    renderPage(<PoolsPage />);

    const meatRow = await screen.findByRole('row', { name: /Meat/ });
    expect(within(meatRow).getByText('No image')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Milk/ })).getByText('/catalogue/rik/category/milk.png')).toBeInTheDocument();

    await user.click(within(meatRow).getByRole('button', { name: /^image$/i }));
    // The box opened on the Meat row, and only there.
    expect(screen.getByLabelText(/category image for MEAT/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/category image for MILK/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/category image for MEAT/i), '/catalogue/rik/category/meat.png');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePool).toHaveBeenCalledTimes(1));
    expect(api.updatePool).toHaveBeenCalledWith('pool-meat', { imageRef: '/catalogue/rik/category/meat.png' });
    // Milk's row was never the subject of a request.
    expect(api.updatePool.mock.calls.every((c) => c[0] !== 'pool-milk')).toBe(true);
  });

  /**
   * STEP 14D — a third category. With Milk and Meat already pictured, the
   * assertion that still earns its place is that the editor names one
   * pool: a patch carrying another category's id, or another category's
   * path, would move a picture nobody opened.
   */
  it('sets a third category’s image without disturbing the two that have one', async () => {
    const user = userEvent.setup();
    const MILK: ConfigPool = { ...POOL, id: 'pool-milk', code: 'MILK', name: 'Milk', rationType: 'FRESH', unit: 'ml', imageRef: '/catalogue/rik/category/milk.png' };
    const MEAT: ConfigPool = { ...POOL, id: 'pool-meat', code: 'MEAT', name: 'Meat', rationType: 'FRESH', imageRef: '/catalogue/rik/category/meat.png' };
    const EGGS: ConfigPool = { ...POOL, id: 'pool-eggs', code: 'EGGS', name: 'Eggs', rationType: 'FRESH', unit: 'piece' };
    api.fetchPools.mockResolvedValue({ items: [MILK, MEAT, EGGS] });
    api.updatePool.mockResolvedValue({ ...EGGS, imageRef: '/catalogue/rik/category/eggs.png' });
    renderPage(<PoolsPage />);

    const eggsRow = await screen.findByRole('row', { name: /Eggs/ });
    expect(within(eggsRow).getByText('No image')).toBeInTheDocument();

    await user.click(within(eggsRow).getByRole('button', { name: /^image$/i }));
    expect(screen.getByLabelText(/category image for EGGS/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/category image for MILK/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/category image for MEAT/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/category image for EGGS/i), '/catalogue/rik/category/eggs.png');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePool).toHaveBeenCalledTimes(1));
    expect(api.updatePool).toHaveBeenCalledWith('pool-eggs', { imageRef: '/catalogue/rik/category/eggs.png' });
    expect(api.updatePool.mock.calls.every((c) => c[0] === 'pool-eggs')).toBe(true);
    // The two approved categories keep the paths they arrived with.
    expect(within(screen.getByRole('row', { name: /Milk/ })).getByText('/catalogue/rik/category/milk.png')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /Meat/ })).getByText('/catalogue/rik/category/meat.png')).toBeInTheDocument();
  });

  /**
   * STEP 14E — a fourth category. With three already pictured, the standing
   * risk is a patch that names the wrong row, so this asserts the editor
   * opens on one pool only and that the other three keep their own paths.
   */
  it('sets a fourth category’s image while three already have one', async () => {
    const user = userEvent.setup();
    const mk = (id: string, code: string, name: string, imageRef: string | null, unit = 'g'): ConfigPool => ({
      ...POOL, id, code, name, rationType: 'FRESH', unit, imageRef,
    });
    const MILK = mk('pool-milk', 'MILK', 'Milk', '/catalogue/rik/category/milk.png', 'ml');
    const MEAT = mk('pool-meat', 'MEAT', 'Meat', '/catalogue/rik/category/meat.png');
    const EGGS = mk('pool-eggs', 'EGGS', 'Eggs', '/catalogue/rik/category/eggs.png', 'piece');
    const VEG = mk('pool-veg', 'VEGETABLES', 'Fresh Vegetables', null);
    api.fetchPools.mockResolvedValue({ items: [MILK, MEAT, EGGS, VEG] });
    api.updatePool.mockResolvedValue({ ...VEG, imageRef: '/catalogue/rik/category/vegetables.png' });
    renderPage(<PoolsPage />);

    const vegRow = await screen.findByRole('row', { name: /Fresh Vegetables/ });
    expect(within(vegRow).getByText('No image')).toBeInTheDocument();

    await user.click(within(vegRow).getByRole('button', { name: /^image$/i }));
    expect(screen.getByLabelText(/category image for VEGETABLES/i)).toBeInTheDocument();
    for (const code of ['MILK', 'MEAT', 'EGGS']) {
      expect(screen.queryByLabelText(new RegExp(`category image for ${code}`, 'i'))).not.toBeInTheDocument();
    }

    await user.type(
      screen.getByLabelText(/category image for VEGETABLES/i),
      '/catalogue/rik/category/vegetables.png'
    );
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updatePool).toHaveBeenCalledTimes(1));
    expect(api.updatePool).toHaveBeenCalledWith('pool-veg', {
      imageRef: '/catalogue/rik/category/vegetables.png',
    });
    expect(api.updatePool.mock.calls.every((c) => c[0] === 'pool-veg')).toBe(true);
    // The three approved categories keep the paths they arrived with.
    for (const [name, path] of [
      ['Milk', '/catalogue/rik/category/milk.png'],
      ['Meat', '/catalogue/rik/category/meat.png'],
      ['Eggs', '/catalogue/rik/category/eggs.png'],
    ] as const) {
      expect(within(screen.getByRole('row', { name: new RegExp(`^${name}` ) })).getByText(path)).toBeInTheDocument();
    }
  });

  it('offers no way to change a pool’s name, unit or ration type beside its image', async () => {
    const user = userEvent.setup();
    renderPage(<PoolsPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });
    await user.click(within(row).getByRole('button', { name: /^image$/i }));

    expect(screen.getByLabelText(/category image for CEREALS/i)).toBeInTheDocument();
    // The add-a-pool panel is closed, so any such box would belong to the row.
    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Unit/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Ration type/)).not.toBeInTheDocument();
  });
});

// ===================================================================
describe('ScalesPage', () => {
  it('states that a missing row means the pool does not apply', async () => {
    renderPage(<ScalesPage />);
    await screen.findByRole('row', { name: /Cereals/ });
    expect(screen.getByText(/does not apply to that preference at all/i)).toBeInTheDocument();
  });

  it('renders the stored quantity as the server sent it, not reformatted', async () => {
    renderPage(<ScalesPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });
    expect(within(row).getByText(/450\.0000 g/)).toBeInTheDocument();
  });

  it('corrects a scale in place when asked to correct it', async () => {
    const user = userEvent.setup();
    api.updateScale.mockResolvedValue({ ...SCALE, dailyQty: '500.0000' });
    renderPage(<ScalesPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /correct/i }));
    const input = screen.getByLabelText(/daily quantity for Cereals NV/i);
    await user.clear(input);
    await user.type(input, '500');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updateScale).toHaveBeenCalledWith('scale-1', { dailyQty: 500 }));
    expect(api.supersedeScale).not.toHaveBeenCalled();
  });

  it('supersedes from a date when asked to change from a date, leaving the old rule alone', async () => {
    const user = userEvent.setup();
    api.supersedeScale.mockResolvedValue({
      closed: { ...SCALE, effectiveTo: '2026-09-30' },
      created: { ...SCALE, id: 'scale-2', dailyQty: '500.0000', effectiveFrom: '2026-10-01' },
    });
    renderPage(<ScalesPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /change from date/i }));
    const qty = screen.getByLabelText(/daily quantity for Cereals NV/i);
    await user.clear(qty);
    await user.type(qty, '500');
    const date = screen.getByLabelText(/new rule starts on/i);
    await user.clear(date);
    await user.type(date, '2026-10-01');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.supersedeScale).toHaveBeenCalledTimes(1));
    expect(api.supersedeScale.mock.calls[0]).toEqual(['scale-1', { dailyQty: 500, effectiveFrom: '2026-10-01' }]);
    expect(api.updateScale).not.toHaveBeenCalled();
  });

  it('warns, when retiring a scale, that the pool stops applying to that preference', async () => {
    const user = userEvent.setup();
    api.setScaleActive.mockResolvedValue({ ...SCALE, isActive: false });
    renderPage(<ScalesPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /retire/i }));
    expect(await screen.findByText(/no longer applies to NV/i)).toBeInTheDocument();
  });

  it('sends a negative quantity to the server rather than silently correcting it', async () => {
    const user = userEvent.setup();
    api.updateScale.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'dailyQty cannot be negative.',
        details: { reason: 'NEGATIVE_ENTITLEMENT', field: 'dailyQty' },
      })
    );
    renderPage(<ScalesPage />);
    const row = await screen.findByRole('row', { name: /Cereals/ });

    await user.click(within(row).getByRole('button', { name: /correct/i }));
    const input = screen.getByLabelText(/daily quantity for Cereals NV/i);
    await user.clear(input);
    await user.type(input, '-5');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // The screen does not decide this is wrong — the server does.
    await waitFor(() => expect(api.updateScale).toHaveBeenCalledWith('scale-1', { dailyQty: -5 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dailyQty cannot be negative.');
  });
});

// ===================================================================
describe('ConversionsPage', () => {
  it('distinguishes an automatic conversion from one the officer chooses', async () => {
    renderPage(<ConversionsPage />);
    const row = await screen.findByRole('row', { name: /MEAT_TO_MILK_PV/ });
    expect(within(row).getByText('Automatic')).toBeInTheDocument();
    expect(within(row).getByText(/260\.0000 → 500\.0000/)).toBeInTheDocument();
    expect(within(row).getByText('PV')).toBeInTheDocument();
  });

  it('sends both quantities as a rate, never a single computed factor', async () => {
    const user = userEvent.setup();
    api.createConversion.mockResolvedValue(CONVERSION);
    renderPage(<ConversionsPage />);
    await screen.findByRole('row', { name: /MEAT_TO_MILK_PV/ });

    await user.click(screen.getByRole('button', { name: /add a conversion/i }));
    await user.type(screen.getByLabelText(/^Code/), 'EGGS_TO_MILK_EV');
    await user.selectOptions(screen.getByLabelText(/surrendered from/i), 'pool-1');
    await user.selectOptions(screen.getByLabelText(/received as/i), 'pool-2');
    await user.type(screen.getByLabelText(/quantity surrendered/i), '2');
    await user.type(screen.getByLabelText(/quantity received/i), '250');
    await user.click(screen.getByRole('button', { name: /add conversion/i }));

    await waitFor(() => expect(api.createConversion).toHaveBeenCalledTimes(1));
    expect(api.createConversion.mock.calls[0][0]).toMatchObject({
      code: 'EGGS_TO_MILK_EV',
      fromPoolId: 'pool-1',
      toPoolId: 'pool-2',
      fromQty: 2,
      toQty: 250,
      mode: 'ELECTIVE',
    });
  });

  it('treats a blank dietary preference as every preference, not as a missing value', async () => {
    const user = userEvent.setup();
    api.createConversion.mockResolvedValue(CONVERSION);
    renderPage(<ConversionsPage />);
    await screen.findByRole('row', { name: /MEAT_TO_MILK_PV/ });

    await user.click(screen.getByRole('button', { name: /add a conversion/i }));
    await user.type(screen.getByLabelText(/^Code/), 'ANY');
    await user.selectOptions(screen.getByLabelText(/surrendered from/i), 'pool-1');
    await user.selectOptions(screen.getByLabelText(/received as/i), 'pool-2');
    await user.type(screen.getByLabelText(/quantity surrendered/i), '1');
    await user.type(screen.getByLabelText(/quantity received/i), '1');
    await user.click(screen.getByRole('button', { name: /add conversion/i }));

    await waitFor(() => expect(api.createConversion).toHaveBeenCalledTimes(1));
    expect(api.createConversion.mock.calls[0][0].dietaryPreference).toBeNull();
  });
});

// ===================================================================
describe('ProvisionsPage (SKU master)', () => {
  it('shows the consumption ratio exactly as stored', async () => {
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    expect(within(row).getByText('4.500000')).toBeInTheDocument();
  });

  it('moves a provision to another pool without touching anything else', async () => {
    const user = userEvent.setup();
    api.fetchPoolsForProvisions.mockResolvedValue({ items: [POOL, RETIRED_POOL] });
    api.updateProvision.mockResolvedValue(PROVISION);
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });

    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    await user.selectOptions(screen.getByLabelText(/pool for PIZZA_BASE/i), 'pool-2');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updateProvision).toHaveBeenCalledTimes(1));
    expect(api.updateProvision.mock.calls[0]).toEqual([
      'prov-1',
      {
        consumptionRatio: 4.5,
        poolId: 'pool-2',
        name: 'Pizza base',
        brand: null,
        packUnit: null,
        imageRef: null,
      },
    ]);
  });

  /**
   * STEP 12A §9 — the catalogue is managed from the dashboard. An
   * administrator records the brand, the container and the picture
   * without anyone opening a database client, and the brand stays out
   * of the name while doing it.
   */
  it('records a brand, a pack unit and a picture without the brand entering the name', async () => {
    const user = userEvent.setup();
    api.fetchProvisions.mockResolvedValue({ items: [{ ...PROVISION, code: 'CH_PANEER', name: 'Paneer' }] });
    api.updateProvision.mockResolvedValue({ ...PROVISION, name: 'Paneer', brand: 'Amul' });
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Paneer/ });

    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    await user.type(screen.getByLabelText(/brand for CH_PANEER/i), 'Amul');
    await user.selectOptions(screen.getByLabelText(/pack unit for CH_PANEER/i), 'packet');
    await user.type(screen.getByLabelText(/image reference for CH_PANEER/i), 'rik/catalogue/paneer.jpg');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updateProvision).toHaveBeenCalledTimes(1));
    const [, patch] = api.updateProvision.mock.calls[0];
    expect(patch).toMatchObject({
      name: 'Paneer',
      brand: 'Amul',
      packUnit: 'packet',
      imageRef: 'rik/catalogue/paneer.jpg',
    });
    // The brand went to its own field; the name is still just the item.
    expect(patch.name).not.toMatch(/amul/i);
  });

  it('shows the brand as a column of its own, and says so where there is none', async () => {
    api.fetchProvisions.mockResolvedValue({
      items: [
        { ...PROVISION, id: 'p-a', code: 'CH_PANEER_A', name: 'Paneer', brand: 'Amul' },
        { ...PROVISION, id: 'p-b', code: 'CH_PANEER_B', name: 'Paneer', brand: null },
      ],
    });
    renderPage(<ProvisionsPage />);
    const rows = await screen.findAllByRole('row', { name: /Paneer/ });
    // One item name, two rows, told apart by the brand column — not by
    // two different names carrying the brand inside them.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Amul')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Unbranded')).toBeInTheDocument();
  });
});

// ===================================================================
/**
 * Attaching a photograph to a provision.
 *
 * WHAT THESE TESTS ARE FOR. The screen must not send a file until the
 * administrator has seen it and pressed Save, and must not delete a picture
 * without asking. Those two are the whole reason this control exists rather
 * than the PIF one, which uploads on the `change` event — so they are
 * asserted rather than assumed.
 *
 * The file's real validation is the server's, by magic bytes; the browser
 * check asserted here only spares an administrator a pointless upload.
 */
describe('ProvisionsPage — provision pictures', () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'rice.png', { type: 'image/png' });

  it('offers an upload control for a provision, with the formats and the limit stated', async () => {
    const user = userEvent.setup();
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    expect(screen.getByLabelText(/choose a picture for PIZZA_BASE/i)).toBeInTheDocument();
    expect(screen.getByText(/PNG, JPEG or WebP, up to 2\.0 MB/i)).toBeInTheDocument();
  });

  it('shows the chosen file and sends NOTHING until Save is pressed', async () => {
    const user = userEvent.setup();
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    await user.upload(screen.getByLabelText(/choose a picture for PIZZA_BASE/i), png());

    // Seen, not sent. This is the defect the PIF screen has.
    expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument();
    expect(api.uploadProvisionImage).not.toHaveBeenCalled();

    api.uploadProvisionImage.mockResolvedValue({
      id: 'prov-1',
      code: 'PIZZA_BASE',
      imageRef: 'rik/provisions/11111111-1111-4111-8111-111111111111.png',
      imageUrl: '/rik/media/rik/provisions/11111111-1111-4111-8111-111111111111.png',
      bytes: 4096,
      contentType: 'image/png',
    });
    await user.click(screen.getByRole('button', { name: /save image/i }));

    await waitFor(() => expect(api.uploadProvisionImage).toHaveBeenCalledTimes(1));
    expect(api.uploadProvisionImage.mock.calls[0][0]).toBe('prov-1');
    expect((api.uploadProvisionImage.mock.calls[0][1] as File).name).toBe('rice.png');
  });

  it('discards a chosen file without sending it', async () => {
    const user = userEvent.setup();
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    await user.upload(screen.getByLabelText(/choose a picture for PIZZA_BASE/i), png());
    await user.click(await screen.findByRole('button', { name: /discard/i }));

    expect(screen.queryByText(/not saved yet/i)).not.toBeInTheDocument();
    expect(api.uploadProvisionImage).not.toHaveBeenCalled();
  });

  it('refuses a file that is not an image, in the browser, without uploading it', async () => {
    const user = userEvent.setup();
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    const txt = new File(['not a picture'], 'notes.txt', { type: 'text/plain' });
    // fireEvent rather than user.upload, because user.upload honours the
    // input's own `accept` attribute and drops the file before the control
    // ever sees it. That attribute is what filters the OS dialog — and
    // choosing "All files" in that dialog is exactly the case this guard is
    // for, so the test has to deliver the file the way the browser then does.
    fireEvent.change(screen.getByLabelText(/choose a picture for PIZZA_BASE/i), { target: { files: [txt] } });

    expect(await screen.findByText(/not a PNG, JPEG or WebP image/i)).toBeInTheDocument();
    expect(api.uploadProvisionImage).not.toHaveBeenCalled();
  });

  it('asks before removing a picture, and only then removes it', async () => {
    const user = userEvent.setup();
    api.fetchProvisions.mockResolvedValue({
      items: [
        {
          ...PROVISION,
          imageRef: 'rik/provisions/22222222-2222-4222-8222-222222222222.png',
          imageUrl: '/rik/media/rik/provisions/22222222-2222-4222-8222-222222222222.png',
        },
      ],
    });
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    await user.click(screen.getByRole('button', { name: /remove the picture for PIZZA_BASE/i }));
    // Asked, not done.
    expect(api.removeProvisionImage).not.toHaveBeenCalled();

    api.removeProvisionImage.mockResolvedValue({ id: 'prov-1', code: 'PIZZA_BASE', imageRef: null, imageUrl: null });
    await user.click(screen.getByRole('button', { name: /yes, remove it/i }));
    await waitFor(() => expect(api.removeProvisionImage).toHaveBeenCalledWith('prov-1'));
  });

  it('offers no Remove where there is no picture to remove', async () => {
    const user = userEvent.setup();
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    await user.click(within(row).getByRole('button', { name: /^edit$/i }));

    expect(screen.queryByRole('button', { name: /remove the picture/i })).not.toBeInTheDocument();
  });

  it('says a committed catalogue picture lives in the app bundle rather than showing a broken image', async () => {
    // The 180 existing provision pictures are files in the customer app's
    // own bundle. This origin cannot serve them, so the honest thing is to
    // say so — not to point an <img> at a URL that 404s.
    api.fetchProvisions.mockResolvedValue({
      items: [
        {
          ...PROVISION,
          imageRef: '/catalogue/rik/dry/cereals/rice.png',
          imageUrl: '/catalogue/rik/dry/cereals/rice.png',
        },
      ],
    });
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    expect(within(row).getByRole('img', { name: 'In bundle' })).toBeInTheDocument();
  });

  it('shows a thumbnail in the table for an uploaded picture', async () => {
    api.fetchProvisions.mockResolvedValue({
      items: [
        {
          ...PROVISION,
          imageRef: 'rik/provisions/33333333-3333-4333-8333-333333333333.png',
          imageUrl: '/rik/media/rik/provisions/33333333-3333-4333-8333-333333333333.png',
        },
      ],
    });
    renderPage(<ProvisionsPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    const image = within(row).getByRole('img', { name: /picture for Pizza base/i });
    expect(image).toHaveAttribute(
      'src',
      expect.stringContaining('/rik/media/rik/provisions/33333333-3333-4333-8333-333333333333.png')
    );
  });
});

// ===================================================================
describe('PackSizesPage', () => {
  it('says plainly that a pack size is not an entitlement', async () => {
    renderPage(<PackSizesPage />);
    await screen.findByRole('row', { name: /Pizza base/ });
    expect(screen.getByText(/a pack size is not an entitlement/i)).toBeInTheDocument();
  });

  it('shows "no cap" where a limit is absent, rather than a zero', async () => {
    renderPage(<PackSizesPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    expect(within(row).getAllByText('No cap').length).toBeGreaterThan(0);
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
  });

  it('clears a limit by sending null when the box is emptied', async () => {
    const user = userEvent.setup();
    api.fetchProvisions.mockResolvedValue({ items: [{ ...PROVISION, maxPacks: 3 }] });
    api.updateProvision.mockResolvedValue(PROVISION);
    renderPage(<PackSizesPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });

    await user.click(within(row).getByRole('button', { name: /^edit$/i }));
    await user.clear(screen.getByLabelText(/max packs for PIZZA_BASE/i));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.updateProvision).toHaveBeenCalledTimes(1));
    expect(api.updateProvision.mock.calls[0][1]).toMatchObject({ maxPacks: null, packSize: 500 });
  });
});

// ===================================================================
describe('AvailabilityPage', () => {
  it('shows the pool’s ration type beside the issue day, so a difference is visible', async () => {
    renderPage(<AvailabilityPage />);
    const row = await screen.findByRole('row', { name: /Sandwich bread/ });
    expect(within(row).getByText(/differs from the pool/i)).toBeInTheDocument();
  });

  it('flags no difference where the issue day matches the pool', async () => {
    renderPage(<AvailabilityPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });
    expect(within(row).queryByText(/differs from the pool/i)).not.toBeInTheDocument();
  });

  it('hides an item from officers without deleting or retiring it', async () => {
    const user = userEvent.setup();
    api.updateProvision.mockResolvedValue({ ...PROVISION, isCustomerSelectable: false });
    renderPage(<AvailabilityPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });

    await user.click(within(row).getByLabelText(/officer selectable: Pizza base/i));
    await waitFor(() =>
      expect(api.updateProvision).toHaveBeenCalledWith('prov-1', { isCustomerSelectable: false })
    );
    expect(api.setProvisionActive).not.toHaveBeenCalled();
  });

  it('changes the issue day independently of the pool', async () => {
    const user = userEvent.setup();
    api.updateProvision.mockResolvedValue({ ...PROVISION, issuePeriod: 'FRESH' });
    renderPage(<AvailabilityPage />);
    const row = await screen.findByRole('row', { name: /Pizza base/ });

    await user.selectOptions(within(row).getByLabelText(/issue period for PIZZA_BASE/i), 'FRESH');
    await waitFor(() => expect(api.updateProvision).toHaveBeenCalledWith('prov-1', { issuePeriod: 'FRESH' }));
  });
});

// ===================================================================
describe('RuleHistoryPage', () => {
  it('shows who changed what, and highlights the value that moved', async () => {
    renderPage(<RuleHistoryPage />);
    const row = await screen.findByRole('row', { name: /A\. Administrator/ });
    expect(within(row).getByText('Daily scale changed')).toBeInTheDocument();
    expect(within(row).getByText('RIK_ADMIN')).toBeInTheDocument();
    expect(within(row).getByText('450.0000')).toBeInTheDocument();
    expect(within(row).getByText('500.0000')).toBeInTheDocument();
  });

  it('labels a creation as such rather than showing an empty "before"', async () => {
    api.fetchHistory.mockResolvedValue({
      items: [{ ...HISTORY, id: 'audit-2', action: 'RIK_CONFIG_POOL_CREATED', before: null }],
    });
    renderPage(<RuleHistoryPage />);
    const row = await screen.findByRole('row', { name: /A\. Administrator/ });
    expect(within(row).getByText('Created')).toBeInTheDocument();
  });

  it('asks the server for one configuration table when the filter is narrowed', async () => {
    const user = userEvent.setup();
    renderPage(<RuleHistoryPage />);
    await screen.findByRole('row', { name: /A\. Administrator/ });

    await user.selectOptions(screen.getByLabelText(/^Show/), 'rik.provisions');
    await waitFor(() =>
      expect(api.fetchHistory).toHaveBeenLastCalledWith({ entityType: 'rik.provisions', limit: 200 })
    );
  });

  it('shows an honest empty state before anything has been changed', async () => {
    api.fetchHistory.mockResolvedValue({ items: [] });
    renderPage(<RuleHistoryPage />);
    expect(await screen.findByText(/no configuration changes recorded yet/i)).toBeInTheDocument();
  });
});
