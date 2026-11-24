import { apiRequest } from './client';
import { mediaUrl } from './media-url';
import type { CategorySummary, PifProduct } from './types';

/**
 * The PIF shop, as the customer's app talks to it (PHASE F).
 *
 * WHAT THIS MODULE IS CAREFUL ABOUT: money. It converts rupees to the paise
 * the shared ProductCard displays, and it does NOT add anything up. Every
 * line total, discount, tax figure and order total on a PIF screen comes from
 * the server — `quoteCart` for a cart the customer is still editing, and the
 * order itself once placed. There is no code path here that computes what
 * something costs, which is why a stale price, a changed GST rate or a
 * discount the shop ended cannot produce a wrong figure on screen.
 *
 * WHAT IT CANNOT DO AT ALL: change an order. There are two writes in this
 * file — quoting a cart, which stores nothing, and placing an order. No
 * cancel, no status change, no edit; the server exposes none to a customer,
 * and the application holds no UPDATE on a PIF order.
 */

/**
 * A PIF category as the shop screens need it: the shared CategorySummary plus
 * the server's own navigation slug.
 *
 * WHY THE SLUG IS HERE. A /pif/grocers/:mainSlug/:subSlug URL carries a slug;
 * /pif/categories/:id/products needs an id. This field is the only honest
 * bridge between the two. NEVER match these by name instead: "Rice" and
 * "Beverages" each exist twice in pif.categories under different parents, so
 * a name match would resolve to the wrong shelf.
 *
 * OPTIONAL, deliberately: an API older than this change omits it, and the
 * screens treat an absent slug as "cannot resolve" rather than crashing.
 */
export interface PifCategorySummary extends CategorySummary {
  slug?: string | null;
}

export interface PifCategoryNode extends PifCategorySummary {
  description: string | null;
  subcategories: PifCategorySummary[];
}

