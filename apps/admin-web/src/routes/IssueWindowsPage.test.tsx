import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IssueWindowsPage } from './IssueWindowsPage';
import type { EntitlementPeriodOption } from '../lib/api/rik-eligibility-api';
import type {
  ConfigureIssueWindowInput,
  IssueWindow,
  IssueWindowRevision,
  UpdateIssueWindowInput,
} from '../lib/api/rik-issue-windows-api';
import { ApiError } from '../lib/api/client';

const fetchPeriods = vi.fn<[AbortSignal?], Promise<{ items: EntitlementPeriodOption[] }>>();
const fetchIssueWindows = vi.fn<[string, AbortSignal?], Promise<{ items: IssueWindow[] }>>();
const fetchIssueWindowRevisions =
  vi.fn<[string, AbortSignal?], Promise<{ items: IssueWindowRevision[] }>>();
const configureIssueWindow = vi.fn<[ConfigureIssueWindowInput], Promise<IssueWindow>>();
const updateIssueWindow = vi.fn<[string, UpdateIssueWindowInput], Promise<IssueWindow>>();

vi.mock('../lib/api/rik-eligibility-api', () => ({
  fetchPeriods: (...a: [AbortSignal?]) => fetchPeriods(...a),
}));

vi.mock('../lib/api/rik-issue-windows-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/rik-issue-windows-api')>(
    '../lib/api/rik-issue-windows-api'
  );
  return {
    ...actual,
    fetchIssueWindows: (...a: [string, AbortSignal?]) => fetchIssueWindows(...a),
    fetchIssueWindowRevisions: (...a: [string, AbortSignal?]) => fetchIssueWindowRevisions(...a),
    configureIssueWindow: (...a: [ConfigureIssueWindowInput]) => configureIssueWindow(...a),
    updateIssueWindow: (...a: [string, UpdateIssueWindowInput]) => updateIssueWindow(...a),
  };
});

const PERIOD = '01a11a22-0000-7000-8000-0000000000aa';

/**
 * Dates are derived from a fixture period, never written as literals that
 * could expire — except where a literal IS the subject (the weekday label and
 * the day-list arithmetic).
 */
const period = (): EntitlementPeriodOption => ({
  periodId: PERIOD,
  name: 'March 2027',
  startDate: '2027-03-01',
  endDate: '2027-03-31',
  status: 'ACTIVE',
});

const window = (overrides: Partial<IssueWindow> = {}): IssueWindow => ({
  windowId: 'win-1',
  windowCode: 'FRESH_1',
  label: 'Fresh Issue 1',
  rationType: 'FRESH',
  sequenceNo: 1,
  period: { periodId: PERIOD, name: 'March 2027', startDate: '2027-03-01', endDate: '2027-03-31' },
  startDate: '2027-03-02',
  endDate: '2027-03-08',
  operatingDays: ['2027-03-02', '2027-03-03', '2027-03-05'],
  isActive: true,
  status: 'ACTIVE',
  notes: null,
  createdAt: '2027-02-20T09:00:00.000Z',
  createdBy: { staffId: 'staff-1', name: 'Test RIK_ADMIN' },
  updatedAt: '2027-02-21T09:00:00.000Z',
  updatedBy: { staffId: 'staff-1', name: 'Test RIK_ADMIN' },
  ...overrides,
});

beforeEach(() => {
  for (const m of [
    fetchPeriods,
    fetchIssueWindows,
    fetchIssueWindowRevisions,
    configureIssueWindow,
    updateIssueWindow,
  ]) {
    m.mockReset();
  }
  fetchPeriods.mockResolvedValue({ items: [period()] });
  fetchIssueWindows.mockResolvedValue({ items: [] });
});

const choosePeriod = async () => {
  await userEvent.selectOptions(await screen.findByLabelText('Period'), PERIOD);
};

/**
 * STEP 15C — the issue-window administration screen.
 *
 * The assertions that matter are that the screen makes the WINDOW BEING
 * CONFIGURED unmistakable, that operating days can only be days of the window
 * itself, that nothing is preset to a weekday, and that there is no delete.
 */
