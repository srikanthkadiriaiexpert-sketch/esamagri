import { useNavigate, useParams } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { ProductCard } from '../../design-system/ProductCard';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { usePifCart } from '../../lib/cart/PifCartContext';
import {
  fetchPifCategories,
  fetchPifCategoryProducts,
  type PifCategoryNode,
  type PifProductPage,
} from '../../lib/api/pif-api';
import { rejectedCategoryIds } from '../../lib/businesses/unapproved-pif-categories';

export function PifCategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const cart = usePifCart();

  // Server-side pagination from the first call: the catalogue is meant to
  // hold thousands of SKUs and this screen never asks for all of them.
  const products = useResource<PifProductPage>(
    () => fetchPifCategoryProducts(categoryId ?? ''),
    undefined,
    [categoryId]
  );

  /*
   * THIS ROUTE IS REACHABLE WITHOUT A LISTING — by a typed URL, a stale
   * link, the back button or a bookmark. Filtering the tiles elsewhere
   * would therefore leave the rejected categories' products one address
   * away, which is precisely the outcome the client ruled out. The tree is
   * fetched so this screen can decide for itself whether the id it was
   * handed is one of them.
   */
  const tree = useResource<PifCategoryNode[]>(() => fetchPifCategories(), undefined, []);
  const refused =
    tree.status === 'success' &&
    categoryId !== undefined &&
    rejectedCategoryIds(tree.data).has(categoryId);

  /** Products are drawn only once the category is known to be approved. */
  const visibleItems =
    !refused && tree.status === 'success' && products.status === 'success'
      ? products.data.items
      : null;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="Products"
        showBack
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/pif/cart')} />}
      />
      <main className="p-4">
        {refused ? (
          <EmptyState
            title="This category is not part of the catalogue"
            description="It was removed from the e Samagri catalogue. Browse the current categories instead."
            action={{ label: 'Browse categories', onClick: () => navigate('/pif') }}
          />
        ) : null}
        {refused ? null : products.status === 'loading' || tree.status === 'loading' ? (
          <LoadingState />
        ) : null}
        {/* FAIL CLOSED. If the category tree cannot be read, this screen
            cannot tell an approved category from a rejected one, so it
            shows the error rather than the products. Guessing in the
            customer's favour here is what would put a rejected category's
            products back on screen the one time the check is unavailable. */}
        {!refused && (products.status === 'error' || tree.status === 'error') ? (
          <ErrorState onRetry={() => window.location.reload()} />
        ) : null}
        {!refused && (products.status === 'not_implemented' || tree.status === 'not_implemented') ? (
          <ErrorState variant="not_implemented" description="The PIF catalog is being built and will appear here soon." />
        ) : null}
        {visibleItems !== null && visibleItems.length === 0 ? (
          <EmptyState title="No products in this category" />
        ) : null}
        {visibleItems !== null && visibleItems.length > 0 ? (
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
      </main>
    </div>
  );
}
