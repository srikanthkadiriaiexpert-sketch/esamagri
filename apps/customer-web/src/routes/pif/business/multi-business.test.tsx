import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CATEGORY_ICONS } from '../../../lib/businesses/category-icons';
import {
  categoryImage,
  FRESH_MART_IMAGE_SLUGS,
  GROCERS_IMAGE_SLUGS,
} from '../../../lib/businesses/category-images';

import { CategoryTileGrid } from '../../../design-system/CategoryTileGrid';
import { PifBusinessesPage } from '../PifBusinessesPage';
import { GrocersShopPage } from './GrocersShopPage';
import { FreshMartShopPage } from './FreshMartShopPage';
import { BusinessInfoPage } from './BusinessInfoPage';
import { BUSINESSES } from '../../../lib/businesses/businesses';
import {
  GROCERS_CATEGORIES,
  FRESH_MART_CATEGORIES,
  allSubcategories,
} from '../../../lib/businesses/category-tree';

/**
 * The six-business portal.
 *
 * What these tests are really defending:
 *   - the client's display ORDER, which is a business decision, not a style;
 *   - that an information-only business can never reach commerce;
 *   - that the subcategory rail shows a picture AND a name, which was the
 *     explicit design requirement and the easiest thing to quietly drop;
 *   - that every icon name in the generated tree resolves to a real glyph,
 *     because a missing one fails silently as a blank circle.
 */

vi.mock('../../../lib/cart/PifCartContext', () => ({
  usePifCart: () => ({ itemCount: 0, quantityOf: () => 0, addOne: vi.fn(), setQuantity: vi.fn() }),
}));

// The real hook asks the server to price the cart. These tests are about
// layout and wording, so it is stubbed at its empty resting state — which
// is also the honest state while no catalogue exists.
vi.mock('../../../lib/cart/usePifCartTotal', () => ({
  usePifCartTotal: () => ({ itemCount: 0, total: null, pricing: false }),
}));

// The Grocers home still asks the API for the shelves that genuinely hold
// stock. Only that one call is replaced — `rupees` and everything else in
// the module stay real, because the point of these tests is what the screen
// prints. An empty answer is also the honest answer here.
vi.mock('../../../lib/api/pif-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api/pif-api')>()),
  fetchPifCategories: vi.fn(async () => []),
  /*
   * The shelves fetch their own products now, so this call has to be stubbed
   * too. Without it the REAL function ran against no server: the fetch
   * rejected, `useResource` landed in its error state, and a screen asked for
   * its empty-shelf wording showed a failure message instead — which is what
   * these two tests were reporting.
   *
   * An empty page is the honest stub here: these tests are about what a shelf
   * with nothing on it says, so "no products" is precisely the state under
   * test, not a convenience.
   */
  fetchPifCategoryProducts: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
}));

function renderAt(path: string, element: React.ReactElement, ...patterns: string[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {patterns.map((p) => (
          <Route key={p} path={p} element={element} />
        ))}
      </Routes>
    </MemoryRouter>
  );
}

describe('the business chooser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('TEST 1 — lists exactly six businesses in the order the client set', () => {
    renderAt('/pif', <PifBusinessesPage />, '/pif');

    const expected = [
      'Grocers',
      'Fresh Mart',
      'Fit Food Bay',
      'Kelvin Scale Creamery',
      'Visakha Dairy',
      'Laddu Gopal',
    ];

    const items = screen.getAllByRole('listitem');
    // The chooser list is the first list on the page.
    const names = items.slice(0, 6).map((li) => within(li).getByRole('button').textContent ?? '');

    expect(names).toHaveLength(6);
    expected.forEach((name, i) => {
      expect(names[i]).toContain(name);
    });
  });

  it('TEST 1b — numbers the cards 1 to 6 in the client\'s order', () => {
    const { container } = renderAt('/pif', <PifBusinessesPage />, '/pif');
    // The approved mockup numbers every card; the number is the reader's
    // anchor for "the third one" in conversation with the facility.
    const cards = [...container.querySelectorAll('ol > li')];
    expect(cards).toHaveLength(6);
    const badges = cards.map((li) => li.querySelector('span[aria-hidden="true"]')?.textContent);
    expect(badges).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('TEST 1c — each card carries the action wording its kind calls for', () => {
    renderAt('/pif', <PifBusinessesPage />, '/pif');
    // Two shops order online, one leaves the app, three only inform.
    expect(screen.getAllByText('Online Ordering')).toHaveLength(2);
    expect(screen.getAllByText('Open External App')).toHaveLength(1);
    expect(screen.getAllByText('Menu & Information')).toHaveLength(3);
  });

  it('TEST 2 — every business shows its own logo file, none shared', () => {
    const { container } = renderAt('/pif', <PifBusinessesPage />, '/pif');
    // Queried by tag, not by role: the tile logos carry alt="" on purpose —
    // the business name sits beside them as real text, so announcing the
    // picture too would read the name twice to a screen reader.
    const sources = [...container.querySelectorAll('img')]
      .map((img) => img.getAttribute('src'))
      .filter((s): s is string => s !== null && s.startsWith('/brands/'));

    expect(sources).toHaveLength(6);
    expect(new Set(sources).size).toBe(6);
  });
});

describe('information-only businesses', () => {
  const infoSlugs = ['kelvin-scale', 'visakha-dairy', 'laddu-gopal'];

  it.each(infoSlugs)('TEST 3 — %s exposes no way to buy anything', (slug) => {
    renderAt(`/pif/${slug}`, <BusinessInfoPage businessSlug={slug} />, '/pif/:slug');

    const forbidden = /add to cart|add\b|buy now|checkout|place order|₹/i;
    expect(document.body.textContent ?? '').not.toMatch(forbidden);
    expect(screen.queryByRole('button', { name: /cart/i })).toBeNull();
  });

  it('TEST 4 — Visakha Dairy shows both locations with their own phone numbers', () => {
    renderAt('/pif/visakha-dairy', <BusinessInfoPage businessSlug="visakha-dairy" />, '/pif/:slug');

    expect(screen.getByText('Dolphin Hill')).toBeInTheDocument();
    expect(screen.getByText('Naval Park')).toBeInTheDocument();

    for (const phone of ['9492341168', '9182026165', '7032832285']) {
      const link = screen.getByRole('link', { name: phone });
      expect(link).toHaveAttribute('href', `tel:${phone}`);
    }
  });

  it('TEST 5 — Laddu Gopal withholds the unconfirmed menu number', () => {
    renderAt('/pif/laddu-gopal', <BusinessInfoPage businessSlug="laddu-gopal" />, '/pif/:slug');

    expect(screen.getByRole('link', { name: '9989990381' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '7032428666' })).toBeInTheDocument();
    // Appears on the artwork but is not confirmed, so it must not be published.
    expect(document.body.textContent ?? '').not.toContain('7855030852');
  });

  it('TEST 6 — shows every supplied menu page, each with a caption', () => {
    renderAt('/pif/kelvin-scale', <BusinessInfoPage businessSlug="kelvin-scale" />, '/pif/:slug');

    expect(screen.queryByText(/menu not available yet/i)).toBeNull();

    const menuImages = screen
      .getAllByRole('img')
      .filter((img) => (img.getAttribute('alt') ?? '').includes('menu'));
    expect(menuImages).toHaveLength(2);
    expect(screen.getByText(/sundaes and ice creams/i)).toBeInTheDocument();
    expect(screen.getByText(/waffles, milkshakes and thickshakes/i)).toBeInTheDocument();
  });

  it('TEST 6b — the gallery shows the light preview and enlarges to the original file', async () => {
    const user = userEvent.setup();
    renderAt('/pif/laddu-gopal', <BusinessInfoPage businessSlug="laddu-gopal" />, '/pif/:slug');

    const inline = screen
      .getAllByRole('img')
      .find((img) => (img.getAttribute('alt') ?? '').includes('menu'));
    // Inline is the derived preview, so a phone does not fetch ~2 MB to scroll past.
    expect(inline?.getAttribute('src')).toBe('/brands/menus/preview/laddu-gopal-menu.jpg');

    // Two controls open the same page — the image itself and the caption's
    // "Tap to enlarge". Either must work; this exercises the image.
    await user.click(screen.getAllByRole('button', { name: /enlarge/i })[0]!);

    const lightbox = screen.getByTestId('menu-lightbox');
    // Enlarged is the client's untouched original.
    expect(within(lightbox).getByRole('img').getAttribute('src')).toBe(
      '/brands/menus/laddu-gopal-menu.png'
    );

    await user.click(within(lightbox).getByRole('button', { name: /close/i }));
    expect(screen.queryByTestId('menu-lightbox')).toBeNull();
  });

  it('TEST 6c — every supplied menu file is referenced by exactly one business', () => {
    const owners = new Map<string, string[]>();
    for (const b of BUSINESSES) {
      for (const m of b.menuImages ?? []) {
        owners.set(m.full, [...(owners.get(m.full) ?? []), b.slug]);
        owners.set(m.preview, [...(owners.get(m.preview) ?? []), b.slug]);
      }
    }
    const shared = [...owners.entries()].filter(([, who]) => who.length > 1);
    expect(shared).toEqual([]);
    // Five pages supplied: Kelvin Scale 2, Visakha Dairy 2, Laddu Gopal 1.
    const pages = BUSINESSES.reduce((n, b) => n + (b.menuImages ?? []).length, 0);
    expect(pages).toBe(5);
  });
});

