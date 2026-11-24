import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

export interface HeaderProps {
  title?: string;
  onBack?: () => void;
  showBack?: boolean;
  rightSlot?: ReactNode;
  tone?: 'light' | 'forest';
}

/** Standard in-app screen header: back button, title, one right-hand action slot (usually cart). */
export function Header({ title, onBack, showBack = false, rightSlot, tone = 'light' }: HeaderProps) {
  const navigate = useNavigate();
  const isDark = tone === 'forest';

  return (
    <header
      className={[
        'sticky top-0 z-30 safe-top',
        // `forest` used to paint a flat #10282C, which read on a phone as a
        // large black slab above every PIF screen. It is now the brand's own
        // green running into the teal at the forest colour's hue: the same
        // family, with somewhere for the eye to go. Text stays white, so
        // contrast against the darker end is unchanged and against the
        // lighter end is still well past the 4.5:1 the body text needs.
        isDark
          ? 'bg-gradient-to-r from-brand-greenDark via-brand-green to-brand-teal text-white'
          : 'border-b border-slate-200 bg-white/95 text-slate-900 backdrop-blur',
      ].join(' ')}
    >
      <div className="app-shell flex h-14 items-center gap-2 px-4">
        {showBack ? (
          <button
            type="button"
            onClick={() => (onBack ? onBack() : navigate(-1))}
            aria-label="Go back"
            className={[
              'flex h-touch w-touch shrink-0 items-center justify-center rounded-full -ml-2',
              isDark ? 'hover:bg-white/10' : 'hover:bg-slate-100',
            ].join(' ')}
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none">
              <path d="M12.5 4.5L6.5 10l6 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        {title ? <h1 className="flex-1 truncate text-base font-bold">{title}</h1> : <div className="flex-1" />}
        {rightSlot}
      </div>
    </header>
  );
}

/** Cart icon button used in the right slot of module headers (RIK/PIF each pass their own count). */
export function HeaderCartButton({ count, onClick, dark }: { count: number; onClick: () => void; dark?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
      className={[
        'relative flex h-touch w-touch shrink-0 items-center justify-center rounded-full',
        dark ? 'hover:bg-white/10' : 'hover:bg-slate-100',
      ].join(' ')}
    >
      <svg aria-hidden="true" viewBox="0 0 22 22" className="h-5.5 w-5.5" fill="none">
        <path
          d="M4 6h1.6L7 15.2A2 2 0 0 0 9 17h7.4a2 2 0 0 0 2-1.7L19.5 8.5H6.3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9.5" cy="19.5" r="1.3" fill="currentColor" />
        <circle cx="16" cy="19.5" r="1.3" fill="currentColor" />
      </svg>
      {count > 0 ? (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-semantic-danger px-1 text-[10px] font-bold text-white">
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </button>
  );
}
