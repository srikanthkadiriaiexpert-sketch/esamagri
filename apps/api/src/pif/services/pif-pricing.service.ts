import { Injectable } from '@nestjs/common';
import type { ProductRecord } from '../repositories/pif-catalogue.repository';

/**
 * The single authority on what a PIF order costs (PHASE F).
 *
 * WHY THIS IS ITS OWN SERVICE. Every price, discount, tax figure, delivery
 * charge and total in this module is produced here, from the catalogue row,
 * the requested quantity and the fulfillment mode — and from nothing else. In
 * particular NOTHING A CLIENT SENDS takes part: the cart in the customer's
 * browser may post product ids, quantities and whether the order is for
 * delivery or pickup, and that is all it is allowed to contribute. A posted
 * price or delivery charge is not merely ignored, it is not even read (see
 * PifOrderService.checkout).
 *
 * THE ARITHMETIC, in the order the facility would do it on paper:
 *
 *   line subtotal  = quantity × selling price            (rounded to paise)
 *   line discount  = subtotal × discount %               (rounded to paise)
 *   taxable        = subtotal − discount
 *   line tax       = taxable × GST %                     (rounded to paise)
 *   line total     = subtotal − discount + tax
 *
 *   merchandise    = subtotal − discount + tax           (the whole order)
 *   delivery       = 0 for pickup, 0 at or above the threshold, else the fee
 *   order total    = merchandise + delivery
 *
 * Tax is charged on the discounted amount, which is how GST works on a
 * trade discount shown on the invoice.
 *
 * Rounding happens at each LINE, never once at the end, so the order total
 * is exactly the sum of the lines the customer can see plus the one delivery
 * figure — and the database's own CHECK constraints and deferred totals
 * trigger enforce that same identity, so a disagreement cannot be committed.
 *
 * THE DELIVERY RULE, and what it is measured on. Home delivery below the
 * threshold costs the fee; at or above it, and for store pickup, it is free.
 * ONE fee per order, never one per business — a cart holding both Grocers and
 * Fresh Mart items is one order and is charged once, which falls out of this
 * being computed on the order's totals rather than on any grouping of lines.
 *
 * Eligibility is tested on MERCHANDISE TOTAL — subtotal − discount + tax —
 * which is what the customer actually pays for goods, BEFORE the delivery
 * charge. Testing it on the pre-discount subtotal would give free delivery on
 * an order the facility was paid less for; testing it on the final total
 * would make the charge decide its own threshold. Because delivery is
 * excluded by construction there is no circularity, and because the figure
 * is a sum of line amounts already rounded to paise, the comparison at the
 * threshold is exact rather than a floating-point near-miss.
 *
 * THE FEE AND THE THRESHOLD ARE CONSTANTS HERE, and they are also RETURNED,
 * so no screen has to hard-code "₹20" or "₹499" and then drift from this
 * file. Changing the policy is a change to these two numbers and nothing
 * else — no migration, because the database stores the resulting charge
 * rather than the rule.
 */

/** The home-delivery charge, in rupees, when the order does not qualify. */
export const PIF_DELIVERY_FEE = 20;
/** Merchandise total at or above which home delivery is free, in rupees. */
export const PIF_FREE_DELIVERY_THRESHOLD = 499;

/** How the order reaches the customer. The two values pif.orders accepts. */
export type PifFulfillmentMode = 'PICKUP' | 'DELIVERY';

export interface PricedLine {
  productId: string;
  sku: string;
  productName: string;
  brand: string | null;
  unit: string;
  packSize: number | null;
  packUnit: string | null;
  imageRef: string | null;
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

export interface PricedOrder {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  /**
   * subtotal − discountTotal + taxTotal: what the goods cost, and the figure
   * the free-delivery threshold is tested against. Stored nowhere, because it
   * is always recoverable from a saved order as (total − delivery_total).
   */
  merchandiseTotal: number;
  /** The charge on this order: 0 or the fee. Once per order, never per shop. */
  deliveryTotal: number;
  /** True when no charge applies — pickup, or merchandise at/above threshold. */
  freeDelivery: boolean;
  /** The fee that WOULD apply, so a screen can name it without hard-coding. */
  deliveryFee: number;
  /** The threshold, for the same reason. */
  deliveryThreshold: number;
  /** How much more merchandise would make delivery free; 0 when it already is. */
  amountToFreeDelivery: number;
  total: number;
}

/** Paise, not floats: every money figure is rounded to two decimals. */
export function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

@Injectable()
export class PifPricingService {
  /** One line, priced from the catalogue row as it stands right now. */
  priceLine(product: ProductRecord, qty: number): PricedLine {
    const unitPrice = Number(product.selling_price);
    const discountPct = product.discount_pct === null ? 0 : Number(product.discount_pct);
    const taxRatePct = product.tax_rate_pct === null ? 0 : Number(product.tax_rate_pct);

    const lineSubtotal = money(qty * unitPrice);
    const lineDiscount = money((lineSubtotal * discountPct) / 100);
    const lineTax = money(((lineSubtotal - lineDiscount) * taxRatePct) / 100);
    const lineTotal = money(lineSubtotal - lineDiscount + lineTax);

    return {
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      brand: product.brand,
      unit: product.unit,
      packSize: product.pack_size === null ? null : Number(product.pack_size),
      packUnit: product.pack_unit,
      imageRef: product.image_ref,
      qty,
      unitPrice,
      taxRateName: product.tax_rate_name,
      taxRatePct,
      discountPct,
      lineSubtotal,
      lineDiscount,
      lineTax,
      lineTotal,
    };
  }

  /**
   * The order's own totals: the sum of its lines, plus the one delivery
   * figure the lines cannot carry.
   *
   * `fulfillmentMode` is REQUIRED rather than defaulted. A default would mean
   * a caller that forgot to pass it still got an answer, and that answer would
   * silently be wrong about money. Both call sites — the quote and the
   * checkout — name it explicitly, and the compiler refuses any that does not.
   */
  totals(lines: PricedLine[], fulfillmentMode: PifFulfillmentMode): PricedOrder {
    const subtotal = money(lines.reduce((sum, l) => sum + l.lineSubtotal, 0));
    const discountTotal = money(lines.reduce((sum, l) => sum + l.lineDiscount, 0));
    const taxTotal = money(lines.reduce((sum, l) => sum + l.lineTax, 0));
    const merchandiseTotal = money(subtotal - discountTotal + taxTotal);

    /*
     * An empty cart is free to deliver because there is nothing to deliver.
     * Checkout refuses an empty cart outright, so this only affects a quote
     * for a basket the shopper has just emptied — and charging ₹20 to carry
     * nothing would be absurd on screen.
     */
    const empty = lines.length === 0;
    const freeDelivery =
      empty || fulfillmentMode === 'PICKUP' || merchandiseTotal >= PIF_FREE_DELIVERY_THRESHOLD;
    const deliveryTotal = freeDelivery ? 0 : PIF_DELIVERY_FEE;

    return {
      lines,
      subtotal,
      discountTotal,
      taxTotal,
      merchandiseTotal,
      deliveryTotal,
      freeDelivery,
      deliveryFee: PIF_DELIVERY_FEE,
      deliveryThreshold: PIF_FREE_DELIVERY_THRESHOLD,
      amountToFreeDelivery: freeDelivery
        ? 0
        : money(PIF_FREE_DELIVERY_THRESHOLD - merchandiseTotal),
      total: money(merchandiseTotal + deliveryTotal),
    };
  }
}
