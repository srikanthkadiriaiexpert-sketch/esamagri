import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SeasonalBanner } from '../lib/api/rik-banners-api';
import type { PifCategoryNode } from '../lib/api/pif-api';
import type { PifProduct } from '../lib/api/types';

/**
 * The two additions to the customer home screen: the seasonal banner strip
 * and the "Popular in PIF" row.
 *
 * THE RULE BOTH OF THEM EXIST UNDER, and the reason several of these tests
 * are about rendering NOTHING: neither may ever disturb the permanent hero.
 * They sit below it, and for every state that is not "there is something to
 * show" they must render nothing at all — no spinner, no error, no empty
 * box. A customer with no banner scheduled and a slow catalogue has to see
 * exactly today's home screen.
 *
 * THE SHOWCASE PICTURE HAS TWO SOURCES, and that is what most of the second
 * half asserts. A product's own photograph always wins. A product without
 * one borrows the uploaded picture of the category it sits in, matched by
 * `categoryId`. A product with neither is dropped, because a grey tile with
 * a name under it is worse than one fewer card.
 */

const bannersApi = { fetchSeasonalBanners: vi.fn() };
const pifApi = { fetchShowcaseProducts: vi.fn(), fetchPifCategories: vi.fn() };

vi.mock('../lib/api/rik-banners-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/rik-banners-api')>();
  return { ...actual, fetchSeasonalBanners: (...a: unknown[]) => bannersApi.fetchSeasonalBanners(...a) };
});

vi.mock('../lib/api/pif-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/pif-api')>();
  return {
    ...actual,
    fetchShowcaseProducts: (...a: unknown[]) => pifApi.fetchShowcaseProducts(...a),
    fetchPifCategories: (...a: unknown[]) => pifApi.fetchPifCategories(...a),
  };
});

const { SeasonalBanners } = await import('./SeasonalBanners');
const { ProductShowcase } = await import('./ProductShowcase');

const seasonal = (over: Partial<SeasonalBanner> = {}): SeasonalBanner => ({
  id: 'dddddddd-4444-4444-8444-dddddddddddd',
  title: 'Diwali offers',
  description: null,
  imageUrl: '/rik/media/rik/banners/diwali.jpg',
  startsOn: null,
  endsOn: null,
  ...over,
});

/** A product that sits directly under the "Atta" subcategory. */
const product = (over: Partial<PifProduct> = {}): PifProduct =>
  ({
    id: 'prod-aashirvaad',
    categoryId: 'sub-atta',
    name: 'Aashirvaad Atta 5 kg',
    unitLabel: '5 kg',
    imageUrl: undefined,
    inStock: true,
    price: { amountMinor: 27500, currency: 'INR' },
    ...over,
  }) as PifProduct;

/** The uploaded category artwork: a main category with one illustrated child. */
const categories = (): PifCategoryNode[] => [
  {
    id: 'cat-rice',
    name: 'Rice, Atta & Flour',
    description: null,
    imageUrl: '/pif/media/categories/rice.jpg',
    productCount: 12,
    subcategories: [
      { id: 'sub-atta', name: 'Atta', imageUrl: '/pif/media/categories/atta.jpg', productCount: 4 },
    ],
  } as PifCategoryNode,
];

/**
 * jsdom has no matchMedia, which the component treats as "assume reduced
 * motion" — showing no motion to somebody who wanted it is a far smaller
 * failure than the reverse. These helpers make the choice explicit per test
 * rather than leaving it to the environment.
 */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: reduce,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  );
}

