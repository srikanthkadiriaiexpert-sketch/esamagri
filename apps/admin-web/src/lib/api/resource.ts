import { useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, NotImplementedError } from './client';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'not_implemented' }
  | { status: 'error'; error: unknown };

/**
 * Fetches a resource from the real backend and reports exactly what
 * happened: it loaded, the route is not built yet, or it failed.
 *
 * Unlike the customer app's earlier variant, this hook has NO fixture
 * or fallback parameter by design. The admin console must never show a
 * staff member a number, list or row that did not come from the
 * database — so there is no code path here that can substitute one.
 * "Not built yet" is surfaced as `not_implemented` and rendered as an
 * explicit unavailable state, never as data.
 */
export function useResource<T>(loader: () => Promise<T>, deps: readonly unknown[]): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotImplementedError) {
          setState({ status: 'not_implemented' });
          return;
        }
        if (err instanceof ApiError || err instanceof NetworkError) {
          setState({ status: 'error', error: err });
          return;
        }
        setState({ status: 'error', error: err });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