describe('IssueWindowsPage (STEP 15C)', () => {
  it('asks for a period before showing any schedule', async () => {
    render(<IssueWindowsPage />);
    expect(await screen.findByLabelText('Period')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(fetchIssueWindows).not.toHaveBeenCalled();
  });

  it('says so honestly when no period exists', async () => {
    fetchPeriods.mockResolvedValue({ items: [] });
    render(<IssueWindowsPage />);
    expect(await screen.findByText(/no entitlement period exists yet/i)).toBeInTheDocument();
  });

  it('lists all six slots, configured or not', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    for (const label of [
      'Fresh Issue 1',
      'Fresh Issue 2',
      'Fresh Issue 3',
      'Dry Issue',
      'Miss Muster Fresh',
      'Miss Muster Dry',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/not configured/i)).toHaveLength(6);
  });

  it('shows a configured window’s dates, days and weekdays', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [window()] });
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    expect(within(row).getByText('2027-03-02 → 2027-03-08')).toBeInTheDocument();
    // 2 March 2027 is a Tuesday — shown for recognition, never used to decide.
    expect(within(row).getAllByText(/2027-03-02/).length).toBeGreaterThan(0);
    expect(within(row).getAllByText('Tue').length).toBeGreaterThan(0);
    expect(within(row).getByText('Published')).toBeInTheDocument();
  });

  it('names the window being configured in the form', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 2/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    expect(
      await screen.findByRole('heading', { name: /Configure Fresh Issue 2/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/March 2027 runs 2027-03-01 → 2027-03-31/)).toBeInTheDocument();
  });

  it('offers only the days of the window itself as operating days', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Dry Issue/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-10');
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-12');

    expect(screen.getByLabelText('Issue on 2027-03-10')).toBeInTheDocument();
    expect(screen.getByLabelText('Issue on 2027-03-11')).toBeInTheDocument();
    expect(screen.getByLabelText('Issue on 2027-03-12')).toBeInTheDocument();
    expect(screen.queryByLabelText('Issue on 2027-03-13')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Issue on 2027-03-09')).not.toBeInTheDocument();
  });

  it('presets no operating day — not Tuesday, not anything', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(screen.getByRole('button', { name: /configure fresh issue 1/i })).toBeDisabled();
    expect(screen.getByText(/tick at least one operating day/i)).toBeInTheDocument();
  });

  it('configures a window with the days the administrator ticked', async () => {
    configureIssueWindow.mockResolvedValue(window({ windowCode: 'FRESH_1', label: 'Fresh Issue 1' }));
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-02');
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-05');
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-02'));
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-04'));
    await userEvent.click(screen.getByRole('button', { name: /configure fresh issue 1/i }));

    expect(configureIssueWindow).toHaveBeenCalledWith({
      periodId: PERIOD,
      rationType: 'FRESH',
      sequenceNo: 1,
      startDate: '2027-03-02',
      endDate: '2027-03-05',
      operatingDays: ['2027-03-02', '2027-03-04'],
    });
    expect(await screen.findByText(/Fresh Issue 1 saved/)).toBeInTheDocument();
  });

  it('drops a ticked day that the new dates exclude', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Dry Issue/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-10');
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-20');
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-18'));

    // Narrow the window: the 18th is no longer one of its days.
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-12');

    expect(screen.queryByLabelText('Issue on 2027-03-18')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /configure dry issue/i })).toBeDisabled();
  });

  it('edits an existing window, sending only the configurable fields', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [window()] });
    updateIssueWindow.mockResolvedValue(window({ startDate: '2027-03-02', endDate: '2027-03-09' }));
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    await userEvent.click(within(row).getByRole('button', { name: /^edit$/i }));
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-09');
    await userEvent.click(screen.getByRole('button', { name: /save fresh issue 1/i }));

    expect(updateIssueWindow).toHaveBeenCalledTimes(1);
    const [, body] = updateIssueWindow.mock.calls[0]!;
    expect(body.endDate).toBe('2027-03-09');
    expect(body).not.toHaveProperty('periodId');
    expect(body).not.toHaveProperty('rationType');
    expect(body).not.toHaveProperty('sequenceNo');
    expect(body).not.toHaveProperty('windowCode');
  });

  it('reports the server’s own refusal rather than inventing one', async () => {
    configureIssueWindow.mockRejectedValue(
      new ApiError(400, {
        code: 'VALIDATION_FAILED',
        message: 'Fresh Issue 1 already covers part of those dates (2027-03-02 to 2027-03-08).',
        details: { reason: 'OVERLAPPING_WINDOW', field: 'startDate' },
      })
    );
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 2/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-01'));
    await userEvent.click(screen.getByRole('button', { name: /configure fresh issue 2/i }));

    expect(await screen.findByText(/already covers part of those dates/)).toBeInTheDocument();
  });

  it('retires a window rather than deleting it', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [window()] });
    updateIssueWindow.mockResolvedValue(window({ isActive: false, status: 'RETIRED' }));
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    await userEvent.click(within(row).getByRole('button', { name: /^retire$/i }));

    expect(updateIssueWindow).toHaveBeenCalledWith('win-1', { isActive: false });
    expect(await screen.findByText(/Fresh Issue 1 is retired/)).toBeInTheDocument();
  });

  it('restores a retired window', async () => {
    fetchIssueWindows.mockResolvedValue({
      items: [window({ isActive: false, status: 'RETIRED' })],
    });
    updateIssueWindow.mockResolvedValue(window());
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    expect(within(row).getByText('Retired')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /^restore$/i }));

    expect(updateIssueWindow).toHaveBeenCalledWith('win-1', { isActive: true });
    expect(await screen.findByText(/published again/i)).toBeInTheDocument();
  });

  it('offers no delete anywhere, and says why', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [window()] });
    render(<IssueWindowsPage />);
    await choosePeriod();
    await screen.findByRole('row', { name: /Fresh Issue 1/ });

    expect(screen.queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
    expect(screen.getByText(/retired, never deleted/i)).toBeInTheDocument();
  });

  it('shows the revision history with both states and who changed it', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [window()] });
    fetchIssueWindowRevisions.mockResolvedValue({
      items: [
        {
          revisionId: 'rev-2',
          windowId: 'win-1',
          revisionNo: 2,
          changeType: 'UPDATED',
          windowCode: 'FRESH_1',
          label: 'Fresh Issue 1',
          rationType: 'FRESH',
          before: {
            periodId: PERIOD,
            rationType: 'FRESH',
            windowCode: 'FRESH_1',
            sequenceNo: 1,
            startDate: '2027-03-02',
            endDate: '2027-03-08',
            operatingDays: ['2027-03-03'],
            isActive: true,
            notes: null,
          },
          after: {
            periodId: PERIOD,
            rationType: 'FRESH',
            windowCode: 'FRESH_1',
            sequenceNo: 1,
            startDate: '2027-03-02',
            endDate: '2027-03-08',
            operatingDays: ['2027-03-04'],
            isActive: true,
            notes: null,
          },
          changedBy: { staffId: 'staff-1', name: 'Test RIK_ADMIN' },
          changedAt: '2027-02-22T10:30:00.000Z',
        },
        {
          revisionId: 'rev-1',
          windowId: 'win-1',
          revisionNo: 1,
          changeType: 'CREATED',
          windowCode: 'FRESH_1',
          label: 'Fresh Issue 1',
          rationType: 'FRESH',
          before: null,
          after: {
            periodId: PERIOD,
            rationType: 'FRESH',
            windowCode: 'FRESH_1',
            sequenceNo: 1,
            startDate: '2027-03-02',
            endDate: '2027-03-08',
            operatingDays: ['2027-03-03'],
            isActive: true,
            notes: null,
          },
          changedBy: { staffId: 'staff-1', name: 'Test RIK_ADMIN' },
          changedAt: '2027-02-20T09:00:00.000Z',
        },
      ],
    });

    render(<IssueWindowsPage />);
    await choosePeriod();
    const row = await screen.findByRole('row', { name: /Fresh Issue 1/ });
    await userEvent.click(within(row).getByRole('button', { name: /history/i }));

    expect(
      await screen.findByRole('heading', { name: /Fresh Issue 1 — change history/i })
    ).toBeInTheDocument();
    expect(fetchIssueWindowRevisions).toHaveBeenCalledWith('win-1');
    expect(screen.getByText('UPDATED')).toBeInTheDocument();
    expect(screen.getByText('CREATED')).toBeInTheDocument();
    expect(screen.getAllByText(/Test RIK_ADMIN/).length).toBeGreaterThan(0);
    // The CREATED row has no before state, and says so rather than guessing.
    const created = screen.getByRole('row', { name: /CREATED/ });
    expect(within(created).getByText('—')).toBeInTheDocument();
  });

  it('surfaces a forbidden response rather than an empty schedule', async () => {
    fetchIssueWindows.mockRejectedValue(
      new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' })
    );
    render(<IssueWindowsPage />);
    await choosePeriod();

    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
  });

  it('surfaces a failure to load the periods', async () => {
    fetchPeriods.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: 'Forbidden' }));
    render(<IssueWindowsPage />);
    expect(await screen.findByText(/do not have access to this area/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Period')).not.toBeInTheDocument();
  });

  it('builds the day list correctly across a month boundary and in February', async () => {
    const { daysInRange } = await import('../lib/api/rik-issue-windows-api');
    // 28 days in February 2027, 29 in the 2028 leap year.
    expect(daysInRange('2027-02-26', '2027-03-02')).toEqual([
      '2027-02-26',
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
      '2027-03-02',
    ]);
    expect(daysInRange('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
    ]);
    expect(daysInRange('2027-12-30', '2028-01-02')).toEqual([
      '2027-12-30',
      '2027-12-31',
      '2028-01-01',
      '2028-01-02',
    ]);
    expect(daysInRange('2027-03-05', '2027-03-05')).toEqual(['2027-03-05']);
    expect(daysInRange('2027-03-05', '2027-03-04')).toEqual([]);
  });
});

