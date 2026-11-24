import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RikIssueVouchersPage } from './RikIssueVouchersPage';
import { RikIssueVoucherPage } from './RikIssueVoucherPage';
import { ApiError } from '../../lib/api/client';
import type {
  IssueVoucherDocument,
  IssueVoucherListItem,
  VoucherIssueStatus,
} from '../../lib/api/rik-issue-voucher-api';

/**
 * PHASE D — the officer's own issue voucher.
 *
 * WHAT THESE TESTS ARE FOR. That the voucher reads as the document it
 * replaces, in the facility's own order, with the figures the server sent and
 * no arithmetic of this app's own.
 *
 * WHAT THEY ARE ALSO FOR, and this is the part a future edit could break: the
 * ABSENCES. No form, no field, no status control, no "mark collected", no
 * substitution, no cancel, no delete, and no administrative detail — no
 * issuing staff member, no audit history. The server does not send those to
 * an officer and this screen must never acquire a way to ask for them.
 *
 * Someone else's voucher is tested here as the officer experiences it: a 404
 * that reads as "not found", identical to a voucher that was never issued, so
 * an id in the address bar reveals nothing. The server-side proof that the
 * ownership check is real lives in apps/api's
 * `rik-issue-vouchers.integration.spec.ts`.
 *
 * Dates are derived at run time, never written as literals that would quietly
 * start testing the calendar.
 */

const api = vi.hoisted(() => ({
  fetchMyIssueVouchers: vi.fn(),
  fetchMyIssueVoucher: vi.fn(),
}));

vi.mock('../../lib/api/rik-issue-voucher-api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/rik-issue-voucher-api')>(
    '../../lib/api/rik-issue-voucher-api'
  );
  // The formatters are pure display and are exercised for real; only the two
  // network calls are replaced.
  return { ...actual, ...api };
});

const VOUCHER_ID = '01a11a22-0000-7000-8000-0000000000bb';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const base = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
})();
const plusDays = (n: number) =>
  iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n)));

const listItem = (overrides: Partial<IssueVoucherListItem> = {}): IssueVoucherListItem => ({
  voucherId: VOUCHER_ID,
  voucherNumber: 'IV-2027-000014',
  rationType: 'FRESH',
  fulfillmentMode: 'PICKUP',
  status: 'READY_FOR_PICKUP',
  periodName: 'This period',
  issueDate: plusDays(1),
  ...overrides,
});

