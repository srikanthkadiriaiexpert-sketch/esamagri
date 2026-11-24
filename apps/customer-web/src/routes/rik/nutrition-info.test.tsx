import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Catalogue, CatalogueItem } from '../../lib/api/rik-catalogue-api';

/**
 * The Nutrition Info page.
 *
 * THE ASSERTION THAT MATTERS MOST is that a product with no nutrition entry
 * is still on the page. The catalogue is the list; nutrition is a lookup.
 * Dropping an item because nothing is known about it would quietly hide part
 * of the ration, which is the one failure this screen must not have.
 *
 * The second is that a blank is never rendered as a zero. "0 g of fibre" and
 * "we do not know" are different statements, and only one of them is true.
 */

const api = { fetchRikCatalogue: vi.fn(), packLabel: vi.fn() };
vi.mock('../../lib/api/rik-catalogue-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-catalogue-api')>();
  return { ...actual, fetchRikCatalogue: (...args: unknown[]) => api.fetchRikCatalogue(...args) };
});

// A dataset with exactly one entry, and that entry deliberately mixed: an
// exact energy figure, three supplied RANGES, and two fields missing
// altogether. That way the range rendering, the exact rendering and the
// absent rendering are all exercised rather than assumed.
vi.mock('../../data/rikNutrition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../data/rikNutrition')>();
  const only = {
    POTATO_FRESH: {
      basis: 'per 100 g',
      state: 'raw' as const,
      source: 'Test Table 2017',
      sourceFood: 'TT-001 Potato, raw',
      // A MEASURED record. This suite tests how the page renders a record it
      // is given — basis and state, "Not available" rather than zero, the
      // evidence label and the source line — and those are properties of the
      // measured path. 'approximate-reference' now means "typical value for a
      // food group", which the page deliberately renders differently (no
      // source line, available nutrients only, the typical-values
      // disclaimer); that path is covered by nutrition-approved-display.
      dataQuality: 'composition-table' as const,
      energyKcal: 97,
      proteinG: actual.range(1.5, 2.5),
      carbohydrateG: actual.range(17, 21),
      fibreG: actual.range(3.2, 3.6),
      // fatG and sugarsG deliberately absent.
    },
  };
  return {
    ...actual,
    rikNutrition: only,
    nutritionFor: (code: string) => (only as Record<string, unknown>)[code] ?? null,
    nutritionCodes: () => Object.keys(only),
  };
});

const { NutritionInfoPage } = await import('./NutritionInfoPage');

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  code: 'POTATO_FRESH',
  name: 'Potato',
  brand: null,
  imageRef: '/catalogue/rik/fresh/potato.png',
  unit: 'g',
  packSize: null,
  packUnit: null,
  isLoose: false,
  issuePeriod: 'FRESH',
  poolCode: 'POTATO',
  poolName: 'Potato',
  ...over,
});

const catalogue = (items: CatalogueItem[]): Catalogue => ({ asOf: '2026-10-24', items });

const renderPage = () =>
  render(
    <MemoryRouter>
      <NutritionInfoPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchRikCatalogue.mockResolvedValue(
    catalogue([
      item(),
      item({ code: 'VEG_ARVI', name: 'Arvi', poolName: 'Vegetables' }),
      item({ code: 'BG_AMUL_GHEE', name: 'Ghee', brand: 'Amul', poolName: 'Butter & Ghee', packSize: 500, packUnit: 'tin' }),
    ])
  );
});

