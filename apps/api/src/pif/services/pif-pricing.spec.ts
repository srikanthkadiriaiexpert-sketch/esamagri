import type { ProductRecord } from '../repositories/pif-catalogue.repository';
import {
  PIF_DELIVERY_FEE,
  PIF_FREE_DELIVERY_THRESHOLD,
  PifPricingService,
  money,
} from './pif-pricing.service';

/**
 * THE PIF DELIVERY CHARGE AND THE PRICES IT SITS ON TOP OF.
 *
 * WHY THIS SUITE NEEDS NO DATABASE. PifPricingService is pure arithmetic over
 * a catalogue row and a fulfillment mode. Nothing here boots AppModule and
 * nothing needs `esamagri_test`, so these tests RUN - with
 * `npx jest src/pif/services` - rather than joining the twenty suites that
 * cannot connect.
 *
 * THE APPROVED RULE, asserted at its edges:
 *
 *   home delivery below the threshold   the fee
 *   home delivery at or above it        free
 *   store pickup                        free, at any value
 *   one fee per order                   never one per business
 *
 * ELIGIBILITY IS MEASURED ON MERCHANDISE TOTAL - subtotal - discount + GST -
 * which is what the customer pays for goods, before delivery. Two tests pin
 * that down from opposite directions: a discount that drags an order under
 * the threshold, and GST that lifts one over it. If the basis is ever changed
 * to the pre-discount subtotal or to the final total, one of those two fails.
 *
 * THE BOUNDARY IS EXACT, not approximate: `money()` rounds every line to
 * paise and the merchandise total is a sum of already-rounded figures, so
 * 498.99 / 499.00 / 499.01 are three distinct, reachable states rather than a
 * floating-point smear. They are tested as three separate cases for that
 * reason.
 *
 * WHAT IS NOT ASSERTED HERE: that the charge reaches the database correctly.
 * That is the repository's and the schema's job - migration 0064's CHECK and
 * deferred trigger - and it needs a live database.
 */

const pricing = new PifPricingService();

/**
 * A catalogue row, as far as pricing is concerned. Only the five fields
 * `priceLine` actually reads are meaningful; the rest exist because the type
 * demands them and are never used in an assertion.
 */
function product(
  over: { price: number; discountPct?: number; taxPct?: number; id?: string }
): ProductRecord {
  return {
    id: over.id ?? 'p1',
    sku: 'SKU-1',
    name: 'Test item',
    brand: null,
    unit: 'piece',
    pack_size: null,
    pack_unit: null,
    image_ref: null,
    selling_price: String(over.price),
    discount_pct: over.discountPct === undefined ? null : String(over.discountPct),
    tax_rate_pct: over.taxPct === undefined ? null : String(over.taxPct),
    tax_rate_name: over.taxPct === undefined ? null : `GST ${over.taxPct}%`,
  } as unknown as ProductRecord;
}

/** Price one line and total the order, in one step. */
function order(
  mode: 'PICKUP' | 'DELIVERY',
  ...items: Array<{ price: number; discountPct?: number; taxPct?: number; qty?: number }>
) {
  const lines = items.map((item, i) =>
    pricing.priceLine(product({ ...item, id: `p${i + 1}` }), item.qty ?? 1)
  );
  return pricing.totals(lines, mode);
}

// ===================================================================
describe('the constants are the approved policy', () => {
  it('charges 20 and frees delivery at 499', () => {
    expect(PIF_DELIVERY_FEE).toBe(20);
    expect(PIF_FREE_DELIVERY_THRESHOLD).toBe(499);
  });
});

// ===================================================================
describe('the worked examples from the approved rule', () => {
  it('495 of goods plus 24.75 GST = 519.75 -> FREE', () => {
    const o = order('DELIVERY', { price: 495, taxPct: 5 });
    expect(o.taxTotal).toBe(24.75);
    expect(o.merchandiseTotal).toBe(519.75);
    expect(o.freeDelivery).toBe(true);
    expect(o.deliveryTotal).toBe(0);
    expect(o.total).toBe(519.75);
  });

  it('480 of goods with no GST = 480 -> 20 charged', () => {
    const o = order('DELIVERY', { price: 480 });
    expect(o.merchandiseTotal).toBe(480);
    expect(o.freeDelivery).toBe(false);
    expect(o.deliveryTotal).toBe(20);
    expect(o.total).toBe(500);
  });

  it('500 less a 10% discount = 450 -> 20 charged, because the discount counts', () => {
    const o = order('DELIVERY', { price: 500, discountPct: 10 });
    expect(o.subtotal).toBe(500);
    expect(o.discountTotal).toBe(50);
    expect(o.merchandiseTotal).toBe(450);
    expect(o.deliveryTotal).toBe(20);
    expect(o.total).toBe(470);
  });

  it('exactly 499 -> FREE', () => {
    const o = order('DELIVERY', { price: 499 });
    expect(o.merchandiseTotal).toBe(499);
    expect(o.freeDelivery).toBe(true);
    expect(o.deliveryTotal).toBe(0);
  });
});

