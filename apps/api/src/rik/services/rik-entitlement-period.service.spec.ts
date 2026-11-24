import {
  PeriodAdminError,
  RikEntitlementPeriodService,
  derivePeriodState,
} from './rik-entitlement-period.service';
import type { AuthContext } from '../../auth/auth-context';

/**
 * Entitlement period administration, without a database.
 *
 * WHAT THESE TESTS ARE FOR. A period is two dates, and those two dates decide
 * which period is operational, which issue windows may be configured inside it,
 * and which period an officer's eligible days belong to. So the tests that
 * matter most here are about the boundaries — the first day, the last day, the
 * day after — and about the refusals, because the alternative to a refusal is a
 * period that silently reinterprets records already written against another.
 *
 * `derivePeriodState` is tested as a pure function at every boundary. The rest
 * runs against a stubbed repository, so no database is touched and none is
 * needed: every rule under test is about what the service does with what the
 * repository returns.
 */

const PERIOD_ID = '01a13086-bd2e-7e74-8154-234dc4979a0d';
const OTHER_ID = '01a13086-bd2e-7e74-8154-234dc4979a0e';

function context(): AuthContext {
  return {
    principalType: 'STAFF',
    principalId: '01a13086-bd86-7897-b3d1-7c65548cc805',
    roles: new Set(['RIK_ADMIN']),
    permissions: new Set(['rik.entitlement.allocate']),
  };
}

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

/**
 * A repository stub. `over` replaces any method, and `'key' in over` is used so
 * that passing an explicit null is not mistaken for "not supplied" — a trap
 * that cost me a silent test once already.
 */
function harness(over: Record<string, unknown> = {}) {
  const audited: Record<string, unknown>[] = [];
  const repo = {
    listAll: jest.fn().mockResolvedValue('listAll' in over ? over.listAll : [period()]),
    findById: jest.fn().mockResolvedValue('findById' in over ? over.findById : period()),
    findByName: jest.fn().mockResolvedValue('findByName' in over ? over.findByName : null),
    findOverlapping: jest
      .fn()
      .mockResolvedValue('findOverlapping' in over ? over.findOverlapping : []),
    countDependents: jest
      .fn()
      .mockResolvedValue('countDependents' in over ? over.countDependents : NO_DEPENDENTS),
    create: jest.fn().mockImplementation((input: Record<string, string>) =>
      Promise.resolve(
        period({ name: input.name, start_date: input.startDate, end_date: input.endDate, status: input.status })
      )
    ),
    update: jest.fn().mockImplementation((_id: string, input: Record<string, string>) =>
      Promise.resolve(period({ name: input.name, start_date: input.startDate, end_date: input.endDate }))
    ),
    setStatus: jest
      .fn()
      .mockImplementation((_id: string, status: string) => Promise.resolve(period({ status }))),
  };
  const auditLog = {
    logEvent: jest.fn().mockImplementation((e: Record<string, unknown>) => {
      audited.push(e);
      return Promise.resolve('audit-id');
    }),
  };
  const service = new RikEntitlementPeriodService(repo as never, auditLog as never);
  return { service, repo, auditLog, audited };
}

// ===================================================================
describe('derivePeriodState — the boundaries, which are inclusive', () => {
  const p = { start_date: '2026-11-01', end_date: '2026-11-30', status: 'ACTIVE' };

  it('is OPEN on the first day', () => {
    expect(derivePeriodState(p, '2026-11-01')).toBe('OPEN');
  });

  it('is OPEN on the last day — the period has not ended until it is over', () => {
    expect(derivePeriodState(p, '2026-11-30')).toBe('OPEN');
  });

  it('is UPCOMING the day before it starts', () => {
    expect(derivePeriodState(p, '2026-10-31')).toBe('UPCOMING');
  });

  it('is PAST the day after it ends', () => {
    expect(derivePeriodState(p, '2026-12-01')).toBe('PAST');
  });

  it('CLOSED overrides the dates, even on a day inside them', () => {
    // This is the whole point of CLOSED: the October rehearsal period must
    // never resolve as live merely because a date falls inside it.
    expect(derivePeriodState({ ...p, status: 'CLOSED' }, '2026-11-15')).toBe('CLOSED');
  });

  it('UPCOMING and ACTIVE labels do not change what the dates say', () => {
    expect(derivePeriodState({ ...p, status: 'UPCOMING' }, '2026-11-15')).toBe('OPEN');
    expect(derivePeriodState({ ...p, status: 'ACTIVE' }, '2026-12-15')).toBe('PAST');
  });
});

