import type { ReactNode } from 'react';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'bg-semantic-infoLight text-blue-900 border-blue-200',
  success: 'bg-brand-greenLight text-brand-greenDark border-brand-green/30',
  warning: 'bg-brand-amberLight text-brand-amberDark border-brand-amber/40',
  danger: 'bg-semantic-dangerLight text-red-900 border-red-200',
};

const TONE_ICON: Record<AlertTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '!',
  danger: '!',
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** Inline banner for announcements, network warnings, and important inline notices. */
export function Alert({ tone = 'info', title, children, action }: AlertProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={['flex gap-2.5 rounded-xl border p-3.5', TONE_CLASSES[tone]].join(' ')}>
      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/60 text-xs font-bold">
        {TONE_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        {children ? <div className="text-sm">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