/**
 * MISS MUSTER — the two schedules added for the client, below Dry.
 *
 * WHAT THESE PROVE, and why each matters:
 *
 *   * they are two SEPARATE issue types, not one with two numbers. Each
 *     sends its own `rationType` at `sequenceNo: 1`, which is the shape Dry
 *     already has. Migration 0047 scopes its overlap exclusion and its
 *     ordering trigger by ration type, so a shared type would stop the two
 *     covering the same day and would impose an order between them;
 *   * staff configure and edit each one independently — configuring Fresh
 *     sends nothing about Dry, and editing one carries only its own id;
 *   * the existing Fresh and Dry slots are untouched: same codes, same
 *     sequence numbers, same count. Only the word in the label moved.
 */
describe('IssueWindowsPage — Miss Muster', () => {
  const missMusterFresh = (overrides: Partial<IssueWindow> = {}): IssueWindow =>
    window({
      windowId: 'win-mmf',
      windowCode: 'MISS_MUSTER_FRESH',
      label: 'Miss Muster Fresh',
      rationType: 'MISS_MUSTER_FRESH',
      sequenceNo: 1,
      startDate: '2027-03-20',
      endDate: '2027-03-22',
      operatingDays: ['2027-03-20'],
      ...overrides,
    });

  const missMusterDry = (overrides: Partial<IssueWindow> = {}): IssueWindow =>
    window({
      windowId: 'win-mmd',
      windowCode: 'MISS_MUSTER_DRY',
      label: 'Miss Muster Dry',
      rationType: 'MISS_MUSTER_DRY',
      sequenceNo: 1,
      startDate: '2027-03-24',
      endDate: '2027-03-26',
      operatingDays: ['2027-03-24'],
      ...overrides,
    });

  it('shows both Miss Muster schedules as their own rows, below Dry', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    await screen.findByText('Miss Muster Fresh');
    const labels = screen
      .getAllByRole('row')
      .map((r) => r.textContent ?? '')
      .filter((t) => /Fresh Issue|Dry Issue|Miss Muster/.test(t));

    const order = labels.map((t) =>
      t.includes('Miss Muster Fresh')
        ? 'MMF'
        : t.includes('Miss Muster Dry')
          ? 'MMD'
          : t.includes('Dry Issue')
            ? 'DRY'
            : 'FRESH'
    );
    // The three Fresh rows, then Dry, then the two Miss Muster rows.
    expect(order).toEqual(['FRESH', 'FRESH', 'FRESH', 'DRY', 'MMF', 'MMD']);
  });

  it('names each Miss Muster schedule by its own ration type', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    const freshRow = await screen.findByRole('row', { name: /Miss Muster Fresh/ });
    const dryRow = await screen.findByRole('row', { name: /Miss Muster Dry/ });
    expect(within(freshRow).getByText('MISS_MUSTER_FRESH')).toBeInTheDocument();
    expect(within(dryRow).getByText('MISS_MUSTER_DRY')).toBeInTheDocument();
  });

  it('configures Miss Muster Fresh on its own ration type, at sequence 1', async () => {
    configureIssueWindow.mockResolvedValue(missMusterFresh());
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Miss Muster Fresh/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-20');
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-22');
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-20'));
    await userEvent.click(screen.getByRole('button', { name: /configure miss muster fresh/i }));

    expect(configureIssueWindow).toHaveBeenCalledWith({
      periodId: PERIOD,
      rationType: 'MISS_MUSTER_FRESH',
      sequenceNo: 1,
      startDate: '2027-03-20',
      endDate: '2027-03-22',
      operatingDays: ['2027-03-20'],
    });
  });

  it('configures Miss Muster Dry independently, on its own ration type', async () => {
    configureIssueWindow.mockResolvedValue(missMusterDry());
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Miss Muster Dry/ });
    await userEvent.click(within(row).getByRole('button', { name: /configure/i }));

    await userEvent.clear(screen.getByLabelText('Start date'));
    await userEvent.type(screen.getByLabelText('Start date'), '2027-03-24');
    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-26');
    await userEvent.click(screen.getByLabelText('Issue on 2027-03-24'));
    await userEvent.click(screen.getByRole('button', { name: /configure miss muster dry/i }));

    expect(configureIssueWindow).toHaveBeenCalledWith({
      periodId: PERIOD,
      rationType: 'MISS_MUSTER_DRY',
      sequenceNo: 1,
      startDate: '2027-03-24',
      endDate: '2027-03-26',
      operatingDays: ['2027-03-24'],
    });
    // Independent: configuring one says nothing about the other.
    expect(configureIssueWindow).toHaveBeenCalledTimes(1);
  });

  it('edits a configured Miss Muster Dry by its own id, leaving Fresh alone', async () => {
    fetchIssueWindows.mockResolvedValue({ items: [missMusterFresh(), missMusterDry()] });
    updateIssueWindow.mockResolvedValue(missMusterDry({ endDate: '2027-03-27' }));
    render(<IssueWindowsPage />);
    await choosePeriod();

    const row = await screen.findByRole('row', { name: /Miss Muster Dry/ });
    await userEvent.click(within(row).getByRole('button', { name: /edit/i }));

    await userEvent.clear(screen.getByLabelText('End date'));
    await userEvent.type(screen.getByLabelText('End date'), '2027-03-27');
    await userEvent.click(screen.getByRole('button', { name: /save miss muster dry/i }));

    expect(updateIssueWindow).toHaveBeenCalledTimes(1);
    expect(updateIssueWindow.mock.calls[0]![0]).toBe('win-mmd');
  });

  it('leaves the existing Fresh and Dry slots exactly as they were', async () => {
    render(<IssueWindowsPage />);
    await choosePeriod();

    // Three Fresh, numbered 1 to 3, and exactly one Dry — no renumbering,
    // no invented "Dry Issue 2".
    for (const label of ['Fresh Issue 1', 'Fresh Issue 2', 'Fresh Issue 3', 'Dry Issue']) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Dry Issue 2')).not.toBeInTheDocument();
    expect(screen.queryByText('Fresh Issue 4')).not.toBeInTheDocument();

    const dryRow = await screen.findByRole('row', { name: /Dry Issue/ });
    expect(within(dryRow).getByText('DRY')).toBeInTheDocument();
  });
});
