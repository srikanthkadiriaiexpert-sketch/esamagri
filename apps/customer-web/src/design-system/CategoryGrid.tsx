import { CategoryCard } from './CategoryCard';
import { LoadingState, EmptyState, ErrorState } from './StateViews';
import type { ResourceState } from '../lib/api/resource';
import type { CategorySummary, CatalogModule } from '../lib/api/catalog-api';

export interface CategoryGridProps {
  module: CatalogModule;
  state: ResourceState<CategorySummary[]>;
  onSelect: (category: CategorySummary) => void;
  onRetry?: () => void;
}

/**
 * The one category-browsing surface both modules use (STEP 9 kickoff
 * Section 10 / Section 14: reusable components, no per-screen
 * duplication). RIK and PIF differ only by the `module` accent — the
 * layout, the states and the touch targets are shared.
 *
 * Every state the resource can be in has a designed rendering, so the
 * screen is never blank and never implies data exists when it does
 * not:
 *
 *  - loading          → skeleton
 *  - not_implemented  → honest "not built yet" (the catalogue module
 *                       genuinely does not exist yet — see catalog-api)
 *  - error            → retryable failure, distinguishable from empty
 *  - success + empty  → "no categories yet", an administered-data
 *                       state, not a bug
 */
export function CategoryGrid({ module, state, onSelect, onRetry }: CategoryGridProps) {
  if (state.status === 'loading') {
    return <LoadingState label="Loading categories…" />;
  }

  if (state.status === 'not_implemented') {
    return (
      <ErrorState
        variant="not_implemented"
        title="Categories are coming soon"
        description={
          module === 'rik'
            ? 'RIK categories will appear here once the ration catalogue is set up by the facility.'
            : 'Grocery categories will appear here once the store catalogue is set up by the facility.'
        }
      />
    );
  }

  if (state.status === 'error') {
    return <ErrorState variant="error" description="Couldn't load categories right now." onRetry={onRetry} />;
  }

  if (state.data.length === 0) {
    return (
      <EmptyState
        title="No categories yet"
        description="Nothing has been published in this section so far."
      />
    );
  }

  return (
    <ul className="grid grid-cols-4 gap-3" role="list">
      {state.data.map((category) => (
        <li key={category.id}>
          <CategoryCard
            accent={module === 'rik' ? 'blue' : 'green'}
            category={{ id: category.id, name: category.name, ...(category.imageUrl ? { imageUrl: category.imageUrl } : {}) }}
            onClick={() => onSelect(category)}
          />
        </li>
      ))}
    </ul>
  );
}