export interface PifProductPage {
  items: PifProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PifProductDetail extends PifProduct {
  variants: PifProduct[];
}

/** A line as the SERVER priced it. Nothing here was computed in the browser. */
export interface QuotedLine {
  productId: string;
  name: string;
  brand: string | null;
  unit: string;
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

export interface QuoteResult {
  lines: QuotedLine[];
  /** What the server would not put in an order, and why — in its words. */
  refused: Array<{ productId: string; reason: string; message: string }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /**
   * THE DELIVERY FIGURES, every one of them the server's.
   *
   * `merchandiseTotal` is subtotal - discount + GST: what the goods cost, and
   * the amount the free-delivery threshold was tested against.
   * `deliveryTotal` is the charge that follows — one per order, never one per
   * shop, and always 0 for store pickup. `deliveryFee`, `deliveryThreshold`
   * and `amountToFreeDelivery` are sent so this app can say "Add Rs X more to
   * unlock FREE delivery" WITHOUT hard-coding 20 or 499 anywhere: if the
   * facility's policy changes, these numbers change with it and no screen
   * needs editing.
   */
  merchandiseTotal: number;
  deliveryTotal: number;
  freeDelivery: boolean;
  deliveryFee: number;
  deliveryThreshold: number;
  amountToFreeDelivery: number;
  total: number;
  paymentMethod: 'COD';
}

export type PifOrderState =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_PICKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COD_COLLECTED'
  | 'CANCELLED'
  | 'NOT_DELIVERED';

export interface PifOrderListItem {
  id: string;
  orderNumber: string;
  status: PifOrderState;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  itemCount: number;
  /** The delivery charge this order carried. 0 for pickup and for free delivery. */
  deliveryTotal: number;
  total: number;
  paymentMethod: string;
  placedAt: string | null;
  updatedAt: string;
}

export interface PifOrderDocument {
  id: string;
  orderNumber: string;
  status: PifOrderState;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  paymentMethod: string;
  deliveryAddress: string | null;
  contactName: string | null;
  contactMobile: string | null;
  customerNote: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /** As charged on THIS order, whatever today's rule would say. */
  deliveryTotal: number;
  total: number;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  codCollectedAt: string | null;
  cancelledAt: string | null;
  notDeliveredAt: string | null;
  items: Array<{
    productId: string;
    sku: string | null;
    name: string | null;
    brand: string | null;
    unit: string | null;
    packSize: number | null;
    imageUrl: string | null;
    qty: number;
    unitPrice: number;
    taxRatePct: number;
    lineTotal: number;
  }>;
  timeline: Array<{ status: PifOrderState; at: string; reason: string | null }>;
}

/** The server's product row, exactly as `PifController` sends it. */
interface ServerProduct {
  id: string;
  sku: string;
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
  discountPct: number | null;
  taxRateName: string | null;
  taxRatePct: number;
  imageUrl: string | null;
  available: boolean;
  minOrderQty: number;
  maxOrderQty: number | null;
  qtyStep: number;
  variantLabel: string | null;
}

/**
 * Server row → the shape the shared ProductCard and the cart already use.
 *
 * The only arithmetic is rupees → paise, because `Money` is in minor units
 * and a float rupee would be the wrong thing to carry. The price itself is
 * the server's figure, unchanged.
 */
export function toPifProduct(row: ServerProduct): PifProduct {
  return {
    id: row.id,
    categoryId: row.categoryId ?? '',
    name: row.name,
    unitLabel:
      row.packSize === null
        ? row.unit
        : `${row.packSize} ${row.packUnit ?? row.unit}`,
    imageUrl: mediaUrl(row.imageUrl) ?? undefined,
    inStock: row.available,
    price: { amountMinor: Math.round(row.price * 100), currency: 'INR' },
    sku: row.sku,
    brand: row.brand,
    description: row.description,
    categoryName: row.categoryName ?? row.parentCategoryName,
    packLabel: row.packSize === null ? null : `${row.packSize} ${row.packUnit ?? row.unit}`,
    taxRateName: row.taxRateName,
    taxRatePct: row.taxRatePct,
    discountPct: row.discountPct,
    minOrderQty: row.minOrderQty,
    maxOrderQty: row.maxOrderQty,
    qtyStep: row.qtyStep,
    variantLabel: row.variantLabel,
  };
}

export async function fetchPifCategories(signal?: AbortSignal): Promise<PifCategoryNode[]> {
  const rows = await apiRequest<
    Array<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      imageUrl: string | null;
      productCount: number;
      subcategories: Array<{
        id: string;
        name: string;
        slug?: string | null;
        imageUrl: string | null;
        productCount: number;
      }>;
    }>
  >('/pif/categories', { signal });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug ?? null,
    description: row.description,
    imageUrl: mediaUrl(row.imageUrl) ?? undefined,
    productCount: row.productCount,
    subcategories: row.subcategories.map((child) => ({
      id: child.id,
      name: child.name,
      slug: child.slug ?? null,
      imageUrl: mediaUrl(child.imageUrl) ?? undefined,
      productCount: child.productCount,
    })),
  }));
}

export async function fetchPifCategoryProducts(
  categoryId: string,
  page = 1,
  signal?: AbortSignal
): Promise<PifProductPage> {
  const body = await apiRequest<{ items: ServerProduct[]; total: number; page: number; pageSize: number }>(
    `/pif/categories/${categoryId}/products?page=${page}&pageSize=20`,
    { signal }
  );
  return { ...body, items: body.items.map(toPifProduct) };
}

export async function searchPifProducts(
  query: string,
  page = 1,
  signal?: AbortSignal
): Promise<PifProductPage> {
  const body = await apiRequest<{ items: ServerProduct[]; total: number; page: number; pageSize: number }>(
    `/pif/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=20`,
    { signal }
  );
  return { ...body, items: body.items.map(toPifProduct) };
}

/**
 * A page of available products for the home screen's "Popular in PIF" row.
 *
 * It is the SAME `/pif/search` route the search page uses, called with no
 * `q` at all — the controller reads `q ?? null`, so omitting it means "no
 * text filter" and the catalogue comes back in its own order. Nothing in
 * PIF was added or changed to serve this: a promotional row on the home
 * screen is not a reason to grow the PIF API.
 *
 * `availableOnly=true` because advertising something the customer cannot
 * then buy is worse than advertising nothing.
 *
 * NO PICTURE FILTER HERE, DELIBERATELY. Most products have no photograph
 * uploaded yet, and the showcase now falls back to the uploaded picture of
 * the category the product sits in (see design-system/ProductShowcase.tsx).
 * Filtering here would throw away products the row can perfectly well
 * illustrate. Deciding what a card can show is the component's job, because
 * only it holds the category pictures; this function's job is to return the
 * products.
 *
 * The caller asks for more than it needs, so that the handful with neither
 * their own picture nor a category one can be dropped without leaving the
 * row short.
 */
