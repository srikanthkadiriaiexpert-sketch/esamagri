import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context';
import { AuditLogRepository, type AuditEntryRecord } from '../../shared/repositories/audit-log.repository';
import {
  IssueVouchersRepository,
  type FulfillmentMode,
  type IssueVoucherRecord,
  type RationType,
  type VoucherSearchFilters,
  type VoucherStatus,
} from '../repositories/issue-vouchers.repository';
import { EntitlementSelectionsRepository } from '../repositories/entitlement-selections.repository';
import { IssueWindowsRepository, type IssueWindowRecord } from '../repositories/issue-windows.repository';
import { RikSelectionValidationService } from './rik-selection-validation.service';
import { humanWindow } from './rik-issue-window.service';
import type { PoolEntitlementView } from './rik-entitlement.service';

/**
 * The RIK issue voucher (PHASE D).
 *
 * A voucher is an OPERATIONAL ENVELOPE over a confirmed monthly selection. It
 * carries the identity — number, officer, period, ration type, fulfilment and
 * status — and nothing else, because the ration itself is already recorded,
 * immutably, in that selection's `rule_snapshot`.
 *
 * SO THE CONTENTS ARE RECALCULATED FROM THE SNAPSHOT, NOT FROM TODAY
 *
 * `recalculateFromSnapshot` replays the configuration that was frozen at
 * confirmation: those scales, those conversions, those provisions, those
 * chosen quantities. A pack size changed next month, a brand renamed, a
 * provision retired, an eligible-day figure corrected — none of it can reach
 * a voucher that was already issued, because none of it is consulted. There
 * is no second copy of the ration to drift out of step with the first.
 *
 * WHAT CREATING A VOUCHER DOES NOT DO
 *
 * It inserts one row. It does not deduct an eligible day, write an
 * entitlement ledger entry, mark a ration collected or delivered, or advance
 * any status. The application holds no UPDATE privilege on the voucher table
 * at all (migration 0048), so the fulfilment transitions are not merely
 * unimplemented here — they are unreachable from this phase.
 *
 * ONE FRESH VOUCHER, ONE DRY VOUCHER
 *
 * Per confirmed selection, for ever. A Fresh voucher is NOT issued per issue
 * window: the same voucher and the same number carry from Fresh Issue 1 into
 * Window 2 and Window 3, which is why the voucher stores no window and
 * resolves the current one from the configured schedule every time it is
 * read. Change the schedule and the voucher follows it.
 */

export type IssueVoucherErrorCode =
  | 'SELECTION_NOT_FOUND'
  | 'SELECTION_NOT_CONFIRMED'
  | 'INVALID_RATION_TYPE'
  | 'NOTHING_TO_ISSUE'
  | 'FULFILLMENT_MISSING'
  | 'SNAPSHOT_MISSING'
  | 'VOUCHER_NOT_FOUND';

export class IssueVoucherError extends Error {
  readonly code: IssueVoucherErrorCode;
  readonly field?: string;
  readonly detail: Record<string, unknown>;

