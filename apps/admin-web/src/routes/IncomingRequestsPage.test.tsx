import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { IncomingRequestsPage } from './IncomingRequestsPage';
import { ApiError } from '../lib/api/client';
import {
  residenceLabel,
  fulfillmentLabel,
  type IncomingRequest,
  type IncomingRequestPage,
} from '../lib/api/rik-incoming-requests-api';
import { rikAdmin, rikPickupStaff, pifAdmin } from '../test/staff-session';
import type { StaffSession } from '../lib/api/admin-api';

/**
 * The Incoming RIK requests queue (PHASE B).
 *
 * WHAT THESE PIN, AND WHY EACH ONE EXISTS.
 *
 *  * A selection with both streams outstanding is TWO rows, each showing its
 *    own provisions. Keyed on the selection alone, React would collapse them
 *    and the queue would under-report the work.
 *  * Creating a voucher calls the EXISTING endpoint with this row's ration
 *    type. Sending the wrong type issues the wrong document.
 *  * `created: false` is reported as "already existed", not as an error and
 *    not as a fresh success — the duplicate rule lives on the server and the
 *    screen must tell the truth about which branch it took.
 *  * A refusal shows the SERVER'S sentence, because it is the one that
 *    explains why.
 *  * The permission gate is `rik.order.manage` — the same code that governs
 *    the voucher endpoint every row is destined for.
 */

const fetchIncomingRequests = vi.fn();
const createIssueVoucher = vi.fn();
let current: StaffSession | null = null;

vi.mock('../lib/api/rik-incoming-requests-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-incoming-requests-api')>(
    '../lib/api/rik-incoming-requests-api'
  );
  return { ...actual, fetchIncomingRequests: (...args: unknown[]) => fetchIncomingRequests(...args) };
});

vi.mock('../lib/api/rik-issue-vouchers-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-issue-vouchers-api')>(
    '../lib/api/rik-issue-vouchers-api'
  );
  return { ...actual, createIssueVoucher: (...args: unknown[]) => createIssueVoucher(...args) };
});

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({
    status: 'authenticated',
    session: current,
    login: vi.fn(),
    logout: vi.fn(),
    can: (p: string) => current?.permissions.includes(p) ?? false,
    hasRole: (r: string) => current?.roles.includes(r) ?? false,
  }),
}));

function request(over: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    selectionId: 'sel-1',
    selectionReference: 'RIK-000001',
    rationType: 'DRY',
    officer: {
      customerId: 'cust-1',
      rikId: 'RIK-0001',
      name: 'Kiran Yadav',
      officialName: null,
      mobileNumber: '9000000001',
      residence: { quarterBlock: 'B', quarterNumber: '12', landmark: 'Near temple' },
    },
    period: { id: 'p1', name: 'November 2026', startDate: '2026-11-01', endDate: '2026-11-30' },
    confirmedAt: '2026-11-02T09:00:00.000Z',
    dietaryPreference: 'NV',
    eligibleDays: 30,
    fulfillment: { mode: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'Qtr B-12' },
    lines: [
      {
        poolCode: 'CEREALS',
        poolName: 'Cereals',
        provisionId: 'prov-rice',
        code: 'RICE',
        name: 'Rice',
        brand: 'Sona',
        quantity: 9000,
        unit: 'g',
        packSize: null,
        packUnit: null,
      },
    ],
    status: 'AWAITING_VOUCHER',
    otherRationTypeIssued: false,
    ...over,
  };
}

function page(items: IncomingRequest[], total = items.length): IncomingRequestPage {
  return { items, total, limit: 25, offset: 0 };
}

function renderPage(session: StaffSession | null = rikAdmin()) {
  current = session;
  return render(
    <MemoryRouter>
      <IncomingRequestsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchIncomingRequests.mockReset();
  createIssueVoucher.mockReset();
  fetchIncomingRequests.mockResolvedValue(page([]));
  current = null;
});

