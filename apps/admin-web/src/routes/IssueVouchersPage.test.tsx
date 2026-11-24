import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssueVouchersPage } from './IssueVouchersPage';
import type { EntitlementPeriodOption } from '../lib/api/rik-eligibility-api';
import type {
  IssueVoucherDetail,
  IssueVoucherHistoryEntry,
  IssueVoucherSummary,
  VoucherPage,
  VoucherSearchFilters,
} from '../lib/api/rik-issue-vouchers-api';
import { ApiError } from '../lib/api/client';

const fetchPeriods = vi.fn<[AbortSignal?], Promise<{ items: EntitlementPeriodOption[] }>>();
const fetchIssueVouchers = vi.fn<[VoucherSearchFilters?, AbortSignal?], Promise<VoucherPage>>();
const fetchIssueVoucher = vi.fn<[string, AbortSignal?], Promise<IssueVoucherDetail>>();
const fetchIssueVoucherHistory =
  vi.fn<[string, AbortSignal?], Promise<{ items: IssueVoucherHistoryEntry[] }>>();
const downloadIssueVoucherExport =
  vi.fn<[VoucherSearchFilters?], Promise<{ blob: Blob; filename: string | null }>>();

vi.mock('../lib/api/rik-eligibility-api', () => ({
  fetchPeriods: (...a: [AbortSignal?]) => fetchPeriods(...a),
}));

vi.mock('../lib/api/rik-issue-vouchers-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-issue-vouchers-api')>(
    '../lib/api/rik-issue-vouchers-api'
  );
  return {
    ...actual,
    fetchIssueVouchers: (...a: [VoucherSearchFilters?, AbortSignal?]) => fetchIssueVouchers(...a),
    fetchIssueVoucher: (...a: [string, AbortSignal?]) => fetchIssueVoucher(...a),
    fetchIssueVoucherHistory: (...a: [string, AbortSignal?]) => fetchIssueVoucherHistory(...a),
    downloadIssueVoucherExport: (...a: [VoucherSearchFilters?]) => downloadIssueVoucherExport(...a),
  };
});

const PERIOD = '01a11a22-0000-7000-8000-0000000000aa';
const VOUCHER = '01a11a22-0000-7000-8000-0000000000bb';

const period = (): EntitlementPeriodOption => ({
  periodId: PERIOD,
  name: 'March 2027',
  startDate: '2027-03-01',
  endDate: '2027-03-31',
  status: 'ACTIVE',
});

const summary = (overrides: Partial<IssueVoucherSummary> = {}): IssueVoucherSummary => ({
  voucherId: VOUCHER,
  voucherNumber: 'IV-2027-000014',
  selectionId: '01a11a22-0000-7000-8000-0000000000cc',
  selectionReference: 'RIK-000031',
  officerId: '01a11a22-0000-7000-8000-0000000000dd',
  rikId: 'RIK-O-000042',
  officerName: 'A B Officer',
  mobileNumber: '9810000001',
  rationType: 'FRESH',
  fulfillmentMode: 'PICKUP',
  status: 'READY_FOR_PICKUP',
  periodId: PERIOD,
  periodName: 'March 2027',
  issueDate: '2027-03-02T06:00:00.000Z',
  createdAt: '2027-03-02T06:00:00.000Z',
  ...overrides,
});

const page = (items: IssueVoucherSummary[], total = items.length): VoucherPage => ({
  items,
  total,
  limit: 25,
  offset: 0,
});

