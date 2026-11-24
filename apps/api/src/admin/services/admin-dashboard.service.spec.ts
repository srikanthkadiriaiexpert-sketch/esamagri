import { AdminDashboardService } from './admin-dashboard.service';
import type { AuthContext } from '../../auth/auth-context';
import type { AdminAnnouncementsService } from './admin-announcements.service';
import type { IssueWindowsRepository } from '../../rik/repositories/issue-windows.repository';
import type { EntitlementPeriodsRepository } from '../../rik/repositories/entitlement-periods.repository';

/**
 * The dashboard's one hard rule, under test: a tile reports a figure the
 * server actually queried, or it reports why it has none. Never a number
 * nobody asked for, and never a zero standing in for "unknown".
 *
 * THE DEFECT THESE EXIST FOR. The issue-window tile used to count
 * rik.issue_schedules — a legacy table with no write path, permanently
 * empty — so it read 0 to an administrator who had just configured a
 * month of windows. These tests pin the count to the right table, to the
 * CURRENT period, and to active windows only.
 */

function contextWith(...permissions: string[]): AuthContext {
  return { permissions: new Set(permissions) } as unknown as AuthContext;
}

function serviceWith(opts: {
  announcementCount?: number;
  currentPeriod?: { id: string } | null;
  activeWindows?: number;
}) {
  const countActiveForPeriod = jest.fn().mockResolvedValue(opts.activeWindows ?? 0);
  const findCurrent = jest.fn().mockResolvedValue(opts.currentPeriod ?? null);
  const countVisible = jest.fn().mockResolvedValue(opts.announcementCount ?? 0);

  const service = new AdminDashboardService(
    { countVisible } as unknown as AdminAnnouncementsService,
    { countActiveForPeriod } as unknown as IssueWindowsRepository,
    { findCurrent } as unknown as EntitlementPeriodsRepository
  );
  return { service, countActiveForPeriod, findCurrent, countVisible };
}

type AnyTile = {
  key: string;
  label?: string;
  status?: string;
  value?: number;
  reason?: string;
};
const tile = (tiles: readonly { key: string }[], key: string): AnyTile | undefined =>
  (tiles as readonly AnyTile[]).find((t) => t.key === key);

describe('AdminDashboardService — the active issue windows tile', () => {
  it('counts windows for the period that is current TODAY, and reports the figure', async () => {
    const { service, countActiveForPeriod } = serviceWith({
      currentPeriod: { id: 'period-november' },
      activeWindows: 4,
    });

    const { tiles } = await service.build(contextWith('rik.issue_schedule.manage'));
    const t = tile(tiles, 'rik-issue-windows');

    expect(t).toMatchObject({ label: 'Active issue windows', status: 'available', value: 4 });
    // Scoped to the current period and nothing else — this is what keeps
    // last month's and next month's windows out of the number.
    expect(countActiveForPeriod).toHaveBeenCalledWith('period-november');
    expect(countActiveForPeriod).toHaveBeenCalledTimes(1);
  });

  it('asks the periods repository rather than deciding "current" for itself', async () => {
    const { service, findCurrent } = serviceWith({ currentPeriod: { id: 'p1' }, activeWindows: 1 });

    await service.build(contextWith('rik.issue_schedule.manage'));

    // The definition of "current" lives in EntitlementPeriodsRepository
    // .findCurrent(). If this file ever grows its own date logic, this
    // call disappears and the test fails.
    expect(findCurrent).toHaveBeenCalledTimes(1);
  });

  it('reports UNAVAILABLE with a reason when no period is open — never zero', async () => {
    const { service, countActiveForPeriod } = serviceWith({ currentPeriod: null });

    const { tiles } = await service.build(contextWith('rik.issue_schedule.manage'));
    const t = tile(tiles, 'rik-issue-windows') as AnyTile;

    expect(t.status).toBe('unavailable');
    expect(t.reason).toMatch(/no entitlement period is open today/i);
    // Zero would say "the period is open and you configured nothing",
    // which is a different and misleading statement.
    expect(t.value).toBeUndefined();
    // And nothing was counted, because there was no period to count for.
    expect(countActiveForPeriod).not.toHaveBeenCalled();
  });

  it('reports a real zero when the period IS open and holds no active window', async () => {
    const { service } = serviceWith({ currentPeriod: { id: 'p1' }, activeWindows: 0 });

    const { tiles } = await service.build(contextWith('rik.issue_schedule.manage'));

    expect(tile(tiles, 'rik-issue-windows')).toMatchObject({ status: 'available', value: 0 });
  });

  it('shows the tile to nobody without rik.issue_schedule.manage', async () => {
    const { service } = serviceWith({ currentPeriod: { id: 'p1' }, activeWindows: 3 });

    const { tiles } = await service.build(contextWith('pif.product.manage'));

    expect(tile(tiles, 'rik-issue-windows')).toBeUndefined();
  });

  it('no longer produces the legacy issue-schedules tile at all', async () => {
    const { service } = serviceWith({ currentPeriod: { id: 'p1' }, activeWindows: 2 });

    const { tiles } = await service.build(contextWith('rik.issue_schedule.manage'));

    expect(tile(tiles, 'rik-issue-schedules')).toBeUndefined();
  });
});

