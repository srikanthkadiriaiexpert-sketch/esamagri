import type { ReactNode } from 'react';
import { Button } from './Button';

export interface ModuleEntryCardProps {
  module: 'rik' | 'pif';
  title: string;
  subtitle: string;
  icon: ReactNode;
  bullets: readonly { icon: ReactNode; label: string }[];
  ctaLabel: string;
  onClick: () => void;
}

const MODULE_STYLES = {
  rik: {
    cardBg: 'bg-brand-blueLight',
    circleBg: 'bg-brand-blue',
    titleColor: 'text-brand-blueDark',
  },
  pif: {
    cardBg: 'bg-brand-greenLight',
    circleBg: 'bg-brand-green',
    titleColor: 'text-brand-greenDark',
  },
} as const;

/**
 * The RIK / PIF entry card (STEP 8 Section 4 — the most important UI
 * element on the home screen, per the approved reference: two large,
 * unmissable cards rather than a hidden menu item). RIK renders in
 * the blue family, PIF in the green family, matching the approved UI
 * reference exactly.
 */
export function ModuleEntryCard({ module, title, subtitle, icon, bullets, ctaLabel, onClick }: ModuleEntryCardProps) {
  const style = MODULE_STYLES[module];
  return (
    <div className={['flex flex-1 flex-col rounded-2xl p-4', style.cardBg].join(' ')}>
      <div className="flex flex-col items-center text-center">
        <span className={['flex h-14 w-14 items-center justify-center rounded-full text-white', style.circleBg].join(' ')} aria-hidden="true">
          {icon}
        </span>
        <p className={['mt-2 text-lg font-extrabold', style.titleColor].join(' ')}>{title}</p>
        <p className={['text-xs font-semibold', style.titleColor].join(' ')}>{subtitle}</p>
      </div>
      <ul className="mt-3 space-y-2 border-t border-white/60 pt-3">
        {bullets.map((b, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-slate-700">
            <span className="shrink-0" aria-hidden="true">
              {b.icon}
            </span>
            {b.label}
          </li>
        ))}
      </ul>
      <Button
        accent={module === 'rik' ? 'blue' : 'green'}
        fullWidth
        className="mt-4"
        onClick={onClick}
        rightIcon={
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none">
            <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      >
        {ctaLabel}
      </Button>
    </div>
  );
}
