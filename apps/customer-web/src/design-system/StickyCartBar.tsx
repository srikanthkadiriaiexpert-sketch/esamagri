import { rupees } from '../lib/api/pif-api';

export interface StickyCartBarProps {
  itemCount: number;
  /** The server's figure, or null while it is still being quoted. */
  total: number | null;
  pricing: boolean;
  onClick: () => void;
}

/**
 * THE SHOPPER'S WAY OUT OF A FULL BASKET.
 *
 * Before this existed, adding an item changed a small badge in the top bar
 * and nothing else. On a phone, halfway down a list of groceries, that badge
 * is off-screen — so an officer who had just added three things had no
 * visible way to go and buy them. That is the defect this component fixes,
 * and it is why the bar is sticky rather than a link somewhere on the page.
 *
 * WHAT IT PROMISES, AND WHAT IT REFUSES TO PROMISE. The item count is the
 * client's own fact and is always shown. The money is the facility's, and
 * comes from `/pif/quote` — until that answers, the bar says "Totalling…"
 * rather than a number of its own invention. A bar that guessed would
 * disagree with the cart screen the moment a discount or a GST rate moved.
 *
 * WHERE IT SITS. Above the bottom navigation, never over it, and clear of the
 * Android home indicator — the layout reserves the space so the last product
 * card in a list is never hidden behind it.
 */
export function StickyCartBar({ itemCount, total, pricing, onClick }: StickyCartBarProps) {
  if (itemCount <= 0) return null;

  const items = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 z-30 px-3" style={{ bottom: 'var(--cart-bar-bottom)' }}>
      <div className="app-shell pointer-events-auto">
        <button
          type="button"
          onClick={onClick}
          aria-label={`View cart — ${items}`}
          className="flex min-h-touch w-full items-center gap-3 rounded-2xl bg-brand-yellow px-4 py-3 text-left shadow-lg ring-1 ring-black/5 transition active:scale-[0.99]"
        >
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green text-white">
            <CartIcon />
            <span
              className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand-forest px-1 text-[10px] font-bold tabular-nums text-white"
              aria-hidden="true"
            >
              {itemCount}
            </span>
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold leading-tight text-brand-forest">View Cart</span>
            <span className="block text-xs font-medium leading-tight text-brand-forest/70 tabular-nums">
              {items}
              {/*
                `typeof total === 'number'` and NOT `total !== null`.
                The prop is typed `number | null`, but a figure that never
                arrived is `undefined`, which passes a null check and then
                dies inside rupees() on `undefined.toFixed`. Testing for the
                type the formatter actually needs is the honest guard, and it
                means the bar does what its own documentation promises: show
                nothing rather than a number it made up.
              */}
              {typeof total === 'number' ? ` · ${rupees(total)}` : pricing ? ' · Totalling…' : ''}
            </span>
          </span>

          <span aria-hidden="true" className="shrink-0 text-brand-forest">
            <ChevronIcon />
          </span>
        </button>
      </div>
    </div>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path
        d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.2L20 7.5H6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="19" r="1.4" fill="currentColor" />
      <circle cx="17" cy="19" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
