import ExcelJS from 'exceljs';
import {
  buildVoucherWorkbook,
  summariseDeliveries,
  summariseProvisions,
  SHEET_NAMES,
  type LineRow,
  type RegisterRow,
} from './issue-voucher-workbook';

/**
 * The workbook's two non-negotiable rules, under test by reading the real
 * file back with ExcelJS rather than by inspecting the objects that went in.
 *
 *  1. QUANTITIES ARE NEVER COMBINED ACROSS UNITS.
 *  2. QUANTITIES ARE NEVER ROUNDED INTO PACKS.
 *
 * Both were explicit decisions in the approved scope, and both are the kind
 * of rule that a later "tidy-up" quietly breaks — a reasonable-looking
 * "Total" column, a convenient "Packs required". These tests are what makes
 * that break loud.
 */

function register(over: Partial<RegisterRow> = {}): RegisterRow {
  return {
    voucherNumber: 'RIK-V-0001',
    selectionReference: 'RIK-000001',
    rikId: 'RIK-0001',
    officerName: 'Kiran Yadav',
    mobileNumber: '9000000001',
    rationType: 'DRY',
    fulfillmentMode: 'DELIVERY',
    pickupLocationName: null,
    deliveryAddress: 'Qtr B-12, Near temple',
    status: 'READY_FOR_DELIVERY',
    statusLabel: 'Ready for delivery',
    periodName: 'November 2026',
    issueDate: '2026-11-02T09:00:00.000Z',
    createdAt: '2026-11-02T09:00:00.000Z',
    ...over,
  };
}

function line(over: Partial<LineRow> = {}): LineRow {
  return {
    voucherNumber: 'RIK-V-0001',
    rikId: 'RIK-0001',
    officerName: 'Kiran Yadav',
    mobileNumber: '9000000001',
    destination: 'Qtr B-12, Near temple',
    periodName: 'November 2026',
    rationType: 'DRY',
    fulfillmentMode: 'DELIVERY',
    poolCode: 'CEREALS',
    poolName: 'Cereals',
    provisionId: 'prov-rice',
    provisionCode: 'RICE',
    provisionName: 'Rice',
    brand: 'Sona',
    quantity: 9000,
    unit: 'g',
    packSize: null,
    packUnit: null,
    status: 'READY_FOR_DELIVERY',
    statusLabel: 'Ready for delivery',
    ...over,
  };
}

const INPUT = { filterSummary: 'All issued vouchers', generatedAt: '2026-11-19T10:00:00.000Z' };

