import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { NewArrivals, NewArrivalItem } from '../../lib/api/rik-new-arrivals-api';

/**
 * The New Arrivals screen.
 *
 * THE ASSERTIONS THAT MATTER MOST are the negative ones. This screen must
 * carry NO product of its own — everything it shows comes from the API, so
 * staff publishing something is enough to change it and no rebuild is
 * involved. And it must never read as an offer: nothing here states or
 * implies an entitlement, a quantity or availability, because being
 * featured and being entitled are unrelated facts.
 *
 * SINCE THE STANDALONE REWORK most listings carry NO catalogue fields at
 * all: `code`, `brand`, `unit`, `packSize`, `packUnit`, `issuePeriod` and
 * `poolName` are all null, and only `id`, `name` and `imageRef` are
 * guaranteed. The suite covers that shape first-class rather than treating
 * it as an edge case, because it is now the ordinary one.
 */

const api = { fetchRikNewArrivals: vi.fn() };
vi.mock('../../lib/api/rik-new-arrivals-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-new-arrivals-api')>();
  return { ...actual, fetchRikNewArrivals: (...args: unknown[]) => api.fetchRikNewArrivals(...args) };
});

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const { NewArrivalsPage } = await import('./NewArrivalsPage');

let seq = 0;

/** A listing LINKED to a RIK provision: the catalogue fields are populated. */
const item = (over: Partial<NewArrivalItem> = {}): NewArrivalItem => ({
  id: `listing-${++seq}`,
  code: 'CER_RICE_SONA_MASOORI',
  name: 'Bell Rice Sona Masoori',
  brand: null,
  imageRef: '/catalogue/rik/dry/rice.png',
  headline: null,
  unit: 'g',
  packSize: null,
  packUnit: null,
  issuePeriod: 'DRY',
  poolName: 'Cereals',
  publishedFrom: '2026-10-20',
  ...over,
});

/**
 * A STANDALONE listing — the ordinary kind. Every catalogue field is null,
 * exactly as the server sends it, so any screen that assumed one would be
 * present fails here rather than in front of a customer.
 */
const standalone = (over: Partial<NewArrivalItem> = {}): NewArrivalItem => ({
  id: `standalone-${++seq}`,
  code: null,
  name: 'Himalayan Pink Salt',
  brand: null,
  imageRef: '/rik/media/rik/new-arrivals/salt.png',
  headline: null,
  unit: null,
  packSize: null,
  packUnit: null,
  issuePeriod: null,
  poolName: null,
  publishedFrom: null,
  ...over,
});

const payload = (items: NewArrivalItem[]): NewArrivals => ({ asOf: '2026-10-25', items });

const renderPage = () =>
  render(
    <MemoryRouter>
      <NewArrivalsPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  api.fetchRikNewArrivals.mockResolvedValue(
    payload([
      item(),
      item({ code: 'DAL_OATS', name: 'Oats', poolName: 'Daliya', packSize: 600, packUnit: 'g', headline: 'Now in a 600 g pack' }),
      item({ code: 'BG_AMUL_GHEE', name: 'Ghee', brand: 'Amul', imageRef: null }),
    ])
  );
});

