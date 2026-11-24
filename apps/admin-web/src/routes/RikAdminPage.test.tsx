import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RikAdminPage } from './RikAdminPage';
import { PifAdminPage } from './PifAdminPage';
import type { StaffSession } from '../lib/api/admin-api';
import { rikAdmin, pifAdmin, pifCashier, superAdmin } from '../test/staff-session';

let current: StaffSession | null = null;

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ status: 'authenticated', session: current, login: vi.fn(), logout: vi.fn(), can: () => false, hasRole: () => false }),
}));

function renderRik(session: StaffSession) {
  current = session;
  return render(
    <MemoryRouter>
      <RikAdminPage />
    </MemoryRouter>
  );
}

function renderPif(session: StaffSession) {
  current = session;
  return render(
    <MemoryRouter>
      <PifAdminPage />
    </MemoryRouter>
  );
}

/**
 * The central guarantee of these two screens: the structure of the
 * product is visible, but no unconfirmed business rule is invented.
 * These patterns catch a regression that reintroduced a plausible-looking
 * quantity, ratio, price or delivery rule.
 */
const FABRICATION_PATTERNS: readonly RegExp[] = [
  /\b\d+(\.\d+)?\s?(kg|kgs|kilogram|g\b|gram|litre|liter|l\b|ml)\b/i, // an entitlement quantity
  /\b₹\s?\d/, // a price
  /\b\d+\s?:\s?\d+\b/, // a conversion / substitution ratio
  /\b\d{1,2}\s?(am|pm)\b/i, // a collection or delivery timing
  /minimum order (of|is) /i,
  /delivery charge (of|is) /i,
];

function expectNoFabricatedRules() {
  const text = document.body.textContent ?? '';
  for (const pattern of FABRICATION_PATTERNS) {
    expect(text, `screen must not state a value matching ${pattern}`).not.toMatch(pattern);
  }
}

describe('RikAdminPage (STEP 10 Section 5)', () => {
  it('offers entitlement configuration as a real area, and still states the unresolved ones as pending', () => {
    renderRik(rikAdmin());
    // STEP 11C built this: it is a link to a working screen now, not a
    // pending note. The quantities and ratios live in the database, so
    // this page states none of them — it never did and still must not.
    const config = screen.getByRole('link', { name: /entitlement configuration/i });
    expect(config).toHaveAttribute('href', '/rik/config');

    // Pickup and delivery remain genuinely undecided (BD-4/BD-5) and
    // must still say so rather than show a location or a window.
    expect(screen.getAllByText(/pending confirmation by the facility/i).length).toBeGreaterThanOrEqual(1);
    expectNoFabricatedRules();
  });

  it('links the SKU, pack-size and availability screens for a role holding rik.product.manage', () => {
    renderRik(rikAdmin());
    expect(screen.getByRole('link', { name: /provisions, pack sizes and availability/i })).toHaveAttribute(
      'href',
      '/rik/config/provisions'
    );
  });

  it('does not claim a substitution, pooling or NOT_COLLECTED behaviour exists', () => {
    renderRik(rikAdmin());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/NOT_COLLECTED (means|results in|forfeits|carries)/i);
    expect(text).not.toMatch(/(can|may) be pooled/i);
    expect(text).not.toMatch(/substituted (at|for) /i);
    expectNoFabricatedRules();
  });

  /**
   * REVERSED ON PURPOSE. This asserted that a RIK_ADMIN was offered a link
   * to Issue schedules. That tile was removed: the table is empty and its
   * repository has no write path, so the link could only ever lead to an
   * empty page.
   *
   * The test is kept rather than deleted, pointing the other way, so that
   * putting the tile back is a deliberate act that fails a test first.
   */
  it('does not offer Issue schedules, which is not a built feature', () => {
    renderRik(rikAdmin());
    expect(screen.queryByRole('link', { name: /issue schedules/i })).not.toBeInTheDocument();
  });

  /**
   * THE GUARD THAT MATTERS. Issue WINDOWS is governed by the very same
   * permission the removed tile used, `rik.issue_schedule.manage`. If a
   * future tidy-up removes that permission because "issue schedules is
   * gone", Issue windows disappears from the sidebar for an administrator
   * who holds nothing else — silently. This fails if that happens.
   */
  it('still grants the permission that Issue windows depends on', () => {
    expect(rikAdmin().permissions).toContain('rik.issue_schedule.manage');
  });

  it('tells a PIF_ADMIN plainly that no RIK administration is assigned to it', () => {
    renderRik(pifAdmin());
    expect(screen.getByText(/no rik administration is assigned to you/i)).toBeInTheDocument();
    expect(screen.queryByText('Entitlement configuration')).not.toBeInTheDocument();
  });

  it('shows a cashier no RIK administrative area at all', () => {
    renderRik(pifCashier());
    expect(screen.getByText(/no rik administration is assigned to you/i)).toBeInTheDocument();
  });

  it('shows a SUPER_ADMIN the RIK areas, because PHASE F granted it the rik.* codes explicitly', () => {
    // This is the resolution of STEP 10's FINDING F-2. Until migration 0050
    // the seed gave SUPER_ADMIN no rik.* permission and this screen honestly
    // showed it nothing; the Phase F authorization requires the overall
    // administrator to reach both modules, so the grant was added as rows
    // and the screen now follows the grant — as it always did.
    renderRik(superAdmin());
    expect(screen.queryByText(/no rik administration is assigned to you/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /entitlement configuration/i })).toBeInTheDocument();
    expectNoFabricatedRules();
  });
});

