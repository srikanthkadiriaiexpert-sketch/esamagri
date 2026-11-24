import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Catalogue, CatalogueItem } from '../../lib/api/rik-catalogue-api';
import { hasItemLevelRecord } from '../../data/rikNutrition';
import { rikNutritionIfctWithheld } from '../../data/rikNutritionIfctWithheld';
import { rikNutritionPreliminary } from '../../data/rikNutritionPreliminary';
import {
  APPROVED_TYPICAL_VALUE_PROVISIONS,
  approvedTypicalCodes,
  approvedTypicalNutritionFor,
  TYPICAL_VALUES_DISCLAIMER,
} from '../../data/rikNutritionApproved';
import { EXCLUDED_FROM_TYPICAL_VALUES } from '../../data/rikNutritionTypicalValueReview';
import { NutritionInfoPage } from './NutritionInfoPage';

/**
 * WHAT A CUSTOMER ACTUALLY SEES, against the real data and the real gates.
 *
 * Nothing in the nutrition modules is mocked — only the catalogue API, because
 * the page would otherwise go to the network for its product list and the
 * catalogue is not what is under test.
 *
 * The fixture is chosen so that all four outcomes appear on one screen:
 *
 *   SUGAR              approved, so figures and the disclaimer appear
 *   OIL_SUNFLOWER_1000 approved, and the case where real zeros must show
 *   CER_MAIDA          has a measured record, withheld -> unavailable
 *   NU_HORLICKS        has a workbook figure but is NOT approved -> unavailable
 *   MILK_FRESH         in neither dataset -> unavailable
 */

const api = { fetchRikCatalogue: vi.fn() };
vi.mock('../../lib/api/rik-catalogue-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-catalogue-api')>();
  return { ...actual, fetchRikCatalogue: (...args: unknown[]) => api.fetchRikCatalogue(...args) };
});

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  code: 'SUGAR',
  name: 'Sugar',
  brand: null,
  imageRef: '/catalogue/rik/dry/sugar.png',
  unit: 'g',
  packSize: null,
  packUnit: null,
  isLoose: false,
  issuePeriod: 'DRY',
  poolCode: 'SUGAR',
  poolName: 'Sugar / Jaggery',
  ...over,
});

const FIXTURE = [
  item(),
  item({ code: 'OIL_SUNFLOWER_1000', name: 'Sunflower Refined Oil', poolName: 'Oils' }),
  item({ code: 'CER_MAIDA', name: 'All Purpose Flour / Maida', poolName: 'Cereals' }),
  item({ code: 'NU_HORLICKS', name: 'Horlicks Classic Malt', brand: 'Horlicks', poolName: 'Nutrition Drinks' }),
  item({ code: 'MILK_FRESH', name: 'Fresh Milk', poolName: 'Milk' }),
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <NutritionInfoPage />
    </MemoryRouter>
  );

const card = (code: string) => screen.getByTestId(`nutrition-card-${code}`);

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchRikCatalogue.mockResolvedValue({ asOf: '2026-11-09', items: FIXTURE } as Catalogue);
});