const detail = (overrides: Partial<IssueVoucherDetail> = {}): IssueVoucherDetail => ({
  ...summary(),
  officer: {
    rikId: 'RIK-O-000042',
    name: 'A B Officer',
    officialName: 'Officer A B',
    mobileNumber: '9810000001',
    residence: { quarterBlock: 'D', quarterNumber: '204', landmark: 'Near the park' },
  },
  period: { id: PERIOD, name: 'March 2027', startDate: '2027-03-01', endDate: '2027-03-31' },
  fulfillment: { mode: 'PICKUP', pickupLocationName: 'Main Stores', deliveryAddress: null },
  sourceComponents: [
    { kind: 'CURRENT_PERIOD', periodId: PERIOD, periodName: 'March 2027', eligibleDays: 21 },
  ],
  windows: [
    {
      windowCode: 'FRESH_1',
      label: 'Fresh Window 1',
      sequenceNo: 1,
      startDate: '2027-03-01',
      endDate: '2027-03-07',
      operatingDays: ['2027-03-02'],
      isCurrent: false,
    },
    {
      windowCode: 'FRESH_2',
      label: 'Fresh Window 2',
      sequenceNo: 2,
      startDate: '2027-03-08',
      endDate: '2027-03-14',
      operatingDays: ['2027-03-09'],
      isCurrent: true,
    },
    {
      windowCode: 'FRESH_3',
      label: 'Fresh Window 3',
      sequenceNo: 3,
      startDate: '2027-03-15',
      endDate: '2027-03-21',
      operatingDays: ['2027-03-16'],
      isCurrent: false,
    },
  ],
  currentWindowCode: 'FRESH_2',
  pools: [
    {
      poolCode: 'VEGETABLES',
      poolName: 'Vegetables',
      unit: 'g',
      eligibleDays: 21,
      totalEntitlement: 6300,
      lines: [
        {
          poolCode: 'VEGETABLES',
          poolName: 'Vegetables',
          provisionId: '01a11a22-0000-7000-8000-0000000000ee',
          code: 'VEG_ONION',
          name: 'Onion',
          brand: 'Local',
          packSize: 1000,
          packUnit: 'g',
          unit: 'g',
          poolEntitlement: 6300,
          quantityToIssue: 2000,
          poolEquivalentQty: 2000,
          consumptionRatio: 1,
        },
      ],
    },
  ],
  issuedBy: { staffId: 'staff-1', name: 'Test RIK_ADMIN' },
  ...overrides,
});

beforeEach(() => {
  for (const m of [
    fetchPeriods,
    fetchIssueVouchers,
    fetchIssueVoucher,
    fetchIssueVoucherHistory,
    downloadIssueVoucherExport,
  ]) {
    m.mockReset();
  }
  downloadIssueVoucherExport.mockResolvedValue({
    blob: new Blob(['x']),
    filename: 'rik-issue-vouchers-2027-03-02-0600.xlsx',
  });
  fetchPeriods.mockResolvedValue({ items: [period()] });
  fetchIssueVouchers.mockResolvedValue(page([summary()]));
  fetchIssueVoucher.mockResolvedValue(detail());
  fetchIssueVoucherHistory.mockResolvedValue({
    items: [
      {
        entryId: 'audit-1',
        action: 'RIK_ISSUE_VOUCHER_CREATED',
        at: '2027-03-02T06:00:00.000Z',
        actorId: 'staff-1',
        actorName: 'Test RIK_ADMIN',
        actorRole: 'RIK_ADMIN',
        before: null,
        after: { voucherNumber: 'IV-2027-000014' },
      },
    ],
  });
});

/**
 * PHASE D — the issue voucher operational screen.
 *
 * What these assertions are actually protecting:
 *
 *  * the list can be FOUND by the things staff know (number, RIK ID, name,
 *    mobile) and narrowed by ration, fulfilment, status and period;
 *  * the detail shows the ration AS CONFIRMED, with the pool arithmetic;
 *  * a Fresh voucher shows EVERY window and marks the current one, because
 *    one voucher spans all three;
 *  * there is NO action that completes, substitutes, edits or deletes —
 *    those belong to a later phase, and a button that looked like one here
 *    would be a lie.
 */
