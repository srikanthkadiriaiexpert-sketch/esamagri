import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodsPage } from './PeriodsPage';
import type {
  CreatePeriodInput,
  EntitlementPeriod,
  PeriodListResponse,
  PeriodStatus,
  UpdatePeriodInput,
} from '../../lib/api/rik-periods-api';

const fetchPeriods = vi.fn<[AbortSignal?], Promise<PeriodListResponse>>();
const createPeriod = vi.fn<[CreatePeriodInput], Promise<EntitlementPeriod>>();
const updatePeriod = vi.fn<[string, UpdatePeriodInput], Promise<EntitlementPeriod>>();
const setPeriodStatus = vi.fn<[string, PeriodStatus], Promise<EntitlementPeriod>>();

vi.mock('../../lib/api/rik-periods-api', () => ({
  fetchPeriods: (...a: [AbortSignal?]) => fetchPeriods(...a),
  createPeriod: (...a: [CreatePeriodInput]) => createPeriod(...a),
  updatePeriod: (...a: [string, UpdatePeriodInput]) => updatePeriod(...a),
  setPeriodStatus: (...a: [string, PeriodStatus]) => setPeriodStatus(...a),
}));

const NO_DEPENDENTS = {
  eligibility: 0,
  import_batches: 0,
  entitlements: 0,
  selections: 0,
  issue_windows: 0,
  issue_vouchers: 0,
  carry_forward: 0,
  total: 0,
};

const period = (over: Partial<EntitlementPeriod> = {}): EntitlementPeriod => ({
  periodId: '01a13086-bd2e-7e74-8154-234dc4979a0d',
  name: 'November 2026',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  status: 'ACTIVE',
  state: 'OPEN',
  isCurrent: true,
  datesEditable: true,
  dependents: NO_DEPENDENTS,
  ...over,
});

const page = (
  items: EntitlementPeriod[],
  currentPeriodId: string | null = items.find((p) => p.isCurrent)?.periodId ?? null
): PeriodListResponse => ({ items, currentPeriodId, total: items.length });

beforeEach(() => {
  fetchPeriods.mockReset();
  createPeriod.mockReset();
  updatePeriod.mockReset();
  setPeriodStatus.mockReset();
});

/**
 * The entitlement periods screen.
 *
 * The assertion that matters most is the first one: when no period contains
 * today, this screen must SAY SO. Staging ran for five days in November 2026
 * with no operational period and nobody noticed, because nothing anywhere
 * reported it. A silent empty dropdown is how that happens.
 */
describe('PeriodsPage — what the screen reports about today', () => {
  it('says plainly when no period is operational, rather than showing nothing', async () => {
    fetchPeriods.mockResolvedValue(
      page([period({ state: 'PAST', isCurrent: false, name: 'Demo October 2026' })], null)
    );
    render(<PeriodsPage />);

    expect(
      await screen.findByText(/no operational period is configured/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/officers currently have no entitlement/i)).toBeInTheDocument();
  });

  it('names the current period when one is open', async () => {
    fetchPeriods.mockResolvedValue(page([period()]));
    render(<PeriodsPage />);

    // Scoped to the banner on purpose. The period name also appears in the
    // table row below, and BOTH are correct — so a bare
    // getByText('November 2026') is ambiguous, and worse, it would pass
    // without proving the banner said anything at all.
    expect(await screen.findByText(/current operational period/i)).toHaveTextContent(
      'November 2026'
    );
  });

  it('shows a closed period as Closed, and never as the current one', async () => {
    fetchPeriods.mockResolvedValue(
      page([period({ status: 'CLOSED', state: 'CLOSED', isCurrent: false })], null)
    );
    render(<PeriodsPage />);

    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.getByText(/no operational period is configured/i)).toBeInTheDocument();
  });

  it('offers no delete anywhere on the screen', async () => {
    fetchPeriods.mockResolvedValue(page([period()]));
    render(<PeriodsPage />);
    await screen.findByRole('row', { name: /November 2026/ });

    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByText(/closed, never deleted/i)).toBeInTheDocument();
  });
});

