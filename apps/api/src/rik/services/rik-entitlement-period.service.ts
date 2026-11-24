import { Injectable } from '@nestjs/common';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import {
  EntitlementPeriodsRepository,
  PERIOD_STATUSES,
  type EntitlementPeriodRecord,
  type PeriodDependentCounts,
  type PeriodStatus,
} from '../repositories/entitlement-periods.repository';
import type { AuthContext } from '../../auth/auth-context';

/**
 * Entitlement period administration.
 *
 * WHY THIS EXISTS. Until now `rik.entitlement_periods` was read-only to the
 * application — the one period in staging was inserted by hand with SQL, and
 * the repository said so in its own comment. That meant RIK staff could not
 * open a new period without a developer, and when the period ended the RIK
 * module reported "no open period" until someone ran SQL. This service is what
 * makes periods ordinary operational data.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It computes no entitlement. Not a figure, not a ratio, not a scale, not a
 *   dietary rule, not a carry-forward. A period is a name and two dates; what
 *   those dates MEAN to an entitlement is decided by the engine, which this
 *   file neither calls nor imports.
 *
 *   It offers no delete. A period is referenced by eligibility, entitlements,
 *   selections, issue windows, vouchers and carry-forward rows. Closing it
 *   retires it without touching one of them.
 *
 *   It never derives status from dates. The facility chooses the label; the
 *   dates decide what is operational. The two are reported separately — see
 *   `derivePeriodState` — precisely so that nobody has to guess which one won.
 */

export type PeriodAdminCode =
  | 'PERIOD_NOT_FOUND'
  | 'BLANK_NAME'
  | 'NAME_TOO_LONG'
  | 'DUPLICATE_NAME'
  | 'INVALID_DATE'
  | 'END_NOT_AFTER_START'
  | 'OVERLAPPING_PERIOD'
  | 'INVALID_STATUS'
  | 'PERIOD_IN_USE';

export class PeriodAdminError extends Error {
  readonly code: PeriodAdminCode;
  readonly field?: string;
  readonly detail: Record<string, unknown>;