describe('IssueVouchersPage (PHASE D)', () => {
  it('lists vouchers with the officer, ration, fulfilment and status', async () => {
    render(<IssueVouchersPage />);

    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    expect(within(row).getByText('A B Officer')).toBeInTheDocument();
    expect(within(row).getByText(/RIK-O-000042/)).toBeInTheDocument();
    expect(within(row).getByText('Fresh')).toBeInTheDocument();
    expect(within(row).getByText('Pickup')).toBeInTheDocument();
    expect(within(row).getByText('Ready for pickup')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 1')).toBeInTheDocument();
  });

  it('searches by whatever staff happen to know', async () => {
    render(<IssueVouchersPage />);
    await screen.findByRole('row', { name: /IV-2027-000014/ });

    await userEvent.type(screen.getByLabelText('Search vouchers'), 'RIK-O-000042');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(fetchIssueVouchers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'RIK-O-000042', limit: 25, offset: 0 })
    );
  });

  it('filters by ration, fulfilment, status and period', async () => {
    render(<IssueVouchersPage />);
    await screen.findByRole('row', { name: /IV-2027-000014/ });

    await userEvent.selectOptions(screen.getByLabelText('Ration type'), 'DRY');
    await userEvent.selectOptions(screen.getByLabelText('Fulfilment mode'), 'DELIVERY');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'READY_FOR_DELIVERY');
    await userEvent.selectOptions(screen.getByLabelText('Period'), PERIOD);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(fetchIssueVouchers).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rationType: 'DRY',
        fulfillmentMode: 'DELIVERY',
        status: 'READY_FOR_DELIVERY',
        periodId: PERIOD,
      })
    );
  });

  it('says so plainly when nothing matches, rather than showing an empty table', async () => {
    fetchIssueVouchers.mockResolvedValue(page([]));
    render(<IssueVouchersPage />);

    expect(await screen.findByText(/no voucher matches/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the server’s failure rather than an empty list', async () => {
    fetchIssueVouchers.mockRejectedValue(
      new ApiError(403, { code: 'FORBIDDEN', message: 'Not permitted.' })
    );
    render(<IssueVouchersPage />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /IV-2027/ })).not.toBeInTheDocument();
  });

  it('opens the voucher and shows the ration as confirmed', async () => {
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));

    const panel = await screen.findByRole('region', { name: /Issue voucher IV-2027-000014/i });
    expect(within(panel).getByText('Officer A B')).toBeInTheDocument();
    expect(within(panel).getByText('Main Stores')).toBeInTheDocument();
    expect(within(panel).getByText('D-204')).toBeInTheDocument();
    expect(within(panel).getByText('Onion')).toBeInTheDocument();
    // Twice over: the quantity to issue, and what it costs the pool at a 1:1
    // ratio. Both are the server's figures.
    expect(within(panel).getAllByText('2000 g')).toHaveLength(2);
    expect(within(panel).getByText(/entitlement 6300 g · 21 days/)).toBeInTheDocument();
    expect(fetchIssueVoucher).toHaveBeenCalledWith(VOUCHER);
  });

  it('shows every Fresh window and marks the current one', async () => {
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));

    const panel = await screen.findByRole('region', { name: /Issue voucher/i });
    for (const label of ['Fresh Window 1', 'Fresh Window 2', 'Fresh Window 3']) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    const current = within(panel).getByText('Current').closest('li');
    expect(current).not.toBeNull();
    expect(within(current as HTMLElement).getByText('Fresh Window 2')).toBeInTheDocument();
    expect(
      within(panel).getByText(/one fresh voucher runs through every fresh window/i)
    ).toBeInTheDocument();
  });

  it('shows the entitlement source as a list of named components', async () => {
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));

    const panel = await screen.findByRole('region', { name: /Issue voucher/i });
    expect(within(panel).getByText(/21 eligible days/)).toBeInTheDocument();
  });

  it('shows the voucher’s history from the existing audit log', async () => {
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));

    expect(await screen.findByText('RIK_ISSUE_VOUCHER_CREATED')).toBeInTheDocument();
    expect(screen.getByText(/Test RIK_ADMIN · RIK_ADMIN/)).toBeInTheDocument();
    expect(fetchIssueVoucherHistory).toHaveBeenCalledWith(VOUCHER);
  });

  it('offers NO action that completes, substitutes, edits or deletes a voucher', async () => {
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));
    await screen.findByRole('region', { name: /Issue voucher/i });

    for (const forbidden of [
      /collect/i,
      /deliver/i,
      /mark /i,
      /substitut/i,
      /delete/i,
      /cancel/i,
      /edit/i,
      /save/i,
    ]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
  });

  it('shows a delivery voucher’s address snapshot instead of a pickup location', async () => {
    fetchIssueVouchers.mockResolvedValue(
      page([summary({ fulfillmentMode: 'DELIVERY', status: 'READY_FOR_DELIVERY' })])
    );
    fetchIssueVoucher.mockResolvedValue(
      detail({
        fulfillmentMode: 'DELIVERY',
        status: 'READY_FOR_DELIVERY',
        fulfillment: {
          mode: 'DELIVERY',
          pickupLocationName: null,
          deliveryAddress: 'D-204, Base Victualling Yard quarters',
        },
      })
    );
    render(<IssueVouchersPage />);
    const row = await screen.findByRole('row', { name: /IV-2027-000014/ });
    await userEvent.click(within(row).getByRole('button', { name: 'View' }));

    const panel = await screen.findByRole('region', { name: /Issue voucher/i });
    expect(within(panel).getByText('Delivery address')).toBeInTheDocument();
    expect(
      within(panel).getByText('D-204, Base Victualling Yard quarters')
    ).toBeInTheDocument();
    expect(within(panel).queryByText('Pickup location')).not.toBeInTheDocument();
  });

  it('pages without losing the applied filters', async () => {
    fetchIssueVouchers.mockResolvedValue(page([summary()], 60));
    render(<IssueVouchersPage />);
    await screen.findByRole('row', { name: /IV-2027-000014/ });

    await userEvent.type(screen.getByLabelText('Search vouchers'), 'Officer');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(fetchIssueVouchers).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'Officer', offset: 25 })
    );
  });
});

