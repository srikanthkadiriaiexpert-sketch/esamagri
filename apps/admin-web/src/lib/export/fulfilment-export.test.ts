import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two API modules are mocked down to the two pure label helpers this
 * module uses. That keeps these tests away from the HTTP client and the Vite
 * env entirely — what is under test is the paging, the flattening and the
 * column mapping, not the transport.
 */
vi.mock('../api/rik-issue-vouchers-api', () => ({
  statusLabel: (code: string) =>
    ({
      READY_FOR_PICKUP: 'Ready for pickup',
      COLLECTED: 'Collected',
      NOT_COLLECTED: 'Not collected',
      DELIVERED: 'Delivered',
    })[code] ?? code,
}));

vi.mock('../api/rik-fulfillment-api', () => ({
  outcomeLabel: (code: string) =>
    ({ COLLECTED: 'Collected', NOT_COLLECTED: 'Not collected' })[code] ?? code,
}));

const {
  EXPORT_PAGE_SIZE,
  buildLineCsv,
  buildVoucherCsv,
  collectFilteredVouchers,
  collectSelectedLines,
  lineColumns,
  toLineRows,
  voucherColumns,
} = await import('./fulfilment-export');

type Summary = Parameters<typeof buildVoucherCsv>[0][number];
type View = Parameters<typeof toLineRows>[0][number]['view'];

function voucher(over: Partial<Summary> = {}): Summary {
  return {
    voucherId: 'v-1',
    voucherNumber: 'IV-2026-000001',
    selectionId: 's-1',
    selectionReference: 'SEL-0001',
    officerId: 'c-1',
    rikId: 'RIK-O-000001',
    officerName: 'A Kumar',
    mobileNumber: '9876543210',
    rationType: 'DRY',
    fulfillmentMode: 'PICKUP',
    pickupLocationName: 'Main store counter 2',
    deliveryAddress: null,
    status: 'COLLECTED',
    periodId: 'p-1',
    periodName: 'November 2026',
    issueDate: '2026-11-03',
    createdAt: '2026-11-01T06:00:00.000Z',
    ...over,
  } as Summary;
}

function view(over: Partial<View> = {}): View {
  return {
    voucherId: 'v-1',
    voucherNumber: 'IV-2026-000001',
    rationType: 'DRY',
    fulfillmentMode: 'PICKUP',
    status: 'COLLECTED',
    officer: {
      rikId: 'RIK-O-000001',
      name: 'A Kumar',
      mobileNumber: '9876543210',
      quarterBlock: 'B',
      quarterNumber: '12',
      landmark: null,
    },
    destination: { mode: 'PICKUP', pickupLocationName: 'Main store', deliveryAddress: null },
    period: { id: 'p-1', name: 'November 2026' },
    lapsed: false,
    lapseReason: null,
    finalWindowCode: null,
    finalWindowEndDate: null,
    reminderDue: false,
    daysToFinalWindowClose: null,
    completion: {
      outcomeId: 'o-1',
      sequenceNo: 1,
      eventType: 'OUTCOME',
      outcome: 'COLLECTED',
      reason: null,
      windowCode: 'W1',
      supersedesId: null,
      recordedAt: '2026-11-04T09:30:00.000Z',
      recordedBy: { staffId: 'u-1', name: 'R Singh', role: 'RIK_PICKUP_STAFF' },
      notes: null,
      reversed: false,
    },
    events: [],
    issuedLines: [],
    carryForward: [],
    substitutionOptions: [],
    ...over,
  } as View;
}

function issuedLine(over: Record<string, unknown> = {}) {
  return {
    lineId: 'l-1',
    poolCode: 'CEREAL',
    poolName: 'Cereals',
    poolUnit: 'kg',
    provisionId: 'pr-1',
    code: 'RICE-BAS',
    name: 'Basmati Rice',
    brand: 'Rozana',
    quantityIssued: 5,
    consumptionRatio: 1,
    poolEquivalentQty: 5,
    carryForwardQty: 0,
    substitutedFor: null,
    ...over,
  } as View['issuedLines'][number];
}

