import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import type { AuthContext } from '../../auth/auth-context';
import { PifCatalogueRepository, type ProductRecord } from '../repositories/pif-catalogue.repository';
import {
  PifOrdersRepository,
  type OrderEventRecord,
  type OrderItemRecord,
  type OrderRecord,
  type StaffQueueRecord,
} from '../repositories/pif-orders.repository';
import {
  type PifFulfillmentMode,
  PifPricingService,
  type PricedLine,
} from './pif-pricing.service';

/**
 * PIF orders: placing one, and what the facility then does with it
 * (PHASE F).
 *
 * THE SHAPE OF THE WHOLE THING. A shopper's cart lives in their browser. At
 * checkout they send PRODUCT IDS AND QUANTITIES — and nothing else that
 * counts. This service reads each product from the catalogue, decides for
 * itself whether it can be ordered, prices it with PifPricingService, writes
 * the order and its frozen lines in one transaction, and records the
 * placement event. A price, total, tax figure or product name in the request
 * body is not trusted; it is not read at all.
 *
 * THE LIFECYCLE, and who may move it:
 *
 *   PLACED            the customer submitted it
 *   ACCEPTED          staff acknowledged it            `pif.order.manage`
 *   PREPARING         staff are picking it             `pif.order.prepare`
 *   READY_PICKED      packed, waiting for handover     `pif.order.prepare`
 *   OUT_FOR_DELIVERY  with the delivery staff          `pif.order.manage`
 *   DELIVERED         physically handed over           `pif.order.mark_delivered`
 *   COD_COLLECTED     cash taken at handover           `pif.order.manage`
 *   CANCELLED /       explicit failure, with a reason  `pif.order.manage` /
 *   NOT_DELIVERED                                      `pif.order.mark_not_delivered`
 *
 * The ORDER of those states is not this service's opinion: the Phase 2
 * trigger pif.trg_validate_order_status_transition has enforced it since the
 * schema was frozen, and the projection's UPDATE passes through it. What
 * this service adds is the pre-check that turns a refusal into a sentence a
 * staff member can read, and the authority check that says who may ask.
 *
 * NOTHING IS EVER INFERRED. A status moves because a named person recorded
 * it. No elapsed time, no customer app activity and no scheduled job
 * completes an order, and `DELIVERED` in particular is only ever written by
 * someone with the permission to say that the goods changed hands.
 *
 * COD, AND THE BILLING BOUNDARY. The order records its own amounts — the
 * shopper must know what to have ready, and the staff what to collect — and
 * `COD_COLLECTED` records that the cash was taken, by whom and when. That is
 * the end of this module's involvement with money: no bill, no invoice, no
 * receipt, no tax document, no cash drawer, no accounting. The facility's
 * existing billing software does all of that, and `SALE_FINALIZED` is left
 * unused precisely because nothing here may claim a sale was booked in a
 * system this application cannot see.
 */

export type OrderErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'EMPTY_CART'
  | 'PRODUCT_UNAVAILABLE'
  | 'INVALID_QUANTITY'
  | 'ADDRESS_REQUIRED'
  | 'ADDRESS_NOT_FOUND'
  | 'ILLEGAL_TRANSITION'
  | 'REASON_REQUIRED'
  | 'ALREADY_FINISHED'
  | 'DUPLICATE_REQUEST'
  | 'NOT_PERMITTED';

export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface CheckoutRequest {
  /** The only thing a client contributes to the arithmetic. */
  lines: Array<{ productId: string; qty: number }>;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  deliveryAddressId?: string | null;
  customerNote?: string | null;
  /** Optional, and the reason a double tap cannot produce two orders. */
  idempotencyKey?: string | null;
}

export interface QuoteRefusal {
  productId: string;
  reason: OrderErrorCode;
  message: string;
}