describe('Incoming RIK requests — the queue', () => {
  it('shows a confirmed request with its officer, period, fulfilment and provisions', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    renderPage();

    expect(await screen.findByText('Kiran Yadav')).toBeInTheDocument();
    expect(screen.getByText('RIK-0001')).toBeInTheDocument();
    expect(screen.getByText('RIK-000001')).toBeInTheDocument();
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    expect(screen.getByText('Delivery — Qtr B-12')).toBeInTheDocument();
    expect(screen.getByText(/Rice/)).toBeInTheDocument();
    expect(screen.getByText('9000 g')).toBeInTheDocument();
    expect(screen.getByText('Awaiting voucher')).toBeInTheDocument();
  });

  it('shows ONE selection as TWO rows when both ration types are outstanding', async () => {
    fetchIncomingRequests.mockResolvedValue(
      page([
        request({ rationType: 'DRY' }),
        request({
          rationType: 'FRESH',
          lines: [
            {
              poolCode: 'MILK',
              poolName: 'Milk',
              provisionId: 'prov-milk',
              code: 'MILK',
              name: 'Toned Milk',
              brand: null,
              quantity: 15000,
              unit: 'ml',
              packSize: 500,
              packUnit: 'packet',
            },
          ],
        }),
      ])
    );
    renderPage();

    const cards = await screen.findAllByRole('article');
    expect(cards).toHaveLength(2);
    // Each row shows only ITS OWN provisions.
    expect(within(cards[0]!).getByText(/Rice/)).toBeInTheDocument();
    expect(within(cards[0]!).queryByText(/Toned Milk/)).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText(/Toned Milk/)).toBeInTheDocument();
    expect(within(cards[1]!).queryByText(/Rice/)).not.toBeInTheDocument();
  });

  it('says which half is already done when the other ration type is issued', async () => {
    fetchIncomingRequests.mockResolvedValue(
      page([request({ rationType: 'DRY', otherRationTypeIssued: true })])
    );
    renderPage();

    expect(await screen.findByText('Fresh already issued')).toBeInTheDocument();
  });

  it('reports the total the server counted, not the number of rows drawn', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()], 48));
    renderPage();

    expect(await screen.findByText('48 requests awaiting a voucher')).toBeInTheDocument();
  });

  it('says plainly when nothing is waiting', async () => {
    fetchIncomingRequests.mockResolvedValue(page([]));
    renderPage();

    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument();
    expect(screen.getByText('No requests awaiting a voucher')).toBeInTheDocument();
  });

  it('keeps an officer with no address in the queue and says the address is missing', async () => {
    fetchIncomingRequests.mockResolvedValue(
      page([request({ officer: { ...request().officer, residence: null } })])
    );
    renderPage();

    expect(await screen.findByText(/No address on file/)).toBeInTheDocument();
    expect(screen.getByText('Kiran Yadav')).toBeInTheDocument();
  });

  it('shows a real failure as a failure, with a way back', async () => {
    fetchIncomingRequests.mockRejectedValue(new ApiError(500, { code: 'INTERNAL', message: 'boom' }));
    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // Never the raw server text.
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });
});

describe('Incoming RIK requests — converting one into a voucher', () => {
  it('calls the existing voucher endpoint with THIS row’s selection and ration type', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request({ rationType: 'FRESH' })]));
    createIssueVoucher.mockResolvedValue({ voucherNumber: 'RIK-V-0001', created: true });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /create fresh voucher/i }));

    expect(createIssueVoucher).toHaveBeenCalledWith({ selectionId: 'sel-1', rationType: 'FRESH' });
  });

  it('confirms the new voucher by number and reloads the queue', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    createIssueVoucher.mockResolvedValue({ voucherNumber: 'RIK-V-0007', created: true });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /create dry voucher/i }));

    expect(await screen.findByText('Voucher RIK-V-0007 created.')).toBeInTheDocument();
    // The server decides what is still outstanding, so the list is re-read.
    await waitFor(() => expect(fetchIncomingRequests).toHaveBeenCalledTimes(2));
  });

  it('reports an already-existing voucher as exactly that — not as a new one, not as an error', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    createIssueVoucher.mockResolvedValue({ voucherNumber: 'RIK-V-0003', created: false });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /create dry voucher/i }));

    expect(
      await screen.findByText('Voucher RIK-V-0003 already existed — no second voucher was created.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("shows the server's own refusal, which is the sentence that explains it", async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    createIssueVoucher.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'Selection RIK-000001 has no DRY entitlement to issue.',
      })
    );
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /create dry voucher/i }));

    expect(
      await screen.findByText('Selection RIK-000001 has no DRY entitlement to issue.')
    ).toBeInTheDocument();
  });

  it('disables the button while the request is in flight, so one click is one attempt', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    let release: (v: unknown) => void = () => {};
    createIssueVoucher.mockReturnValue(new Promise((r) => { release = r; }));
    renderPage();

    const button = await screen.findByRole('button', { name: /create dry voucher/i });
    await userEvent.click(button);

    expect(await screen.findByRole('button', { name: /creating/i })).toBeDisabled();
    // The real duplicate guard is the server's unique constraint; this is only
    // a courtesy, because two administrators can click at the same moment.
    release({ voucherNumber: 'RIK-V-0001', created: true });
    await waitFor(() => expect(createIssueVoucher).toHaveBeenCalledTimes(1));
  });
});

