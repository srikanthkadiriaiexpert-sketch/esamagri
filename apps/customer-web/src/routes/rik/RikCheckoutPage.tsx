import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { useToast } from '../../design-system/ToastProvider';
import { useRikCart } from '../../lib/cart/RikCartContext';
import { useTransactionGuard } from '../../lib/pwa/update-state';
import type { FulfilmentMethod } from '../../lib/api/types';

/**
 * Pickup/delivery selection (STEP 8 Section 5/13). This is the whole
 * of RIK "checkout" — there is no payment step. Submitting does not
 * hit a real order-creation endpoint yet (no RIK order engine exists
 * — STEP 8 Section 14/23), so this clears the cart locally and shows
 * a confirmation rather than pretending to create a real order.
 */
export function RikCheckoutPage() {
  const cart = useRikCart();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [method, setMethod] = useState<FulfilmentMethod>('PICKUP');
  const [submitting, setSubmitting] = useState(false);

  // Precautionary. This screen makes NO API call today — it is a local
  // preview until the RIK order engine ships (see the Alert below) — so this
  // guard protects nothing yet. It is here so that the call site is not
  // missed when submitting becomes real.
  useTransactionGuard(submitting);

  function onSubmit() {
    setSubmitting(true);
    window.setTimeout(() => {
      cart.clear();
      showToast({ tone: 'success', title: 'Request submitted', description: 'Your RIK request has been recorded.' });
      navigate('/rik/orders');
    }, 400);
  }

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Pickup or delivery" showBack tone="forest" />
      <main className="p-4">
        <Alert tone="info" title="RIK order engine not yet built">
          This confirms your selection locally for preview purposes — real request submission arrives with the RIK business
          module.
        </Alert>

        <div className="mt-4 flex flex-col gap-3">
          {(
            [
              { value: 'PICKUP', label: 'Pickup', description: 'Collect from the RIK counter' },
              { value: 'DELIVERY', label: 'Delivery', description: 'Deliver to your registered quarter' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setMethod(opt.value)}
              className={[
                'flex items-center justify-between rounded-2xl border p-4 text-left',
                method === opt.value ? 'border-brand-blue bg-brand-blueLight' : 'border-slate-200 bg-white',
              ].join(' ')}
            >
              <span>
                <span className="block text-sm font-bold text-slate-900">{opt.label}</span>
                <span className="block text-xs text-slate-500">{opt.description}</span>
              </span>
              <span
                className={[
                  'flex h-5 w-5 items-center justify-center rounded-full border-2',
                  method === opt.value ? 'border-brand-blue bg-brand-blue' : 'border-slate-300',
                ].join(' ')}
              >
                {method === opt.value ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
              </span>
            </button>
          ))}
        </div>

        <Button accent="blue" size="lg" fullWidth className="mt-6" loading={submitting} onClick={onSubmit}>
          Confirm request
        </Button>
      </main>
    </div>
  );
}
