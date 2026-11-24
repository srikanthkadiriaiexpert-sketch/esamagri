import type { ReactNode } from 'react';

export type QuickActionTone = 'amber' | 'blue' | 'green' | 'purple' | 'teal';

/**
 * FILLED containers, not tinted ones.
 *
 * These were a pale wash (…Light) behind a dark glyph, which is what made
 * the row disappear into the white card it sits on. A filled circle in the
 * brand colour with a white glyph gives the row the weight it needs and
 * keeps icon contrast well above the 3:1 a non-text element wants.
 *
 * The `ring` is the old wash, kept as a soft halo so the circles still
 * read as a related family rather than four unconnected dots.
 */
const TONE_CLASSES: Record<QuickActionTone, { bg: string; ring: string }> = {
  amber: { bg: 'bg-brand-amberDark text-white', ring: 'ring-brand-amberLight' },
  blue: { bg: 'bg-brand-blue text-white', ring: 'ring-brand-blueLight' },
  green: { bg: 'bg-brand-green text-white', ring: 'ring-brand-greenLight' },
  purple: { bg: 'bg-brand-purple text-white', ring: 'ring-brand-purpleLight' },
  teal: { bg: 'bg-brand-teal text-white', ring: 'ring-brand-tealLight' },
};

export interface QuickActionTileProps {
  tone: QuickActionTone;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/** The 4-tile quick-action row on the home screen (Shop Now / Our Products / Home Delivery / Community Info in the approved reference). */
export function QuickActionTile({ tone, icon, label, onClick }: QuickActionTileProps) {
  const style = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-touch flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 hover:bg-slate-50"
    >
      <span
        className={['flex h-12 w-12 items-center justify-center rounded-full ring-4', style.bg, style.ring].join(' ')}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="text-center text-[11px] font-semibold leading-tight text-slate-700">{label}</span>
    </button>
  );
}