  constructor(
    code: PeriodAdminCode,
    message: string,
    field?: string,
    detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'PeriodAdminError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

const MAX_NAME = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the period IS, today, as opposed to what it is LABELLED.
 *
 * Four states, and the order of the checks is the whole rule:
 *
 *   CLOSED   the facility retired it. Overrides everything, which is what
 *            makes CLOSED the one status with teeth.
 *   OPEN     today falls inside its dates. This is the operational period.
 *   UPCOMING it starts later.
 *   PAST     it ended, and nobody has closed it yet.
 *
 * Pure, and exported, so the rule can be tested at every boundary without a
 * database — including the inclusive ones, where an off-by-one day would mean
 * an officer could or could not draw a ration.
 */
export type PeriodState = 'CLOSED' | 'OPEN' | 'UPCOMING' | 'PAST';

export function derivePeriodState(
  period: { start_date: string; end_date: string; status: string },
  today: string
): PeriodState {
  if (period.status === 'CLOSED') return 'CLOSED';
  // String comparison is correct for ISO yyyy-mm-dd and avoids dragging the
  // server's timezone into a question about calendar dates.
  if (today < period.start_date) return 'UPCOMING';
  if (today > period.end_date) return 'PAST';
  return 'OPEN';
}

/** Today as yyyy-mm-dd, in the server's own calendar. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface PeriodView extends EntitlementPeriodRecord {
  state: PeriodState;
  /** True only for the one period that is operational today. */
  isCurrent: boolean;
  /** Whether its dates may still be changed — see `assertDatesEditable`. */
  datesEditable: boolean;
  dependents: PeriodDependentCounts;
}

@Injectable()
export class RikEntitlementPeriodService {
  constructor(
    private readonly periods: EntitlementPeriodsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ------------------------------------------------------------------ reading

  /**
   * Every period, with its derived state and what depends on it.
   *
   * The screen needs all of this to say anything honest: which period is
   * operational, which are history, and which can still be corrected.
   */
  async list(): Promise<{ periods: PeriodView[]; currentPeriodId: string | null }> {
    const rows = await this.periods.listAll(200);
    const today = todayIso();
    const views: PeriodView[] = [];

    for (const row of rows) {
      const dependents = await this.periods.countDependents(row.id);
      const state = derivePeriodState(row, today);
      views.push({
        ...row,
        state,
        isCurrent: state === 'OPEN',
        datesEditable: dependents.total === 0,
        dependents,
      });
    }

    return {
      periods: views,
      currentPeriodId: views.find((p) => p.isCurrent)?.id ?? null,
    };
  }

  // ------------------------------------------------------------------ writing

  async create(
    context: AuthContext,
    input: { name: string; startDate: string; endDate: string; status?: string }
  ): Promise<PeriodView> {
    const name = this.validName(input.name);
    const startDate = this.validDate(input.startDate, 'startDate', 'The start date');
    const endDate = this.validDate(input.endDate, 'endDate', 'The end date');
    const status = this.validStatus(input.status ?? 'UPCOMING');

    this.assertEndAfterStart(startDate, endDate);
    await this.assertNameFree(name);
    await this.assertNoOverlap(startDate, endDate);

    const created = await this.periods.create({ name, startDate, endDate, status });

    await this.audit(context, 'RIK_ENTITLEMENT_PERIOD_CREATED', created.id, null, {
      name: created.name,
      startDate: created.start_date,
      endDate: created.end_date,
      status: created.status,
    });

    return this.view(created);
  }

  /**
   * Change a period's name, and its dates only while nothing depends on them.
   *
   * THE ASYMMETRY IS THE POINT. A name is a label: renaming "Novemer 2026" to
   * "November 2026" cannot change an entitlement. Dates are not a label — they
   * decide which period is operational, which issue windows are valid inside
   * it, and which period an officer's eligible days belong to. Moving them
   * under live records would silently reinterpret history, so once ANY record
   * references the period its dates are fixed and the screen says why.
   */
  async update(
    context: AuthContext,
    periodId: string,
    input: { name: string; startDate: string; endDate: string }
  ): Promise<PeriodView> {
    const before = await this.periods.findById(periodId);
    if (before === null) throw this.notFound(periodId);

    const name = this.validName(input.name);
    const startDate = this.validDate(input.startDate, 'startDate', 'The start date');
    const endDate = this.validDate(input.endDate, 'endDate', 'The end date');
    this.assertEndAfterStart(startDate, endDate);

    const datesChanged = startDate !== before.start_date || endDate !== before.end_date;
    if (datesChanged) {
      const dependents = await this.periods.countDependents(periodId);
      if (dependents.total > 0) {
        throw new PeriodAdminError(
          'PERIOD_IN_USE',
          `The dates of "${before.name}" cannot be changed because ${dependents.total} record(s) already refer to this period. Its name can still be corrected, and the period can be closed.`,
          'startDate',
          { dependents }
        );
      }
    }

    if (name.toLowerCase() !== before.name.trim().toLowerCase()) {
      await this.assertNameFree(name);
    }
    if (datesChanged) {
      await this.assertNoOverlap(startDate, endDate, periodId);
    }

    const updated = await this.periods.update(periodId, { name, startDate, endDate });
    if (updated === null) throw this.notFound(periodId);

    await this.audit(
      context,
      'RIK_ENTITLEMENT_PERIOD_UPDATED',
      periodId,
      { name: before.name, startDate: before.start_date, endDate: before.end_date },
      {
        name: updated.name,
        startDate: updated.start_date,
        endDate: updated.end_date,
        datesChanged,
      }
    );

    return this.view(updated);
  }

  /**
   * Change the status label. Always permitted, whatever depends on the period.
   *
   * Closing moves no dates and recalculates nothing: it only stops the period
   * being resolved as operational. That is why it is the safe operation on a
   * period in use, and why it is separate from `update`.
   */
  async setStatus(context: AuthContext, periodId: string, rawStatus: string): Promise<PeriodView> {
    const before = await this.periods.findById(periodId);
    if (before === null) throw this.notFound(periodId);

    const status = this.validStatus(rawStatus);
    const updated = await this.periods.setStatus(periodId, status);
    if (updated === null) throw this.notFound(periodId);

    await this.audit(
      context,
      'RIK_ENTITLEMENT_PERIOD_STATUS_CHANGED',
      periodId,
      { name: before.name, status: before.status },
      { name: updated.name, status: updated.status }
    );

    return this.view(updated);
  }

  // ---------------------------------------------------------------- internals

  private async view(period: EntitlementPeriodRecord): Promise<PeriodView> {
    const dependents = await this.periods.countDependents(period.id);
    const state = derivePeriodState(period, todayIso());
    return {
      ...period,
      state,
      isCurrent: state === 'OPEN',
      datesEditable: dependents.total === 0,
      dependents,
    };
  }

  private notFound(periodId: string): PeriodAdminError {
    return new PeriodAdminError(
      'PERIOD_NOT_FOUND',
      'That entitlement period no longer exists. Reload the list and try again.',
      undefined,
      { periodId }
    );
  }

  private validName(raw: string): string {
    const name = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (name === '') {
      throw new PeriodAdminError('BLANK_NAME', 'The period name is required.', 'name');
    }
    if (name.length > MAX_NAME) {
      throw new PeriodAdminError(
        'NAME_TOO_LONG',
        `The period name must be ${MAX_NAME} characters or fewer.`,
        'name'
      );
    }
    return name;
  }

  private validDate(raw: string, field: string, label: string): string {
    const text = (raw ?? '').trim();
    if (!ISO_DATE.test(text)) {
      throw new PeriodAdminError('INVALID_DATE', `${label} must be a date.`, field, { value: text });
    }
    // Reject 2026-02-30 and friends: the pattern alone does not.
    const [y, m, d] = text.split('-').map(Number);
    const probe = new Date(Date.UTC(y!, m! - 1, d!));
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== m! - 1 ||
      probe.getUTCDate() !== d
    ) {
      throw new PeriodAdminError('INVALID_DATE', `${label} is not a real date.`, field, {
        value: text,
      });
    }
    return text;
  }

