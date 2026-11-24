import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';

/**
 * PIF customer orders, their frozen lines, and their operational history
 * (PHASE F).
 *
 * THE ORDER'S STATUS IS NEVER WRITTEN HERE. `app_pif` holds SELECT and
 * INSERT on pif.orders and nothing else (migration 0050), so there is no
 * UPDATE to write: an operational state arrives by INSERTing a row into
 * pif.order_events, and a SECURITY DEFINER trigger projects it onto the
 * order. The status and the history therefore cannot disagree, and the
 * legality of each move is still decided by the Phase 2 trigger
 * pif.trg_validate_order_status_transition.
 *
 * AN ORDER LINE IS WRITTEN ONCE. pif.order_items carries the product's name,
 * SKU, unit, pack, price, tax rate and totals as they were at placement, and
 * a trigger refuses any later UPDATE or DELETE. A catalogue price change
 * cannot reach a placed order — not by policy, but because the number lives
 * in a row nothing may rewrite.
 *
 * These tables are PIF's own. Nothing here touches a RIK table, and nothing
 * in RIK touches these.
 */

export interface OrderRecord {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string | null;
  customer_mobile: string | null;
  status: string;
  fulfillment_mode: 'PICKUP' | 'DELIVERY';
  payment_method: string;
  delivery_address_id: string | null;
  delivery_address_snapshot: string | null;
  contact_name: string | null;
  contact_mobile: string | null;
  customer_note: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  delivery_total: string;
  total: string;
  cod_amount: string | null;
  placed_at: string | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  out_for_delivery_at: string | null;
  delivered_at: string | null;
  cod_collected_at: string | null;
  cancelled_at: string | null;
  not_delivered_at: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

/**
 * HOW AN INCOMING-ORDER ALERT IS ACKNOWLEDGED, and why it is a NOTE.
 *
 * "Received" means a staff member has SEEN the alert. It must not move the
 * order along its lifecycle -- not to ACCEPTED, not to PREPARING, not to
 * anything. pif.order_events already has the one event type that cannot:
 * a NOTE is constrained to `status IS NULL`, and pif.trg_apply_order_event
 * opens with `IF NEW.status IS NULL THEN RETURN NULL -- a NOTE records
 * words, never a state`. So the separation is enforced by the database
 * rather than by anyone remembering it.
 *
 * The marker below is the prefix that distinguishes an acknowledgement note
 * from a staff member's own words. It is written by the service and matched
 * here; nothing else should construct it.
 */
export const ORDER_ACK_MARKER = '[ACK]';
export const ORDER_ACK_NOTE = '[ACK] Incoming-order alert acknowledged';

/** A queue row: an order plus the two things only the order desk needs. */
export interface StaffQueueRecord extends OrderRecord {
  /** 'grocers' | 'fresh-mart' | 'mixed', or NULL when no item resolves one. */
  business_slug: string | null;
  acknowledged: boolean;
}

export interface OrderItemRecord {
  id: string;
  order_id: string;
  product_id: string;
  sku: string | null;
  product_name: string | null;
  brand: string | null;
  unit: string | null;
  pack_size: string | null;
  pack_unit: string | null;
  qty: string;
  unit_price: string;
  tax_rate_name: string | null;
  tax_rate_pct: string;
  discount_pct: string;
  line_subtotal: string;
  line_discount: string;
  line_tax: string;
  line_total: string;
  image_ref: string | null;
}

export interface OrderEventRecord {
  id: string;
  order_id: string;
  order_number: string;
  sequence_no: number;
  event_type: 'PLACEMENT' | 'STATUS' | 'COD' | 'NOTE';
  status: string | null;
  reason: string | null;
  recorded_at: string;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string;
  notes: string | null;
}

export interface OrderLineWrite {
  productId: string;
  sku: string;
  productName: string;
  brand: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
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

export interface OrderWrite {
  customerId: string;
  fulfillmentMode: 'PICKUP' | 'DELIVERY';
  deliveryAddressId: string | null;
  deliveryAddressSnapshot: string | null;
  contactName: string | null;
  contactMobile: string | null;
  customerNote: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /** The delivery charge: once per order, 0 for pickup. */
  deliveryTotal: number;
  total: number;
}

const ORDER_COLUMNS = `o.id, o.order_number, o.customer_id,
        coalesce(cu.official_name, cu.name) AS customer_name, cu.mobile_number AS customer_mobile,
        o.status, o.fulfillment_mode, o.payment_method,
        o.delivery_address_id, o.delivery_address_snapshot,
        o.contact_name, o.contact_mobile, o.customer_note,
        o.subtotal::text AS subtotal, o.discount_total::text AS discount_total,
        o.tax_total::text AS tax_total, o.delivery_total::text AS delivery_total,
        o.total::text AS total,
        o.cod_amount::text AS cod_amount,
        o.placed_at::text AS placed_at, o.accepted_at::text AS accepted_at,
        o.preparing_at::text AS preparing_at, o.ready_at::text AS ready_at,
        o.out_for_delivery_at::text AS out_for_delivery_at,
        o.delivered_at::text AS delivered_at,
        o.cod_collected_at::text AS cod_collected_at,
        o.cancelled_at::text AS cancelled_at,
        o.not_delivered_at::text AS not_delivered_at,
        o.created_at::text AS created_at, o.updated_at::text AS updated_at,
        (SELECT count(*) FROM pif.order_items i WHERE i.order_id = o.id)::int AS item_count`;

const ORDER_FROM = `FROM pif.orders o
        LEFT JOIN shared.customers cu ON cu.id = o.customer_id`;

/** The states a shopper may still be waiting on. */
export const OPEN_ORDER_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY_PICKED',
  'OUT_FOR_DELIVERY',
] as const;

@Injectable()
export class PifOrdersRepository {
  constructor(private readonly db: DatabaseService) {}

