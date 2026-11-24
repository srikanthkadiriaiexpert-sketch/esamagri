import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import type { StaffSession } from '../lib/api/admin-api';
import { rikAdmin, pifAdmin, pifCashier, rikPickupStaff, superAdmin, noRoleStaff } from '../test/staff-session';

let current: StaffSession | null = null;
const logout = vi.fn(async () => {});

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({
    status: 'authenticated',
    session: current,
    login: vi.fn(),
    logout,
    can: (p: string) => current?.permissions.includes(p) ?? false,
    hasRole: (r: string) => current?.roles.includes(r) ?? false,
  }),
}));

function renderShell(session: StaffSession | null, path = '/') {
  current = session;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route index element={<p>dashboard body</p>} />
          <Route path="/announcements" element={<p>announcements body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  logout.mockClear();
  current = null;
});

describe('AdminLayout — application shell (STEP 10 Section 3)', () => {
  it('shows the staff identity and role, and never a credential or token', () => {
    renderShell(rikAdmin());
    expect(screen.getByText('Test RIK_ADMIN')).toBeInTheDocument();
    expect(screen.getByText('RIK_ADMIN')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/password|totp|secret|bearer|token/i);
  });

  it('renders the routed module content inside the shell', () => {
    renderShell(rikAdmin());
    expect(screen.getByText('dashboard body')).toBeInTheDocument();
  });

  it('offers logout and calls the real logout path', async () => {
    renderShell(rikAdmin());
    await userEvent.click(screen.getAllByRole('button', { name: /log out/i })[0]!);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('says plainly when no role is assigned rather than inventing one', () => {
    renderShell(noRoleStaff());
    expect(screen.getByText(/no role assigned/i)).toBeInTheDocument();
  });
});

describe('AdminLayout — role-aware navigation (usability filter, not the boundary)', () => {
  /**
   * THESE TWO TESTS CHANGED SUBJECT, NOT PURPOSE.
   *
   * They were written around "Issue schedules" because that was the entry
   * governed by `rik.issue_schedule.manage`, and what they were really
   * proving is that the sidebar follows the GRANT. "Issue schedules" has
   * been removed from the navigation — the table is empty and its
   * repository has no write path — so the pair now proves the same thing
   * through ISSUE WINDOWS, which is governed by that very same permission
   * and is a built, working screen.
   *
   * That substitution is the point. `rik.issue_schedule.manage` is still
   * load-bearing, and if anyone removes it believing it belonged to the
   * screen that went away, Issue windows disappears for a RIK_ADMIN and
   * these tests fail.
   */
  it('shows a RIK_ADMIN the entry its rik.issue_schedule.manage grant governs', () => {
    renderShell(rikAdmin());
    expect(screen.getByRole('link', { name: 'Issue windows' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Announcements' })).toBeInTheDocument();
  });

  it('does not offer Issue schedules to anyone — it is not a built feature', () => {
    renderShell(rikAdmin());
    expect(screen.queryByRole('link', { name: 'Issue schedules' })).not.toBeInTheDocument();
  });

  it('offers Incoming requests to a holder of rik.order.manage, beside Issue vouchers', () => {
    // PHASE B. The queue and the vouchers it feeds are governed by the SAME
    // code, so they appear and disappear together — if these ever diverge,
    // someone has given the queue a permission of its own and an
    // administrator can see work they cannot action.
    renderShell(rikAdmin());
    expect(screen.getByRole('link', { name: 'Incoming requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Issue vouchers' })).toBeInTheDocument();
  });

  it('hides Incoming requests from staff without rik.order.manage', () => {
    // It lists officers' names, mobile numbers and home addresses, so this
    // matters more than ordinary menu tidiness. RIK_PICKUP_STAFF holds
    // mark_ready and mark_collected and neither is this code.
    renderShell(rikPickupStaff());
    expect(screen.queryByRole('link', { name: 'Incoming requests' })).not.toBeInTheDocument();
    renderShell(pifCashier());
    expect(screen.queryByRole('link', { name: 'Incoming requests' })).not.toBeInTheDocument();
  });

  it('hides that same entry from a PIF_ADMIN, which does not hold the permission', () => {
    renderShell(pifAdmin());
    expect(screen.queryByRole('link', { name: 'Issue windows' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue schedules' })).not.toBeInTheDocument();
    // Announcements is shared: PIF_ADMIN does hold shared.announcement.manage.
    expect(screen.getByRole('link', { name: 'Announcements' })).toBeInTheDocument();
  });

  it('hides announcement administration from a cashier, which holds only POS permissions', () => {
    renderShell(pifCashier());
    expect(screen.queryByRole('link', { name: 'Announcements' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue windows' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue schedules' })).not.toBeInTheDocument();
  });

  it('shows a PIF staff member the PIF section and NO RIK section at all', () => {
    // PHASE F: the two modules are two headed sections, and a heading only
    // appears when the staff member can reach something inside it. A
    // PIF_CASHIER holds no rik.* code, so there is no RIK heading and no RIK
    // link — previously both modules' landing pages were shown to everyone.
    renderShell(pifCashier());
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByText('PIF Administration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PIF overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument();
    expect(screen.queryByText('RIK Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'RIK overview' })).not.toBeInTheDocument();
    // …and the catalogue, which needs pif.product.manage, is not offered.
    expect(screen.queryByRole('link', { name: 'Product catalogue' })).not.toBeInTheDocument();
  });

  it('shows a RIK administrator the RIK section and NO PIF section', () => {
    renderShell(rikAdmin());
    expect(screen.getByText('RIK Administration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Officers' })).toBeInTheDocument();
    expect(screen.queryByText('PIF Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PIF overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Product catalogue' })).not.toBeInTheDocument();
  });

  it('gives a SUPER_ADMIN both sections, because the seed now grants it both modules', () => {
    // STEP 10's FINDING F-2 resolved: migration 0050 granted SUPER_ADMIN
    // every rik.* and pif.* code that governs a built function, so the
    // shell — which has always followed the grant and nothing else — now
    // shows both headings. What it still does NOT show is a PIF
    // point-of-sale entry, because no such screen or grant exists.
    renderShell(superAdmin());
    for (const label of ['Dashboard', 'Announcements', 'Your account']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText('RIK Administration')).toBeInTheDocument();
    expect(screen.getByText('PIF Administration')).toBeInTheDocument();
    // Issue WINDOWS, for the reason given above: a SUPER_ADMIN holds every
    // code that governs a built function, and this is the RIK entry that
    // `rik.issue_schedule.manage` now governs.
    expect(screen.getByRole('link', { name: 'Issue windows' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Issue schedules' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Product catalogue' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /point of sale/i })).not.toBeInTheDocument();
  });

  it('hiding a navigation item does not remove the route — the server is the boundary', () => {
    // A PIF_ADMIN has no "Issue windows" link, yet navigating straight to a
    // route still renders it; what protects the data is the API's 403, not
    // this component. Proven here for /announcements, which is routable
    // regardless of what the navigation chose to show.
    renderShell(pifCashier(), '/announcements');
    expect(screen.getByText('announcements body')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Announcements' })).not.toBeInTheDocument();
  });
});

describe('AdminLayout — responsive behaviour', () => {
  it('has a navigation toggle for narrow screens with correct expanded state', async () => {
    renderShell(rikAdmin());
    const toggle = screen.getByRole('button', { name: /open navigation/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /close navigation/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('labels the navigation region for assistive technology', () => {
    renderShell(rikAdmin());
    expect(screen.getByRole('navigation', { name: /admin sections/i })).toBeInTheDocument();
  });
});
