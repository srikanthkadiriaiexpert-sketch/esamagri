import { useMemo, useState } from 'react';
import { useResource } from '../../lib/api/resource';
import { fetchRikCatalogue, packLabel, type Catalogue, type CatalogueItem } from '../../lib/api/rik-catalogue-api';
import {
  DATA_QUALITY_LABELS,
  formatNutrient,
  hasItemLevelRecord,
  nutritionDescriptions,
  nutritionFor,
  NUTRIENT_ROWS,
  type NutritionRecord,
} from '../../data/rikNutrition';
import {
  approvedTypicalNutritionFor,
  TYPICAL_VALUES_DISCLAIMER,
} from '../../data/rikNutritionApproved';
import { Header } from '../../design-system/Header';
import { SearchInput } from '../../design-system/SearchInput';
import { RemoteImage } from '../../design-system/RemoteImage';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';

/**
 * Nutrition Info — a reference page about the food itself.
 *
 * SEPARATE FROM THE RATION SCREENS ON PURPOSE. Nothing here selects, reserves
 * or counts anything: no quantity box, no cart, no entitlement figure. An
 * officer reads it to learn what a food contains, and can do that whether or
 * not they are entitled to it this period.
 *
 * THE CATALOGUE IS THE LIST; NUTRITION IS A LOOKUP. Every active provision
 * the API returns is rendered, in catalogue order, using the catalogue's own
 * name, brand, picture and pack. Nutrition is joined on the provision code
 * and is simply absent for most of them — which is shown plainly rather than
 * hidden. A provision with no nutrition entry is still a provision, and
 * dropping it from the page would be the one failure that matters here.
 *
 * WHAT IS NEVER SHOWN: a zero standing in for a blank, a value without the
 * basis it was measured on, a source that was not consulted, or any statement
 * about preventing or treating illness. See data/rikNutrition.ts for the
 * sourcing rules these screens depend on.
 *
 * RANGES STAY RANGES. The range rendering is retained for any future source
 * that publishes one — it prints "7–8 g", never a midpoint nobody stated.
 * Every record prints the evidence category it belongs to, so a
 * composition-table figure can never be mistaken for a manufacturer's
 * declared one, nor either for an approximation.
 *
 * NOTHING IS PUBLISHED WHILE THE GATE IS CLOSED. The records this page reads
 * are transcribed from ICMR-NIN's IFCT 2017, whose licence forbids storing
 * the data in a product without written permission from NIN. That permission
 * is pending, so data/rikNutrition.ts withholds every such record from
 * `nutritionFor` and this page shows the unavailable message throughout.
 * That is the intended state, not a fault.
 */
