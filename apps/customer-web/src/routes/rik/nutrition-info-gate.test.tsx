import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Catalogue, CatalogueItem } from '../../lib/api/rik-catalogue-api';
import {
  IFCT_CITATION,
  PUBLISH_COMPOSITION_TABLE_VALUES,
} from '../../data/rikNutrition';
import { rikNutritionIfctWithheld as rikNutrition } from '../../data/rikNutritionIfctWithheld';
import { NutritionInfoPage } from './NutritionInfoPage';

/**
 * THE PAGE AGAINST THE REAL GATE.
 *
 * nutrition-info.test.tsx mocks the whole nutrition data module and supplies
 * its own `nutritionFor`, which is right for testing how the page RENDERS a
 * record. The cost is that it never exercises the real dataset or the real
 * publication gate — so nothing proved the behaviour that is actually going
 * to staging: that every product reads "Nutrition information currently
 * unavailable." because ICMR-NIN has not yet given written permission.
 *
 * This file closes that gap. THE NUTRITION MODULE IS NOT MOCKED HERE. The
 * real `rikNutrition`, the real `nutritionFor` and the real
 * `PUBLISH_COMPOSITION_TABLE_VALUES` are all in play. Only the catalogue API
 * is stubbed, because the page would otherwise go to the network for its
 * product list, and the catalogue is not what is under test.
 *
 * The sharpest assertion is the leak check. Two of the products below DO have
 * a complete IFCT record in the dataset, with real figures sitting in memory
 * the whole time the page renders. The test asserts that not one of those
 * figures, nor the food code, nor the reference food name, nor the citation
 * appears anywhere in the DOM. That is the licence condition, expressed as a
 * test rather than as a comment.
 *
 * WHEN PERMISSION ARRIVES and the flag is turned on, the tests in this file
 * are EXPECTED TO FAIL. That is deliberate: the failure is the reminder to
 * rewrite them as the published-state tests, rather than discovering months
 * later that nobody checked what the published page looks like.
 */

const api = { fetchRikCatalogue: vi.fn() };
vi.mock('../../lib/api/rik-catalogue-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api/rik-catalogue-api')>();
  return { ...actual, fetchRikCatalogue: (...args: unknown[]) => api.fetchRikCatalogue(...args) };
});

/**
 * Two provisions that genuinely carry IFCT records, and one that is excluded.
 *
 * CER_MAIDA and FRUIT_BANANA_ROBUSTA are in the eligible 51. Picking them is
 * the whole point: if the gate leaked, these are the rows that would show
 * figures. NU_HORLICKS is a proprietary formulation that has no record at all,
 * so it stands for the ordinary unavailable case.
 */
const WITH_RECORDS = ['CER_MAIDA', 'FRUIT_BANANA_ROBUSTA'] as const;
const WITHOUT_RECORD = 'NU_HORLICKS';

const item = (over: Partial<CatalogueItem> = {}): CatalogueItem => ({
  code: 'CER_MAIDA',
  name: 'All Purpose Flour / Maida',
  brand: null,
  imageRef: '/catalogue/rik/dry/maida.png',
  unit: 'g',
  packSize: null,
  packUnit: null,
  isLoose: false,
  issuePeriod: 'DRY',
  poolCode: 'CEREALS',
  poolName: 'Cereals',
  ...over,
});

const catalogue = (items: CatalogueItem[]): Catalogue => ({ asOf: '2026-11-07', items });

const THREE = [
  item(),
  item({ code: 'FRUIT_BANANA_ROBUSTA', name: 'Banana Robusta', issuePeriod: 'FRESH', poolCode: 'FRUIT', poolName: 'Fresh Fruits' }),
  // Name and brand deliberately DIFFERENT: the card renders both, so equal
  // strings would make a by-text lookup ambiguous rather than wrong.
  item({ code: WITHOUT_RECORD, name: 'Horlicks Classic Malt', brand: 'Horlicks', poolName: 'Nutrition Drinks' }),
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <NutritionInfoPage />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchRikCatalogue.mockResolvedValue(catalogue(THREE));
});

/**
 * READS THE 51 IFCT RECORDS FROM ./rikNutritionIfctWithheld, not from the
 * `rikNutrition` map, because that map is now empty on purpose: the records
 * were moved out so they would stop being bundled into the customer app (see
 * that module's header). They are aliased back to `rikNutrition` here so the
 * assertions below keep testing the same 51 records they always tested.
 *
 * A test may import that module. A production module may not.
 */
