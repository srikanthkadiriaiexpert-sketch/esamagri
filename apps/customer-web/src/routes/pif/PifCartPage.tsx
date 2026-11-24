import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { QuantityStepper } from '../../design-system/QuantityStepper';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { Dialog } from '../../design-system/Dialog';
import { EmptyState, LoadingState } from '../../design-system/StateViews';
import { RemoteImage } from '../../design-system/RemoteImage';
import { usePifCart } from '../../lib/cart/PifCartContext';
import { quoteCart, rupees, type QuoteResult } from '../../lib/api/pif-api';

/**
 * The PIF cart (PHASE F).
 *
 * THE FIGURES ON THIS SCREEN ARE THE SERVER'S. The cart itself lives in the
 * browser — it is a list of products and quantities — and every time it
 * changes, the server is asked to price it. Line totals, the discount, the
 * GST and the total all come back from `/pif/quote`; this screen adds
 * nothing up. That is the whole reason it makes a network call to show a
 * number it could have multiplied itself: a price, a tax rate or a discount
 * can change between browsing and checkout, and the only figure worth
 * showing a shopper is the one the facility would actually charge.
 *
 * WHAT IT ALSO DOES, by asking: it learns what the server WON'T sell today.
 * An item that went out of stock while the cart sat open comes back in
 * `refused`, with the facility's own sentence, and is shown as a problem to
 * fix rather than silently disappearing or silently being ordered.
 */
