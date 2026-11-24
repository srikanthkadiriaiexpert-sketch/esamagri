import { CATEGORY_ICONS } from '../lib/businesses/category-icons';
import type { SubCategory } from '../lib/businesses/category-tree';

/**
 * The vertical category rail. ONE component, used by Grocers and Fresh Mart,
 * so the two shops navigate identically.
 *
 * SHAPE. A scrollable column of tiles, each a picture above its name — never
 * a text-only list. On a phone it is a narrow fixed rail beside the content
 * panel, so both halves stay usable in portrait without the page scrolling
 * sideways; from `sm` up it widens.
 *
 * TWO WAYS TO FILL IT, one behaviour:
 *   - `items`  — a flat list. Grocers passes one main category's
 *                subcategories, having already chosen the main on its home.
 *   - `groups` — labelled sections, each a main category and its
 *                subcategories. Fresh Mart passes its whole tree this way,
 *                because with two mains and eight subcategories the entire
 *                catalogue fits in one rail and a separate screen to pick
 *                between two things would be a wasted tap.
 * Exactly one is supplied. Selection, highlighting, images and keyboard
 * behaviour are identical either way.
 *
 * SELECTION is carried by the caller, so the rail owns no state and the URL
 * stays the single source of truth for which shelf is open.
 *
 * ICONS come from lucide-react by name, resolved through the generated map.
 * A supplied photograph takes their place when `imageFor` returns one.
 */
export interface CategorySidebarGroup {
  /** The main category heading shown above its subcategories. */
  readonly label: string;
  /** The main category itself, selectable like any other entry. */
  readonly head: SubCategory;
  readonly items: readonly SubCategory[];
}

export interface CategorySidebarProps {
  /** A flat rail. Mutually exclusive with `groups`. */
  readonly items?: readonly SubCategory[];
  /** A grouped rail. Mutually exclusive with `items`. */
  readonly groups?: readonly CategorySidebarGroup[];
  readonly selectedSlug: string | null;
  readonly onSelect: (slug: string) => void;
  /** Accessible name for the rail, e.g. "Rice, Atta & Flour subcategories". */
  readonly label: string;
  /**
   * A photograph for a category, when one has been supplied. Returning null
   * falls back to the lucide icon, which is what Grocers does — so a
   * business with no photographs behaves exactly as before.
   */
  readonly imageFor?: (slug: string) => { src: string; alt: string } | null;
  /**
   * How a tile is laid out.
   *   'rail' — picture ABOVE the name, in a narrow column. The default, and
   *            what Grocers uses: 135 subcategories need the narrow form.
   *   'list' — picture BESIDE the name, full width. For a drawer, where
   *            there is room for the name on one line.
   * The component, the selection, the highlight and the images are the same
   * either way; only the tile's shape differs.
   */
  readonly layout?: 'rail' | 'list';
}

