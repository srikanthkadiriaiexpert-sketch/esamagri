import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FulfillmentPage } from './FulfillmentPage';
import type { CounterView } from '../lib/api/rik-fulfillment-api';
import type { VoucherPage } from '../lib/api/rik-issue-vouchers-api';

/**
 * PHASE E — the counter screen.
 *
 * What these assertions protect: the screen offers only the step the locked
 * lane allows next, a substitution can only be chosen from the alternatives
 * the SERVER returned, a completed voucher has no edit/delete/undo but does
 * have a correction, and the carried balance is shown as its own component
 * rather than folded into this month's.
 */

const api = vi.hoisted(() => ({
  fetchCounterView: vi.fn(),
  fetchAdminView: vi.fn(),
  recordPickup: vi.fn(),
  recordDelivery: vi.fn(),
  reverseCompletion: vi.fn(),
  settleLapse: vi.fn(),
}));
const vouchersApi = vi.hoisted(() => ({ fetchIssueVouchers: vi.fn() }));
const auth = vi.hoisted(() => ({ permissions: ['rik.order.mark_collected', 'rik.order.manage'] }));

vi.mock('../lib/api/rik-fulfillment-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-fulfillment-api')>(
    '../lib/api/rik-fulfillment-api'
  );
  return { ...actual, ...api };
});
vi.mock('../lib/api/rik-issue-vouchers-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-issue-vouchers-api')>(
    '../lib/api/rik-issue-vouchers-api'
  );
  return { ...actual, ...vouchersApi };
});
vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ session: { permissions: auth.permissions } }),
}));

const VOUCHER = '01a11a22-0000-7000-8000-0000000000bb';

const page = (): VoucherPage => ({
  items: [
    {
      voucherId: VOUCHER,
      voucherNumber: 'IV-2027-000014',
      selectionId: 'sel-1',
      selectionReference: 'RIK-000031',
      officerId: 'off-1',
      rikId: 'RIK-O-000042',
      officerName: 'A B Officer',
      mobileNumber: '9810000001',
      rationType: 'DRY',
      fulfillmentMode: 'PICKUP',
      status: 'READY_FOR_PICKUP',
      periodId: 'per-1',
      periodName: 'March 2027',
      issueDate: '2027-03-02T06:00:00.000Z',
      createdAt: '2027-03-02T06:00:00.000Z',
    },
  ],
  total: 1,
  limit: 25,
  offset: 0,
});

const view = (overrides: Partial<CounterView> = {}): CounterView => ({
  voucherId: VOUCHER,
  voucherNumber: 'IV-2027-000014',
  rationType: 'DRY',
  fulfillmentMode: 'PICKUP',
  status: 'READY_FOR_PICKUP',
  officer: {
    rikId: 'RIK-O-000042',
    name: 'A B Officer',
    mobileNumber: '9810000001',
    quarterBlock: 'D',
    quarterNumber: '204',
    landmark: null,
  },
  destination: { mode: 'PICKUP', pickupLocationName: 'Main Stores', deliveryAddress: null },
  period: { id: 'per-1', name: 'March 2027' },
  lapsed: false,
  lapseReason: null,
  finalWindowCode: 'DRY',
  finalWindowEndDate: '2027-03-21',
  reminderDue: false,
  daysToFinalWindowClose: 12,
  completion: null,
  events: [],
  issuedLines: [],
  carryForward: [],
  substitutionOptions: [
    {
      poolCode: 'CEREALS',
      poolName: 'Cereals',
      poolUnit: 'g',
      originalProvisionId: 'prov-rice',
      originalCode: 'CER_RICE_ROZANA',
      originalName: 'Rozana Basmati Rice',
      originalQuantity: 2000,
      poolEquivalentQty: 2000,
      alternatives: [
        {
          provisionId: 'prov-atta',
          code: 'CER_ATTA_AMUL',
          name: 'Atta',
          brand: 'Amul',
          unit: 'g',
          packSize: null,
          consumptionRatio: 1,
          equivalentQuantity: 2000,
        },
      ],
    },
  ],
  ...overrides,
});

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset();
  vouchersApi.fetchIssueVouchers.mockReset();
  auth.permissions = ['rik.order.mark_collected', 'rik.order.manage'];
  vouchersApi.fetchIssueVouchers.mockResolvedValue(page());
  api.fetchCounterView.mockResolvedValue(view());
  api.fetchAdminView.mockResolvedValue(view());
  api.recordPickup.mockResolvedValue({ outcomeId: 'o1', voucherNumber: 'IV-2027-000014', status: 'COLLECTED' });
  api.reverseCompletion.mockResolvedValue({
    correctionId: 'c1',
    voucherNumber: 'IV-2027-000014',
    status: 'READY_FOR_PICKUP',
  });
});

