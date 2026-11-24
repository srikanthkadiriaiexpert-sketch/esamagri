import type { ReactNode } from 'react';
import { Button } from './Button';

/**
 * The three states every data-bearing screen area must render (STEP 8
 * Section 23) — never a blank screen. Kept as three small, distinct
 * components rather than one mega-component so each usage site stays
 * readable about which state it's in.
 */

export function LoadingState({ label = 'Loading…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={['flex flex-col items-center justify-center gap-3 text-slate-400', compact ? 'py-8' : 'py-16'].join(' ')} role="status" aria-live="polite">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-green" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden="true">
        {icon ?? <DefaultEmptyIcon />}
      </div>
      <p className="text-base font-semibold text-slate-800">{title}</p>
      {description ? <p className="max-w-xs text-sm text-slate-500">{description}</p> : null}
      {action ? (
        // md, not sm: `sm` is 36px tall, and this is often the only thing on
        // an otherwise empty screen — the one control the reader needs to
        // hit. `sm` stays available for dense rows.
        <Button variant="outline" accent="neutral" size="md" className="mt-3" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  /** Distinguishes "the backend module for this isn't built yet" from a real failure — never shown as a generic scary error. */
  variant?: 'error' | 'unauthorized' | 'forbidden' | 'session_expired' | 'offline' | 'not_implemented';
}

const VARIANT_COPY: Record<NonNullable<ErrorStateProps['variant']>, { title: string; description: string }> = {
  error: { title: 'Something went wrong', description: 'Please try again in a moment.' },
  unauthorized: { title: 'Please sign in again', description: 'Your session could not be verified.' },
  forbidden: { title: "You don't have access", description: 'This section is not available for your account.' },
  session_expired: { title: 'Session expired', description: 'For your security, please sign in again to continue.' },
  offline: { title: 'No internet connection', description: 'Check your connection and try again.' },
  not_implemented: {
    title: 'Coming soon',
    description: 'This part of e Samagri is still being built and will be available in an upcoming update.',
  },
};

export function ErrorState({ title, description, onRetry, variant = 'error' }: ErrorStateProps) {
  const copy = VARIANT_COPY[variant];
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center" role="alert">
      <div
        className={[
          'mb-1 flex h-16 w-16 items-center justify-center rounded-full',
          variant === 'not_implemented' ? 'bg-brand-greenLight text-brand-green' : 'bg-semantic-dangerLight text-semantic-danger',
        ].join(' ')}
        aria-hidden="true"
      >
        {variant === 'offline' ? <OfflineIcon /> : variant === 'not_implemented' ? <BuildingIcon /> : <WarningIcon />}
      </div>
      <p className="text-base font-semibold text-slate-800">{title ?? copy.title}</p>
      <p className="max-w-xs text-sm text-slate-500">{description ?? copy.description}</p>
      {onRetry && variant !== 'not_implemented' ? (
        <Button variant="outline" accent="neutral" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function DefaultEmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <rect x="4" y="7" width="16" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path d="M12 4L21 20H3L12 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}
function OfflineIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path d="M3 3l18 18M8.5 8.7a10 10 0 0 1 11 2M5 12a10 10 0 0 1 2-1.6M12 20h.01M9 16.3a5 5 0 0 1 6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none">
      <path d="M4 21V9l8-5 8 5v12" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={['animate-pulse rounded-lg bg-slate-200', className].join(' ')} />;
}
