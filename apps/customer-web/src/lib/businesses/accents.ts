import type { BusinessAccent } from './businesses';

/**
 * The approved mockup's per-business colour, as Tailwind classes.
 *
 * Held in one table rather than scattered through the pages, because the
 * same colour has to appear on a numbered badge, an action button and a
 * desktop card, and three slightly different oranges would read as a bug.
 *
 * Every value is from the project's existing palette (tailwind.config.js) —
 * no new colour was introduced to match the mockup.
 */
export interface AccentClasses {
  /** Filled circle carrying the business's position in the list. */
  readonly badge: string;
  /** Primary action button. */
  readonly button: string;
  /** Tinted panel behind the logo on a card. */
  readonly wash: string;
  /** Hairline the card shows on hover and focus. */
  readonly ring: string;
  /**
   * Text colour for a heading or a breadcrumb link on this business's own
   * screens. Needed because the shared shop screen draws Grocers and Fresh
   * Mart from the same component: hard-coding the green here is what would
   * put Fresh Mart's colour on the Grocers header.
   */
  readonly heading: string;
  /**
   * The shop screen's own header band — the strip carrying the logo, the
   * delivery point, the cart and the search field.
   *
   * It was plain white on both shops, which left a large unfinished-looking
   * block at the top of every Grocers and Fresh Mart screen. Each business
   * now gets a tint from its OWN accent, so the two shops stay visibly
   * different while being the same component:
   *   Grocers (orange)   — warm, premium grocery; saffron into the brand green
   *   Fresh Mart (green) — fresh leafy green
   * These are light washes, not dark bars: the header's text and icons are
   * slate and must stay readable, so nothing here goes below a very light
   * tint. Anything darker belongs on <Header tone="forest">, not here.
   */
  readonly shopHeader: string;
}

export const ACCENTS: Readonly<Record<BusinessAccent, AccentClasses>> = {
  orange: {
    badge: 'bg-brand-amber text-white',
    button: 'bg-brand-amber text-white hover:bg-brand-amberDark',
    wash: 'bg-brand-amberLight',
    ring: 'hover:border-brand-amber focus-visible:ring-brand-amber',
    heading: 'text-brand-amberDark',
    // Grocers: warm saffron settling into the brand green.
    shopHeader: 'bg-gradient-to-br from-brand-amberLight via-brand-yellowLight to-brand-greenLight',
  },
  green: {
    badge: 'bg-brand-green text-white',
    button: 'bg-brand-green text-white hover:bg-brand-greenDark',
    wash: 'bg-brand-greenLight',
    ring: 'hover:border-brand-green focus-visible:ring-brand-green',
    heading: 'text-brand-greenDark',
    // Fresh Mart: leafy green cooling into the teal.
    shopHeader: 'bg-gradient-to-br from-brand-greenLight via-brand-greenLight to-brand-tealLight',
  },
  blue: {
    badge: 'bg-brand-blue text-white',
    button: 'bg-brand-blue text-white hover:bg-brand-blueDark',
    wash: 'bg-brand-blueLight',
    ring: 'hover:border-brand-blue focus-visible:ring-brand-blue',
    heading: 'text-brand-blueDark',
    shopHeader: 'bg-gradient-to-br from-brand-blueLight to-white',
  },
  teal: {
    badge: 'bg-brand-forest text-white',
    button: 'bg-brand-forest text-white hover:bg-brand-forestDark',
    wash: 'bg-slate-100',
    ring: 'hover:border-brand-forest focus-visible:ring-brand-forest',
    heading: 'text-brand-forest',
    shopHeader: 'bg-gradient-to-br from-brand-tealLight to-white',
  },
  amber: {
    badge: 'bg-brand-amberDark text-white',
    button: 'bg-brand-amberDark text-white hover:bg-brand-amber',
    wash: 'bg-brand-amberLight',
    ring: 'hover:border-brand-amberDark focus-visible:ring-brand-amberDark',
    heading: 'text-brand-amberDark',
    shopHeader: 'bg-gradient-to-br from-brand-amberLight to-white',
  },
};

/**
 * What the action button says. The mockup gives each kind its own wording,
 * and the wording is the promise: "Open External App" tells a reader they
 * are leaving before they tap, which "Order now" would not.
 */
export function actionLabel(kind: 'shop' | 'external' | 'info'): string {
  if (kind === 'shop') return 'Online Ordering';
  if (kind === 'external') return 'Open External App';
  return 'Menu & Information';
}
