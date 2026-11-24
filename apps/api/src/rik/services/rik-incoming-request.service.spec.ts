import { RikIncomingRequestService } from './rik-incoming-request.service';
import type {
  IncomingRequestLineRecord,
  IncomingRequestRecord,
  IncomingRequestsRepository,
} from '../repositories/incoming-requests.repository';

/**
 * The inbox's one hard rule, under test: a request shows the provisions
 * THAT request is waiting on, and nothing else.
 *
 * THE DEFECT THESE EXIST FOR. A confirmed selection appears in the queue
 * twice when both its streams are outstanding — once for FRESH and once for
 * DRY — because a voucher is unique per (selection, ration type). Attaching
 * lines by selection alone would put the rice on the fresh-milk request and
 * the milk on the dry-rice one, and both rows would look plausible. These
 * pin the pairing.
 *
 * The SQL behind the queue is exercised separately against a real database;
 * what is checked here is the composition this file owns.
 */

const NOV = {
  period_id: 'period-nov',
  period_name: 'November 2026',
  period_start_date: '2026-11-01',
  period_end_date: '2026-11-30',
};

function row(over: Partial<IncomingRequestRecord> = {}): IncomingRequestRecord {
  return {
    selection_id: 'sel-1',
    reference_number: 'RIK-000001',
    ration_type: 'DRY',
    customer_id: 'cust-1',
    rik_id: 'RIK-0001',
    officer_name: 'Kiran Yadav',
    officer_official_name: null,
    mobile_number: '9000000001',
    quarter_block: 'B',
    quarter_number: '12',
    landmark: null,
    ...NOV,
    confirmed_at: '2026-11-02T09:00:00.000Z',
    dietary_preference: 'NV',
    eligible_days: 30,
    fulfillment_type: 'DELIVERY',
    pickup_location_name: null,
    delivery_address: 'Qtr B-12',
    other_type_issued: false,
    ...over,
  };
}

function line(over: Partial<IncomingRequestLineRecord> = {}): IncomingRequestLineRecord {
  return {
    selection_id: 'sel-1',
    ration_type: 'DRY',
    pool_code: 'CEREALS',
    pool_name: 'Cereals',
    pool_unit: 'g',
    provision_id: 'prov-rice',
    provision_code: 'RICE',
    provision_name: 'Rice',
    provision_brand: 'Sona',
    quantity: '9000',
    unit: 'g',
    pack_size: null,
    pack_unit: null,
    ...over,
  };
}

function serviceWith(opts: {
  rows?: IncomingRequestRecord[];
  lines?: IncomingRequestLineRecord[];
  total?: number;
}) {
  const search = jest.fn().mockResolvedValue(opts.rows ?? []);
  const count = jest.fn().mockResolvedValue(opts.total ?? (opts.rows ?? []).length);
  const listLines = jest.fn().mockResolvedValue(opts.lines ?? []);
  const service = new RikIncomingRequestService({
    search,
    count,
    listLines,
  } as unknown as IncomingRequestsRepository);
  return { service, search, count, listLines };
}

const PAGE = { limit: 25, offset: 0 } as const;

describe('RikIncomingRequestService — pairing lines to the right request', () => {
  it('splits one selection into its FRESH and DRY requests, each with its own provisions', async () => {
    const { service } = serviceWith({
      rows: [row({ ration_type: 'DRY' }), row({ ration_type: 'FRESH' })],
      lines: [
        line({ ration_type: 'DRY', provision_code: 'RICE' }),
        // Bread: a FRESH item that lives in the DRY cereals pool. It belongs
        // to the fresh request even though its pool says otherwise.
        line({ ration_type: 'FRESH', provision_code: 'BREAD', provision_id: 'prov-bread', quantity: '4', unit: 'piece', pack_size: '400', pack_unit: 'packet' }),
        line({ ration_type: 'FRESH', provision_code: 'MILK', provision_id: 'prov-milk', pool_code: 'MILK', pool_name: 'Milk', pool_unit: 'ml', quantity: '15000', unit: 'ml' }),
      ],
    });

    const { items } = await service.list(PAGE);

    expect(items.map((i) => i.rationType)).toEqual(['DRY', 'FRESH']);
    expect(items[0]!.lines.map((l) => l.code)).toEqual(['RICE']);
    expect(items[1]!.lines.map((l) => l.code)).toEqual(['BREAD', 'MILK']);
  });

  it('never leaks one selection’s lines onto another selection', async () => {
    const { service } = serviceWith({
      rows: [row({ selection_id: 'sel-1' }), row({ selection_id: 'sel-2', reference_number: 'RIK-000002' })],
      lines: [
        line({ selection_id: 'sel-1', provision_code: 'RICE' }),
        line({ selection_id: 'sel-2', provision_code: 'WHEAT', provision_id: 'prov-wheat' }),
      ],
    });

    const { items } = await service.list(PAGE);

    expect(items[0]!.lines.map((l) => l.code)).toEqual(['RICE']);
    expect(items[1]!.lines.map((l) => l.code)).toEqual(['WHEAT']);
  });

  it('reports a request with no matching lines as empty rather than borrowing some', async () => {
    const { service } = serviceWith({
      rows: [row({ ration_type: 'FRESH' })],
      lines: [line({ ration_type: 'DRY' })],
    });

    const { items } = await service.list(PAGE);

    expect(items[0]!.lines).toEqual([]);
  });

  it('asks for lines once, for the distinct selections on the page', async () => {
    const { service, listLines } = serviceWith({
      rows: [row({ ration_type: 'DRY' }), row({ ration_type: 'FRESH' }), row({ selection_id: 'sel-2' })],
    });

    await service.list(PAGE);

    // Two rows share sel-1, so it is requested once — not once per row.
    expect(listLines).toHaveBeenCalledTimes(1);
    expect(listLines).toHaveBeenCalledWith(['sel-1', 'sel-2']);
  });
});

