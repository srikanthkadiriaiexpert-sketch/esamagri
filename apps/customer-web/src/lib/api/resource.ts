import { useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, NotImplementedError } from './client';

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T; isDevFixture: boolean }
  | { status: 'not_implemented' }
  | { status: 'error'; error: unknown };

/**
 * Fetches a resource from the real backend; if the route reports
 * NotImplementedError (the RIK/PIF/announcement business modules
 * genuinely don't exist yet — see STEP 8 Section 28), falls back to
 * the supplied dev fixture and marks the result `isDevFixture: true`
 * so the screen can render <PreviewDataNote/>. Any other failure
 * (a real ApiError, a NetworkError) surfaces as `status: 'error'` —
 * dev fixtures are never used to paper over an actual failure, only
 * over a route that is documented as not built yet.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  devFallback: T | undefined,
  deps: readonly unknown[]
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loaderRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data, isDevFixture: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotImplementedError) {
          if (devFallback !== undefined) {
            setState({ status: 'success', data: devFallback, isDevFixture: true });
          } else {
            setState({ status: 'not_implemented' });
          }
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
