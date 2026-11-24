import ExcelJS from 'exceljs';
import {
  RikVoucherExportService,
  VoucherExportError,
  describeFilters,
  DETAIL_MAX,
  EXPORT_PAGE_SIZE,
  REGISTER_MAX,
} from './rik-voucher-export.service';
import type { RikIssueVoucherService } from './rik-issue-voucher.service';
import type {
  IssueVoucherRecord,
  IssueVouchersRepository,
} from '../repositories/issue-vouchers.repository';

/**
 * The export's four promises, under test:
 *
 *   1. It REFUSES rather than truncates, and says by how much.
 *   2. It FAILS BY NAME when a frozen snapshot cannot be replayed, rather
 *      than quietly producing a packing list one officer short.
 *   3. It reads the SAME set the screen shows — one filter object, used for
 *      the count and for every page.
 *   4. It WRITES NOTHING.
 *
 * Promise 2 is the one that matters most operationally and is the easiest
 * to "improve" into a silent skip later, which is why it is pinned three
 * ways: the throw, the code, and the voucher number in the detail.
 */

function voucher(over: Partial<IssueVoucherRecord> = {}): IssueVoucherRecord {
  return {
    id: 'v-1',
    voucher_number: 'RIK-V-0001',
    selection_id: 'sel-1',
    selection_reference: 'RIK-000001',
    customer_id: 'cust-1',
    rik_id: 'RIK-0001',
    officer_name: 'Kiran Yadav',
    officer_official_name: null,
    mobile_number: '9000000001',
    quarter_block: 'B',
    quarter_number: '12',
    landmark: null,
    period_id: 'p1',
    period_name: 'November 2026',
    period_start_date: '2026-11-01',
    period_end_date: '2026-11-30',
    ration_type: 'DRY',
    fulfillment_mode: 'DELIVERY',
    pickup_location_id: null,
    pickup_location_name: null,
    delivery_address: 'Qtr B-12',
    status: 'READY_FOR_DELIVERY',
    created_at: '2026-11-02T09:00:00.000Z',
    created_by: 'staff-1',
    created_by_name: 'Admin',
    released_at: '2026-11-02T09:00:00.000Z',
    released_by: 'staff-1',
    updated_at: '2026-11-02T09:00:00.000Z',
    ...over,
  };
}

const POOLS = [
  {
    poolCode: 'CEREALS',
    poolName: 'Cereals',
    unit: 'g',
    eligibleDays: 30,
    totalEntitlement: 9000,
    lines: [
      {
        poolCode: 'CEREALS',
        poolName: 'Cereals',
        provisionId: 'prov-rice',
        code: 'RICE',
        name: 'Rice',
        brand: 'Sona',
        packSize: null,
        packUnit: null,
        unit: 'g',
        poolEntitlement: 9000,
        quantityToIssue: 9000,
        poolEquivalentQty: 9000,
        consumptionRatio: 1,
      },
    ],
  },
];

function serviceWith(opts: {
  total?: number;
  pages?: IssueVoucherRecord[][];
  rows?: IssueVoucherRecord[];
  poolsFor?: (selectionId: string) => unknown;
}) {
  const rows = opts.rows ?? [voucher()];
  const count = jest.fn().mockResolvedValue(opts.total ?? rows.length);

  const search = jest.fn().mockImplementation(async (filters: { offset: number; limit: number }) => {
    if (opts.pages) return opts.pages[Math.floor(filters.offset / filters.limit)] ?? [];
    return rows.slice(filters.offset, filters.offset + filters.limit);
  });

  const poolsForExport = jest
    .fn()
    .mockImplementation(async (selectionId: string) =>
      opts.poolsFor ? opts.poolsFor(selectionId) : POOLS
    );

  const service = new RikVoucherExportService(
    { count, search } as unknown as IssueVouchersRepository,
    { poolsForExport } as unknown as RikIssueVoucherService
  );
  return { service, count, search, poolsForExport };
}