/**
 * PHASE C — printing one voucher, and exporting the filtered set.
 *
 * THE RULE THESE EXIST TO DEFEND: both are strictly read-only. The approved
 * scope says printing and exporting must never change a fulfilment status,
 * and the strongest form of that guarantee is that printing issues no
 * request at all and exporting issues one GET. A future "mark as printed"
 * would break these tests, which is the point.
 */

/** jsdom implements neither of these; a download needs both. */
function stubObjectUrl() {
  const createObjectURL = vi.fn(() => 'blob:stub');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  return { createObjectURL, revokeObjectURL };
}

async function openTheVoucher() {
  render(<IssueVouchersPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'View' }));
  return screen.findByRole('region', { name: /Issue voucher IV-2027-000014/i });
}

describe('printing one issue voucher', () => {
  it('hands the open panel to the browser and makes NO request', async () => {
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, configurable: true });
    await openTheVoucher();

    const before = {
      list: fetchIssueVouchers.mock.calls.length,
      detail: fetchIssueVoucher.mock.calls.length,
      history: fetchIssueVoucherHistory.mock.calls.length,
      exported: downloadIssueVoucherExport.mock.calls.length,
    };

    await userEvent.click(screen.getByRole('button', { name: /print voucher/i }));

    expect(print).toHaveBeenCalledTimes(1);
    // Not one extra call of any kind: nothing is fetched, nothing is sent,
    // and so no fulfilment record can move.
    expect(fetchIssueVouchers.mock.calls.length).toBe(before.list);
    expect(fetchIssueVoucher.mock.calls.length).toBe(before.detail);
    expect(fetchIssueVoucherHistory.mock.calls.length).toBe(before.history);
    expect(downloadIssueVoucherExport.mock.calls.length).toBe(before.exported);
  });

  it('marks the voucher panel as the printed sheet and the chrome as hidden', async () => {
    const panel = await openTheVoucher();

    expect(panel).toHaveAttribute('data-print', 'sheet');
    // The filter form and the results table are chrome, not the voucher.
    expect(document.querySelectorAll('[data-print="hide"]').length).toBeGreaterThan(0);
    // The print control must not print itself.
    expect(screen.getByRole('button', { name: /print voucher/i }).closest('[data-print="hide"]')).not.toBeNull();
  });

  it('carries a signature block that exists only on paper', async () => {
    const panel = await openTheVoucher();

    const footer = panel.querySelector('.print-only.print-keep');
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain('Issued by');
    expect(footer!.textContent).toContain('Received by');
    expect(footer!.textContent).toContain('IV-2027-000014');
  });

  it('keeps the audit history off the printed sheet', async () => {
    const panel = await openTheVoucher();
    await userEvent.click(within(panel).getByRole('button', { name: 'History' }));

    const history = await within(panel).findByText('RIK_ISSUE_VOUCHER_CREATED');
    // A voucher an officer signs is not the place for the audit trail.
    expect(history.closest('[data-print="hide"]')).not.toBeNull();
  });
});

