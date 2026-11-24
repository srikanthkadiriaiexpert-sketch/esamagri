import { apiDownload, apiRequest, apiUpload } from './client';
import { env } from '../../env';

/**
 * PIF administration — the client's own grocery catalogue and order desk
 * (PHASE F).
 *
 * Every shape here mirrors `PifAdminController`. Nothing in this file
 * computes a price, a tax figure, a total or a next status: the server does
 * all of it, and these screens send what the administrator typed and display
 * what they are told. That is not fastidiousness — an admin screen that
 * calculated a total would be a second, divergent source of truth for money.
 *
 * AUTHORIZATION IS THE SERVER'S TOO. The navigation hides what a staff
 * member cannot use, but every call below is authorized independently, so a
 * hidden screen reached by typing its URL shows the honest 403 state.
 */

export interface PifCategory {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  /** 'grocers' | 'fresh-mart', or null for a pre-business demo row. */
  businessSlug: string | null;
  productCount: number;
}

/**
 * How a PIF shop is named on screen.
 *
 * The Admin Portal lists all 164 approved categories from both shops in one
 * table and one dropdown, so every category has to say which shop it belongs
 * to -- "Vegetables" alone does not.
 */
export const SHOP_LABEL: Record<string, string> = {
  grocers: 'Grocers',
  'fresh-mart': 'Fresh Mart',
};

export function shopLabel(businessSlug: string | null | undefined): string {
  // undefined as well as null: a caller may hold a category from a payload
  // that predates businessSlug, and returning undefined from here renders as
  // nothing on screen and as a missing React key.
  if (businessSlug === null || businessSlug === undefined) return 'Demo';
  return SHOP_LABEL[businessSlug] ?? businessSlug;
}

export interface PifTaxRate {
  id: string;
  name: string;
  ratePct: number;
  active: boolean;
}

export interface PifProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  price: number;
  purchasePrice: number | null;
  discountPct: number | null;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePct: number;
  imageUrl: string | null;
  imageRef: string | null;
  active: boolean;
  available: boolean;
  minOrderQty: number;
  maxOrderQty: number | null;
  qtyStep: number;
  variantGroup: string | null;
  variantLabel: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface ProductInput {
  sku: string;
  name: string;
  barcode?: string | null;
  brand?: string | null;
  description?: string | null;
  categoryId?: string | null;
  unit: string;
  packSize?: number | null;
  packUnit?: string | null;
  sellingPrice: number;
  taxRateId?: string | null;
  discountPct?: number | null;
  minOrderQty?: number;
  maxOrderQty?: number | null;
  qtyStep?: number;
  active?: boolean;
  available?: boolean;
  variantGroup?: string | null;
  variantLabel?: string | null;
}

export type PifOrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_PICKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COD_COLLECTED'
  | 'CANCELLED'
  | 'NOT_DELIVERED';

export interface PifOrderSummary {
  id: string;
  orderNumber: string;
  status: PifOrderStatus;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  customerName: string | null;
  customerMobile: string | null;
  itemCount: number;
  /** The delivery charge on this order: once per order, 0 for pickup. */
  deliveryTotal: number;
  total: number;
  placedAt: string | null;
  updatedAt: string;
  /**
   * 'grocers' | 'fresh-mart' | 'mixed' | null, derived by the server from the
   * categories this order's items sit under. An order carries no business of
   * its own: the customer has ONE PIF cart, not one per shop, so 'mixed' is a
   * real answer and not an error.
   */
  business: string | null;
  /**
   * Whether a staff member has marked the incoming-order alert Received.
   * Says NOTHING about the order's progress -- acknowledgement is a NOTE
   * event, which the database forbids from carrying a status.
   */
  acknowledged: boolean;
}

export interface PifOrderLine {
  productId: string;
  sku: string | null;
  name: string | null;
  brand: string | null;
  unit: string | null;
  packSize: number | null;
  imageUrl: string | null;
  qty: number;
  unitPrice: number;
  taxRateName: string | null;
  taxRatePct: number;
  discountPct: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTax: number;
  lineTotal: number;
}

