import { IssueWindowError, RikIssueWindowService } from './rik-issue-window.service';
import type { AuthContext } from '../../auth/auth-context';

/**
 * A new issue schedule cannot be added to a CLOSED period.
 *
 * WHY THIS GUARD EXISTS. The Customer App resolves its issue schedule from the
 * CURRENT entitlement period, and `EntitlementPeriodsRepository.findCurrent`
 * excludes CLOSED outright. So a window created against a closed period could
 * never be reached by any officer — while still appearing in the admin list as
 * though the facility had published a live schedule. That gap between what the
 * screen shows and what an officer can use is the fault being prevented.
 *
 * WHY THESE FOUR CASES AND NOT MORE. The guard is one condition, so the risk is
 * not that it fails to fire but that it fires too widely. Three of the four
 * tests below are therefore about what must STILL work: an ordinary period, a
 * period that has merely ended, and the read paths that history depends on.
 *
 * STATUS VALUES ARE VERIFIED, NOT ASSUMED. `rik_ent_periods_status_chk` in
 * migration 0008 allows exactly UPCOMING, ACTIVE and CLOSED, and the only
 * period in staging holds ACTIVE. Both values used here are real.
 *
 * Nothing in this file touches an entitlement calculation, a Fresh or Dry rule,
 * the eligibility import, or the weekly combined Fresh issue. A window is a
 * visit — a date range and a list of operating days — and these tests only ask
 * whether one may be created.
 */

const PERIOD_ID = '01a13086-bd2e-7e74-8154-234dc4979a0d';
const WINDOW_ID = '01a136a3-5271-7fd7-8019-c5e624d23ae6';

function context(): AuthContext {
  return {
    principalType: 'STAFF',
    principalId: '01a13086-bd86-7897-b3d1-7c65548cc805',
    roles: new Set(['RIK_ADMIN']),
    permissions: new Set(['rik.issue_schedule.manage']),
  };
}

function period(over: Record<string, unknown> = {}) {
  return {
    id: PERIOD_ID,
    name: 'November 2026',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    status: 'ACTIVE',
    ...over,
  };
}

/** One FRESH visit: a date range plus the days the officer may attend. */
function freshInput() {
  return {
    periodId: PERIOD_ID,
    rationType: 'FRESH',
    sequenceNo: 1,
    startDate: '2026-11-02',
    endDate: '2026-11-08',
    operatingDays: ['2026-11-03'],
  };
}

function windowRow() {
  return {
    id: WINDOW_ID,
    period_id: PERIOD_ID,
    ration_type: 'FRESH',
    window_code: 'FRESH_1',
    sequence_no: 1,
    start_date: '2026-11-02',
    end_date: '2026-11-08',
    operating_days: ['2026-11-03'],
    is_active: true,
    notes: null,
  };
}

function harness(over: Record<string, unknown> = {}) {
  const windows = {
    create: jest.fn().mockResolvedValue(windowRow()),
    findActiveByCode: jest.fn().mockResolvedValue(null),
    findById: jest.fn().mockResolvedValue(windowRow()),
    listByPeriod: jest
      .fn()
      .mockResolvedValue('listByPeriod' in over ? over.listByPeriod : [windowRow()]),
    listRevisions: jest.fn().mockResolvedValue([]),
    listRevisionsByPeriod: jest
      .fn()
      .mockResolvedValue('listRevisionsByPeriod' in over ? over.listRevisionsByPeriod : []),
    // No clash and nothing out of order, so the success paths below reach
    // `create` rather than stopping at a validation the guard is not about.
    findOverlapping: jest.fn().mockResolvedValue([]),
    findOutOfOrder: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(windowRow()),
  };
  const periods = {
    findById: jest.fn().mockResolvedValue('findById' in over ? over.findById : period()),
  };
  const auditLog = { logEvent: jest.fn().mockResolvedValue('audit-id') };
  const service = new RikIssueWindowService(
    windows as never,
    periods as never,
    auditLog as never
  );
  return { service, windows, periods, auditLog };
}

// ===================================================================
describe('configure — a CLOSED period refuses a new issue schedule', () => {
  it('refuses with PERIOD_CLOSED and names the period', async () => {
    const { service } = harness({ findById: period({ status: 'CLOSED' }) });

    await expect(service.configure(context(), freshInput())).rejects.toThrow(
      /"November 2026" is closed/
    );
  });

  it('carries the machine-readable code, so the screen can react to it', async () => {
    const { service } = harness({ findById: period({ status: 'CLOSED' }) });

    await expect(service.configure(context(), freshInput())).rejects.toMatchObject({
      name: 'IssueWindowError',
      code: 'PERIOD_CLOSED',
      field: 'periodId',
    });
  });

  it('WRITES NOTHING — this is the assertion that matters', async () => {
    const { service, windows, auditLog } = harness({ findById: period({ status: 'CLOSED' }) });

    await expect(service.configure(context(), freshInput())).rejects.toBeInstanceOf(
      IssueWindowError
    );
    // Refused before any row is created and before anything is audited.
    expect(windows.create).not.toHaveBeenCalled();
    expect(auditLog.logEvent).not.toHaveBeenCalled();
  });
});

// ===================================================================
describe('configure — the guard must not fire any wider than that', () => {
  it('allows a new schedule on an ACTIVE period', async () => {
    const { service, windows } = harness();
    const result = await service.configure(context(), freshInput());

    expect(windows.create).toHaveBeenCalled();
    expect(result.window_code).toBe('FRESH_1');
  });

  it('allows a new schedule on a period that has ENDED but is not closed', async () => {
    // A period whose dates have passed while nobody has closed it is still
    // legitimately configurable: staff may be finishing its schedule before
    // retiring it. Only the explicit CLOSED retirement blocks — the same rule
    // findCurrent applies. If this test ever fails, the guard has started
    // reading the dates, which it must not.
    const { service, windows } = harness({
      findById: period({ start_date: '2026-10-01', end_date: '2026-10-31', status: 'ACTIVE' }),
    });

    await service.configure(context(), {
      ...freshInput(),
      startDate: '2026-10-02',
      endDate: '2026-10-08',
      operatingDays: ['2026-10-03'],
    });

    expect(windows.create).toHaveBeenCalled();
  });

  it('allows a new schedule on an UPCOMING period, so next month can be prepared', async () => {
    const { service, windows } = harness({ findById: period({ status: 'UPCOMING' }) });
    await service.configure(context(), freshInput());
    expect(windows.create).toHaveBeenCalled();
  });
});

// ===================================================================
describe('reading a CLOSED period is untouched — history must stay readable', () => {
  it('still lists the windows of a closed period', async () => {
    // The guard sits in configure(), NOT in requirePeriod(), precisely so that
    // this keeps working. requirePeriod is shared with the read paths, and a
    // guard there would have hidden the four October windows for good.
    const { service } = harness({ findById: period({ status: 'CLOSED' }) });
    const result = await service.listForPeriod(PERIOD_ID);
    expect(result).toHaveLength(1);
  });

  it('still returns the revision history of a closed period', async () => {
    const { service, windows } = harness({ findById: period({ status: 'CLOSED' }) });
    await service.revisionsForPeriod(PERIOD_ID);
    expect(windows.listRevisionsByPeriod).toHaveBeenCalledWith(PERIOD_ID);
  });
});