async function sheetsOf(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

describe('RikVoucherExportService — refusing rather than truncating', () => {
  it('refuses above the register ceiling, naming the count and the limit', async () => {
    const { service, search } = serviceWith({ total: REGISTER_MAX + 1 });

    await expect(service.build({})).rejects.toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      detail: { total: REGISTER_MAX + 1, limit: REGISTER_MAX },
    });
    // Checked BEFORE anything is read: an over-large request costs one
    // count query, not thousands of rows and replays.
    expect(search).not.toHaveBeenCalled();
  });

  it('refuses above the detail-replay ceiling, and says nothing was truncated', async () => {
    const { service, poolsForExport } = serviceWith({ total: DETAIL_MAX + 1 });

    const error = await service.build({}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoucherExportError);
    expect((error as VoucherExportError).code).toBe('EXPORT_DETAIL_TOO_LARGE');
    expect((error as VoucherExportError).message).toMatch(/nothing has been truncated/i);
    expect((error as VoucherExportError).message).toContain(String(DETAIL_MAX));
    expect(poolsForExport).not.toHaveBeenCalled();
  });

  it('accepts a request exactly ON the detail ceiling', async () => {
    const rows = Array.from({ length: DETAIL_MAX }, (_, i) =>
      voucher({ id: `v-${i}`, voucher_number: `RIK-V-${i}`, selection_id: `sel-${i}` })
    );
    const { service } = serviceWith({ rows, total: DETAIL_MAX });

    // A boundary that refused the permitted maximum would be an off-by-one
    // an operator could never diagnose from the message.
    await expect(service.build({})).resolves.toBeInstanceOf(Buffer);
  });
});

describe('RikVoucherExportService — a snapshot that cannot be replayed', () => {
  it('fails the WHOLE export and names the voucher, rather than leaving it out', async () => {
    const rows = [
      voucher({ id: 'v-1', voucher_number: 'RIK-V-0001', selection_id: 'sel-1' }),
      voucher({ id: 'v-2', voucher_number: 'RIK-V-0099', selection_id: 'sel-2', selection_reference: 'RIK-000099' }),
    ];
    const { service } = serviceWith({
      rows,
      poolsFor: (selectionId) => (selectionId === 'sel-2' ? null : POOLS),
    });

    const error = (await service.build({}).catch((e: unknown) => e)) as VoucherExportError;

    expect(error).toBeInstanceOf(VoucherExportError);
    expect(error.code).toBe('EXPORT_SNAPSHOT_UNAVAILABLE');
    // The voucher number is what the operator searches for next.
    expect(error.message).toContain('RIK-V-0099');
    expect(error.detail).toMatchObject({ voucherNumber: 'RIK-V-0099', selectionReference: 'RIK-000099' });
  });

  it('treats a replay that comes back empty as unavailable too', async () => {
    // A voucher is only created when there is something of its ration type
    // to issue, so a voucher that now replays to nothing has lost its basis
    // — it is not a voucher for nothing.
    const { service } = serviceWith({ poolsFor: () => [] });

    await expect(service.build({})).rejects.toMatchObject({
      code: 'EXPORT_SNAPSHOT_UNAVAILABLE',
    });
  });

  it('produces no file at all when one voucher fails', async () => {
    const rows = [voucher({ selection_id: 'sel-1' }), voucher({ id: 'v-2', voucher_number: 'RIK-V-0002', selection_id: 'sel-2' })];
    const { service } = serviceWith({ rows, poolsFor: (s) => (s === 'sel-2' ? null : POOLS) });

    const result = await service.build({}).then(() => 'A FILE WAS PRODUCED').catch(() => 'refused');

    expect(result).toBe('refused');
  });
});