const document_ = (overrides: Partial<IssueVoucherDocument> = {}): IssueVoucherDocument => ({
  voucherNumber: 'IV-2027-000014',
  selectionReference: 'RIK-000031',
  rationType: 'FRESH',
  status: 'READY_FOR_PICKUP',
  issueDate: plusDays(1),
  period: { name: 'This period', startDate: plusDays(0), endDate: plusDays(27) },
  officer: {
    rikId: 'RIK-O-000042',
    name: 'Officer A B',
    mobileNumber: '9810000001',
    residence: { quarterBlock: 'D', quarterNumber: '204', landmark: 'Near the park' },
  },
  fulfillment: { mode: 'PICKUP', pickupLocationName: 'Main Stores', deliveryAddress: null },
  sourceComponents: [
    {
      kind: 'CURRENT_PERIOD',
      periodId: '01a11a22-0000-7000-8000-0000000000aa',
      periodName: 'This period',
      eligibleDays: 21,
    },
  ],
  windows: [
    {
      windowCode: 'FRESH_1',
      label: 'Fresh Issue 1',
      sequenceNo: 1,
      startDate: plusDays(0),
      endDate: plusDays(6),
      operatingDays: [plusDays(1)],
      isCurrent: false,
    },
    {
      windowCode: 'FRESH_2',
      label: 'Fresh Issue 2',
      sequenceNo: 2,
      startDate: plusDays(7),
      endDate: plusDays(13),
      operatingDays: [plusDays(8)],
      isCurrent: true,
    },
    {
      windowCode: 'FRESH_3',
      label: 'Fresh Issue 3',
      sequenceNo: 3,
      startDate: plusDays(14),
      endDate: plusDays(20),
      operatingDays: [plusDays(15)],
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
  ...overrides,
});

const issueStatus = (overrides: Partial<VoucherIssueStatus> = {}): VoucherIssueStatus => ({
  status: 'READY_FOR_PICKUP',
  completedAt: null,
  completedOutcome: null,
  outcomeReason: null,
  issued: [],
  carryForward: [],
  lapsed: false,
  lapseReason: null,
  finalWindowCode: 'FRESH_3',
  finalWindowEndDate: plusDays(20),
  reminderDue: false,
  daysToFinalWindowClose: 12,
  ...overrides,
});

const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/rik/issue-vouchers']}>
      <Routes>
        <Route path="/rik/issue-vouchers" element={<RikIssueVouchersPage />} />
        <Route path="/rik/issue-vouchers/:voucherId" element={<RikIssueVoucherPage />} />
      </Routes>
    </MemoryRouter>
  );

const renderDocument = (id = VOUCHER_ID) =>
  render(
    <MemoryRouter initialEntries={[`/rik/issue-vouchers/${id}`]}>
      <Routes>
        <Route path="/rik/issue-vouchers/:voucherId" element={<RikIssueVoucherPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  api.fetchMyIssueVouchers.mockReset();
  api.fetchMyIssueVoucher.mockReset();
  api.fetchMyIssueVouchers.mockResolvedValue({ items: [listItem()] });
  api.fetchMyIssueVoucher.mockResolvedValue(document_());
});

describe('RikIssueVouchersPage — the officer’s own list (PHASE D)', () => {
  it('lists the officer’s vouchers with the ration and the status', async () => {
    renderList();

    expect(await screen.findByText('IV-2027-000014')).toBeInTheDocument();
    expect(screen.getByText(/Fresh ration · This period/)).toBeInTheDocument();
    expect(screen.getByText('Ready for pickup')).toBeInTheDocument();
  });

  it('says so plainly when no voucher has been issued yet', async () => {
    api.fetchMyIssueVouchers.mockResolvedValue({ items: [] });
    renderList();

    expect(await screen.findByText(/no issue voucher yet/i)).toBeInTheDocument();
  });

  it('opens the voucher document', async () => {
    renderList();
    await userEvent.click(await screen.findByText('IV-2027-000014'));

    expect(await screen.findByRole('article', { name: /Issue voucher IV-2027-000014/i })).toBeInTheDocument();
    expect(api.fetchMyIssueVoucher).toHaveBeenCalledWith(VOUCHER_ID);
  });

  it('asks only for its own list — it sends no officer id', async () => {
    renderList();
    await screen.findByText('IV-2027-000014');

    expect(api.fetchMyIssueVouchers).toHaveBeenCalledTimes(1);
    expect(api.fetchMyIssueVouchers.mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe('RikIssueVoucherPage — the document (PHASE D)', () => {
  it('reads as the facility’s own voucher, in the facility’s own order', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText('e-SAMAGRI')).toBeInTheDocument();
    expect(within(doc).getByText('Issue voucher')).toBeInTheDocument();
    expect(within(doc).getByAltText(/e Samagri/i)).toBeInTheDocument();

    const order = [
      'Voucher number',
      'Issue date',
      'Ration',
      'Issue window',
      'Fulfilment',
      'RIK ID',
      'Name',
      'Mobile',
      'Quarter',
      'Status',
      'Collect from',
    ];
    const text = doc.textContent ?? '';
    let at = -1;
    for (const label of order) {
      const next = text.indexOf(label);
      expect(next, `${label} is on the voucher`).toBeGreaterThan(-1);
      expect(next, `${label} comes after the field above it`).toBeGreaterThan(at);
      at = next;
    }
  });

  it('shows the officer’s own identity as the server sent it', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText('RIK-O-000042')).toBeInTheDocument();
    expect(within(doc).getByText('Officer A B')).toBeInTheDocument();
    expect(within(doc).getByText('9810000001')).toBeInTheDocument();
    expect(within(doc).getByText('D-204 · Near the park')).toBeInTheDocument();
    expect(within(doc).getByText('Main Stores')).toBeInTheDocument();
  });

  it('names the current issue window, and lists every Fresh window', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getAllByText('Fresh Issue 2').length).toBeGreaterThan(0);
    expect(
      within(doc).getByText(/this one voucher covers every fresh window/i)
    ).toBeInTheDocument();
    for (const label of ['Fresh Issue 1', 'Fresh Issue 3']) {
      expect(within(doc).getByText(new RegExp(label))).toBeInTheDocument();
    }
  });

  it('says so when no window is open today, without implying the voucher is void', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        currentWindowCode: null,
        windows: document_().windows.map((w) => ({ ...w, isCurrent: false })),
      })
    );
    renderDocument();

    expect(await screen.findByText(/no window is open today/i)).toBeInTheDocument();
    expect(screen.getByText(/stays valid for the windows listed below/i)).toBeInTheDocument();
  });

  it('shows what will be issued, with the pool arithmetic the server reported', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText('Onion')).toBeInTheDocument();
    expect(within(doc).getByText('Local')).toBeInTheDocument();
    expect(within(doc).getByText('2000 g')).toBeInTheDocument();
    expect(within(doc).getByText(/Pack 1000 g · 2000 g of Vegetables/)).toBeInTheDocument();
    expect(within(doc).getByText(/Entitlement 6300 g · 21 eligible days/)).toBeInTheDocument();
  });

  it('shows the entitlement used as its own named component', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    const source = within(doc).getByText('Entitlement used').closest('section');
    expect(source).not.toBeNull();
    expect(within(source as HTMLElement).getByText(/This period · 21 eligible days/)).toBeInTheDocument();
  });

  it('shows a delivery voucher’s address instead of a collection point', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        rationType: 'DRY',
        status: 'READY_FOR_DELIVERY',
        fulfillment: {
          mode: 'DELIVERY',
          pickupLocationName: null,
          deliveryAddress: 'D-204, Base Victualling Yard quarters',
        },
      })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText('Deliver to')).toBeInTheDocument();
    expect(within(doc).getByText('D-204, Base Victualling Yard quarters')).toBeInTheDocument();
    expect(within(doc).queryByText('Collect from')).not.toBeInTheDocument();
    expect(within(doc).getByText('Home delivery')).toBeInTheDocument();
    expect(within(doc).getByText('Ready for delivery')).toBeInTheDocument();
  });

  it('reads as NOT FOUND for someone else’s voucher, exactly as for one that does not exist', async () => {
    api.fetchMyIssueVoucher.mockRejectedValue(
      new ApiError(404, { code: 'NOT_FOUND', message: 'That issue voucher does not exist.' })
    );
    renderDocument('01a11a22-0000-7000-8000-00000000ffff');

    expect(await screen.findByText(/voucher not found/i)).toBeInTheDocument();
    expect(screen.getByText(/does not exist, or it is not yours/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('is READ ONLY: no form, no field, no action that changes anything', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(doc.querySelector('form')).toBeNull();
    expect(doc.querySelector('input')).toBeNull();
    expect(doc.querySelector('select')).toBeNull();
    expect(doc.querySelector('textarea')).toBeNull();

    for (const forbidden of [
      /collect/i,
      /deliver/i,
      /mark /i,
      /substitut/i,
      /cancel/i,
      /delete/i,
      /edit/i,
      /change/i,
      /save/i,
      /confirm/i,
    ]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
    // Print is the one action, and it is the browser's own.
    expect(within(doc).getByRole('button', { name: /print this voucher/i })).toBeInTheDocument();
  });

  it('carries no administrative detail — no issuing staff member, no history', async () => {
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });
    const text = doc.textContent ?? '';

    // No staff identity, no audit trail, no revision history anywhere — and
    // no label for one. The customer document type carries no such field, and
    // this is that guarantee observed on screen.
    expect(within(doc).queryByText(/^Issued by$/)).not.toBeInTheDocument();
    expect(within(doc).queryByRole('heading', { name: /history/i })).not.toBeInTheDocument();
    expect(text).not.toMatch(/RIK_ADMIN/);
    expect(text).not.toMatch(/audit/i);
    expect(text).not.toMatch(/revision/i);
  });

  it('lays out as a single mobile column, with the page gutters', async () => {
    const { container } = renderDocument();
    await screen.findByRole('article', { name: /Issue voucher/i });

    expect(container.querySelector('main')?.className).toContain('px-4');
    expect(container.querySelector('.app-shell')).not.toBeNull();
    // Nothing on the voucher scrolls sideways: no table, no fixed width.
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });
});

