import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResource } from '../lib/api/resource';
import { fetchPifCategories, fetchShowcaseProducts, type PifCategoryNode } from '../lib/api/pif-api';
import type { PifProduct } from '../lib/api/types';

/**
 * "Popular in PIF" — the moving shop window on the customer home screen.
 *
 * WHAT IT SHOWS. Real PIF products, with their real names and the server's
 * own prices. Nothing here computes or adjusts a price; `toPifProduct`
 * converts the server's rupee figure to minor units and this only formats it.
 *
 * THE PICTURE, AND WHY THERE ARE TWO SOURCES. Individual product photographs
 * are still being uploaded, so most products have none yet. Rather than slide
 * a row of grey squares past the customer, a product with no picture of its
 * own borrows the uploaded picture of the category or subcategory it belongs
 * to — matched by `categoryId`, so the picture always belongs to the shelf
 * the product is actually on. When its own photograph is uploaded later it
 * takes over automatically, with no code change: the product's `imageUrl`
 * simply stops being null.
 *
 * A product with neither its own picture nor a category picture is SKIPPED.
 * That is the one case where no honest image exists, and a grey tile with a
 * name under it is worse than one fewer card.
 *
 * NO NEW ENDPOINT, AND NO CATALOGUE CHANGE. It calls `/pif/search` and
 * `/pif/categories`, both of which the PIF screens already use. No product,
 * price, category or image in PIF was added or altered to serve this row.
 *
 * THE ANIMATION IS CSS, NOT JAVASCRIPT. The track is the item list rendered
 * twice and slid by `transform` under a `@keyframes` rule (see index.css).
 * That runs on the compositor: no rAF loop, no scroll handler firing per
 * frame, no layout thrash, and it stays smooth on a mid-range phone. The
 * duplicate copy is what makes the loop seamless and is `aria-hidden`, so a
 * screen reader hears each product once.
 *
 * THREE WAYS IT STOPS MOVING, all required:
 *   - hover and keyboard focus pause it (CSS `:hover` / `:focus-within`);
 *   - a touch or a swipe hands control over permanently for this visit —
 *     the animation is removed and what remains is an ordinary native
 *     scroller with scroll-snap, so the customer's finger is never fighting
 *     a moving track;
 *   - `prefers-reduced-motion: reduce` disables the animation and drops the
 *     duplicate copy before a single frame runs.
 *
 * It renders nothing at all unless items actually arrived — no spinner, no
 * error, no empty box. Nobody asked for this row, so a slow or unreachable
 * catalogue must not put a fault message on the home screen, directly
 * beneath the permanent hero.
 */

/** What a card needs, with the picture already resolved. */
interface ShowcaseItem {
  id: string;
  name: string;
  price: string;
  /** The product's own photograph, or its category's. Never empty. */
  imageUrl: string;
  href: string;
}

/** How many cards the row carries. Enough to fill a wide screen, few enough to stay light. */
const MAX_ITEMS = 12;

function formatMoney(money: { amountMinor: number; currency: 'INR' }): string {
  return `₹${(money.amountMinor / 100).toFixed(2)}`;
}

/**
 * Every uploaded category and subcategory picture, keyed by its own id.
 *
 * Both levels go in one flat map because a product's `categoryId` names
 * whichever of the two it sits directly under, and the caller should not
 * have to know which.
 */
function categoryImageIndex(categories: PifCategoryNode[]): Map<string, string> {
  const index = new Map<string, string>();

  for (const category of categories) {
    if (category.imageUrl !== undefined && category.imageUrl !== '') {
      index.set(category.id, category.imageUrl);
    }
    for (const sub of category.subcategories) {
      if (sub.imageUrl !== undefined && sub.imageUrl !== '') {
        index.set(sub.id, sub.imageUrl);
      }
    }
  }

  return index;
}

/** Products -> cards, each with the best picture available for it. */
function toShowcaseItems(products: PifProduct[], images: Map<string, string>): ShowcaseItem[] {
  const items: ShowcaseItem[] = [];

  for (const product of products) {
    // The product's own photograph always wins. The category picture is a
    // stand-in until that is uploaded, never a replacement for it.
    const own = product.imageUrl;
    const imageUrl = own !== undefined && own !== '' ? own : images.get(product.categoryId);
    if (imageUrl === undefined) continue;

    items.push({
      id: product.id,
      name: product.name,
      price: formatMoney(product.price),
      imageUrl,
      href: `/pif/products/${product.id}`,
    });

    if (items.length === MAX_ITEMS) break;
  }

  return items;
}

