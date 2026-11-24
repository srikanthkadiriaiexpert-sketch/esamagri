import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError } from '../../../lib/api/client';
import { fetchEntitlement, type EntitlementResponse } from '../../../lib/api/rik-entitlement-api';

/**
 * Loads and holds the customer's entitlement (STEP 11D).
 *
 * The one thing worth understanding about this hook: it never predicts.
 * Every mutation route returns the recalculated entitlement, so after a
 * change the screen adopts the server's answer wholesale via
 * `reconcile`. There is no optimistic update anywhere, because an
 * optimistic entitlement figure is a number the customer might plan
 * around that the server never agreed to.
 *
 * The distinct non-success states exist because they call for genuinely
 * different responses from the customer, and are told apart by the
 * stable `reason` code the API sends — never by matching its wording.
 */

export type EntitlementState =
  | { status: 'loading' }
  | { status: 'ready'; data: EntitlementResponse }
  /** No ration period is open. Nothing is wrong; there is just nothing to show. */
  | { status: 'no_period' }
  /** The customer must set their dietary preference before anything applies. */
  | { status: 'no_dietary_preference'; message: string }
  /** The facility has not recorded this customer's eligible days yet. */
  | { status: 'no_eligible_days'; message: string }
  | { status: 'error'; error: unknown };

function reasonOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const reason = error.details?.reason;
  return typeof reason === 'string' ? reason : null;
}

export function toEntitlementState(error: unknown): EntitlementState {
  switch (reasonOf(error)) {
    case 'DIETARY_PREFERENCE_NOT_SET':
      return { status: 'no_dietary_preference', message: (error as ApiError).message };
    case 'ELIGIBILITY_NOT_RECORDED':
      return { status: 'no_eligible_days', message: (error as ApiError).message };
    case 'NO_OPEN_PERIOD':
    case 'PERIOD_NOT_FOUND':
      return { status: 'no_period' };
    default:
      return { status: 'error', error };
  }
}

export interface UseEntitlementResult {
  state: EntitlementState;
  /** Re-read from the server. */
  reload: () => void;
  /** Adopt the entitlement a mutation route just returned. */
  reconcile: (next: EntitlementResponse) => void;
  /** Turn a failed mutation into the right screen state, or leave the data alone. */
  handleMutationError: (error: unknown) => void;
}

export function useEntitlement(): UseEntitlementResult {
  const [state, setState] = useState<EntitlementState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    setState({ status: 'loading' });

    fetchEntitlement()
      .then((data) => {
        if (!cancelled.current) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (cancelled.current) return;
        setState(toEntitlementState(err));
      });

    return () => {
      cancelled.current = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const reconcile = useCallback((next: EntitlementResponse) => setState({ status: 'ready', data: next }), []);

  /**
   * A mutation that fails because the session or the period changed
   * underneath the customer replaces the screen. Anything else — a
   * network blip, a server error on one tap — leaves the entitlement on
   * screen as it was, because throwing away a correct view of the
   * ration over one failed tap helps nobody.
   */
  const handleMutationError = useCallback((error: unknown) => {
    const reason = reasonOf(error);
    if (reason !== null) {
      setState(toEntitlementState(error));
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      setState({ status: 'error', error });
    }
    if (error instanceof NetworkError) return;
  }, []);

  return { state, reload, reconcile, handleMutationError };
}

/**
 * Find one category across both issue types. The category screen is
 * addressed by pool id, and which list it lives in is the server's
 * business, not the route's.
 */
export function findCategory(data: EntitlementResponse, poolId: string) {
  return [...data.fresh, ...data.dry].find((c) => c.poolId === poolId) ?? null;
}
