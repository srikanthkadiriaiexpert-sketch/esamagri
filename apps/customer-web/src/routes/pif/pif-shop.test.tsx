import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PifHomePage } from './PifHomePage';
import { PifCategoryPage } from './PifCategoryPage';
import { PifSearchPage } from './PifSearchPage';
import { PifProductDetailPage } from './PifProductDetailPage';
import { PifCartPage } from './PifCartPage';
import { PifCheckoutPage } from './PifCheckoutPage';
import { PifOrdersPage } from './PifOrdersPage';
import { PifOrderDetailPage } from './PifOrderDetailPage';
import { PifCartProvider } from '../../lib/cart/PifCartContext';
import { AppLayout } from '../AppLayout';

/*
 * The shell's drawer needs the auth context, which these tests have no reason
 * to build: what is under test is the layout's own decision about the sticky
 * cart bar. The drawer is stubbed so AppLayout's real logic runs.
 */
vi.mock('../../design-system/AppDrawer', () => ({ AppDrawer: () => null }));
import { ToastProvider } from '../../design-system/ToastProvider';
import { ApiError } from '../../lib/api/client';
import type { PifProduct } from '../../lib/api/types';
import type { PifOrderDocument, PifOrderListItem, QuoteResult } from '../../lib/api/pif-api';

/**
 * The PIF shop, as a customer uses it (PHASE F).
 *
 * WHAT THESE TESTS ARE FOR. The whole journey works against the real API
 * shapes: browse, open a product, add it, see the FACILITY'S total, place a
 * cash-on-delivery order, and follow it.
 *
 * WHAT THEY ARE ALSO FOR — and this is the part worth protecting:
 *
 *   NO MONEY IS COMPUTED IN THE BROWSER. The cart's total is whatever the
 *   server's quote said, even when that disagrees with quantity × price;
 *   one test makes them disagree on purpose and asserts the server wins.
 *
 *   NOTHING IS CONFIRMED THAT WAS NOT RECORDED. The old checkout faked an
 *   order with a timer; the confirmation now shows the server's own order
 *   number, and a failed placement says so instead.
 *
 *   A DOUBLE TAP SENDS ONE KEY. Two presses carry the same idempotency key,
 *   which is what stops the facility receiving two orders.
 *
 *   THE CUSTOMER CANNOT STEER AN ORDER, and is shown no staff name.
 */

const api = vi.hoisted(() => ({
  fetchPifCategories: vi.fn(),
  fetchPifCategoryProducts: vi.fn(),
  searchPifProducts: vi.fn(),
  fetchPifProduct: vi.fn(),
  quoteCart: vi.fn(),
  placeOrder: vi.fn(),
  fetchMyPifOrders: vi.fn(),
  fetchMyPifOrder: vi.fn(),
}));

vi.mock('../../lib/api/pif-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/pif-api')>('../../lib/api/pif-api');
  // The display helpers and the product mapper run for real.
  return { ...actual, ...api };
});

const profile = vi.hoisted(() => ({ fetchMyProfile: vi.fn() }));
vi.mock('../../lib/api/customer-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/customer-api')>(
    '../../lib/api/customer-api'
  );
  return { ...actual, ...profile };
});

const announcements = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('../../lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/client')>('../../lib/api/client');
  return { ...actual, ...announcements };
});

const rice: PifProduct = {
  id: 'prod-rice',
  categoryId: 'cat-1',
  name: 'Sona Masoori rice',
  unitLabel: '1 kg',
  inStock: true,
  price: { amountMinor: 10000, currency: 'INR' },
  sku: 'RICE-1KG',
  brand: 'Local Mills',
  description: 'Everyday rice.',
  categoryName: 'Staples',
  packLabel: '1 kg',
  taxRateName: 'GST 5%',
  taxRatePct: 5,
  discountPct: null,
  minOrderQty: 1,
  maxOrderQty: 10,
  qtyStep: 1,
  variantLabel: '1 kg',
};

const tomato: PifProduct = {
  ...rice,
  id: 'prod-tomato',
  name: 'Tomato',
  sku: 'TOMATO-KG',
  unitLabel: 'kg',
  inStock: false,
  price: { amountMinor: 4000, currency: 'INR' },
  taxRatePct: 0,
  taxRateName: null,
  variantLabel: null,
};

const quote = (overrides: Partial<QuoteResult> = {}): QuoteResult => ({
  lines: [
    {
      productId: 'prod-rice',
      name: 'Sona Masoori rice',
      brand: 'Local Mills',
      unit: 'kg',
      qty: 2,
      unitPrice: 100,
      taxRateName: 'GST 5%',
      taxRatePct: 5,
      discountPct: 0,
      lineSubtotal: 200,
      lineDiscount: 0,
      lineTax: 10,
      lineTotal: 210,
    },
  ],
  refused: [],
  subtotal: 200,
  discountTotal: 0,
  taxTotal: 10,
  /*
   * THE DELIVERY FIGURES, as the server now sends them. They are not padding:
   * this basket's merchandise total is 210, which is below the 499 threshold,
   * so the approved rule charges 20 and the order total is 230. A fixture
   * carrying 210 as the TOTAL described an order the rule cannot produce, and
   * the screens — reading fields that were simply absent — crashed inside
   * rupees() on `undefined.toFixed`.
   */
  merchandiseTotal: 210,
  deliveryTotal: 20,
  freeDelivery: false,
  deliveryFee: 20,
  deliveryThreshold: 499,
  amountToFreeDelivery: 289,
  total: 230,
  paymentMethod: 'COD',
  ...overrides,
});