// ===================================================================
describe('the boundary, to the paisa', () => {
  it('498.99 is charged', () => {
    const o = order('DELIVERY', { price: 498.99 });
    expect(o.merchandiseTotal).toBe(498.99);
    expect(o.deliveryTotal).toBe(20);
    expect(o.freeDelivery).toBe(false);
  });

  it('499.00 is free', () => {
    const o = order('DELIVERY', { price: 499.0 });
    expect(o.merchandiseTotal).toBe(499);
    expect(o.deliveryTotal).toBe(0);
    expect(o.freeDelivery).toBe(true);
  });

  it('499.01 is free', () => {
    const o = order('DELIVERY', { price: 499.01 });
    expect(o.merchandiseTotal).toBe(499.01);
    expect(o.deliveryTotal).toBe(0);
    expect(o.freeDelivery).toBe(true);
  });
});

// ===================================================================
describe('what the threshold is measured on', () => {
  it('is NOT the pre-discount subtotal: 520 of goods at 10% off is charged', () => {
    // subtotal 520 would qualify; merchandise 468 + 23.40 GST = 491.40 does not.
    const o = order('DELIVERY', { price: 520, discountPct: 10, taxPct: 5 });
    expect(o.subtotal).toBe(520);
    expect(o.discountTotal).toBe(52);
    expect(o.taxTotal).toBe(23.4);
    expect(o.merchandiseTotal).toBe(491.4);
    expect(o.deliveryTotal).toBe(20);
  });

  it('DOES include GST: 480 of goods plus 5% is free', () => {
    // 480 alone would be charged; 480 + 24 = 504 is not.
    const o = order('DELIVERY', { price: 480, taxPct: 5 });
    expect(o.taxTotal).toBe(24);
    expect(o.merchandiseTotal).toBe(504);
    expect(o.deliveryTotal).toBe(0);
  });

  it('is NOT the final total, which would let the charge decide its own rule', () => {
    // merchandise 490 is under the threshold. The total WITH the fee is 510,
    // which is over it - and must not make delivery free.
    const o = order('DELIVERY', { price: 490 });
    expect(o.merchandiseTotal).toBe(490);
    expect(o.total).toBe(510);
    expect(o.deliveryTotal).toBe(20);
  });
});

// ===================================================================
describe('store pickup', () => {
  it('is free on a small order', () => {
    const o = order('PICKUP', { price: 100 });
    expect(o.deliveryTotal).toBe(0);
    expect(o.freeDelivery).toBe(true);
    expect(o.total).toBe(100);
  });

  it('is free on a large order', () => {
    const o = order('PICKUP', { price: 5000 });
    expect(o.deliveryTotal).toBe(0);
    expect(o.total).toBe(5000);
  });

  it('is free at one paisa under the delivery threshold, where delivery is charged', () => {
    const under = { price: 498.99 };
    expect(order('PICKUP', under).deliveryTotal).toBe(0);
    expect(order('DELIVERY', under).deliveryTotal).toBe(20);
  });

  it('reports nothing to add, because there is nothing to unlock', () => {
    expect(order('PICKUP', { price: 100 }).amountToFreeDelivery).toBe(0);
  });
});

