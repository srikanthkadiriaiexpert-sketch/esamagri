import { useNavigate, useParams } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { EntitlementCard } from '../../design-system/EntitlementCard';
import { QuantityStepper } from '../../design-system/QuantityStepper';
import { Button } from '../../design-system/Button';
import { LoadingState, ErrorState } from '../../design-system/StateViews';
import { useResource } from '../../lib/api/resource';
import { apiRequest } from '../../lib/api/client';
import { useRikCart } from '../../lib/cart/RikCartContext';
import type { RikProduct } from '../../lib/api/types';

export function RikProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const cart = useRikCart();

  const product = useResource<RikProduct>(() => apiRequest(`/rik/products/${productId}`), undefined, [productId]);

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="Product details"
        showBack
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/rik/cart')} />}
      />
      <main className="p-4">
        {product.status === 'loading' ? <LoadingState /> : null}
        {product.status === 'error' ? <ErrorState /> : null}
        {product.status === 'not_implemented' ? <ErrorState variant="not_implemented" /> : null}
        {product.status === 'success' ? (
          <>
            <div className="mt-2 aspect-square w-full rounded-2xl bg-slate-100" />
            <h1 className="mt-4 text-lg font-extrabold text-slate-900">{product.data.name}</h1>
            <p className="text-sm text-slate-500">{product.data.unitLabel}</p>

            {product.data.entitlement ? (
              <div className="mt-4">
                <EntitlementCard entitlement={product.data.entitlement} />
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-sm font-semibold text-slate-700">Quantity</span>
              {product.data.inStock ? (
                <QuantityStepper
                  accent="blue"
                  value={cart.quantityOf(product.data.id)}
                  onChange={(qty) => cart.setQuantity(product.data, qty)}
                />
              ) : (
                <span className="text-sm font-semibold text-semantic-danger">Out of stock</span>
              )}
            </div>

            <Button
              accent="blue"
              size="lg"
              fullWidth
              className="mt-4"
              disabled={!product.data.inStock}
              onClick={() => {
                if (cart.quantityOf(product.data.id) === 0) cart.addOne(product.data);
                navigate('/rik/cart');
              }}
            >
              {cart.quantityOf(product.data.id) > 0 ? 'View cart' : 'Add to cart'}
            </Button>
          </>
        ) : null}
      </main>
    </div>
  );
}
