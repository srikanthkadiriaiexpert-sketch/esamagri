import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
}

/**
 * Base text input — labelled, with room for an error/hint line and a
 * left/right adornment (e.g. the "+91" prefix on the mobile-number
 * field). Every field state (default/focus/error/disabled) is defined
 * here once.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftAdornment, rightAdornment, id, className = '', ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <div
        className={[
          'flex items-center rounded-xl border bg-white px-3.5 transition-colors',
          'focus-within:ring-2 focus-within:ring-brand-green/30',
          error ? 'border-semantic-danger focus-within:ring-semantic-danger/20' : 'border-slate-300 focus-within:border-brand-green',
        ].join(' ')}
      >
        {leftAdornment ? <span className="mr-2 shrink-0 text-slate-500">{leftAdornment}</span> : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={['h-touch w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400', className].join(' ')}
          {...rest}
        />
        {rightAdornment ? <span className="ml-2 shrink-0 text-slate-500">{rightAdornment}</span> : null}
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1.5 text-sm text-semantic-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
