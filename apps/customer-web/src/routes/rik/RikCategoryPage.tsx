import { useNavigate, useParams } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { ProductCard } from '../../design-system/ProductCard';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import { useRikCart } from '../../lib/cart/RikCartContext';
import type { RikProduct } from '../../lib/api/types';

export function RikCategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const cart = useRikCart();

  const products = useResource<RikProduct[]>(
    () => apiRequest(`/rik/categories/${categoryId}/products`),
    undefined,
    [categoryId]
  );

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="RIK products"
        showBack
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/rik/cart')} />}
      />
      <main className="p-4">
        {products.status === 'loading' ? <LoadingState /> : null}
        {products.status === 'error' ? <ErrorState onRetry={() => window.location.reload()} /> : null}
        {products.status === 'not_implemented' ? (
          <ErrorState variant="not_implemented" description="The RIK catalog is being built and will appear here soon." />
        ) : null}
        {products.status === 'success' && products.data.length === 0 ? (
          <EmptyState title="No products in this category" description="Check back soon." />
        ) : null}
        {products.status === 'success' && products.data.length > 0 ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {products.data.map((p) => (
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
      </main>
    </div>
  );
}
