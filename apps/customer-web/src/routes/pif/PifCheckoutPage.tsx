import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { Dialog } from '../../design-system/Dialog';
import { LoadingState, EmptyState } from '../../design-system/StateViews';
import { SegmentedControl } from '../../design-system/SegmentedControl';
import { useToast } from '../../design-system/ToastProvider';
import { usePifCart } from '../../lib/cart/PifCartContext';
import { useResource } from '../../lib/api/resource';
import { useTransactionGuard } from '../../lib/pwa/update-state';
import { ApiError } from '../../lib/api/client';
import { fetchMyProfile, type CustomerProfile } from '../../lib/api/customer-api';
import {
  newCheckoutKey,
  placeOrder,
  quoteCart,
  rupees,
  type QuoteResult,
} from '../../lib/api/pif-api';

/**
 * Checkout: cash on delivery, and a real order (PHASE F).
 *
 * WHAT THIS SCREEN NO LONGER DOES. It used to take a typed address, wait
 * 400ms, clear the cart and announce "Order confirmed" — a confirmation of
 * nothing, because no order engine existed. It now places a real order and
 * shows the order number the server assigned. Nothing is confirmed that was
 * not recorded.
 *
 * THE ADDRESS IS NOT TYPED. A delivery goes to the officer's own recorded
 * residence: this screen shows it and sends no address at all, the server
 * resolves their default address and freezes it onto the order as text. So
 * editing the residence later cannot rewrite a placed order, and there is no
 * field here through which somebody else's address could be named.
 *
 * NO PAYMENT IS SIMULATED. Cash on delivery is the only method, the total is
 * the server's figure, and this screen never pretends money moved.
 *
 * A DOUBLE TAP CANNOT PLACE TWO ORDERS. One random key is made when this
 * screen opens and sent with every attempt, so a retry — or an impatient
 * second press — is answered with the first order rather than a second one.
 */

/** The officer's own recorded residence, as `/customer/me` reports it. */
function residenceLine(profile: CustomerProfile): string | null {
  const residence = profile.residence;
  if (residence === null) return null;
  return [residence.label, `${residence.quarterBlock}-${residence.quarterNumber}`, residence.landmark]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
}