// ---------------------------------------------------------------------------

describe('collectFilteredVouchers', () => {
  it('returns a single short page without asking for a second', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [voucher()], total: 1 });
    const result = await collectFilteredVouchers(fetchPage, { q: 'Kumar' });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(
      { q: 'Kumar', limit: EXPORT_PAGE_SIZE, offset: 0 },
      undefined
    );
    expect(result.vouchers).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('pages until the last page is short, advancing the offset each time', async () => {
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) =>
      voucher({ voucherId: `v-${i}`, voucherNumber: `IV-${i}` })
    );
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: full, total: 150 })
      .mockResolvedValueOnce({ items: full.slice(0, 50), total: 150 });

    const result = await collectFilteredVouchers(fetchPage, {});

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0].offset).toBe(EXPORT_PAGE_SIZE);
    expect(result.vouchers).toHaveLength(150);
    expect(result.truncated).toBe(false);
  });

  it('stops at the row cap and says it was truncated', async () => {
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => voucher({ voucherId: `v-${i}` }));
    const fetchPage = vi.fn().mockResolvedValue({ items: full, total: 10_000 });

    const result = await collectFilteredVouchers(fetchPage, {}, { maxRows: 150 });

    expect(result.vouchers).toHaveLength(150);
    expect(result.truncated).toBe(true);
    // Two pages of 100 reach 200 collected, which trips the cap; it must not
    // keep walking a 10,000-row result set.
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('terminates on a short page even when total is larger, rather than looping', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [voucher()], total: 999 });
    const result = await collectFilteredVouchers(fetchPage, {});
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.vouchers).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('handles an empty result without error', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const result = await collectFilteredVouchers(fetchPage, { issuedFrom: '2026-01-01' });
    expect(result.vouchers).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('passes the caller filters straight through, including the date range', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], total: 0 });
    await collectFilteredVouchers(fetchPage, {
      q: 'RIK-O-000001',
      status: 'COLLECTED',
      issuedFrom: '2026-11-01',
      issuedTo: '2026-11-10',
    });
    expect(fetchPage.mock.calls[0][0]).toEqual({
      q: 'RIK-O-000001',
      status: 'COLLECTED',
      issuedFrom: '2026-11-01',
      issuedTo: '2026-11-10',
      limit: EXPORT_PAGE_SIZE,
      offset: 0,
    });
  });
});