describe('the Nutrition Info page against the real, closed publication gate', () => {
  it('rests on a closed gate and a dataset that really does hold these records', () => {
    // The premises. If either of these changes, every assertion below is
    // testing something other than what it claims to test.
    expect(PUBLISH_COMPOSITION_TABLE_VALUES).toBe(false);
    for (const code of WITH_RECORDS) {
      expect(rikNutrition[code], `${code} must have a record for this test to mean anything`).toBeDefined();
      expect(typeof rikNutrition[code]!.energyKcal).toBe('number');
    }
    expect(rikNutrition[WITHOUT_RECORD]).toBeUndefined();
  });

  it('says "Nutrition information currently unavailable." for EVERY product', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-CER_MAIDA');

    const unavailable = screen.getAllByText('Nutrition information currently unavailable.');
    // All three — including the two that have complete records behind the gate.
    expect(unavailable).toHaveLength(THREE.length);
  });

  it('still lists every catalogue product rather than filtering any out', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-CER_MAIDA');

    for (const entry of THREE) {
      expect(screen.getByTestId(`nutrition-card-${entry.code}`)).toBeInTheDocument();
      expect(screen.getByText(entry.name)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^nutrition-card-/)).toHaveLength(THREE.length);
  });

  it('reports plainly that nothing is published, rather than that nothing is known', async () => {
    renderPage();
    expect(
      await screen.findByText(/3 of 3 items · nutrition information is not currently published for any item/)
    ).toBeInTheDocument();
  });

  it('leaks NO IFCT figure, food code, food name or citation into the DOM', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-CER_MAIDA');
    const dom = document.body.textContent ?? '';

    for (const code of WITH_RECORDS) {
      const record = rikNutrition[code]!;
      // Every number the record holds, taken from the record itself so this
      // cannot drift if the dataset is re-transcribed.
      for (const value of [
        record.energyKcal,
        record.energyKJ,
        record.carbohydrateG,
        record.fatG,
        record.fibreG,
        record.proteinG,
      ]) {
        expect(dom, `${code}: ${String(value)} must not be on the page`).not.toContain(String(value));
      }
      expect(dom, `${code} IFCT code`).not.toContain(record.sourceCode!);
      expect(dom, `${code} IFCT food name`).not.toContain(record.sourceFood);
      expect(dom).not.toContain(String(record.printedPage));
    }

    expect(dom).not.toContain(IFCT_CITATION);
    expect(dom).not.toMatch(/Indian Food Composition Tables/i);
    expect(dom).not.toMatch(/kilojoule|\bkJ\b|\bkcal\b/i);
    // No table is rendered at all, so none of its row labels can appear.
    // The table's own row labels. No table is rendered at all, so none of
    // them can appear. NOTE: the page's intro paragraph legitimately mentions
    // "per 100 g edible portion" and "food-composition table", so those
    // phrases are NOT leak indicators and are not asserted against here.
    expect(dom).not.toMatch(/Energy \(converted\)|Energy \(as published\)/i);
    expect(dom).not.toMatch(/Dietary fibre|Carbohydrate|Total fat|Total sugars/i);
    expect(dom).not.toMatch(/Transcribed from a published food-composition table/i);
  });

  it('offers no nutrition claim while nothing is published', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-CER_MAIDA');
    const dom = document.body.textContent ?? '';
    // "Source of dietary fibre" is earned by 41 of the 51 records. None of it
    // may surface while the figures behind it are withheld.
    expect(dom).not.toMatch(/Source of dietary fibre|Source of protein/i);
    expect(dom).not.toMatch(/cure|prevent|treat|disease/i);
  });

  it('keeps the search working, so the page is usable rather than merely blank', async () => {
    renderPage();
    await screen.findByTestId('nutrition-card-CER_MAIDA');
    // The page is not an error state: it is a working list with a withheld
    // column. The heading and the search control are both present.
    expect(screen.getByText('Nutrition Info')).toBeInTheDocument();
    // type="search" exposes role="searchbox", not "textbox".
    expect(
      screen.getByRole('searchbox', { name: /search nutrition information/i })
    ).toBeInTheDocument();
  });
});
