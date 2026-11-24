import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { SearchInput } from '../../design-system/SearchInput';
import { ProductCard } from '../../design-system/ProductCard';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { usePifCart } from '../../lib/cart/PifCartContext';
import {
  fetchPifCategories,
  searchPifProducts,
  type PifCategoryNode,
  type PifProductPage,
} from '../../lib/api/pif-api';
import {
  isRejectedProduct,
  rejectedCategoryNames,
} from '../../lib/businesses/unapproved-pif-categories';

/**
 * Server-side search entry point (STEP 8 Section 10 — must scale to
 * 3,000+ PIF SKUs without ever loading the full catalog client-side).
 * The query always hits `/pif/search?q=&page=` and is paginated from
 * the first call (spec PIF-5, ~3,000+ SKUs). No client-side catalogue
 * exists to fall back on, so until the PIF catalogue module is built
 * this screen shows its honest not-implemented state.
 */
export function PifSearchPage() {
  const navigate = useNavigate();
  const cart = usePifCart();
  const [query, setQuery] = useState('');

  const results = useResource<PifProductPage>(
    () =>
      query.trim()
        ? searchPifProducts(query.trim())
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    undefined,
    [query]
  );

  /*
   * SEARCH IS A WAY INTO THE CATALOGUE, so it is gated like the listings.
   * `/pif/search` is server-side and knows nothing about which categories
   * the client approved, so the tree is read here and anything belonging to
   * a rejected category is dropped before it is drawn. Without this, every
   * product removed from the tiles would still be one search away.
   *
   * FAIL CLOSED: if the tree cannot be read, no results are shown, because
   * nothing can be confirmed as approved.
   */
  const tree = useResource<PifCategoryNode[]>(() => fetchPifCategories(), undefined, []);
  const rejectedNames = tree.status === 'success' ? rejectedCategoryNames(tree.data) : null;

  const visibleItems =
    results.status === 'success' && rejectedNames !== null
      ? results.data.items.filter((p) => !isRejectedProduct(p, rejectedNames))
      : null;

  const searching = query.trim().length > 0;
  const loading = results.status === 'loading' || tree.status === 'loading';
  const failed =
    results.status === 'error' ||
    results.status === 'not_implemented' ||
    tree.status === 'error' ||
    tree.status === 'not_implemented';

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Search groceries" showBack tone="forest" />
      <main className="p-4">
        <SearchInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} placeholder="Search groceries…" />

        <div className="mt-4">
          {!searching ? (
            <EmptyState title="Search PIF groceries" description="Try “milk”, “tomato”, or “ice cream”." />
          ) : null}
          {searching && loading ? <LoadingState /> : null}
          {searching && !loading && tree.status === 'error' ? <ErrorState /> : null}
          {searching && !loading && tree.status !== 'error' && results.status === 'error' ? (
            <ErrorState />
          ) : null}
          {searching && !loading && failed && results.status !== 'error' && tree.status !== 'error' ? (
            <EmptyState title="No results" description={`No products found for "${query}".`} />
          ) : null}
          {searching && visibleItems !== null && visibleItems.length === 0 ? (
            <EmptyState title="No results" description={`No products found for "${query}".`} />
          ) : null}
          {searching && visibleItems !== null && visibleItems.length > 0 ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {visibleItems.map((p) => (
                  <ProductCard
                    key={p.id}
                    module="pif"
                    product={p}
                    quantity={cart.quantityOf(p.id)}
                    onAdd={() => cart.addOne(p)}
                    onQuantityChange={(qty) => cart.setQuantity(p, qty)}
                    onClick={() => navigate(`/pif/products/${p.id}`)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