describe('RikVoucherExportService — the same set the screen shows', () => {
  it('passes one filter object to the count and to every page', async () => {
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 3 }, (_, i) =>
      voucher({ id: `v-${i}`, voucher_number: `RIK-V-${i}`, selection_id: `sel-${i}` })
    );
    const { service, count, search } = serviceWith({ rows, total: rows.length });
    const filters = { rationType: 'DRY', fulfillmentMode: 'DELIVERY', periodId: 'p1' } as const;

    await service.build({ ...filters });

    expect(count).toHaveBeenCalledWith(filters);
    for (const call of search.mock.calls) {
      expect(call[0]).toMatchObject(filters);
    }
  });

  it('pages until the total is covered', async () => {
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 3 }, (_, i) =>
      voucher({ id: `v-${i}`, voucher_number: `RIK-V-${i}`, selection_id: `sel-${i}` })
    );
    const { service, search } = serviceWith({ rows, total: rows.length });

    const workbook = await sheetsOf(await service.build({}));

    expect(search).toHaveBeenCalledTimes(2);
    expect(workbook.getWorksheet('Voucher Register')!.rowCount).toBe(2 + rows.length);
  });

  it('stops on a short page even if the reported total is stale', async () => {
    // A voucher created between the count and the first page would otherwise
    // leave this looping against an empty final page for ever.
    const { service, search } = serviceWith({
      total: EXPORT_PAGE_SIZE * 3,
      pages: [[voucher()], []],
    });

    await service.build({});

    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe('RikVoucherExportService — read-only, and the file it makes', () => {
  it('calls only count, search and the snapshot replay — nothing that writes', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const search = jest.fn().mockResolvedValue([voucher()]);
    const poolsForExport = jest.fn().mockResolvedValue(POOLS);
    const repo = { count, search } as unknown as IssueVouchersRepository;
    const vouchers = { poolsForExport } as unknown as RikIssueVoucherService;

    await new RikVoucherExportService(repo, vouchers).build({});

    // The repository double exposes NOTHING else, so a call to `create` or
    // any write would have thrown rather than silently succeeded.
    expect(Object.keys(repo)).toEqual(['count', 'search']);
    expect(Object.keys(vouchers)).toEqual(['poolsForExport']);
  });

  it('builds a five-sheet workbook from one delivery and one pickup voucher', async () => {
    const rows = [
      voucher({ id: 'v-1', voucher_number: 'RIK-V-0001', selection_id: 'sel-1' }),
      voucher({
        id: 'v-2', voucher_number: 'RIK-V-0002', selection_id: 'sel-2',
        fulfillment_mode: 'PICKUP', pickup_location_name: 'Main Store', delivery_address: null,
        status: 'READY_FOR_PICKUP',
      }),
    ];
    const { service } = serviceWith({ rows });

    const workbook = await sheetsOf(await service.build({}));

    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Voucher Register', 'Home Delivery', 'Store Pickup', 'Provision Summary', 'Delivery Summary',
    ]);
    expect(workbook.getWorksheet('Voucher Register')!.rowCount).toBe(4);   // caption + header + 2
    expect(workbook.getWorksheet('Home Delivery')!.rowCount).toBe(3);
    expect(workbook.getWorksheet('Store Pickup')!.rowCount).toBe(3);
    // One provision across both lanes consolidates to a single row.
    expect(workbook.getWorksheet('Provision Summary')!.rowCount).toBe(3);
    expect(workbook.getWorksheet('Delivery Summary')!.rowCount).toBe(3);
  });

  it('reports the officer’s official name first, exactly as the list does', async () => {
    const { service } = serviceWith({
      rows: [voucher({ officer_name: 'Kiran Yadav', officer_official_name: 'Lt Cdr K Yadav' })],
    });

    const workbook = await sheetsOf(await service.build({}));

    expect(workbook.getWorksheet('Voucher Register')!.getCell('D3').value).toBe('Lt Cdr K Yadav');
  });

  it('takes the destination from the voucher snapshot, per lane', async () => {
    const { service } = serviceWith({
      rows: [voucher({ fulfillment_mode: 'PICKUP', pickup_location_name: 'Main Store', delivery_address: null })],
    });

    const workbook = await sheetsOf(await service.build({}));

    expect(workbook.getWorksheet('Store Pickup')!.getCell('E3').value).toBe('Main Store');
  });
});

describe('describeFilters', () => {
  it('says so plainly when nothing is filtered', () => {
    expect(describeFilters({})).toBe('All issued vouchers');
  });

  it('names each applied filter', () => {
    const text = describeFilters({ rationType: 'DRY', fulfillmentMode: 'DELIVERY', issuedFrom: '2026-11-01' });
    expect(text).toContain('ration type DRY');
    expect(text).toContain('fulfilment DELIVERY');
    expect(text).toContain('issued from 2026-11-01');
  });

  it('does not put a search term’s surrounding whitespace into the caption', () => {
    expect(describeFilters({ q: '  kiran  ' })).toContain('search "kiran"');
  });
});

describe('the export route is declared before the parameterised one', () => {
  it('puts @Get(’export’) above @Get(’:voucherId’) in the controller source', () => {
    // Nest matches routes in DECLARATION ORDER. Below the parameterised
    // route, the literal "export" is captured as :voucherId, handed to
    // ParseUUIDPipe and rejected as a malformed UUID — a 400 that reads
    // like a client bug and is really a routing bug.
    //
    // Source order is the thing that matters, and source order is what this
    // reads. A unit test of the service could never catch it, and an
    // integration test would need a live database.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('node:path') as typeof import('node:path');

    const source = readFileSync(join(__dirname, '..', 'rik-issue-vouchers.controller.ts'), 'utf8');
    // Matched at the start of an indented line, so a DECORATOR is found and
    // not the same text quoted inside the doc comment that explains this
    // very rule \u2014 which is exactly what the first draft of this test did.
    const exportAt = source.indexOf("\n  @Get('export')");
    const paramAt = source.indexOf("\n  @Get(':voucherId')");

    expect(exportAt).toBeGreaterThan(-1);
    expect(paramAt).toBeGreaterThan(-1);
    expect(exportAt).toBeLessThan(paramAt);
  });
});