export interface PifOrderEvent {
  eventId: string;
  sequenceNo: number;
  eventType: 'PLACEMENT' | 'STATUS' | 'COD' | 'NOTE';
  status: PifOrderStatus | null;
  reason: string | null;
  notes: string | null;
  recordedAt: string;
  recordedBy: { staffId: string | null; name: string | null; role: string };
}

export interface PifOrderDetail {
  id: string;
  orderNumber: string;
  status: PifOrderStatus;
  nextSteps: PifOrderStatus[];
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  paymentMethod: string;
  customer: {
    id: string;
    name: string | null;
    mobile: string | null;
    contactName: string | null;
    contactMobile: string | null;
  };
  deliveryAddress: string | null;
  customerNote: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /** As charged on THIS order, whatever today's rule would say. */
  deliveryTotal: number;
  total: number;
  codAmount: number | null;
  codCollectedAt: string | null;
  placedAt: string | null;
  items: PifOrderLine[];
  history: PifOrderEvent[];
}

export interface PifDashboard {
  counts: Record<string, number>;
  newOrders: number;
  openOrders: number;
  recent: PifOrderSummary[];
  catalogue: { products: number; unavailable: number };
}

const BASE = '/admin/pif';

// ------------------------------------------------------------------ catalogue

export function fetchCategories(signal?: AbortSignal): Promise<{ items: PifCategory[] }> {
  return apiRequest(`${BASE}/categories`, { signal });
}

export function createCategory(body: {
  name: string;
  parentId?: string | null;
  description?: string | null;
  sortOrder?: number;
  active?: boolean;
}): Promise<{ id: string; name: string }> {
  return apiRequest(`${BASE}/categories`, { method: 'POST', body });
}

export function updateCategory(
  categoryId: string,
  body: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    sortOrder?: number;
    active?: boolean;
  }
): Promise<{ id: string; updated: boolean }> {
  return apiRequest(`${BASE}/categories/${categoryId}`, { method: 'PATCH', body });
}

export function fetchProducts(
  query: { q?: string; categoryId?: string; status?: string; page?: number; pageSize?: number },
  signal?: AbortSignal
): Promise<{ items: PifProduct[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.status && query.status !== 'ALL') params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 25));
  return apiRequest(`${BASE}/products?${params.toString()}`, { signal });
}

export function fetchProduct(productId: string, signal?: AbortSignal): Promise<PifProduct> {
  return apiRequest(`${BASE}/products/${productId}`, { signal });
}

export function createProduct(body: ProductInput): Promise<{ id: string; sku: string }> {
  return apiRequest(`${BASE}/products`, { method: 'POST', body });
}

export function updateProduct(
  productId: string,
  body: ProductInput
): Promise<{ id: string; updated: boolean }> {
  return apiRequest(`${BASE}/products/${productId}`, { method: 'PATCH', body });
}

export function setProductFlags(
  productId: string,
  body: { active?: boolean; available?: boolean }
): Promise<{ id: string; updated: boolean }> {
  return apiRequest(`${BASE}/products/${productId}/flags`, { method: 'PATCH', body });
}

export function setProductPrice(
  productId: string,
  body: { sellingPrice: number; taxRateId?: string | null; discountPct?: number | null }
): Promise<{ id: string; updated: boolean }> {
  return apiRequest(`${BASE}/products/${productId}/price`, { method: 'PATCH', body });
}

/** The one multipart call: the administrator's own image file. */
export function uploadProductImage(
  productId: string,
  file: File
): Promise<{ id: string; imageRef: string; imageUrl: string; bytes: number }> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload(`${BASE}/products/${productId}/image`, form);
}

export function removeProductImage(productId: string): Promise<{ id: string; imageRef: null }> {
  return apiRequest(`${BASE}/products/${productId}/image`, { method: 'DELETE' });
}

export function fetchTaxRates(signal?: AbortSignal): Promise<{ items: PifTaxRate[] }> {
  return apiRequest(`${BASE}/tax-rates`, { signal });
}

export function createTaxRate(body: {
  name: string;
  ratePct: number;
}): Promise<{ id: string; name: string; ratePct: number }> {
  return apiRequest(`${BASE}/tax-rates`, { method: 'POST', body });
}

// --------------------------------------------------------------- order desk

export function fetchDashboard(signal?: AbortSignal): Promise<PifDashboard> {
  return apiRequest(`${BASE}/dashboard`, { signal });
}

