/**
 * The six customer-facing businesses in the Samagri complex.
 *
 * WHY THIS IS A FILE AND NOT A TABLE. Four of the six have no products, no
 * inventory, no cart and no orders — they are a logo, an address, phone
 * numbers and opening hours. That is content, not catalogue data, and giving
 * it tables would add schema the application never queries. The two that DO
 * sell (Grocers, Fresh Mart) need a business identity on their catalogue
 * rows, and that is a reviewed database change which has NOT been made: see
 * category-tree.ts for why the category trees are also held here for now.
 *
 * NOT TO BE CONFUSED WITH `product.brand`. That field is the manufacturer —
 * Amul, Tata, Yard Fresh — it is written onto every order line as sold, and
 * nothing here touches it. A Grocers shelf carries many manufacturers.
 *
 * Every contact detail below was supplied by the client. Nothing is inferred,
 * and a detail that was not supplied is absent rather than guessed.
 */

export type BusinessKind =
  /** Sells through this app, using the existing PIF cart and checkout. */
  | 'shop'
  /** Takes orders on its own site; we link out and own no part of it. */
  | 'external'
  /** Information only. No cart, no checkout, no ordering of any kind. */
  | 'info';

export interface OpeningHours {
  readonly days: string;
  readonly time: string;
}

export interface BusinessLocation {
  /** Only set when a business has more than one place. */
  readonly label?: string;
  readonly address: string;
  readonly phones: readonly string[];
  readonly hours: readonly OpeningHours[];
}

/**
 * The accent each business carries on its numbered badge and action button.
 * Taken from the approved mockup, where the six cards are deliberately not
 * uniform — the colour is how a returning customer finds their shop in the
 * list before they have read a word.
 */
export type BusinessAccent = 'orange' | 'green' | 'blue' | 'teal' | 'amber';

export interface Business {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  /** One line under the card on the desktop directory. */
  readonly summary: string;
  readonly accent: BusinessAccent;
  readonly kind: BusinessKind;
  /** Where the card goes. In-app for every business, including external ones. */
  readonly route: string;
  /** Path under public/. Original artwork, unmodified. */
  readonly logo: string;
  /** Only for kind: 'external'. Opened in a new tab. */
  readonly externalUrl?: string;
  readonly locations?: readonly BusinessLocation[];
  /**
   * Menu artwork supplied by the client. An empty array means the images
   * have NOT been supplied — the page says so rather than inventing one.
   */
  readonly menuImages?: readonly MenuImage[];
}

/**
 * One page of a supplied menu, in two sizes.
 *
 * `full` is the client's original file, byte for byte — it is what opens when
 * a reader enlarges, so small print stays readable. `preview` is a 900 px
 * copy derived from it for the inline gallery, because the five originals
 * together are about 9 MB and this app is opened on phones. Nothing in the
 * artwork is altered: no item, price, name or layout is touched in either.
 */
export interface MenuImage {
  readonly preview: string;
  readonly full: string;
  /** What this page of the menu covers, for the alt text and the caption. */
  readonly caption: string;
}

/**
 * Display order is fixed by the client and is the order of this array.
 * Do not sort it.
 */