  constructor(
    code: IssueVoucherErrorCode,
    message: string,
    field?: string,
    detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'IssueVoucherError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

/** One line of the ration the voucher covers, as the snapshot recorded it. */
export interface VoucherProvisionLine {
  poolCode: string;
  poolName: string;
  provisionId: string;
  code: string;
  name: string;
  /** The variety or brand the officer chose, when the catalogue carries one. */
  brand: string | null;
  packSize: number | null;
  packUnit: string | null;
  unit: string;
  /** What the pool entitles, in the pool's unit, from the frozen snapshot. */
  poolEntitlement: number;
  /** What this provision was selected for — the quantity to issue. */
  quantityToIssue: number;
  /** What that selection costs the pool, at the snapshot's ratio. */
  poolEquivalentQty: number;
  consumptionRatio: number;
}

export interface VoucherPoolGroup {
  poolCode: string;
  poolName: string;
  unit: string;
  eligibleDays: number;
  totalEntitlement: number;
  lines: VoucherProvisionLine[];
}

/**
 * Where the voucher's entitlement came from.
 *
 * A LIST, deliberately, with one entry today: the voucher's own period.
 *
 * The Phase D brief describes a Dry voucher that may also carry a
 * previous-month carry-forward, with the two components separately
 * identifiable. That mechanism DOES NOT EXIST in this database — there is no
 * previous-month Dry entitlement, no remaining-days figure and no lapse rule
 * in migrations 0001-0048 — so this phase does not compute one and does not
 * invent one. The shape is a list so that the phase which defines
 * carry-forward adds a second entry here without reshaping the voucher, and
 * the components stay distinguishable rather than being merged into one
 * indistinguishable balance.
 */
export interface VoucherSourceComponent {
  kind: 'CURRENT_PERIOD';
  periodId: string;
  periodName: string;
  eligibleDays: number;
}

export interface IssueWindowSummary {
  windowCode: string;
  label: string;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  /** True for the window whose dates contain today. */
  isCurrent: boolean;
}

export interface VoucherDetail {
  voucher: IssueVoucherRecord;
  pools: VoucherPoolGroup[];
  sourceComponents: VoucherSourceComponent[];
  /** Every configured window for this ration type, in sequence order. */
  windows: IssueWindowSummary[];
  /** The window containing today, or null when none is open. */
  currentWindowCode: string | null;
}

const RATION_TYPES: readonly RationType[] = ['FRESH', 'DRY'];

/** The entry state of the locked lifecycle for each fulfilment lane. */
function entryStatus(mode: FulfillmentMode): VoucherStatus {
  return mode === 'PICKUP' ? 'READY_FOR_PICKUP' : 'READY_FOR_DELIVERY';
}

@Injectable()
export class RikIssueVoucherService {
  constructor(
    private readonly vouchers: IssueVouchersRepository,
    private readonly selections: EntitlementSelectionsRepository,
    private readonly windows: IssueWindowsRepository,
    private readonly validation: RikSelectionValidationService,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ------------------------------------------------------------------ create

  /**
   * Create the voucher for one confirmed selection and one ration type, or
   * return the one that already exists.
   *
   * IDEMPOTENT THREE TIMES OVER: the read below finds an existing voucher,
   * the INSERT's ON CONFLICT handles the concurrent duplicate, and the unique
   * constraint behind both is what actually makes a second voucher
   * impossible. A repeated request is never an error and never a second
   * document.
   */
  async create(
    context: AuthContext,
    input: { selectionId: string; rationType: string }
  ): Promise<{ voucher: IssueVoucherRecord; created: boolean }> {
    if (!(RATION_TYPES as readonly string[]).includes(input.rationType)) {
      throw new IssueVoucherError(
        'INVALID_RATION_TYPE',
        'A voucher is issued for FRESH or for DRY.',
        'rationType'
      );
    }
    const rationType = input.rationType as RationType;

    const existing = await this.vouchers.findForSelection(input.selectionId, rationType);
    if (existing !== null) return { voucher: existing, created: false };

    const selection = await this.selections.findByIdAnyCustomer(input.selectionId);
    if (selection === null) {
      throw new IssueVoucherError('SELECTION_NOT_FOUND', 'That selection does not exist.');
    }
    if (selection.status !== 'CONFIRMED') {
      throw new IssueVoucherError(
        'SELECTION_NOT_CONFIRMED',
        `Selection ${selection.reference_number ?? selection.id} is ${selection.status}. Only a confirmed selection can be issued against.`,
        'selectionId',
        { status: selection.status }
      );
    }
    if (selection.rule_snapshot === null || selection.rule_snapshot === undefined) {
      throw new IssueVoucherError(
        'SNAPSHOT_MISSING',
        'That selection carries no rule snapshot, so the ration to issue is not established.'
      );
    }
    if (selection.fulfillment_type === null) {
      throw new IssueVoucherError(
        'FULFILLMENT_MISSING',
        'That selection records no fulfilment, so there is nothing to issue against.'
      );
    }
    const mode = selection.fulfillment_type as FulfillmentMode;
    if (mode === 'PICKUP' && !selection.pickup_location_name) {
      throw new IssueVoucherError(
        'FULFILLMENT_MISSING',
        'That selection is for pickup but records no pickup location.'
      );
    }
    if (mode === 'DELIVERY' && !selection.delivery_address) {
      throw new IssueVoucherError(
        'FULFILLMENT_MISSING',
        'That selection is for delivery but records no delivery address.'
      );
    }

    // There must be something of this ration type to issue. A Fresh voucher
    // for a selection with no Fresh entitlement would be an operational
    // document for nothing.
    const pools = await this.poolsOfType(selection.id, selection.customer_id, rationType);
    if (pools.length === 0) {
      throw new IssueVoucherError(
        'NOTHING_TO_ISSUE',
        `Selection ${selection.reference_number ?? selection.id} has no ${rationType} entitlement to issue.`,
        'rationType',
        { rationType }
      );
    }

    const created = await this.vouchers.create({
      selectionId: selection.id,
      customerId: selection.customer_id,
      periodId: selection.period_id,
      rationType,
      fulfillmentMode: mode,
      // The SNAPSHOT, copied from the confirmation — not the officer's
      // current saved address.
      pickupLocationId: mode === 'PICKUP' ? selection.pickup_location_id : null,
      pickupLocationName: mode === 'PICKUP' ? selection.pickup_location_name : null,
      deliveryAddress: mode === 'DELIVERY' ? selection.delivery_address : null,
      status: entryStatus(mode),
      staffId: context.principalId,
    });

    // Lost a race with a concurrent request: the other one's voucher is the
    // voucher, and that is the right answer rather than an error.
    if (created === null) {
      const won = await this.vouchers.findForSelection(selection.id, rationType);
      if (won === null) {
        throw new IssueVoucherError('VOUCHER_NOT_FOUND', 'The voucher could not be read back.');
      }
      return { voucher: won, created: false };
    }

    await this.audit(context, 'RIK_ISSUE_VOUCHER_CREATED', created.id, null, {
      voucherNumber: created.voucher_number,
      selectionId: created.selection_id,
      selectionReference: created.selection_reference,
      rikId: created.rik_id,
      rationType: created.ration_type,
      fulfillmentMode: created.fulfillment_mode,
      status: created.status,
    });

    return { voucher: created, created: true };
  }

  // ------------------------------------------------------------------- reads

  async detail(voucherId: string): Promise<VoucherDetail> {
    const voucher = await this.vouchers.findById(voucherId);
    if (voucher === null) {
      throw new IssueVoucherError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }
    return this.detailOf(voucher);
  }

  /**
   * An officer's own voucher. OWNERSHIP IS ENFORCED HERE, on the server, by
   * reading the voucher and comparing its officer to the authenticated one —
   * and a voucher belonging to someone else answers exactly as a voucher that
   * does not exist, so knowing an id reveals nothing.
   */
  async detailForCustomer(customerId: string, voucherId: string): Promise<VoucherDetail> {
    const voucher = await this.vouchers.findById(voucherId);
    if (voucher === null || voucher.customer_id !== customerId) {
      throw new IssueVoucherError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }
    return this.detailOf(voucher);
  }

  async listForCustomer(customerId: string): Promise<IssueVoucherRecord[]> {
    return this.vouchers.listForCustomer(customerId);
  }

  async listForSelection(selectionId: string): Promise<IssueVoucherRecord[]> {
    return this.vouchers.listForSelection(selectionId);
  }

  async search(filters: VoucherSearchFilters): Promise<{
    items: IssueVoucherRecord[];
    total: number;
  }> {
    const [items, total] = await Promise.all([
      this.vouchers.search(filters),
      // Every filter the page applies must reach count() too, or the table
      // shows a page of rows beside a total that disagrees with it.
      this.vouchers.count({
        q: filters.q,
        rationType: filters.rationType,
        fulfillmentMode: filters.fulfillmentMode,
        status: filters.status,
        periodId: filters.periodId,
        issuedFrom: filters.issuedFrom,
        issuedTo: filters.issuedTo,
      }),
    ]);
    return { items, total };
  }

  /**
   * The voucher's history, from the project's existing audit log. No parallel
   * audit table was created for Phase D.
   */
  async history(voucherId: string): Promise<AuditEntryRecord[]> {
    const voucher = await this.vouchers.findById(voucherId);
    if (voucher === null) {
      throw new IssueVoucherError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }
    // The project's existing audit reader, narrowed to this voucher. No
    // parallel audit table was created for Phase D.
    return this.auditLog.listForModule({
      module: 'rik',
      entityTypes: ['rik.issue_voucher'],
      entityId: voucherId,
      limit: 200,
    });
  }

  // --------------------------------------------------------------- internals

  private async detailOf(voucher: IssueVoucherRecord): Promise<VoucherDetail> {
    const pools = await this.poolsOfType(
      voucher.selection_id,
      voucher.customer_id,
      voucher.ration_type
    );

    const configured = await this.windows.listByPeriod(voucher.period_id, true);
    const today = new Date().toISOString().slice(0, 10);
    const windows: IssueWindowSummary[] = configured
      .filter((w: IssueWindowRecord) => w.ration_type === voucher.ration_type)
      .sort((a, b) => a.sequence_no - b.sequence_no)
      .map((w) => ({
        windowCode: w.window_code,
        label: humanWindow(w.window_code),
        sequenceNo: w.sequence_no,
        startDate: w.start_date,
        endDate: w.end_date,
        operatingDays: w.operating_days,
        isCurrent: w.start_date <= today && today <= w.end_date,
      }));

    return {
      voucher,
      pools,
      sourceComponents: [
        {
          kind: 'CURRENT_PERIOD',
          periodId: voucher.period_id,
          periodName: voucher.period_name,
          eligibleDays: pools[0]?.eligibleDays ?? 0,
        },
      ],
      windows,
      currentWindowCode: windows.find((w) => w.isCurrent)?.windowCode ?? null,
    };
  }

  /**
   * The ration of one type, replayed from the confirmed selection's own
   * snapshot. Only the provisions the officer actually selected — a voucher
   * lists what is to be issued, not the whole catalogue.
   *
   * FRESH or DRY HERE MEANS THE PHYSICAL ISSUE STREAM, which is the
   * provision's own `issue_period`, NOT the entitlement pool's ration type.
   * The two genuinely differ in the approved catalogue: bread sits in the
   * CEREALS pool, whose ration type is DRY, but is issued FRESH. The Phase C
   * issue windows are the physical collection schedule, so a Fresh voucher
   * must carry exactly what is collected in Fresh Issues 1 to 3 — which is
   * why both sides of the calculation are read and the LINES are filtered.
   * Each line still reports its own pool, so the pool arithmetic the officer
   * saw at confirmation is unchanged.
   */
  private async poolsOfType(
    selectionId: string,
    customerId: string,
    rationType: RationType
  ): Promise<VoucherPoolGroup[]> {
    const calculation = await this.validation.recalculateFromSnapshot(selectionId, customerId);
    if (calculation === null) return [];
    return groupsOfType(calculation, rationType);
  }

  /**
   * The SAME replay, for the PHASE C export, with one difference: it
   * distinguishes "the snapshot could not be replayed" (null) from "the
   * snapshot replayed and holds nothing of this ration type" (empty array).
   *
   * `poolsOfType` above collapses both to an empty array, which is right
   * for its callers — `create` turns either into NOTHING_TO_ISSUE and
   * `detailOf` renders a voucher with no pools. The export must not
   * collapse them: it stops and names the voucher rather than hand a store
   * a packing list that is quietly one officer's ration short.
   *
   * It replays ONCE, like its sibling, and both use the same grouping
   * function below — so the export cannot disagree with the voucher screen
   * about which provisions belong to which issue stream.
   */
  async poolsForExport(
    selectionId: string,
    customerId: string,
    rationType: RationType
  ): Promise<VoucherPoolGroup[] | null> {
    const calculation = await this.validation.recalculateFromSnapshot(selectionId, customerId);
    if (calculation === null) return null;
    return groupsOfType(calculation, rationType);
  }

  private async audit(
    context: AuthContext,
    action: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'rik',
      action,
      entityType: 'rik.issue_voucher',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}

/**
 * What a successful snapshot replay returns, DERIVED from the validation
 * service rather than written out here.
 *
 * Spelling the shape by hand would be a second declaration of someone
 * else's return type, free to drift the moment that service changes. This
 * cannot drift: if `recalculateFromSnapshot` changes shape, this type
 * changes with it and the compiler points at the grouping below.
 */
type SnapshotCalculation = NonNullable<
  Awaited<ReturnType<RikSelectionValidationService['recalculateFromSnapshot']>>
>;

/**
 * The pool and line grouping, lifted out of `poolsOfType` UNCHANGED so the
 * export can share it without replaying a snapshot a second time.
 *
 * Pure: a replayed calculation in, groups out. It is the only place the
 * FRESH/DRY issue-stream filter is applied.
 */
function groupsOfType(
  calculation: SnapshotCalculation,
  rationType: RationType
): VoucherPoolGroup[] {
  const allPools: PoolEntitlementView[] = [...calculation.fresh, ...calculation.dry];

  return allPools
      .map((pool) => ({
        poolCode: pool.code,
        poolName: pool.name,
        unit: pool.unit,
        eligibleDays: pool.eligibleDays,
        totalEntitlement: pool.totalEntitlement,
        lines: pool.provisions
          .filter((p) => p.selectedQuantity > 0 && p.issuePeriod === rationType)
          .map((p) => ({
            poolCode: pool.code,
            poolName: pool.name,
            provisionId: p.provisionId,
            code: p.code,
            name: p.name,
            brand: p.brand,
            packSize: p.packSize,
            packUnit: p.packUnit,
            unit: p.unit,
            poolEntitlement: pool.totalEntitlement,
            quantityToIssue: p.selectedQuantity,
            poolEquivalentQty: p.selectedPoolEquivalentQty,
            consumptionRatio: p.consumptionRatio,
          })),
      }))
      .filter((group) => group.lines.length > 0);
}