export function fetchOrders(
  query: { status?: string; open?: boolean; q?: string; page?: number; pageSize?: number },
  signal?: AbortSignal
): Promise<{ items: PifOrderSummary[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  params.set('open', query.open === false ? 'false' : 'true');
  if (query.q) params.set('q', query.q);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 25));
  return apiRequest(`${BASE}/orders?${params.toString()}`, { signal });
}

export function fetchOrder(orderId: string, signal?: AbortSignal): Promise<PifOrderDetail> {
  return apiRequest(`${BASE}/orders/${orderId}`, { signal });
}

export function recordOrderStatus(
  orderId: string,
  body: { status: PifOrderStatus; reason?: string; notes?: string }
): Promise<{ orderId: string; eventId: string; status: string }> {
  return apiRequest(`${BASE}/orders/${orderId}/status`, { method: 'POST', body });
}

export function addOrderNote(
  orderId: string,
  note: string
): Promise<{ orderId: string; eventId: string }> {
  return apiRequest(`${BASE}/orders/${orderId}/notes`, { method: 'POST', body: { note } });
}

/**
 * The exact note an acknowledgement writes. The server matches the '[ACK]'
 * prefix to compute `PifOrderSummary.acknowledged`, so this string and
 * ORDER_ACK_NOTE in apps/api/src/pif/repositories/pif-orders.repository.ts
 * must agree. Nothing else should build it.
 */
export const ORDER_ACK_NOTE = '[ACK] Incoming-order alert acknowledged';

/**
 * Mark an incoming-order alert as seen.
 *
 * THIS IS NOT A STATUS CHANGE. It records a NOTE, which pif.order_events
 * constrains to `status IS NULL` and pif.trg_apply_order_event ignores, so
 * the order stays exactly where it was in the lifecycle. Received means
 * "a human has seen this alert", nothing more.
 *
 * It needs no new endpoint: POST /admin/pif/orders/:id/notes already exists
 * and already enforces pif.order.prepare or pif.order.manage.
 */
export function acknowledgeOrder(orderId: string): Promise<{ orderId: string; eventId: string }> {
  return addOrderNote(orderId, ORDER_ACK_NOTE);
}

// ------------------------------------------------ PIF notification settings

export interface OrderAlertSound {
  /** The active file's own name, for display. Never a path. */
  filename: string;
  /** True while the sound the system was supplied with is in force. */
  isDefault: boolean;
  bytes: number;
  sha256: string;
  /** When it was last replaced; null while the default is in force. */
  updatedAt: string | null;
  /** The API route that streams the audio, relative to the API base. */
  url: string;
  /** The server's real upload limit, so the screen need not hard-code one. */
  limitBytes: number;
}

/**
 * The URL the browser plays the order-alert sound from.
 *
 * The admin portal runs on a different origin from the API, so the API's base
 * has to be put back in front of the route — the same reason `mediaUrl` exists
 * for uploaded pictures. One fixed address: the content behind it changes when
 * the client replaces the sound, which is why the API serves it with an ETag
 * and `no-cache` rather than caching it immutably.
 */
export function alertSoundUrl(): string {
  return `${env.VITE_API_BASE_URL}/pif/alert-sound`;
}

export function fetchOrderAlertSound(signal?: AbortSignal): Promise<OrderAlertSound> {
  return apiRequest(`${BASE}/settings/order-alert-sound`, { signal });
}

/**
 * Upload and activate a new sound.
 *
 * Sent through `apiUpload`, not `apiRequest`: the browser has to write the
 * Content-Type itself so that it carries the multipart boundary it generated.
 * The server checks the file by its contents and refuses anything that is not
 * an MP3, so a rejection here is the server's own sentence.
 */
export function replaceOrderAlertSound(file: File): Promise<OrderAlertSound> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload(`${BASE}/settings/order-alert-sound`, form);
}

/** Return to the sound the system was supplied with. */
export function restoreOrderAlertSound(): Promise<OrderAlertSound> {
  return apiRequest(`${BASE}/settings/order-alert-sound`, { method: 'DELETE' });
}


// ----------------------------------------------------- bulk product import