describe('buildVoucherCsv', () => {
  it('emits the header row for an empty export rather than an empty file', () => {
    const csv = buildVoucherCsv([]);
    expect(csv.split('\r\n')).toHaveLength(1);
    expect(csv).toContain('Voucher number');
    expect(csv).toContain('RIK ID');
  });

  it('writes one row per voucher, with the human status label and the raw code', () => {
    const csv = buildVoucherCsv([voucher()]);
    const [header, row] = csv.split('\r\n');
    expect(header.split(',')).toHaveLength(voucherColumns.length);
    expect(row).toContain('IV-2026-000001');
    expect(row).toContain('RIK-O-000001');
    expect(row).toContain('Collected');
    expect(row).toContain('COLLECTED');
  });

  it('escapes an officer name containing a comma', () => {
    const csv = buildVoucherCsv([voucher({ officerName: 'Kumar, A.' })]);
    expect(csv).toContain('"Kumar, A."');
  });

  it('writes a missing optional field as an empty cell', () => {
    const csv = buildVoucherCsv([voucher({ selectionReference: null, issueDate: null })]);
    const row = csv.split('\r\n')[1];
    expect(row.split(',')).toHaveLength(voucherColumns.length);
  });

  it('names both destination columns in the header', () => {
    const header = buildVoucherCsv([]);
    expect(header).toContain('Pickup location');
    expect(header).toContain('Delivery address');
  });

  it('exports the pickup location for a pickup voucher, and no delivery address', () => {
    const csv = buildVoucherCsv([
      voucher({
        fulfillmentMode: 'PICKUP',
        pickupLocationName: 'Main store counter 2',
        deliveryAddress: null,
      }),
    ]);
    const header = csv.split('\r\n')[0].split(',');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[header.indexOf('Pickup location')]).toBe('Main store counter 2');
    expect(cells[header.indexOf('Delivery address')]).toBe('');
  });

  it('exports the delivery address for a delivery voucher, and no pickup location', () => {
    const csv = buildVoucherCsv([
      voucher({
        fulfillmentMode: 'DELIVERY',
        pickupLocationName: null,
        deliveryAddress: 'Quarter B-12 near the water tank',
      }),
    ]);
    const header = csv.split('\r\n')[0].split(',');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[header.indexOf('Delivery address')]).toBe('Quarter B-12 near the water tank');
    expect(cells[header.indexOf('Pickup location')]).toBe('');
  });

  it('writes empty cells when BOTH destination fields are null', () => {
    const csv = buildVoucherCsv([voucher({ pickupLocationName: null, deliveryAddress: null })]);
    const header = csv.split('\r\n')[0].split(',');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells).toHaveLength(voucherColumns.length);
    expect(cells[header.indexOf('Pickup location')]).toBe('');
    expect(cells[header.indexOf('Delivery address')]).toBe('');
  });

  it('quotes a delivery address containing a comma, so it stays one column', () => {
    const csv = buildVoucherCsv([
      voucher({
        fulfillmentMode: 'DELIVERY',
        pickupLocationName: null,
        deliveryAddress: 'Quarter B-12, Block 4, near the water tank',
      }),
    ]);
    expect(csv).toContain('"Quarter B-12, Block 4, near the water tank"');
  });

  it('quotes a multi-line delivery address, so one voucher stays one row', () => {
    const csv = buildVoucherCsv([
      voucher({
        fulfillmentMode: 'DELIVERY',
        pickupLocationName: null,
        deliveryAddress: 'Quarter B-12\nBlock 4',
      }),
    ]);
    expect(csv).toContain('"Quarter B-12\nBlock 4"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('escapes a quote character inside a pickup location', () => {
    const csv = buildVoucherCsv([
      voucher({ pickupLocationName: 'Store "B" counter', deliveryAddress: null }),
    ]);
    expect(csv).toContain('"Store ""B"" counter"');
  });

  it('uses the same destination headers, in the same order, as the line export', () => {
    // Condition 7: a reader comparing the two files must not have to learn two
    // layouts. Both put Pickup location then Delivery address after
    // Fulfilment mode.
    const v = voucherColumns.map((c) => c.header);
    const l = lineColumns.map((c) => c.header);
    expect(v.slice(v.indexOf('Fulfilment mode'), v.indexOf('Fulfilment mode') + 3)).toEqual([
      'Fulfilment mode',
      'Pickup location',
      'Delivery address',
    ]);
    expect(l.slice(l.indexOf('Fulfilment mode'), l.indexOf('Fulfilment mode') + 3)).toEqual([
      'Fulfilment mode',
      'Pickup location',
      'Delivery address',
    ]);
  });

  it('carries no PIF column of any kind', () => {
    const header = buildVoucherCsv([]).toLowerCase();
    expect(header).not.toContain('pif');
    expect(header).not.toContain('order');
    expect(header).not.toContain('price');
    expect(header).not.toContain('amount');
  });
});

