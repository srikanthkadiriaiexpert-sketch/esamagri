import { Injectable } from '@nestjs/common';
import { PERMISSION_CODES, type PermissionCode } from '@esamagri/shared-types';
import type { AuthContext } from '../../auth/auth-context';
import { AdminAnnouncementsService } from './admin-announcements.service';
import { IssueWindowsRepository } from '../../rik/repositories/issue-windows.repository';
import { EntitlementPeriodsRepository } from '../../rik/repositories/entitlement-periods.repository';

/**
 * Dashboard foundation (STEP 10 Section 4).
 *
 * The hard rule here is that a tile either reports a REAL figure read
 * from the frozen database, or it reports that it is unavailable. There
 * is no third option, and specifically no fabricated sales, revenue,
 * inventory, order, customer, entitlement, product, cash or purchasing
 * number anywhere in this file.
 *
 * Only two things can be counted honestly today, because only two of
 * the tables involved carry data this phase is allowed to read:
 * announcements (scoped to the caller's audience) and RIK issue
 * schedules. Every other tile the admin application will eventually
 * want depends on a module that does not exist yet — the RIK
 * entitlement engine (BD-1..BD-3), the PIF catalogue and pricing
 * (BD-6/BD-7), inventory, POS, purchasing, orders — so each is returned
 * explicitly as `status: 'unavailable'` with the reason, and the UI
 * renders that honestly.
 *
 * Tiles are also permission-filtered: a staff member is not shown a
 * tile they have no permission to see the underlying data for, and the
 * filtering happens here on the server, not in the browser.
 */
export type DashboardTileStatus = 'available' | 'unavailable';

export interface DashboardTile {
  key: string;
  label: string;
  module: 'shared' | 'rik' | 'pif';
  status: DashboardTileStatus;
  /**
   * A real, queried figure. Never present on an unavailable tile, and not
   * present on every available one either: a tile that names a built
   * screen without counting anything (LINKED_TILES) reports no value
   * rather than a number nobody queried.
   */
  value?: number;
  /** Present only when status === 'unavailable' — why, in customer-safe words. */
  reason?: string;
}

interface TileSpec {
  key: string;
  label: string;
  module: 'shared' | 'rik' | 'pif';
  permission: PermissionCode;
  reason: string;
}

/**
 * Tiles that NAME A BUILT SCREEN AND CARRY NO FIGURE.
 *
 * These four used to sit in PENDING_TILES reporting that their modules
 * did not exist. Every one of them has since shipped — RIK configuration,
 * issue vouchers, provisions and the PIF catalogue are all working
 * screens — and nobody came back to this file. The dashboard was telling
 * administrators that features were unbuilt while they used them, which
 * is worse than an empty tile: it makes the dashboard untrustworthy.
 *
 * NO `value` IS REPORTED, DELIBERATELY. Each would need its own count
 * query, and a wrong or stale number is exactly the failure this file's
 * own rule was written against. A tile may report a real figure or none;
 * what it may never do is report a figure that is not queried. These
 * four are signposts — the number lives on the page they open.
 *
 * `permission` is the code that governs the DESTINATION, not merely the
 * subject. That distinction matters for rik-entitlements: the tile used
 * to be gated on `rik.entitlement.allocate` while /rik/config requires
 * `rik.entitlement.adjust`, so a role holding only the first was shown a
 * tile that led to a refusal.
 */
const LINKED_TILES: readonly { key: string; label: string; module: 'shared' | 'rik' | 'pif'; permission: PermissionCode }[] = [
  {
    key: 'rik-entitlements',
    label: 'RIK entitlement configuration',
    module: 'rik',
    permission: 'rik.entitlement.adjust',
  },
  {
    key: 'rik-issue-vouchers',
    label: 'RIK issue vouchers',
    module: 'rik',
    permission: 'rik.order.manage',
  },
  {
    key: 'rik-provisions',
    label: 'RIK provisions',
    module: 'rik',
    permission: 'rik.product.manage',
  },
  {
    key: 'pif-products',
    label: 'PIF products',
    module: 'pif',
    permission: 'pif.product.manage',
  },
];

