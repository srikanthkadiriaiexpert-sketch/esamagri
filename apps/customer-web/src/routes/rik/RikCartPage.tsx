import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { QuantityStepper } from '../../design-system/QuantityStepper';
import { Button } from '../../design-system/Button';
import { EmptyState } from '../../design-system/StateViews';
import { useRikCart } from '../../lib/cart/RikCartContext';

/**
 * RIK cart (STEP 8 Section 13): RIK products only, entitlement-aware
 * display, no commercial payment anywhere — the checkout step here is
 * pickup/delivery selection, never a payment step (RIK has none).
 */
export function RikCartPage() {
  const cart = useRikCart();
  const navigate = useNavigate();

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="RIK cart" showBack tone="forest" />
      <main className="p-4">
        {cart.lines.length === 0 ? (
          <EmptyState
            title="Your RIK cart is empty"
            description="Browse RIK categories to request items against your entitlement."
            action={{ label: 'Browse RIK', onClick: () => navigate('/rik') }}
          />
        ) : (
          <>
            <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {cart.lines.map((line) => (
                <div key={line.product.id} className="flex items-center gap-3 p-3">
                  <div className="h-14 w-14 shrink-0 rounded-xl bg-slate-100" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{line.product.name}</p>
                    <p className="text-xs text-slate-500">{line.product.unitLabel}</p>
                    {line.product.entitlement ? (
                      <p className="mt-0.5 text-xs font-medium text-brand-blueDark">
                        {line.product.entitlement.remainingQty} {line.product.entitlement.unit} remaining
                      </p>
                    ) : null}
                  </div>
                  <QuantityStepper accent="blue" value={line.quantity} onChange={(qty) => cart.setQuantity(line.product, qty)} />
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-semibold text-slate-700">{cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} in cart</p>
              <p className="mt-1 text-xs text-slate-500">No payment is required for RIK requests — items are issued against your entitlement.</p>
            </div>

            <Button accent="blue" size="lg" fullWidth className="mt-4" onClick={() => navigate('/rik/checkout')}>
              Continue to pickup / delivery
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