describe('RikIssueVoucherPage — what actually happened (PHASE E)', () => {
  it('says plainly that nothing has been issued yet, rather than implying it has', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({ issueStatus: issueStatus({ completedAt: null, issued: [] }) })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText(/nothing has been recorded as issued yet/i)).toBeInTheDocument();
    expect(
      within(doc).getByText(/only when the facility records a physical issue/i)
    ).toBeInTheDocument();
  });

  it('shows what was actually issued, including an approved substitution', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        status: 'COLLECTED',
        issueStatus: issueStatus({
          status: 'COLLECTED',
          completedAt: '2027-03-05T10:30:00.000Z',
          completedOutcome: 'COLLECTED',
          issued: [
            {
              poolName: 'Vegetables',
              poolUnit: 'g',
              name: 'Potato',
              brand: 'Local',
              quantityIssued: 1500,
              substitutedFor: { name: 'Onion', reason: 'Original out of stock at the counter' },
            },
          ],
        }),
      })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });
    const issuedSection = within(doc)
      .getByText('What was actually issued')
      .closest('section') as HTMLElement;

    expect(within(issuedSection).getByText('Potato')).toBeInTheDocument();
    expect(within(issuedSection).getByText('1500 g')).toBeInTheDocument();
    expect(
      within(issuedSection).getByText(/Issued in place of Onion · Original out of stock/)
    ).toBeInTheDocument();
    // The confirmed selection is still on the voucher, unchanged, beside it.
    expect(within(doc).getByText('Onion')).toBeInTheDocument();
    expect(within(doc).getByText('2000 g')).toBeInTheDocument();
  });

  it('shows a carried balance as its OWN line, never folded into this month', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        rationType: 'DRY',
        issueStatus: issueStatus({
          carryForward: [
            {
              sourcePeriodName: 'Last period',
              poolName: 'Pulses',
              quantity: 900,
              remaining: 400,
              unit: 'g',
              lapsedAt: null,
            },
          ],
        }),
      })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });
    const carried = within(doc).getByText('Carried from last month').closest('div') as HTMLElement;

    expect(within(carried).getByText('Pulses')).toBeInTheDocument();
    expect(within(carried).getByText(/400 g left of 900 g · from Last period/)).toBeInTheDocument();
    expect(
      within(doc).getByText(/kept separate from this month’s dry ration/i)
    ).toBeInTheDocument();
    expect(within(doc).getByText(/lapses once that window closes/i)).toBeInTheDocument();
    // This month's own figures are untouched by the carried line.
    expect(within(doc).getByText(/Entitlement 6300 g · 21 eligible days/)).toBeInTheDocument();
  });

  it('reminds the officer when the final Fresh window is close, using the server’s own figures', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        issueStatus: issueStatus({ reminderDue: true, daysToFinalWindowClose: 2 }),
      })
    );
    renderDocument();

    // The loading state also carries role="status", so the article is awaited
    // first and the reminder is read from inside the voucher itself.
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });
    const reminder = within(doc).getByRole('status');
    expect(reminder.textContent).toMatch(/last chance to collect this Fresh ration/i);
    expect(reminder.textContent).toMatch(/in 2 days/);
    expect(reminder.textContent).toMatch(/lapses/i);
  });

  it('shows no reminder when the server says none is due', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({ issueStatus: issueStatus({ reminderDue: false, daysToFinalWindowClose: 1 }) })
    );
    renderDocument();
    await screen.findByRole('article', { name: /Issue voucher/i });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/last chance/i)).not.toBeInTheDocument();
  });

  it('a lapsed Fresh voucher keeps its number, its eligible days and its Dry ration', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        issueStatus: issueStatus({ lapsed: true, lapseReason: 'WINDOW_CLOSED' }),
      })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText(/this fresh ration has lapsed/i)).toBeInTheDocument();
    expect(
      within(doc).getByText(/eligible days are unchanged, and your Dry ration is not/i)
    ).toBeInTheDocument();
    // Same voucher, same number — no replacement document.
    expect(within(doc).getByText('IV-2027-000014')).toBeInTheDocument();
    expect(within(doc).getByText(/This period · 21 eligible days/)).toBeInTheDocument();
  });

  it('stays READ ONLY with fulfilment on it: no control, no staff name, no history', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({
        status: 'COLLECTED',
        issueStatus: issueStatus({
          status: 'COLLECTED',
          completedAt: '2027-03-05T10:30:00.000Z',
          completedOutcome: 'COLLECTED',
          issued: [
            {
              poolName: 'Vegetables',
              poolUnit: 'g',
              name: 'Onion',
              brand: null,
              quantityIssued: 2000,
              substitutedFor: null,
            },
          ],
          carryForward: [
            {
              sourcePeriodName: 'Last period',
              poolName: 'Pulses',
              quantity: 900,
              remaining: 0,
              unit: 'g',
              lapsedAt: '2027-03-31T10:00:00.000Z',
            },
          ],
        }),
      })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(doc.querySelector('form')).toBeNull();
    expect(doc.querySelector('input')).toBeNull();
    expect(doc.querySelector('select')).toBeNull();
    expect(doc.querySelector('textarea')).toBeNull();
    for (const forbidden of [/mark /i, /substitut/i, /reverse/i, /correct/i, /undo/i, /save/i]) {
      expect(screen.queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
    expect(within(doc).queryByRole('heading', { name: /history/i })).not.toBeInTheDocument();
    const text = doc.textContent ?? '';
    expect(text).not.toMatch(/RIK_PICKUP_STAFF|RIK_ADMIN/);
    expect(text).not.toMatch(/recordedBy/);
  });

  it('shows nothing at all for a server that sends no fulfilment block', async () => {
    api.fetchMyIssueVoucher.mockResolvedValue(document_());
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).queryByText('What was actually issued')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // …and the PHASE D document is unaffected.
    expect(within(doc).getByText('Main Stores')).toBeInTheDocument();
  });

  it('keeps the destination block: fulfilment and collection point are still shown', async () => {
    // The named guard for the clobber this phase introduced and fixed: the
    // document's `fulfillment` (destination) and its `issueStatus` (what
    // happened) are separate fields and both render.
    api.fetchMyIssueVoucher.mockResolvedValue(
      document_({ issueStatus: issueStatus({ status: 'READY_FOR_PICKUP' }) })
    );
    renderDocument();
    const doc = await screen.findByRole('article', { name: /Issue voucher/i });

    expect(within(doc).getByText('Pickup at the yard')).toBeInTheDocument();
    expect(within(doc).getByText('Collect from')).toBeInTheDocument();
    expect(within(doc).getByText('Main Stores')).toBeInTheDocument();
  });
});

describe('print', () => {
  const original = window.print;
  afterEach(() => {
    window.print = original;
  });

  it('asks the browser to print, and nothing else', async () => {
    const print = vi.fn();
    window.print = print;
    renderDocument();

    await userEvent.click(await screen.findByRole('button', { name: /print this voucher/i }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(api.fetchMyIssueVoucher).toHaveBeenCalledTimes(1);
  });
});