// ===================================================================
describe('one fee per order, never one per business', () => {
  it('charges once for a cart of several items below the threshold', () => {
    // Four lines, as a mixed Grocers + Fresh Mart basket would be. The
    // pricing service is deliberately blind to which shop a line came from:
    // an order is an order, so there is exactly one place a fee can be added.
    const o = order(
      'DELIVERY',
      { price: 120 },
      { price: 120 },
      { price: 120 },
      { price: 120 }
    );
    expect(o.merchandiseTotal).toBe(480);
    expect(o.deliveryTotal).toBe(20);
    expect(o.total).toBe(500);
  });

  it('charges nothing for a mixed cart that reaches the threshold together', () => {
    // Neither half would qualify alone; together they do, and one order gets
    // one answer.
    const o = order('DELIVERY', { price: 250 }, { price: 250 });
    expect(o.merchandiseTotal).toBe(500);
    expect(o.deliveryTotal).toBe(0);
    expect(o.total).toBe(500);
  });

  it('adds the fee once however many lines there are', () => {
    const many = Array.from({ length: 12 }, () => ({ price: 10 }));
    const o = order('DELIVERY', ...many);
    expect(o.merchandiseTotal).toBe(120);
    expect(o.deliveryTotal).toBe(PIF_DELIVERY_FEE);
  });
});

// ===================================================================
describe('the arithmetic holds', () => {
  it.each([
    ['plain', { price: 480 }],
    ['discounted', { price: 520, discountPct: 10 }],
    ['taxed', { price: 495, taxPct: 5 }],
    ['both', { price: 520, discountPct: 7.5, taxPct: 12 }],
    ['qualifying', { price: 600, taxPct: 5 }],
  ])('total = subtotal - discount + tax + delivery (%s)', (_label, item) => {
    for (const mode of ['DELIVERY', 'PICKUP'] as const) {
      const o = order(mode, item);
      expect(o.merchandiseTotal).toBe(money(o.subtotal - o.discountTotal + o.taxTotal));
      expect(o.total).toBe(money(o.merchandiseTotal + o.deliveryTotal));
    }
  });

  it('keeps subtotal, discount and tax as the exact sum of the lines', () => {
    const o = order('DELIVERY', { price: 120, taxPct: 5 }, { price: 240, discountPct: 10 });
    expect(o.subtotal).toBe(money(o.lines.reduce((s, l) => s + l.lineSubtotal, 0)));
    expect(o.discountTotal).toBe(money(o.lines.reduce((s, l) => s + l.lineDiscount, 0)));
    expect(o.taxTotal).toBe(money(o.lines.reduce((s, l) => s + l.lineTax, 0)));
    // ...and the delivery charge is NOT a sum of lines, which is exactly why
    // migration 0064 had to widen the database's totals trigger.
    expect(o.total).not.toBe(money(o.lines.reduce((s, l) => s + l.lineTotal, 0)));
  });
});

// ===================================================================
describe('what the shopper is told', () => {
  it('names the shortfall to free delivery', () => {
    const o = order('DELIVERY', { price: 494 });
    expect(o.amountToFreeDelivery).toBe(5);
  });

  it('names a shortfall in paise, not rounded away', () => {
    const o = order('DELIVERY', { price: 498.99 });
    expect(o.amountToFreeDelivery).toBe(0.01);
  });

  it('reports nothing to add once delivery is free', () => {
    expect(order('DELIVERY', { price: 499 }).amountToFreeDelivery).toBe(0);
    expect(order('DELIVERY', { price: 2000 }).amountToFreeDelivery).toBe(0);
  });

  it('returns the fee and the threshold, so no screen hard-codes them', () => {
    const o = order('DELIVERY', { price: 100 });
    expect(o.deliveryFee).toBe(PIF_DELIVERY_FEE);
    expect(o.deliveryThreshold).toBe(PIF_FREE_DELIVERY_THRESHOLD);
  });
});

// ===================================================================
describe('the intended inversion', () => {
  it('lets the payable FALL when the basket grows past the threshold', () => {
    // This looks like a bug and is the incentive working: 494 of goods costs
    // 514 to have delivered, and 499 of goods costs 499. A tester who finds
    // it should recognise it as the rule, not a defect.
    const under = order('DELIVERY', { price: 494 });
    const over = order('DELIVERY', { price: 499 });
    expect(under.total).toBe(514);
    expect(over.total).toBe(499);
    expect(over.total).toBeLessThan(under.total);
  });
});

// ===================================================================
describe('an empty basket', () => {
  it('is free to deliver, because there is nothing to deliver', () => {
    // Checkout refuses an empty cart outright, so this only reaches a quote
    // for a basket just emptied - and charging 20 to carry nothing would read
    // as a bug on screen.
    const o = pricing.totals([], 'DELIVERY');
    expect(o.total).toBe(0);
    expect(o.deliveryTotal).toBe(0);
    expect(o.freeDelivery).toBe(true);
    expect(o.amountToFreeDelivery).toBe(0);
  });
});