export function PifCartPage() {
  const cart = usePifCart();
  const navigate = useNavigate();

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const lines = cart.lines.map((line) => ({ productId: line.product.id, qty: line.quantity }));
  const signature = lines.map((line) => `${line.productId}:${line.qty}`).join('|');

  const refresh = useCallback(async () => {
    if (lines.length === 0) {
      setQuote(null);
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      // Quoted for HOME DELIVERY: this screen has no pickup/delivery choice
      // on it, so it shows the charged case. Choosing pickup at checkout
      // makes the charge disappear, which is the kinder direction to be
      // surprised in.
      setQuote(await quoteCart(lines, 'DELIVERY'));
    } catch {
      setQuote(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
    // `signature` is the real dependency: the cart's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /*
   * THE FREE-DELIVERY POPUP, on the RISING EDGE ONLY.
   *
   * `wasFree` remembers the previous answer, so the dialog appears the moment
   * eligibility goes from charged to free and NOT on every re-quote — the
   * cart re-prices on each quantity tap, and congratulating the shopper four
   * times while they adjust one line would be noise.
   *
   * It starts as null and the first quote only records the state, so a
   * shopper whose basket was already over the threshold when they opened the
   * cart is not congratulated for something they did not just do. If they
   * drop back under and climb again, they are congratulated again, because
   * `wasFree` has gone back to false in between.
   */
  const wasFree = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (quote === null) return;
    if (wasFree.current === false && quote.freeDelivery) setCelebrate(true);
    wasFree.current = quote.freeDelivery;
  }, [quote]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refusedIds = new Set((quote?.refused ?? []).map((item) => item.productId));
  const canCheckout = quote !== null && quote.lines.length > 0 && refusedIds.size === 0;

  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <Header title="Your cart" showBack tone="forest" />
      <main className="p-4">
        {cart.lines.length === 0 ? (
          <EmptyState
            title="Your cart is empty"
            description="Browse categories to add groceries."
            action={{ label: 'Start shopping', onClick: () => navigate('/pif') }}
          />
        ) : (
          <>
            {quote !== null && quote.refused.length > 0 ? (
              <Alert tone="warning" title="Some items cannot be ordered">
                <ul className="mt-1 flex flex-col gap-1">
                  {quote.refused.map((item) => {
                    const line = cart.lines.find((l) => l.product.id === item.productId);
                    return (
                      <li key={item.productId} className="text-sm">
                        {line?.product.name ?? 'An item'} — {item.message}{' '}
                        <button
                          type="button"
                          onClick={() => cart.remove(item.productId)}
                          className="font-semibold underline"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Alert>
            ) : null}

            {failed ? (
              <Alert tone="warning" title="Prices could not be checked">
                The facility&apos;s prices could not be read just now. Your cart is safe — try again
                before placing the order.
              </Alert>
            ) : null}

            <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {cart.lines.map((line) => {
                const priced = quote?.lines.find((l) => l.productId === line.product.id) ?? null;
                return (
                  <div key={line.product.id} className="flex items-center gap-3 p-3">
                    <RemoteImage
                      src={line.product.imageUrl}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      fallback={
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-400">
                          no photo
                        </div>
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{line.product.name}</p>
                      <p className="text-xs text-slate-500">
                        {rupees(line.product.price.amountMinor / 100)} · {line.product.unitLabel}
                      </p>
                      {refusedIds.has(line.product.id) ? (
                        <p className="text-xs font-semibold text-semantic-danger">
                          Not available today
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <QuantityStepper
                        accent="green"
                        value={line.quantity}
                        onChange={(qty) => cart.setQuantity(line.product, qty)}
                        min={0}
                        max={line.product.maxOrderQty ?? 99}
                      />
                      <p className="mt-1 text-xs font-semibold tabular-nums text-slate-600">
                        {priced === null ? '—' : rupees(priced.lineTotal)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              {loading && quote === null ? (
                <LoadingState compact label="Checking today's prices…" />
              ) : quote === null ? (
                <p className="text-sm text-slate-500">
                  The total will be shown once the facility&apos;s prices have been read.
                </p>
              ) : (
                <>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{rupees(quote.subtotal)}</span>
                  </div>
                  {quote.discountTotal > 0 ? (
                    <div className="mt-1 flex justify-between text-sm text-brand-greenDark">
                      <span>Discount</span>
                      <span className="tabular-nums">−{rupees(quote.discountTotal)}</span>
                    </div>
                  ) : null}
                  <div className="mt-1 flex justify-between text-sm text-slate-600">
                    <span>GST</span>
                    <span className="tabular-nums">{rupees(quote.taxTotal)}</span>
                  </div>
                  {/*
                    THE DELIVERY LINE. Free is said in words rather than as
                    "Rs 0.00", because a shopper reads "FREE" and understands
                    it; a zero looks like a figure that has not loaded.
                  */}
                  <div className="mt-1 flex justify-between text-sm text-slate-600">
                    <span>Home delivery</span>
                    {quote.freeDelivery ? (
                      <span className="font-bold text-brand-greenDark">FREE</span>
                    ) : (
                      <span className="tabular-nums">{rupees(quote.deliveryTotal)}</span>
                    )}
                  </div>
                  <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-extrabold text-slate-900">
                    <span>Total</span>
                    <span className="tabular-nums">{rupees(quote.total)}</span>
                  </div>
                  {/*
                    The gap to free delivery, in the server's own figures. The
                    threshold and the fee are never written into this file, so
                    a change of policy needs no change here.
                  */}
                  {quote.freeDelivery ? (
                    <p className="mt-2 text-sm font-bold text-brand-greenDark">
                      Your order qualifies for FREE home delivery.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-brand-blueDark">
                      Add {rupees(quote.amountToFreeDelivery)} more to unlock FREE delivery.
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    Home delivery is free on orders of {rupees(quote.deliveryThreshold)} or more,
                    and {rupees(quote.deliveryFee)} below that. Store pickup is always free.
                    Calculated by the facility. Payable in cash on delivery.
                  </p>
                </>
              )}
            </div>

            <Button
              accent="green"
              size="lg"
              fullWidth
              className="mt-4"
              disabled={!canCheckout}
              onClick={() => navigate('/pif/checkout')}
            >
              Proceed to checkout
            </Button>
          </>
        )}
      </main>

      {/*
        The congratulations popup. A centred Dialog, rendered through a portal
        and dismissible with Escape or the button - never window.alert, which
        blocks the page. It carries no decision: one button, and closing it
        changes nothing about the order.
      */}
      <Dialog
        open={celebrate}
        onClose={() => setCelebrate(false)}
        title="Congratulations!"
        description="Your order is eligible for FREE HOME DELIVERY!"
        confirmLabel="Continue shopping"
        onConfirm={() => setCelebrate(false)}
        confirmAccent="green"
      />
    </div>
  );
}