/** The same basket, lifted over the threshold so delivery is free. */
const freeDeliveryQuote = () =>
  quote({
    lines: [{ ...quote().lines[0]!, qty: 5, lineSubtotal: 500, lineTax: 25, lineTotal: 525 }],
    subtotal: 500,
    taxTotal: 25,
    merchandiseTotal: 525,
    deliveryTotal: 0,
    freeDelivery: true,
    amountToFreeDelivery: 0,
    total: 525,
  });

const orderListItem = (overrides: Partial<PifOrderListItem> = {}): PifOrderListItem => ({
  id: 'order-1',
  orderNumber: 'PIF-20261009-0001',
  status: 'PREPARING',
  fulfillmentMode: 'DELIVERY',
  itemCount: 1,
  /** Charged, because 210 of merchandise is below the threshold. */
  deliveryTotal: 20,
  total: 230,
  paymentMethod: 'COD',
  placedAt: '2026-10-09T09:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
  ...overrides,
});

const orderDocument = (overrides: Partial<PifOrderDocument> = {}): PifOrderDocument => ({
  id: 'order-1',
  orderNumber: 'PIF-20261009-0001',
  status: 'PREPARING',
  fulfillmentMode: 'DELIVERY',
  paymentMethod: 'COD',
  deliveryAddress: 'Home, F-401, Near the water tank',
  contactName: 'R Nair',
  contactMobile: '9810000001',
  customerNote: null,
  subtotal: 200,
  discountTotal: 0,
  taxTotal: 10,
  deliveryTotal: 20,
  total: 230,
  placedAt: '2026-10-09T09:00:00.000Z',
  acceptedAt: '2026-10-09T09:30:00.000Z',
  readyAt: null,
  outForDeliveryAt: null,
  deliveredAt: null,
  codCollectedAt: null,
  cancelledAt: null,
  notDeliveredAt: null,
  items: [
    {
      productId: 'prod-rice',
      sku: 'RICE-1KG',
      name: 'Sona Masoori rice',
      brand: 'Local Mills',
      unit: 'kg',
      packSize: 1,
      imageUrl: null,
      qty: 2,
      unitPrice: 100,
      taxRatePct: 5,
      lineTotal: 210,
    },
  ],
  timeline: [
    { status: 'PLACED', at: '2026-10-09T09:00:00.000Z', reason: null },
    { status: 'ACCEPTED', at: '2026-10-09T09:30:00.000Z', reason: null },
    { status: 'PREPARING', at: '2026-10-09T09:45:00.000Z', reason: null },
  ],
  ...overrides,
});