describe('NutritionInfoPage', () => {
  it('shows EVERY catalogue product, including those with no nutrition entry', async () => {
    renderPage();
    // All three. Potato carries this suite's mocked MEASURED record; Arvi
    // gained an approved typical value when the 10 November decision widened
    // the allowlist to 101 provisions; Ghee is a reviewed exclusion, because
    // the mixed-dairy group average would understate its fat about fivefold.
    expect(await screen.findByTestId('nutrition-card-POTATO_FRESH')).toBeInTheDocument();
    expect(screen.getByTestId('nutrition-card-VEG_ARVI')).toBeInTheDocument();
    expect(screen.getByTestId('nutrition-card-BG_AMUL_GHEE')).toBeInTheDocument();
  });

  it('says plainly when nutrition is not recorded, rather than hiding the product', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-VEG_ARVI');
    const missing = screen.getAllByText('Nutrition information currently unavailable.');
    // One of the three now. Ghee is the reviewed exclusion; Arvi stopped being
    // unavailable on 10 November. The fixture is better for it: the three
    // products now cover all three outcomes the page can render.
    expect(missing).toHaveLength(1);
  });

  it('takes the name, brand and pack from the live catalogue, not from the dataset', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-BG_AMUL_GHEE');
    expect(screen.getByText('Amul')).toBeInTheDocument();
    expect(screen.getByText(/500 tin/)).toBeInTheDocument();
  });

  it('joins nutrition by provision code and shows the basis and source', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-POTATO_FRESH');
    expect(screen.getByText(/per 100 g · raw/)).toBeInTheDocument();
    expect(screen.getByText(/Test Table 2017 — TT-001 Potato, raw/)).toBeInTheDocument();
  });

  it('renders a supported value, and marks an unsupported one unavailable — never zero', async () => {
    renderPage();
    const potatoRow = await screen.findByTestId('nutrition-card-POTATO_FRESH');
    expect(within(potatoRow).getByText('97 kcal')).toBeInTheDocument();

    // Total fat and Total sugars are absent from the record.
    const fat = within(potatoRow).getByRole('row', { name: /Total fat/ });
    expect(within(fat).getByText('Not available')).toBeInTheDocument();
    expect(within(fat).queryByText(/\b0 g\b/)).not.toBeInTheDocument();
  });

  it('prints a supplied RANGE as a range, never as its midpoint', async () => {
    renderPage();
    const potatoRow = await screen.findByTestId('nutrition-card-POTATO_FRESH');

    // The three supplied ranges, exactly as supplied.
    expect(within(potatoRow).getByText('1.5–2.5 g')).toBeInTheDocument();
    expect(within(potatoRow).getByText('17–21 g')).toBeInTheDocument();
    expect(within(potatoRow).getByText('3.2–3.6 g')).toBeInTheDocument();

    // The midpoints are the numbers this screen must never invent: protein
    // 2, carbohydrate 19, fibre 3.4.
    const protein = within(potatoRow).getByRole('row', { name: /Protein/ });
    expect(within(protein).queryByText('2 g')).not.toBeInTheDocument();
    const carbohydrate = within(potatoRow).getByRole('row', { name: /Carbohydrate/ });
    expect(within(carbohydrate).queryByText('19 g')).not.toBeInTheDocument();
    const fibre = within(potatoRow).getByRole('row', { name: /Dietary fibre/ });
    expect(within(fibre).queryByText('3.4 g')).not.toBeInTheDocument();
  });

  it('states the evidence category, and claims no verification', async () => {
    renderPage();
    const potatoRow = await screen.findByTestId('nutrition-card-POTATO_FRESH');
    expect(within(potatoRow).getByText(/Transcribed from a published food-composition table/i)).toBeInTheDocument();
    // Nothing on the page may suggest the figures were independently checked.
    expect(document.body.textContent ?? '').not.toMatch(/scientifically verified|independently verified|certified/i);
  });

  it('describes composition only where a value supports it, and makes no medical claim', async () => {
    renderPage();
    const potatoRow = await screen.findByTestId('nutrition-card-POTATO_FRESH');
    // 3.4 g fibre clears the 3 g threshold.
    expect(within(potatoRow).getByText('Source of dietary fibre')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/cure|prevent|treat|disease/i);
  });

  it('searches by product name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('nutrition-card-POTATO_FRESH');
    await user.type(screen.getByLabelText(/search nutrition information/i), 'arvi');
    await waitFor(() => expect(screen.queryByTestId('nutrition-card-POTATO_FRESH')).not.toBeInTheDocument());
    expect(screen.getByTestId('nutrition-card-VEG_ARVI')).toBeInTheDocument();
  });

  it('searches by brand', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('nutrition-card-BG_AMUL_GHEE');
    await user.type(screen.getByLabelText(/search nutrition information/i), 'amul');
    await waitFor(() => expect(screen.queryByTestId('nutrition-card-VEG_ARVI')).not.toBeInTheDocument());
    expect(screen.getByTestId('nutrition-card-BG_AMUL_GHEE')).toBeInTheDocument();
  });

  it('shows an empty-search state rather than a blank page', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('nutrition-card-POTATO_FRESH');
    await user.type(screen.getByLabelText(/search nutrition information/i), 'zzzzz');
    expect(await screen.findByText(/No items match that search/i)).toBeInTheDocument();
  });

  it('shows a loading state while the catalogue is being fetched', async () => {
    api.fetchRikCatalogue.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText(/Loading the catalogue/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry when the catalogue cannot be loaded', async () => {
    api.fetchRikCatalogue.mockRejectedValue(new Error('network down'));
    renderPage();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('reports how many items carry recorded nutrition, so the gap is visible', async () => {
    renderPage();
    expect(await screen.findByText(/3 of 3 items · 2 with nutrition information/)).toBeInTheDocument();
  });
});