describe('NewArrivalsPage', () => {
  it('shows exactly what the API returned, and nothing of its own', async () => {
    renderPage();
    expect(await screen.findByTestId('new-arrival-CER_RICE_SONA_MASOORI')).toBeInTheDocument();
    expect(screen.getByTestId('new-arrival-DAL_OATS')).toBeInTheDocument();
    expect(screen.getByTestId('new-arrival-BG_AMUL_GHEE')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders something published by staff without any code change — a different payload, a different screen', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([item({ code: 'VEG_BROCCOLI', name: 'Broccoli', poolName: 'Fresh Vegetables' })])
    );
    renderPage();
    expect(await screen.findByTestId('new-arrival-VEG_BROCCOLI')).toBeInTheDocument();
    expect(screen.getByText('Broccoli')).toBeInTheDocument();
    expect(screen.queryByTestId('new-arrival-DAL_OATS')).not.toBeInTheDocument();
  });

  it('takes the name, brand, pool and pack from the API response', async () => {
    renderPage();
    const oats = await screen.findByTestId('new-arrival-DAL_OATS');
    expect(within(oats).getByText(/Daliya · 600 g/)).toBeInTheDocument();
    const ghee = screen.getByTestId('new-arrival-BG_AMUL_GHEE');
    expect(within(ghee).getByText('Amul')).toBeInTheDocument();
  });

  it('shows the staff headline where there is one, and nothing where there is not', async () => {
    renderPage();
    const oats = await screen.findByTestId('new-arrival-DAL_OATS');
    expect(within(oats).getByText('Now in a 600 g pack')).toBeInTheDocument();
    const rice = screen.getByTestId('new-arrival-CER_RICE_SONA_MASOORI');
    expect(within(rice).queryByText('Now in a 600 g pack')).not.toBeInTheDocument();
  });

  it('falls back gracefully when something has no picture', async () => {
    renderPage();
    const ghee = await screen.findByTestId('new-arrival-BG_AMUL_GHEE');
    expect(within(ghee).getByRole('img', { name: /no picture for ghee/i })).toBeInTheDocument();
  });

  it('states plainly that being listed is NOT an entitlement', async () => {
    renderPage();
    await screen.findByTestId('new-arrival-DAL_OATS');
    expect(screen.getByText(/does not mean an item is part of your entitlement/i)).toBeInTheDocument();
  });

  it('shows no quantity, cart or entitlement control on any card', async () => {
    const { container } = renderPage();
    await screen.findByTestId('new-arrival-DAL_OATS');
    expect(container.querySelector('input[type="number"]')).toBeNull();

    // Scoped to the CARDS. The disclaimer below the list deliberately uses
    // some of this vocabulary ("...for what you may take") to say the
    // opposite, and that sentence must not be what this test catches — an
    // offer would appear on a card, not in the disclaimer.
    const list = screen.getByTestId('new-arrivals-list');
    const text = (list.textContent ?? '').toLowerCase();
    for (const phrase of ['add to cart', 'remaining', 'balance', 'you may take', 'in stock', 'available to you', 'entitle']) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });

  it('links out to Know Your Ration, which is where an allowance is answered', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('new-arrival-DAL_OATS');
    await user.click(screen.getByRole('button', { name: /know your ration/i }));
    expect(navigate).toHaveBeenCalledWith('/rik/ration');
  });

  it('shows an honest empty state when staff have published nothing', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(payload([]));
    renderPage();
    expect(await screen.findByText(/nothing new just now/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows a loading state while the list is being fetched', async () => {
    api.fetchRikNewArrivals.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText(/Loading New Arrivals/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry when the list cannot be loaded', async () => {
    api.fetchRikNewArrivals.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('marks each entry NEW and shows when it was added', async () => {
    renderPage();
    const rice = await screen.findByTestId('new-arrival-CER_RICE_SONA_MASOORI');
    expect(within(rice).getByText('New')).toBeInTheDocument();
    expect(within(rice).getByText(/Added 2026-10-20/)).toBeInTheDocument();
  });
});

/**
 * STANDALONE LISTINGS — the ordinary kind since the rework.
 *
 * These carry a name, an optional headline and an uploaded picture, and
 * nothing else. The point of this block is that the screen renders them
 * without a catalogue to lean on, and without leaking the absence as
 * "null", "undefined" or a stray separator.
 */
describe('NewArrivalsPage — standalone listings', () => {
  it('shows the staff-typed name, headline and uploaded picture', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([
        standalone({
          id: 'sa-salt',
          name: 'Himalayan Pink Salt',
          headline: 'Now stocked in 1 kg packs',
          imageRef: '/rik/media/rik/new-arrivals/salt.png',
        }),
      ])
    );
    renderPage();

    const card = await screen.findByTestId('new-arrival-sa-salt');
    expect(within(card).getByText('Himalayan Pink Salt')).toBeInTheDocument();
    expect(within(card).getByText('Now stocked in 1 kg packs')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: 'Himalayan Pink Salt' })).toHaveAttribute(
      'src',
      '/rik/media/rik/new-arrivals/salt.png'
    );
  });

  it('keys the card by its listing id when there is no catalogue code', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(payload([standalone({ id: 'sa-keyed' })]));
    renderPage();
    expect(await screen.findByTestId('new-arrival-sa-keyed')).toBeInTheDocument();
  });

  it('omits the catalogue sub-line entirely rather than rendering an empty one', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([standalone({ id: 'sa-bare', name: 'Bare Listing' })])
    );
    renderPage();

    const card = await screen.findByTestId('new-arrival-sa-bare');
    const text = card.textContent ?? '';
    // No placeholder for the missing catalogue facts, and no orphan separator.
    expect(text).not.toMatch(/null|undefined|NaN/);
    expect(text).not.toMatch(/·/);
    // The old screen defaulted a missing pool to the literal word "RIK".
    expect(within(card).queryByText('RIK')).not.toBeInTheDocument();
  });

  it('still renders when every optional field is null', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([standalone({ id: 'sa-min', name: 'Minimal', headline: null, imageRef: null, publishedFrom: null })])
    );
    renderPage();

    const card = await screen.findByTestId('new-arrival-sa-min');
    expect(within(card).getByText('Minimal')).toBeInTheDocument();
    expect(within(card).getByRole('img', { name: /no picture for minimal/i })).toBeInTheDocument();
    expect(within(card).queryByText(/Added/)).not.toBeInTheDocument();
    // The NEW badge does not depend on any catalogue field.
    expect(within(card).getByText('New')).toBeInTheDocument();
  });

  it('shows standalone and linked listings side by side in one list', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([
        standalone({ id: 'sa-mixed', name: 'Typed By Staff' }),
        item({ code: 'LINKED_ONE', name: 'From The Catalogue', poolName: 'Cereals' }),
      ])
    );
    renderPage();

    expect(await screen.findByTestId('new-arrival-sa-mixed')).toBeInTheDocument();
    expect(screen.getByTestId('new-arrival-LINKED_ONE')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // The linked one keeps its catalogue sub-line; the standalone one has none.
    expect(within(screen.getByTestId('new-arrival-LINKED_ONE')).getByText(/Cereals/)).toBeInTheDocument();
    expect(within(screen.getByTestId('new-arrival-sa-mixed')).queryByText(/Cereals/)).not.toBeInTheDocument();
  });

  it('carries no entitlement vocabulary on a standalone card either', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([standalone({ id: 'sa-words', name: 'Announcement', headline: 'Just arrived' })])
    );
    renderPage();
    await screen.findByTestId('new-arrival-sa-words');

    const list = screen.getByTestId('new-arrivals-list');
    const text = (list.textContent ?? '').toLowerCase();
    for (const phrase of ['add to cart', 'remaining', 'balance', 'you may take', 'in stock', 'available to you', 'entitle']) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });
});