export function NutritionInfoPage() {
  const catalogue = useResource<Catalogue>(() => fetchRikCatalogue(), undefined, []);
  const [query, setQuery] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const items = catalogue.status === 'success' ? catalogue.data.items : [];

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return items;
    // Name and brand, which is what an officer knows the item by.
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || (item.brand?.toLowerCase().includes(needle) ?? false)
    );
  }, [items, query]);

  const withNutrition = useMemo(
    () => items.filter((i) => nutritionFor(i.code) !== null || approvedTypicalRecord(i.code) !== null).length,
    [items]
  );

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Header title="Nutrition Info" />

      <div className="flex flex-col gap-3 px-4">
        <p className="text-sm text-slate-600">
          What the ration items contain, per 100 g. Where a figure is a typical value for that kind of
          food rather than a measurement of the product itself, the entry says so.
        </p>

        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          placeholder="Search by name or brand"
          aria-label="Search nutrition information by product name or brand"
        />

        {catalogue.status === 'success' ? (
          <p className="text-xs text-slate-500" aria-live="polite">
            {matches.length} of {items.length} items
            {withNutrition === 0
              ? ' · nutrition information is not currently published for any item'
              : ` · ${withNutrition} with nutrition information`}
          </p>
        ) : null}
      </div>

      {catalogue.status === 'loading' ? <LoadingState label="Loading the catalogue…" /> : null}

      {catalogue.status === 'error' ? (
        <ErrorState
          title="The catalogue could not be loaded"
          description="Check your connection and try again."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : null}

      {catalogue.status === 'success' && matches.length === 0 ? (
        <EmptyState
          title="No items match that search"
          description={`Nothing in the catalogue matches “${query.trim()}”. Try a shorter word.`}
        />
      ) : null}

      {catalogue.status === 'success' && matches.length > 0 ? (
        <ul className="flex flex-col gap-3 px-4" data-testid="nutrition-list" key={reloadKey}>
          {matches.map((item) => (
            <NutritionCard key={item.code} item={item} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NutritionCard({ item }: { item: CatalogueItem }) {
  // MEASURED FIRST, AND NEVER DOWNGRADE. A provision that holds an item-level
  // record is never shown a typical value in its place — not even while that
  // record is withheld. Only the eight approved provisions reach the second
  // branch; everything else keeps the unavailable message.
  const record = nutritionFor(item.code) ?? approvedTypicalRecord(item.code);
  const pack = packLabel(item);

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3" data-testid={`nutrition-card-${item.code}`}>
      <div className="flex items-start gap-3">
        <RemoteImage
          src={item.imageRef}
          alt={item.name}
          className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
          fallback={
            <div
              role="img"
              aria-label={`No picture for ${item.name}`}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-[10px] text-slate-400"
            >
              No picture
            </div>
          }
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-800">{item.name}</p>
          {item.brand ? <p className="mt-0.5 text-xs font-medium text-slate-600">{item.brand}</p> : null}
          <p className="mt-0.5 text-xs text-slate-500">
            {item.poolName ?? 'Uncategorised'}
            {pack ? ` · ${pack}` : ''}
          </p>
        </div>
      </div>

      {record === null ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Nutrition information currently unavailable.
        </p>
      ) : (
        <NutritionTable record={record} name={item.name} />
      )}
    </li>
  );
}

/**
 * The approved typical value for a provision, or null.
 *
 * The item-level check is repeated here as well as inside
 * `approvedTypicalNutritionFor`, on purpose: it is the rule most costly to get
 * wrong, so it is enforced at both the call site and the source.
 */
function approvedTypicalRecord(code: string): NutritionRecord | null {
  if (hasItemLevelRecord(code)) return null;
  return approvedTypicalNutritionFor(code);
}

function NutritionTable({ record, name }: { record: NutritionRecord; name: string }) {
  const descriptions = nutritionDescriptions(record);

  /**
   * A typical value is not a measurement of this product, so the screen says
   * so and shows no source name and no citation. Those details stay on the
   * underlying record in data/rikNutritionPreliminary for internal use.
   */
  const isTypicalValue = record.dataQuality === 'approximate-reference';

  /**
   * For a typical value, show only the nutrients that carry a figure, and
   * label energy plainly — nothing was converted from kilojoules here, so the
   * IFCT row labels would misdescribe it.
   *
   * A STATED ZERO SURVIVES THIS FILTER. Oil really contains no carbohydrate,
   * so `fatG: 0` style values are kept; only `undefined` is dropped. An
   * item-level record is unchanged: there an absent nutrient still prints
   * "Not available", so a blank is never read as a zero.
   */
  const rows = isTypicalValue
    ? NUTRIENT_ROWS.filter((row) => record[row.key] !== undefined).map((row) =>
        row.key === 'energyKcal' ? { ...row, label: 'Energy' } : row
      )
    : NUTRIENT_ROWS;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {isTypicalValue ? record.basis : `${record.basis} · ${record.state}`}
      </p>

      <table className="w-full text-sm">
        <caption className="sr-only">{`Nutrition for ${name}, ${record.basis}`}</caption>
        <tbody>
          {rows.map((row) => {
            const value = record[row.key];
            // undefined means the source does not support this field. It is
            // never rendered as 0 — a blank and a zero are different answers,
            // and a range is never rendered as its midpoint.
            return (
              <tr key={row.key} className="border-b border-slate-100 last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal text-slate-600">
                  {row.label}
                </th>
                <td className="py-1.5 text-right font-medium tabular-nums text-slate-800">
                  {value === undefined ? (
                    <span className="text-slate-400">Not available</span>
                  ) : (
                    formatNutrient(value, row.unit)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {descriptions.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {descriptions.map((description) => (
            <li
              key={description}
              className="rounded-full bg-brand-greenLight px-2.5 py-1 text-xs font-medium text-brand-greenDark"
            >
              {description}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Stated before anything else, so nobody reads a typical value as a
          measurement of this product. */}
      {isTypicalValue ? (
        <p className="text-xs font-medium text-amber-700">{TYPICAL_VALUES_DISCLAIMER}</p>
      ) : (
        <p className="text-xs font-medium text-amber-700">{DATA_QUALITY_LABELS[record.dataQuality]}</p>
      )}

      {/* Source name, matched food and citation render ONLY for a record
          measured for the item. For a typical value they are held internally
          and never shown. */}
      {isTypicalValue ? null : (
        <>
          <p className="text-xs text-slate-500">
            Source: {record.source} — {record.sourceCode ? `${record.sourceCode} ` : ''}
            {record.sourceFood}
          </p>
          {record.notes ? <p className="text-xs text-slate-500">{record.notes}</p> : null}
          {record.citation ? (
            <p className="text-[11px] leading-snug text-slate-400">{record.citation}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
