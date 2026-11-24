import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { SearchInput } from '../../design-system/SearchInput';
import { ProductCard } from '../../design-system/ProductCard';
import { EmptyState, ErrorState, LoadingState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import { useRikCart } from '../../lib/cart/RikCartContext';
import type { RikProduct } from '../../lib/api/types';

/**
 * Server-side search entry point (spec RIK-2). The query always hits
 * `/rik/search?q=` — there is no client-side catalogue to fall back
 * on, so until the RIK catalogue module exists this screen shows its
 * honest not-implemented state rather than inventing results.
 */
export function RikSearchPage() {
  const navigate = useNavigate();
  const cart = useRikCart();
  const [query, setQuery] = useState('');

  const results = useResource<RikProduct[]>(
    () => (query.trim() ? apiRequest(`/rik/search?q=${encodeURIComponent(query.trim())}`) : Promise.resolve([])),
    undefined,
    [query]
  );

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Search RIK" showBack tone="forest" />
      <main className="p-4">
        <SearchInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} placeholder="Search RIK products…" />

        <div className="mt-4">
          {!query.trim() ? <EmptyState title="Search RIK products" description="Try “rice”, “dal”, or “oil”." /> : null}
          {query.trim() && results.status === 'loading' ? <LoadingState /> : null}
          {query.trim() && results.status === 'error' ? <ErrorState /> : null}
          {query.trim() && (results.status === 'not_implemented' || (results.status === 'success' && results.data.length === 0)) ? (
            <EmptyState title="No results" description={`No RIK products found for "${query}".`} />
          ) : null}
          {query.trim() && results.status === 'success' && results.data.length > 0 ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {results.data.map((p) => (
                  <ProductCard
                    key={p.id}
                    module="rik"
                    product={p}
                    quantity={cart.quantityOf(p.id)}
                    onAdd={() => cart.addOne(p)}
                    onQuantityChange={(qty) => cart.setQuantity(p, qty)}
                    onClick={() => navigate(`/rik/products/${p.id}`)}
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
