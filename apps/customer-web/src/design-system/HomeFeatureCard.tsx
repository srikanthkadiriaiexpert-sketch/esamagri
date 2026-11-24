import type { ReactNode } from 'react';

/**
 * The large home shortcut card from the approved reference image.
 *
 * ONE CARD, TWO ARRANGEMENTS, ONE SET OF MARKUP. The reference is a wide
 * three-across composition, which is the wrong shape for a 360px phone — three
 * full-height cards stacked would push the announcements below two screens of
 * scroll. So the same card lays itself out two ways and the breakpoint does
 * the work, with `flex-wrap` rather than a duplicated arrow or a second
 * component:
 *
 *   phone  — picture, text and arrow on one line, a comfortable 72px-tall row
 *   sm+    — picture across the top, then the text and the arrow beneath it,
 *            which is the reference composition exactly
 *
 * Nothing is hidden at either width: the same picture, heading, subtitle and
 * arrow are present throughout, so no content is lost on a narrow screen and
 * there is no second DOM tree for a test to disagree with.
 *
 * THE WHOLE CARD IS THE CONTROL. It is a real `<button>`, so it is reachable
 * and operable from a keyboard, carries a visible focus ring, and takes its
 * accessible name from the heading and subtitle it contains. The arrow is
 * decoration on top of that target, not a separate one — two nested controls
 * would mean two tab stops for one destination.
 */

export type HomeFeatureTone = 'amber' | 'green' | 'blue';

interface ToneStyle {
  /** The pastel card wash. */
  surface: string;
  /** Heading colour — dark navy, except the green card, which the reference tints. */
  title: string;
  /** The filled arrow disc. Each is >= 3:1 against the white glyph it carries. */
  arrow: string;
  /** Focus ring, matched to the card rather than a single generic blue. */
  ring: string;
}

const TONE_STYLES: Record<HomeFeatureTone, ToneStyle> = {
  amber: {
    surface: 'bg-brand-amberLight',
    title: 'text-slate-900',
    arrow: 'bg-brand-amberDark',
    ring: 'focus-visible:ring-brand-amberDark',
  },
  green: {
    surface: 'bg-brand-greenLight',
    title: 'text-brand-greenDark',
    arrow: 'bg-brand-green',
    ring: 'focus-visible:ring-brand-green',
  },
  blue: {
    surface: 'bg-brand-blueLight',
    title: 'text-slate-900',
    arrow: 'bg-brand-blue',
    ring: 'focus-visible:ring-brand-blue',
  },
};

export interface HomeFeatureCardProps {
  tone: HomeFeatureTone;
  title: string;
  /** Up to two short lines, as the reference shows them. */
  subtitle: readonly string[];
  /** The illustration, sized by this component. */
  art: (props: { className?: string }) => ReactNode;
  onClick: () => void;
  /**
   * For a shortcut whose destination does not exist yet. The card still
   * renders in full, but it is a genuinely disabled button — not a live
   * control that silently does nothing — and it says so on its face.
   */
  disabled?: boolean;
  /** Shown instead of `subtitle` while disabled. */
  disabledNote?: string;
}

export function HomeFeatureCard({
  tone,
  title,
  subtitle,
  art: Art,
  onClick,
  disabled = false,
  disabledNote = 'Coming soon',
}: HomeFeatureCardProps) {
  const style = TONE_STYLES[tone];
  const lines = disabled ? [disabledNote] : subtitle;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={[
        'w-full rounded-2xl p-3 text-left shadow-card sm:p-4',
        style.surface,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        style.ring,
        // Lifted on hover, but only where the viewer has not asked for less
        // movement. `motion-safe` leaves the card perfectly still under
        // prefers-reduced-motion instead of animating anyway.
        disabled
          ? 'cursor-not-allowed opacity-70'
          : 'motion-safe:transition-transform motion-safe:duration-150 motion-safe:hover:-translate-y-0.5',
      ].join(' ')}
    >
      <span className="flex flex-nowrap items-center gap-3 sm:flex-wrap sm:gap-y-3">
        {/* w-full at sm is what makes the picture take a line of its own and
            the text and arrow fall beneath it — the reference arrangement. */}
        <Art className="h-16 w-16 shrink-0 sm:mx-auto sm:h-32 sm:w-full" />

        <span className="min-w-0 flex-1">
          <span className={['block text-base font-extrabold leading-tight sm:text-lg', style.title].join(' ')}>
            {title}
          </span>
          {lines.map((line) => (
            <span key={line} className="mt-0.5 block text-xs leading-snug text-slate-600 sm:text-sm">
              {line}
            </span>
          ))}
        </span>

        <span
          aria-hidden="true"
          className={[
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-sm sm:h-11 sm:w-11',
            disabled ? 'bg-slate-400' : style.arrow,
          ].join(' ')}
        >
          {disabled ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M7 12h10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path
                d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>
    </button>
  );
}
