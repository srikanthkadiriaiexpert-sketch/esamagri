import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import type { DashboardTile, StaffSession } from '../lib/api/admin-api';
import { ApiError } from '../lib/api/client';
import { rikAdmin, noRoleStaff } from '../test/staff-session';

let current: StaffSession | null = null;

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ status: 'authenticated', session: current, login: vi.fn(), logout: vi.fn(), can: () => false, hasRole: () => false }),
}));

const fetchDashboard = vi.fn<[], Promise<{ tiles: DashboardTile[] }>>();
vi.mock('../lib/api/admin-api', () => ({
  fetchDashboard: (...args: []) => fetchDashboard(...args),
}));

function renderDashboard(session: StaffSession | null = rikAdmin()) {
  current = session;
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchDashboard.mockReset();
});

describe('DashboardPage (STEP 10 Section 4)', () => {
  it('shows a loading state before any data arrives', () => {
    fetchDashboard.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    expect(screen.getByRole('status')).toHaveTextContent(/loading dashboard/i);
  });

  it('shows only the real figure the server queried for an available tile', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'published-announcements', label: 'Published announcements', module: 'shared', status: 'available', value: 3 }],
    });
    renderDashboard();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('Published announcements')).toBeInTheDocument();
  });

  it('renders an unavailable tile as a stated reason and never as a number', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [
        {
          key: 'rik-entitlements',
          label: 'Entitlements allocated',
          module: 'rik',
          status: 'unavailable',
          reason: 'The entitlement scale is pending confirmation by the facility.',
        },
      ],
    });
    renderDashboard();
    expect(await screen.findByText(/pending confirmation by the facility/i)).toBeInTheDocument();
    // No digits anywhere in the tile: an unavailable metric must not be
    // rendered as 0, "—0", or any other number a reader could mistake for data.
    const tile = screen.getByText('Entitlements allocated').closest('div')!.parentElement!;
    expect(tile.textContent ?? '').not.toMatch(/\d/);
  });

  it('tells a staff member with no permissions the honest truth instead of an empty grid', async () => {
    fetchDashboard.mockResolvedValue({ tiles: [] });
    renderDashboard(noRoleStaff());
    expect(await screen.findByText(/nothing is assigned to you yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no permissions granted/i)).toBeInTheDocument();
  });

  it('surfaces a 403 as an explicit unauthorized state, not as empty data', async () => {
    fetchDashboard.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    renderDashboard();
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
  });

  it('surfaces a 401 as a session expiry, distinct from a permission problem', async () => {
    fetchDashboard.mockRejectedValue(new ApiError(401, { code: 'UNAUTHENTICATED', message: 'Unauthorized' }));
    renderDashboard();
    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument();
  });

  it('never leaks raw server error text to the screen', async () => {
    fetchDashboard.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL', message: 'relation "rik.entitlements" does not exist at character 42' })
    );
    renderDashboard();
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('does not exist at character');
  });

  it('identifies who is signed in, from the server-resolved session', async () => {
    fetchDashboard.mockResolvedValue({ tiles: [] });
    renderDashboard(rikAdmin());
    expect(await screen.findByText(/Test RIK_ADMIN · RIK_ADMIN/)).toBeInTheDocument();
  });
});

/**
 * Tiles that lead somewhere, and tiles that deliberately do not.
 *
 * The rule under test: a tile is a LINK only when it is available AND
 * its key appears in TILE_ROUTES. Everything else is an inert card. The
 * default is inert, so a tile added later cannot arrive clickable by
 * accident.
 */
describe('DashboardPage — clickable tiles', () => {
  const linked: ReadonlyArray<[string, string, string]> = [
    ['announcements', 'Announcements', '/announcements'],
    ['rik-issue-windows', 'Active issue windows', '/rik/issue-windows'],
    ['rik-entitlements', 'RIK entitlement configuration', '/rik/config'],
    ['rik-issue-vouchers', 'RIK issue vouchers', '/rik/issue-vouchers'],
    ['rik-provisions', 'RIK provisions', '/rik/config/provisions'],
    ['pif-products', 'PIF products', '/pif/products'],
  ];

  it.each(linked)('tile %s is a real link to %s', async (key, label, href) => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key, label, module: 'rik', status: 'available' }],
    });
    renderDashboard();

    const link = await screen.findByRole('link', { name: new RegExp(label, 'i') });
    expect(link).toHaveAttribute('href', href);
  });

  it('renders an anchor, not a clickable div — so Tab and Enter work', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'pif-products', label: 'PIF products', module: 'pif', status: 'available' }],
    });
    renderDashboard();

    const link = await screen.findByRole('link', { name: /pif products/i });
    expect(link.tagName).toBe('A');
    // A visible focus ring, not a suppressed one.
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.className).toContain('cursor-pointer');
  });

  it('shows "Open" instead of a number on a built screen that counts nothing', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'rik-provisions', label: 'RIK provisions', module: 'rik', status: 'available' }],
    });
    renderDashboard();

    expect(await screen.findByText(/open/i)).toBeInTheDocument();
    // And emphatically not a fabricated figure.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('still shows the real figure when the server queried one', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'rik-issue-windows', label: 'Active issue windows', module: 'rik', status: 'available', value: 4 }],
    });
    renderDashboard();

    expect(await screen.findByText('4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /active issue windows/i })).toHaveAttribute(
      'href',
      '/rik/issue-windows'
    );
  });

  it('leaves PIF reports unclickable, with the reason the server gave', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'pif-reports', label: 'PIF reports', module: 'pif', status: 'unavailable', reason: 'PIF reporting has not been built yet.' }],
    });
    renderDashboard();

    expect(await screen.findByText(/has not been built yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /pif reports/i })).not.toBeInTheDocument();
  });

  it('never links an unavailable tile, even one whose key has a route', async () => {
    // The guard that matters: status decides first, the map second.
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'rik-issue-windows', label: 'Active issue windows', module: 'rik', status: 'unavailable', reason: 'No entitlement period is open today, so no issue windows are in force.' }],
    });
    renderDashboard();

    expect(await screen.findByText(/no entitlement period is open today/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /active issue windows/i })).not.toBeInTheDocument();
  });

  it('does not offer the retired Issue schedules tile a link', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'rik-issue-schedules', label: 'RIK issue schedules', module: 'rik', status: 'available', value: 0 }],
    });
    renderDashboard();

    expect(await screen.findByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /issue schedules/i })).not.toBeInTheDocument();
  });
});

describe('DashboardPage — responsive grid', () => {
  it('is one column, then two, then three from lg', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'pif-products', label: 'PIF products', module: 'pif', status: 'available' }],
    });
    renderDashboard();

    const list = await screen.findByRole('list');
    expect(list.className).toContain('grid-cols-1');
    expect(list.className).toContain('sm:grid-cols-2');
    expect(list.className).toContain('lg:grid-cols-3');
    // xl held two wide columns on screens that take three.
    expect(list.className).not.toContain('xl:grid-cols-3');
  });

  it('gives every grid item min-w-0 so a long label cannot widen the row', async () => {
    fetchDashboard.mockResolvedValue({
      tiles: [{ key: 'pif-products', label: 'PIF products', module: 'pif', status: 'available' }],
    });
    renderDashboard();

    const item = (await screen.findByRole('list')).querySelector('li');
    expect(item?.className).toContain('min-w-0');
  });
});