  // -------------------------------------------------------------------- reads

  async findById(id: string, client?: PoolClient): Promise<OrderRecord | null> {
    const rows = await this.run<OrderRecord>(
      `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1`,
      [id],
      client
    );
    return rows[0] ?? null;
  }

  /** One of THIS customer's orders. Someone else's reads as absent. */
  async findOwnById(customerId: string, id: string): Promise<OrderRecord | null> {
    const rows = await this.run<OrderRecord>(
      `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1 AND o.customer_id = $2`,
      [id, customerId]
    );
    return rows[0] ?? null;
  }

  async listForCustomer(customerId: string, limit = 50): Promise<OrderRecord[]> {
    return this.run<OrderRecord>(
      `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
        WHERE o.customer_id = $1
        ORDER BY o.created_at DESC
        LIMIT $2`,
      [customerId, limit]
    );
  }

  /** The staff queue. `openOnly` is what the order desk watches all day. */
  async listForStaff(filter: {
    status?: string | null;
    openOnly?: boolean;
    query?: string | null;
    limit: number;
    offset: number;
  }): Promise<{ items: StaffQueueRecord[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      params.push(filter.status);
      where.push(`o.status = $${params.length}`);
    } else if (filter.openOnly) {
      where.push(`o.status = ANY ('{${OPEN_ORDER_STATUSES.join(',')}}'::text[])`);
    }
    if (filter.query && filter.query.trim() !== '') {
      params.push(`%${filter.query.trim()}%`);
      const i = params.length;
      where.push(`(o.order_number ILIKE $${i} OR cu.name ILIKE $${i} OR cu.mobile_number ILIKE $${i})`);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const totals = await this.run<{ total: string }>(
      `SELECT count(*)::text AS total ${ORDER_FROM} ${clause}`,
      params
    );
    params.push(filter.limit, filter.offset);
    /*
     * TWO DERIVED COLUMNS, ON THIS QUERY ONLY.
     *
     * They are deliberately NOT in ORDER_COLUMNS, which findById,
     * listForCustomer and every customer-facing order read share: the order
     * desk needs them, a shopper does not, and adding them there would put
     * two correlated subqueries on screens that will never use them.
     *
     * business_slug: an order carries no business of its own -- the customer
     * has ONE PIF cart, not one per shop -- so it is derived from the
     * categories its items sit under. 'mixed' is an honest answer, not a
     * failure: an order really can hold items from both shops.
     *
     * acknowledged: whether an incoming-order alert has been marked Received.
     * Read from the NOTE events that already exist; see ORDER_ACK_MARKER.
     */
    const items = await this.run<StaffQueueRecord>(
      `SELECT ${ORDER_COLUMNS},
              (SELECT CASE
                        WHEN count(DISTINCT c.business_slug) = 0 THEN NULL
                        WHEN count(DISTINCT c.business_slug) > 1 THEN 'mixed'
                        ELSE min(c.business_slug)
                      END
                 FROM pif.order_items oi
                 JOIN pif.products pr ON pr.id = oi.product_id
                 LEFT JOIN pif.categories c ON c.id = pr.category_id
                WHERE oi.order_id = o.id) AS business_slug,
              EXISTS (SELECT 1 FROM pif.order_events e
                       WHERE e.order_id = o.id
                         AND e.event_type = 'NOTE'
                         AND e.notes LIKE '${ORDER_ACK_MARKER}%') AS acknowledged
         ${ORDER_FROM} ${clause}
        ORDER BY o.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return { items, total: Number(totals[0]!.total) };
  }

  /** How many orders are waiting — what the PIF dashboard's alert counts. */
  async countsByStatus(): Promise<Record<string, number>> {
    const rows = await this.run<{ status: string; total: string }>(
      `SELECT status, count(*)::text AS total FROM pif.orders GROUP BY status`
    );
    const out: Record<string, number> = {};
    for (const row of rows) out[row.status] = Number(row.total);
    return out;
  }

  async items(orderId: string, client?: PoolClient): Promise<OrderItemRecord[]> {
    return this.run<OrderItemRecord>(
      `SELECT i.id, i.order_id, i.product_id, i.sku, i.product_name, i.brand, i.unit,
              i.pack_size::text AS pack_size, i.pack_unit,
              i.qty::text AS qty, i.unit_price::text AS unit_price,
              i.tax_rate_name, i.tax_rate_pct::text AS tax_rate_pct,
              i.discount_pct::text AS discount_pct,
              i.line_subtotal::text AS line_subtotal, i.line_discount::text AS line_discount,
              i.line_tax::text AS line_tax, i.line_total::text AS line_total,
              p.image_ref
         FROM pif.order_items i
         LEFT JOIN pif.products p ON p.id = i.product_id
        WHERE i.order_id = $1
        ORDER BY i.product_name`,
      [orderId],
      client
    );
  }

  async events(orderId: string): Promise<OrderEventRecord[]> {
    return this.run<OrderEventRecord>(
      `SELECT e.id, e.order_id, e.order_number, e.sequence_no, e.event_type, e.status,
              e.reason, e.recorded_at::text AS recorded_at,
              e.recorded_by, u.display_name AS recorded_by_name, e.recorded_by_role, e.notes
         FROM pif.order_events e
         LEFT JOIN shared.users u ON u.id = e.recorded_by
        WHERE e.order_id = $1
        ORDER BY e.sequence_no`,
      [orderId]
    );
  }

  // ------------------------------------------------------------------- writes

  /**
   * The order number. Date-stamped and sequential within the day, in the
   * shape the facility already reads on a RIK voucher: PIF-YYYYMMDD-NNNN.
   * Taken inside the caller's transaction, from the rows that exist.
   */
  async nextOrderNumber(client: PoolClient): Promise<string> {
    const res = await client.query<{ order_number: string }>(
      `SELECT 'PIF-' || to_char(now(), 'YYYYMMDD') || '-' ||
              lpad((coalesce(max(substring(order_number from 14)::int), 0) + 1)::text, 4, '0')
                AS order_number
         FROM pif.orders
        WHERE order_number LIKE 'PIF-' || to_char(now(), 'YYYYMMDD') || '-%'`
    );
    return res.rows[0]!.order_number;
  }

  async insertOrder(client: PoolClient, orderNumber: string, write: OrderWrite): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO pif.orders
         (order_number, customer_id, status, fulfillment_mode, payment_method,
          delivery_address_id, delivery_address_snapshot, contact_name, contact_mobile,
          customer_note, subtotal, discount_total, tax_total, delivery_total,
          total, cod_amount)
       VALUES ($1,$2,'PLACED',$3,'COD',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING id`,
      [
        orderNumber,
        write.customerId,
        write.fulfillmentMode,
        write.deliveryAddressId,
        write.deliveryAddressSnapshot,
        write.contactName,
        write.contactMobile,
        write.customerNote,
        write.subtotal,
        write.discountTotal,
        write.taxTotal,
        write.deliveryTotal,
        // $13 is bound twice above: cod_amount IS the total, and the total now
        // includes delivery, so the cash the driver collects does too. That is
        // the whole of "COD must include delivery charges" - one parameter.
        write.total,
      ]
    );
    return res.rows[0]!.id;
  }

  async insertItem(client: PoolClient, orderId: string, line: OrderLineWrite): Promise<void> {
    await client.query(
      `INSERT INTO pif.order_items
         (order_id, product_id, sku, product_name, brand, unit, pack_size, pack_unit,
          qty, unit_price, tax_rate_name, tax_rate_pct, discount_pct,
          line_subtotal, line_discount, line_tax, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        orderId,
        line.productId,
        line.sku,
        line.productName,
        line.brand,
        line.unit,
        line.packSize,
        line.packUnit,
        line.qty,
        line.unitPrice,
        line.taxRateName,
        line.taxRatePct,
        line.discountPct,
        line.lineSubtotal,
        line.lineDiscount,
        line.lineTax,
        line.lineTotal,
      ]
    );
  }

  /**
   * Record an event — the ONLY way a status moves.
   *
   * The sequence number is computed inside the INSERT, from the rows that
   * exist at that moment, and `UNIQUE (order_id, sequence_no)` means two
   * callers racing for the same next number cannot both succeed.
   */
  async insertEvent(
    client: PoolClient,
    event: {
      orderId: string;
      orderNumber: string;
      eventType: 'PLACEMENT' | 'STATUS' | 'COD' | 'NOTE';
      status: string | null;
      reason: string | null;
      staffId: string | null;
      staffRole: string;
      notes: string | null;
    }
  ): Promise<string> {
    const res = await client.query<{ id: string }>(
      `INSERT INTO pif.order_events
         (order_id, order_number, sequence_no, event_type, status, reason,
          recorded_by, recorded_by_role, notes)
       VALUES ($1, $2,
               (SELECT coalesce(max(sequence_no), 0) + 1 FROM pif.order_events WHERE order_id = $1),
               $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        event.orderId,
        event.orderNumber,
        event.eventType,
        event.status,
        event.reason,
        event.staffId,
        event.staffRole,
        event.notes,
      ]
    );
    return res.rows[0]!.id;
  }

  /** Close the customer's open cart as part of the same transaction. */
  async checkOutCart(client: PoolClient, customerId: string): Promise<void> {
    await client.query(
      `UPDATE pif.carts SET status = 'CHECKED_OUT', updated_at = now()
        WHERE customer_id = $1 AND status = 'OPEN'`,
      [customerId]
    );
  }

  private async run<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
    client?: PoolClient
  ): Promise<T[]> {
    if (client) {
      const res = await client.query(sql, params);
      return res.rows as T[];
    }
    return this.db.query<T>(sql, params);
  }
}