describe('AdminDashboardService — tiles that name a built screen', () => {
  it('offers RIK entitlement configuration on rik.entitlement.adjust, not .allocate', async () => {
    const { service } = serviceWith({});

    // `.adjust` is what /rik/config requires. Gating on `.allocate` was
    // the old behaviour and produced a tile leading to a refusal.
    const adjust = await service.build(contextWith('rik.entitlement.adjust'));
    expect(tile(adjust.tiles, 'rik-entitlements')).toMatchObject({
      label: 'RIK entitlement configuration',
      status: 'available',
    });

    const allocate = await service.build(contextWith('rik.entitlement.allocate'));
    expect(tile(allocate.tiles, 'rik-entitlements')).toBeUndefined();
  });

  it.each([
    ['rik-issue-vouchers', 'RIK issue vouchers', 'rik.order.manage'],
    ['rik-provisions', 'RIK provisions', 'rik.product.manage'],
    ['pif-products', 'PIF products', 'pif.product.manage'],
  ])('offers %s to a holder of %s', async (key, label, permission) => {
    const { service } = serviceWith({});

    const { tiles } = await service.build(contextWith(permission));

    expect(tile(tiles, key)).toMatchObject({ label, status: 'available' });
  });

  it('carries NO figure on those four — a number nobody queried is the thing to avoid', async () => {
    const { service } = serviceWith({});

    const { tiles } = await service.build(
      contextWith('rik.entitlement.adjust', 'rik.order.manage', 'rik.product.manage', 'pif.product.manage')
    );

    for (const key of ['rik-entitlements', 'rik-issue-vouchers', 'rik-provisions', 'pif-products']) {
      expect(tile(tiles, key)?.value).toBeUndefined();
    }
  });

  it('no longer claims these modules are unbuilt', async () => {
    const { service } = serviceWith({});

    const { tiles } = await service.build(
      contextWith('rik.entitlement.adjust', 'rik.order.manage', 'rik.product.manage', 'pif.product.manage')
    );

    const text = JSON.stringify(tiles);
    expect(text).not.toMatch(/has not been built yet/i);
    expect(text).not.toMatch(/pending confirmation/i);
  });
});

describe('AdminDashboardService — what is genuinely not built', () => {
  it('still reports PIF reports as unavailable, with its reason', async () => {
    const { service } = serviceWith({});

    const { tiles } = await service.build(contextWith('pif.report.view'));

    expect(tile(tiles, 'pif-reports')).toMatchObject({
      status: 'unavailable',
      reason: 'PIF reporting has not been built yet.',
    });
  });

  it('tells a staff member with no permissions nothing at all', async () => {
    const { service } = serviceWith({});

    const { tiles } = await service.build(contextWith());

    expect(tiles).toEqual([]);
  });
});
