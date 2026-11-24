import type { ReactNode } from 'react';
import { ApiError, NetworkError } from '../lib/api/client';

/**
 * The five states every data-dependent administrative screen must be
 * able to show (STEP 10 Section 15): loading, empty, unavailable /
 * not implemented, error, unauthorized. They are separate components
 * rather than one component with a mode, so a screen cannot
 * accidentally render "empty" when it means "forbidden".
 */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-6">
      <span className="h-4 w-4 animate-pulse rounded-full bg-brand-green" aria-hidden="true" />
      <span className="text-sm text-slate-600">{label}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * "This exists in the product, but the module behind it has not been
 * built or its configuration is not confirmed." Visually distinct from
 * an error, because nothing has gone wrong.
 */
export function UnavailableState({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="rounded-xl border border-brand-amber/30 bg-brand-amberLight p-6">
      <p className="text-sm font-semibold text-brand-amberDark">{title}</p>
      <p className="mt-1 text-sm text-brand-amberDark/90">{reason}</p>
    </div>
  );
}

export function UnauthorizedState({ description }: { description?: string }) {
  return (
    <div role="alert" className="rounded-xl border border-semantic-danger/30 bg-semantic-dangerLight p-6">
      <p className="text-sm font-semibold text-semantic-danger">You do not have access to this area</p>
      <p className="mt-1 text-sm text-red-900/80">
        {description ?? 'Your role does not include permission for this. If you believe that is wrong, contact a super administrator.'}
      </p>
    </div>
  );
}

export function ErrorState({ description, onRetry }: { description?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-semantic-danger/30 bg-white p-6">
      <p className="text-sm font-semibold text-semantic-danger">Something went wrong</p>
      <p className="mt-1 text-sm text-slate-600">{description ?? 'This information could not be loaded.'}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Chooses the right state for a failure without ever showing raw server
 * text. 401 and 403 are surfaced honestly and distinctly — the kickoff
 * is explicit that they must not be hidden.
 */
export function FailureState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return <ErrorState description="Your session has expired. Please sign in again." />;
    }
    if (error.status === 403) {
      return <UnauthorizedState />;
    }
  }
  if (error instanceof NetworkError) {
    return <ErrorState description="The server could not be reached. Check your connection and try again." onRetry={onRetry} />;
  }
  return <ErrorState onRetry={onRetry} />;
}