/**
 * Whether this person has asked their device for less motion.
 *
 * Read through `matchMedia` and kept current, because the setting can be
 * changed while the app is open — on iOS it is two taps away in Control
 * Centre. Guarded for the environments where `matchMedia` is absent
 * (jsdom in the test suite, older WebViews), where the honest answer is
 * "assume they did ask", since showing no motion to someone who wanted it
 * is a far smaller failure than the reverse.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function ProductShowcase() {
  const navigate = useNavigate();
  // Both in one round trip. The category pictures are only a fallback, so a
  // failure to load them must not cost us the products that have their own.
  const data = useResource<[PifProduct[], PifCategoryNode[]]>(
    () =>
      Promise.all([
        fetchShowcaseProducts(MAX_ITEMS * 2),
        fetchPifCategories().catch(() => [] as PifCategoryNode[]),
      ]),
    undefined,
    []
  );
  const prefersReducedMotion = usePrefersReducedMotion();

  // Once the customer touches the row, it is theirs. Resuming the slide
  // under a finger that has just scrolled is the thing that makes these
  // carousels feel broken, so this never goes back to false.
  const [takenOver, setTakenOver] = useState(false);
  const takeOver = useCallback(() => setTakenOver(true), []);

  if (data.status !== 'success') return null;

  const [products, categories] = data.data;
  const items = toShowcaseItems(products, categoryImageIndex(categories));
  if (items.length === 0) return null;

  // The duplicate copy exists only to make the slide seamless. With no
  // slide — reduced motion, or the customer now scrolling by hand — it
  // would just be the same products listed twice.
  const animating = !takenOver && !prefersReducedMotion;

  return (
    <section className="mt-4" aria-labelledby="showcase-heading">
      <div className="flex items-center justify-between px-1">
        <h2 id="showcase-heading" className="text-sm font-bold text-slate-900">
          Popular in PIF
        </h2>
        <button
          type="button"
          onClick={() => navigate('/pif')}
          className="-my-2 inline-flex min-h-touch items-center px-1 text-xs font-semibold text-brand-green"
        >
          Shop all ›
        </button>
      </div>

      <div
        className="showcase-viewport no-scrollbar mt-2 overflow-x-auto"
        data-paused={takenOver ? 'true' : 'false'}
        onPointerDown={takeOver}
        onTouchStart={takeOver}
        // A wheel or trackpad swipe is a manual interaction too.
        onWheel={takeOver}
      >
        <ul className={`showcase-track${animating ? '' : ' showcase-track--manual'}`}>
          {items.map((item) => (
            <ShowcaseCard key={item.id} item={item} onOpen={() => navigate(item.href)} />
          ))}

          {/* The seamless-loop copy — rendered only while the row is actually sliding. */}
          {animating
            ? items.map((item) => (
                <ShowcaseCard key={`clone-${item.id}`} item={item} clone onOpen={() => navigate(item.href)} />
              ))
            : null}
        </ul>
      </div>
    </section>
  );
}

/**
 * One card: picture, name, price.
 *
 * This is an advertisement, not the product page, and it deliberately
 * carries no quantity stepper, no add-to-cart and no stock figure. Tapping
 * it opens the real product page, where those decisions belong and where the
 * server prices the line it will actually charge for.
 */
function ShowcaseCard({
  item,
  onOpen,
  clone = false,
}: {
  item: ShowcaseItem;
  onOpen: () => void;
  clone?: boolean;
}) {
  return (
    <li className="showcase-item" aria-hidden={clone ? 'true' : undefined}>
      <button
        type="button"
        onClick={onOpen}
        // A cloned card is a duplicate of one already in the tab order.
        tabIndex={clone ? -1 : undefined}
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white text-left shadow-card"
      >
        {/*
          Always a real picture — the product's own, or its category's.
          `toShowcaseItems` drops anything it cannot illustrate, so this box
          is never an empty grey square.
        */}
        <div className="aspect-square w-full overflow-hidden bg-slate-100">
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-1 flex-col justify-between p-2.5">
          <p className="line-clamp-2 text-xs font-semibold text-slate-900">{item.name}</p>
          <p className="mt-1 text-sm font-bold text-brand-green">{item.price}</p>
        </div>
      </button>
    </li>
  );
}
