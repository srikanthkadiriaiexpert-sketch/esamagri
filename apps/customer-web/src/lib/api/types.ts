/**
 * Frontend data-shape contracts for RIK/PIF screens (STEP 8 — UI
 * foundation only).
 *
 * IMPORTANT — provisional, not a backend contract: apps/api has no
 * RIK/PIF catalog, entitlement, cart, order, or announcement module
 * yet (those are explicitly out of scope for STEP 8, and for STEP 7
 * before it — see the STEP 7 report). These types describe what the
 * UI *renders*, inferred from the STEP 8 kickoff's field lists
 * (Sections 5, 6, 9, 12, 14, 16). They are NOT generated from, and
 * must not be assumed to match, the eventual real RIK/PIF API
 * response shapes — those will be defined together with the backend
 * modules that produce them, most likely in @esamagri/shared-types so
 * both sides share one definition the way STEP 6/7's auth types
 * already do. Until each module exists, screens render honest
 * empty/not-implemented states — there is no fixture data in the app.
 * these types are populated with data, and every screen that reads
 * them must be able to render "not available yet" instead (see
 * `src/lib/api/resource.ts`).
 */

export type Money = {
  /** Minor units (paise) — never a float. */
  amountMinor: number;
  currency: 'INR';
};

export interface CategorySummary {
  id: string;
  name: string;
  imageUrl?: string;
  productCount?: number;
}

export interface RikEntitlementInfo {
  category: string;
  unit: string;
  allowedQty: number;
  issuedQty: number;
  reservedQty: number;
  remainingQty: number;
  alternatives?: Array<{ productId: string; productName: string; conversionNote?: string }>;
}

export interface RikProduct {
  id: string;
  categoryId: string;
  name: string;
  unitLabel: string;
  imageUrl?: string;
  inStock: boolean;
  entitlement?: RikEntitlementInfo;
}

export interface PifProduct {
  id: string;
  categoryId: string;
  name: string;
  unitLabel: string;
  imageUrl?: string;
  inStock: boolean;
  price: Money;
  mrp?: Money;
  /**
   * PHASE F — what the real PIF catalogue carries, filled by
   * `lib/api/pif-api.ts` from the server's own row. Optional because the
   * shared ProductCard needs none of it, and because the two cart-separation
   * tests construct a minimal product.
   *
   * There is no stock quantity here, and there is not meant to be:
   * `inStock` mirrors the administrator's availability switch for the day.
   */
  sku?: string;
  brand?: string | null;
  description?: string | null;
  categoryName?: string | null;
  packLabel?: string | null;
  taxRateName?: string | null;
  taxRatePct?: number;
  discountPct?: number | null;
  minOrderQty?: number;
  maxOrderQty?: number | null;
  qtyStep?: number;
  variantLabel?: string | null;
}

export type FulfilmentMethod = 'PICKUP' | 'DELIVERY';

export type RikOrderStatus = 'CONFIRMED' | 'READY_FOR_PICKUP' | 'OUT_FOR_DELIVERY' | 'COLLECTED' | 'DELIVERED' | 'NOT_COLLECTED';
/**
 * PHASE F — the PIF order states as the DATABASE defines them.
 *
 * This type used to read 'CONFIRMED' | 'PREPARING' | 'READY' | … , which was
 * a provisional guess made before the order engine existed and did not match
 * pif.orders' own CHECK constraint. It is now the real set, so a screen
 * cannot be written against a state the server will never send.
 */
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

export interface OrderSummary {
  id: string;
  placedAt: string;
  itemCount: number;
  total?: Money;
  status: RikOrderStatus | PifOrderStatus;
  fulfilmentMethod: FulfilmentMethod;
}

export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type AnnouncementAudience = 'ALL' | 'RIK' | 'PIF';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  priority: AnnouncementPriority;
  audience: AnnouncementAudience;
  publishedAt: string;
  dismissible: boolean;
}
