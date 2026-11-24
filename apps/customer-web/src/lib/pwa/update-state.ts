import { useEffect, useSyncExternalStore } from 'react';

/**
 * WHETHER TO OFFER A RELOAD, AND WHETHER NOW IS A SAFE MOMENT.
 *
 * Two facts live here, and the notification is shown only when the first is
 * true and the second is false:
 *
 *   an update is waiting     the service worker has a new version installed
 *                            and ready, reported by onNeedRefresh in main.tsx
 *   a transaction is in      a checkout or ration confirmation is mid-flight
 *   flight
 *
 * WHY THE SECOND ONE EXISTS. PifCheckoutPage builds its idempotency key with
 * useMemo(..., []) — once per MOUNT — so the key does not survive a reload.
 * Reloading between `await placeOrder(...)` and `cart.clear()` could therefore
 * produce a DUPLICATE COD ORDER. The customer always chooses the moment here
 * (registerType is 'prompt', never 'autoUpdate'), but they must not be
 * OFFERED that choice while an order is being committed.
 *
 * Module-level on purpose: the worker reports its update from main.tsx, before
 * and outside any React tree, and the state has to outlive every component.
 *
 * This file holds no customer data. The cart lives in localStorage
 * (lib/cart/createCartContext.ts) and survives a reload untouched.
 */

type Listener = () => void;

interface Snapshot {
  readonly updateReady: boolean;
  readonly transactionInFlight: boolean;
  readonly dismissed: boolean;
}

const listeners = new Set<Listener>();

let applyUpdate: (() => void) | null = null;
let transactionDepth = 0;
let dismissed = false;

// Referentially stable while nothing changes: useSyncExternalStore compares
// snapshots with Object.is and would loop for ever on a fresh object each call.
let snapshot: Snapshot = { updateReady: false, transactionInFlight: false, dismissed: false };

function publish(): void {
  const next: Snapshot = {
    updateReady: applyUpdate !== null,
    transactionInFlight: transactionDepth > 0,
    dismissed,
  };
  if (
    next.updateReady === snapshot.updateReady &&
    next.transactionInFlight === snapshot.transactionInFlight &&
    next.dismissed === snapshot.dismissed
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/** Called once by main.tsx when the service worker reports a waiting update. */
export function setUpdateReady(apply: () => void): void {
  applyUpdate = apply;
  dismissed = false;
  publish();
}

export function beginTransaction(): void {
  transactionDepth += 1;
  publish();
}

export function endTransaction(): void {
  transactionDepth = Math.max(0, transactionDepth - 1);
  publish();
}

/**
 * Marks the screen's commit window. Pass the page's own in-flight flag;
 * returning the cleanup from the effect means an unmount mid-submit still
 * releases the guard rather than wedging it on for the rest of the session.
 *
 * A depth counter, not a boolean, so two overlapping guards need two releases.
 */
export function useTransactionGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    beginTransaction();
    return endTransaction;
  }, [active]);
}

export interface UpdatePrompt {
  readonly visible: boolean;
  readonly apply: () => void;
  readonly dismiss: () => void;
}

export function useUpdatePrompt(): UpdatePrompt {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    visible: state.updateReady && !state.transactionInFlight && !state.dismissed,
    apply: () => {
      applyUpdate?.();
    },
    // Hides it for THIS page session only — not persisted. The worker is still
    // waiting, so the next page load offers it again. A permanent dismissal
    // would let a customer sit on an old version indefinitely, which is the
    // problem this whole change exists to remove.
    dismiss: () => {
      dismissed = true;
      publish();
    },
  };
}

/** Test-only: resets module state between cases. */
export function resetUpdateStateForTests(): void {
  applyUpdate = null;
  transactionDepth = 0;
  dismissed = false;
  snapshot = { updateReady: false, transactionInFlight: false, dismissed: false };
  listeners.clear();
}