const renderShowcase = () =>
  render(
    <MemoryRouter>
      <ProductShowcase />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  bannersApi.fetchSeasonalBanners.mockResolvedValue([]);
  pifApi.fetchShowcaseProducts.mockResolvedValue([]);
  pifApi.fetchPifCategories.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Customer home — seasonal banners', () => {
  it('renders nothing at all when no banner is scheduled', async () => {
    const { container } = render(<SeasonalBanners />);
    await waitFor(() => expect(bannersApi.fetchSeasonalBanners).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent when the request fails, rather than putting a fault under the hero', async () => {
    bannersApi.fetchSeasonalBanners.mockRejectedValue(new Error('network'));
    const { container } = render(<SeasonalBanners />);

    await waitFor(() => expect(bannersApi.fetchSeasonalBanners).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/could|error|went wrong|try again/i)).not.toBeInTheDocument();
  });

  it('shows a live banner, using its title as the alt text', async () => {
    bannersApi.fetchSeasonalBanners.mockResolvedValue([
      seasonal({ description: 'Sweets and dry fruits, all week' }),
    ]);
    render(<SeasonalBanners />);

    const image = await screen.findByAltText('Diwali offers');
    expect(image).toHaveAttribute('src', '/rik/media/rik/banners/diwali.jpg');
    // Below the hero, so it must not compete with it for the first paint.
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('Sweets and dry fruits, all week')).toBeInTheDocument();
  });
});

describe('Customer home — Popular in PIF', () => {
  it('renders nothing when the catalogue returns nothing', async () => {
    const { container } = renderShowcase();
    await waitFor(() => expect(pifApi.fetchShowcaseProducts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the product name and the server price under the agreed heading', async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([product()]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    renderShowcase();

    expect(await screen.findByRole('heading', { name: 'Popular in PIF' })).toBeInTheDocument();
    expect(screen.getByText('Aashirvaad Atta 5 kg')).toBeInTheDocument();
    expect(screen.getByText('₹275.00')).toBeInTheDocument();
  });

  it("uses the product's own photograph when it has one", async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([product({ imageUrl: '/pif/media/products/atta-5kg.jpg' })]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(1));
    const card = container.querySelector('.showcase-item') as HTMLElement;
    // Its own picture wins; the category picture is a stand-in, never a
    // replacement for a photograph that exists.
    expect(card.querySelector('img')).toHaveAttribute('src', '/pif/media/products/atta-5kg.jpg');
  });

  it("falls back to its subcategory's uploaded picture rather than showing a grey box", async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([product()]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(1));
    const card = container.querySelector('.showcase-item') as HTMLElement;
    expect(card.querySelector('img')).toHaveAttribute('src', '/pif/media/categories/atta.jpg');
    // Name and price are still the product's own.
    expect(within(card).getByText('Aashirvaad Atta 5 kg')).toBeInTheDocument();
    expect(within(card).getByText('₹275.00')).toBeInTheDocument();
  });

  it('falls back to a main category picture when the product sits directly under one', async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([
      product({ id: 'prod-loose-rice', categoryId: 'cat-rice', name: 'Sona Masoori 10 kg' }),
    ]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(1));
    expect(container.querySelector('.showcase-item img')).toHaveAttribute(
      'src',
      '/pif/media/categories/rice.jpg'
    );
  });

  it('drops a product that has neither its own picture nor a category one', async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([
      product(),
      product({ id: 'prod-orphan', categoryId: 'cat-unknown', name: 'Mystery Item' }),
    ]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(1));
    expect(screen.queryByText('Mystery Item')).not.toBeInTheDocument();
  });

  it('runs no animation and renders no duplicate cards under reduced motion', async () => {
    stubReducedMotion(true);
    pifApi.fetchShowcaseProducts.mockResolvedValue([product(), product({ id: 'p2', name: 'Toor Dal 1 kg' })]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(2));
    expect(container.querySelector('.showcase-track--manual')).not.toBeNull();
  });

  it('duplicates the track for a seamless loop when motion is allowed', async () => {
    stubReducedMotion(false);
    pifApi.fetchShowcaseProducts.mockResolvedValue([product(), product({ id: 'p2', name: 'Toor Dal 1 kg' })]);
    pifApi.fetchPifCategories.mockResolvedValue(categories());
    const { container } = renderShowcase();

    await waitFor(() => expect(container.querySelectorAll('.showcase-item')).toHaveLength(4));
    // A screen reader must hear each product once, not twice.
    expect(container.querySelectorAll('.showcase-item[aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelector('.showcase-track--manual')).toBeNull();
  });
});