describe('Fit Food Bay', () => {
  it('TEST 7 — links out to the exact ordering URL, safely, in a new tab', () => {
    renderAt('/pif/fit-food-bay', <BusinessInfoPage businessSlug="fit-food-bay" />, '/pif/:slug');

    // Wording is the mockup's: it names the destination so a reader knows
    // they are leaving before they tap.
    const link = screen.getByRole('link', { name: /open fit food bay app/i });
    expect(link).toHaveAttribute('href', 'https://www.instantmenu.co/Fitfoodbay?id=iM9263q');
    expect(link).toHaveAttribute('target', '_blank');
    // noopener keeps the new tab from reaching back into this one.
    expect(link.getAttribute('rel') ?? '').toContain('noopener');
    expect(link.getAttribute('rel') ?? '').toContain('noreferrer');
  });

  it('TEST 8 — builds no cart or checkout of its own', () => {
    renderAt('/pif/fit-food-bay', <BusinessInfoPage businessSlug="fit-food-bay" />, '/pif/:slug');
    expect(screen.queryByRole('button', { name: /add|cart|checkout/i })).toBeNull();
  });
});

describe('Grocers — the same approved screen, Grocers branding', () => {
  const renderShop = (path = '/pif/grocers') =>
    renderAt(
      path,
      <GrocersShopPage />,
      '/pif/grocers',
      '/pif/grocers/:mainSlug',
      '/pif/grocers/:mainSlug/:subSlug'
    );

  it('TEST 9 — shows an icon AND a name for every subcategory, never a bare list', () => {
    // This used to pick whichever Grocers main still had no artwork, so it
    // kept exercising the icon fallback for free while categories were
    // illustrated one at a time. Every Grocers main is illustrated now, so
    // that search returns nothing and the test would have quietly died.
    //
    // Two things were actually being asserted, and both still matter:
    //   1. an illustrated grid shows a PICTURE and a name per shelf;
    //   2. the icon fallback still renders a glyph and a name, for any
    //      category that has no artwork — which is the state every new
    //      category starts in.
    // Both trees are fully illustrated now (I checked Fresh Mart too,
    // after first assuming it still had a gap), so (2) is asserted
    // directly against CategoryTileGrid with no image supplied. That is
    // the fallback's real contract and it no longer depends on the
    // catalogue happening to be incomplete.
    const illustrated = GROCERS_CATEGORIES.find(
      (m) => m.subcategories.length > 0 && m.subcategories.every((sub) => categoryImage('grocers', sub.slug) !== null)
    );
    expect(illustrated).toBeDefined();
    renderShop(`/pif/grocers/${illustrated!.slug}`);
    const grid = screen.getByTestId('category-grid');
    const buttons = within(grid).getAllByRole('button');
    expect(buttons).toHaveLength(illustrated!.subcategories.length);
    for (const button of buttons) {
      expect((button.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(button.querySelector('img')).not.toBeNull();
    }

    cleanup();
    render(
      <CategoryTileGrid
        items={illustrated!.subcategories}
        onSelect={() => {}}
        label="icon fallback"
        imageFor={() => null}
        wash="bg-brand-amberWash"
        heading="text-brand-green"
      />
    );
    const iconGrid = screen.getByTestId('category-grid');
    const iconButtons = within(iconGrid).getAllByRole('button');
    expect(iconButtons).toHaveLength(illustrated!.subcategories.length);
    for (const button of iconButtons) {
      expect((button.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.querySelector('img')).toBeNull();
    }
  });

  it('TEST 9i — an illustrated category shows its picture in place of the icon', () => {
    renderShop('/pif/grocers/dal-and-pulses');
    const tiles = within(screen.getByTestId('category-grid')).getAllByRole('button');
    expect(tiles).toHaveLength(9);
    for (const tile of tiles) {
      const img = tile.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toMatch(
        /^\/brands\/grocers\/categories\/dal-and-pulses\/.+\.webp$/
      );
      // Eager, for the reason Herbs & Coriander taught us.
      expect(img!.getAttribute('loading')).toBe('eager');
      expect((tile.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('TEST 10 — selecting a subcategory moves the marker and the breadcrumb', async () => {
    const user = userEvent.setup();
    renderShop('/pif/grocers/dal-and-pulses');

    const grid = screen.getByTestId('category-grid');
    // Nothing is current until the reader chooses: the URL has no
    // subcategory, so claiming one is open would be a lie.
    expect(within(grid).queryByRole('button', { current: true })).toBeNull();

    await user.click(within(grid).getByRole('button', { name: /rajma/i }));

    // The grid has done its job and stepped aside; the rail now carries the
    // selection, which is what the approved mockup shows.
    expect(screen.queryByTestId('category-grid')).toBeNull();
    const rail = within(screen.getByTestId('shop-rail')).getByTestId('category-sidebar');
    expect(within(rail).getByRole('button', { name: /rajma/i })).toHaveAttribute(
      'aria-current',
      'true'
    );
    expect(within(rail).getByRole('button', { name: /toor dal/i })).not.toHaveAttribute(
      'aria-current'
    );

    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(crumbs).getByText('Home')).toBeInTheDocument();
    expect(within(crumbs).getByText('Grocers')).toBeInTheDocument();
    expect(within(crumbs).getByText('Dal & Pulses')).toBeInTheDocument();
    expect(within(crumbs).getByText('Rajma')).toBeInTheDocument();
  });

  it('TEST 10b — inside a main, the drawer holds THAT main\'s subcategories', async () => {
    const user = userEvent.setup();
    renderShop('/pif/grocers/oil-and-ghee');
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const drawer = screen.getByTestId('shop-drawer');
    // Not the 19 mains. A drawer opened from inside Oil & Ghee that lists
    // Pet Care is not this category's navigation.
    const rows = within(within(drawer).getByTestId('category-sidebar')).getAllByRole('button');
    expect(rows.map((b) => (b.textContent ?? '').trim())).toEqual([
      'Sunflower Oil',
      'Groundnut Oil',
      'Rice Bran Oil',
      'Palm Oil',
      'Coconut Oil',
      'Sesame Oil',
      'Ghee',
    ]);
    // And it says whose subcategories they are.
    expect(within(drawer).getByText('Oil & Ghee')).toBeInTheDocument();
  });

  it('TEST 10c — the rail stays beside the content on a phone, with its pictures', () => {
    renderShop('/pif/grocers/oil-and-ghee/sunflower-oil');
    const rail = within(screen.getByTestId('shop-rail')).getByTestId('category-sidebar');
    const rows = within(rail).getAllByRole('button');
    expect(rows).toHaveLength(7);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    for (const row of rows) {
      expect((row.textContent ?? '').trim().length).toBeGreaterThan(0);
      expect(row.querySelector('img')?.getAttribute('src')).toMatch(
        /^\/brands\/grocers\/categories\/oil-and-ghee\/.+\.webp$/
      );
    }
  });

  it('TEST 10d — choosing from the drawer opens that shelf and closes the drawer', async () => {
    const user = userEvent.setup();
    renderShop('/pif/grocers/oil-and-ghee');
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const drawer = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    await user.click(within(drawer).getByRole('button', { name: /^sesame oil$/i }));

    expect(screen.queryByTestId('shop-drawer')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sesame Oil', level: 1 })).toBeInTheDocument();
  });

  it('TEST 10e — the shop home still offers the 19 mains, not a subcategory list', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: /open categories/i }));
    const drawer = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    expect(within(drawer).getAllByRole('button')).toHaveLength(19);
    // No rail out here: there is no open category whose siblings to show.
    expect(screen.queryByTestId('shop-rail')).toBeNull();
  });

  it('TEST 11 — an unknown category is reported, not rendered blank', () => {
    renderShop('/pif/grocers/not-a-real-category');
    expect(
      screen.getByRole('heading', { name: /category not found/i, level: 1 })
    ).toBeInTheDocument();
    // And it offers a way out rather than leaving the reader on a dead page.
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('TEST 12 — an empty shelf says it is empty rather than showing a borrowed product', async () => {
    renderShop('/pif/grocers/dal-and-pulses');
    /*
     * AWAITED, because the shelf fetches its own products now. The first
     * frame is the loading state, and the empty wording is what the server's
     * empty page resolves to — a synchronous assertion was only ever reading
     * the spinner, and would go on passing if the empty state were deleted.
     */
    expect(await screen.findByText(/no products on this shelf yet/i)).toBeInTheDocument();
    // Checked AFTER the shelf has settled, so this says "a resolved empty
    // shelf prints no price" rather than "a spinner prints no price".
    expect(document.body.textContent ?? '').not.toMatch(/₹/);
  });

  it('TEST 9b — the header carries the Grocers logo, the facility line and the delivery pin', () => {
    renderShop();
    const logo = screen.getByAltText(/grocers logo/i);
    // Never Fresh Mart's file, which is the specific mistake to guard.
    expect(logo.getAttribute('src')).toBe('/brands/grocers.jpg');
    expect(screen.getByText('Payment Issue Facility')).toBeInTheDocument();
    // The pin says how the order arrives and in which city. It names no
    // residential area, and this assertion is what keeps one from returning.
    expect(screen.getByText('Home delivery')).toBeInTheDocument();
    expect(screen.getByText('Visakhapatnam')).toBeInTheDocument();
    expect(screen.queryByText(/nofra/i)).not.toBeInTheDocument();
  });

  it('TEST 9c — the tagline is the written correction, not the mockup wording', () => {
    renderShop();
    // An approved mockup printed "Payment in Facility"; the client corrected
    // it in writing afterwards. The correction wins, on both shops.
    expect(document.body.textContent ?? '').not.toMatch(/payment in facility/i);
  });

  it('TEST 9d — at the shop home the drawer holds the nineteen main categories', async () => {
    const user = userEvent.setup();
    renderShop();
    expect(screen.queryByTestId('shop-drawer')).toBeNull();

    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const drawer = screen.getByTestId('shop-drawer');
    const rail = within(drawer).getByTestId('category-sidebar');
    // Nineteen mains, not 154 entries: a drawer a page and a half long is
    // not navigation. The subcategories open in the grid instead.
    expect(within(rail).getAllByRole('button')).toHaveLength(19);
  });

  it('TEST 9e — choosing from the drawer closes it and opens that category', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const rail = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    await user.click(within(rail).getByRole('button', { name: /^dal & pulses$/i }));

    expect(screen.queryByTestId('shop-drawer')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Dal & Pulses', level: 1 })).toBeInTheDocument();
  });

  it('TEST 9f — the bottom bar has the five approved items', () => {
    renderShop();
    const nav = screen.getByTestId('shop-bottom-nav');
    const labels = within(nav).getAllByRole('button').map((b) => (b.textContent ?? '').trim());
    expect(labels).toEqual(['Home', 'Categories', 'Cart', 'Orders', 'Account']);
  });

  it('TEST 9g — invents no product, price, count or sort control', async () => {
    renderShop('/pif/grocers/rice-atta-and-flour/basmati-rice');
    // The shelf is settled FIRST: every assertion below is about what a
    // resolved empty shelf prints, not about what a spinner happens not to.
    expect(await screen.findByText(/no products on this shelf yet/i)).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    // The approved mockup's third panel shows India Gate at ₹165 and
    // "Showing 24 products". None of it is real, so none of it is printed.
    expect(body).not.toMatch(/₹/);
    expect(body).not.toMatch(/showing \d+ products/i);
    expect(body).not.toMatch(/sort by/i);
    expect(body).not.toMatch(/india gate|daawat|kohinoor/i);
    expect(screen.getByText(/no products on this shelf yet/i)).toBeInTheDocument();
  });

  it('TEST 9h — the shelves that really hold stock are still reachable from the home', async () => {
    renderShop();
    // The live catalogue section is what the working grocery shop has always
    // shown. Losing it to a redesign would be a regression, not a redesign.
    expect(await screen.findByText(/currently stocked/i)).toBeInTheDocument();
    expect(await screen.findByText(/nothing stocked yet/i)).toBeInTheDocument();
  });
});

describe('Fresh Mart — the approved mobile screen', () => {
  const renderShop = (path = '/pif/fresh-mart') =>
    renderAt(
      path,
      <FreshMartShopPage />,
      '/pif/fresh-mart',
      '/pif/fresh-mart/:mainSlug',
      '/pif/fresh-mart/:mainSlug/:subSlug'
    );

  it('TEST 22 — the header carries the logo, the tagline and the delivery pin', () => {
    renderShop();
    const logo = screen.getByAltText(/fresh mart logo/i);
    // Never the Grocers file, which is the mirror of the Grocers guard.
    expect(logo.getAttribute('src')).toBe('/brands/fresh-mart.jpg');
    expect(screen.getByText('Payment Issue Facility')).toBeInTheDocument();
    // The pin says how the order arrives and in which city. It names no
    // residential area, and this assertion is what keeps one from returning.
    expect(screen.getByText('Home delivery')).toBeInTheDocument();
    expect(screen.getByText('Visakhapatnam')).toBeInTheDocument();
    expect(screen.queryByText(/nofra/i)).not.toBeInTheDocument();
  });

  it('TEST 22b — the home shows every category on the screen, not only behind the menu', () => {
    // The defect: browsing Fresh Mart began with a tap on the hamburger,
    // because the categories existed nowhere else. Both mains and all eight
    // subcategories must now be visible on arrival.
    renderShop();
    const veg = screen.getByTestId('category-grid-vegetables');
    const fruit = screen.getByTestId('category-grid-fruits');
    expect(within(veg).getAllByRole('button')).toHaveLength(6);
    expect(within(fruit).getAllByRole('button')).toHaveLength(2);

    // Headed by their own main category. getAllBy, not getBy: the docked
    // desktop sidebar carries the same two names as its section headings,
    // so the content heading is identified by being the section's <h2>.
    for (const name of ['Vegetables', 'Fruits']) {
      const headings = screen.getAllByRole('heading', { name });
      expect(headings.some((h) => h.tagName === 'H2')).toBe(true);
    }
    // And none of this required opening the drawer.
    expect(screen.queryByTestId('shop-drawer')).toBeNull();
  });

  it('TEST 22c — every tile on the home carries its own Fresh Mart picture', () => {
    renderShop();
    const tiles = [
      ...within(screen.getByTestId('category-grid-vegetables')).getAllByRole('button'),
      ...within(screen.getByTestId('category-grid-fruits')).getAllByRole('button'),
    ];
    expect(tiles).toHaveLength(8);
    for (const tile of tiles) {
      const img = tile.querySelector('img');
      expect(img).not.toBeNull();
      // Fresh Mart's own artwork, never Grocers'.
      expect(img!.getAttribute('src')).toMatch(/^\/brands\/fresh-mart\/categories\/.+\.webp$/);
    }
  });

  it('TEST 22d — a tile on the home opens that shelf', async () => {
    const user = userEvent.setup();
    renderShop();
    const veg = screen.getByTestId('category-grid-vegetables');
    await user.click(within(veg).getByRole('button', { name: /leafy vegetables/i }));
    expect(screen.getByRole('heading', { name: 'Leafy Vegetables' })).toBeInTheDocument();
  });

  it('TEST 22e — inside a main the grid is that main’s shelves, and the rail appears', () => {
    // The Grocers rule, applied to Fresh Mart: a grid to choose a shelf,
    // and the sibling rail beside the content once one is open.
    renderShop('/pif/fresh-mart/vegetables');
    expect(within(screen.getByTestId('category-grid')).getAllByRole('button')).toHaveLength(6);
    const rail = within(screen.getByTestId('shop-rail')).getByTestId('category-sidebar');
    expect(within(rail).getAllByRole('button')).toHaveLength(6);
  });

  it('TEST 22f — with a shelf open the grid steps aside and the rail carries the siblings', () => {
    renderShop('/pif/fresh-mart/vegetables/leafy-vegetables');
    expect(screen.queryByTestId('category-grid')).toBeNull();
    const rail = within(screen.getByTestId('shop-rail')).getByTestId('category-sidebar');
    expect(within(rail).getAllByRole('button')).toHaveLength(6);
  });

  it('TEST 22g — Fresh Mart never shows a Grocers category', () => {
    renderShop();
    const body = document.body.textContent ?? '';
    for (const grocersOnly of ['Rice, Atta & Flour', 'Oil & Ghee', 'Pet Care', 'Baby Care']) {
      expect(body).not.toContain(grocersOnly);
    }
  });

  it('TEST 23 — the category drawer opens from the menu and holds all ten entries, grouped', async () => {
    const user = userEvent.setup();
    renderShop();
    expect(screen.queryByTestId('shop-drawer')).toBeNull();

    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const drawer = screen.getByTestId('shop-drawer');
    const rail = within(drawer).getByTestId('category-sidebar');
    expect(within(rail).getAllByRole('button')).toHaveLength(10);
    expect(within(rail).getByRole('region', { name: 'Vegetables' })).toBeInTheDocument();
    expect(within(rail).getByRole('region', { name: 'Fruits' })).toBeInTheDocument();
  });

  it('TEST 24 — every drawer row shows its picture beside the label', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const rail = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    for (const button of within(rail).getAllByRole('button')) {
      expect((button.textContent ?? '').trim().length).toBeGreaterThan(0);
      const img = button.querySelector('img');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toMatch(/^\/brands\/fresh-mart\/categories\/.+\.webp$/);
    }
  });

  it('TEST 24b — category pictures are not deferred, so no tile opens blank', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    // Regression: these were lazy, and Herbs & Coriander showed an empty
    // circle the moment the drawer opened. They are the navigation; they
    // must be requested immediately.
    const rail = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    const images = [...rail.querySelectorAll('img')];
    expect(images).toHaveLength(10);
    for (const img of images) {
      expect(img.getAttribute('loading')).toBe('eager');
      // The box is still reserved, so nothing shifts as they arrive.
      expect(img.getAttribute('width')).not.toBeNull();
      expect(img.getAttribute('height')).not.toBeNull();
    }
  });

  it('TEST 25 — choosing a category closes the drawer and shows it, with a breadcrumb', async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole('button', { name: /open categories/i }));

    const rail = within(screen.getByTestId('shop-drawer')).getByTestId('category-sidebar');
    await user.click(within(rail).getByRole('button', { name: /seasonal fruits/i }));

    // The drawer must get out of the way on a phone.
    expect(screen.queryByTestId('shop-drawer')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Seasonal Fruits' })).toBeInTheDocument();

    const crumbs = screen.getByRole('navigation', { name: /breadcrumb/i });
    expect(within(crumbs).getByText('Fresh Mart')).toBeInTheDocument();
    expect(within(crumbs).getByText('Fruits')).toBeInTheDocument();
    expect(within(crumbs).getByText('Seasonal Fruits')).toBeInTheDocument();
  });

  it('TEST 26 — a deep link resolves to its own category', () => {
    renderShop('/pif/fresh-mart/fruits/seasonal-fruits');
    expect(screen.getByRole('heading', { name: 'Seasonal Fruits' })).toBeInTheDocument();
  });

  it('TEST 27 — the bottom bar has the five approved items', () => {
    renderShop();
    const nav = screen.getByTestId('shop-bottom-nav');
    const labels = within(nav).getAllByRole('button').map((b) => (b.textContent ?? '').trim());
    expect(labels).toEqual(['Home', 'Categories', 'Cart', 'Orders', 'Account']);
  });

  it('TEST 28 — no price, stock or product is invented while the catalogue is empty', async () => {
    renderShop('/pif/fresh-mart/fruits/seasonal-fruits');
    // Settled first, for the same reason as the Grocers shelf: this wording
    // now appears only after a successful call that returned no rows, so a
    // synchronous read would have been testing the loading state.
    expect(await screen.findByText(/catalogue not loaded yet/i)).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/₹/);
    expect(body).not.toMatch(/showing \d+ products/i);
    expect(body).not.toMatch(/sort by/i);
    expect(screen.getByText(/catalogue not loaded yet/i)).toBeInTheDocument();
    // The cart badge reflects real state, which is empty in this test.
    expect(screen.queryByText('3')).toBeNull();
  });

  it('TEST 29 — Grocers opens one main at a time, so the two drawers differ in size only', () => {
    renderAt('/pif/grocers/dal-and-pulses', <GrocersShopPage />, '/pif/grocers/:mainSlug');
    // Same component, same layout, same selection behaviour. What differs is
    // depth: Fresh Mart's ten entries all fit in one drawer under their two
    // headings, where Grocers opens one main at a time and shows that main's
    // subcategories — flat, no section headings.
    const rail = within(screen.getByTestId('shop-rail')).getByTestId('category-sidebar');
    expect(within(rail).getAllByRole('button')).toHaveLength(9);
    expect(within(rail).queryByRole('region')).toBeNull();
    expect(within(screen.getByTestId('category-grid')).getAllByRole('button')).toHaveLength(9);
  });
});

describe('Fresh Mart category photographs', () => {
  it('TEST 17 — every Fresh Mart category has its own picture, and no picture is shared', () => {
    const slugs = FRESH_MART_CATEGORIES.flatMap((m) => [
      m.slug,
      ...m.subcategories.map((s) => s.slug),
    ]);
    expect(slugs).toHaveLength(10); // 2 mains + 8 subcategories

    const missing = slugs.filter((s) => categoryImage('fresh-mart', s) === null);
    expect(missing).toEqual([]);

    // A shared file would mean a collage panel landed on two shelves.
    const sources = slugs.map((s) => categoryImage('fresh-mart', s)!.src);
    expect(new Set(sources).size).toBe(10);
  });

  it('TEST 18 — each file is named after its own category slug', () => {
    for (const main of FRESH_MART_CATEGORIES) {
      for (const slug of [main.slug, ...main.subcategories.map((s) => s.slug)]) {
        expect(categoryImage('fresh-mart', slug)!.src).toBe(
          `/brands/fresh-mart/categories/${slug}.webp`
        );
      }
    }
  });

  it('TEST 19 — the picture map carries nothing that is not a Fresh Mart category', () => {
    const known = new Set(
      FRESH_MART_CATEGORIES.flatMap((m) => [m.slug, ...m.subcategories.map((s) => s.slug)])
    );
    expect(FRESH_MART_IMAGE_SLUGS.filter((s) => !known.has(s))).toEqual([]);
  });

  it('TEST 20 — no Grocers category serves a Fresh Mart photograph', () => {
    // Narrowed deliberately: Grocers now HAS artwork of its own for Rice,
    // Atta & Flour, so "Grocers has no pictures" is no longer the claim.
    // What must stay true is that the two businesses never serve each
    // other's files. TEST 33 covers the Grocers/ILLUSTRATED agreement.
    const grocersSlugs = GROCERS_CATEGORIES.flatMap((m) => [
      m.slug,
      ...m.subcategories.map((s) => s.slug),
    ]);
    const leaked = grocersSlugs
      .map((slug) => categoryImage('grocers', slug))
      .filter((img): img is NonNullable<typeof img> => img !== null)
      .filter((img) => img.src.includes('/brands/fresh-mart/'));
    expect(leaked).toEqual([]);
    expect(categoryImage('grocers', 'vegetables')).toBeNull();
  });

  it('TEST 21 — every picture carries alt text naming what it shows', () => {
    for (const slug of FRESH_MART_IMAGE_SLUGS) {
      const image = categoryImage('fresh-mart', slug)!;
      expect(image.alt.length).toBeGreaterThan(12);
      // Not a claim about stock — a description of the shelf.
      expect(image.alt).not.toMatch(/in stock|available now|buy/i);
    }
  });
});

describe('Grocers — Rice, Atta & Flour photographs', () => {
  const RICE = GROCERS_CATEGORIES.find((m) => m.slug === 'rice-atta-and-flour')!;
  const DAL = GROCERS_CATEGORIES.find((m) => m.slug === 'dal-and-pulses')!;
  const OIL = GROCERS_CATEGORIES.find((m) => m.slug === 'oil-and-ghee')!;
  const SPICE = GROCERS_CATEGORIES.find((m) => m.slug === 'salt-sugar-and-spices')!;
  const DAIRY = GROCERS_CATEGORIES.find((m) => m.slug === 'dairy-and-eggs')!;
  const BAKERY = GROCERS_CATEGORIES.find((m) => m.slug === 'bakery')!;
  const SNACKS = GROCERS_CATEGORIES.find((m) => m.slug === 'biscuits-and-snacks')!;
  const CHOC = GROCERS_CATEGORIES.find((m) => m.slug === 'chocolates-and-confectionery')!;
  const TEA = GROCERS_CATEGORIES.find((m) => m.slug === 'tea-and-coffee')!;
  const BEV = GROCERS_CATEGORIES.find((m) => m.slug === 'beverages')!;
  const IPF = GROCERS_CATEGORIES.find((m) => m.slug === 'instant-and-packaged-foods')!;
  const BFC = GROCERS_CATEGORIES.find((m) => m.slug === 'breakfast-and-cereals')!;
  const SPS = GROCERS_CATEGORIES.find((m) => m.slug === 'sauces-pickles-and-spreads')!;
  const FRZ = GROCERS_CATEGORIES.find((m) => m.slug === 'frozen-and-ice-cream')!;
  const HCL = GROCERS_CATEGORIES.find((m) => m.slug === 'home-cleaning')!;
  const PCR = GROCERS_CATEGORIES.find((m) => m.slug === 'personal-care')!;
  const BBY = GROCERS_CATEGORIES.find((m) => m.slug === 'baby-care')!;
  const PJA = GROCERS_CATEGORIES.find((m) => m.slug === 'pooja-and-household-essentials')!;
  const PET = GROCERS_CATEGORIES.find((m) => m.slug === 'pet-care')!;
  /** Mains that have artwork so far. Every other main must still be iconned. */
  const ILLUSTRATED = [RICE, DAL, OIL, SPICE, DAIRY, BAKERY, SNACKS, CHOC, TEA, BEV, IPF, BFC, SPS, FRZ, HCL, PCR, BBY, PJA, PET];
  /**
   * Approved subcategories knowingly still on their icon, because no artwork
   * for them has been supplied. Listed, not inferred, so closing one of
   * these gaps is a deliberate edit to this line rather than something that
   * happens quietly. Empty again: 'diapers' and then the Pooja & Household
   * Essentials MAIN tile each sat here until replacement artwork was
   * supplied, and closing each gap was a deliberate edit to this line.
   */
  const AWAITING_ARTWORK: readonly string[] = [];

  it('TEST 30 — the main category and all nine approved subcategories have a picture', () => {
    expect(categoryImage('grocers', RICE.slug)).not.toBeNull();
    expect(RICE.subcategories).toHaveLength(9);
    const missing = RICE.subcategories
      .filter((s) => categoryImage('grocers', s.slug) === null)
      .map((s) => s.name);
    expect(missing).toEqual([]);
  });

  it('TEST 31 — no two of them share a file, and none reuses the main image', () => {
    const subs = RICE.subcategories.map((s) => categoryImage('grocers', s.slug)!.src);
    expect(new Set(subs).size).toBe(9);
    const main = categoryImage('grocers', RICE.slug)!.src;
    expect(subs).not.toContain(main);
  });

  it('TEST 32 — every file sits under this main category and is named for its slug', () => {
    for (const sub of RICE.subcategories) {
      expect(categoryImage('grocers', sub.slug)!.src).toBe(
        `/brands/grocers/categories/rice-atta-and-flour/${sub.slug}.webp`
      );
    }
  });

  it('TEST 33 — every Grocers main without supplied artwork is still iconned', () => {
    // The guard was that artwork arrives one approved category at a time
    // and never leaks sideways: a main nobody had supplied a sheet for had
    // to show its icon, not a borrowed picture from the one next to it.
    // Every Grocers main is illustrated now, so there is no longer an
    // unillustrated main to check — ILLUSTRATED covers the whole tree.
    // What the test can still guarantee is that the two lists agree, so a
    // future category added to the tree without artwork is caught here
    // rather than silently borrowing a neighbour's picture.
    const done = new Set(ILLUSTRATED.map((m) => m.slug));
    const others = GROCERS_CATEGORIES.filter((m) => !done.has(m.slug));
    expect(others).toEqual([]);
    const withPictures = others.flatMap((m) =>
      [m.slug, ...m.subcategories.map((s) => s.slug)].filter(
        (slug) => categoryImage('grocers', slug) !== null
      )
    );
    expect(withPictures).toEqual([]);
  });

  it('TEST 34 — the Grocers map carries nothing outside the illustrated categories', () => {
    const allowed = new Set(
      ILLUSTRATED.flatMap((m) => [m.slug, ...m.subcategories.map((s) => s.slug)])
    );
    expect(GROCERS_IMAGE_SLUGS.filter((s) => !allowed.has(s))).toEqual([]);
  });

  it('TEST 37 — Dal & Pulses: the main and all nine approved subcategories have a picture', () => {
    expect(categoryImage('grocers', DAL.slug)).not.toBeNull();
    expect(DAL.subcategories).toHaveLength(9);
    const missing = DAL.subcategories
      .filter((s) => categoryImage('grocers', s.slug) === null)
      .map((s) => s.name);
    expect(missing).toEqual([]);
  });

  it('TEST 38 — no two Dal & Pulses files are shared, and none reuses the main image', () => {
    const subs = DAL.subcategories.map((s) => categoryImage('grocers', s.slug)!.src);
    expect(new Set(subs).size).toBe(9);
    expect(subs).not.toContain(categoryImage('grocers', DAL.slug)!.src);
  });

  it('TEST 39 — every Dal & Pulses file sits under its own main and is named for its slug', () => {
    for (const slug of [DAL.slug, ...DAL.subcategories.map((s) => s.slug)]) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/dal-and-pulses/${slug}.webp`
      );
    }
  });

  it('TEST 40 — the approved Dal & Pulses structure was not reshaped to fit the artwork', () => {
    expect(DAL.subcategories.map((s) => s.name)).toEqual([
      'Toor Dal',
      'Moong Dal',
      'Masoor Dal',
      'Urad Dal',
      'Chana Dal',
      'Rajma',
      'Kabuli Chana',
      'Green Gram',
      'Black Gram',
    ]);
  });

  it('TEST 43 — Oil & Ghee: the main and all seven approved subcategories have a picture', () => {
    expect(categoryImage('grocers', OIL.slug)).not.toBeNull();
    expect(OIL.subcategories).toHaveLength(7);
    const missing = OIL.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.name);
    expect(missing).toEqual([]);
  });

  it('TEST 44 — no two Oil & Ghee files are shared, and none reuses the main image', () => {
    const subs = OIL.subcategories.map((sub) => categoryImage('grocers', sub.slug)!.src);
    expect(new Set(subs).size).toBe(7);
    expect(subs).not.toContain(categoryImage('grocers', OIL.slug)!.src);
  });

  it('TEST 45 — every Oil & Ghee file sits under its own main and is named for its slug', () => {
    for (const slug of [OIL.slug, ...OIL.subcategories.map((sub) => sub.slug)]) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/oil-and-ghee/${slug}.webp`
      );
    }
  });

  it('TEST 46 — the approved Oil & Ghee structure was not reshaped to fit the artwork', () => {
    expect(OIL.subcategories.map((sub) => sub.name)).toEqual([
      'Sunflower Oil',
      'Groundnut Oil',
      'Rice Bran Oil',
      'Palm Oil',
      'Coconut Oil',
      'Sesame Oil',
      'Ghee',
    ]);
  });

  it('TEST 48 — Salt, Sugar & Spices: the main and all ten approved subcategories have a picture', () => {
    expect(categoryImage('grocers', SPICE.slug)).not.toBeNull();
    expect(SPICE.subcategories).toHaveLength(10);
    const missing = SPICE.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.name);
    expect(missing).toEqual([]);
  });

  it('TEST 49 — no two Salt, Sugar & Spices files are shared, and none reuses the main image', () => {
    const subs = SPICE.subcategories.map((sub) => categoryImage('grocers', sub.slug)!.src);
    expect(new Set(subs).size).toBe(10);
    expect(subs).not.toContain(categoryImage('grocers', SPICE.slug)!.src);
  });

  it('TEST 50 — every Salt, Sugar & Spices file is named for its slug, under the main\'s own folder', () => {
    // The folder is the MAIN'S SLUG, not a shortened spelling of its name:
    // "salt-sugar-and-spices", the same key the URL uses. A folder named
    // differently from the slug is how an asset quietly goes missing later.
    for (const slug of [SPICE.slug, ...SPICE.subcategories.map((sub) => sub.slug)]) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/salt-sugar-and-spices/${slug}.webp`
      );
    }
  });

  it('TEST 51 — the approved Salt, Sugar & Spices structure was not reshaped to fit the artwork', () => {
    expect(SPICE.subcategories.map((sub) => sub.name)).toEqual([
      'Salt',
      'Sugar',
      'Jaggery',
      'Chilli Powder',
      'Turmeric',
      'Coriander Powder',
      'Pepper',
      'Whole Spices',
      'Garam Masala',
      'Curry Masala',
    ]);
  });

  it('TEST 52 — Dairy & Eggs: the main and all nine approved subcategories have a picture', () => {
    expect(categoryImage('grocers', DAIRY.slug)).not.toBeNull();
    expect(DAIRY.subcategories).toHaveLength(9);
    const missing = DAIRY.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.name);
    expect(missing).toEqual([]);
  });

  it('TEST 53 — no two Dairy & Eggs files are shared, and none reuses the main image', () => {
    const subs = DAIRY.subcategories.map((sub) => categoryImage('grocers', sub.slug)!.src);
    expect(new Set(subs).size).toBe(9);
    expect(subs).not.toContain(categoryImage('grocers', DAIRY.slug)!.src);
  });

  it('TEST 54 — every Dairy & Eggs file is named for its slug, under the main\'s own folder', () => {
    for (const slug of [DAIRY.slug, ...DAIRY.subcategories.map((sub) => sub.slug)]) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/dairy-and-eggs/${slug}.webp`
      );
    }
  });

  it('TEST 55 — the approved Dairy & Eggs structure was not reshaped to fit the artwork', () => {
    expect(DAIRY.subcategories.map((sub) => sub.name)).toEqual([
      'Milk',
      'Curd',
      'Buttermilk',
      'Paneer',
      'Butter',
      'Cheese',
      'Cream',
      'Lassi',
      'Eggs',
    ]);
  });

  it('TEST 56 — Bakery: the main and all seven subcategories have a picture', () => {
    expect(categoryImage('grocers', BAKERY.slug)).not.toBeNull();
    expect(BAKERY.subcategories).toHaveLength(7);
    const without = BAKERY.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 57 — Cakes has its own file, not a neighbour\'s and not a RIK one', () => {
    // It sat on its icon until its own artwork arrived. The failure this
    // guards is an edit that points `cakes` at the Cookies or Bakery Snacks
    // file, or at the RIK ration photograph of a cup cake that also lives
    // in this repository.
    const cakes = categoryImage('grocers', 'cakes');
    expect(cakes).not.toBeNull();
    expect(cakes!.src).toBe('/brands/grocers/categories/bakery/cakes.webp');
    for (const sibling of ['cookies', 'bakery-snacks', 'bread', 'pav', 'buns', 'rusk']) {
      expect(cakes!.src).not.toBe(categoryImage('grocers', sibling)!.src);
    }
    expect(cakes!.src).not.toContain('/catalogue/');
    // The icon stays defined in the tree as the fallback for any future
    // state where the file is missing.
    const entry = BAKERY.subcategories.find((sub) => sub.slug === 'cakes')!;
    expect(entry.name).toBe('Cakes');
    expect(entry.icon in CATEGORY_ICONS).toBe(true);
  });

  it('TEST 58 — no two Bakery files are shared, and none reuses the main image', () => {
    const subs = BAKERY.subcategories.map((sub) => categoryImage('grocers', sub.slug)!.src);
    expect(subs).toHaveLength(7);
    expect(new Set(subs).size).toBe(7);
    expect(subs).not.toContain(categoryImage('grocers', BAKERY.slug)!.src);
  });

  it('TEST 59 — every Bakery file is named for its slug, under the main\'s own folder', () => {
    for (const slug of [BAKERY.slug, ...BAKERY.subcategories.map((sub) => sub.slug)]) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/bakery/${slug}.webp`
      );
    }
  });

  it('TEST 60 — the approved Bakery structure was not reshaped to fit the artwork', () => {
    // Six panels were supplied for seven approved shelves. The answer was a
    // missing picture, never a missing or renamed subcategory.
    expect(BAKERY.subcategories.map((sub) => sub.name)).toEqual([
      'Bread',
      'Buns',
      'Cakes',
      'Rusk',
      'Cookies',
      'Pav',
      'Bakery Snacks',
    ]);
  });

  it('TEST 61 — no Grocers category serves a file from another module', () => {
    // A RIK ration photograph of a cup cake exists in this repository. It
    // belongs to the ration catalogue and must never be borrowed to fill a
    // PIF category tile.
    for (const slug of GROCERS_IMAGE_SLUGS) {
      expect(categoryImage('grocers', slug)!.src).toMatch(/^\/brands\/grocers\/categories\//);
    }
  });

  it('TEST 62 — Biscuits & Snacks holds the approved SIX, not the nine on the sheet', () => {
    // The supplied sheet carries nine panels: Biscuits, Cookies, Wafers,
    // Potato Chips, Namkeen, Popcorn, Nuts & Dry Snacks, Crackers, Fryums.
    // The approved catalogue has six shelves. The catalogue was not widened
    // to fit the artwork — which would also have pushed the Grocers total
    // past its approved 135.
    expect(SNACKS.subcategories.map((sub) => sub.name)).toEqual([
      'Biscuits',
      'Chips',
      'Namkeen',
      'Mixtures',
      'Popcorn',
      'Fryums',
    ]);
  });

  it('TEST 63 — nothing anywhere serves an unmapped- file', () => {
    // A replaced sheet once left four orphan crops in the tree. They are
    // gone, and this keeps any future orphan from being wired up.
    for (const slug of GROCERS_IMAGE_SLUGS) {
      expect(categoryImage('grocers', slug)!.src).not.toContain('/unmapped-');
    }
    for (const orphan of ['nuts-and-dry-snacks', 'crackers', 'cookies-sheet']) {
      // None of them is reachable as a Grocers category slug. "wafers" was
      // on this list until Chocolates & Confectionery arrived, where it is
      // a real approved shelf — see TEST 70.
      expect(categoryImage('grocers', orphan)).toBeNull();
    }
  });

  it('TEST 64 — Mixtures has its own picture, not Namkeen\'s', () => {
    // Neighbouring shelves of similar food: exactly where a borrowed or
    // duplicated picture slips through unnoticed.
    const mixtures = categoryImage('grocers', 'mixtures');
    const namkeen = categoryImage('grocers', 'namkeen');
    expect(mixtures).not.toBeNull();
    expect(namkeen).not.toBeNull();
    expect(mixtures!.src).not.toBe(namkeen!.src);
    expect(mixtures!.src).toContain('/mixtures.webp');
  });

  it('TEST 65 — Biscuits & Snacks files are distinct, named for their slug, in their own folder', () => {
    const slugs = [SNACKS.slug, ...SNACKS.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(7); // the main and all six of its shelves
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(7);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/biscuits-and-snacks/${slug}.webp`
      );
    }
  });

  it('TEST 67 — every shelf of every illustrated main has a picture, bar the declared gaps', () => {
    // The point of this test is that a gap can only exist if someone wrote
    // it into AWAITING_ARTWORK on purpose. It used to also assert the list
    // was empty, which was true while it happened to be empty and became
    // wrong the moment a real gap was declared (Baby Care's Diapers, which
    // the supplied sheet had no panel for). Comparing against the declared
    // list is the assertion that actually guards the thing.
    //
    // It also used to scan subcategories only, which silently stopped
    // covering the whole surface the moment a MAIN tile was the thing held
    // back (Pooja & Household Essentials, whose supplied main artwork
    // carried a deity statue the brief ruled out). It now scans main tiles
    // and shelves alike, so either kind of gap has to be declared.
    const missing = GROCERS_CATEGORIES.filter((main) =>
      ILLUSTRATED.some((done) => done.slug === main.slug)
    ).flatMap((main) =>
      [main.slug, ...main.subcategories.map((sub) => sub.slug)].filter(
        (slug) => categoryImage('grocers', slug) === null
      )
    );
    expect(new Set(missing)).toEqual(new Set(AWAITING_ARTWORK));
  });

  it('TEST 66 — the Grocers tree still holds exactly 19 mains and 135 subcategories', () => {
    // Restated here, beside the mismatch it guards: a sheet with more
    // panels than shelves must never be resolved by adding shelves.
    expect(GROCERS_CATEGORIES).toHaveLength(19);
    expect(allSubcategories(GROCERS_CATEGORIES)).toHaveLength(135);
  });

  it('TEST 68 — Chocolates & Confectionery: the main and all five shelves have a picture', () => {
    expect(categoryImage('grocers', CHOC.slug)).not.toBeNull();
    expect(CHOC.subcategories.map((sub) => sub.name)).toEqual([
      'Chocolates',
      'Candies',
      'Toffees',
      'Wafers',
      'Chewing Gum',
    ]);
    const without = CHOC.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 69 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [CHOC.slug, ...CHOC.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(6);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(6);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/chocolates-and-confectionery/${slug}.webp`
      );
    }
  });

  it('TEST 70 — Wafers is this category\'s shelf, and Bakery is untouched by it', () => {
    // The map is keyed by bare slug, so a subcategory name that also sounds
    // like a Bakery shelf is exactly where a wrong file would slip in.
    const wafers = categoryImage('grocers', 'wafers')!;
    expect(wafers.src).toContain('/chocolates-and-confectionery/');
    expect(wafers.src).not.toContain('/bakery/');
    // `wafers` belongs to this main alone across all nineteen.
    const owners = GROCERS_CATEGORIES.filter((main) =>
      main.subcategories.some((sub) => sub.slug === 'wafers')
    ).map((main) => main.slug);
    expect(owners).toEqual(['chocolates-and-confectionery']);
    // Bakery's own shelves still point into Bakery.
    for (const slug of BAKERY.subcategories.map((sub) => sub.slug)) {
      expect(categoryImage('grocers', slug)!.src).toContain('/bakery/');
    }
  });

  it('TEST 71 — Tea & Coffee: the main and all six shelves have a picture, in order', () => {
    expect(categoryImage('grocers', TEA.slug)).not.toBeNull();
    expect(TEA.subcategories.map((sub) => sub.name)).toEqual([
      'Tea',
      'Green Tea',
      'Coffee',
      'Instant Coffee',
      'Tea Premixes',
      'Health Drinks',
    ]);
    const without = TEA.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 72 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [TEA.slug, ...TEA.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(7);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(7);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/tea-and-coffee/${slug}.webp`
      );
    }
  });

  it('TEST 73 — Instant Coffee and Tea Premixes are not the same picture', () => {
    // Adjacent panels of similar shape. Transposing them would leave every
    // automated check green and every tile wrong.
    const instant = categoryImage('grocers', 'instant-coffee')!;
    const premix = categoryImage('grocers', 'tea-premixes')!;
    expect(instant.src).not.toBe(premix.src);
    expect(instant.src).toContain('/instant-coffee.webp');
    expect(premix.src).toContain('/tea-premixes.webp');
    // And neither has borrowed the plain Coffee or Tea shelf's file.
    expect(instant.src).not.toBe(categoryImage('grocers', 'coffee')!.src);
    expect(premix.src).not.toBe(categoryImage('grocers', 'tea')!.src);
  });

  it('TEST 74 — Beverages: the main and all six shelves have a picture, in order', () => {
    expect(categoryImage('grocers', BEV.slug)).not.toBeNull();
    expect(BEV.subcategories.map((sub) => sub.name)).toEqual([
      'Soft Drinks',
      'Juices',
      'Energy Drinks',
      'Fruit Drinks',
      'Packaged Water',
      'Soda',
    ]);
    const without = BEV.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 75 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [BEV.slug, ...BEV.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(7);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(7);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/beverages/${slug}.webp`
      );
    }
  });

  it('TEST 76 — the four look-alike drink shelves are four different pictures', () => {
    // Soft Drinks and Soda are both bottles over ice; Juices and Fruit
    // Drinks are both orange cartons and filled glasses. Transposing either
    // pair would leave every automated check green.
    const four = ['soft-drinks', 'soda', 'juices', 'fruit-drinks'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['soft-drinks', 'soda', 'juices', 'fruit-drinks']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 77 — Instant & Packaged Foods: the main and all seven shelves have a picture, in order', () => {
    expect(categoryImage('grocers', IPF.slug)).not.toBeNull();
    expect(IPF.subcategories.map((sub) => sub.name)).toEqual([
      'Noodles',
      'Pasta',
      'Vermicelli',
      'Ready-to-Eat',
      'Ready-to-Cook',
      'Soup',
      'Instant Mixes',
    ]);
    const without = IPF.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 78 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [IPF.slug, ...IPF.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(8);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(8);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/instant-and-packaged-foods/${slug}.webp`
      );
    }
  });

  it('TEST 79 — the three ready-meal shelves are three different pictures', () => {
    // Ready-to-Eat, Ready-to-Cook and Instant Mixes are all pouches behind
    // bowls of prepared food. Transposing any two would leave every
    // automated check green.
    const three = ['ready-to-eat', 'ready-to-cook', 'instant-mixes'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(three).size).toBe(3);
    for (const slug of ['ready-to-eat', 'ready-to-cook', 'instant-mixes']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 80 — Breakfast & Cereals: the main and all seven shelves have a picture, in order', () => {
    expect(categoryImage('grocers', BFC.slug)).not.toBeNull();
    expect(BFC.subcategories.map((sub) => sub.name)).toEqual([
      'Oats',
      'Corn Flakes',
      'Muesli',
      'Cereals',
      'Poha',
      'Dalia',
      'Breakfast Mixes',
    ]);
    const without = BFC.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 81 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [BFC.slug, ...BFC.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(8);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(8);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/breakfast-and-cereals/${slug}.webp`
      );
    }
  });

  it('TEST 82 — the four cereal-box shelves are four different pictures', () => {
    // Oats, Corn Flakes, Muesli and Cereals are all boxes and pouches
    // standing behind a bowl. Transposing any two would leave every
    // automated check green.
    const four = ['oats', 'corn-flakes', 'muesli', 'cereals'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['oats', 'corn-flakes', 'muesli', 'cereals']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 83 — Sauces, Pickles & Spreads: the main and all eight shelves have a picture, in order', () => {
    expect(categoryImage('grocers', SPS.slug)).not.toBeNull();
    expect(SPS.subcategories.map((sub) => sub.name)).toEqual([
      'Pickles',
      'Ketchup',
      'Sauces',
      'Mayonnaise',
      'Jam',
      'Honey',
      'Peanut Butter',
      'Chutney',
    ]);
    const without = SPS.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 84 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [SPS.slug, ...SPS.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(9);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(9);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/sauces-pickles-and-spreads/${slug}.webp`
      );
    }
  });

  it('TEST 85 — the four poured-condiment shelves are four different pictures', () => {
    // Ketchup, Sauces, Mayonnaise and Chutney are all bottles standing
    // behind small bowls of sauce. Transposing any two would leave every
    // automated check green.
    const four = ['ketchup', 'sauces', 'mayonnaise', 'chutney'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['ketchup', 'sauces', 'mayonnaise', 'chutney']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it("TEST 86 — the main artwork's extra jars did not become shelves", () => {
    // The supplied main image also shows a chocolate-hazelnut spread and a
    // cheese spread. Neither is an approved subcategory, and artwork never
    // reshapes the catalogue.
    expect(SPS.subcategories).toHaveLength(8);
    for (const stray of ['nutella', 'chocolate-spread', 'cheese-spread']) {
      expect(categoryImage('grocers', stray)).toBeNull();
    }
  });

  it('TEST 87 — Frozen & Ice Cream: the main and all five shelves have a picture, in order', () => {
    expect(categoryImage('grocers', FRZ.slug)).not.toBeNull();
    expect(FRZ.subcategories.map((sub) => sub.name)).toEqual([
      'Ice Cream',
      'Kulfi',
      'Frozen Vegetables',
      'Frozen Snacks',
      'Frozen Paratha',
    ]);
    const without = FRZ.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 88 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [FRZ.slug, ...FRZ.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(6);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(6);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/frozen-and-ice-cream/${slug}.webp`
      );
    }
  });

  it('TEST 89 — the two frozen-packet shelves are two different pictures', () => {
    // Frozen Vegetables and Frozen Snacks are both printed pouches standing
    // behind bowls. Transposing them would leave every automated check green.
    const two = ['frozen-vegetables', 'frozen-snacks'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(two).size).toBe(2);
    for (const slug of ['frozen-vegetables', 'frozen-snacks']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 90 — the frozen main artwork did not add a seafood or momo shelf', () => {
    // The supplied main image also shows prawns, fish and momos. None is an
    // approved subcategory here, and artwork never reshapes the catalogue.
    expect(FRZ.subcategories).toHaveLength(5);
    for (const stray of ['seafood', 'frozen-seafood', 'momos', 'frozen-momos', 'prawns']) {
      expect(categoryImage('grocers', stray)).toBeNull();
    }
  });

  it('TEST 91 — Home Cleaning: the main and all seven shelves have a picture, in order', () => {
    expect(categoryImage('grocers', HCL.slug)).not.toBeNull();
    expect(HCL.subcategories.map((sub) => sub.name)).toEqual([
      'Detergent',
      'Dishwash',
      'Floor Cleaner',
      'Toilet Cleaner',
      'Glass Cleaner',
      'Fabric Care',
      'Garbage Bags',
    ]);
    const without = HCL.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 92 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [HCL.slug, ...HCL.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(8);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(8);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/home-cleaning/${slug}.webp`
      );
    }
  });

  it('TEST 93 — the four bottle-row shelves are four different pictures', () => {
    // Dishwash, Floor Cleaner, Toilet Cleaner and Glass Cleaner are all a
    // row of coloured bottles. Transposing any two would leave every
    // automated check green.
    const four = ['dishwash', 'floor-cleaner', 'toilet-cleaner', 'glass-cleaner'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['dishwash', 'floor-cleaner', 'toilet-cleaner', 'glass-cleaner']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 94 — Fabric Care keeps its own panel and Detergent keeps its own', () => {
    // The supplied Fabric Care panel includes a liquid-detergent bottle.
    // That is the artwork as drawn; it must not have been swapped onto
    // Detergent, and it must not have spawned an extra shelf.
    expect(HCL.subcategories).toHaveLength(7);
    const fabric = categoryImage('grocers', 'fabric-care')!.src;
    const detergent = categoryImage('grocers', 'detergent')!.src;
    expect(fabric).toContain('/fabric-care.webp');
    expect(detergent).toContain('/detergent.webp');
    expect(fabric).not.toBe(detergent);
    for (const stray of ['liquid-detergent', 'fabric-conditioner', 'ezee']) {
      expect(categoryImage('grocers', stray)).toBeNull();
    }
  });

  it('TEST 95 — Personal Care: the main and all nine shelves have a picture, in order', () => {
    expect(categoryImage('grocers', PCR.slug)).not.toBeNull();
    expect(PCR.subcategories.map((sub) => sub.name)).toEqual([
      'Bath Soap',
      'Shampoo',
      'Hair Oil',
      'Toothpaste',
      'Toothbrush',
      'Face Wash',
      'Creams',
      'Deodorants',
      'Shaving',
    ]);
    const without = PCR.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 96 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [PCR.slug, ...PCR.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(10);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(10);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/personal-care/${slug}.webp`
      );
    }
  });

  it('TEST 97 — the three bottle-row shelves are three different pictures', () => {
    // Shampoo, Hair Oil and Deodorants are all a row of tall coloured
    // bottles. Transposing any two would leave every automated check green.
    const three = ['shampoo', 'hair-oil', 'deodorants'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(three).size).toBe(3);
    for (const slug of ['shampoo', 'hair-oil', 'deodorants']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 98 — Toothpaste and Toothbrush stay two separate shelves', () => {
    // Adjacent panels on the sheet, adjacent names, same aisle. A swap or a
    // merge here is the single most plausible mistake in this category.
    const paste = categoryImage('grocers', 'toothpaste')!.src;
    const brush = categoryImage('grocers', 'toothbrush')!.src;
    expect(paste).toContain('/toothpaste.webp');
    expect(brush).toContain('/toothbrush.webp');
    expect(paste).not.toBe(brush);
    for (const stray of ['oral-care', 'dental', 'toothbrushes']) {
      expect(categoryImage('grocers', stray)).toBeNull();
    }
  });

  it('TEST 99 — Baby Care: the main and all six approved shelves have a picture, in order', () => {
    expect(categoryImage('grocers', BBY.slug)).not.toBeNull();
    expect(BBY.subcategories.map((sub) => sub.name)).toEqual([
      'Diapers',
      'Baby Food',
      'Baby Soap',
      'Baby Shampoo',
      'Baby Lotion',
      'Baby Wipes',
    ]);
    const without = BBY.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    // Diapers arrived on its own sheet after the other five, so there is
    // no gap left here. AWAITING_ARTWORK is empty again to match.
    expect(without).toEqual([]);
  });

  it('TEST 100 — Diapers has its own file, not the main artwork or a neighbour', () => {
    // The main Baby Care image also shows diaper packs, so cutting a tile
    // out of it would have looked plausible and been wrong. This shelf now
    // has its own supplied sheet; the assertion that matters is that it is
    // a file of its own, shared with nothing else in the category.
    const diapers = categoryImage('grocers', 'diapers');
    expect(diapers).not.toBeNull();
    expect(diapers!.src).toBe('/brands/grocers/categories/baby-care/diapers.webp');
    const main = categoryImage('grocers', BBY.slug)!.src;
    expect(diapers!.src).not.toBe(main);
    const siblings = ['baby-food', 'baby-soap', 'baby-shampoo', 'baby-lotion', 'baby-wipes'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(siblings).not.toContain(diapers!.src);
    expect(siblings).not.toContain(main);
    expect(new Set([main, diapers!.src, ...siblings]).size).toBe(7);
  });

  it('TEST 101 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [BBY.slug, ...BBY.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(7);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(7);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/baby-care/${slug}.webp`
      );
    }
  });

  it('TEST 102 — Baby Shampoo and Baby Lotion are not transposed', () => {
    // Same four brands, same bottle shapes, same backdrop; they are told
    // apart only by the label text. The likeliest silent error here.
    const shampoo = categoryImage('grocers', 'baby-shampoo')!.src;
    const lotion = categoryImage('grocers', 'baby-lotion')!.src;
    expect(shampoo).toContain('/baby-shampoo.webp');
    expect(lotion).toContain('/baby-lotion.webp');
    expect(shampoo).not.toBe(lotion);
  });

  it('TEST 103 — Pooja & Household Essentials: all eight shelves have a picture, in order', () => {
    expect(PJA.subcategories.map((sub) => sub.name)).toEqual([
      'Agarbatti',
      'Camphor',
      'Pooja Oil',
      'Wicks',
      'Match Boxes',
      'Batteries',
      'Tissue',
      'Aluminium Foil',
    ]);
    const without = PJA.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 104 — its main tile has its own file, and no shelf was promoted into it', () => {
    // The FIRST supplied main artwork carried a deity statue, which this
    // category's brief ruled out, so the main sat on its icon while the
    // tempting shortcut — promoting a collage panel into the main slot —
    // stayed available. A replacement square was supplied and installed.
    // The assertion that still matters is that the main is a file of its
    // own, shared with none of the eight shelves.
    const main = categoryImage('grocers', PJA.slug);
    expect(main).not.toBeNull();
    expect(main!.src).toBe(
      '/brands/grocers/categories/pooja-and-household-essentials/pooja-and-household-essentials.webp'
    );
    expect(AWAITING_ARTWORK).not.toContain(PJA.slug);
    const shelves = PJA.subcategories.map((sub) => categoryImage('grocers', sub.slug)!.src);
    expect(new Set(shelves).size).toBe(8);
    expect(shelves).not.toContain(main!.src);
    for (const src of shelves) {
      expect(src).not.toContain('/pooja-and-household-essentials.webp');
    }
  });

  it('TEST 105 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [PJA.slug, ...PJA.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(9);
    expect(new Set(slugs.map((slug) => categoryImage('grocers', slug)!.src)).size).toBe(9);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/pooja-and-household-essentials/${slug}.webp`
      );
    }
  });

  it('TEST 106 — the two look-alike pairs are not transposed', () => {
    // Agarbatti and Camphor are both red-and-gold pooja packaging over
    // brass; Tissue and Aluminium Foil are both flat printed cartons.
    const four = ['agarbatti', 'camphor', 'tissue', 'aluminium-foil'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['agarbatti', 'camphor', 'tissue', 'aluminium-foil']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 107 — Pet Care: the main and all four shelves have a picture, in order', () => {
    expect(categoryImage('grocers', PET.slug)).not.toBeNull();
    expect(PET.subcategories.map((sub) => sub.name)).toEqual([
      'Dog Food',
      'Cat Food',
      'Pet Treats',
      'Pet Accessories',
    ]);
    const without = PET.subcategories
      .filter((sub) => categoryImage('grocers', sub.slug) === null)
      .map((sub) => sub.slug);
    expect(without).toEqual([]);
  });

  it('TEST 108 — its files are distinct, named for their slug, in its own folder', () => {
    const slugs = [PET.slug, ...PET.subcategories.map((sub) => sub.slug)];
    expect(slugs).toHaveLength(5);
    const sources = slugs.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(5);
    for (const slug of slugs) {
      expect(categoryImage('grocers', slug)!.src).toBe(
        `/brands/grocers/categories/pet-care/${slug}.webp`
      );
    }
  });

  it('TEST 109 — the animal-led shelves are not transposed', () => {
    // Dog Food and Pet Treats both lead with a golden retriever behind
    // Pedigree packaging; Cat Food and Pet Treats both carry a tabby.
    const four = ['dog-food', 'cat-food', 'pet-treats', 'pet-accessories'].map(
      (slug) => categoryImage('grocers', slug)!.src
    );
    expect(new Set(four).size).toBe(4);
    for (const slug of ['dog-food', 'cat-food', 'pet-treats', 'pet-accessories']) {
      expect(categoryImage('grocers', slug)!.src).toContain(`/${slug}.webp`);
    }
  });

  it('TEST 110 — every Grocers main and every approved shelf now has its own picture', () => {
    // The closing assertion for the whole Grocers catalogue: 19 mains,
    // 135 shelves, 154 images, every one distinct and in its own folder,
    // and nothing left in AWAITING_ARTWORK.
    expect(AWAITING_ARTWORK).toEqual([]);
    expect(GROCERS_CATEGORIES).toHaveLength(19);
    const all = GROCERS_CATEGORIES.flatMap((main) => [
      main.slug,
      ...main.subcategories.map((sub) => sub.slug),
    ]);
    expect(all).toHaveLength(154);
    const missing = all.filter((slug) => categoryImage('grocers', slug) === null);
    expect(missing).toEqual([]);
    const sources = all.map((slug) => categoryImage('grocers', slug)!.src);
    expect(new Set(sources).size).toBe(154);
    for (const main of GROCERS_CATEGORIES) {
      for (const slug of [main.slug, ...main.subcategories.map((sub) => sub.slug)]) {
        expect(categoryImage('grocers', slug)!.src).toBe(
          `/brands/grocers/categories/${main.slug}/${slug}.webp`
        );
      }
    }
  });

  it('TEST 47 — the illustrated categories keep their files in separate folders', () => {
    // A path check, not a filename check: "rice" and "ghee" are short enough
    // that a flat folder would make a collision plausible later.
    for (const main of ILLUSTRATED) {
      for (const slug of [main.slug, ...main.subcategories.map((sub) => sub.slug)]) {
        const image = categoryImage('grocers', slug);
        // A subcategory still awaiting its panel has none, which is fine;
        // what must never happen is one pointing into another main's folder.
        if (image === null) {
          expect(AWAITING_ARTWORK).toContain(slug);
          continue;
        }
        expect(image.src).toContain(`/brands/grocers/categories/${main.slug}/`);
      }
    }
  });

  it('TEST 41 — a category picture never claims stock, a brand or a price', () => {
    // These sheets are illustrative generated artwork. The alt text must
    // describe the shelf, never assert that a named brand is carried or
    // that anything is available.
    for (const slug of GROCERS_IMAGE_SLUGS) {
      const image = categoryImage('grocers', slug)!;
      expect(image.alt.length).toBeGreaterThan(12);
      expect(image.alt).not.toMatch(/in stock|available|buy|₹|offer|aashirvaad|tata|sampann|mantra|gits/i);
    }
  });

  it('TEST 42 — no two Grocers categories anywhere share one file', () => {
    // Across both illustrated mains now, not just within one.
    const sources = GROCERS_IMAGE_SLUGS.map((s) => categoryImage('grocers', s)!.src);
    expect(new Set(sources).size).toBe(sources.length);
    // All 19 main tiles + every one of the 135 approved subcategories.
    expect(sources).toHaveLength(154);
  });

  it('TEST 35 — Fresh Mart pictures stay with Fresh Mart', () => {
    // "rice" exists only in Grocers, "vegetables" only in Fresh Mart; neither
    // business may serve the other's file.
    expect(categoryImage('fresh-mart', 'rice')).toBeNull();
    expect(categoryImage('grocers', 'vegetables')).toBeNull();
    for (const slug of FRESH_MART_IMAGE_SLUGS) {
      expect(categoryImage('grocers', slug)).toBeNull();
    }
  });

  it('TEST 36 — the approved structure was not changed to fit the artwork', () => {
    // The supplied sheet shows Broken Rice and Poha, which this catalogue
    // has no subcategory for. They must not have been added.
    const names = RICE.subcategories.map((s) => s.name);
    expect(names).toEqual([
      'Rice',
      'Basmati Rice',
      'Sona Masoori',
      'Brown Rice',
      'Atta',
      'Maida',
      'Besan',
      'Rava/Sooji',
      'Multigrain Flour',
    ]);
  });
});

describe('the generated category trees', () => {
  it('TEST 13 — hold exactly the approved structure', () => {
    expect(GROCERS_CATEGORIES).toHaveLength(19);
    expect(allSubcategories(GROCERS_CATEGORIES)).toHaveLength(135);
    expect(FRESH_MART_CATEGORIES).toHaveLength(2);
    expect(allSubcategories(FRESH_MART_CATEGORIES)).toHaveLength(8);
  });

  it('TEST 14 — every icon name resolves in the generated icon map', () => {
    // Checked against the map the sidebar actually renders from, not against
    // lucide's exports: those are not the same set, and the difference once
    // let a deprecated alias through that rendered as a blank circle.
    const unresolved: string[] = [];
    for (const tree of [GROCERS_CATEGORIES, FRESH_MART_CATEGORIES]) {
      for (const main of tree) {
        if (!(main.icon in CATEGORY_ICONS)) unresolved.push(`${main.name} -> ${main.icon}`);
        for (const sub of main.subcategories) {
          if (!(sub.icon in CATEGORY_ICONS)) unresolved.push(`${sub.name} -> ${sub.icon}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('TEST 14b — the icon map carries nothing the trees do not use', () => {
    // Guards the bundle: an unused entry here is a glyph shipped for nothing.
    const used = new Set(
      [...GROCERS_CATEGORIES, ...FRESH_MART_CATEGORIES].flatMap((m) => [
        m.icon,
        ...m.subcategories.map((s) => s.icon),
      ])
    );
    const surplus = Object.keys(CATEGORY_ICONS).filter((k) => !used.has(k));
    expect(surplus).toEqual([]);
  });

  it('TEST 15 — slugs are unique within each tree and URL-safe', () => {
    for (const tree of [GROCERS_CATEGORIES, FRESH_MART_CATEGORIES]) {
      const slugs = tree.flatMap((m) => [m.slug, ...m.subcategories.map((s) => `${m.slug}/${s.slug}`)]);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/);
    }
  });

  it('TEST 16 — business identity is kept apart from manufacturer brand', () => {
    // The six businesses must never appear as a `brand` value: `brand` means
    // Amul, Tata, Yard Fresh. Nothing in the business definitions writes one.
    const serialised = JSON.stringify(BUSINESSES);
    expect(serialised).not.toContain('"brand"');
    expect(BUSINESSES.map((b) => b.slug)).toEqual([
      'grocers',
      'fresh-mart',
      'fit-food-bay',
      'kelvin-scale',
      'visakha-dairy',
      'laddu-gopal',
    ]);
  });
});