/**
 * The unavailable tiles a staff member may be shown, each tied to the
 * permission that would govern the real data and to the reason it does
 * not exist yet. Every `permission` below is a code that already exists
 * in the approved seed — none is invented.
 */
const PENDING_TILES: readonly TileSpec[] = [
  {
    key: 'pif-reports',
    label: 'PIF reports',
    module: 'pif',
    permission: 'pif.report.view',
    reason: 'PIF reporting has not been built yet.',
  },
  {
    key: 'pif-purchasing',
    label: 'Purchase orders',
    module: 'pif',
    permission: 'pif.purchase_order.approve',
    reason: 'The purchasing module has not been built yet.',
  },
  {
    key: 'pif-pos',
    label: 'Point of sale',
    module: 'pif',
    permission: 'pif.pos.open_bill',
    reason: 'The point-of-sale module has not been built yet.',
  },
];

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly announcements: AdminAnnouncementsService,
    private readonly issueWindows: IssueWindowsRepository,
    private readonly periods: EntitlementPeriodsRepository
  ) {}

  async build(context: AuthContext): Promise<{ tiles: DashboardTile[] }> {
    const has = (code: PermissionCode): boolean => context.permissions.has(code);
    const tiles: DashboardTile[] = [];

    if (has('shared.announcement.manage')) {
      tiles.push({
        key: 'announcements',
        label: 'Announcements',
        module: 'shared',
        status: 'available',
        // A real count of the rows this staff member is allowed to see.
        value: await this.announcements.countVisible(context),
      });
    }

    // ACTIVE ISSUE WINDOWS, for the period that is current TODAY.
    //
    // This tile used to count rik.issue_schedules — a legacy table that is
    // empty and has no write path anywhere in the application. It reported
    // 0 forever, including to an administrator who had just finished
    // configuring a month of issue windows, which is how it was found.
    //
    // "Current period" is NOT decided here. EntitlementPeriodsRepository
    // .findCurrent() owns that definition — today's date inside the period,
    // and the period not CLOSED — and this calls it rather than repeating
    // the rule. Its own doc is explicit that there is no fallback to "the
    // latest period", so neither is there one here.
    //
    // NO OPEN PERIOD IS REPORTED AS UNAVAILABLE, NOT AS ZERO. Those are
    // different statements. Zero says "the period is open and you have
    // configured nothing", which would send an administrator looking for a
    // problem that does not exist. The same distinction this file already
    // draws between a queried figure and an absent one.
    //
    // The permission is unchanged: rik.issue_schedule.manage is what governs
    // issue windows, despite its name.
    if (has('rik.issue_schedule.manage')) {
      const period = await this.periods.findCurrent();
      tiles.push(
        period === null
          ? {
              key: 'rik-issue-windows',
              label: 'Active issue windows',
              module: 'rik',
              status: 'unavailable',
              reason: 'No entitlement period is open today, so no issue windows are in force.',
            }
          : {
              key: 'rik-issue-windows',
              label: 'Active issue windows',
              module: 'rik',
              status: 'available',
              value: await this.issueWindows.countActiveForPeriod(period.id),
            }
      );
    }

    // The four built screens. Available, named after what they open, and
    // carrying no figure — see LINKED_TILES.
    for (const spec of LINKED_TILES) {
      if (has(spec.permission)) {
        tiles.push({
          key: spec.key,
          label: spec.label,
          module: spec.module,
          status: 'available',
        });
      }
    }

    for (const spec of PENDING_TILES) {
      if (has(spec.permission)) {
        tiles.push({
          key: spec.key,
          label: spec.label,
          module: spec.module,
          status: 'unavailable',
          reason: spec.reason,
        });
      }
    }

    return { tiles };
  }
}

// Compile-time guard: every permission referenced above must exist in the
// approved seed. If a code is ever removed from the database's permission
// set, this stops compiling rather than silently gating on nothing.
const _knownPermissions: ReadonlySet<string> = new Set<string>(PERMISSION_CODES);
for (const spec of [...PENDING_TILES, ...LINKED_TILES]) {
  if (!_knownPermissions.has(spec.permission)) {
    throw new Error(`Unknown permission code in dashboard spec: ${spec.permission}`);
  }
}