const open = async () => {
  render(<FulfillmentPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
  return screen.findByRole('region', { name: /Fulfilment for IV-2027-000014/i });
};

describe('FulfillmentPage (PHASE E)', () => {
  it('offers only the steps the pickup lane allows next', async () => {
    const panel = await open();
    expect(within(panel).getByRole('button', { name: 'Collected' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Not collected' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /out for delivery/i })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Delivered' })).not.toBeInTheDocument();
  });

  it('offers the delivery steps for a delivery voucher, in order', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({ fulfillmentMode: 'DELIVERY', status: 'READY_FOR_DELIVERY', destination: { mode: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'D-204' } })
    );
    const panel = await open();
    expect(within(panel).getByRole('button', { name: 'Out for delivery' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Not delivered' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Delivered' })).not.toBeInTheDocument();
  });

  it('records a collection with the confirmed quantities', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Collected' }));
    expect(api.recordPickup).toHaveBeenCalledWith(VOUCHER, {
      outcome: 'COLLECTED',
      reason: undefined,
      lines: [{ provisionId: 'prov-rice', quantity: 2000 }],
    });
  });

  it('records a substitution with the server’s equivalent quantity and a reason', async () => {
    const panel = await open();
    await userEvent.selectOptions(
      within(panel).getByLabelText('Substitute for Rozana Basmati Rice'),
      'prov-atta'
    );
    await userEvent.type(
      within(panel).getByLabelText('Reason for substituting Rozana Basmati Rice'),
      'Rice out of stock'
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Collected' }));

    expect(api.recordPickup).toHaveBeenCalledWith(VOUCHER, {
      outcome: 'COLLECTED',
      reason: undefined,
      lines: [
        {
          provisionId: 'prov-atta',
          quantity: 2000,
          originalProvisionId: 'prov-rice',
          substitutionReason: 'Rice out of stock',
        },
      ],
    });
  });

  it('offers ONLY the alternatives the server returned', async () => {
    const panel = await open();
    const select = within(panel).getByLabelText('Substitute for Rozana Basmati Rice');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(2);
    expect(options[0]).toMatch(/issued as confirmed/i);
    expect(options[1]).toMatch(/Atta/);
  });

  it('shows a carried balance as its own component, not folded into this month', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({
        carryForward: [
          {
            carryForwardId: 'cf1',
            sourcePeriodName: 'February 2027',
            targetPeriodName: 'March 2027',
            sourceSelectionReference: 'RIK-000030',
            poolCode: 'CEREALS',
            poolName: 'Cereals',
            quantity: 1500,
            remaining: 1500,
            unit: 'g',
            establishedAt: '2027-03-01T00:00:00.000Z',
            lapsedAt: null,
            lapseReason: null,
          },
        ],
      })
    );
    const panel = await open();
    expect(within(panel).getByText(/Carried from the previous period/i)).toBeInTheDocument();
    expect(within(panel).getByText(/1500 g of 1500 g left from February 2027/)).toBeInTheDocument();
    expect(within(panel).getByText(/drawn on first/i)).toBeInTheDocument();
  });

  it('a completed voucher offers NO edit, delete or undo — only a correction', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({
        status: 'COLLECTED',
        completion: {
          outcomeId: 'o1',
          sequenceNo: 1,
          eventType: 'OUTCOME',
          outcome: 'COLLECTED',
          reason: null,
          windowCode: 'DRY',
          supersedesId: null,
          recordedAt: '2027-03-05T10:00:00.000Z',
          recordedBy: { staffId: 's1', name: 'Counter Staff', role: 'RIK_PICKUP_STAFF' },
          notes: null,
          reversed: false,
        },
        issuedLines: [
          {
            lineId: 'l1',
            poolCode: 'CEREALS',
            poolName: 'Cereals',
            poolUnit: 'g',
            provisionId: 'prov-rice',
            code: 'CER_RICE_ROZANA',
            name: 'Rozana Basmati Rice',
            brand: null,
            quantityIssued: 2000,
            consumptionRatio: 1,
            poolEquivalentQty: 2000,
            carryForwardQty: 0,
            substitutedFor: null,
          },
        ],
      })
    );
    const panel = await open();

    for (const forbidden of [/^edit$/i, /^delete$/i, /^undo$/i, /^remove$/i]) {
      expect(within(panel).queryByRole('button', { name: forbidden })).not.toBeInTheDocument();
    }
    expect(within(panel).queryByRole('button', { name: 'Collected' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /reverse this completion/i })).toBeInTheDocument();
    expect(within(panel).getByText(/never edited, deleted or undone/i)).toBeInTheDocument();
    expect(within(panel).getByText('Rozana Basmati Rice')).toBeInTheDocument();
  });

  it('a correction needs a reason before it can be sent', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({
        status: 'COLLECTED',
        completion: {
          outcomeId: 'o1',
          sequenceNo: 1,
          eventType: 'OUTCOME',
          outcome: 'COLLECTED',
          reason: null,
          windowCode: null,
          supersedesId: null,
          recordedAt: '2027-03-05T10:00:00.000Z',
          recordedBy: { staffId: 's1', name: 'Counter Staff', role: 'RIK_PICKUP_STAFF' },
          notes: null,
          reversed: false,
        },
      })
    );
    const panel = await open();
    const button = within(panel).getByRole('button', { name: /reverse this completion/i });
    expect(button).toBeDisabled();

    await userEvent.type(
      within(panel).getByLabelText('Reason for the correction'),
      'Recorded against the wrong officer'
    );
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(api.reverseCompletion).toHaveBeenCalledWith(VOUCHER, {
      outcomeId: 'o1',
      reason: 'Recorded against the wrong officer',
    });
  });

  it('tells a role that cannot act, instead of offering buttons it would refuse', async () => {
    auth.permissions = ['rik.order.manage'];
    api.fetchAdminView.mockResolvedValue(view());
    const panel = await open();
    // A pickup voucher, and this role does not hold the counter permission.
    expect(within(panel).getByText(/does not record pickup/i)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Collected' })).not.toBeInTheDocument();
  });

  it('shows the reminder when the final window is close, and the lapse when it has passed', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({ rationType: 'FRESH', reminderDue: true, daysToFinalWindowClose: 2, finalWindowCode: 'FRESH_3' })
    );
    const panel = await open();
    expect(within(panel).getByText(/FRESH_3 closes on 2027-03-21 — 2 day\(s\) left/)).toBeInTheDocument();

    api.fetchCounterView.mockResolvedValue(
      view({ rationType: 'FRESH', lapsed: true, lapseReason: 'WINDOW_CLOSED' })
    );
    render(<FulfillmentPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Open' });
    await userEvent.click(buttons[buttons.length - 1]!);
    expect((await screen.findAllByText(/the unissued ration has lapsed/i)).length).toBeGreaterThan(0);
  });

  it('shows the history, with a reversed event struck through', async () => {
    api.fetchCounterView.mockResolvedValue(
      view({
        status: 'READY_FOR_PICKUP',
        events: [
          {
            outcomeId: 'o1',
            sequenceNo: 1,
            eventType: 'OUTCOME',
            outcome: 'COLLECTED',
            reason: null,
            windowCode: 'DRY',
            supersedesId: null,
            recordedAt: '2027-03-05T10:00:00.000Z',
            recordedBy: { staffId: 's1', name: 'Counter Staff', role: 'RIK_PICKUP_STAFF' },
            notes: null,
            reversed: true,
          },
          {
            outcomeId: 'c1',
            sequenceNo: 2,
            eventType: 'CORRECTION',
            outcome: 'REVERSED',
            reason: 'Wrong officer',
            windowCode: null,
            supersedesId: 'o1',
            recordedAt: '2027-03-06T10:00:00.000Z',
            recordedBy: { staffId: 's2', name: 'RIK Admin', role: 'RIK_ADMIN' },
            notes: null,
            reversed: false,
          },
        ],
      })
    );
    const panel = await open();
    // 'Collected' also names an action button on an open voucher, so the
    // assertion is scoped to the history block.
    const history = within(panel).getByRole('heading', { name: 'History' })
      .parentElement as HTMLElement;
    const struck = within(history).getByText('Collected').closest('li');
    expect(struck?.className).toContain('line-through');
    expect(within(history).getByText('Reversed')).toBeInTheDocument();
    expect(within(history).getByText(/Wrong officer/)).toBeInTheDocument();
  });
});