export const BUSINESSES: readonly Business[] = [
  {
    slug: 'grocers',
    name: 'Grocers',
    // Title case, per the standing UI standard. Lower case here was a
    // transcription slip, not a different approved wording.
    tagline: 'Everyday Needs, Made Easy',
    summary: 'Groceries, staples, snacks and more',
    accent: 'orange',
    kind: 'shop',
    route: '/pif/grocers',
    logo: '/brands/grocers.jpg',
  },
  {
    slug: 'fresh-mart',
    name: 'Fresh Mart',
    tagline: 'Fruits & vegetables',
    summary: 'Fruits and vegetables, fresh and healthy',
    accent: 'green',
    kind: 'shop',
    route: '/pif/fresh-mart',
    logo: '/brands/fresh-mart.jpg',
  },
  {
    slug: 'fit-food-bay',
    name: 'Fit Food Bay',
    tagline: 'Door to healthy life',
    summary: 'Opens the existing Fit Food Bay delivery app externally',
    accent: 'blue',
    kind: 'external',
    route: '/pif/fit-food-bay',
    logo: '/brands/fit-food-bay.jpg',
    externalUrl: 'https://www.instantmenu.co/Fitfoodbay?id=iM9263q',
    locations: [
      {
        address: 'Samagri Complex, E Sector, Dolphin Hill',
        phones: ['9160089255'],
        hours: [
          { days: 'Tuesday – Saturday', time: '11:00 AM – 9:00 PM' },
          { days: 'Sunday', time: '9:00 AM – 9:00 PM' },
          { days: 'Monday', time: 'Closed' },
        ],
      },
    ],
  },
  {
    slug: 'kelvin-scale',
    name: 'Kelvin Scale Creamery',
    tagline: 'Natural ice creams and waffles',
    summary: 'Ice creams, sundaes, waffles and shakes',
    accent: 'teal',
    kind: 'info',
    route: '/pif/kelvin-scale',
    logo: '/brands/kelvin-scale.jpg',
    locations: [
      {
        address: 'Samagri Complex, E Sector, Dolphin Hill',
        phones: ['9966626832'],
        hours: [
          { days: 'Tuesday – Sunday', time: '9:30 AM – 8:00 PM' },
          { days: 'Monday', time: 'Closed' },
        ],
      },
    ],
    menuImages: [
      {
        preview: '/brands/menus/preview/kelvin-scale-menu-1.jpg',
        full: '/brands/menus/kelvin-scale-menu-1.png',
        caption: 'Sundaes and ice creams',
      },
      {
        preview: '/brands/menus/preview/kelvin-scale-menu-2.jpg',
        full: '/brands/menus/kelvin-scale-menu-2.png',
        caption: 'Waffles, milkshakes and thickshakes',
      },
    ],
  },
  {
    slug: 'visakha-dairy',
    name: 'Visakha Dairy',
    tagline: 'The health of India',
    summary: 'Milk, ghee, paneer, bakery and more',
    accent: 'blue',
    kind: 'info',
    route: '/pif/visakha-dairy',
    logo: '/brands/visakha-dairy.jpg',
    locations: [
      {
        label: 'Dolphin Hill',
        address: 'Samagri Complex, E Sector, Dolphin Hill',
        phones: ['9492341168'],
        hours: [{ days: 'All days', time: '9:00 AM – 8:00 PM' }],
      },
      {
        label: 'Naval Park',
        address: 'Samagri Complex, Naval Park',
        phones: ['9182026165', '7032832285'],
        hours: [{ days: 'All days', time: '7:00 AM – 9:00 PM' }],
      },
    ],
    menuImages: [
      {
        preview: '/brands/menus/preview/visakha-dairy-menu-1.jpg',
        full: '/brands/menus/visakha-dairy-menu-1.png',
        caption: 'Ghee, biscuits, juices, bread and buns, paneer, curd, milk and dairy',
      },
      {
        preview: '/brands/menus/preview/visakha-dairy-menu-2.jpg',
        full: '/brands/menus/visakha-dairy-menu-2.png',
        caption: 'Milk and beverages, batters, chutneys, dry fruits, seeds and pickles',
      },
    ],
  },
  {
    slug: 'laddu-gopal',
    name: 'Laddu Gopal',
    tagline: 'Sweet studio',
    summary: 'Snacks, chaat, bakery items and combos',
    accent: 'amber',
    kind: 'info',
    route: '/pif/laddu-gopal',
    logo: '/brands/laddu-gopal.jpg',
    locations: [
      {
        address: 'Samagri Complex, Naval Park',
        // 7855030852 appears on the supplied menu artwork. Held back until
        // the client confirms it, per instruction — do not add it here.
        phones: ['9989990381', '7032428666'],
        hours: [
          { days: 'Tuesday – Sunday', time: '10:00 AM – 9:00 PM' },
          { days: 'Monday', time: 'Closed' },
        ],
      },
    ],
    menuImages: [
      {
        preview: '/brands/menus/preview/laddu-gopal-menu.jpg',
        full: '/brands/menus/laddu-gopal-menu.png',
        caption: 'Snacks, chaat, bakery items, rolls and combos',
      },
    ],
  },
];

export function findBusiness(slug: string | undefined): Business | null {
  if (slug === undefined) return null;
  return BUSINESSES.find((b) => b.slug === slug) ?? null;
}

/** The two that sell. Used to keep catalogue code from guessing. */
export const SHOPPING_BUSINESSES = BUSINESSES.filter((b) => b.kind === 'shop');
