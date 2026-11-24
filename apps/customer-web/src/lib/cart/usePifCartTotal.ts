import { useEffect, useRef, useState } from 'react';
import { quoteCart } from '../api/pif-api';
import { usePifCart } from './PifCartContext';

export interface PifCartTotal {
  /** How many items the basket holds — always known, never guessed. */
  itemCount: number;
  /**
   * What the GOODS cost, according to the server: subtotal − discount + GST.
   *
   * Deliberately the merchandise figure and not the order total, which now
   * also carries a delivery charge. This value is what the bar has always
   * shown — before delivery existed the two were the same number — so the
   * basket indicator keeps meaning exactly what it meant, and the delivery
   * charge is itemised on the cart and checkout screens, where there is room
   * to explain it. Null until the server has said.
   */
  total: number | null;
  /** True while a quote is in flight and no earlier figure stands. */
  pricing: boolean;
  /** The delivery charge the server would apply to a home delivery, or null. */
  deliveryTotal: number | null;
  /** Whether home delivery would be free, or null before the first answer. */
  freeDelivery: boolean | null;
  /** How much more merchandise would make it free; 0 when it already is. */
  amountToFreeDelivery: number | null;
}

/**
 * What the basket costs — ACCORDING TO THE SERVER.
 *
 * The temptation here is to add up the line prices the cart already holds in
 * memory and show that. It would be instant and it would be wrong: PIF prices
 * carry per-line discounts and three GST rates, and `/pif/quote` is the only
 * place those rules live — and now the delivery rule lives there too. A
 * sticky bar that summed prices itself would be a second implementation of
 * the pricing rules, and the first time a discount or the free-delivery
 * threshold changed it would quietly disagree with the cart screen one tap
 * away.
 *
 * So this asks the server, and until the server answers it shows nothing
 * rather than a number it made up. The count is shown either way, because the
 * count is a fact the client genuinely owns.
 *
 * IT QUOTES FOR HOME DELIVERY, because this hook is mounted on screens that
 * have no pickup/delivery choice on them. That only affects the delivery
 * fields it reports; `total` is the merchandise figure either way, so the bar
 * is unaffected by the mode.
 *
 * DEBOUNCED AND ABORTED. Tapping + four times fires one quote, not four: each
 * change restarts a short timer and aborts the request in flight. That also
 * makes rapid tapping safe — the cart itself is local state, so there is no
 * duplicate-order risk, but there is no point asking the server four times
 * for a basket the shopper is still filling.
 *
 * A FAILED QUOTE KEEPS THE LAST GOOD FIGURE and never clears the basket. The
 * cart screen is where a pricing failure is explained properly; the bar's job
 * is to stay honest and get the shopper there.
 */
export function usePifCartTotal(): PifCartTotal {
  const cart = usePifCart();
  const [total, setTotal] = useState<number | null>(null);
  const [pricing, setPricing] = useState(false);
  const [deliveryTotal, setDeliveryTotal] = useState<number | null>(null);
  const [freeDelivery, setFreeDelivery] = useState<boolean | null>(null);
  const [amountToFreeDelivery, setAmountToFreeDelivery] = useState<number | null>(null);

  // The basket as the quote endpoint wants it. Serialised so the effect
  // re-runs when the CONTENTS change and not when React hands back a new
  // array holding the same lines.
  const payload = cart.lines.map((l) => ({ productId: l.product.id, qty: l.quantity }));
  const key = payload.map((l) => `${l.productId}:${l.qty}`).join('|');

  const lastKey = useRef<string>('');

  useEffect(() => {
    if (payload.length === 0) {
      setTotal(null);
      setPricing(false);
      setDeliveryTotal(null);
      setFreeDelivery(null);
      setAmountToFreeDelivery(null);
      lastKey.current = '';
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    // Only show the pricing state when there is no figure to stand on;
    // otherwise the bar would flicker on every tap.
    if (lastKey.current === '') setPricing(true);

    const timer = setTimeout(() => {
      quoteCart(payload, 'DELIVERY', controller.signal)
        .then((quote) => {
          if (cancelled) return;
          setTotal(quote.merchandiseTotal);
          setDeliveryTotal(quote.deliveryTotal);
          setFreeDelivery(quote.freeDelivery);
          setAmountToFreeDelivery(quote.amountToFreeDelivery);
          lastKey.current = key;
          setPricing(false);
        })
        .catch(() => {
          if (cancelled) return;
          // Keep whatever figure we had. The cart screen reports the failure.
          setPricing(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { itemCount: cart.itemCount, total, pricing, deliveryTotal, freeDelivery, amountToFreeDelivery };
}