export function PifCheckoutPage() {
  const cart = usePifCart();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [note, setNote] = useState('');
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<{ orderNumber: string; total: number } | null>(null);

  // No update prompt while an order is being committed. The idempotency key
  // below is per-MOUNT, so it does not survive a reload — reloading between
  // placeOrder() and cart.clear() could place the order twice.
  useTransactionGuard(submitting);

  /** One key for this checkout attempt — see the note above. */
  const idempotencyKey = useMemo(() => newCheckoutKey(), []);

  const lines = cart.lines.map((line) => ({ productId: line.product.id, qty: line.quantity }));
  const signature = lines.map((line) => `${line.productId}:${line.qty}`).join('|');

  // The destination is the officer's own recorded residence. The server
  // resolves it from their default address and freezes it onto the order, so
  // this screen never sends an address id — there is no way for it to name
  // somebody else's address, and a later edit of the residence cannot
  // rewrite a placed order.
  const profile = useResource<CustomerProfile>(() => fetchMyProfile(), undefined, []);
  const destination = profile.status === 'success' ? residenceLine(profile.data) : null;

  useEffect(() => {
    if (lines.length === 0) return;
    let cancelled = false;
    quoteCart(lines, mode)
      .then((result) => {
        if (!cancelled) setQuote(result);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });
    return () => {
      cancelled = true;
    };
    // `mode` is a real dependency, not a cosmetic one: store pickup is free
    // and home delivery may not be, so switching re-prices the order. The
    // server decides the charge; this only tells it which rule applies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, mode]);

  /*
   * THE FREE-DELIVERY POPUP, on the RISING EDGE OF HOME-DELIVERY ELIGIBILITY.
   *
   * Two conditions, both deliberate. It fires only when the previous answer
   * was "charged" and this one is "free", so a re-quote does not congratulate
   * the shopper twice; and only in DELIVERY mode, because in pickup there is
   * nothing to unlock and saying so would be nonsense.
   *
   * Switching to pickup therefore records free-ness without celebrating, and
   * switching back to delivery under the threshold sets `wasFree` to false
   * again - so a shopper who then adds enough is congratulated, once.
   */
  const wasFree = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (quote === null) return;
    if (mode === 'DELIVERY' && wasFree.current === false && quote.freeDelivery) {
      setCelebrate(true);
    }
    wasFree.current = mode === 'DELIVERY' ? quote.freeDelivery : null;
  }, [quote, mode]);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const order = await placeOrder({
        lines,
        fulfillmentMode: mode,
        // Omitted deliberately: the server uses the officer's default
        // address, which is the one shown above.
        deliveryAddressId: null,
        customerNote: note.trim() === '' ? null : note.trim(),
        idempotencyKey,
      });
      cart.clear();
      setPlaced({ orderNumber: order.orderNumber, total: order.total });
      showToast({
        tone: 'success',
        title: `Order ${order.orderNumber} placed`,
        description: 'Pay in cash when it is handed over.',
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'The order could not be placed. Please check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (placed !== null) {
    return (
      <div className="app-shell min-h-screen bg-slate-50">
        <Header title="Order placed" tone="forest" />
        <main className="p-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-sm text-slate-600">Your order number</p>
            <p className="mt-1 text-xl font-extrabold tabular-nums text-brand-greenDark">
              {placed.orderNumber}
            </p>
            <p className="mt-3 text-sm text-slate-700">
              Pay <span className="font-bold tabular-nums">{rupees(placed.total)}</span> in cash when
              your order is handed over.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              The facility will confirm and prepare it. You can follow its progress in My PIF
              Orders.
            </p>
            <Button accent="green" size="lg" fullWidth className="mt-4" onClick={() => navigate('/pif/orders')}>
              See my orders
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const needsAddress = mode === 'DELIVERY' && destination === null;
  const canSubmit = cart.lines.length > 0 && !needsAddress && !submitting;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Checkout" showBack tone="forest" />
      <main className="p-4">
        {cart.lines.length === 0 ? (
          <EmptyState
            title="Your cart is empty"
            description="Add groceries before checking out."
            action={{ label: 'Start shopping', onClick: () => navigate('/pif') }}
          />
        ) : (
          <>
            {error === null ? null : (
              <Alert tone="warning" title="The order was not placed">
                {error}
              </Alert>
            )}

            <section className="mt-3">
              <SegmentedControl
                options={[
                  { value: 'DELIVERY', label: 'Home delivery' },
                  { value: 'PICKUP', label: 'Collect myself' },
                ]}
                value={mode}
                onChange={setMode}
                aria-label="How to receive this order"
              />
            </section>

            {mode === 'DELIVERY' ? (
              <section
                className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"
                aria-labelledby="pif-address"
              >
                <h2 id="pif-address" className="text-sm font-bold text-slate-900">
                  Deliver to
                </h2>
                {profile.status === 'loading' ? <LoadingState compact /> : null}
                {destination === null && profile.status === 'success' ? (
                  <p className="mt-2 text-sm text-slate-600">
                    You have no residence recorded yet. Add your quarter in your account, or choose
                    to collect the order yourself.
                  </p>
                ) : null}
                {destination === null ? null : (
                  <>
                    <p className="mt-2 text-sm font-semibold text-slate-800">{destination}</p>
                    <p className="text-xs text-slate-500">Base Victualling Yard, Visakhapatnam</p>
                  </>
                )}
                {profile.status === 'error' || profile.status === 'not_implemented' ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Your residence could not be read. You can still choose to collect the order
                    yourself.
                  </p>
                ) : null}
              </section>
            ) : (
              <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <h2 className="text-sm font-bold text-slate-900">Collect it yourself</h2>
                <p className="mt-1 text-sm text-slate-600">
                  The facility will tell you when your order is ready to collect.
                </p>
              </section>
            )}

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <label className="block text-sm font-semibold text-slate-700" htmlFor="pif-note">
                Anything the facility should know?
              </label>
              <input
                id="pif-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="Optional — e.g. please come after six"
                className="mt-1 min-h-touch w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </section>

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-900">Payment method</p>
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-brand-greenLight p-3">
                <span aria-hidden="true">💵</span>
                <span className="text-sm font-semibold text-brand-greenDark">Cash on delivery</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                No payment is taken in the app. You pay the facility in cash when your order is
                handed over.
              </p>
            </section>

            <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold text-slate-900">Order summary</h2>
              {quote === null ? (
                <p className="mt-1 text-sm text-slate-500">Reading today&apos;s prices…</p>
              ) : (
                <>
                  <ul className="mt-2 flex flex-col gap-1">
                    {quote.lines.map((line) => (
                      <li key={line.productId} className="flex justify-between gap-3 text-sm text-slate-700">
                        <span className="min-w-0 truncate">
                          {line.name} × {line.qty} {line.unit}
                        </span>
                        <span className="shrink-0 tabular-nums">{rupees(line.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm text-slate-600">
                    <span>GST</span>
                    <span className="tabular-nums">{rupees(quote.taxTotal)}</span>
                  </div>
                  {/*
                    THE DELIVERY LINE, labelled by the mode that is actually
                    selected - "Store pickup" never shows a delivery charge,
                    because there is no delivery. Free is said in words: a
                    shopper reads FREE and understands it, where "Rs 0.00"
                    looks like a figure that failed to load.
                  */}
                  <div className="mt-1 flex justify-between text-sm text-slate-600">
                    <span>{mode === 'PICKUP' ? 'Store pickup' : 'Home delivery'}</span>
                    {quote.freeDelivery ? (
                      <span className="font-bold text-brand-greenDark">FREE</span>
                    ) : (
                      <span className="tabular-nums">{rupees(quote.deliveryTotal)}</span>
                    )}
                  </div>
                  <div className="mt-1 flex justify-between text-base font-extrabold text-slate-900">
                    <span>
                      {mode === 'PICKUP' ? 'Total to pay at collection' : 'Total to pay on delivery'}
                    </span>
                    <span className="tabular-nums">{rupees(quote.total)}</span>
                  </div>
                  {mode === 'PICKUP' ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Store pickup is always free. The amount above is what you pay in cash when
                      you collect.
                    </p>
                  ) : quote.freeDelivery ? (
                    <p className="mt-2 text-sm font-bold text-brand-greenDark">
                      FREE home delivery. The amount above includes delivery and is what you pay
                      in cash at the door.
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm font-semibold text-brand-blueDark">
                        Add {rupees(quote.amountToFreeDelivery)} more to unlock FREE delivery.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Home delivery is {rupees(quote.deliveryFee)} below{' '}
                        {rupees(quote.deliveryThreshold)}, and free at or above it. Store pickup is
                        always free. The amount above includes delivery and is what you pay in cash
                        at the door.
                      </p>
                    </>
                  )}
                </>
              )}
            </section>

            <Button
              accent="green"
              size="lg"
              fullWidth
              className="mt-4"
              disabled={!canSubmit}
              loading={submitting}
              onClick={() => void onSubmit()}
            >
              Place order (cash on delivery)
            </Button>

            {needsAddress ? (
              <p className="mt-2 text-center text-xs text-slate-500">
                Add your quarter in your account, or switch to collecting it yourself.
              </p>
            ) : null}
          </>
        )}
      </main>

      {/*
        The congratulations popup — the same centred Dialog the cart screen
        uses, so the shopper sees one consistent moment whichever screen they
        cross the threshold on. One button, no decision, and closing it
        changes nothing about the order.
      */}
      <Dialog
        open={celebrate}
        onClose={() => setCelebrate(false)}
        title="Congratulations!"
        description="Your order is eligible for FREE HOME DELIVERY!"
        confirmLabel="Continue"
        onConfirm={() => setCelebrate(false)}
        confirmAccent="green"
      />
    </div>
  );
}
