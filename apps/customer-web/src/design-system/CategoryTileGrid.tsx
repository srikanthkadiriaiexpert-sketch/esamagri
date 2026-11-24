import { CategoryIcon } from './CategorySidebar';
import type { SubCategory } from '../lib/businesses/category-tree';

/**
 * "Shop by category" — the approved grid of category tiles.
 *
 * The same tile the rail uses (a picture, or the category's lucide icon when
 * no picture has been supplied, above the name) laid out as a grid instead
 * of a column. Grocers needs this because nineteen mains and up to a dozen
 * subcategories read as a wall of text in a narrow rail, and the approved
 * mockup draws them as a grid.
 *
 * NOT TO BE CONFUSED with <CategoryGrid> next door, which is older and does
 * a different job: that one renders the LIVE catalogue from the server,
 * including its loading, error and empty states. This one renders the
 * approved category TREE, which is static, local and always present.
 *
 * IMAGES ARE EAGER, for the reason the rail gives: these pictures ARE the
 * navigation, so a tile that has not arrived yet reads as broken rather than
 * as still loading. width/height reserve the box so nothing shifts.
 */
export interface CategoryTileGridProps {
  readonly items: readonly SubCategory[];
  readonly selectedSlug?: string | null;
  readonly onSelect: (slug: string) => void;
  /** Accessible name, e.g. "Grocers categories". */
  readonly label: string;
  readonly imageFor?: (slug: string) => { src: string; alt: string } | null;
  /** Tint behind an icon tile, from the business's accent. */
  readonly wash: string;
  /** Text colour for the selected tile, from the business's accent. */
  readonly heading: string;
  /**
   * Overrides the test handle. Defaults to the single `category-grid` every
   * existing screen uses; a screen showing MORE THAN ONE grid (Fresh Mart's
   * home draws one per main category) must give each its own, because a
   * duplicated handle makes `getByTestId` ambiguous.
   */
  readonly testId?: string;
}

export function CategoryTileGrid({
  items,
  selectedSlug = null,
  onSelect,
  label,
  imageFor,
  wash,
  heading,
  testId = 'category-grid',
}: CategoryTileGridProps) {
  return (
    <nav aria-label={label} data-testid={testId}>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {items.map((item) => {
          const image = imageFor?.(item.slug) ?? null;
          const selected = item.slug === selectedSlug;
          return (
            <li key={item.slug}>
              <button
                type="button"
                onClick={() => onSelect(item.slug)}
                aria-current={selected ? 'true' : undefined}
                className={[
                  'flex min-h-touch w-full flex-col items-center gap-1.5 rounded-2xl border p-2 text-center shadow-card transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green',
                  selected
                    ? 'border-brand-green bg-brand-greenLight'
                    : 'border-slate-200 bg-white hover:border-slate-300',
                ].join(' ')}
              >
                {/*
                  A SQUARE BOX, matching the artwork's own shape.
                  This was a short full-width banner (h-16) back when the
                  supplied sheets were roughly 2:1 panels — a pack beside a
                  bowl — because padding one of those into a square left the
                  product about 28px tall and unidentifiable.
                  That is no longer what the artwork is. Every one of the 154
                  approved tiles is now a 1:1 image carrying its own green
                  title banner across the bottom 17.5%. In a wide, short box
                  object-cover scaled to the width and centre-cropped
                  vertically, which threw away the banner — the category's own
                  name — along with the top of the picture. A square box shows
                  the supplied tile whole, banner included, which is what it
                  was drawn for.
                  Do NOT change this back to a fixed height without also
                  changing the artwork: the two are one decision.
                */}
                <span
                  className={[
                    'flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden rounded-xl',
                    image === null ? `${wash} text-slate-600` : '',
                  ].join(' ')}
                >
                  {image === null ? (
                    <CategoryIcon name={item.icon} className="h-8 w-8" />
                  ) : (
                    <img
                      src={image.src}
                      alt=""
                      // Square, matching the box and the supplied artwork, so
                      // the reserved space is the space the picture takes and
                      // nothing shifts once it decodes.
                      width={160}
                      height={160}
                      loading="eager"
                      decoding="sync"
                      fetchPriority="high"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span
                  className={[
                    'text-[11px] font-semibold leading-tight',
                    selected ? heading : 'text-slate-700',
                  ].join(' ')}
                >
                  {item.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