export async function fetchShowcaseProducts(limit = 12, signal?: AbortSignal): Promise<PifProduct[]> {
  const pageSize = Math.min(limit, 60);
  const body = await apiRequest<{ items: ServerProduct[] }>(
    `/pif/search?page=1&pageSize=${pageSize}&availableOnly=true`,
    { signal }
  );
  return body.items.map(toPifProduct);
}

export async function fetchPifProduct(
  productId: string,
  signal?: AbortSignal
): Promise<PifProductDetail> {
  const row = await apiRequest<ServerProduct & { variants: ServerProduct[] }>(
    `/pif/products/${productId}`,
    { signal }
  );
  return { ...toPifProduct(row), variants: row.variants.map(toPifProduct) };
}

/**
 * Price the cart. Sends ids, quantities and how the order would be fulfilled;
 * receives every figure.
 *
 * `fulfillmentMode` is sent because the delivery charge depends on it and
 * nothing else about it: store pickup is free, home delivery is free only at
 * or above the server's threshold. It selects a rule; it does not carry a
 * price. Every amount still comes back from the server.
 */
export function quoteCart(
  lines: Array<{ productId: string; qty: number }>,
  fulfillmentMode: 'PICKUP' | 'DELIVERY' = 'DELIVERY',
  signal?: AbortSignal
): Promise<QuoteResult> {
  return apiRequest<QuoteResult>('/pif/quote', {
    method: 'POST',
    body: { lines, fulfillmentMode },
    signal,
  });
}

/**
 * Place the order. Cash on delivery, and no payment is simulated anywhere.
 *
 * `idempotencyKey` is why a double tap, a retry or a flaky connection cannot
 * produce two orders: the second attempt is answered with the first order.
 */
export function placeOrder(body: {
  lines: Array<{ productId: string; qty: number }>;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  deliveryAddressId?: string | null;
  customerNote?: string | null;
  idempotencyKey: string;
}): Promise<{
  orderId: string;
  orderNumber: string;
  status: 'PLACED';
  total: number;
  paymentMethod: 'COD';
  duplicate: boolean;
}> {
  return apiRequest('/pif/checkout', { method: 'POST', body });
}

export function fetchMyPifOrders(signal?: AbortSignal): Promise<{ items: PifOrderListItem[] }> {
  return apiRequest('/pif/orders', { signal });
}

export function fetchMyPifOrder(orderId: string, signal?: AbortSignal): Promise<PifOrderDocument> {
  return apiRequest(`/pif/orders/${orderId}`, { signal });
}

// ------------------------------------------------------------------ display

/** The words a customer reads for each state. Display only. */
const STATE_WORDS: Readonly<Record<string, string>> = {
  PLACED: 'Order placed',
  ACCEPTED: 'Order confirmed',
  PREPARING: 'Being prepared',
  READY_PICKED: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  COD_COLLECTED: 'Delivered · paid',
  CANCELLED: 'Cancelled',
  NOT_DELIVERED: 'Could not be delivered',
};

export function orderStateWords(status: string): string {
  return STATE_WORDS[status] ?? status;
}

/** Rupees, as the customer reads them. */
export function rupees(amount: number): string {
  return `₹${amount.toFixed(2)}`;
}

/**
 * An image URL the browser can load.
 *
 * MOVED to lib/api/media-url.ts, because RIK provision pictures need exactly
 * the same two branches and a RIK screen must not import the PIF client to
 * get them. Re-exported here so every existing importer is unaffected; read
 * that module for why the `/catalogue/` branch exists.
 */
export { mediaUrl };

/**
 * A key for ONE checkout attempt.
 *
 * It is random, and the checkout screen holds the same one for as long as
 * that attempt lasts: pressing "Place order" twice, or retrying after a
 * dropped connection, sends the same key and cannot create a second order.
 * A key derived from the cart's contents would have been wrong in the other
 * direction — ordering the same basket again next week is a new order, not a
 * duplicate of the old one.
 */
export function newCheckoutKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `pif-${random}`;
}