/** The shop, mounted with its real cart provider so a basket survives a route change. */
function renderShop(initial: string) {
  return render(
    <ToastProvider>
      <PifCartProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/pif" element={<PifHomePage />} />
            <Route path="/pif/categories/:categoryId" element={<PifCategoryPage />} />
            <Route path="/pif/search" element={<PifSearchPage />} />
            <Route path="/pif/products/:productId" element={<PifProductDetailPage />} />
            <Route path="/pif/cart" element={<PifCartPage />} />
            <Route path="/pif/checkout" element={<PifCheckoutPage />} />
            <Route path="/pif/orders" element={<PifOrdersPage />} />
            <Route path="/pif/orders/:orderId" element={<PifOrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </PifCartProvider>
    </ToastProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  profile.fetchMyProfile.mockReset();
  announcements.apiRequest.mockReset();

  announcements.apiRequest.mockResolvedValue([]);
  api.fetchPifCategories.mockResolvedValue([
    {
      id: 'cat-1',
      name: 'Staples',
      description: null,
      imageUrl: undefined,
      productCount: 12,
      subcategories: [{ id: 'cat-2', name: 'Rice', imageUrl: undefined, productCount: 5 }],
    },
  ]);
  api.fetchPifCategoryProducts.mockResolvedValue({
    items: [rice, tomato],
    total: 2,
    page: 1,
    pageSize: 20,
  });
  api.fetchPifProduct.mockResolvedValue({ ...rice, variants: [] });
  api.quoteCart.mockResolvedValue(quote());
  api.placeOrder.mockResolvedValue({
    orderId: 'order-1',
    orderNumber: 'PIF-20261009-0001',
    status: 'PLACED',
    // Delivery included, which is what the officer pays in cash.
    total: 230,
    paymentMethod: 'COD',
    duplicate: false,
  });
  api.fetchMyPifOrders.mockResolvedValue({ items: [orderListItem()] });
  api.fetchMyPifOrder.mockResolvedValue(orderDocument());
  profile.fetchMyProfile.mockResolvedValue({
    customerId: 'cust-1',
    name: 'R Nair',
    mobileNumber: '9810000001',
    residence: { label: 'Home', quarterBlock: 'F', quarterNumber: '401', landmark: 'Near the water tank' },
  });
});

/**
 * The default fixture tree is "Staples" with the child "Rice" — which is,
 * exactly, two of the twelve categories the client rejected in writing. It
 * is kept as the default on purpose, so the guards below are exercised
 * against real rejected shapes rather than against invented ones.
 *
 * This is the same tree with approved names, for the tests that need the
 * listing and product paths to actually render something.
 */
const approvedTree = [
  {
    id: 'cat-1',
    name: 'Fresh Produce',
    description: null,
    imageUrl: undefined,
    productCount: 12,
    subcategories: [{ id: 'cat-2', name: 'Leafy Greens', imageUrl: undefined, productCount: 5 }],
  },
];

describe('browsing the PIF shop', () => {
  it('shows an approved category with its subcategories', async () => {
    api.fetchPifCategories.mockResolvedValue(approvedTree);
    renderShop('/pif');
    expect(await screen.findByText('Fresh Produce')).toBeInTheDocument();
    expect(screen.getByText('Leafy Greens')).toBeInTheDocument();
  });

  it('shows NEITHER a rejected category nor its rejected child', async () => {
    // The client rejected "Staples" and its child "Rice". The rows are still
    // in the database — this app does not delete those — so the listing is
    // what has to refuse them.
    renderShop('/pif');
    await screen.findByText(/shop by category/i);
    expect(screen.queryByText('Staples')).toBeNull();
    expect(screen.queryByText('Rice')).toBeNull();
  });

  it('lists a category’s products with the facility’s prices', async () => {
    api.fetchPifCategories.mockResolvedValue(approvedTree);
    renderShop('/pif/categories/cat-1');
    expect(await screen.findByText('Sona Masoori rice')).toBeInTheDocument();
    expect(screen.getByText('₹100.00')).toBeInTheDocument();
    expect(api.fetchPifCategoryProducts).toHaveBeenCalledWith('cat-1');
  });

  it('refuses a rejected category’s own route, and prints no product or price', async () => {
    // Typing the URL, a stale link and the back button all reach this screen
    // without passing a listing, so filtering tiles alone would have left
    // every rejected product one address away.
    renderShop('/pif/categories/cat-1');
    expect(await screen.findByText(/not part of the catalogue/i)).toBeInTheDocument();
    expect(screen.queryByText('Sona Masoori rice')).toBeNull();
    expect(screen.queryByText('₹100.00')).toBeNull();
  });

  it('refuses a rejected CHILD category’s route as well', async () => {
    renderShop('/pif/categories/cat-2');
    expect(await screen.findByText(/not part of the catalogue/i)).toBeInTheDocument();
    expect(screen.queryByText('Sona Masoori rice')).toBeNull();
  });

  it('shows no products at all when the category tree cannot be read', async () => {
    // Fail closed: with no tree there is no way to tell an approved category
    // from a rejected one, and guessing in the customer's favour is what
    // would put rejected products back on screen.
    api.fetchPifCategories.mockRejectedValue(new Error('offline'));
    renderShop('/pif/categories/cat-1');
    await screen.findByRole('heading', { name: /products/i });
    expect(screen.queryByText('Sona Masoori rice')).toBeNull();
    expect(screen.queryByText('₹100.00')).toBeNull();
  });

  it('marks an item the facility has switched off for the day', async () => {
    api.fetchPifCategories.mockResolvedValue(approvedTree);
    renderShop('/pif/categories/cat-1');
    await screen.findByText('Tomato');
    expect(screen.getByText(/out of stock/i)).toBeInTheDocument();
  });
});

/**
 * Search is the third way into the catalogue, after the listings and the
 * category route. `/pif/search` runs on the server and knows nothing about
 * which categories the client approved, so the app filters what comes back.
 */
describe('search does not reopen a rejected category', () => {
  const type = async (text: string) => {
    const user = userEvent.setup();
    // type="search" exposes the searchbox role, not textbox.
    await user.type(screen.getByRole('searchbox'), text);
  };

  it('hides a product whose category the client rejected', async () => {
    // `rice.categoryName` is 'Staples'.
    api.searchPifProducts.mockResolvedValue({ items: [rice], total: 1, page: 1, pageSize: 20 });
    renderShop('/pif/search');
    await type('rice');

    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
    expect(screen.queryByText('Sona Masoori rice')).toBeNull();
    expect(screen.queryByText('₹100.00')).toBeNull();
  });

  it('still returns a product in an approved category', async () => {
    api.fetchPifCategories.mockResolvedValue(approvedTree);
    api.searchPifProducts.mockResolvedValue({
      items: [{ ...rice, categoryName: 'Leafy Greens' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderShop('/pif/search');
    await type('rice');

    expect(await screen.findByText('Sona Masoori rice')).toBeInTheDocument();
  });

  it('returns nothing when the category tree cannot be read', async () => {
    api.fetchPifCategories.mockRejectedValue(new Error('offline'));
    api.searchPifProducts.mockResolvedValue({ items: [rice], total: 1, page: 1, pageSize: 20 });
    renderShop('/pif/search');
    await type('rice');

    await waitFor(() => expect(screen.queryByText('Sona Masoori rice')).toBeNull());
  });

  it('shows a product with its brand, pack, GST note and order limits', async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });

    expect(screen.getByText('Local Mills')).toBeInTheDocument();
    expect(screen.getByText(/GST 5% at 5% is added at checkout/i)).toBeInTheDocument();
    expect(screen.getByText(/Between 1 and 10 1 kg per order/i)).toBeInTheDocument();
    expect(screen.getByText(/Item code RICE-1KG/)).toBeInTheDocument();
  });

  it('shows a placeholder instead of a broken picture', async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    expect(screen.getByText('No picture')).toBeInTheDocument();
  });

  it('falls back to the placeholder when a stored picture will not load', async () => {
    api.fetchPifProduct.mockResolvedValue({
      ...rice,
      imageUrl: 'http://localhost:3000/pif/media/pif/products/gone.png',
      variants: [],
    });
    renderShop('/pif/products/prod-rice');
    const image = await screen.findByAltText('Sona Masoori rice');

    fireEvent.error(image);

    expect(screen.queryByAltText('Sona Masoori rice')).not.toBeInTheDocument();
    expect(screen.getByText('No picture')).toBeInTheDocument();
  });

  it('a withdrawn product reads as not in the catalogue, not as an error', async () => {
    api.fetchPifProduct.mockRejectedValue(
      new ApiError(404, { code: 'NOT_FOUND', message: 'That product is not in the catalogue.' })
    );
    renderShop('/pif/products/prod-gone');
    expect(await screen.findByText(/not in the catalogue/i)).toBeInTheDocument();
  });

  it('will not let an out-of-stock product be added', async () => {
    api.fetchPifProduct.mockResolvedValue({ ...tomato, variants: [] });
    renderShop('/pif/products/prod-tomato');
    await screen.findByRole('article', { name: 'Tomato' });
    expect(screen.getByRole('button', { name: /out of stock today/i })).toBeDisabled();
  });
});

describe('the cart’s figures are the server’s', () => {
  it('asks the server to price the cart and shows exactly what it answered', async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(await screen.findByText('Your cart')).toBeInTheDocument();
    // The mode is part of the request now, because the charge depends on it.
    expect(api.quoteCart).toHaveBeenCalledWith([{ productId: 'prod-rice', qty: 1 }], 'DELIVERY');
    const summary = (await screen.findByText(/calculated by the facility/i))
      .parentElement as HTMLElement;
    expect(within(summary).getByText('₹230.00')).toBeInTheDocument(); // total
    expect(within(summary).getByText('₹10.00')).toBeInTheDocument(); // GST
    expect(within(summary).getByText('₹200.00')).toBeInTheDocument(); // subtotal
    expect(within(summary).getByText('₹20.00')).toBeInTheDocument(); // delivery
    // ...and the gap to free delivery, in the server's figure, not the page's.
    expect(within(summary).getByText(/Add ₹289\.00 more to unlock FREE delivery/i)).toBeInTheDocument();
  });

  it('shows the SERVER’S total even when it disagrees with quantity × price', async () => {
    // Deliberately inconsistent: a stale catalogue price in the browser must
    // never be the figure a shopper is shown.
    api.quoteCart.mockResolvedValue(
      quote({
        lines: [{ ...quote().lines[0]!, lineSubtotal: 180, lineTax: 9, lineTotal: 189 }],
        subtotal: 180,
        taxTotal: 9,
        merchandiseTotal: 189,
        deliveryTotal: 20,
        amountToFreeDelivery: 310,
        total: 209,
      })
    );
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect((await screen.findAllByText('₹189.00')).length).toBeGreaterThan(0);
    // The server's own order total, delivery and all.
    expect(await screen.findByText('₹209.00')).toBeInTheDocument();
    expect(screen.queryByText('₹210.00')).not.toBeInTheDocument();
    expect(screen.queryByText('₹230.00')).not.toBeInTheDocument();
  });

  it('reports what the facility will not sell today, and blocks checkout until it is removed', async () => {
    api.quoteCart.mockResolvedValue(
      quote({
        lines: [],
        refused: [
          { productId: 'prod-rice', reason: 'PRODUCT_UNAVAILABLE', message: '"Rice" is out of stock today.' },
        ],
        subtotal: 0,
        taxTotal: 0,
        // Nothing to deliver, so nothing to charge for delivering it.
        merchandiseTotal: 0,
        deliveryTotal: 0,
        freeDelivery: true,
        amountToFreeDelivery: 0,
        total: 0,
      })
    );
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(await screen.findByText(/some items cannot be ordered/i)).toBeInTheDocument();
    expect(screen.getByText(/is out of stock today/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeDisabled();
  });

  it('says so plainly when prices could not be read, and does not invent a total', async () => {
    api.quoteCart.mockRejectedValue(new Error('offline'));
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(await screen.findByText(/prices could not be checked/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /proceed to checkout/i })).toBeDisabled();
  });
});

describe('checkout — cash on delivery, and a real order', () => {
  const addToCartAndGoToCheckout = async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    await screen.findByText('Your cart');
    await userEvent.click(await screen.findByRole('button', { name: /proceed to checkout/i }));
    await screen.findByText('Checkout');
  };

  it('shows the officer’s own residence as the destination, with no address field to type in', async () => {
    await addToCartAndGoToCheckout();
    expect(await screen.findByText('Home, F-401, Near the water tank')).toBeInTheDocument();
    // The old screen had a free-text address box; a typed address could not
    // be verified as the officer's own.
    expect(screen.queryByLabelText(/delivery address/i)).not.toBeInTheDocument();
  });

  it('offers cash on delivery and nothing resembling a payment', async () => {
    await addToCartAndGoToCheckout();
    expect(await screen.findByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.getByText(/no payment is taken in the app/i)).toBeInTheDocument();
    for (const forbidden of [/pay now/i, /card/i, /upi/i, /netbanking/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('places the order and shows the server’s own order number', async () => {
    await addToCartAndGoToCheckout();
    await userEvent.click(await screen.findByRole('button', { name: /place order \(cash on delivery\)/i }));

    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    const sent = api.placeOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.lines).toEqual([{ productId: 'prod-rice', qty: 1 }]);
    expect(sent.fulfillmentMode).toBe('DELIVERY');
    expect(sent.deliveryAddressId).toBeNull();
    expect(String(sent.idempotencyKey)).toMatch(/^pif-/);
    // No price, total or product name is sent — the server prices the order.
    expect(sent).not.toHaveProperty('total');
    expect(sent).not.toHaveProperty('subtotal');

    expect(await screen.findByText('PIF-20261009-0001')).toBeInTheDocument();
    expect(screen.getByText(/your order number/i)).toBeInTheDocument();
    expect(screen.getAllByText(/in cash when/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /see my orders/i })).toBeInTheDocument();
  });

  it('sends the SAME key when the button is pressed twice', async () => {
    let release: ((value: unknown) => void) | null = null;
    api.placeOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await addToCartAndGoToCheckout();
    const button = await screen.findByRole('button', { name: /place order \(cash on delivery\)/i });

    await userEvent.click(button);
    await userEvent.click(button);
    release?.({
      orderId: 'order-1',
      orderNumber: 'PIF-20261009-0001',
      status: 'PLACED',
      total: 210,
      paymentMethod: 'COD',
      duplicate: false,
    });

    const keys = api.placeOrder.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('says the order was NOT placed when the server refuses, and confirms nothing', async () => {
    api.placeOrder.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: '"Tomato" is out of stock today.',
        details: { reason: 'PRODUCT_UNAVAILABLE' },
      })
    );
    await addToCartAndGoToCheckout();
    await userEvent.click(await screen.findByRole('button', { name: /place order \(cash on delivery\)/i }));

    expect(await screen.findByText(/the order was not placed/i)).toBeInTheDocument();
    expect(screen.getByText(/is out of stock today/i)).toBeInTheDocument();
    expect(screen.queryByText(/order placed/i)).not.toBeInTheDocument();
  });

  it('lets an officer with no recorded residence collect it themselves instead', async () => {
    profile.fetchMyProfile.mockResolvedValue({
      customerId: 'cust-1',
      name: 'R Nair',
      mobileNumber: '9810000001',
      residence: null,
    });
    await addToCartAndGoToCheckout();

    expect(await screen.findByText(/no residence recorded yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order \(cash on delivery\)/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('tab', { name: /collect myself/i }));
    expect(screen.getByRole('button', { name: /place order \(cash on delivery\)/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /place order \(cash on delivery\)/i }));
    expect((api.placeOrder.mock.calls[0]![0] as { fulfillmentMode: string }).fulfillmentMode).toBe('PICKUP');
  });
});

describe('following an order', () => {
  it('lists the officer’s own orders with the facility’s words for the state', async () => {
    renderShop('/pif/orders');
    expect(await screen.findByText('PIF-20261009-0001')).toBeInTheDocument();
    expect(screen.getByText('Being prepared')).toBeInTheDocument();
    expect(screen.getByText('₹230.00')).toBeInTheDocument();
    expect(screen.getByText(/cash on delivery/i)).toBeInTheDocument();
  });

  it('shows the timeline the facility actually recorded', async () => {
    renderShop('/pif/orders/order-1');
    const article = await screen.findByRole('article', { name: /Order PIF-20261009-0001/i });
    const text = article.textContent ?? '';
    expect(text).toContain('Order placed');
    expect(text).toContain('Order confirmed');
    expect(text).toContain('Being prepared');
    expect(text).not.toContain('Delivered ·');
  });

  it('shows the frozen prices and what to have ready in cash', async () => {
    renderShop('/pif/orders/order-1');
    const article = await screen.findByRole('article', { name: /Order PIF-20261009-0001/i });
    expect(within(article).getByText(/2 kg × ₹100.00 · GST 5%/)).toBeInTheDocument();
    expect(within(article).getByText('To pay in cash')).toBeInTheDocument();
    // The delivery charge as it was applied, and the cash figure that
    // includes it. A past order keeps the figure it was placed with.
    expect(within(article).getByText('Home delivery')).toBeInTheDocument();
    expect(within(article).getByText('₹20.00')).toBeInTheDocument();
    expect(within(article).getByText('₹230.00')).toBeInTheDocument();
    expect(within(article).getByText(/prices charged when you placed the order/i)).toBeInTheDocument();
  });

  it('shows a cancelled order as a terminal state with its reason, not a progress bar', async () => {
    api.fetchMyPifOrder.mockResolvedValue(
      orderDocument({
        status: 'CANCELLED',
        cancelledAt: '2026-10-09T11:00:00.000Z',
        timeline: [
          { status: 'PLACED', at: '2026-10-09T09:00:00.000Z', reason: null },
          { status: 'CANCELLED', at: '2026-10-09T11:00:00.000Z', reason: 'Customer called to cancel' },
        ],
      })
    );
    renderShop('/pif/orders/order-1');
    const article = await screen.findByRole('article', { name: /Order PIF-20261009-0001/i });
    // Twice, deliberately: the terminal banner and the state line beneath it.
    expect(within(article).getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(within(article).getByText(/customer called to cancel/i)).toBeInTheDocument();
  });

  it('is READ ONLY: no cancel, no status control, and no staff identity', async () => {
    renderShop('/pif/orders/order-1');
    const article = await screen.findByRole('article', { name: /Order PIF-20261009-0001/i });

    expect(article.querySelector('form')).toBeNull();
    expect(article.querySelector('input')).toBeNull();
    for (const forbidden of [/cancel/i, /mark /i, /deliver/i, /collect order/i, /edit/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
    const text = article.textContent ?? '';
    expect(text).not.toMatch(/PIF_CASHIER|PIF_ADMIN|DELIVERY_STAFF/);
    expect(text).not.toMatch(/recorded by/i);
  });

  it('another officer’s order reads as not found', async () => {
    api.fetchMyPifOrder.mockRejectedValue(
      new ApiError(404, { code: 'NOT_FOUND', message: 'That order does not exist.' })
    );
    renderShop('/pif/orders/order-other');
    expect(await screen.findByText(/order not found/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist, or it is not yours/i)).toBeInTheDocument();
  });
});


// =====================================================================
/**
 * THE STICKY VIEW CART BAR — the defect this suite now guards.
 *
 * Reported from the running demo: after adding a product, nothing appeared
 * that would take the shopper to their basket. It was not a broken component;
 * there was no component. The only affordance was a small badge in the top
 * header, which on a phone is off-screen the moment the list is scrolled.
 *
 * The bar lives in AppLayout rather than on each screen, so these tests mount
 * the shop THROUGH the layout — the way the real router does — because a bar
 * that works only on the screens somebody remembered is the same bug again.
 *
 * The money is the server's. `quoteCart` is the only source of a total here,
 * and one test below makes the quote disagree with quantity x price on
 * purpose to prove the bar reports the server and not its own arithmetic.
 */
function renderShopWithLayout(initial: string) {
  return render(
    <ToastProvider>
      <PifCartProvider>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/pif" element={<PifHomePage />} />
              <Route path="/pif/categories/:categoryId" element={<PifCategoryPage />} />
              <Route path="/pif/cart" element={<PifCartPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </PifCartProvider>
    </ToastProvider>
  );
}

describe('PIF sticky View Cart bar', () => {
  const bar = () => screen.queryByRole('button', { name: /view cart/i });

  beforeEach(() => {
    api.fetchPifCategoryProducts.mockResolvedValue({ items: [rice], total: 1, page: 1, pageSize: 20 });
    api.fetchPifCategories.mockResolvedValue([]);
    api.quoteCart.mockResolvedValue(quote());
  });

  it('stays hidden while the basket is empty', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    expect(bar()).not.toBeInTheDocument();
  });

  it('APPEARS as soon as the first item is added, with the count and the server total', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);

    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    expect(shown).toBeInTheDocument();
    expect(within(shown).getByText(/1 item/)).toBeInTheDocument();
    await within(shown).findByText(/₹/);
  });

  it('reports the SERVER total, not quantity x price', async () => {
    // The quote deliberately disagrees with the line prices. `merchandiseTotal`
    // is the figure the bar shows — the goods — so that is the one overridden;
    // the delivery charge is itemised on the cart screen, not in the bar.
    api.quoteCart.mockResolvedValue(
      quote({
        merchandiseTotal: 999.5,
        deliveryTotal: 0,
        freeDelivery: true,
        amountToFreeDelivery: 0,
        total: 999.5,
      })
    );
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    expect(await within(shown).findByText(/₹999\.50/)).toBeInTheDocument();
  });

  it('counts QUANTITY, not lines — a second of the same item reads "2 items"', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);

    // Once added, the card swaps ADD for a stepper, so a second one is taken
    // the way a shopper actually takes it.
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);
    await screen.findByRole('button', { name: /view cart/i });
    await userEvent.click(screen.getAllByRole('button', { name: /increase/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    expect(within(shown).getByText(/2 items/)).toBeInTheDocument();
    expect(within(shown).queryByText(/1 item\b/)).not.toBeInTheDocument();
  });

  it('follows an increment and a decrement', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);
    await screen.findByRole('button', { name: /view cart/i });

    await userEvent.click(screen.getAllByRole('button', { name: /increase/i })[0]!);
    expect(within(await screen.findByRole('button', { name: /view cart/i })).getByText(/2 items/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /decrease/i })[0]!);
    expect(within(await screen.findByRole('button', { name: /view cart/i })).getByText(/1 item/)).toBeInTheDocument();
  });

  it('DISAPPEARS when the last item is removed', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);
    await screen.findByRole('button', { name: /view cart/i });

    await userEvent.click(screen.getAllByRole('button', { name: /decrease/i })[0]!);
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('survives a change of screen — the basket is not tied to one route', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    await userEvent.click(shown);

    // It opens the real cart, and stands down there — the cart screen has its
    // own total and its own primary action, so a second one would be noise.
    expect(await screen.findByText(/your cart/i)).toBeInTheDocument();
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it('keeps the basket when a quote fails, and does not invent a total', async () => {
    api.quoteCart.mockRejectedValue(new Error('network'));
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    // The count is the client's own fact and is still shown; no money is
    // guessed, so no rupee figure appears.
    expect(within(shown).getByText(/1 item/)).toBeInTheDocument();
    expect(within(shown).queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('asks the server ONCE for a burst of taps', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    api.quoteCart.mockClear();

    const add = screen.getAllByRole('button', { name: /^add$/i })[0]!;
    await userEvent.click(add);
    await userEvent.click(screen.getAllByRole('button', { name: /increase/i })[0]!);
    await userEvent.click(screen.getAllByRole('button', { name: /increase/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    expect(within(shown).getByText(/3 items/)).toBeInTheDocument();
    // Debounced: a shopper still filling a basket does not generate one
    // request per tap.
    await waitFor(() => expect(api.quoteCart.mock.calls.length).toBeLessThanOrEqual(2));
  });
});


// =====================================================================
/**
 * THE DELIVERY CHARGE — the approved rule, as a customer meets it.
 *
 * WHAT THESE TESTS ARE FOR. The rule itself (₹20 below ₹499 of merchandise,
 * free at or above it, free for pickup, once per order) is the server's, and
 * it is tested where it lives, in pif-pricing.spec.ts. What is tested HERE is
 * the only thing the browser is allowed to do with it: show it.
 *
 * So every figure below arrives in a quote and is asserted as it was sent.
 * Nothing here recomputes a charge, compares a basket against 499, or knows
 * that the fee is 20 — one test deliberately changes the fee and the
 * threshold to prove the screens read them from the quote rather than from a
 * constant somebody typed into the page.
 */
describe('the delivery charge, as the shopper sees it', () => {
  const openCart = async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    await screen.findByText('Your cart');
    return (await screen.findByText(/calculated by the facility/i)).parentElement as HTMLElement;
  };

  it('itemises the charge the server applied, and includes it in the total', async () => {
    const summary = await openCart();

    // Goods, tax, charge, total — each one the server's own figure.
    expect(within(summary).getByText('₹200.00')).toBeInTheDocument(); // subtotal
    expect(within(summary).getByText('₹10.00')).toBeInTheDocument(); // GST
    expect(within(summary).getByText('Home delivery')).toBeInTheDocument();
    expect(within(summary).getByText('₹20.00')).toBeInTheDocument(); // the charge
    expect(within(summary).getByText('₹230.00')).toBeInTheDocument(); // 210 + 20
    // The charge is never presented as free when it was charged.
    expect(within(summary).queryByText('FREE')).not.toBeInTheDocument();
  });

  it('tells the shopper the gap to free delivery in the server’s figure', async () => {
    const summary = await openCart();
    expect(
      within(summary).getByText(/Add ₹289\.00 more to unlock FREE delivery/i)
    ).toBeInTheDocument();
  });

  it('says FREE — not ₹0.00 — once the server says the basket qualifies', async () => {
    api.quoteCart.mockResolvedValue(freeDeliveryQuote());
    const summary = await openCart();

    expect(within(summary).getByText('FREE')).toBeInTheDocument();
    expect(
      within(summary).getByText(/Your order qualifies for FREE home delivery/i)
    ).toBeInTheDocument();
    expect(within(summary).getByText('₹525.00')).toBeInTheDocument(); // merchandise only
    // No charge line, and no leftover gap message.
    expect(within(summary).queryByText('₹20.00')).not.toBeInTheDocument();
    expect(within(summary).queryByText('₹0.00')).not.toBeInTheDocument();
    expect(within(summary).queryByText(/more to unlock/i)).not.toBeInTheDocument();
  });

  it('reads the FEE and the THRESHOLD from the quote, never from the page', async () => {
    // A policy the facility has changed. If either number were hard-coded in
    // the component, this test would still read ₹20 and ₹499.
    api.quoteCart.mockResolvedValue(
      quote({
        deliveryFee: 35,
        deliveryThreshold: 999,
        deliveryTotal: 35,
        amountToFreeDelivery: 789,
        total: 245,
      })
    );
    const summary = await openCart();

    expect(
      within(summary).getByText(
        /Home delivery is free on orders of ₹999\.00 or more, and ₹35\.00 below that/i
      )
    ).toBeInTheDocument();
    expect(within(summary).getByText(/Add ₹789\.00 more to unlock FREE delivery/i)).toBeInTheDocument();
    expect(within(summary).getByText('₹245.00')).toBeInTheDocument();
    expect(within(summary).queryByText('₹499.00')).not.toBeInTheDocument();
    expect(within(summary).queryByText('₹20.00')).not.toBeInTheDocument();
  });

  it('congratulates the shopper when the basket CROSSES the threshold', async () => {
    await openCart();
    // Nothing yet: the basket arrived below the threshold.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // The next quote is the one that qualifies, and the stepper is what asks
    // for it — exactly the moment the rule is meant to be announced.
    api.quoteCart.mockResolvedValue(freeDeliveryQuote());
    await userEvent.click(screen.getAllByRole('button', { name: /increase quantity/i })[0]!);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Congratulations!')).toBeInTheDocument();
    expect(within(dialog).getByText(/eligible for FREE HOME DELIVERY/i)).toBeInTheDocument();

    // And it carries no decision: dismissing it changes nothing.
    await userEvent.click(within(dialog).getByRole('button', { name: /continue shopping/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('does NOT congratulate a basket that already qualified when the cart opened', async () => {
    api.quoteCart.mockResolvedValue(freeDeliveryQuote());
    const summary = await openCart();

    expect(within(summary).getByText('FREE')).toBeInTheDocument();
    // Congratulating someone for something they did not just do.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not congratulate again on a re-quote that is still free', async () => {
    api.quoteCart.mockResolvedValue(freeDeliveryQuote());
    await openCart();
    await userEvent.click(screen.getAllByRole('button', { name: /increase quantity/i })[0]!);
    await waitFor(() => expect(api.quoteCart.mock.calls.length).toBeGreaterThan(1));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the delivery charge at checkout, and store pickup', () => {
  /** The same basket quoted for collection: nothing to deliver, nothing to charge. */
  const pickupQuote = () =>
    quote({ deliveryTotal: 0, freeDelivery: true, amountToFreeDelivery: 0, total: 210 });

  const goToCheckout = async () => {
    renderShop('/pif/products/prod-rice');
    await screen.findByRole('article', { name: 'Sona Masoori rice' });
    await userEvent.click(screen.getByRole('button', { name: /add to cart/i }));
    await screen.findByText('Your cart');
    await userEvent.click(await screen.findByRole('button', { name: /proceed to checkout/i }));
    await screen.findByText('Checkout');
    return (await screen.findByText('Order summary')).parentElement as HTMLElement;
  };

  it('shows the charge and makes clear the CASH figure includes it', async () => {
    const summary = await goToCheckout();

    expect(within(summary).getByText('Home delivery')).toBeInTheDocument();
    expect(within(summary).getByText('₹20.00')).toBeInTheDocument();
    expect(within(summary).getByText('Total to pay on delivery')).toBeInTheDocument();
    expect(within(summary).getByText('₹230.00')).toBeInTheDocument();
    expect(
      within(summary).getByText(/includes delivery and is what you pay in cash/i)
    ).toBeInTheDocument();
  });

  it('RE-PRICES when the shopper chooses to collect, and pickup is free', async () => {
    // The mode decides the charge, so the mock answers by mode rather than
    // returning one fixed quote.
    api.quoteCart.mockImplementation(async (_lines: unknown, mode: string) =>
      mode === 'PICKUP' ? pickupQuote() : quote()
    );
    const summary = await goToCheckout();
    expect(within(summary).getByText('₹230.00')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /collect myself/i }));

    // Asked again, for the mode actually selected.
    await waitFor(() =>
      expect(api.quoteCart.mock.calls.some((call) => call[1] === 'PICKUP')).toBe(true)
    );
    // Labelled as a collection, free, and the cash figure drops to the goods.
    expect(await within(summary).findByText('Store pickup')).toBeInTheDocument();
    expect(within(summary).getByText('FREE')).toBeInTheDocument();
    // Asserted on the total ROW, because 210 is also this basket's one line
    // total — what matters is the figure sitting against the cash label.
    const collectionTotal = within(summary).getByText('Total to pay at collection')
      .parentElement as HTMLElement;
    expect(within(collectionTotal).getByText('₹210.00')).toBeInTheDocument();
    expect(within(summary).getByText(/Store pickup is always free/i)).toBeInTheDocument();
    expect(within(summary).queryByText('₹230.00')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Home delivery')).not.toBeInTheDocument();
    // Pickup is not a delivery the shopper won, so nothing is announced.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sends the chosen mode and NO money when the order is placed', async () => {
    await goToCheckout();
    await userEvent.click(
      await screen.findByRole('button', { name: /place order \(cash on delivery\)/i })
    );

    const sent = api.placeOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.fulfillmentMode).toBe('DELIVERY');
    // The client contributes the mode and the lines. The charge, like every
    // other figure, is the server's to decide.
    expect(sent).not.toHaveProperty('deliveryTotal');
    expect(sent).not.toHaveProperty('deliveryFee');
    expect(sent).not.toHaveProperty('total');
  });
});

describe('the sticky bar shows the GOODS, not the delivery charge', () => {
  beforeEach(() => {
    api.fetchPifCategoryProducts.mockResolvedValue({ items: [rice], total: 1, page: 1, pageSize: 20 });
    api.fetchPifCategories.mockResolvedValue([]);
    api.quoteCart.mockResolvedValue(quote());
  });

  it('reports the merchandise total, because the charge is explained on the cart screen', async () => {
    renderShopWithLayout('/pif/categories/cat-1');
    await screen.findByText(rice.name);
    await userEvent.click(screen.getAllByRole('button', { name: /^add$/i })[0]!);

    const shown = await screen.findByRole('button', { name: /view cart/i });
    // 210 — the goods. Not 230, which would announce a charge in a bar with
    // no room to say what it is for.
    expect(await within(shown).findByText(/₹210\.00/)).toBeInTheDocument();
    expect(within(shown).queryByText(/₹230\.00/)).not.toBeInTheDocument();
    expect(within(shown).queryByText(/₹20\.00/)).not.toBeInTheDocument();
    // It still quotes for home delivery, so the cart screen has the charge
    // ready the moment the shopper taps through.
    await waitFor(() => expect(api.quoteCart.mock.calls[0]![1]).toBe('DELIVERY'));
  });
});
