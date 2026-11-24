import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

export interface CartLine<TProduct> {
  product: TProduct;
  quantity: number;
}

export interface CartApi<TProduct extends { id: string }> {
  lines: readonly CartLine<TProduct>[];
  itemCount: number;
  setQuantity: (product: TProduct, quantity: number) => void;
  addOne: (product: TProduct) => void;
  removeOne: (productId: string) => void;
  remove: (productId: string) => void;
  clear: () => void;
  quantityOf: (productId: string) => number;
}

/**
 * Factory for a module-scoped cart context (STEP 8 Section 7 — RIK and
 * PIF must have strictly separate carts). Each call produces an
 * independent Context/Provider/hook triple with its own private React
 * state; RikCartContext.tsx and PifCartContext.tsx each call this
 * once, so there is no way for an RIK line item and a PIF line item
 * to ever end up in the same array — they're not just filtered by a
 * "module" field, they are two entirely separate state containers.
 * Both providers are mounted once at the app root and simply never
 * read from one another, so switching RIK <-> PIF never "carries" a
 * cart across: there is nothing to carry, the other cart's state was
 * never touched.
 *
 * THE CART SURVIVES A RELOAD (LAUNCH PREPARATION), and this is not a
 * nicety. This is a phone app for a grocery shop: a shopper takes a call,
 * the browser reclaims the tab, the PWA is reopened from the home screen —
 * and before this, every one of those threw away a full basket silently.
 * The rules it follows are deliberate:
 *
 *   * IT IS TIED TO ONE SIGNED-IN CUSTOMER. The key includes `ownerKey`
 *     (the customer's principal id). If nobody is signed in, or the caller
 *     passes no owner — which is what the unit tests do — nothing is read
 *     and nothing is written, and the cart behaves exactly as it did
 *     before: memory only. So one customer's basket can never appear in
 *     front of the next person to sign in on a shared device.
 *   * RIK AND PIF STAY SEPARATE HERE TOO. The key contains the module
 *     label, so the two carts use two keys and could not collide even if
 *     one of them were corrupt.
 *   * STORAGE IS NEVER TRUSTED AND NEVER REQUIRED. Every read and write is
 *     wrapped: private browsing, blocked site data and a quota failure all
 *     end with a working in-memory cart rather than a broken shop. A stored
 *     value that is not the right shape is discarded, not repaired.
 *   * THE STORED PRICE IS A LABEL, NOT A PRICE. What is restored is which
 *     products and how many. Money is quoted by the server at the cart and
 *     checkout screens, as it always was, so a price that moved overnight
 *     is corrected the moment the cart is opened — a restored cart cannot
 *     charge yesterday's price.
 */
export function createCartContext<TProduct extends { id: string }>(moduleLabel: string) {
  const Context = createContext<CartApi<TProduct> | null>(null);
  const keyFor = (ownerKey: string | null | undefined): string | null =>
    ownerKey === null || ownerKey === undefined || ownerKey === ''
      ? null
      : `esamagri.cart.${moduleLabel.toLowerCase()}.${ownerKey}`;

  function Provider({
    children,
    ownerKey = null,
  }: {
    children: ReactNode;
    /** The signed-in customer's id. Omitted → memory only, as before. */
    ownerKey?: string | null;
  }) {
    const storageKey = keyFor(ownerKey);

    // Key and lines live in ONE piece of state on purpose. When the signed-in
    // customer changes, the key and the restored lines must change in the
    // same render, or the save effect below would write the previous
    // customer's basket under the new customer's key.
    const [state, setState] = useState<{ key: string | null; lines: CartLine<TProduct>[] }>(
      () => ({ key: storageKey, lines: restore<TProduct>(storageKey) })
    );
    if (state.key !== storageKey) {
      setState({ key: storageKey, lines: restore<TProduct>(storageKey) });
    }
    const lines = state.lines;
    const setLines = useCallback(
      (next: (prev: CartLine<TProduct>[]) => CartLine<TProduct>[]) =>
        setState((prev) => ({ key: prev.key, lines: next(prev.lines) })),
      []
    );

    useEffect(() => {
      if (state.key === null) return;
      try {
        window.localStorage.setItem(
          state.key,
          JSON.stringify({ v: 1, lines: state.lines })
        );
      } catch {
        // Storage is a convenience. A shopper in a private window still shops.
      }
    }, [state]);

    const setQuantity = useCallback((product: TProduct, quantity: number) => {
      setLines((prev) => {
        if (quantity <= 0) {
          return prev.filter((l) => l.product.id !== product.id);
        }
        const existing = prev.find((l) => l.product.id === product.id);
        if (existing) {
          return prev.map((l) => (l.product.id === product.id ? { ...l, quantity } : l));
        }
        return [...prev, { product, quantity }];
      });
    }, [setLines]);

    const addOne = useCallback(
      (product: TProduct) => {
        setLines((prev) => {
          const existing = prev.find((l) => l.product.id === product.id);
          if (existing) {
            return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
          }
          return [...prev, { product, quantity: 1 }];
        });
      },
      [setLines]
    );

    const removeOne = useCallback((productId: string) => {
      setLines((prev) =>
        prev
          .map((l) => (l.product.id === productId ? { ...l, quantity: l.quantity - 1 } : l))
          .filter((l) => l.quantity > 0)
      );
    }, [setLines]);

    const remove = useCallback((productId: string) => {
      setLines((prev) => prev.filter((l) => l.product.id !== productId));
    }, [setLines]);

    // Clearing empties the stored copy too — an order that has been placed
    // must not come back as a basket on the next visit.
    const clear = useCallback(() => setLines(() => []), [setLines]);

    const quantityOf = useCallback(
      (productId: string) => lines.find((l) => l.product.id === productId)?.quantity ?? 0,
      [lines]
    );

    const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

    const value = useMemo<CartApi<TProduct>>(
      () => ({ lines, itemCount, setQuantity, addOne, removeOne, remove, clear, quantityOf }),
      [lines, itemCount, setQuantity, addOne, removeOne, remove, clear, quantityOf]
    );

    return createElement(Context.Provider, { value }, children);
  }

  function useCart(): CartApi<TProduct> {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`use${moduleLabel}Cart must be used within its <${moduleLabel}CartProvider>`);
    return ctx;
  }

  return { Provider, useCart };
}

/**
 * What is in storage, or nothing.
 *
 * A stored cart is attacker-adjacent data in the sense that matters here:
 * it is whatever happens to be in this browser's storage under that key,
 * which may be corrupt, may be from an older version of the app, or may
 * have been edited by hand. So it is validated line by line and discarded
 * whole if it is not what it claims to be — never patched up into
 * something half-trusted. Quantities are clamped to whole, positive
 * numbers and the basket is capped, because a restored cart is only ever a
 * convenience and the server prices and checks it again anyway.
 */
const MAX_RESTORED_LINES = 100;

function restore<TProduct extends { id: string }>(
  storageKey: string | null
): CartLine<TProduct>[] {
  if (storageKey === null) return [];
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return [];
  }
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const lines = (parsed as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return [];

    const restored: CartLine<TProduct>[] = [];
    for (const line of lines.slice(0, MAX_RESTORED_LINES)) {
      if (typeof line !== 'object' || line === null) return [];
      const { product, quantity } = line as { product?: unknown; quantity?: unknown };
      if (typeof product !== 'object' || product === null) return [];
      if (typeof (product as { id?: unknown }).id !== 'string') return [];
      if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return [];
      restored.push({ product: product as TProduct, quantity: Math.floor(quantity) });
    }
    return restored;
  } catch {
    return [];
  }
}