describe('PeriodsPage — creating a period', () => {
  it('sends exactly what the administrator typed, and invents no dates', async () => {
    const user = userEvent.setup();
    fetchPeriods.mockResolvedValue(page([], null));
    createPeriod.mockResolvedValue(
      period({ name: 'December 2026', startDate: '2026-12-01', endDate: '2026-12-31', state: 'UPCOMING', isCurrent: false })
    );
    render(<PeriodsPage />);
    await screen.findByText(/no entitlement period exists yet/i);

    await user.click(screen.getByRole('button', { name: /create a period/i }));

    // The form starts EMPTY. No "this month" default, no prefilled dates.
    expect(screen.getByLabelText('Period name')).toHaveValue('');
    expect(screen.getByLabelText('Start date')).toHaveValue('');
    expect(screen.getByLabelText('End date')).toHaveValue('');

    await user.type(screen.getByLabelText('Period name'), 'December 2026');
    await user.type(screen.getByLabelText('Start date'), '2026-12-01');
    await user.type(screen.getByLabelText('End date'), '2026-12-31');
    await user.click(screen.getByRole('button', { name: /create period/i }));

    expect(createPeriod).toHaveBeenCalledWith({
      name: 'December 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
    // No status is sent: the server defaults the label to UPCOMING.
    expect(createPeriod.mock.calls[0]![0]).not.toHaveProperty('status');
  });

  it('reports the server’s own refusal rather than inventing one', async () => {
    const user = userEvent.setup();
    fetchPeriods.mockResolvedValue(page([], null));
    const { ApiError } = await import('../../lib/api/client');
    createPeriod.mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION_FAILED',
        message:
          'Those dates overlap "November 2026" (2026-11-01 to 2026-11-30). Periods cannot overlap, not even by one day.',
        details: { reason: 'OVERLAPPING_PERIOD' },
      })
    );
    render(<PeriodsPage />);
    await screen.findByText(/no entitlement period exists yet/i);

    await user.click(screen.getByRole('button', { name: /create a period/i }));
    await user.type(screen.getByLabelText('Period name'), 'Clash');
    await user.type(screen.getByLabelText('Start date'), '2026-11-15');
    await user.type(screen.getByLabelText('End date'), '2026-12-15');
    await user.click(screen.getByRole('button', { name: /create period/i }));

    expect(await screen.findByText(/overlap "November 2026"/)).toBeInTheDocument();
  });
});

describe('PeriodsPage — editing and closing', () => {
  it('disables the date fields and explains why when records depend on the period', async () => {
    const user = userEvent.setup();
    fetchPeriods.mockResolvedValue(
      page([
        period({
          datesEditable: false,
          dependents: { ...NO_DEPENDENTS, issue_windows: 4, total: 4 },
        }),
      ])
    );
    render(<PeriodsPage />);
    await screen.findByRole('row', { name: /November 2026/ });

    await user.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByLabelText('Start date')).toBeDisabled();
    expect(screen.getByLabelText('End date')).toBeDisabled();
    // The name stays correctable — a label changes no entitlement.
    expect(screen.getByLabelText('Period name')).not.toBeDisabled();
    expect(screen.getByText(/4 records already belong to this period/i)).toBeInTheDocument();
  });

  it('leaves the dates editable on a period nothing depends on', async () => {
    const user = userEvent.setup();
    fetchPeriods.mockResolvedValue(page([period()]));
    render(<PeriodsPage />);
    await screen.findByRole('row', { name: /November 2026/ });

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByLabelText('Start date')).not.toBeDisabled();
  });

  it('closes a period and says what closing does and does not do', async () => {
    const user = userEvent.setup();
    fetchPeriods.mockResolvedValue(page([period()]));
    setPeriodStatus.mockResolvedValue(
      period({ status: 'CLOSED', state: 'CLOSED', isCurrent: false })
    );
    render(<PeriodsPage />);
    await screen.findByRole('row', { name: /November 2026/ });

    await user.click(screen.getByRole('button', { name: /^close$/i }));

    expect(setPeriodStatus).toHaveBeenCalledWith(
      '01a13086-bd2e-7e74-8154-234dc4979a0d',
      'CLOSED'
    );
    expect(await screen.findByText(/Its records are kept/i)).toBeInTheDocument();
  });

  it('offers Reopen instead of Close on an already closed period', async () => {
    fetchPeriods.mockResolvedValue(
      page([period({ status: 'CLOSED', state: 'CLOSED', isCurrent: false })], null)
    );
    render(<PeriodsPage />);
    await screen.findByText('November 2026');

    expect(screen.getByRole('button', { name: /reopen/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^close$/i })).not.toBeInTheDocument();
  });
});