  private validStatus(raw: string): PeriodStatus {
    const status = (raw ?? '').trim().toUpperCase();
    if (!(PERIOD_STATUSES as readonly string[]).includes(status)) {
      throw new PeriodAdminError(
        'INVALID_STATUS',
        `The status must be one of ${PERIOD_STATUSES.join(', ')}.`,
        'status'
      );
    }
    return status as PeriodStatus;
  }

  /**
   * The end date must be strictly after the start date.
   *
   * Strict, not "on or after", because `rik_ent_periods_dates_chk` is
   * `start_date < end_date`. A one-day period is impossible in this schema, and
   * reporting that here is better than letting the database say it.
   */
  private assertEndAfterStart(startDate: string, endDate: string): void {
    if (endDate <= startDate) {
      throw new PeriodAdminError(
        'END_NOT_AFTER_START',
        'The end date must be after the start date.',
        'endDate',
        { startDate, endDate }
      );
    }
  }

  private async assertNameFree(name: string): Promise<void> {
    const existing = await this.periods.findByName(name);
    if (existing !== null) {
      throw new PeriodAdminError(
        'DUPLICATE_NAME',
        `A period called "${existing.name}" already exists.`,
        'name',
        { periodId: existing.id }
      );
    }
  }

  private async assertNoOverlap(
    startDate: string,
    endDate: string,
    excludeId?: string
  ): Promise<void> {
    const clashes = await this.periods.findOverlapping(startDate, endDate, excludeId);
    if (clashes.length > 0) {
      const first = clashes[0]!;
      throw new PeriodAdminError(
        'OVERLAPPING_PERIOD',
        `Those dates overlap "${first.name}" (${first.start_date} to ${first.end_date}). Periods cannot overlap, not even by one day.`,
        'startDate',
        { clashes: clashes.map((c) => ({ id: c.id, name: c.name })) }
      );
    }
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
      entityType: 'rik.entitlement_period',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}
