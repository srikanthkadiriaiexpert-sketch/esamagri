import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export interface BottomNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badgeCount?: number;
  /** matches nested routes too (e.g. Home should stay active under /rik, /pif) */
  matchPrefixes?: string[];
}

export interface BottomNavProps {
  items: readonly BottomNavItem[];
}

/**
 * Primary customer navigation (STEP 8 Section 8): Home / Categories /
 * Orders / Account, deliberately capped at 4 items so it never gets
 * overloaded. Cart is reached from the header/product screens instead
 * of living here, per the same section.
 */
export function BottomNav({ items }: BottomNavProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom"
    >
      <div className="app-shell flex">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.matchPrefixes === undefined}
            className={({ isActive }) => {
              const activeByPrefix = item.matchPrefixes?.some((p) => location.pathname.startsWith(p));
              const active = isActive || activeByPrefix;
              return [
                'relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium',
                active ? 'text-brand-green' : 'text-slate-400',
              ].join(' ');
            }}
          >
            <span className="relative">
              {item.icon}
              {item.badgeCount ? (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-semantic-danger px-1 text-[10px] font-bold text-white">
                  {item.badgeCount > 9 ? '9+' : item.badgeCount}
                </span>
              ) : null}
            </span>
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
