import { useNavigate, useParams } from 'react-router-dom';
import { Header, HeaderCartButton } from '../../design-system/Header';
import { QuantityStepper } from '../../design-system/QuantityStepper';
import { Button } from '../../design-system/Button';
import { LoadingState, EmptyState, ErrorState } from '../../design-system/StateViews';
import { RemoteImage } from '../../design-system/RemoteImage';
import { useResource } from '../../lib/api/resource';
import { ApiError } from '../../lib/api/client';
import { usePifCart } from '../../lib/cart/PifCartContext';
import { fetchPifProduct, rupees, type PifProductDetail } from '../../lib/api/pif-api';

/**
 * One grocery product (PHASE F).
 *
 * Everything on this screen is the catalogue row the facility's own staff
 * wrote: the photograph they uploaded, the brand, the pack, the price, the
 * GST that applies and the quantity rules. Nothing is computed here — the
 * price shown is the list price, and what the basket actually costs is the
 * server's answer on the cart screen.
 *
 * AVAILABILITY IS NOT A STOCK COUNT. "Out of stock today" is the switch an
 * administrator set this morning; the app never shows a quantity on hand,
 * because PIF holds none.
 *
 * A deactivated product reads as NOT FOUND, exactly as one that never
 * existed — the server does not serve it and this screen does not hint at it.
 */
export function PifProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const cart = usePifCart();

  const product = useResource<PifProductDetail>(
    () => fetchPifProduct(productId ?? ''),
    undefined,
    [productId]
  );

  const notFound =
    product.status === 'error' && product.error instanceof ApiError && product.error.status === 404;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header
        title="Product details"
        showBack
        tone="forest"
        rightSlot={<HeaderCartButton count={cart.itemCount} dark onClick={() => navigate('/pif/cart')} />}
      />
      <main className="p-4">
        {product.status === 'loading' ? <LoadingState /> : null}
        {notFound ? (
          <EmptyState
            title="Not in the catalogue"
            description="This product is not available. It may have been withdrawn."
          />
        ) : product.status === 'error' ? (
          <ErrorState />
        ) : null}
        {product.status === 'not_implemented' ? <ErrorState variant="not_implemented" /> : null}

        {product.status === 'success' ? (
          <article aria-label={product.data.name}>
            <RemoteImage
              src={product.data.imageUrl}
              alt={product.data.name}
              className="mt-2 aspect-square w-full rounded-2xl object-cover"
              fallback={
                <div className="mt-2 flex aspect-square w-full items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-400">
                  No picture
                </div>
              }
            />

            <h1 className="mt-4 text-lg font-extrabold text-slate-900">{product.data.name}</h1>
            {product.data.brand === null || product.data.brand === undefined ? null : (
              <p className="text-sm text-slate-600">{product.data.brand}</p>
            )}
            <p className="text-sm text-slate-500">
              {product.data.unitLabel}
              {product.data.categoryName === null || product.data.categoryName === undefined
                ? ''
                : ` · ${product.data.categoryName}`}
            </p>

            <p className="mt-1.5 flex items-baseline gap-2">
              <span className="text-xl font-extrabold text-slate-900">
                {rupees(product.data.price.amountMinor / 100)}
              </span>
              <span className="text-xs text-slate-500">per {product.data.unitLabel}</span>
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {product.data.taxRatePct === undefined || product.data.taxRatePct === 0
                ? 'No tax applies to this item.'
                : `${product.data.taxRateName ?? 'GST'} at ${product.data.taxRatePct}% is added at checkout.`}
              {product.data.discountPct === null || product.data.discountPct === undefined
                ? ''
                : ` A ${product.data.discountPct}% discount is applied at checkout.`}
            </p>

            {product.data.description === null || product.data.description === undefined ? null : (
              <p className="mt-3 text-sm leading-relaxed text-slate-700">{product.data.description}</p>
            )}

            {product.data.sku === undefined ? null : (
              <p className="mt-2 text-xs tabular-nums text-slate-400">Item code {product.data.sku}</p>
            )}

            <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
              <span className="text-sm font-semibold text-slate-700">Quantity</span>
              {product.data.inStock ? (
                <QuantityStepper
                  accent="green"
                  value={cart.quantityOf(product.data.id)}
                  onChange={(qty) => cart.setQuantity(product.data, qty)}
                  min={0}
                  max={product.data.maxOrderQty ?? 99}
                />
              ) : (
                <span className="text-sm font-semibold text-semantic-danger">Out of stock today</span>
              )}
            </div>

            <p className="mt-1 text-xs text-slate-500">
              {product.data.maxOrderQty === null || product.data.maxOrderQty === undefined
                ? `Minimum ${product.data.minOrderQty ?? 1} ${product.data.unitLabel} per order.`
                : `Between ${product.data.minOrderQty ?? 1} and ${product.data.maxOrderQty} ${product.data.unitLabel} per order.`}
            </p>

            {product.data.variants.length === 0 ? null : (
              <section className="mt-5" aria-labelledby="pif-variants">
                <h2 id="pif-variants" className="text-sm font-bold text-slate-900">
                  Other sizes
                </h2>
                <ul className="mt-2 flex flex-col gap-2">
                  {product.data.variants.map((variant) => (
                    <li key={variant.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/pif/products/${variant.id}`)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left"
                      >
                        <span className="text-sm text-slate-800">
                          {variant.variantLabel ?? variant.unitLabel}
                        </span>
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {rupees(variant.price.amountMinor / 100)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Button
              accent="green"
              size="lg"
              fullWidth
              className="mt-5"
              disabled={!product.data.inStock}
              onClick={() => {
                cart.setQuantity(
                  product.data,
                  Math.max(cart.quantityOf(product.data.id), product.data.minOrderQty ?? 1)
                );
                navigate('/pif/cart');
              }}
            >
              {product.data.inStock ? 'Add to cart' : 'Out of stock today'}
            </Button>
          </article>
        ) : null}
      </main>
    </div>
  );
}
