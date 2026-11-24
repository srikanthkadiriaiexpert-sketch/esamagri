import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * ONE HOME SCREEN, FOR A RATION-APPROVED RESIDENT AND A PIF-ONLY ONE ALIKE.
 *
 * WHAT WENT WRONG, AND WHAT THIS GUARDS.
 *
 * `hideRik` was one flag doing two jobs. It hid the RIK module card, which is
 * right — that card leads somewhere a PIF-only resident cannot go. It also
 * hid the New Arrivals and Nutrition Info cards, for the incidental reason
 * that both navigated to a `/rik/...` path. So a PIF-only resident's home
 * screen rendered ONE card in a three-column grid, with the promotional
 * banners silently 403-ing above it, and a newly registered account looked
 * half-built.
 *
 * These tests pin the separation. They are the regression test for the whole
 * common-customer-experience change, which is why they assert the PIF-only
 * case positively — card by card — rather than only asserting that the RIK
 * card is gone. A test that checked just the absence would have passed
 * throughout the entire period the bug existed.
 *
 * `useRikVisibility` is mocked rather than driven through a session: the
 * question here is what the screen draws for each answer, and building a
 * session to ask it would make the test about authentication instead.
 */

const navigate = vi.fn();
const openDrawer = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useOutletContext: () => ({ openDrawer }),
  };
});

const rikVisibility = vi.fn<[], boolean | null>(() => null);

vi.mock('../lib/auth/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('../lib/auth/AuthContext')>(
    '../lib/auth/AuthContext'
  );
  return { ...actual, useRikVisibility: () => rikVisibility() };
});

// Imported after the mocks so the component picks them up.
const { HomePage } = await import('./HomePage');

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

/** The three cards that belong to every resident. */
const COMMON_CARDS = ['New Arrivals', 'Nutrition Info', 'Home Delivery'] as const;

beforeEach(() => {
  navigate.mockReset();
  rikVisibility.mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('a PIF-only resident gets the common home screen', () => {
  beforeEach(() => {
    // An explicit false: the server has said this resident is not approved
    // for rations.
    rikVisibility.mockReturnValue(false);
  });

  it('draws all three common feature cards', () => {
    renderHome();
    for (const label of COMMON_CARDS) {
      expect(screen.getAllByRole('button', { name: new RegExp(label, 'i') })).toHaveLength(1);
    }
  });

  it('still offers the PIF module', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /enter pif/i })).toBeInTheDocument();
  });

  it('does NOT offer the RIK module — the one thing that is withheld', () => {
    renderHome();
    expect(screen.queryByRole('button', { name: /enter rik/i })).not.toBeInTheDocument();
  });

  it('keeps the hero and the announcements section', () => {
    renderHome();
    expect(screen.getByRole('img', { name: /everyday essentials/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /announcements/i })).toBeInTheDocument();
  });

  it('reaches the common Nutrition Info page, not the RIK-guarded one', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Nutrition Info/i }));
    expect(navigate).toHaveBeenCalledWith('/nutrition');
  });

  it('reaches the common New Arrivals page, not the RIK-guarded one', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /New Arrivals/i }));
    expect(navigate).toHaveBeenCalledWith('/new-arrivals');
  });

  it('sends nobody to a `/rik/...` address from the feature cards', async () => {
    const user = userEvent.setup();
    renderHome();
    for (const label of COMMON_CARDS) {
      await user.click(screen.getByRole('button', { name: new RegExp(label, 'i') }));
    }
    for (const call of navigate.mock.calls) {
      expect(String(call[0])).not.toMatch(/^\/rik/);
    }
  });

  it('no longer describes the common pages as RIK-only content', () => {
    const { container } = renderHome();
    // The New Arrivals subtitle used to read "RIK products", which is no
    // longer true of a page every resident can open.
    expect(container.textContent ?? '').not.toMatch(/RIK products/i);
  });
});

describe('a ration-approved resident gets the same screen plus RIK', () => {
  beforeEach(() => {
    rikVisibility.mockReturnValue(true);
  });

  it('draws the same three common cards', () => {
    renderHome();
    for (const label of COMMON_CARDS) {
      expect(screen.getAllByRole('button', { name: new RegExp(label, 'i') })).toHaveLength(1);
    }
  });

  it('offers both modules', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /enter rik/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter pif/i })).toBeInTheDocument();
  });
});

describe('an unknown answer shows RIK, and never hides common content', () => {
  it('offers the RIK module while the profile call is still in flight', () => {
    // null is "not yet known". Hiding the module from an officer would look
    // like their ration had disappeared, and the server refuses every RIK
    // endpoint either way — so the optimistic answer costs nothing.
    rikVisibility.mockReturnValue(null);
    renderHome();
    expect(screen.getByRole('button', { name: /enter rik/i })).toBeInTheDocument();
  });

  it('draws the common cards for every possible answer', () => {
    for (const answer of [true, false, null] as const) {
      rikVisibility.mockReturnValue(answer);
      const { unmount } = renderHome();
      for (const label of COMMON_CARDS) {
        expect(screen.getAllByRole('button', { name: new RegExp(label, 'i') })).toHaveLength(1);
      }
      unmount();
    }
  });
});
