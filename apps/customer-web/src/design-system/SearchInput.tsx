import type { InputHTMLAttributes } from 'react';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onClear?: () => void;
}

/**
 * Mobile-first search field. Deliberately dumb (no debouncing, no
 * fetching) — callers own the query state and decide how/when to hit
 * the server-side search endpoint (STEP 8 Section 10: never load the
 * full 3,000+ SKU PIF catalog client-side; this component is the
 * input half of a server-side-search architecture, not a client
 * filter over an in-memory list).
 */
export function SearchInput({ value, onClear, className = '', ...rest }: SearchInputProps) {
  const hasValue = typeof value === 'string' && value.length > 0;
  return (
    <div
      className={[
        'flex h-touch items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5',
        'focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/30',
        className,
      ].join(' ')}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-slate-400" fill="none">
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M18 18L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        className="h-full w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400"
        {...rest}
      />
      {hasValue && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="flex h-touch w-touch shrink-0 items-center justify-center text-slate-400 hover:text-slate-600"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