export interface QuoteResult {
  priced: PricedLine[];
  refused: QuoteRefusal[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /** subtotal - discountTotal + taxTotal: the goods, before delivery. */
  merchandiseTotal: number;
  /** The delivery charge on this quote: 0 or the fee, once per order. */
  deliveryTotal: number;
  freeDelivery: boolean;
  /** The fee and the threshold, so no screen hard-codes either number. */
  deliveryFee: number;
  deliveryThreshold: number;
  amountToFreeDelivery: number;
  total: number;
}

export interface OrderView {
  order: OrderRecord;
  items: OrderItemRecord[];
  events: OrderEventRecord[];
}

/** Which permission each operational move requires. Server-side, always. */
const REQUIRED_PERMISSION: Readonly<Record<string, string>> = {
  ACCEPTED: 'pif.order.manage',
  PREPARING: 'pif.order.prepare',
  READY_PICKED: 'pif.order.prepare',
  OUT_FOR_DELIVERY: 'pif.order.manage',
  DELIVERED: 'pif.order.mark_delivered',
  NOT_DELIVERED: 'pif.order.mark_not_delivered',
  COD_COLLECTED: 'pif.order.manage',
  CANCELLED: 'pif.order.manage',
};

/** The legal next states, mirroring the database's own trigger. */
const LEGAL_NEXT: Readonly<Record<string, readonly string[]>> = {
  PLACED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_PICKED', 'CANCELLED'],
  READY_PICKED: ['OUT_FOR_DELIVERY', 'CANCELLED', 'NOT_DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'NOT_DELIVERED', 'CANCELLED'],
  DELIVERED: ['COD_COLLECTED'],
  COD_COLLECTED: [],
  SALE_FINALIZED: [],
  CANCELLED: [],
  NOT_DELIVERED: [],
};

const NEEDS_REASON = ['CANCELLED', 'NOT_DELIVERED'];
const FINISHED = ['COD_COLLECTED', 'SALE_FINALIZED', 'CANCELLED', 'NOT_DELIVERED'];

@Injectable()
export class PifOrderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: PifOrdersRepository,
    private readonly catalogue: PifCatalogueRepository,
    private readonly pricing: PifPricingService,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ------------------------------------------------------------------ reading

  /** What a shopper may see of their own order. */
  async customerView(customerId: string, orderId: string): Promise<OrderView> {
    const order = await this.orders.findOwnById(customerId, orderId);
    if (order === null) {
      throw new OrderError('ORDER_NOT_FOUND', 'That order does not exist.');
    }
    return {
      order,
      items: await this.orders.items(order.id),
      events: await this.orders.events(order.id),
    };
  }

  /** The shopper's own order history. */
  async listForCustomer(customerId: string): Promise<OrderRecord[]> {
    return this.orders.listForCustomer(customerId);
  }

  /** The staff queue, and the counts the PIF dashboard shows. */
  async staffQueue(filter: {
    status?: string | null;
    openOnly?: boolean;
    query?: string | null;
    page: number;
    pageSize: number;
  }): Promise<{ items: StaffQueueRecord[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(filter.pageSize, 1), 100);
    const page = Math.max(filter.page, 1);
    const { items, total } = await this.orders.listForStaff({
      status: filter.status ?? null,
      openOnly: filter.openOnly ?? false,
      query: filter.query ?? null,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return { items, total, page, pageSize };
  }

  async statusCounts(): Promise<Record<string, number>> {
    return this.orders.countsByStatus();
  }

  async staffView(orderId: string): Promise<OrderView> {
    const order = await this.orders.findById(orderId);
    if (order === null) {
      throw new OrderError('ORDER_NOT_FOUND', 'That order does not exist.');
    }
    return {
      order,
      items: await this.orders.items(order.id),
      events: await this.orders.events(order.id),
    };
  }

  /**
   * Re-price a cart without ordering anything: what the checkout screen
   * shows, and what proves the figures are the server's.
   *
   * Returns the refusals too, so the screen can say "Tomatoes are out of
   * stock today" instead of failing with nothing to show.
   *
   * `fulfillmentMode` defaults to DELIVERY: the cart screen cannot ask, and
   * quoting the charged case is the honest default - a shopper who then
   * chooses pickup watches the charge go away, which is a better surprise
   * than a fee appearing at checkout.
   */
  async quote(
    lines: Array<{ productId: string; qty: number }>,
    fulfillmentMode: PifFulfillmentMode = 'DELIVERY'
  ): Promise<QuoteResult> {
    const priced: PricedLine[] = [];
    const refused: QuoteRefusal[] = [];

    for (const line of lines) {
      const product = await this.catalogue.findPublicProduct(line.productId);
      if (product === null) {
        refused.push({
          productId: line.productId,
          reason: 'PRODUCT_UNAVAILABLE',
          message: 'This product is no longer in the catalogue.',
        });
        continue;
      }
      try {
        this.requireOrderable(product, line.qty);
        priced.push(this.pricing.priceLine(product, line.qty));
      } catch (err) {
        if (err instanceof OrderError) {
          refused.push({ productId: line.productId, reason: err.code, message: err.message });
          continue;
        }
        throw err;
      }
    }

    const totals = this.pricing.totals(priced, fulfillmentMode);
    return {
      priced: totals.lines,
      refused,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      merchandiseTotal: totals.merchandiseTotal,
      deliveryTotal: totals.deliveryTotal,
      freeDelivery: totals.freeDelivery,
      deliveryFee: totals.deliveryFee,
      deliveryThreshold: totals.deliveryThreshold,
      amountToFreeDelivery: totals.amountToFreeDelivery,
      total: totals.total,
    };
  }

  // ----------------------------------------------------------------- checkout

  /**
   * Place an order.
   *
   * ONE TRANSACTION: the order header, every frozen line, the cart's closure
   * and the placement event are one atomic write. The deferred constraint
   * trigger `order_totals_agree` compares the header to the sum of its lines
   * at commit, so a partially-written or mis-totalled order cannot exist.
   *
   * DUPLICATE PROTECTION: an idempotency key is claimed in
   * shared.idempotency_keys inside the same transaction, against a UNIQUE
   * index. A double tap, a retried request or two taps on two devices
   * therefore produce ONE order — the second attempt loses the insert and is
   * answered with the first order rather than a new one.
   */
  async checkout(
    customerId: string,
    request: CheckoutRequest
  ): Promise<{ orderId: string; orderNumber: string; total: number; duplicate: boolean }> {
    if (request.lines.length === 0) {
      throw new OrderError('EMPTY_CART', 'There is nothing in the cart to order.');
    }

    // Collapse repeated ids rather than writing two lines for one product:
    // pif.order_items has UNIQUE (order_id, product_id) and a tap-happy
    // client should get the quantity it means, not a constraint violation.
    const wanted = new Map<string, number>();
    for (const line of request.lines) {
      wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.qty);
    }

    // EVERYTHING BELOW IS READ AND VALIDATED BEFORE THE TRANSACTION OPENS.
    // DatabaseService.withTransaction replaces any error escaping it with a
    // generic SafeDatabaseError, which is right for driver detail and wrong
    // for "tomatoes are unavailable" — the shopper has to read that.
    const priced: PricedLine[] = [];
    for (const [productId, qty] of wanted) {
      const product = await this.catalogue.findPublicProduct(productId);
      if (product === null) {
        throw new OrderError(
          'PRODUCT_UNAVAILABLE',
          'One of the items is no longer in the catalogue. Please review your cart.',
          { productId }
        );
      }
      this.requireOrderable(product, qty);
      priced.push(this.pricing.priceLine(product, qty));
    }
    const totals = this.pricing.totals(priced, request.fulfillmentMode);

    const { addressId, addressSnapshot, contactName, contactMobile } = await this.resolveDestination(
      customerId,
      request.fulfillmentMode,
      request.deliveryAddressId ?? null
    );

    const key = request.idempotencyKey?.trim() || null;
    if (key !== null) {
      const existing = await this.db.query<{ response_snapshot: { orderId?: string } | null }>(
        `SELECT response_snapshot FROM shared.idempotency_keys
          WHERE idempotency_key = $1 AND endpoint = 'POST /pif/checkout'`,
        [key]
      );
      const previous = existing[0]?.response_snapshot?.orderId;
      if (previous !== undefined) {
        const order = await this.orders.findOwnById(customerId, previous);
        if (order !== null) {
          return {
            orderId: order.id,
            orderNumber: order.order_number,
            total: Number(order.total),
            duplicate: true,
          };
        }
      }
    }

    const placed: { orderId: string; orderNumber: string; duplicate: boolean } = await this.db
      .withTransaction(async (client) => {
      const orderNumber = await this.orders.nextOrderNumber(client);
      const orderId = await this.orders.insertOrder(client, orderNumber, {
        customerId,
        fulfillmentMode: request.fulfillmentMode,
        deliveryAddressId: addressId,
        deliveryAddressSnapshot: addressSnapshot,
        contactName,
        contactMobile,
        customerNote: request.customerNote?.trim() || null,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        // Once per order. A PICKUP order is always 0, which the database
        // enforces as well (pif_orders_delivery_mode_chk).
        deliveryTotal: totals.deliveryTotal,
        total: totals.total,
      });

      for (const line of priced) {
        await this.orders.insertItem(client, orderId, line);
      }

      await this.orders.checkOutCart(client, customerId);

      await this.orders.insertEvent(client, {
        orderId,
        orderNumber,
        eventType: 'PLACEMENT',
        status: 'PLACED',
        reason: null,
        staffId: customerId,
        staffRole: 'CUSTOMER',
        notes: null,
      });

      if (key !== null) {
        // Inside the same transaction and against a UNIQUE index: if a second
        // request is racing this one, exactly one of them can claim the key.
        await client.query(
          `INSERT INTO shared.idempotency_keys (idempotency_key, endpoint, principal_id, response_snapshot)
           VALUES ($1, 'POST /pif/checkout', $2, $3::jsonb)`,
          [key, customerId, JSON.stringify({ orderId, orderNumber })]
        );
      }

        return { orderId, orderNumber, duplicate: false };
      })
      .catch(async (err: unknown) => {
        // The loser of a genuine race: the key is already claimed, so the
        // winner's order is the answer — not an error, and certainly not a
        // second order.
        if (key !== null) {
          const existing = await this.db.query<{ response_snapshot: { orderId?: string } | null }>(
            `SELECT response_snapshot FROM shared.idempotency_keys
              WHERE idempotency_key = $1 AND endpoint = 'POST /pif/checkout'`,
            [key]
          );
          const previous = existing[0]?.response_snapshot?.orderId;
          if (previous !== undefined) {
            const order = await this.orders.findOwnById(customerId, previous);
            if (order !== null) {
              return { orderId: order.id, orderNumber: order.order_number, duplicate: true };
            }
            // The key is claimed, but by somebody else's order. That is not a
            // duplicate of THIS customer's request and must not be answered
            // with another customer's order number — it is refused.
            throw new OrderError(
              'DUPLICATE_REQUEST',
              'That checkout reference has already been used. Please try again.'
            );
          }
        }
        throw err;
      });

    if (placed.duplicate) {
      // Nothing was written, so nothing is audited: the first placement
      // already has its own audit entry and its own placement event.
      return {
        orderId: placed.orderId,
        orderNumber: placed.orderNumber,
        total: totals.total,
        duplicate: true,
      };
    }

    await this.auditLog.logEvent({
      actorId: customerId,
      actorRole: 'CUSTOMER',
      module: 'pif',
      action: 'PIF_ORDER_PLACED',
      entityType: 'pif.order',
      entityId: placed.orderId,
      after: {
        orderNumber: placed.orderNumber,
        lines: priced.length,
        total: totals.total,
        fulfillmentMode: request.fulfillmentMode,
        paymentMethod: 'COD',
      },
    });

    return {
      orderId: placed.orderId,
      orderNumber: placed.orderNumber,
      total: totals.total,
      duplicate: false,
    };
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Record an operational move. The only way an order's status changes.
   *
   * The permission is checked here, from the live context — never from the
   * navigation, never from the role's name. DELIVERY_STAFF, for instance,
   * holds `pif.order.mark_delivered` and so may complete a delivery, and
   * holds nothing that lets it accept, prepare or cancel one.
   */
  async recordStatus(
    context: AuthContext,
    orderId: string,
    input: { status: string; reason?: string | null; notes?: string | null }
  ): Promise<{ eventId: string; status: string }> {
    const order = await this.orders.findById(orderId);
    if (order === null) {
      throw new OrderError('ORDER_NOT_FOUND', 'That order does not exist.');
    }

    const required = REQUIRED_PERMISSION[input.status];
    if (required === undefined) {
      throw new OrderError('ILLEGAL_TRANSITION', `${input.status} is not an operational state.`);
    }
    if (!context.permissions.has(required)) {
      throw new OrderError(
        'NOT_PERMITTED',
        `Recording ${input.status} requires ${required}.`,
        { required }
      );
    }

    if (FINISHED.includes(order.status)) {
      throw new OrderError(
        'ALREADY_FINISHED',
        `Order ${order.order_number} is already ${order.status}.`,
        { status: order.status }
      );
    }
    const legal = LEGAL_NEXT[order.status] ?? [];
    if (!legal.includes(input.status)) {
      throw new OrderError(
        'ILLEGAL_TRANSITION',
        `Order ${order.order_number} is ${order.status}; the next step can only be ${legal.join(' or ') || 'nothing'}.`,
        { from: order.status, to: input.status, legal }
      );
    }
    if (NEEDS_REASON.includes(input.status) && !input.reason?.trim()) {
      throw new OrderError(
        'REASON_REQUIRED',
        `Recording ${input.status} requires a reason, in words.`
      );
    }

    const staffRole = [...context.roles].sort().join(',') || 'STAFF';
    const eventId = await this.db
      .withTransaction((client) =>
        this.orders.insertEvent(client, {
          orderId: order.id,
          orderNumber: order.order_number,
          eventType: input.status === 'COD_COLLECTED' ? 'COD' : 'STATUS',
          status: input.status,
          reason: input.reason?.trim() || null,
          staffId: context.principalId,
          staffRole,
          notes: input.notes?.trim() || null,
        })
      )
      .catch(async (err: unknown) => {
        // Two staff members pressing the same button in the same instant:
        // one wins the UNIQUE (order_id, sequence_no), and the loser is told
        // what actually happened rather than handed a 500.
        const now = await this.orders.findById(order.id);
        if (now !== null && now.status !== order.status) {
          throw new OrderError(
            'ILLEGAL_TRANSITION',
            `Order ${order.order_number} has moved to ${now.status} in the meantime.`,
            { from: order.status, current: now.status }
          );
        }
        throw err;
      });

    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: staffRole,
      module: 'pif',
      action: `PIF_ORDER_${input.status}`,
      entityType: 'pif.order',
      entityId: order.id,
      before: { status: order.status },
      after: {
        status: input.status,
        orderNumber: order.order_number,
        reason: input.reason?.trim() || null,
        eventId,
      },
    });

    return { eventId, status: input.status };
  }

  /** A note on an order: words only, no state, same append-only history. */
  async addNote(context: AuthContext, orderId: string, note: string): Promise<string> {
    const order = await this.orders.findById(orderId);
    if (order === null) {
      throw new OrderError('ORDER_NOT_FOUND', 'That order does not exist.');
    }
    if (!context.permissions.has('pif.order.prepare') && !context.permissions.has('pif.order.manage')) {
      throw new OrderError('NOT_PERMITTED', 'Adding a note requires a PIF order permission.');
    }
    if (note.trim().length < 3) {
      throw new OrderError('REASON_REQUIRED', 'A note needs something in it.');
    }
    const staffRole = [...context.roles].sort().join(',') || 'STAFF';
    return this.db.withTransaction((client) =>
      this.orders.insertEvent(client, {
        orderId: order.id,
        orderNumber: order.order_number,
        eventType: 'NOTE',
        status: null,
        reason: null,
        staffId: context.principalId,
        staffRole,
        notes: note.trim(),
      })
    );
  }

  /** What the next step may be, for a screen that must offer only the legal ones. */
  nextSteps(status: string): readonly string[] {
    return LEGAL_NEXT[status] ?? [];
  }

  // ------------------------------------------------------------------- guards

  /**
   * May this product be ordered, in this quantity, right now?
   *
   * `active` is the catalogue decision, `available` the day's decision, and
   * the quantity rules are the administrator's. None of them is a stock
   * count — PIF holds no quantity on hand.
   */
  private requireOrderable(product: ProductRecord, qty: number): void {
    if (!product.active) {
      throw new OrderError(
        'PRODUCT_UNAVAILABLE',
        `"${product.name}" is not in the catalogue.`,
        { productId: product.id }
      );
    }
    if (!product.available) {
      throw new OrderError(
        'PRODUCT_UNAVAILABLE',
        `"${product.name}" is out of stock today.`,
        { productId: product.id }
      );
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new OrderError('INVALID_QUANTITY', 'A quantity must be greater than zero.', {
        productId: product.id,
      });
    }
    const min = Number(product.min_order_qty);
    const step = Number(product.qty_step);
    const max = product.max_order_qty === null ? null : Number(product.max_order_qty);

    if (qty < min) {
      throw new OrderError(
        'INVALID_QUANTITY',
        `"${product.name}" is sold in a minimum of ${min} ${product.unit}.`,
        { productId: product.id, min }
      );
    }
    if (max !== null && qty > max) {
      throw new OrderError(
        'INVALID_QUANTITY',
        `"${product.name}" is limited to ${max} ${product.unit} per order.`,
        { productId: product.id, max }
      );
    }
    // The step is the administrator's packaging: 0.5 kg steps mean 1.25 kg
    // is not a quantity the facility can pick.
    const steps = (qty - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      throw new OrderError(
        'INVALID_QUANTITY',
        `"${product.name}" is sold in steps of ${step} ${product.unit}.`,
        { productId: product.id, step, min }
      );
    }
  }

  /**
   * Where the order is going. A delivery order must carry one of THIS
   * customer's own addresses, frozen as text so a later edit of the saved
   * address cannot rewrite a placed order. (The database checks the
   * ownership too — migration 0050's `order_address_valid`.)
   */
  private async resolveDestination(
    customerId: string,
    mode: 'PICKUP' | 'DELIVERY',
    addressId: string | null
  ): Promise<{
    addressId: string | null;
    addressSnapshot: string | null;
    contactName: string | null;
    contactMobile: string | null;
  }> {
    const customers = await this.db.query<{ name: string; official_name: string | null; mobile_number: string }>(
      `SELECT name, official_name, mobile_number FROM shared.customers WHERE id = $1`,
      [customerId]
    );
    const customer = customers[0];
    const contactName = customer ? (customer.official_name ?? customer.name) : null;
    const contactMobile = customer?.mobile_number ?? null;

    if (mode === 'PICKUP') {
      return { addressId: null, addressSnapshot: null, contactName, contactMobile };
    }

    if (addressId === null) {
      // Fall back to the customer's default address, which is what the app
      // shows them; if they have none, say so rather than guessing.
      const defaults = await this.db.query<{ id: string }>(
        `SELECT id FROM shared.customer_addresses WHERE customer_id = $1 AND is_default`,
        [customerId]
      );
      const fallback = defaults[0]?.id;
      if (fallback === undefined) {
        throw new OrderError(
          'ADDRESS_REQUIRED',
          'A delivery order needs a delivery address. Please add one to your profile.'
        );
      }
      addressId = fallback;
    }

    const rows = await this.db.query<{
      quarter_block: string;
      quarter_number: string;
      landmark: string | null;
      label: string | null;
    }>(
      `SELECT quarter_block, quarter_number, landmark, label
         FROM shared.customer_addresses WHERE id = $1 AND customer_id = $2`,
      [addressId, customerId]
    );
    const address = rows[0];
    if (address === undefined) {
      throw new OrderError('ADDRESS_NOT_FOUND', 'That delivery address is not yours.');
    }

    /*
     * THE CUSTOMER'S OWN ADDRESS, AND NOTHING ELSE.
     *
     * The three parts are the ones the customer actually supplied: the label
     * they gave it, the quarter, and a landmark if they wrote one. A fixed
     * organisation and city used to be appended to every snapshot; it is not,
     * because it was the same words on every order and told the driver
     * nothing their own quarters do not already say.
     *
     * The filter and the join are UNCHANGED on purpose: a null label or a
     * blank landmark is dropped rather than printed as an empty segment, so
     * an address with no landmark still reads "Home, F-401" and never
     * "Home, F-401, ".
     *
     * This affects only orders placed from now on. A snapshot is frozen onto
     * the order when it is placed, which is the whole point of taking one, so
     * every existing order keeps the text it was placed with.
     */
    const snapshot = [
      address.label,
      `${address.quarter_block}-${address.quarter_number}`,
      address.landmark,
    ]
      .filter((part): part is string => part !== null && part.trim() !== '')
      .join(', ');

    return { addressId, addressSnapshot: snapshot, contactName, contactMobile };
  }
}
