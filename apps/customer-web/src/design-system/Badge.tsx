import type { HTMLAttributes } from 'react';

export type BadgeTone = 'neutral' | 'green' | 'amber' | 'danger' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  green: 'bg-brand-greenLight text-brand-greenDark',
  amber: 'bg-brand-amberLight text-brand-amberDark',
  danger: 'bg-semantic-dangerLight text-semantic-danger',
  info: 'bg-semantic-infoLight text-semantic-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
        TONE_CLASSES[tone],
        className,
      ].join(' ')}
      {...rest}
    />
  );
}

