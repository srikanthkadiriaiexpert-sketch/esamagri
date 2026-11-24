import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PifDashboardPage } from './PifDashboardPage';
import { PifCategoriesPage } from './PifCategoriesPage';
import { PifProductsPage } from './PifProductsPage';
import { PifOrdersPage } from './PifOrdersPage';
import type { StaffSession } from '../../lib/api/admin-api';
import { pifAdmin, pifCashier, deliveryStaff } from '../../test/staff-session';
import type {
  PifCategory,
  PifOrderDetail,
  PifOrderSummary,
  PifProduct,
} from '../../lib/api/pif-admin-api';

/**
 * PIF administration screens (PHASE F).
 *
 * WHAT THESE TESTS ARE FOR. That the catalogue is genuinely manageable from
 * the console — a product created, a price changed, an item taken off the
 * shelf for the day, a photograph uploaded — and that the order desk offers
 * exactly the next step the server says is possible and no other.
 *
 * WHAT THEY ARE ALSO FOR, and this is the part a future edit could quietly
 * break: the ABSENCES and the AUTHORITY SPLIT. No price is computed here; no
 * stock quantity field exists; a packer is not shown an Accept button; a
 * delivery staff member is not shown a price control. Each of those is
 * asserted, because each of them is a decision, not an accident.
 */

const api = vi.hoisted(() => ({
  fetchDashboard: vi.fn(),
  fetchCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductFlags: vi.fn(),
  setProductPrice: vi.fn(),
  uploadProductImage: vi.fn(),
  removeProductImage: vi.fn(),
  fetchTaxRates: vi.fn(),
  createTaxRate: vi.fn(),
  fetchOrders: vi.fn(),
  fetchOrder: vi.fn(),
  recordOrderStatus: vi.fn(),
  addOrderNote: vi.fn(),
}));

vi.mock('../../lib/api/pif-admin-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/pif-admin-api')>(
    '../../lib/api/pif-admin-api'
  );
  // The display helpers (rupees, statusLabel, needsReason, mediaUrl) are
  // exercised for real; only the network calls are replaced.
  return { ...actual, ...api };
});

let session: StaffSession | null = null;
vi.mock('../../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({
    status: 'authenticated',
    session,
    login: vi.fn(),
    logout: vi.fn(),
    can: () => false,
    hasRole: () => false,
  }),
}));

const category = (overrides: Partial<PifCategory> = {}): PifCategory => ({
  id: 'cat-1',
  name: 'Staples',
  parentId: null,
  parentName: null,
  description: null,
  imageUrl: null,
  sortOrder: 10,
  active: true,
  productCount: 2,
  ...overrides,
});

const product = (overrides: Partial<PifProduct> = {}): PifProduct => ({
  id: 'prod-1',
  sku: 'RICE-1KG',
  barcode: null,
  name: 'Sona Masoori rice',
  brand: 'Local Mills',
  description: null,
  categoryId: 'cat-1',
  categoryName: 'Staples',
  parentCategoryName: null,
  unit: 'kg',
  packSize: 1,
  packUnit: 'kg',
  price: 100,
  purchasePrice: null,
  discountPct: null,
  taxRateId: 'tax-1',
  taxRateName: 'GST 5%',
  taxRatePct: 5,
  imageUrl: null,
  imageRef: null,
  active: true,
  available: true,
  minOrderQty: 1,
  maxOrderQty: 10,
  qtyStep: 1,
  variantGroup: null,
  variantLabel: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  updatedBy: 'staff-1',
  ...overrides,
});

const orderSummary = (overrides: Partial<PifOrderSummary> = {}): PifOrderSummary => ({
  id: 'order-1',
  orderNumber: 'PIF-20261009-0001',
  status: 'PLACED',
  fulfillmentMode: 'DELIVERY',
  customerName: 'R Nair',
  customerMobile: '9810000001',
  itemCount: 2,
  total: 232,
  placedAt: '2026-10-09T09:00:00.000Z',
  updatedAt: '2026-10-09T09:00:00.000Z',
  ...overrides,
});