export function CategorySidebar({
  items,
  groups,
  selectedSlug,
  onSelect,
  label,
  imageFor,
  layout = 'rail',
}: CategorySidebarProps) {
  const list = layout === 'list';
  return (
    <nav
      aria-label={label}
      // Narrow enough on a phone that the content panel stays usable;
      // wider on a desktop, where there is room for the full name on one line.
      className={
        list
          ? 'w-full overflow-y-auto overscroll-contain bg-white'
          : 'w-[84px] shrink-0 overflow-y-auto overscroll-contain border-r border-slate-200 bg-white sm:w-[112px] md:w-[168px]'
      }
      data-testid="category-sidebar"
    >
      {groups === undefined ? (
        <ul className="flex flex-col py-1">
          {(items ?? []).map((item) => (
            <li key={item.slug}>
              <RailTile
                item={item}
                selected={item.slug === selectedSlug}
                image={imageFor?.(item.slug) ?? null}
                onSelect={onSelect}
                list={list}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col pb-1">
          {groups.map((group) => (
            <section key={group.head.slug} aria-label={group.label}>
              {/* The heading sticks while its own section scrolls, so a
                  reader deep in Vegetables can still see where they are. */}
              <h3
                className={[
                  'sticky top-0 z-10 bg-brand-greenLight/95 py-2 text-[11px] font-bold uppercase tracking-wide text-brand-greenDark backdrop-blur',
                  list ? 'px-4 text-left' : 'px-1 text-center',
                ].join(' ')}
              >
                {group.label}
              </h3>
              <ul className="flex flex-col">
                {[group.head, ...group.items].map((item) => (
                  <li key={item.slug}>
                    <RailTile
                      item={item}
                      selected={item.slug === selectedSlug}
                      image={imageFor?.(item.slug) ?? null}
                      onSelect={onSelect}
                      isHead={item.slug === group.head.slug}
                      list={list}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}

function RailTile({
  item,
  selected,
  image,
  onSelect,
  isHead = false,
  list = false,
}: {
  item: SubCategory;
  selected: boolean;
  image: { src: string; alt: string } | null;
  onSelect: (slug: string) => void;
  isHead?: boolean;
  list?: boolean;
}) {
  const thumb = (
    <span
      className={[
        'flex shrink-0 items-center justify-center overflow-hidden',
        list ? 'h-12 w-12 rounded-xl' : 'h-11 w-11 rounded-full',
        selected ? 'bg-white text-brand-green' : 'bg-slate-100 text-slate-500',
      ].join(' ')}
    >
      {image === null ? (
        <CategoryIcon name={item.icon} className={list ? 'h-6 w-6' : 'h-5 w-5'} />
      ) : (
        // EAGER, not lazy. These pictures ARE the navigation: a category
        // tile with an empty circle reads as a broken image, not as one
        // still arriving. Deferring them showed exactly that — a blank
        // Herbs & Coriander tile the moment the drawer opened. There are at
        // most ten of them and they are small, so there is nothing to save.
        // width/height still reserve the box, so nothing shifts.
        <img
          src={image.src}
          alt=""
          width={list ? 48 : 44}
          height={list ? 48 : 44}
          loading="eager"
          decoding="sync"
          fetchPriority="high"
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );

  const name = (
    <span
      className={[
        list
          ? 'min-w-0 flex-1 truncate text-left text-[15px]'
          : 'block w-full text-[10px] leading-tight sm:text-[11px] md:text-[12px]',
        isHead ? 'font-extrabold' : 'font-semibold',
        selected ? 'text-brand-greenDark' : 'text-slate-700',
      ].join(' ')}
    >
      {item.name}
    </span>
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(item.slug)}
      aria-current={selected ? 'true' : undefined}
      className={[
        // min-h-touch keeps every tile thumb-sized on a phone.
        'relative flex min-h-touch w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-green',
        list
          ? 'items-center gap-3 border-b border-slate-100 px-4 py-2.5'
          : 'flex-col items-center gap-1 px-1 py-2.5 text-center',
        selected ? 'bg-brand-greenLight' : 'hover:bg-slate-50',
      ].join(' ')}
    >
      {/* The selected marker is a bar, not just a tint: colour alone would
          be the only cue for a colour-blind reader. */}
      {selected ? (
        <span
          aria-hidden="true"
          className={[
            'absolute left-0 rounded-r bg-brand-green',
            list ? 'inset-y-0 w-1.5' : 'inset-y-1 w-1',
          ].join(' ')}
        />
      ) : null}
      {thumb}
      {name}
    </button>
  );
}

/**
 * One lucide glyph by export name.
 *
 * CATEGORY_ICONS is generated beside the trees and holds ONLY the icons they
 * use, imported by name. Lucide's own `icons` record was tried first and
 * rejected: referencing it defeats tree-shaking and more than doubled the
 * customer bundle. Keeping the tree as plain strings and resolving here
 * gives the same convenience without carrying 1,570 unused glyphs.
 */
export function CategoryIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const Glyph = CATEGORY_ICONS[name];
  if (Glyph === undefined) {
    // Should be unreachable: generation validates every name. A dot is shown
    // rather than nothing, so a hand-edited tree degrades visibly.
    return <span aria-hidden="true" className={className} />;
  }
  return <Glyph aria-hidden className={className} strokeWidth={1.75} focusable="false" />;
}