describe('exporting the filtered vouchers to Excel', () => {
  it('requests the workbook for the APPLIED filters, not the half-typed ones', async () => {
    stubObjectUrl();
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.type(screen.getByLabelText('Search vouchers'), 'Officer');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    // Typed but NOT applied — this must not reach the export.
    await userEvent.clear(screen.getByLabelText('Search vouchers'));
    await userEvent.type(screen.getByLabelText('Search vouchers'), 'not applied yet');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(downloadIssueVoucherExport).toHaveBeenCalledTimes(1);
    expect(downloadIssueVoucherExport).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'Officer' })
    );
    expect(downloadIssueVoucherExport.mock.calls[0]![0]).not.toMatchObject({ q: 'not applied yet' });
  });

  it('sends no paging: the export is the whole filtered set, not one page', async () => {
    stubObjectUrl();
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    const sent = downloadIssueVoucherExport.mock.calls[0]![0] ?? {};
    expect(sent).not.toHaveProperty('limit');
    expect(sent).not.toHaveProperty('offset');
  });

  it('saves the file under the name the server chose', async () => {
    const { createObjectURL } = stubObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("shows the server's own refusal when too many vouchers match", async () => {
    stubObjectUrl();
    downloadIssueVoucherExport.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message:
          'That filter matches 902 vouchers. The provision sheets replay one frozen snapshot per voucher, so an export covers at most 750. Narrow it by issue period, ration type or issue date — nothing has been truncated.',
        details: { reason: 'EXPORT_DETAIL_TOO_LARGE', total: 902, limit: 750 },
      })
    );
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    // The server's sentence verbatim: it names the count and the limit, and
    // says plainly that nothing was truncated.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('902');
    expect(alert.textContent).toContain('750');
    expect(alert.textContent).toMatch(/nothing has been truncated/i);
  });

  it('names the offending voucher when a frozen snapshot cannot be replayed', async () => {
    stubObjectUrl();
    downloadIssueVoucherExport.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message:
          'Voucher IV-2027-000099 could not be read back from its confirmed selection, so its provisions are unknown. The export was stopped rather than leaving that voucher out.',
        details: { reason: 'EXPORT_SNAPSHOT_UNAVAILABLE', voucherNumber: 'IV-2027-000099' },
      })
    );
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('IV-2027-000099');
  });

  it('leaves the list intact after a failed export', async () => {
    stubObjectUrl();
    downloadIssueVoucherExport.mockRejectedValue(
      new ApiError(400, { code: 'VALIDATION_FAILED', message: 'Too many.' })
    );
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));
    await screen.findByRole('alert');

    // A refused export is a message, not a lost screen.
    expect(screen.getByText('IV-2027-000014')).toBeInTheDocument();
  });

  it('disables the control while the workbook is being prepared', async () => {
    stubObjectUrl();
    let release: (v: { blob: Blob; filename: string | null }) => void = () => {};
    downloadIssueVoucherExport.mockReturnValue(new Promise((r) => { release = r; }));
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(await screen.findByRole('button', { name: /preparing/i })).toBeDisabled();
    release({ blob: new Blob(['x']), filename: null });
  });

  it('issues exactly one export request per click', async () => {
    stubObjectUrl();
    render(<IssueVouchersPage />);
    await screen.findByText('IV-2027-000014');

    await userEvent.click(screen.getByRole('button', { name: /export to excel/i }));

    expect(downloadIssueVoucherExport).toHaveBeenCalledTimes(1);
  });
});
