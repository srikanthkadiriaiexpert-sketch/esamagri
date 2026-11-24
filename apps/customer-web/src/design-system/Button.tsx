import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonAccent = 'blue' | 'green' | 'amber' | 'neutral';
export type ButtonSize = 'md' | 'lg' | 'sm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Per the approved UI reference: RIK screens use 'blue' ("Enter RIK"),
   * PIF screens use 'green' (the logo's own green, "Enter PIF"). 'amber'
   * and 'neutral' are used for general/quick-action/utility buttons that
   * aren't module-specific.
   */
  accent?: ButtonAccent;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const ACCENT_CLASSES: Record<ButtonAccent, Record<ButtonVariant, string>> = {
  blue: {
    primary: 'bg-brand-blue text-white hover:bg-brand-blueDark active:bg-brand-blueDark',
    secondary: 'bg-brand-blueLight text-brand-blueDark hover:bg-brand-blue/20',
    outline: 'border border-brand-blue text-brand-blue hover:bg-brand-blueLight',
    ghost: 'text-brand-blue hover:bg-brand-blueLight',
    danger: 'bg-semantic-danger text-white hover:bg-red-700',
  },
  green: {
    primary: 'bg-brand-green text-white hover:bg-brand-greenDark active:bg-brand-greenDark',
    secondary: 'bg-brand-greenLight text-brand-greenDark hover:bg-brand-green/20',
    outline: 'border border-brand-green text-brand-green hover:bg-brand-greenLight',
    ghost: 'text-brand-green hover:bg-brand-greenLight',
    danger: 'bg-semantic-danger text-white hover:bg-red-700',
  },
  amber: {
    primary: 'bg-brand-amber text-white hover:bg-brand-amberDark',
    secondary: 'bg-brand-amberLight text-brand-amberDark hover:bg-brand-amber/30',
    outline: 'border border-brand-amber text-brand-amberDark hover:bg-brand-amberLight',
    ghost: 'text-brand-amberDark hover:bg-brand-amberLight',
    danger: 'bg-semantic-danger text-white hover:bg-red-700',
  },
  neutral: {
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-semantic-danger text-white hover:bg-red-700',
  },
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-touch px-5 text-base gap-2',
};

/**
 * The single button primitive for the whole app. Every other
 * screen-level "button" (Add to cart, Place order, etc.) should
 * compose this rather than styling a raw <button>, so touch-target
 * size (min 44px — STEP 8 Section 25) and focus states stay
 * consistent everywhere.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    accent = 'blue',
    size = 'md',
    fullWidth = false,
    loading = false,
    leftIcon,
    rightIcon,
    disabled,
    className = '',
    children,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center rounded-xl font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        fullWidth ? 'w-full' : '',
        SIZE_CLASSES[size],
        ACCENT_CLASSES[accent][variant],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      <span>{children}</span>
      {!loading ? rightIcon : null}
    </button>
  );
});
