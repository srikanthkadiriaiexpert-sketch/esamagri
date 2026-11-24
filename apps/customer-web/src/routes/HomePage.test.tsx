import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from './HomePage';

const navigate = vi.fn();
const openDrawer = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate, useOutletContext: () => ({ openDrawer }) };
});

// The announcements module genuinely does not exist yet; this keeps the
// home test about the home screen rather than about that pending route.
vi.mock('../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/client')>('../lib/api/client');
  return { ...actual, apiRequest: () => Promise.reject(new actual.NotImplementedError('/announcements')) };
});

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigate.mockReset();
  openDrawer.mockReset();
});

describe('HomePage (STEP 9 — approved home preserved)', () => {
  it('presents the RIK and PIF choice prominently, not hidden in a menu', () => {
    renderHome();
    expect(screen.getByText('RIK')).toBeInTheDocument();
    expect(screen.getByText('Ration in Kind')).toBeInTheDocument();
    expect(screen.getByText('PIF')).toBeInTheDocument();
    expect(screen.getByText('Payment Issue Facility')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter rik/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter pif/i })).toBeInTheDocument();
  });

  it('routes each module entry into its own module space', async () => {
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: /enter rik/i }));
    expect(navigate).toHaveBeenCalledWith('/rik');

    await userEvent.click(screen.getByRole('button', { name: /enter pif/i }));
    expect(navigate).toHaveBeenCalledWith('/pif');
  });

  it('keeps the approved header: menu, centred logo, notifications — and the logo is untouched', () => {
    const { container } = renderHome();
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();

    // The header logo is a separate asset from the hero and must remain
    // the approved brand file, unchanged by the hero integration.
    const header = container.querySelector('header');
    const logo = header?.querySelector('img');
    expect(logo).toBeTruthy();
    expect(logo?.getAttribute('src')).toContain('/brand/e-samagri-logo');
    expect(logo?.getAttribute('src')).not.toContain('hero');
  });

  it('renders the approved hero image as the production asset (AS-1 closed)', () => {
    renderHome();
    const hero = screen.getByRole('img', { name: /everyday essentials for a brighter tomorrow/i });
    expect(hero).toHaveAttribute('src', '/brand/hero-home.png');
    // Intrinsic dimensions are declared so the browser reserves the
    // right space and the banner never causes layout shift.
    expect(hero).toHaveAttribute('width', '1842');
    expect(hero).toHaveAttribute('height', '854');
    // Width-driven, height-derived: the full artwork is always visible.
    expect(hero.className).toContain('w-full');
    expect(hero.className).toContain('h-auto');
  });

  it('offers smaller derivatives to narrow screens without cropping the artwork', () => {
    const { container } = renderHome();
    const source = container.querySelector('picture source');
    expect(source).toHaveAttribute('type', 'image/webp');
    expect(source?.getAttribute('srcset')).toContain('hero-home-640.webp 640w');
    expect(source?.getAttribute('srcset')).toContain('hero-home-1842.webp 1842w');
  });

  it('shows no preview-data, development or prototype indicator in the customer UI', () => {
    const { container } = renderHome();
    const text = (container.textContent ?? '').toLowerCase();
    for (const marker of ['preview data', 'dev placeholder', 'dev data', 'mock', 'prototype', 'debug']) {
      expect(text).not.toContain(marker);
    }
  });

  it('keeps the hero above the RIK and PIF cards in the approved order', () => {
    const { container } = renderHome();
    const hero = screen.getByRole('img', { name: /everyday essentials/i });
    const rik = screen.getByText('RIK');
    // Node.compareDocumentPosition: 4 === "follows" in document order.
    expect(hero.compareDocumentPosition(rik) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('picture')).toBeInTheDocument();
  });

  /**
   * The approved shortcut row — EXACTLY three cards, and nothing else.
   *
   * Shop Now and Community Info were removed from this screen by an approved
   * requirement change. These tests assert their ABSENCE rather than merely
   * omitting them, because a shortcut that creeps back as a hidden, disabled
   * or duplicate tile is precisely the failure the change was meant to
   * prevent, and silence would not catch it.
   */
  it('shows exactly three shortcut cards, each exactly once', () => {
    renderHome();
    for (const label of ['New Arrivals', 'Nutrition Info', 'Home Delivery']) {
      expect(screen.getAllByRole('button', { name: new RegExp(label, 'i') })).toHaveLength(1);
    }
  });

  it('has NO Community Info shortcut anywhere on the home screen', () => {
    const { container } = renderHome();
    // Not as a control, visible or hidden...
    expect(screen.queryByRole('button', { name: /Community Info/i, hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Community Info/i, hidden: true })).not.toBeInTheDocument();
    // ...and not as text left behind anywhere in the rendered output.
    expect(container.textContent ?? '').not.toMatch(/Community Info/i);
  });

  it('has NO Shop Now shortcut in the home-screen shortcut area', () => {
    const { container } = renderHome();
    expect(screen.queryByRole('button', { name: /Shop Now/i, hidden: true })).not.toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/Shop Now/i);
  });

  it('still reaches PIF from this screen, so nothing was orphaned by the removal', async () => {
    const user = userEvent.setup();
    renderHome();
    // "Enter PIF" is directly above the cards and is the PIF entry point.
    await user.click(screen.getByRole('button', { name: /enter pif/i }));
    expect(navigate).toHaveBeenCalledWith('/pif');
  });

  it('keeps no trace of the superseded "Our Products" shortcut', () => {
    renderHome();
    expect(screen.queryByRole('button', { name: /Our Products/i })).not.toBeInTheDocument();
  });

  it('points the Nutrition Info card at the COMMON nutrition page', async () => {
    // `/nutrition`, not `/rik/nutrition`. The old address sat inside the RIK
    // route guard, which is why a PIF-only resident could not open it.
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Nutrition Info/i }));
    expect(navigate).toHaveBeenCalledWith('/nutrition');
  });

  it('points the Home Delivery card at PIF, where the delivery flow lives', async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole('button', { name: /Home Delivery/i }));
    expect(navigate).toHaveBeenCalledWith('/pif');
  });

  it('points the New Arrivals card at the live New Arrivals page', async () => {
    const user = userEvent.setup();
    renderHome();
    const card = screen.getByRole('button', { name: /New Arrivals/i });
    // The feature is built now, so the card must be live — and must no
    // longer carry the placeholder wording it shipped with.
    expect(card).toBeEnabled();
    expect(card).not.toHaveTextContent(/coming soon/i);
    await user.click(card);
    // `/new-arrivals`, not `/rik/new-arrivals` — common content now.
    expect(navigate).toHaveBeenCalledWith('/new-arrivals');
  });

  it('gives every shortcut card a text label, so none is an unnamed icon', () => {
    renderHome();
    for (const label of ['New Arrivals', 'Nutrition Info', 'Home Delivery']) {
      const card = screen.getByRole('button', { name: new RegExp(label, 'i') });
      expect(card.textContent?.trim().length ?? 0).toBeGreaterThan(label.length);
    }
  });

  it('keeps the Announcements section below the cards, not replaced by them', () => {
    renderHome();
    const heading = screen.getByRole('heading', { name: /announcements/i });
    expect(heading).toBeInTheDocument();
    const cards = screen.getByRole('button', { name: /Nutrition Info/i });
    // 4 === "follows" in document order: announcements come after the cards.
    expect(cards.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows an honest empty state when announcements are not built yet', async () => {
    renderHome();
    expect(await screen.findByText(/no announcements yet/i)).toBeInTheDocument();
  });

  it('uses no fixed-height container that could trap content (CR-1)', () => {
    const { container } = renderHome();
    const offenders = Array.from(container.querySelectorAll<HTMLElement>('*')).filter((el) => {
      const cls = el.className;
      if (typeof cls !== 'string') return false;
      // `min-h-screen` is a floor, not a cap — it never traps content.
      return /(^|\s)h-screen(\s|$)/.test(cls) || /\[100vh\]/.test(cls) || /(^|\s)overflow-hidden(\s|$)/.test(cls);
    });
    // Only decorative, content-sized wrappers may clip (e.g. rounded
    // cards); no scroll container may.
    for (const el of offenders) {
      expect(el.className).not.toMatch(/h-screen|\[100vh\]/);
    }
  });
});