const orderDetail = (overrides: Partial<PifOrderDetail> = {}): PifOrderDetail => ({
  id: 'order-1',
  orderNumber: 'PIF-20261009-0001',
  status: 'PLACED',
  nextSteps: ['ACCEPTED', 'CANCELLED'],
  fulfillmentMode: 'DELIVERY',
  paymentMethod: 'COD',
  customer: {
    id: 'cust-1',
    name: 'R Nair',
    mobile: '9810000001',
    contactName: 'R Nair',
    contactMobile: '9810000001',
  },
  deliveryAddress: 'Home, F-401, Near the water tank',
  customerNote: 'Please come after six',
  subtotal: 220,
  discountTotal: 0,
  taxTotal: 12,
  total: 232,
  codAmount: 232,
  codCollectedAt: null,
  placedAt: '2026-10-09T09:00:00.000Z',
  items: [
    {
      productId: 'prod-1',
      sku: 'RICE-1KG',
      name: 'Sona Masoori rice',
      brand: 'Local Mills',
      unit: 'kg',
      packSize: 1,
      imageUrl: null,
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
  history: [
    {
      eventId: 'ev-1',
      sequenceNo: 1,
      eventType: 'PLACEMENT',
      status: 'PLACED',
      reason: null,
      notes: null,
      recordedAt: '2026-10-09T09:00:00.000Z',
      recordedBy: { staffId: null, name: null, role: 'CUSTOMER' },
    },
  ],
  ...overrides,
});

const renderPage = (ui: React.ReactElement, who: StaffSession = pifAdmin()) => {
  session = who;
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.fetchCategories.mockResolvedValue({ items: [category()] });
  api.fetchTaxRates.mockResolvedValue({
    items: [{ id: 'tax-1', name: 'GST 5%', ratePct: 5, active: true }],
  });
  api.fetchProducts.mockResolvedValue({ items: [product()], total: 1, page: 1, pageSize: 25 });
  api.fetchOrders.mockResolvedValue({ items: [orderSummary()], total: 1 });
  api.fetchOrder.mockResolvedValue(orderDetail());
  api.fetchDashboard.mockResolvedValue({
    counts: { PLACED: 2, PREPARING: 1 },
    newOrders: 2,
    openOrders: 3,
    recent: [orderSummary()],
    catalogue: { products: 48, unavailable: 2 },
  });
  api.createProduct.mockResolvedValue({ id: 'prod-9', sku: 'NEW-1' });
  api.updateProduct.mockResolvedValue({ id: 'prod-1', updated: true });
  api.setProductFlags.mockResolvedValue({ id: 'prod-1', updated: true });
  api.createCategory.mockResolvedValue({ id: 'cat-9', name: 'Pulses' });
  api.updateCategory.mockResolvedValue({ id: 'cat-1', updated: true });
  api.recordOrderStatus.mockResolvedValue({ orderId: 'order-1', eventId: 'ev-2', status: 'ACCEPTED' });
  api.addOrderNote.mockResolvedValue({ orderId: 'order-1', eventId: 'ev-3' });
  api.uploadProductImage.mockResolvedValue({
    id: 'prod-1',
    imageRef: 'pif/products/11111111-1111-4111-8111-111111111111.png',
    imageUrl: '/pif/media/pif/products/11111111-1111-4111-8111-111111111111.png',
    bytes: 2048,
  });
  api.removeProductImage.mockResolvedValue({ id: 'prod-1', imageRef: null });
});

describe('PifDashboardPage — the PIF module’s own dashboard', () => {
  it('counts the new orders waiting and announces them', async () => {
    renderPage(<PifDashboardPage />);
    // The loading view also carries role="status", so the panel is found by
    // its own words first.
    const alert = (await screen.findByText(/have not been accepted yet/i)).parentElement as HTMLElement;
    expect(within(alert).getByText('2')).toBeInTheDocument();
    expect(within(alert).getByText(/new orders waiting/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the order desk/i })).toHaveAttribute(
      'href',
      '/pif/orders'
    );
  });

  it('shows the catalogue figures and says nothing about billing', async () => {
    renderPage(<PifDashboardPage />);
    await screen.findByText(/new orders waiting/i);
    expect(screen.getByText('48')).toBeInTheDocument();
    expect(screen.getByText(/out of stock today/i)).toBeInTheDocument();
    expect(screen.getByText(/billing software does that/i)).toBeInTheDocument();
  });

  it('is PIF only — no entitlement, voucher or issue-window figure appears', async () => {
    renderPage(<PifDashboardPage />);
    await screen.findByText(/new orders waiting/i);
    // RIK vocabulary, specifically — "administration" contains "ration", so
    // the patterns are the words that would mean RIK data had leaked in.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/entitlement/i);
    expect(text).not.toMatch(/eligible days/i);
    expect(text).not.toMatch(/issue voucher/i);
    expect(text).not.toMatch(/fresh window/i);
    expect(text).not.toMatch(/dry window/i);
    // The screen does name RIK once — to say that ration work is elsewhere.
    expect(text).toMatch(/Ration \(RIK\) work is in its own section/);
  });
});