describe('toLineRows', () => {
  it('produces one row per issued provision', () => {
    const rows = toLineRows([
      {
        voucher: voucher(),
        view: view({ issuedLines: [issuedLine(), issuedLine({ lineId: 'l-2', code: 'DAL-TUR' })] }),
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].line?.code).toBe('RICE-BAS');
    expect(rows[1].line?.code).toBe('DAL-TUR');
  });

  it('still produces one row for a voucher with nothing issued', () => {
    const rows = toLineRows([{ voucher: voucher({ status: 'NOT_COLLECTED' }), view: view() }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].line).toBeNull();
  });

  it('keeps vouchers in the order given', () => {
    const rows = toLineRows([
      { voucher: voucher({ voucherNumber: 'IV-A' }), view: view() },
      { voucher: voucher({ voucherNumber: 'IV-B' }), view: view() },
    ]);
    expect(rows.map((r) => r.voucher.voucherNumber)).toEqual(['IV-A', 'IV-B']);
  });
});

describe('buildLineCsv', () => {
  it('writes the provision, quantity and unit from the server view', () => {
    const rows = toLineRows([{ voucher: voucher(), view: view({ issuedLines: [issuedLine()] }) }]);
    const csv = buildLineCsv(rows);
    const [header, row] = csv.split('\r\n');
    expect(header.split(',')).toHaveLength(lineColumns.length);
    expect(row).toContain('Basmati Rice');
    expect(row).toContain('RICE-BAS');
    expect(row).toContain('5');
    expect(row).toContain('kg');
  });

  it('records the fulfilment outcome, who recorded it and when', () => {
    const rows = toLineRows([{ voucher: voucher(), view: view({ issuedLines: [issuedLine()] }) }]);
    const csv = buildLineCsv(rows);
    expect(csv).toContain('Collected');
    expect(csv).toContain('R Singh');
    expect(csv).toContain('2026-11-04T09:30:00.000Z');
  });

  it('records a substitution with its reason', () => {
    const rows = toLineRows([
      {
        voucher: voucher(),
        view: view({
          issuedLines: [
            issuedLine({
              substitutedFor: {
                provisionId: 'pr-9',
                code: 'RICE-SON',
                name: 'Sona Masoori',
                reason: 'Out of stock, officer agreed',
              },
            }),
          ],
        }),
      },
    ]);
    const csv = buildLineCsv(rows);
    expect(csv).toContain('RICE-SON');
    expect(csv).toContain('Sona Masoori');
    expect(csv).toContain('"Out of stock, officer agreed"');
  });

  it('leaves the provision columns empty for an unfulfilled voucher but keeps the row', () => {
    const rows = toLineRows([{ voucher: voucher({ status: 'NOT_COLLECTED' }), view: view() }]);
    const csv = buildLineCsv(rows);
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells).toHaveLength(lineColumns.length);
    expect(csv).toContain('IV-2026-000001');
  });

  it('emits only the header for no rows', () => {
    expect(buildLineCsv([]).split('\r\n')).toHaveLength(1);
  });

  it('names both destination columns in the header', () => {
    const header = buildLineCsv([]);
    expect(header).toContain('Pickup location');
    expect(header).toContain('Delivery address');
  });

  it('exports the pickup location for a pickup voucher, and no delivery address', () => {
    const rows = toLineRows([
      {
        voucher: voucher({ fulfillmentMode: 'PICKUP' }),
        view: view({
          fulfillmentMode: 'PICKUP',
          destination: {
            mode: 'PICKUP',
            pickupLocationName: 'Main store counter 2',
            deliveryAddress: null,
          },
          issuedLines: [issuedLine()],
        }),
      },
    ]);
    const csv = buildLineCsv(rows);
    const header = csv.split('\r\n')[0].split(',');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[header.indexOf('Pickup location')]).toBe('Main store counter 2');
    expect(cells[header.indexOf('Delivery address')]).toBe('');
  });

  it('exports the delivery address for a delivery voucher, and no pickup location', () => {
    const rows = toLineRows([
      {
        voucher: voucher({ fulfillmentMode: 'DELIVERY' }),
        view: view({
          fulfillmentMode: 'DELIVERY',
          destination: {
            mode: 'DELIVERY',
            pickupLocationName: null,
            deliveryAddress: 'Quarter B-12 near the water tank',
          },
          issuedLines: [issuedLine()],
        }),
      },
    ]);
    const csv = buildLineCsv(rows);
    const header = csv.split('\r\n')[0].split(',');
    const cells = csv.split('\r\n')[1].split(',');
    expect(cells[header.indexOf('Delivery address')]).toBe('Quarter B-12 near the water tank');
    expect(cells[header.indexOf('Pickup location')]).toBe('');
  });

  it('quotes a delivery address containing a comma, so it stays one column', () => {
    const rows = toLineRows([
      {
        voucher: voucher({ fulfillmentMode: 'DELIVERY' }),
        view: view({
          destination: {
            mode: 'DELIVERY',
            pickupLocationName: null,
            deliveryAddress: 'Quarter B-12, Block 4, near the water tank',
          },
          issuedLines: [issuedLine()],
        }),
      },
    ]);
    expect(buildLineCsv(rows)).toContain('"Quarter B-12, Block 4, near the water tank"');
  });

  it('quotes a multi-line delivery address, so one voucher stays one row', () => {
    const rows = toLineRows([
      {
        voucher: voucher({ fulfillmentMode: 'DELIVERY' }),
        view: view({
          destination: {
            mode: 'DELIVERY',
            pickupLocationName: null,
            deliveryAddress: 'Quarter B-12\nBlock 4',
          },
          issuedLines: [issuedLine()],
        }),
      },
    ]);
    const csv = buildLineCsv(rows);
    expect(csv).toContain('"Quarter B-12\nBlock 4"');
    // Three physical lines (header + a row broken by the embedded newline),
    // but the quoting is what keeps it ONE logical record.
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('still exports the destination for a voucher with nothing issued', () => {
    const rows = toLineRows([
      {
        voucher: voucher({ status: 'NOT_COLLECTED' }),
        view: view({
          destination: {
            mode: 'PICKUP',
            pickupLocationName: 'Main store counter 2',
            deliveryAddress: null,
          },
        }),
      },
    ]);
    expect(buildLineCsv(rows)).toContain('Main store counter 2');
  });

  it('neutralises a formula that reached a provision name', () => {
    const rows = toLineRows([
      { voucher: voucher(), view: view({ issuedLines: [issuedLine({ name: '=1+1' })] }) },
    ]);
    expect(buildLineCsv(rows)).toContain("'=1+1");
  });
});

describe('collectSelectedLines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches one view per selected voucher and flattens the lines', async () => {
    const fetchView = vi
      .fn()
      .mockResolvedValue(view({ issuedLines: [issuedLine(), issuedLine({ lineId: 'l-2' })] }));

    const result = await collectSelectedLines(fetchView, [
      voucher({ voucherId: 'v-1' }),
      voucher({ voucherId: 'v-2', voucherNumber: 'IV-2026-000002' }),
    ]);

    expect(fetchView).toHaveBeenCalledTimes(2);
    expect(fetchView).toHaveBeenNthCalledWith(1, 'v-1', undefined);
    expect(fetchView).toHaveBeenNthCalledWith(2, 'v-2', undefined);
    expect(result.rows).toHaveLength(4);
    expect(result.failures).toEqual([]);
  });

  it('reports a voucher whose view could not be read instead of dropping it silently', async () => {
    const boom = new Error('403');
    const fetchView = vi
      .fn()
      .mockResolvedValueOnce(view({ issuedLines: [issuedLine()] }))
      .mockRejectedValueOnce(boom);

    const result = await collectSelectedLines(fetchView, [
      voucher({ voucherId: 'v-1', voucherNumber: 'IV-A' }),
      voucher({ voucherId: 'v-2', voucherNumber: 'IV-B' }),
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.failures).toEqual([{ voucherNumber: 'IV-B', error: boom }]);
  });

  it('handles an empty selection', async () => {
    const fetchView = vi.fn();
    const result = await collectSelectedLines(fetchView, []);
    expect(fetchView).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
  });
});