export interface ImportBatch {
  id: string;
  filename: string;
  format: 'XLSX' | 'CSV';
  bytes: number;
  status: 'PREVIEW' | 'APPLIED' | 'DISCARDED' | 'FAILED';
  totalRows: number;
  createRows: number;
  updateRows: number;
  invalidRows: number;
  appliedRows: number;
  failureReason: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ImportRow {
  id: string;
  rowNo: number;
  verdict: 'CREATE' | 'UPDATE' | 'INVALID';
  sku: string | null;
  name: string | null;
  productId: string | null;
  problems: string[];
  appliedAt: string | null;
  sellingPrice: number | null;
  unit: string | null;
  available: boolean | null;
  active: boolean | null;
}

export interface ImportPreview {
  batch: ImportBatch;
  missingCategories: string[];
  unknownTaxRates: string[];
  ignoredColumns: Array<{ heading: string; reason: string }>;
  unknownColumns: string[];
  columnsUsed: string[];
}

export function fetchImportBatches(
  limit = 20,
  signal?: AbortSignal
): Promise<{ items: ImportBatch[] }> {
  return apiRequest(`${BASE}/products/import?limit=${limit}`, { signal });
}

export function fetchImportBatch(batchId: string, signal?: AbortSignal): Promise<{ batch: ImportBatch }> {
  return apiRequest(`${BASE}/products/import/${batchId}`, { signal });
}

export function fetchImportRows(
  batchId: string,
  query: { verdict?: string; limit?: number; offset?: number } = {},
  signal?: AbortSignal
): Promise<{ items: ImportRow[]; total: number }> {
  const params = new URLSearchParams();
  if (query.verdict) params.set('verdict', query.verdict);
  params.set('limit', String(query.limit ?? 200));
  params.set('offset', String(query.offset ?? 0));
  return apiRequest(`${BASE}/products/import/${batchId}/rows?${params.toString()}`, { signal });
}

/** Upload for a PREVIEW. Nothing is written to the catalogue by this call. */
export function previewImport(file: File): Promise<ImportPreview> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload(`${BASE}/products/import/preview`, form);
}

export function applyImport(batchId: string): Promise<{ batch: ImportBatch }> {
  return apiRequest(`${BASE}/products/import/${batchId}/apply`, { method: 'POST' });
}

export function discardImport(batchId: string): Promise<{ batch: ImportBatch }> {
  return apiRequest(`${BASE}/products/import/${batchId}/discard`, { method: 'POST' });
}

export function downloadImportTemplate(): Promise<{ blob: Blob; filename: string | null }> {
  return apiDownload(`${BASE}/products/import/template`);
}

/** What a verdict means, in the facility's own words. */
export const VERDICT_LABELS: Readonly<Record<string, string>> = {
  CREATE: 'New product',
  UPDATE: 'Updates an existing product',
  INVALID: 'Cannot be imported',
};

export const IMPORT_STATUS_LABELS: Readonly<Record<string, string>> = {
  PREVIEW: 'Awaiting your decision',
  APPLIED: 'Applied',
  DISCARDED: 'Discarded',
  FAILED: 'Stopped part-way',
};

// ------------------------------------------------------------------ display

/** The facility's own words for an order state. One list, one place. */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  PLACED: 'New order',
  ACCEPTED: 'Accepted',
  PREPARING: 'Being prepared',
  READY_PICKED: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  COD_COLLECTED: 'Cash collected',
  CANCELLED: 'Cancelled',
  NOT_DELIVERED: 'Not delivered',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** A status that must carry a reason before the server will accept it. */
export function needsReason(status: string): boolean {
  return status === 'CANCELLED' || status === 'NOT_DELIVERED';
}

/** Rupees, as the facility writes them. Display only — never arithmetic. */
export function rupees(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

export function quantityLabel(qty: number, unit: string | null): string {
  const text = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  return unit === null ? text : `${text} ${unit}`;
}

/**
 * An image URL the browser can load.
 *
 * MOVED to lib/api/media-url.ts and shared with RIK. The move also added the
 * branch this copy was missing: a `/catalogue/...` reference belongs to the
 * customer app, and prefixing it with the API's origin yields a 404. Harmless
 * while the admin app rendered no such reference; the RIK provisions table
 * renders them, so it is fixed at the source for both modules.
 */
export { mediaUrl } from './media-url';