describe('Incoming RIK requests — filters', () => {
  it('asks the server for the filters, rather than filtering what it already has', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    renderPage();
    await screen.findByText('Kiran Yadav');

    await userEvent.type(screen.getByLabelText('Search'), 'kiran');
    await userEvent.selectOptions(screen.getByLabelText('Ration type'), 'FRESH');
    await userEvent.selectOptions(screen.getByLabelText('Fulfilment'), 'PICKUP');
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    await waitFor(() =>
      expect(fetchIncomingRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'kiran', rationType: 'FRESH', fulfillmentMode: 'PICKUP', offset: 0 })
      )
    );
  });

  it('clears back to the whole queue', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    renderPage();
    await screen.findByText('Kiran Yadav');

    await userEvent.type(screen.getByLabelText('Search'), 'kiran');
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));
    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() =>
      expect(fetchIncomingRequests).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', rationType: '' }))
    );
  });
});

describe('Incoming RIK requests — who may see it', () => {
  it('shows the queue to a RIK administrator, who holds rik.order.manage', async () => {
    fetchIncomingRequests.mockResolvedValue(page([request()]));
    renderPage(rikAdmin());

    expect(await screen.findByText('Kiran Yadav')).toBeInTheDocument();
  });

  it.each([
    ['RIK pickup staff', rikPickupStaff],
    ['a PIF administrator', pifAdmin],
  ])('refuses %s, and fetches nothing at all', async (_label, session) => {
    renderPage(session());

    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
    // Not merely hidden: the request for the officers' names, mobile numbers
    // and home addresses is never made.
    expect(fetchIncomingRequests).not.toHaveBeenCalled();
  });
});

describe('residenceLabel / fulfillmentLabel', () => {
  it('joins only the parts that exist', () => {
    expect(residenceLabel({ quarterBlock: 'B', quarterNumber: '12', landmark: 'Near temple' })).toBe(
      'Qtr B-12, Near temple'
    );
    expect(residenceLabel({ quarterBlock: 'B', quarterNumber: '12', landmark: null })).toBe('Qtr B-12');
    // A landmark-only address reads as the landmark, never as ", , Near temple".
    expect(residenceLabel({ quarterBlock: null, quarterNumber: null, landmark: 'Near temple' })).toBe(
      'Near temple'
    );
    expect(residenceLabel({ quarterBlock: null, quarterNumber: null, landmark: null })).toBeNull();
    expect(residenceLabel(null)).toBeNull();
  });

  it('names the fulfilment from the confirmation, and says when there is none', () => {
    expect(fulfillmentLabel({ mode: 'PICKUP', pickupLocationName: 'Main Store', deliveryAddress: null })).toBe(
      'Pickup — Main Store'
    );
    expect(fulfillmentLabel({ mode: 'DELIVERY', pickupLocationName: null, deliveryAddress: 'Qtr B-12' })).toBe(
      'Delivery — Qtr B-12'
    );
    // These two are issuable only once fixed; the voucher endpoint refuses
    // them with FULFILLMENT_MISSING, so the screen must not imply otherwise.
    expect(fulfillmentLabel({ mode: 'PICKUP', pickupLocationName: null, deliveryAddress: null })).toBe(
      'Pickup — no collection point recorded'
    );
    expect(fulfillmentLabel({ mode: null, pickupLocationName: null, deliveryAddress: null })).toBe(
      'No fulfilment recorded'
    );
  });
});