describe('PifCategoriesPage — two levels, managed by the client', () => {
  it('creates a top-level category', async () => {
    renderPage(<PifCategoriesPage />);
    await screen.findByRole('button', { name: 'Deactivate' });

    await userEvent.type(screen.getByLabelText(/^Name/), 'Pulses');
    await userEvent.click(screen.getByRole('button', { name: /add category/i }));

    expect(api.createCategory).toHaveBeenCalledWith({
      name: 'Pulses',
      parentId: null,
      description: null,
      sortOrder: 0,
    });
  });

  it('offers only top-level categories as a parent, so the taxonomy stays two deep', async () => {
    api.fetchCategories.mockResolvedValue({
      items: [category(), category({ id: 'cat-2', name: 'Rice', parentId: 'cat-1', parentName: 'Staples' })],
    });
    renderPage(<PifCategoriesPage />);
    await screen.findByText('Rice');

    const parent = screen.getByLabelText(/^Parent category/);
    const options = within(parent).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['— none (top level) —', 'Staples']);
  });

  it('deactivates a category through the server, and never deletes one', async () => {
    renderPage(<PifCategoriesPage />);
    await screen.findByRole('button', { name: 'Deactivate' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(api.updateCategory).toHaveBeenCalledWith('cat-1', {
      name: 'Staples',
      parentId: null,
      description: null,
      sortOrder: 10,
      active: false,
    });
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('reports the server’s refusal in its own words', async () => {
    const { ApiError } = await import('../../lib/api/client');
    api.updateCategory.mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION_FAILED',
        message: 'This category still holds 2 product(s) and 0 subcategory(ies). Move or deactivate those first.',
      })
    );
    renderPage(<PifCategoriesPage />);
    await screen.findByRole('button', { name: 'Deactivate' });

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText(/still holds 2 product\(s\)/i)).toBeInTheDocument();
  });
});