// ===================================================================
describe('create — what is refused', () => {
  it('refuses a blank name', async () => {
    const { service } = harness();
    await expect(
      service.create(context(), { name: '   ', startDate: '2026-12-01', endDate: '2026-12-31' })
    ).rejects.toThrow(/period name is required/i);
  });

  it('refuses an end date equal to the start date — the schema requires start < end', async () => {
    const { service } = harness();
    await expect(
      service.create(context(), { name: 'One day', startDate: '2026-12-01', endDate: '2026-12-01' })
    ).rejects.toThrow(/end date must be after the start date/i);
  });

  it('refuses an end date before the start date', async () => {
    const { service } = harness();
    await expect(
      service.create(context(), { name: 'Backwards', startDate: '2026-12-31', endDate: '2026-12-01' })
    ).rejects.toThrow(/end date must be after the start date/i);
  });

  it('refuses a date that is not a real calendar date', async () => {
    const { service } = harness();
    // Well-formed yyyy-mm-dd, but there is no 30th of February.
    await expect(
      service.create(context(), { name: 'Impossible', startDate: '2026-02-30', endDate: '2026-03-31' })
    ).rejects.toThrow(/not a real date/i);
  });

  it('refuses a duplicate name, and names the period that holds it', async () => {
    const { service } = harness({ findByName: period({ name: 'November 2026' }) });
    await expect(
      service.create(context(), { name: 'november   2026', startDate: '2026-12-01', endDate: '2026-12-31' })
    ).rejects.toThrow(/already exists/i);
  });

  it('refuses an overlap, naming the period in the way', async () => {
    const { service } = harness({ findOverlapping: [period({ name: 'November 2026' })] });
    await expect(
      service.create(context(), { name: 'December 2026', startDate: '2026-11-15', endDate: '2026-12-15' })
    ).rejects.toThrow(/overlap "November 2026"/);
  });

  it('writes nothing when it refuses', async () => {
    const { service, repo } = harness({ findOverlapping: [period()] });
    await expect(
      service.create(context(), { name: 'Clash', startDate: '2026-11-15', endDate: '2026-12-15' })
    ).rejects.toBeInstanceOf(PeriodAdminError);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

// ===================================================================
describe('create — what succeeds', () => {
  it('creates the period and defaults its label to UPCOMING', async () => {
    const { service, repo } = harness();
    const result = await service.create(context(), {
      name: 'December 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });

    expect(repo.create).toHaveBeenCalledWith({
      name: 'December 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
      status: 'UPCOMING',
    });
    expect(result.name).toBe('December 2026');
  });

  it('collapses internal whitespace in the name rather than storing it as typed', async () => {
    const { service, repo } = harness();
    await service.create(context(), {
      name: '  December   2026  ',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'December 2026' }));
  });

  it('audits the creation against the period', async () => {
    const { service, audited } = harness();
    await service.create(context(), {
      name: 'December 2026',
      startDate: '2026-12-01',
      endDate: '2026-12-31',
    });

    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      module: 'rik',
      action: 'RIK_ENTITLEMENT_PERIOD_CREATED',
      entityType: 'rik.entitlement_period',
      actorRole: 'RIK_ADMIN',
    });
  });
});

// ===================================================================
describe('update — dates are pinned once anything depends on the period', () => {
  const inUse = { ...NO_DEPENDENTS, issue_windows: 4, total: 4 };

  it('refuses a date change when records already reference the period', async () => {
    const { service, repo } = harness({ countDependents: inUse });
    await expect(
      service.update(context(), PERIOD_ID, {
        name: 'November 2026',
        startDate: '2026-11-02',
        endDate: '2026-11-30',
      })
    ).rejects.toThrow(/cannot be changed because 4 record\(s\)/i);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('still allows the NAME to be corrected on a period in use — a label changes nothing', async () => {
    const { service, repo } = harness({ countDependents: inUse });
    await service.update(context(), PERIOD_ID, {
      name: 'November 2026 (revised)',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    expect(repo.update).toHaveBeenCalledWith(PERIOD_ID, {
      name: 'November 2026 (revised)',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
  });

  it('allows a date change while nothing depends on the period', async () => {
    const { service, repo } = harness();
    await service.update(context(), PERIOD_ID, {
      name: 'November 2026',
      startDate: '2026-11-02',
      endDate: '2026-11-29',
    });
    expect(repo.update).toHaveBeenCalled();
  });

  it('does not treat the period itself as an overlap when only the name changes', async () => {
    const { service, repo } = harness();
    await service.update(context(), PERIOD_ID, {
      name: 'Renamed',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    // Dates unchanged, so no overlap check is needed at all.
    expect(repo.findOverlapping).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalled();
  });

  it('excludes itself from the overlap check when its dates do move', async () => {
    const { service, repo } = harness();
    await service.update(context(), PERIOD_ID, {
      name: 'November 2026',
      startDate: '2026-11-02',
      endDate: '2026-11-29',
    });
    expect(repo.findOverlapping).toHaveBeenCalledWith('2026-11-02', '2026-11-29', PERIOD_ID);
  });

  it('reports an unknown period as not found', async () => {
    const { service } = harness({ findById: null });
    await expect(
      service.update(context(), OTHER_ID, {
        name: 'Nope',
        startDate: '2026-12-01',
        endDate: '2026-12-31',
      })
    ).rejects.toThrow(/no longer exists/i);
  });
});

// ===================================================================
describe('setStatus — closing is always allowed', () => {
  it('closes a period even when four issue windows depend on it', async () => {
    const { service, repo } = harness({
      countDependents: { ...NO_DEPENDENTS, issue_windows: 4, total: 4 },
    });
    const result = await service.setStatus(context(), PERIOD_ID, 'CLOSED');

    expect(repo.setStatus).toHaveBeenCalledWith(PERIOD_ID, 'CLOSED');
    expect(result.status).toBe('CLOSED');
    expect(result.state).toBe('CLOSED');
  });

  it('a closed period is never reported as current', async () => {
    const { service } = harness({ findById: period({ status: 'ACTIVE' }) });
    const result = await service.setStatus(context(), PERIOD_ID, 'CLOSED');
    expect(result.isCurrent).toBe(false);
  });

  it('refuses a status outside the three the schema allows', async () => {
    const { service } = harness();
    await expect(service.setStatus(context(), PERIOD_ID, 'ARCHIVED')).rejects.toThrow(
      /must be one of UPCOMING, ACTIVE, CLOSED/
    );
  });

  it('audits a status change with both the before and after label', async () => {
    const { service, audited } = harness({ findById: period({ status: 'ACTIVE' }) });
    await service.setStatus(context(), PERIOD_ID, 'CLOSED');

    expect(audited[0]).toMatchObject({
      action: 'RIK_ENTITLEMENT_PERIOD_STATUS_CHANGED',
      before: { name: 'November 2026', status: 'ACTIVE' },
      after: { name: 'November 2026', status: 'CLOSED' },
    });
  });
});

// ===================================================================
describe('list — what the screen is told', () => {
  it('reports no current period rather than picking one, when none is open', async () => {
    // A period that ended, and has not been closed: PAST, not current.
    const { service } = harness({
      listAll: [period({ start_date: '2026-10-01', end_date: '2026-11-06', status: 'ACTIVE' })],
    });
    const result = await service.list();

    expect(result.currentPeriodId).toBeNull();
    expect(result.periods[0]!.state).toBe('PAST');
    expect(result.periods[0]!.isCurrent).toBe(false);
  });

  it('marks dates as locked when something depends on the period', async () => {
    const { service } = harness({
      countDependents: { ...NO_DEPENDENTS, eligibility: 3, total: 3 },
    });
    const result = await service.list();
    expect(result.periods[0]!.datesEditable).toBe(false);
    expect(result.periods[0]!.dependents.total).toBe(3);
  });

  it('marks dates as editable on an untouched period', async () => {
    const { service } = harness();
    const result = await service.list();
    expect(result.periods[0]!.datesEditable).toBe(true);
  });
});