describe('the Nutrition Info screen with the approved typical values live', () => {
  it('rests on the premises this test assumes', () => {
    // The page consults the value-free code list, so that is what the premise
    // asserts; the record itself now lives in the withheld module, out of the
    // customer bundle, and is checked there too.
    expect(hasItemLevelRecord('CER_MAIDA'), 'the page must know maida is measured').toBe(true);
    expect(rikNutritionIfctWithheld['CER_MAIDA'], 'maida must hold a measured record').toBeDefined();
    expect(rikNutritionPreliminary['NU_HORLICKS']?.energyKcal, 'horlicks has a workbook figure').toBeDefined();
    expect(rikNutritionPreliminary['MILK_FRESH'], 'milk is in neither dataset').toBeUndefined();
  });

  it('shows the approved figures for an approved product', async () => {
    renderPage();
    const sugar = within(await screen.findByTestId('nutrition-card-SUGAR'));
    expect(sugar.getByText('400 kcal')).toBeInTheDocument();
    expect(sugar.getByText('100 g')).toBeInTheDocument();
    expect(sugar.getByText('per 100 g')).toBeInTheDocument();
  });

  it('shows real zeros, because a stated zero is a value', async () => {
    renderPage();
    const oil = within(await screen.findByTestId('nutrition-card-OIL_SUNFLOWER_1000'));
    expect(oil.getByText('900 kcal')).toBeInTheDocument();
    // Oil genuinely contains no carbohydrate, protein or fibre.
    expect(oil.getAllByText('0 g').length).toBeGreaterThanOrEqual(3);
    expect(oil.getByText('100 g')).toBeInTheDocument();
  });

  it('omits a nutrient the workbook never supplied, rather than showing it as zero', async () => {
    renderPage();
    const sugar = within(await screen.findByTestId('nutrition-card-SUGAR'));
    // No sugars, kJ, fatty-acid, sodium or cholesterol rows exist for these.
    expect(sugar.queryByText('Total sugars')).not.toBeInTheDocument();
    expect(sugar.queryByText(/Energy \(as published\)/)).not.toBeInTheDocument();
    expect(sugar.queryByText('Not available')).not.toBeInTheDocument();
  });

  it('shows the approved disclaimer on every approved product', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-SUGAR');
    const notes = screen.getAllByText(TYPICAL_VALUES_DISCLAIMER);
    expect(notes).toHaveLength(2); // sugar and the oil
    expect(TYPICAL_VALUES_DISCLAIMER).toBe(
      'Approximate typical nutrition values per 100 g. Actual values may vary.'
    );
  });

  it('shows NO source name or citation anywhere on the screen', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-SUGAR');
    const dom = document.body.textContent ?? '';
    expect(dom).not.toMatch(/ICMR|NIN\b|IFCT|INDB|Anuvaad|Dietary Guidelines|Longvah/i);
    expect(dom).not.toMatch(/Source:/);
    expect(dom).not.toMatch(/Table 1\.3|broad food-group average|workbook/i);
    // And nothing that would read as a measurement claim.
    expect(dom).not.toMatch(/laborator|independently verified|certified/i);
  });

  it('keeps a product with a MEASURED record unavailable rather than downgrading it', async () => {
    renderPage();
    const maida = within(await screen.findByTestId('nutrition-card-CER_MAIDA'));
    expect(maida.getByText('Nutrition information currently unavailable.')).toBeInTheDocument();
    // The workbook's cereal proxy says 343 kcal. It must not appear.
    expect(document.body.textContent ?? '').not.toContain('343');
  });

  it('keeps an excluded category unavailable even though the workbook has a figure', async () => {
    renderPage();
    const horlicks = within(await screen.findByTestId('nutrition-card-NU_HORLICKS'));
    expect(horlicks.getByText('Nutrition information currently unavailable.')).toBeInTheDocument();
    // 337 kcal is the milk-products proxy it would otherwise have shown.
    expect(document.body.textContent ?? '').not.toContain('337');
  });

  it('keeps an unmatched product unavailable', async () => {
    renderPage();
    const milk = within(await screen.findByTestId('nutrition-card-MILK_FRESH'));
    expect(milk.getByText('Nutrition information currently unavailable.')).toBeInTheDocument();
  });

  it('still lists every catalogue product, and counts the ones with figures', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-SUGAR');
    for (const entry of FIXTURE) expect(card(entry.code)).toBeInTheDocument();
    expect(screen.getAllByTestId(/^nutrition-card-/)).toHaveLength(FIXTURE.length);
    expect(screen.getByText(/5 of 5 items · 2 with nutrition information/)).toBeInTheDocument();
    // Three of the five say so plainly.
    expect(screen.getAllByText('Nutrition information currently unavailable.')).toHaveLength(3);
  });

  it('keeps the screen usable — heading and search still present', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-SUGAR');
    expect(screen.getByText('Nutrition Info')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search nutrition information/i })).toBeInTheDocument();
  });
});

/**
 * THE WIDENED COVERAGE, ON ONE SCREEN, AGAINST THE REAL DATA.
 *
 * The approved list went from 8 provisions to 101 on 10 November. This builds a
 * catalogue fixture holding ONE PRODUCT FROM EVERY APPROVED FOOD GROUP plus a
 * reviewed exclusion, a provision with a measured record and a provision the
 * workbook never covered, and checks what a customer would actually read.
 *
 * It is deliberately generated from the allowlist rather than hand-listed, so
 * a new food group cannot be approved without appearing here.
 */