describe('RikIncomingRequestService — what each request reports', () => {
  it('converts numeric columns and keeps an unconfigured pack size null', async () => {
    const { service } = serviceWith({
      rows: [row()],
      lines: [
        line({ quantity: '9000.5000', pack_size: null }),
        line({ provision_code: 'ATTA', provision_id: 'prov-atta', quantity: '2000', pack_size: '1000', pack_unit: 'packet' }),
      ],
    });

    const { items } = await service.list(PAGE);

    // Strings from `pg` become numbers once, here — not in the browser.
    expect(items[0]!.lines[0]).toMatchObject({ quantity: 9000.5, packSize: null, packUnit: null });
    // A missing pack size is absent, never 0 and never 1.
    expect(items[0]!.lines[1]).toMatchObject({ quantity: 2000, packSize: 1000, packUnit: 'packet' });
  });

  it('is always AWAITING_VOUCHER, because a worked request is not returned', async () => {
    const { service } = serviceWith({ rows: [row()] });

    const { items } = await service.list(PAGE);

    expect(items[0]!.status).toBe('AWAITING_VOUCHER');
  });

  it('flags a selection whose other ration type is already issued', async () => {
    const { service } = serviceWith({
      rows: [row({ ration_type: 'DRY', other_type_issued: true })],
    });

    const { items } = await service.list(PAGE);

    expect(items[0]!.otherRationTypeIssued).toBe(true);
  });

  it('reports no residence at all when the officer has no address on file', async () => {
    const { service } = serviceWith({
      rows: [row({ quarter_block: null, quarter_number: null, landmark: null })],
    });

    const { items } = await service.list(PAGE);

    // Null, not an object of three nulls the screen would have to unpick.
    expect(items[0]!.officer.residence).toBeNull();
    // …and the officer is still in the queue.
    expect(items[0]!.officer.rikId).toBe('RIK-0001');
  });

  it('carries a landmark-only address rather than discarding it', async () => {
    const { service } = serviceWith({
      rows: [row({ quarter_block: null, quarter_number: null, landmark: 'Near temple' })],
    });

    const { items } = await service.list(PAGE);

    expect(items[0]!.officer.residence).toEqual({
      quarterBlock: null,
      quarterNumber: null,
      landmark: 'Near temple',
    });
  });

  it('passes the confirmation fulfilment through, pickup and delivery alike', async () => {
    const { service } = serviceWith({
      rows: [
        row({ fulfillment_type: 'PICKUP', pickup_location_name: 'Main Store', delivery_address: null }),
        row({ selection_id: 'sel-2', fulfillment_type: 'DELIVERY', pickup_location_name: null, delivery_address: 'Qtr B-12' }),
      ],
    });

    const { items } = await service.list(PAGE);

    expect(items[0]!.fulfillment).toEqual({ mode: 'PICKUP', pickupLocationName: 'Main Store', deliveryAddress: null });
    expect(items[1]!.fulfillment).toEqual({ mode: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'Qtr B-12' });
  });
});

describe('RikIncomingRequestService — the page and its total', () => {
  it('counts with the SAME filters the page used', async () => {
    const { service, search, count } = serviceWith({ rows: [row()], total: 7 });
    const filters = { q: 'kiran', rationType: 'DRY', fulfillmentMode: 'DELIVERY', limit: 25, offset: 50 } as const;

    const result = await service.list({ ...filters });

    // A total read with different filters is the bug that shows one page of
    // rows beside a number that disagrees with it.
    expect(search).toHaveBeenCalledWith(filters);
    expect(count).toHaveBeenCalledWith(filters);
    expect(result.total).toBe(7);
  });

  it('returns an empty page without asking for any lines', async () => {
    const { service, listLines } = serviceWith({ rows: [], total: 0 });

    const result = await service.list(PAGE);

    expect(result).toEqual({ items: [], total: 0 });
    expect(listLines).toHaveBeenCalledWith([]);
  });

  it('has no method that creates, updates or deletes anything', () => {
    // The queue is read-only by construction: conversion goes through the
    // existing issue-voucher endpoint, which owns the duplicate rule.
    const names = Object.getOwnPropertyNames(RikIncomingRequestService.prototype);
    expect(names.sort()).toEqual(['constructor', 'list']);
  });
});
