import { summaryView } from './issue-voucher-summary.view';
import type { IssueVoucherRecord } from './repositories/issue-vouchers.repository';

/**
 * What the voucher LIST response publishes — and, more importantly, what it
 * does not.
 *
 * Every row of every list response goes through this function, and the CSV
 * export of all filtered records is built from it, so this is the one place to
 * pin the field set. The exact-key assertion is deliberate: it fails when a
 * field is added, which forces the addition to be a decision rather than a
 * side effect of someone widening IssueVoucherRecord.
 *
 * No database and no Nest container: the module under test imports only a
 * type, which TypeScript erases.
 */

/**
 * A record with EVERY column VOUCHER_SELECT returns, deliberately including
 * the ones the list must not publish, so the exclusion tests have something
 * real to exclude.
 */
function record(over: Partial<IssueVoucherRecord> = {}): IssueVoucherRecord {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    voucher_number: 'IV-2026-000001',
    selection_id: '22222222-2222-7222-8222-222222222222',
    selection_reference: 'SEL-0001',
    customer_id: '33333333-3333-7333-8333-333333333333',
    rik_id: 'RIK-O-000001',
    officer_name: 'A Kumar',
    officer_official_name: 'Kumar, A.',
    mobile_number: '9876543210',
    quarter_block: 'B',
    quarter_number: '12',
    landmark: 'Near the water tank',
    period_id: '44444444-4444-7444-8444-444444444444',
    period_name: 'November 2026',
    period_start_date: '2026-11-01',
    period_end_date: '2026-11-30',
    ration_type: 'DRY',
    fulfillment_mode: 'PICKUP',
    pickup_location_id: '55555555-5555-7555-8555-555555555555',
    pickup_location_name: 'Main store counter 2',
    delivery_address: null,
    status: 'COLLECTED',
    created_at: '2026-11-01T06:00:00.000Z',
    created_by: '66666666-6666-7666-8666-666666666666',
    created_by_name: 'R Singh',
    released_at: '2026-11-03T04:00:00.000Z',
    released_by: '66666666-6666-7666-8666-666666666666',
    updated_at: '2026-11-04T09:30:00.000Z',
    ...over,
  };
}

const EXPECTED_KEYS = [
  'createdAt',
  'deliveryAddress',
  'fulfillmentMode',
  'issueDate',
  'mobileNumber',
  'officerId',
  'officerName',
  'periodId',
  'periodName',
  'pickupLocationName',
  'rationType',
  'rikId',
  'selectionId',
  'selectionReference',
  'status',
  'voucherId',
  'voucherNumber',
];

describe('summaryView — the published field set', () => {
  it('returns exactly the approved keys, and nothing else', () => {
    expect(Object.keys(summaryView(record())).sort()).toEqual(EXPECTED_KEYS);
  });

  it('publishes seventeen fields', () => {
    expect(Object.keys(summaryView(record()))).toHaveLength(17);
  });
});

describe('summaryView — what it deliberately withholds', () => {
  /**
   * These all exist on IssueVoucherRecord and are all withheld from the list.
   * The officer's quarter, quarter number and landmark are their residence:
   * they belong to the detail view a staff member opens for ONE voucher, not
   * to every row of a list or to a bulk CSV of the whole month.
   */
  it.each([
    'quarterBlock',
    'quarter_block',
    'quarterNumber',
    'quarter_number',
    'landmark',
    'pickupLocationId',
    'pickup_location_id',
    'createdBy',
    'created_by',
    'createdByName',
    'releasedBy',
    'released_by',
    'updatedAt',
    'updated_at',
    'periodStartDate',
    'periodEndDate',
  ])('does not publish %s', (key) => {
    expect(summaryView(record())).not.toHaveProperty(key);
  });

  it('publishes no snake_case key at all, so no raw column leaks through', () => {
    const leaked = Object.keys(summaryView(record())).filter((k) => k.includes('_'));
    expect(leaked).toEqual([]);
  });

  it('carries nothing from PIF and no second customer', () => {
    const json = JSON.stringify(summaryView(record())).toLowerCase();
    expect(json).not.toContain('pif');
    expect(json).not.toContain('password');
    expect(json).not.toContain('hash');
    expect(json).not.toContain('totp');
  });
});

describe('summaryView — the destination fields', () => {
  it('reports the pickup location for a PICKUP voucher, and a null address', () => {
    const view = summaryView(
      record({
        fulfillment_mode: 'PICKUP',
        pickup_location_name: 'Main store counter 2',
        delivery_address: null,
      })
    );
    expect(view.pickupLocationName).toBe('Main store counter 2');
    expect(view.deliveryAddress).toBeNull();
  });

  it('reports the delivery address for a DELIVERY voucher, and a null location', () => {
    const view = summaryView(
      record({
        fulfillment_mode: 'DELIVERY',
        pickup_location_name: null,
        delivery_address: 'Quarter B-12 near the water tank',
      })
    );
    expect(view.deliveryAddress).toBe('Quarter B-12 near the water tank');
    expect(view.pickupLocationName).toBeNull();
  });

  it('passes a null through as null rather than inventing an empty string', () => {
    const view = summaryView(record({ pickup_location_name: null, delivery_address: null }));
    expect(view.pickupLocationName).toBeNull();
    expect(view.deliveryAddress).toBeNull();
  });

  it('does not expose the pickup location id, only its name', () => {
    const view = summaryView(record());
    expect(JSON.stringify(view)).not.toContain('55555555-5555-7555-8555-555555555555');
  });

  it('passes an address containing a comma through untouched — escaping is the CSV layer', () => {
    const view = summaryView(
      record({ delivery_address: 'Quarter B-12, Block 4', pickup_location_name: null })
    );
    expect(view.deliveryAddress).toBe('Quarter B-12, Block 4');
  });
});

describe('summaryView — the fields it maps rather than copies', () => {
  it('prefers the facility spelling of the officer name', () => {
    expect(summaryView(record()).officerName).toBe('Kumar, A.');
  });

  it('falls back to the officer own name when no official name is recorded', () => {
    expect(summaryView(record({ officer_official_name: null })).officerName).toBe('A Kumar');
  });

  it('reports released_at as the issue date', () => {
    expect(summaryView(record()).issueDate).toBe('2026-11-03T04:00:00.000Z');
  });

  it('reports the customer id as officerId, not as a customer id', () => {
    const view = summaryView(record());
    expect(view.officerId).toBe('33333333-3333-7333-8333-333333333333');
    expect(view).not.toHaveProperty('customerId');
  });
});