describe('PifProductsPage — the client’s own catalogue', () => {
  it('lists a product with its price, GST and availability', async () => {
    renderPage(<PifProductsPage />);
    expect(await screen.findByText('Sona Masoori rice')).toBeInTheDocument();
    expect(screen.getByText('₹100.00')).toBeInTheDocument();
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText(/RICE-1KG/)).toBeInTheDocument();
  });

  it('creates a product from the form, sending exactly what was typed', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');

    await userEvent.click(screen.getByRole('button', { name: /add a product/i }));
    await userEvent.type(screen.getByLabelText(/^Product name/), 'Toor dal');
    await userEvent.type(screen.getByLabelText(/^SKU/), 'DAL-1KG');
    await userEvent.clear(screen.getByLabelText(/^Unit of measure/));
    await userEvent.type(screen.getByLabelText(/^Unit of measure/), 'kg');
    await userEvent.type(screen.getByLabelText(/^Selling price/), '180.50');
    await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), 'tax-1');
    await userEvent.click(screen.getByRole('button', { name: /^add product$/i }));

    expect(api.createProduct).toHaveBeenCalledTimes(1);
    const sent = api.createProduct.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.name).toBe('Toor dal');
    expect(sent.sku).toBe('DAL-1KG');
    expect(sent.sellingPrice).toBe(180.5);
    expect(sent.taxRateId).toBe('tax-1');
    // No total, no tax amount, no stock quantity — the server computes money
    // and PIF holds no inventory.
    expect(sent).not.toHaveProperty('total');
    expect(sent).not.toHaveProperty('taxAmount');
    expect(sent).not.toHaveProperty('stockQty');
  });

  it('has no stock-quantity field anywhere on the form', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');
    await userEvent.click(screen.getByRole('button', { name: /add a product/i }));

    for (const label of [/stock quantity/i, /on hand/i, /quantity in stock/i, /reorder level/i, /opening stock/i]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    // The limit that DOES exist is explicitly not a stock level.
    expect(screen.getByText(/NOT a stock level/i)).toBeInTheDocument();
  });

  it('takes a product off the shelf for the day without deactivating it', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');

    await userEvent.click(screen.getByRole('button', { name: /mark out of stock/i }));
    expect(api.setProductFlags).toHaveBeenCalledWith('prod-1', { available: false });
  });

  it('uploads a product picture as a real file', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'rice.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText(/choose a product picture/i), file);

    expect(api.uploadProductImage).toHaveBeenCalledWith('prod-1', file);
    expect(await screen.findByText(/picture was uploaded/i)).toBeInTheDocument();
  });

  it('shows a placeholder, not a broken picture, when a product has none', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows the picture from the API’s own URL once there is one', async () => {
    api.fetchProducts.mockResolvedValue({
      items: [product({ imageUrl: '/pif/media/pif/products/abc.png', imageRef: 'pif/products/abc.png' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderPage(<PifProductsPage />);
    const image = await screen.findByAltText(/Sona Masoori rice picture/i);
    expect(image.getAttribute('src')).toContain('/pif/media/pif/products/abc.png');
  });

  it('falls back to the placeholder when a stored picture will not load', async () => {
    // The verification finding: image_ref is a database key and the picture
    // is a file, and the two can disagree. A 404 must look like "no
    // picture", not like a broken page.
    api.fetchProducts.mockResolvedValue({
      items: [product({ imageUrl: '/pif/media/pif/products/gone.png', imageRef: 'pif/products/gone.png' })],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    renderPage(<PifProductsPage />);
    const image = await screen.findByAltText(/Sona Masoori rice picture/i);

    // The browser cannot load anything in jsdom, so the failure is fired the
    // way the browser fires it.
    fireEvent.error(image);

    expect(screen.queryByAltText(/Sona Masoori rice picture/i)).not.toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
  });

  it('searches and filters through the server, never in the browser', async () => {
    renderPage(<PifProductsPage />);
    await screen.findByText('Sona Masoori rice');

    await userEvent.type(screen.getByLabelText(/^Search/), 'dal');
    await userEvent.selectOptions(screen.getByLabelText(/^Status/), 'UNAVAILABLE');

    const last = api.fetchProducts.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(last.q).toBe('dal');
    expect(last.status).toBe('UNAVAILABLE');
    expect(last.page).toBe(1);
  });
});

describe('PifOrdersPage — the order desk', () => {
  it('lists an order with the customer, the mode and the amount', async () => {
    renderPage(<PifOrdersPage />);
    expect(await screen.findByText(/PIF-20261009-0001 · New order/)).toBeInTheDocument();
    expect(screen.getByText(/R Nair · 9810000001 · 2 item\(s\) · Delivery/)).toBeInTheDocument();
    expect(screen.getByText('₹232.00')).toBeInTheDocument();
  });

  it('opens an order and shows what to pick, where it goes and what to collect', async () => {
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    expect(await screen.findByText('Home, F-401, Near the water tank')).toBeInTheDocument();
    expect(screen.getByText('2 kg')).toBeInTheDocument();
    expect(screen.getByText(/please come after six/i)).toBeInTheDocument();
    // Scoped: the same figure appears in the list row above and in the
    // order's own totals, which is correct — they are the same order.
    const collect = screen.getByText('To collect').parentElement as HTMLElement;
    expect(within(collect).getAllByText('₹232.00').length).toBeGreaterThan(0);
    expect(within(collect).getByText(/not collected yet/i)).toBeInTheDocument();
  });

  it('offers only the steps the SERVER says come next', async () => {
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));
    await screen.findByText('Customer');

    expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();
    // Not offered: the server did not list them.
    for (const label of ['Being prepared', 'Ready', 'Delivered', 'Cash collected']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('records a status move through the server', async () => {
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));
    await userEvent.click(await screen.findByRole('button', { name: 'Accepted' }));

    expect(api.recordOrderStatus).toHaveBeenCalledWith('order-1', { status: 'ACCEPTED' });
  });

  it('will not cancel without a reason, and sends the reason when there is one', async () => {
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    const cancel = await screen.findByRole('button', { name: 'Cancelled' });
    expect(cancel).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^Reason/), 'Customer called to cancel');
    expect(cancel).toBeEnabled();
    await userEvent.click(cancel);
    expect(api.recordOrderStatus).toHaveBeenCalledWith('order-1', {
      status: 'CANCELLED',
      reason: 'Customer called to cancel',
    });
  });

  it('shows a PACKER the preparation step and NOT the accept step', async () => {
    api.fetchOrder.mockResolvedValue(
      orderDetail({ status: 'ACCEPTED', nextSteps: ['PREPARING', 'CANCELLED'] })
    );
    renderPage(<PifOrdersPage />, pifCashier());
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    expect(await screen.findByRole('button', { name: 'Being prepared' })).toBeInTheDocument();
    // Cancelling needs pif.order.manage, which a cashier does not hold.
    expect(screen.queryByRole('button', { name: 'Cancelled' })).not.toBeInTheDocument();
    expect(screen.getByText(/recorded by another role/i)).toBeInTheDocument();
  });

  it('shows DELIVERY_STAFF only the handover steps', async () => {
    api.fetchOrder.mockResolvedValue(
      orderDetail({ status: 'OUT_FOR_DELIVERY', nextSteps: ['DELIVERED', 'NOT_DELIVERED', 'CANCELLED'] })
    );
    renderPage(<PifOrdersPage />, deliveryStaff());
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    expect(await screen.findByRole('button', { name: 'Delivered' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not delivered' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancelled' })).not.toBeInTheDocument();
  });

  it('a finished order offers no step at all — and no edit, delete or undo', async () => {
    api.fetchOrder.mockResolvedValue(
      orderDetail({ status: 'COD_COLLECTED', nextSteps: [], codCollectedAt: '2026-10-09T12:00:00.000Z' })
    );
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    expect(await screen.findByText(/this order is finished/i)).toBeInTheDocument();
    for (const label of [/edit/i, /delete/i, /undo/i, /reopen/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('shows the history with each actor named, and keeps notes internal', async () => {
    api.fetchOrder.mockResolvedValue(
      orderDetail({
        history: [
          {
            eventId: 'ev-1',
            sequenceNo: 1,
            eventType: 'PLACEMENT',
            status: 'PLACED',
            reason: null,
            notes: null,
            recordedAt: '2026-10-09T09:00:00.000Z',
            recordedBy: { staffId: null, name: null, role: 'CUSTOMER' },
          },
          {
            eventId: 'ev-2',
            sequenceNo: 2,
            eventType: 'NOTE',
            status: null,
            reason: null,
            notes: 'Short on the 1 kg packs',
            recordedAt: '2026-10-09T09:30:00.000Z',
            recordedBy: { staffId: 'staff-2', name: 'Counter Staff', role: 'PIF_CASHIER' },
          },
        ],
      })
    );
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    const history = (await screen.findByText('History')).parentElement as HTMLElement;
    expect(within(history).getByText('New order')).toBeInTheDocument();
    expect(within(history).getByText('Note')).toBeInTheDocument();
    expect(within(history).getByText(/short on the 1 kg packs/i)).toBeInTheDocument();
    expect(within(history).getByText(/Counter Staff/)).toBeInTheDocument();
    expect(screen.getByText(/notes stay inside the facility/i)).toBeInTheDocument();
  });

  it('adds an internal note once there is something in it', async () => {
    renderPage(<PifOrdersPage />);
    await userEvent.click(await screen.findByText(/PIF-20261009-0001/));

    const save = await screen.findByRole('button', { name: /save note/i });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Internal note'), 'Call before leaving');
    await userEvent.click(save);
    expect(api.addOrderNote).toHaveBeenCalledWith('order-1', 'Call before leaving');
  });
});