describe('the widened approved coverage on the Nutrition Info screen', () => {
  const groups = [...new Set(Object.values(APPROVED_TYPICAL_VALUE_PROVISIONS))].sort();
  const representative = (group: string) =>
    Object.keys(APPROVED_TYPICAL_VALUE_PROVISIONS)
      .filter((code) => APPROVED_TYPICAL_VALUE_PROVISIONS[code] === group)
      .sort()[0]!;

  const SAMPLE = groups.map(representative);
  const UNAVAILABLE = ['BG_AMUL_GHEE', 'CER_MAIDA', 'MILK_FRESH'];

  beforeEach(() => {
    api.fetchRikCatalogue.mockResolvedValue({
      asOf: '2026-11-10',
      items: [...SAMPLE, ...UNAVAILABLE].map((code) => item({ code, name: code })),
    } as Catalogue);
  });

  it('rests on the premises this test assumes', () => {
    expect(approvedTypicalCodes()).toHaveLength(101);
    expect(groups.length).toBeGreaterThanOrEqual(15);
    expect(EXCLUDED_FROM_TYPICAL_VALUES['BG_AMUL_GHEE'], 'ghee is a reviewed exclusion').toBeTruthy();
    expect(hasItemLevelRecord('CER_MAIDA'), 'maida holds a measured record').toBe(true);
    expect(rikNutritionPreliminary['MILK_FRESH'], 'MILK_FRESH is in neither dataset').toBeUndefined();
  });

  it('shows figures and the disclaimer for a product from every approved group', async () => {
    renderPage();
    await screen.findByTestId(`nutrition-card-${SAMPLE[0]}`);

    for (const code of SAMPLE) {
      const card = within(screen.getByTestId(`nutrition-card-${code}`));
      const group = APPROVED_TYPICAL_VALUE_PROVISIONS[code]!;
      const kcal = approvedTypicalNutritionFor(code)!.energyKcal!;

      expect(
        card.queryByText('Nutrition information currently unavailable.'),
        `${code} (${group}) must not read as unavailable`
      ).not.toBeInTheDocument();
      expect(card.getByText(`${String(kcal)} kcal`), `${code} energy`).toBeInTheDocument();
      expect(card.getByText('per 100 g'), `${code} basis`).toBeInTheDocument();
      expect(card.getByText(TYPICAL_VALUES_DISCLAIMER), `${code} disclaimer`).toBeInTheDocument();
    }
  });

  it('still says unavailable where there is genuinely nothing to show', async () => {
    renderPage();
    await screen.findByTestId(`nutrition-card-${SAMPLE[0]}`);
    for (const code of UNAVAILABLE) {
      const card = within(screen.getByTestId(`nutrition-card-${code}`));
      expect(
        card.getByText('Nutrition information currently unavailable.'),
        `${code} must stay unavailable`
      ).toBeInTheDocument();
    }
    expect(screen.getAllByText('Nutrition information currently unavailable.')).toHaveLength(
      UNAVAILABLE.length
    );
  });

  it('counts the covered products in the summary line', async () => {
    renderPage();
    const total = SAMPLE.length + UNAVAILABLE.length;
    expect(
      await screen.findByText(
        new RegExp(`${total} of ${total} items · ${SAMPLE.length} with nutrition information`)
      )
    ).toBeInTheDocument();
  });

  it('shows NO source name, citation or workbook detail anywhere on the widened screen', async () => {
    renderPage();
    await screen.findByTestId(`nutrition-card-${SAMPLE[0]}`);
    const dom = document.body.textContent ?? '';
    expect(dom).not.toMatch(/ICMR|NIN\b|IFCT|INDB|Anuvaad|Dietary Guidelines|Longvah/i);
    expect(dom).not.toMatch(/Source:/);
    expect(dom).not.toMatch(/Table 1\.3|broad food-group average|workbook|foodGroupProxy/i);
    expect(dom).not.toMatch(/laborator|independently verified|certified/i);
    // Nor the internal food-group names the allowlist is keyed on.
    expect(dom).not.toMatch(/milk products|approximate-reference/i);
  });

  it('omits a nutrient the workbook never supplied, rather than showing it as zero', async () => {
    renderPage();
    await screen.findByTestId(`nutrition-card-${SAMPLE[0]}`);
    // Total sugars is blank for all 184 workbook rows, so the row must not
    // appear at all — not as 0 g, and not as "Not available".
    expect(screen.queryByText('Total sugars')).not.toBeInTheDocument();
    expect(screen.queryByText(/Energy \(as published\)/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not available')).not.toBeInTheDocument();
  });

  it('prints real zeros, because a stated zero is a value', async () => {
    renderPage();
    const oil = within(await screen.findByTestId('nutrition-card-OIL_GROUNDNUT'));
    expect(oil.getByText('900 kcal')).toBeInTheDocument();
    expect(oil.getAllByText('0 g').length).toBeGreaterThanOrEqual(3);
    expect(oil.getByText('100 g')).toBeInTheDocument();
  });
});
