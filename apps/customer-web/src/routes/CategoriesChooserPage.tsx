import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../design-system/Header';
import { SegmentedControl } from '../design-system/SegmentedControl';
import { CategoryGrid } from '../design-system/CategoryGrid';
import { useResource } from '../lib/api/resource';
import { fetchCategories, type CatalogModule, type CategorySummary } from '../lib/api/catalog-api';

/**
 * Bottom-nav "Categories" tab (STEP 9 kickoff Section 10).
 *
 * Both modules require category navigation (spec RIK-2, PIF-3), and
 * they stay strictly separate: the segmented control switches which
 * module's categories are being browsed, and selecting a category
 * routes into that module's own space. There is no combined RIK+PIF
 * category list, because the two catalogues are different services
 * with different rules.
 *
 * The data comes from the real API. No taxonomy is hardcoded: today
 * the catalogue endpoints do not exist yet, so <CategoryGrid> renders
 * its honest "coming soon" state rather than a made-up list of
 * categories. Final taxonomy is administered data and remains BD-6.
 */
export function CategoriesChooserPage() {
  const navigate = useNavigate();
  const [module, setModule] = useState<CatalogModule>('rik');
  const [reloadKey, setReloadKey] = useState(0);

  const categories = useResource<CategorySummary[]>(
    () => fetchCategories(module),
    // No dev fixture on purpose: inventing categories to fill the
    // screen is exactly what the specification forbids.
    undefined,
    [module, reloadKey]
  );

  const onSelect = useCallback(
    (category: CategorySummary) => {
      navigate(`/${module}/categories/${encodeURIComponent(category.id)}`);
    },
    [module, navigate]
  );

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Categories" />
      <main className="px-4 pb-6 pt-4">
        <SegmentedControl<CatalogModule>
          aria-label="Choose RIK or PIF categories"
          value={module}
          onChange={setModule}
          options={[
            { value: 'rik', label: 'RIK' },
            { value: 'pif', label: 'PIF' },
          ]}
        />

        <p className="mt-2 text-xs text-slate-500">
          {module === 'rik'
            ? 'Ration in Kind — issued against your entitlement.'
            : 'Payment Issue Facility — everyday grocery shopping.'}
        </p>

        <div className="mt-4">
          <CategoryGrid
            module={module}
            state={categories}
            onSelect={onSelect}
            onRetry={() => setReloadKey((k) => k + 1)}
          />
        </div>
      </main>
    </div>
  );
}