async function readBack(
  registerRows: RegisterRow[],
  lineRows: LineRow[]
): Promise<ExcelJS.Workbook> {
  const buffer = await buildVoucherWorkbook({ register: registerRows, lines: lineRows, ...INPUT });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

/** Data rows only: row 1 is the caption, row 2 the header. */
function dataRows(sheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  sheet.eachRow((row, number) => {
    if (number <= 2) return;
    const values = row.values as unknown[];
    rows.push(values.slice(1));
  });
  return rows;
}

function headers(sheet: ExcelJS.Worksheet): string[] {
  return (sheet.getRow(2).values as unknown[]).slice(1).map((v) => String(v));
}

describe('the workbook — shape', () => {
  it('always has the five approved sheets, in order, named exactly', async () => {
    const workbook = await readBack([register()], [line()]);
    expect(workbook.worksheets.map((w) => w.name)).toEqual([...SHEET_NAMES]);
  });

  it('still produces all five sheets, with headers, when nothing matched', async () => {
    const workbook = await readBack([], []);

    expect(workbook.worksheets.map((w) => w.name)).toEqual([...SHEET_NAMES]);
    for (const name of SHEET_NAMES) {
      const sheet = workbook.getWorksheet(name)!;
      // An export of nothing is a real answer. It must not look like a file
      // that failed to produce a sheet.
      expect(headers(sheet).length).toBeGreaterThan(0);
      expect(dataRows(sheet)).toEqual([]);
    }
  });

  it('gives a lane with no vouchers its sheet anyway', async () => {
    // Everything is delivery; nobody is collecting this week.
    const workbook = await readBack([register()], [line()]);

    expect(dataRows(workbook.getWorksheet('Home Delivery')!)).toHaveLength(1);
    expect(dataRows(workbook.getWorksheet('Store Pickup')!)).toEqual([]);
  });

  it('writes the filter and the generation time into every sheet caption', async () => {
    const buffer = await buildVoucherWorkbook({
      register: [register()],
      lines: [line()],
      filterSummary: 'Filtered: ration type DRY',
      generatedAt: '2026-11-19T10:00:00.000Z',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    for (const name of SHEET_NAMES) {
      const caption = String(workbook.getWorksheet(name)!.getCell('A1').value);
      expect(caption).toContain('Filtered: ration type DRY');
      expect(caption).toContain('2026-11-19T10:00:00.000Z');
    }
  });
});

describe('the workbook — Voucher Register', () => {
  it('carries the voucher-level fields and both destination columns', async () => {
    const workbook = await readBack([register()], []);
    const sheet = workbook.getWorksheet('Voucher Register')!;

    expect(headers(sheet)).toEqual([
      'Voucher number', 'Selection reference', 'RIK ID', 'Officer name', 'Mobile number',
      'Ration type', 'Fulfilment mode', 'Pickup location', 'Delivery address',
      'Status', 'Status code', 'Issue period', 'Issue date', 'Created at',
    ]);
    const row = dataRows(sheet)[0]!;
    expect(row[0]).toBe('RIK-V-0001');
    expect(row[7]).toBe('');                       // no pickup location on a delivery
    expect(row[8]).toBe('Qtr B-12, Near temple');
    expect(row[9]).toBe('Ready for delivery');
    expect(row[10]).toBe('READY_FOR_DELIVERY');
  });

  it('fills the pickup column and leaves the address empty for a pickup voucher', async () => {
    const workbook = await readBack(
      [register({ fulfillmentMode: 'PICKUP', pickupLocationName: 'Main Store', deliveryAddress: null })],
      []
    );
    const row = dataRows(workbook.getWorksheet('Voucher Register')!)[0]!;

    expect(row[7]).toBe('Main Store');
    expect(row[8]).toBe('');
  });

  it('writes the issue date as the server’s own ISO text, not a locale-shifted date cell', async () => {
    const workbook = await readBack([register()], []);
    const cell = workbook.getWorksheet('Voucher Register')!.getCell('M3');

    // A real date cell would be re-rendered in the reader's timezone, and a
    // ration issued at 00:30 would move a day for a reader elsewhere.
    expect(typeof cell.value).toBe('string');
    expect(cell.value).toBe('2026-11-02T09:00:00.000Z');
  });
});

describe('the workbook — the two lane sheets', () => {
  it('sends delivery lines to Home Delivery and pickup lines to Store Pickup, never both', async () => {
    const workbook = await readBack(
      [register(), register({ voucherNumber: 'RIK-V-0002', fulfillmentMode: 'PICKUP', pickupLocationName: 'Main Store', deliveryAddress: null })],
      [
        line(),
        line({ voucherNumber: 'RIK-V-0002', fulfillmentMode: 'PICKUP', destination: 'Main Store' }),
      ]
    );

    expect(dataRows(workbook.getWorksheet('Home Delivery')!).map((r) => r[0])).toEqual(['RIK-V-0001']);
    expect(dataRows(workbook.getWorksheet('Store Pickup')!).map((r) => r[0])).toEqual(['RIK-V-0002']);
  });

  it('shows quantity and configured pack size in separate columns and divides neither by the other', async () => {
    const workbook = await readBack(
      [register()],
      [line({ provisionId: 'prov-atta', provisionCode: 'ATTA', provisionName: 'Atta', quantity: 9000, unit: 'g', packSize: 1000, packUnit: 'packet' })]
    );
    const sheet = workbook.getWorksheet('Home Delivery')!;
    const row = dataRows(sheet)[0]!;

    expect(headers(sheet)).toContain('Configured pack size');
    expect(headers(sheet).some((h) => /pack/i.test(h) && /required|needed|count|round/i.test(h))).toBe(false);
    expect(row[11]).toBe(9000);   // quantity, untouched
    expect(row[13]).toBe(1000);   // pack size, as configured
    // 9000 / 1000 = 9 appears nowhere: rounding a part pack is a business
    // rule this phase was not given.
    expect(row).not.toContain(9);
  });

  it('writes an unconfigured pack size as empty, never as 0 or 1', async () => {
    const workbook = await readBack([register()], [line({ packSize: null, packUnit: null })]);
    const row = dataRows(workbook.getWorksheet('Home Delivery')!)[0]!;

    expect(row[13] === null || row[13] === undefined || row[13] === '').toBe(true);
    expect(row[13]).not.toBe(0);
    expect(row[13]).not.toBe(1);
  });

  it('keeps a quantity a NUMBER so the store can total a column itself', async () => {
    const workbook = await readBack([register()], [line({ quantity: 9000.5 })]);
    expect(workbook.getWorksheet('Home Delivery')!.getCell('L3').value).toBe(9000.5);
  });

  it('writes an address beginning with = as text, not as a formula', async () => {
    const workbook = await readBack(
      [register({ deliveryAddress: '=Qtr B-12' })],
      [line({ destination: '=Qtr B-12' })]
    );
    const cell = workbook.getWorksheet('Home Delivery')!.getCell('E3');

    // xlsx cells are explicitly typed, so a string stays a string — but an
    // export that fed a spreadsheet a formula would be a real hazard, and
    // this is the assertion that would catch a regression into one.
    expect(cell.formula).toBeUndefined();
    expect(cell.value).toBe('=Qtr B-12');
  });

  it('carries a comma and a newline in an address without splitting the row', async () => {
    const workbook = await readBack(
      [register()],
      [line({ destination: 'Qtr B-12, Block C\nNear the temple' })]
    );
    const rows = dataRows(workbook.getWorksheet('Home Delivery')!);

    expect(rows).toHaveLength(1);
    expect(rows[0]![4]).toBe('Qtr B-12, Block C\nNear the temple');
  });
});

describe('summariseProvisions — consolidation that cannot cross a unit', () => {
  it('adds the same provision across vouchers, splitting delivery from pickup', () => {
    const rows = summariseProvisions([
      line({ voucherNumber: 'V1', quantity: 9000, fulfillmentMode: 'DELIVERY' }),
      line({ voucherNumber: 'V2', quantity: 8000, fulfillmentMode: 'PICKUP' }),
      line({ voucherNumber: 'V3', quantity: 1000, fulfillmentMode: 'DELIVERY' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provisionCode: 'RICE',
      unit: 'g',
      deliveryQuantity: 10000,
      pickupQuantity: 8000,
      totalQuantity: 18000,
      voucherCount: 3,
    });
  });

  it('NEVER merges the same provision recorded in two different units', () => {
    const rows = summariseProvisions([
      line({ voucherNumber: 'V1', quantity: 9000, unit: 'g' }),
      line({ voucherNumber: 'V2', quantity: 4, unit: 'piece' }),
    ]);

    // Two rows, two units. 9004 is not a quantity of anything.
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.unit, r.totalQuantity])).toEqual(
      expect.arrayContaining([['g', 9000], ['piece', 4]])
    );
  });

  it('keeps two generations of a pack size apart instead of adopting the first seen', () => {
    // Vouchers in one export can span months, and each replays the
    // configuration frozen at ITS confirmation.
    const rows = summariseProvisions([
      line({ voucherNumber: 'V1', quantity: 2000, packSize: 1000, packUnit: 'packet' }),
      line({ voucherNumber: 'V2', quantity: 2500, packSize: 500, packUnit: 'packet' }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.packSize).sort((a, b) => Number(a) - Number(b))).toEqual([500, 1000]);
  });

  it('separates FRESH from DRY even for the same provision id', () => {
    const rows = summariseProvisions([
      line({ rationType: 'DRY', quantity: 1000 }),
      line({ rationType: 'FRESH', quantity: 2000, voucherNumber: 'V2' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('counts a voucher once however many of its lines name the provision', () => {
    const rows = summariseProvisions([
      line({ voucherNumber: 'V1', quantity: 1000 }),
      line({ voucherNumber: 'V1', quantity: 500 }),
    ]);
    expect(rows[0]).toMatchObject({ totalQuantity: 1500, voucherCount: 1 });
  });

  it('is empty for no lines', () => {
    expect(summariseProvisions([])).toEqual([]);
  });
});

describe('summariseDeliveries — the driver’s manifest', () => {
  it('lists delivery vouchers only, with a LINE COUNT rather than a quantity', () => {
    const rows = summariseDeliveries(
      [
        register({ voucherNumber: 'V1' }),
        register({ voucherNumber: 'V2', fulfillmentMode: 'PICKUP', pickupLocationName: 'Main Store', deliveryAddress: null }),
      ],
      [
        line({ voucherNumber: 'V1' }),
        line({ voucherNumber: 'V1', provisionId: 'prov-atta', unit: 'piece', quantity: 4 }),
        line({ voucherNumber: 'V2', fulfillmentMode: 'PICKUP' }),
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ voucherNumber: 'V1', provisionLines: 2 });
    // Deliberately no quantity field: this voucher's lines are in grams and
    // pieces, and there is no single number to put here.
    expect(rows[0]).not.toHaveProperty('totalQuantity');
  });

  it('keeps a delivery voucher whose lines are missing, showing zero lines', () => {
    const rows = summariseDeliveries([register({ voucherNumber: 'V1' })], []);
    expect(rows[0]).toMatchObject({ voucherNumber: 'V1', provisionLines: 0 });
  });

  it('states a missing address rather than printing nothing on a manifest', () => {
    const rows = summariseDeliveries([register({ deliveryAddress: null })], []);
    expect(rows[0]!.deliveryAddress).toBe('No address recorded');
  });

  it('gives the sheet blank signature and remarks columns for the round', async () => {
    const workbook = await readBack([register()], [line()]);
    const sheet = workbook.getWorksheet('Delivery Summary')!;

    expect(headers(sheet)).toContain('Handed over (signature)');
    expect(headers(sheet)).toContain('Remarks');
    const row = dataRows(sheet)[0]!;
    expect(row[9]).toBe('');
    expect(row[10]).toBe('');
  });
});