describe('PifAdminPage (PHASE F — the corrected PIF scope)', () => {
  it('links the four PIF areas that exist, for a PIF administrator', () => {
    renderPif(pifAdmin());
    expect(screen.getByRole('link', { name: /PIF dashboard/i })).toHaveAttribute('href', '/pif/dashboard');
    expect(screen.getByRole('link', { name: /^Orders/i })).toHaveAttribute('href', '/pif/orders');
    expect(screen.getByRole('link', { name: /Product categories/i })).toHaveAttribute('href', '/pif/categories');
    expect(screen.getByRole('link', { name: /Product catalogue/i })).toHaveAttribute('href', '/pif/products');
    expectNoFabricatedRules();
  });

  it('advertises NO point of sale, purchasing, inventory or billing — the superseded scope is gone', () => {
    // The three removed areas were not merely relabelled "not built yet":
    // listing a module the product will never contain is misleading even
    // when every tile says so.
    renderPif(pifAdmin());
    const text = document.body.textContent ?? '';
    expect(screen.queryByRole('link', { name: /point of sale/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /purchase orders/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /inventory/i })).not.toBeInTheDocument();
    expect(text).toMatch(/no point of sale, no billing/i);
    expect(text).toMatch(/billing software raises the bill/i);
  });

  it('says plainly that availability is a switch, not a stock count', () => {
    renderPif(pifAdmin());
    expect(document.body.textContent ?? '').toMatch(/not a counted balance/i);
  });

  it('shows a SUPER_ADMIN the PIF areas, because PHASE F granted it the pif.* codes explicitly', () => {
    renderPif(superAdmin());
    expect(screen.queryByText(/nothing here is yours/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Product catalogue/i })).toBeInTheDocument();
  });

  it('shows the order desk to a PIF_CASHIER and withholds the catalogue', () => {
    // PIF_CASHIER holds pif.order.prepare and no catalogue code, so it sees
    // the orders it works and neither the products nor the categories.
    renderPif(pifCashier());
    expect(screen.getByRole('link', { name: /^Orders/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Product catalogue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Product categories/i })).not.toBeInTheDocument();
  });

  it('tells a RIK_ADMIN plainly that it holds no PIF permission', () => {
    renderPif(rikAdmin());
    expect(screen.getByText(/nothing here is yours/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Product catalogue/i })).not.toBeInTheDocument();
  });
});
