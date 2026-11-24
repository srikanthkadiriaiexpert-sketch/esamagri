import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { AuthContext } from '../../auth/auth-context';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import {
  FulfillmentRepository,
  type CarryForwardRecord,
  type FulfillmentOutcome,
  type IssueLineInput,
  type IssueLineRecord,
  type OutcomeRecord,
} from '../repositories/fulfillment.repository';
import { IssueVouchersRepository, type IssueVoucherRecord } from '../repositories/issue-vouchers.repository';
import { EntitlementSelectionsRepository } from '../repositories/entitlement-selections.repository';
import { EntitlementPeriodsRepository } from '../repositories/entitlement-periods.repository';
import { IssueWindowsRepository, type IssueWindowRecord } from '../repositories/issue-windows.repository';
import { RikSelectionValidationService } from './rik-selection-validation.service';
import { EntitlementConfigRepository, type ProvisionRecord } from '../repositories/entitlement-config.repository';
import { RikEligibilityService } from './rik-eligibility.service';
import type { PoolEntitlementView, ProvisionView } from './rik-entitlement.service';

/**
 * PHASE E — physical fulfilment.
 *
 * Three things happen here and nowhere else: what was handed over is
 * recorded, what that consumed is worked out, and what was never handed over
 * either lapses or carries forward.
 *
 * WHAT MAKES THIS SAFE
 *
 *  * EVERY COMPLETION IS ONE TRANSACTION. The outcome, its issue lines and
 *    any carry-forward draw go in together or not at all.
 *  * CONCURRENCY IS THE DATABASE'S JOB. `UNIQUE (voucher_id, sequence_no)`
 *    refuses the second of two simultaneous completions, and the lifecycle
 *    trigger refuses a transition that does not follow the locked lane. This
 *    service checks the same things first so the caller gets a sentence
 *    rather than a constraint name, but it is not what enforces them.
 *  * NOTHING IS INFERRED. A collection is recorded because a staff member
 *    recorded it. No elapsed time, no app activity and no read of a page
 *    ever marks ration as issued.
 *  * THE CONFIRMED SELECTION IS NEVER TOUCHED. A substitution is a fulfilment
 *    fact: the line records what was confirmed AND what was actually given.
 *    The selection and its rule_snapshot stay exactly as the officer left
 *    them.
 *
 * THE ONE ALLOCATION RULE THIS PHASE NEEDED
 *
 * When an officer has both a carried Dry balance and this month's own, a
 * handover draws on the CARRIED balance first. It is the component with a
 * deadline — it lapses when this month's Dry window closes, while the
 * current month's own entitlement is not at risk in the same way — so
 * spending it first is what stops a balance lapsing while the officer was
 * standing at the counter. Stated here because it had to be decided to
 * implement §5B at all, and it is reported as an implementation decision.
 */

export type FulfillmentErrorCode =
  | 'VOUCHER_NOT_FOUND'
  | 'OUTCOME_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'REASON_REQUIRED'
  | 'NOTHING_ISSUED'
  | 'PROVISION_NOT_IN_SNAPSHOT'
  | 'SUBSTITUTE_NOT_APPROVED'
  | 'QUANTITY_EXCEEDS_ENTITLEMENT'
  | 'INVALID_QUANTITY'
  | 'SNAPSHOT_MISSING'
  | 'ALREADY_COMPLETED'
  | 'NOT_COMPLETED'
  | 'PERIOD_NOT_FOUND';

export class FulfillmentError extends Error {
  readonly code: FulfillmentErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: FulfillmentErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'FulfillmentError';
    this.code = code;
    this.detail = detail;
  }
}

/** One handover line as the counter sends it. */
export interface IssueLineRequest {
  provisionId: string;
  quantity: number;
  /** Set only when this replaces something the officer confirmed. */
  originalProvisionId?: string | null;
  substitutionReason?: string | null;
}

export interface SubstituteOption {
  provisionId: string;
  code: string;
  name: string;
  brand: string | null;
  unit: string;
  /** Presentation only — what one of them is called, so a staff screen can
   *  write "4 coupons" rather than "4 piece". Never read by a calculation. */
  packUnit: string | null;
  packSize: number | null;
  consumptionRatio: number;
  /** What this provision's quantity would have to be for the same pool cost. */
  equivalentQuantity: number;
}

export interface SubstitutionOptionsView {
  poolCode: string;
  poolName: string;
  poolUnit: string;
  originalProvisionId: string;
  originalCode: string;
  originalName: string;
  originalQuantity: number;
  poolEquivalentQty: number;
  alternatives: SubstituteOption[];
}

export interface FulfillmentView {
  status: string;
  completion: OutcomeRecord | null;
  events: OutcomeRecord[];
  issuedLines: IssueLineRecord[];
  carryForward: CarryForwardRecord[];
  /** Set when the final Fresh window has closed and nothing was taken. */
  lapsed: boolean;
  lapseReason: string | null;
  finalWindowCode: string | null;
  finalWindowEndDate: string | null;
  /** True while a Fresh voucher is open and the final window is near. */
  reminderDue: boolean;
  daysToFinalWindowClose: number | null;
}