describe('NewArrivalsPage — the picture', () => {
  it('shows the picture the server resolved, whatever its source', async () => {
    // The server decides: the listing's uploaded picture when it has one,
    // the catalogue picture otherwise. The page renders what it is given and
    // contains no fallback logic of its own to drift out of step.
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([
        item({ code: 'PROMO_ONE', name: 'Promo item', imageRef: '/rik/media/rik/new-arrivals/aaa.png' }),
        item({ code: 'CAT_ONE', name: 'Catalogue item', imageRef: '/rik/media/rik/provisions/bbb.jpg' }),
      ])
    );
    renderPage();

    const promo = await screen.findByTestId('new-arrival-PROMO_ONE');
    expect(within(promo).getByRole('img', { name: 'Promo item' })).toHaveAttribute(
      'src',
      '/rik/media/rik/new-arrivals/aaa.png'
    );

    const catalogue = screen.getByTestId('new-arrival-CAT_ONE');
    expect(within(catalogue).getByRole('img', { name: 'Catalogue item' })).toHaveAttribute(
      'src',
      '/rik/media/rik/provisions/bbb.jpg'
    );
  });

  it('gives every picture alt text naming the product, and loads them lazily', async () => {
    renderPage();
    const oats = await screen.findByTestId('new-arrival-DAL_OATS');
    const img = within(oats).getByRole('img', { name: 'Oats' });
    expect(img).toHaveAttribute('alt', 'Oats');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
  });

  it('falls back gracefully when an uploaded picture is broken', async () => {
    api.fetchRikNewArrivals.mockResolvedValue(
      payload([item({ code: 'GONE', name: 'Missing picture', imageRef: '/rik/media/rik/new-arrivals/gone.png' })])
    );
    renderPage();
    const card = await screen.findByTestId('new-arrival-GONE');
    const img = within(card).getByRole('img', { name: 'Missing picture' });

    // The file has gone from the media store; the card must not show a
    // broken-image icon.
    fireEvent.error(img);
    expect(within(card).getByRole('img', { name: /no picture for Missing picture/i })).toBeInTheDocument();
    expect(within(card).queryByRole('img', { name: 'Missing picture' })).not.toBeInTheDocument();
  });
});