const COMPLETING: readonly FulfillmentOutcome[] = ['COLLECTED', 'DELIVERED'];
const TERMINAL: readonly FulfillmentOutcome[] = [
  'COLLECTED',
  'NOT_COLLECTED',
  'DELIVERED',
  'NOT_DELIVERED',
];

/** How near the final Fresh window has to be before the officer is reminded. */
const REMINDER_DAYS = 3;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000
  );
}

@Injectable()
export class RikFulfillmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fulfillment: FulfillmentRepository,
    private readonly vouchers: IssueVouchersRepository,
    private readonly selections: EntitlementSelectionsRepository,
    private readonly periods: EntitlementPeriodsRepository,
    private readonly windows: IssueWindowsRepository,
    private readonly validation: RikSelectionValidationService,
    private readonly config: EntitlementConfigRepository,
    private readonly eligibility: RikEligibilityService,
    private readonly auditLog: AuditLogRepository
  ) {}

  // =====================================================================
  // Recording what happened
  // =====================================================================

  /**
   * Record a fulfilment outcome, with the provisions actually handed over
   * when it completes the voucher.
   *
   * IDEMPOTENT-SAFE RATHER THAN IDEMPOTENT. Repeating a completion is not a
   * silent no-op — it is refused, by the lifecycle trigger and by the unique
   * sequence, because two collections of one voucher is exactly the mistake
   * this phase exists to make impossible. The caller gets ALREADY_COMPLETED
   * and the first record stands.
   */
  async recordOutcome(
    context: AuthContext,
    input: {
      voucherId: string;
      outcome: FulfillmentOutcome;
      reason?: string | null;
      notes?: string | null;
      lines?: IssueLineRequest[];
    }
  ): Promise<{ outcomeId: string; voucher: IssueVoucherRecord }> {
    const voucher = await this.vouchers.findById(input.voucherId);
    if (voucher === null) {
      throw new FulfillmentError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }

    if (
      (input.outcome === 'NOT_COLLECTED' || input.outcome === 'NOT_DELIVERED') &&
      !input.reason?.trim()
    ) {
      throw new FulfillmentError(
        'REASON_REQUIRED',
        'Recording that a ration was not taken requires a reason.'
      );
    }

    const existing = await this.fulfillment.currentCompletion(voucher.id);
    if (existing !== null && TERMINAL.includes(input.outcome)) {
      throw new FulfillmentError(
        'ALREADY_COMPLETED',
        `Voucher ${voucher.voucher_number} is already ${existing.outcome}. Correct it with a recorded reversal rather than completing it twice.`,
        { outcome: existing.outcome, outcomeId: existing.id }
      );
    }

    const completing = COMPLETING.includes(input.outcome);
    const lines = input.lines ?? [];
    if (completing && lines.length === 0) {
      throw new FulfillmentError(
        'NOTHING_ISSUED',
        'A collection or delivery records what was actually handed over; at least one line is required.'
      );
    }
    if (!completing && lines.length > 0) {
      throw new FulfillmentError(
        'NOTHING_ISSUED',
        `Nothing is issued against a ${input.outcome} event.`
      );
    }

    // Pre-check the locked lane so the counter gets a sentence rather than a
    // constraint. The DATABASE is still what enforces it (migration 0049) —
    // this only decides which message the caller reads.
    this.requireLegalTransition(voucher.status, voucher.fulfillment_mode, input.outcome, voucher.voucher_number);

    const windowCode = await this.currentWindowCode(voucher);
    const staffRole = [...context.roles].sort().join(',') || 'STAFF';

    // VALIDATED BEFORE THE TRANSACTION OPENS, deliberately.
    // `DatabaseService.withTransaction` replaces any error escaping its
    // callback with a generic SafeDatabaseError — right for driver detail,
    // wrong for a domain refusal the counter has to read ("that substitute
    // draws on another entitlement"). Preparing the lines is all reads, so
    // it happens first and the transaction only writes.
    const prepared = completing ? await this.prepareLines(voucher, lines) : [];

    const outcomeId = await this.writeOutcome(voucher, {
      outcome: input.outcome,
      reason: input.reason ?? null,
      windowCode,
      staffId: context.principalId,
      staffRole,
      notes: input.notes ?? null,
      prepared,
    });

    await this.audit(context, `RIK_VOUCHER_${input.outcome}`, voucher, {
      outcomeId,
      outcome: input.outcome,
      reason: input.reason ?? null,
      windowCode,
      lines: lines.length,
    });

    const after = await this.vouchers.findById(voucher.id);
    return { outcomeId, voucher: after ?? voucher };
  }

  /**
   * The write half of `recordOutcome`, and the place where A GENUINE RACE is
   * turned back into a sentence.
   *
   * Two counters pressing "Collected" on the same voucher in the same instant
   * both pass the pre-check above, because at that moment neither completion
   * exists. One of them then loses — to `UNIQUE (voucher_id, sequence_no)` or
   * to the lifecycle trigger's one-standing-completion rule, whichever the
   * database reaches first. That is exactly the protection wanted, but
   * `withTransaction` hands the loser a generic SafeDatabaseError, which the
   * controller can only report as 500: a bare failure, on a voucher that was
   * in fact completed correctly a millisecond earlier by someone else.
   *
   * So the loser's error is caught, the voucher is re-read, and if a standing
   * completion is now there the refusal becomes the same ALREADY_COMPLETED
   * the sequential case gives — 409, naming the outcome and its record. If no
   * completion is found the original error is rethrown untouched, because
   * then it was not a race and must not be dressed up as one.
   */
  private async writeOutcome(
    voucher: IssueVoucherRecord,
    write: {
      outcome: FulfillmentOutcome;
      reason: string | null;
      windowCode: string | null;
      staffId: string | null;
      staffRole: string;
      notes: string | null;
      prepared: IssueLineInput[];
    }
  ): Promise<string> {
    try {
      return await this.insertOutcomeWithLines(voucher, write);
    } catch (err) {
      if (err instanceof FulfillmentError) throw err;
      if (!TERMINAL.includes(write.outcome)) throw err;
      const winner = await this.fulfillment.currentCompletion(voucher.id);
      if (winner === null) throw err;
      throw new FulfillmentError(
        'ALREADY_COMPLETED',
        `Voucher ${voucher.voucher_number} is already ${winner.outcome}. Correct it with a recorded reversal rather than completing it twice.`,
        { outcome: winner.outcome, outcomeId: winner.id }
      );
    }
  }

  private async insertOutcomeWithLines(
    voucher: IssueVoucherRecord,
    write: {
      outcome: FulfillmentOutcome;
      reason: string | null;
      windowCode: string | null;
      staffId: string | null;
      staffRole: string;
      notes: string | null;
      prepared: IssueLineInput[];
    }
  ): Promise<string> {
    const { windowCode, staffId, staffRole, prepared } = write;
    return this.db.withTransaction(async (client) => {
      const id = await this.fulfillment.insertOutcome(client, {
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        outcome: write.outcome,
        eventType: 'OUTCOME',
        reason: write.reason,
        windowCode,
        staffId,
        staffRole,
        notes: write.notes,
      });

      for (const line of prepared) {
        await this.fulfillment.insertIssueLine(client, id, voucher.id, line);
      }
      return id;
    });
  }

  /**
   * Turn the counter's lines into records, checking every one against the
   * officer's own frozen snapshot.
   *
   * WHAT IS REFUSED HERE: a provision the officer never confirmed and that
   * substitutes for nothing; a substitute that draws on a different
   * entitlement; a quantity that would take more from a pool than the
   * officer is entitled to. The pool arithmetic is the catalogue's own
   * consumption ratios — this method introduces no conversion of its own.
   */
  private async prepareLines(
    voucher: IssueVoucherRecord,
    lines: IssueLineRequest[]
  ): Promise<IssueLineInput[]> {
    const calculation = await this.validation.recalculateFromSnapshot(
      voucher.selection_id,
      voucher.customer_id
    );
    if (calculation === null) {
      throw new FulfillmentError(
        'SNAPSHOT_MISSING',
        'That selection carries no rule snapshot, so there is nothing to issue against.'
      );
    }

    const pools = [...calculation.fresh, ...calculation.dry];

    // THE SNAPSHOT HOLDS ONLY WHAT THE OFFICER CHOSE. A confirmed selection
    // freezes the chosen items, not the whole catalogue, so an APPROVED
    // ALTERNATIVE cannot come from it — and should not: the counter can only
    // hand over something the catalogue still carries. The entitlement stays
    // the snapshot's; the list of what may stand in for a chosen item is the
    // live catalogue of the SAME pool, with the officer's own dietary and
    // eligible-day rules applied, exactly as the selection screen applies
    // them.
    const live = await this.config.loadConfiguration(todayIso());
    const basis = {
      customerId: voucher.customer_id,
      periodId: voucher.period_id,
      dietaryPreference: calculation.dietaryPreference,
      eligibleDays: calculation.eligibleDays,
      freshEligibleDays: calculation.freshEligibleDays,
      dryEligibleDays: calculation.dryEligibleDays,
      asOf: calculation.asOf,
    };
    const byProvision = new Map<string, ProvisionRecord>();
    for (const p of live.provisions) byProvision.set(p.id, p);

    // What the officer confirmed, for this voucher's ration stream.
    const confirmed = new Map<string, { pool: PoolEntitlementView; view: ProvisionView }>();
    for (const pool of pools) {
      for (const view of pool.provisions) {
        if (view.selectedQuantity > 0 && view.issuePeriod === voucher.ration_type) {
          confirmed.set(view.provisionId, { pool, view });
        }
      }
    }

    // Already issued against this selection, so a correction-and-reissue or a
    // second voucher cannot quietly exceed the entitlement.
    const issued = new Map<string, number>();
    for (const row of await this.fulfillment.issuedByPool(voucher.selection_id)) {
      issued.set(row.pool_id, Number(row.issued));
    }

    // The carried Dry balance, newest first, so it is spent before this
    // month's own (see the class comment).
    const carry = new Map<string, { id: string; remaining: number }>();
    if (voucher.ration_type === 'DRY') {
      for (const row of await this.fulfillment.listCarryForwardForTarget(
        voucher.customer_id,
        voucher.period_id
      )) {
        if (row.lapsed_at !== null) continue;
        const remaining = Number(row.remaining);
        if (remaining > 0) carry.set(row.pool_id, { id: row.id, remaining });
      }
    }

    const prepared: IssueLineInput[] = [];
    const drawnByPool = new Map<string, number>();

    for (const line of lines) {
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new FulfillmentError('INVALID_QUANTITY', 'An issued quantity must be greater than zero.', {
          provisionId: line.provisionId,
        });
      }

      const actualRecord = byProvision.get(line.provisionId);
      if (actualRecord === undefined) {
        throw new FulfillmentError(
          'PROVISION_NOT_IN_SNAPSHOT',
          'That provision is not in the catalogue.',
          { provisionId: line.provisionId }
        );
      }
      const actualPool = pools.find((p) => p.poolId === actualRecord.pool_id);
      if (actualPool === undefined) {
        throw new FulfillmentError(
          'SUBSTITUTE_NOT_APPROVED',
          'That provision draws on an entitlement this officer does not hold.',
          { provisionId: line.provisionId }
        );
      }
      const actual = {
        pool: actualPool,
        view: {
          provisionId: actualRecord.id,
          name: actualRecord.name,
          consumptionRatio: Number(actualRecord.consumption_ratio),
        },
      };

      const originalId = line.originalProvisionId ?? null;
      if (originalId !== null && originalId !== line.provisionId) {
        const original = confirmed.get(originalId);
        if (original === undefined) {
          throw new FulfillmentError(
            'SUBSTITUTE_NOT_APPROVED',
            'A substitution replaces something the officer actually confirmed; that provision is not on this voucher.',
            { originalProvisionId: originalId }
          );
        }
        // THE APPROVED-ALTERNATIVE RULE: a substitute must draw on the SAME
        // entitlement pool. Anything else would hand over a ration the
        // officer has no entitlement to.
        if (original.pool.poolId !== actual.pool.poolId) {
          throw new FulfillmentError(
            'SUBSTITUTE_NOT_APPROVED',
            `${actual.view.name} draws on ${actual.pool.name} and cannot be issued in place of ${original.view.name}, which draws on ${original.pool.name}.`,
            { provisionId: line.provisionId, originalProvisionId: originalId }
          );
        }
        if (
          // The eligible days come off the pool the calculation produced —
          // the Dry figure for a Dry pool, the Fresh figure for a Fresh
          // one — so a substitute is judged against the same number the
          // officer's balance in that pool was built from.
          !this.eligibility.isProvisionAvailable(
            actualRecord,
            basis,
            actualPool.effectiveDailyQty > 0,
            actualPool.eligibleDays
          )
        ) {
          throw new FulfillmentError(
            'SUBSTITUTE_NOT_APPROVED',
            `${actualRecord.name} is not an approved alternative for this officer.`,
            { provisionId: line.provisionId }
          );
        }
        if (!line.substitutionReason?.trim()) {
          throw new FulfillmentError(
            'REASON_REQUIRED',
            'A substitution must record why the original provision was not issued.',
            { provisionId: line.provisionId }
          );
        }
      } else if (!confirmed.has(line.provisionId)) {
        throw new FulfillmentError(
          'PROVISION_NOT_IN_SNAPSHOT',
          'That provision was not chosen by the officer. Issue it as a recorded substitution, or not at all.',
          { provisionId: line.provisionId }
        );
      }

      const ratio = actual.view.consumptionRatio;
      const equivalent = round4(line.quantity * ratio);
      const poolId = actual.pool.poolId;

      const carried = carry.get(poolId);
      const carriedDraw = carried ? Math.min(carried.remaining, equivalent) : 0;
      const ownDraw = round4(equivalent - carriedDraw);

      const alreadyDrawn = drawnByPool.get(poolId) ?? 0;
      const alreadyIssued = issued.get(poolId) ?? 0;
      const entitlement = actual.pool.totalEntitlement;

      // The carried component is extra entitlement, so only the part drawn
      // from THIS period's own balance is checked against it.
      if (round4(alreadyIssued + alreadyDrawn + ownDraw) > round4(entitlement) + 1e-6) {
        throw new FulfillmentError(
          'QUANTITY_EXCEEDS_ENTITLEMENT',
          `Issuing ${line.quantity} of ${actual.view.name} would take more than this officer’s ${actual.pool.name} entitlement.`,
          {
            provisionId: line.provisionId,
            poolCode: actual.pool.code,
            entitlement,
            alreadyIssued: round4(alreadyIssued + alreadyDrawn),
            requested: ownDraw,
          }
        );
      }

      if (carried && carriedDraw > 0) carried.remaining = round4(carried.remaining - carriedDraw);
      drawnByPool.set(poolId, round4(alreadyDrawn + ownDraw));

      prepared.push({
        poolId,
        provisionId: line.provisionId,
        originalProvisionId: originalId !== null && originalId !== line.provisionId ? originalId : null,
        quantity: round4(line.quantity),
        consumptionRatio: ratio,
        poolEquivalentQty: equivalent,
        carryForwardQty: carriedDraw,
        substitutionReason:
          originalId !== null && originalId !== line.provisionId
            ? (line.substitutionReason ?? '').trim()
            : null,
      });
    }

    return prepared;
  }

  // =====================================================================
  // Correcting a completed voucher
  // =====================================================================

  /**
   * Reverse a completion that should not stand.
   *
   * NOT an edit, not a delete, not an undo. The original completion and its
   * issue lines stay exactly where they are; a REVERSED event is appended
   * beside them with the reason, the actor and the moment. The voucher
   * returns to the state the completion left from, and what was issued stops
   * counting as issued — which is what makes a corrected collection release
   * the entitlement it had consumed.
   */
  async reverseCompletion(
    context: AuthContext,
    input: { voucherId: string; outcomeId: string; reason: string; notes?: string | null }
  ): Promise<{ correctionId: string; voucher: IssueVoucherRecord }> {
    const voucher = await this.vouchers.findById(input.voucherId);
    if (voucher === null) {
      throw new FulfillmentError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }
    if (!input.reason?.trim()) {
      throw new FulfillmentError('REASON_REQUIRED', 'A correction must record why it was made.');
    }

    const target = await this.fulfillment.findOutcome(input.outcomeId);
    if (target === null || target.voucher_id !== voucher.id) {
      throw new FulfillmentError('OUTCOME_NOT_FOUND', 'That fulfilment event does not belong to this voucher.');
    }
    if (!TERMINAL.includes(target.outcome)) {
      throw new FulfillmentError(
        'NOT_COMPLETED',
        'Only a completed collection or delivery can be reversed.',
        { outcome: target.outcome }
      );
    }
    if (target.reversed) {
      throw new FulfillmentError(
        'ALREADY_COMPLETED',
        'That completion has already been reversed.',
        { outcomeId: target.id }
      );
    }

    const before = { status: voucher.status, outcome: target.outcome, outcomeId: target.id };
    const staffRole = [...context.roles].sort().join(',') || 'STAFF';

    const correctionId = await this.db.withTransaction((client) =>
      this.fulfillment.insertOutcome(client, {
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        outcome: 'REVERSED',
        eventType: 'CORRECTION',
        reason: input.reason.trim(),
        supersedesId: target.id,
        staffId: context.principalId,
        staffRole,
        notes: input.notes ?? null,
      })
    );

    const after = await this.vouchers.findById(voucher.id);
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: staffRole,
      module: 'rik',
      action: 'RIK_VOUCHER_COMPLETION_REVERSED',
      entityType: 'rik.issue_voucher',
      entityId: voucher.id,
      before,
      after: {
        correctionId,
        reason: input.reason.trim(),
        status: after?.status ?? voucher.status,
        voucherNumber: voucher.voucher_number,
      },
    });

    return { correctionId, voucher: after ?? voucher };
  }

  // =====================================================================
  // Reading
  // =====================================================================

  async view(voucher: IssueVoucherRecord): Promise<FulfillmentView> {
    const [events, issuedLines, completion] = await Promise.all([
      this.fulfillment.listOutcomes(voucher.id),
      this.fulfillment.listCurrentIssueLines(voucher.id),
      this.fulfillment.currentCompletion(voucher.id),
    ]);

    const carryForward =
      voucher.ration_type === 'DRY'
        ? await this.fulfillment.listCarryForwardForTarget(voucher.customer_id, voucher.period_id)
        : [];

    const final = await this.finalWindow(voucher);
    const today = todayIso();
    const open = completion === null;
    const closed = final !== null && final.end_date < today;

    const lapseEvent = events.find((e) => e.reason === 'WINDOW_CLOSED' && !e.reversed) ?? null;

    return {
      status: voucher.status,
      completion,
      events,
      issuedLines,
      carryForward,
      lapsed: lapseEvent !== null || (open && closed),
      lapseReason: lapseEvent !== null ? 'WINDOW_CLOSED' : open && closed ? 'WINDOW_CLOSED' : null,
      finalWindowCode: final?.window_code ?? null,
      finalWindowEndDate: final?.end_date ?? null,
      reminderDue:
        open &&
        final !== null &&
        !closed &&
        daysBetween(today, final.end_date) <= REMINDER_DAYS,
      daysToFinalWindowClose: final === null ? null : daysBetween(today, final.end_date),
    };
  }

  async substitutionOptions(voucher: IssueVoucherRecord): Promise<SubstitutionOptionsView[]> {
    const calculation = await this.validation.recalculateFromSnapshot(
      voucher.selection_id,
      voucher.customer_id
    );
    if (calculation === null) return [];

    const live = await this.config.loadConfiguration(todayIso());
    const basis = {
      customerId: voucher.customer_id,
      periodId: voucher.period_id,
      dietaryPreference: calculation.dietaryPreference,
      eligibleDays: calculation.eligibleDays,
      
      freshEligibleDays: calculation.freshEligibleDays,
      dryEligibleDays: calculation.dryEligibleDays,
      asOf: calculation.asOf,
    };

    const out: SubstitutionOptionsView[] = [];
    for (const pool of [...calculation.fresh, ...calculation.dry]) {
      for (const chosen of pool.provisions) {
        if (chosen.selectedQuantity <= 0 || chosen.issuePeriod !== voucher.ration_type) continue;

        const poolEquivalent = round4(chosen.selectedQuantity * chosen.consumptionRatio);
        // Approved alternatives are the OTHER provisions of the same pool
        // that this officer may be offered — the snapshot's own list, which
        // already has the dietary and eligible-day rules applied. Equivalent
        // quantity is the catalogue's consumption ratio and nothing else.
        const alternatives: SubstituteOption[] = live.provisions
          .filter(
            (p) =>
              p.pool_id === pool.poolId &&
              p.id !== chosen.provisionId &&
              p.issue_period === voucher.ration_type &&
              this.eligibility.isProvisionAvailable(
                p,
                basis,
                pool.effectiveDailyQty > 0,
                pool.eligibleDays
              )
          )
          .map((p) => ({
            provisionId: p.id,
            code: p.code,
            name: p.name,
            brand: p.brand,
            unit: p.unit,
            packUnit: p.pack_unit,
            packSize: p.pack_size === null ? null : Number(p.pack_size),
            consumptionRatio: Number(p.consumption_ratio),
            equivalentQuantity: round4(poolEquivalent / Number(p.consumption_ratio)),
          }));

        out.push({
          poolCode: pool.code,
          poolName: pool.name,
          poolUnit: pool.unit,
          originalProvisionId: chosen.provisionId,
          originalCode: chosen.code,
          originalName: chosen.name,
          originalQuantity: chosen.selectedQuantity,
          poolEquivalentQty: poolEquivalent,
          alternatives,
        });
      }
    }
    return out;
  }

  // =====================================================================
  // The final Fresh lapse
  // =====================================================================

  /**
   * Settle a Fresh voucher whose final configured window has closed with
   * nothing taken.
   *
   * It writes the existing "did not happen" terminal — NOT_COLLECTED or
   * NOT_DELIVERED — with reason WINDOW_CLOSED and a SYSTEM actor. No new
   * status, no replacement voucher, the SAME voucher number, and nothing is
   * ever marked collected or delivered. Eligible days are untouched: this
   * writes to the fulfilment log only, and the eligibility figure can be
   * changed through nothing but `rik.eligibility_adjustments`.
   *
   * IDEMPOTENT. A voucher that already carries a completion is skipped, and
   * the lifecycle trigger refuses a second one regardless.
   */
  async settleFreshLapse(
    context: AuthContext | null,
    voucherId: string
  ): Promise<{ lapsed: boolean; reason: string }> {
    const voucher = await this.vouchers.findById(voucherId);
    if (voucher === null) {
      throw new FulfillmentError('VOUCHER_NOT_FOUND', 'That issue voucher does not exist.');
    }
    if (voucher.ration_type !== 'FRESH') {
      return { lapsed: false, reason: 'Only a Fresh voucher lapses at the final Fresh window.' };
    }

    const completion = await this.fulfillment.currentCompletion(voucher.id);
    if (completion !== null) {
      return { lapsed: false, reason: `Already ${completion.outcome}; nothing lapses.` };
    }

    const final = await this.finalWindow(voucher);
    if (final === null) {
      return { lapsed: false, reason: 'No Fresh window is configured for this period.' };
    }
    if (final.end_date >= todayIso()) {
      return {
        lapsed: false,
        reason: `${final.window_code} closes on ${final.end_date}; it is still open.`,
      };
    }

    const outcome: FulfillmentOutcome =
      voucher.fulfillment_mode === 'PICKUP' ? 'NOT_COLLECTED' : 'NOT_DELIVERED';

    const outcomeId = await this.db.withTransaction((client) =>
      this.fulfillment.insertOutcome(client, {
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        outcome,
        eventType: 'OUTCOME',
        reason: 'WINDOW_CLOSED',
        windowCode: final.window_code,
        staffId: context?.principalId ?? null,
        staffRole: context === null ? 'SYSTEM' : [...context.roles].sort().join(',') || 'STAFF',
      })
    );

    await this.auditLog.logEvent({
      actorId: context?.principalId ?? null,
      actorRole: context === null ? 'SYSTEM' : [...context.roles].sort().join(',') || 'STAFF',
      module: 'rik',
      action: 'RIK_ISSUE_VOUCHER_LAPSED',
      entityType: 'rik.issue_voucher',
      entityId: voucher.id,
      before: { status: voucher.status },
      after: {
        outcomeId,
        status: outcome,
        reason: 'WINDOW_CLOSED',
        voucherNumber: voucher.voucher_number,
        finalWindowCode: final.window_code,
        finalWindowEndDate: final.end_date,
      },
    });

    return { lapsed: true, reason: `${final.window_code} closed on ${final.end_date}.` };
  }

  /** Settle every Fresh voucher of a period whose final window has closed. */
  async settleFreshLapsesForPeriod(
    context: AuthContext,
    periodId: string
  ): Promise<{ settled: number; skipped: number }> {
    const open = await this.vouchers.search({
      periodId,
      rationType: 'FRESH',
      limit: 100,
      offset: 0,
    });
    let settled = 0;
    let skipped = 0;
    for (const voucher of open) {
      const result = await this.settleFreshLapse(context, voucher.id);
      if (result.lapsed) settled += 1;
      else skipped += 1;
    }
    return { settled, skipped };
  }

  // =====================================================================
  // Previous-month Dry carry-forward
  // =====================================================================

  /**
   * Establish the carried Dry balance for one officer, from one source
   * period into the next.
   *
   * THE SOURCE OF TRUTH IS THE PAIR: the source selection's own frozen
   * snapshot gives what the officer was entitled to; the issue lines give
   * what was physically handed over. The difference is what was not issued.
   * Nothing is inferred and nothing is fabricated: if the source period has
   * no confirmed selection, or its Dry window has not closed, this
   * establishes nothing and says why.
   */
  async establishCarryForward(
    context: AuthContext | null,
    input: { customerId: string; sourcePeriodId: string; targetPeriodId: string }
  ): Promise<{ established: CarryForwardRecord[]; skipped: string[] }> {
    const [source, target] = await Promise.all([
      this.periods.findById(input.sourcePeriodId),
      this.periods.findById(input.targetPeriodId),
    ]);
    if (source === null || target === null) {
      throw new FulfillmentError('PERIOD_NOT_FOUND', 'That ration period does not exist.');
    }

    const skipped: string[] = [];

    // The source period's Dry window must have CLOSED: until it has, the
    // officer may still collect and nothing is unissued yet.
    const sourceWindows = await this.windows.listByPeriod(source.id, true);
    const dryWindow = sourceWindows.find((w) => w.ration_type === 'DRY') ?? null;
    if (dryWindow === null) {
      skipped.push(`${source.name}: no Dry window is configured, so nothing can be said to be unissued.`);
      return { established: [], skipped };
    }
    if (dryWindow.end_date >= todayIso()) {
      skipped.push(`${source.name}: the Dry window is still open until ${dryWindow.end_date}.`);
      return { established: [], skipped };
    }

    const selection = await this.selections.findCurrentForPeriod(input.customerId, source.id);
    if (selection === null || selection.status !== 'CONFIRMED') {
      skipped.push(`${source.name}: the officer confirmed no selection, so there is no balance to carry.`);
      return { established: [], skipped };
    }

    const calculation = await this.validation.recalculateFromSnapshot(selection.id, input.customerId);
    if (calculation === null) {
      skipped.push(`${source.name}: the confirmed selection carries no rule snapshot.`);
      return { established: [], skipped };
    }

    const issued = new Map<string, number>();
    for (const row of await this.fulfillment.issuedByPool(selection.id)) {
      issued.set(row.pool_id, Number(row.issued));
    }

    const staffRole = context === null ? 'SYSTEM' : [...context.roles].sort().join(',') || 'STAFF';
    const made: string[] = [];

    await this.db.withTransaction(async (client) => {
      for (const pool of calculation.dry) {
        // Only what the officer actually chose can be unissued — entitlement
        // never selected was never on a voucher.
        const chosen = pool.provisions.filter(
          (p) => p.selectedQuantity > 0 && p.issuePeriod === 'DRY'
        );
        if (chosen.length === 0) continue;

        const confirmedEquivalent = round4(
          chosen.reduce((sum, p) => sum + p.selectedQuantity * p.consumptionRatio, 0)
        );
        const physicallyIssued = issued.get(pool.poolId) ?? 0;
        const unissued = round4(confirmedEquivalent - physicallyIssued);
        if (unissued <= 0) continue;

        const created = await this.fulfillment.establishCarryForward(client, {
          customerId: input.customerId,
          sourcePeriodId: source.id,
          targetPeriodId: target.id,
          sourceSelectionId: selection.id,
          poolId: pool.poolId,
          quantity: unissued,
          unit: pool.unit,
          basis: {
            version: 1,
            establishedFrom: 'CONFIRMED_SELECTION_AND_PHYSICAL_ISSUE',
            selectionReference: selection.reference_number,
            poolCode: pool.code,
            eligibleDays: pool.eligibleDays,
            poolEntitlement: pool.totalEntitlement,
            confirmedEquivalent,
            physicallyIssued,
            unissued,
            sourceDryWindow: { code: dryWindow.window_code, endDate: dryWindow.end_date },
          },
          staffId: context?.principalId ?? null,
          staffRole,
        });
        if (created) made.push(pool.code);
      }
    });

    const established = (
      await this.fulfillment.findCarryForwardBySource(input.customerId, source.id)
    ).filter((row) => row.target_period_id === target.id);

    if (established.length > 0) {
      await this.auditLog.logEvent({
        actorId: context?.principalId ?? null,
        actorRole: staffRole,
        module: 'rik',
        action: 'RIK_DRY_CARRY_FORWARD_ESTABLISHED',
        entityType: 'rik.dry_carry_forward',
        entityId: established[0]!.id,
        after: {
          customerId: input.customerId,
          sourcePeriod: source.name,
          targetPeriod: target.name,
          pools: established.map((e) => ({ pool: e.pool_code, quantity: e.quantity, unit: e.unit })),
          newlyEstablished: made,
        },
      });
    } else {
      skipped.push(`${source.name}: every Dry provision the officer chose was issued, so nothing carries.`);
    }

    return { established, skipped };
  }

  /**
   * Lapse the carried balances of a period whose Dry window has closed.
   *
   * The one-month rule's back half: what was carried in may be taken only in
   * this period's Dry window, and after it closes the remainder is gone. It
   * is never carried a second time — migration 0049 refuses a source period
   * that already received a carry-forward.
   */
  async lapseCarryForward(
    context: AuthContext | null,
    input: { customerId: string; targetPeriodId: string }
  ): Promise<{ lapsed: number; skipped: string[] }> {
    const target = await this.periods.findById(input.targetPeriodId);
    if (target === null) {
      throw new FulfillmentError('PERIOD_NOT_FOUND', 'That ration period does not exist.');
    }

    const skipped: string[] = [];
    const windows = await this.windows.listByPeriod(target.id, true);
    const dryWindow = windows.find((w) => w.ration_type === 'DRY') ?? null;
    if (dryWindow === null) {
      skipped.push(`${target.name}: no Dry window is configured.`);
      return { lapsed: 0, skipped };
    }
    if (dryWindow.end_date >= todayIso()) {
      skipped.push(`${target.name}: the Dry window is open until ${dryWindow.end_date}.`);
      return { lapsed: 0, skipped };
    }

    const rows = await this.fulfillment.listCarryForwardForTarget(input.customerId, target.id);
    let lapsed = 0;

    await this.db.withTransaction(async (client) => {
      for (const row of rows) {
        if (row.lapsed_at !== null) continue;
        const done = await this.fulfillment.lapseCarryForward(
          client,
          row.id,
          `The ${target.name} Dry window closed on ${dryWindow.end_date}.`
        );
        if (done) lapsed += 1;
      }
    });

    if (lapsed > 0) {
      await this.auditLog.logEvent({
        actorId: context?.principalId ?? null,
        actorRole: context === null ? 'SYSTEM' : [...context.roles].sort().join(',') || 'STAFF',
        module: 'rik',
        action: 'RIK_DRY_CARRY_FORWARD_LAPSED',
        entityType: 'rik.dry_carry_forward',
        entityId: rows[0]!.id,
        after: {
          customerId: input.customerId,
          targetPeriod: target.name,
          lapsed,
          dryWindowEndDate: dryWindow.end_date,
        },
      });
    }

    return { lapsed, skipped };
  }

  async carryForwardForVoucher(voucher: IssueVoucherRecord): Promise<CarryForwardRecord[]> {
    if (voucher.ration_type !== 'DRY') return [];
    return this.fulfillment.listCarryForwardForTarget(voucher.customer_id, voucher.period_id);
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /**
   * The locked lanes, restated so a refusal reads as a sentence:
   *   PICKUP    READY_FOR_PICKUP   -> COLLECTED | NOT_COLLECTED
   *   DELIVERY  READY_FOR_DELIVERY -> OUT_FOR_DELIVERY -> DELIVERED
   *                                -> NOT_DELIVERED (from either)
   */
  private requireLegalTransition(
    status: string,
    mode: string,
    outcome: FulfillmentOutcome,
    voucherNumber: string
  ): void {
    const allowed: Record<string, FulfillmentOutcome[]> = {
      READY_FOR_PICKUP: ['COLLECTED', 'NOT_COLLECTED'],
      READY_FOR_DELIVERY: ['OUT_FOR_DELIVERY', 'NOT_DELIVERED'],
      OUT_FOR_DELIVERY: ['DELIVERED', 'NOT_DELIVERED'],
    };
    const lane = mode === 'PICKUP' ? 'the pickup lane' : 'the delivery lane';
    const next = allowed[status] ?? [];
    if (!next.includes(outcome)) {
      throw new FulfillmentError(
        'INVALID_TRANSITION',
        next.length === 0
          ? `Voucher ${voucherNumber} is ${status} and is already completed.`
          : `Voucher ${voucherNumber} is ${status}; in ${lane} the next step is ${next.join(' or ')}, not ${outcome}.`,
        { status, outcome, allowed: next }
      );
    }
  }

  /** The last configured window of this voucher's ration type, by sequence. */
  private async finalWindow(voucher: IssueVoucherRecord): Promise<IssueWindowRecord | null> {
    const windows = await this.windows.listByPeriod(voucher.period_id, true);
    const mine = windows
      .filter((w) => w.ration_type === voucher.ration_type)
      .sort((a, b) => a.sequence_no - b.sequence_no);
    return mine.length === 0 ? null : mine[mine.length - 1]!;
  }

  private async currentWindowCode(voucher: IssueVoucherRecord): Promise<string | null> {
    const windows = await this.windows.listByPeriod(voucher.period_id, true);
    const today = todayIso();
    const open = windows.find(
      (w) => w.ration_type === voucher.ration_type && w.start_date <= today && today <= w.end_date
    );
    return open?.window_code ?? null;
  }

  private async audit(
    context: AuthContext,
    action: string,
    voucher: IssueVoucherRecord,
    after: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.logEvent({
      actorId: context.principalId,
      actorRole: [...context.roles].sort().join(',') || 'STAFF',
      module: 'rik',
      action,
      entityType: 'rik.issue_voucher',
      entityId: voucher.id,
      before: { status: voucher.status },
      after: { ...after, voucherNumber: voucher.voucher_number },
    });
  }
}
