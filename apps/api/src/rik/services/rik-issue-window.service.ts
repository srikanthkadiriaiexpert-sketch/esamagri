import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { EntitlementPeriodsRepository } from '../repositories/entitlement-periods.repository';
import {
  IssueWindowsRepository,
  type IssueWindowRecord,
  type IssueWindowRevisionRecord,
  type RationType,
  type WindowCode,
} from '../repositories/issue-windows.repository';

/**
 * RIK issue schedules — configuration and the schedule the customer is shown
 * (STEP 15C).
 *
 * THE MODEL, AS LOCKED
 *
 *   FRESH               Issue 1, Issue 2, Issue 3
 *   DRY                 one issue
 *   MISS_MUSTER_FRESH   one issue   (since migration 0058)
 *   MISS_MUSTER_DRY     one issue   (since migration 0058)
 *
 * "Issue" is what the facility calls these, and what every label in the two
 * applications now says. The stored `ration_type` and `window_code` values,
 * the table name and the API field names are unchanged — renaming them to
 * match an English label would rewrite history that officers were already
 * shown, for no gain.
 *
 * THE TWO MISS MUSTER SCHEDULES ARE SEPARATE RATION TYPES, not two sequence
 * numbers under one. The overlap exclusion and the ordering trigger in
 * migration 0047 are both scoped by ration_type: sharing one would stop the
 * Fresh and Dry miss-muster schedules covering the same day, and would
 * impose an order between two schedules that have none.
 *
 * Every date is configured by a RIK administrator. Nothing here assumes a
 * seven-day week, a thirty-day month, or that the facility opens on Tuesday,
 * Wednesday and Friday — the operating days are the actual dates the facility
 * will issue on, because a holiday or a local condition moves them.
 *
 * WHERE THE RULES LIVE
 *
 * In the database (migration 0047), not here. This service validates SHAPE
 * and translates the database's refusals into sentences an administrator can
 * act on; it does not hold a second copy of the rules. That matters because a
 * rule stated twice is a rule enforced once: the overlap exclusion, the
 * within-period check, the Fresh ordering trigger and the identity CHECK are
 * the boundary, and they cannot be talked past by a future caller, a seed or
 * raw SQL.
 *
 * WHAT IT DOES NOT DO
 *
 *   * it does not delete. Migration 0047 refuses DELETE and the application
 *     role holds no DELETE privilege: a window an officer was already shown
 *     has to stay explicable, so it is DEACTIVATED instead;
 *   * it does not write revision rows. The database records them itself on
 *     every material change, so history cannot be forgotten;
 *   * it does not touch a confirmed selection, an entitlement calculation,
 *     an eligible-day figure or any historical snapshot. Changing the
 *     schedule changes the schedule.
 *   * it does not announce. If the facility wants a schedule change
 *     announced, that is the existing shared announcement surface
 *     (`shared.announcements`, SUPER_ADMIN's `shared.announcement.manage`),
 *     used as it stands. Nothing here posts one automatically: the approved
 *     design has no such behaviour and inventing it is not this phase's work.
 */

export type IssueWindowErrorCode =
  | 'PERIOD_NOT_FOUND'
  | 'WINDOW_NOT_FOUND'
  | 'INVALID_DATE'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_SEQUENCE'
  | 'INVALID_RATION_TYPE'
  | 'DUPLICATE_WINDOW'
  | 'NO_OPERATING_DAYS'
  | 'OPERATING_DAY_OUTSIDE_WINDOW'
  | 'DUPLICATE_OPERATING_DAY'
  | 'OUTSIDE_PERIOD'
  | 'OVERLAPPING_WINDOW'
  | 'OUT_OF_SEQUENCE'
  | 'BLANK_NOTES'
  | 'NOTHING_TO_CHANGE'
  | 'DELETE_NOT_PERMITTED'
  | 'PERIOD_CLOSED';

export class IssueWindowError extends Error {
  readonly code: IssueWindowErrorCode;
  readonly field?: string;
  readonly detail: Record<string, unknown>;

  constructor(
    code: IssueWindowErrorCode,
    message: string,
    field?: string,
    detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'IssueWindowError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date, as an exact string.
 *
 * Parsed with Date.UTC so there is no timezone drift and no month-length
 * assumption: `Date.UTC(2027, 1, 29)` for a non-leap February rolls to 1 March
 * and is caught by the round-trip comparison, which is how 29 February is
 * accepted in a leap year and refused in any other.
 */
export function parseIsoDate(value: string, field: string): string {
  if (!ISO_DATE.test(value ?? '')) {
    throw new IssueWindowError(
      'INVALID_DATE',
      `${field} must be a calendar date written as YYYY-MM-DD.`,
      field,
      { value }
    );
  }
  const [y, m, d] = value.split('-').map((part) => Number(part));
  const stamp = Date.UTC(y!, m! - 1, d!);
  const round = new Date(stamp).toISOString().slice(0, 10);
  if (round !== value) {
    throw new IssueWindowError(
      'INVALID_DATE',
      `${value} is not a real calendar date.`,
      field,
      { value }
    );
  }
  return value;
}

export interface ConfigureWindowInput {
  periodId: string;
  rationType: string;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  notes?: string | null;
}

export interface UpdateWindowInput {
  startDate?: string;
  endDate?: string;
  operatingDays?: string[];
  notes?: string | null;
  isActive?: boolean;
}

/** What the customer is shown: the live schedule, and nothing else. */
export interface CustomerIssueWindowView {
  rationType: RationType;
  windowCode: WindowCode;
  sequenceNo: number;
  label: string;
  startDate: string;
  endDate: string;
  operatingDays: string[];
}

@Injectable()
export class RikIssueWindowService {
  constructor(
    private readonly windows: IssueWindowsRepository,
    private readonly periods: EntitlementPeriodsRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ----------------------------------------------------------------- reads

  async listForPeriod(periodId: string): Promise<IssueWindowRecord[]> {
    await this.requirePeriod(periodId);
    return this.windows.listByPeriod(periodId, false);
  }

  async get(windowId: string): Promise<IssueWindowRecord> {
    const window = await this.windows.findById(windowId);
    if (window === null) {
      throw new IssueWindowError('WINDOW_NOT_FOUND', 'That issue schedule does not exist.');
    }
    return window;
  }

  async revisions(windowId: string): Promise<IssueWindowRevisionRecord[]> {
    await this.get(windowId);
    return this.windows.listRevisions(windowId);
  }

  async revisionsForPeriod(periodId: string): Promise<IssueWindowRevisionRecord[]> {
    await this.requirePeriod(periodId);
    return this.windows.listRevisionsByPeriod(periodId);
  }

  // ----------------------------------------------------------------- writes

  async configure(context: AuthContext, input: ConfigureWindowInput): Promise<IssueWindowRecord> {
    const period = await this.requirePeriod(input.periodId);

    // A CLOSED period is retired, so a new schedule against it could never be
    // used: the Customer App resolves its schedule from the CURRENT period,
    // and EntitlementPeriodsRepository.findCurrent excludes CLOSED outright.
    // Creating one here would produce a window nobody can reach, attached to a
    // period nobody is drawing from — and it would appear in the admin list as
    // though the facility had published a live schedule.
    //
    // ONLY CREATION IS REFUSED. Existing windows on a closed period stay
    // readable and editable: `listForPeriod` and `revisionsForPeriod` are
    // untouched because this check is here rather than inside
    // `requirePeriod`, and `update` is untouched because it is also the RETIRE
    // path (it accepts isActive) and cannot create anything. A stale window on
    // a closed period must stay retirable.
    //
    // CLOSED, not "the dates have passed". A period that ended but has not
    // been closed is still legitimately configurable — staff may be finishing
    // its schedule before retiring it. Only the explicit retirement blocks,
    // which is the same rule findCurrent applies.
    if (period.status === 'CLOSED') {
      throw new IssueWindowError(
        'PERIOD_CLOSED',
        `"${period.name}" is closed, so a new issue schedule cannot be added to it. Reopen the period first, or choose the period this schedule belongs to.`,
        'periodId',
        { periodId: period.id, periodName: period.name }
      );
    }

    if (!RATION_TYPES.includes(input.rationType as RationType)) {
      throw new IssueWindowError(
        'INVALID_RATION_TYPE',
        'The ration type must be FRESH, DRY, MISS_MUSTER_FRESH or MISS_MUSTER_DRY.',
        'rationType'
      );
    }
    const rationType = input.rationType as RationType;

    // FRESH carries issues 1, 2 and 3; every other type carries exactly one.
    // The database says the same thing in rik_issue_windows_identity_chk;
    // this says it first so the administrator gets a sentence rather than a
    // constraint name.
    const maxSequence = rationType === 'FRESH' ? 3 : 1;
    if (!Number.isInteger(input.sequenceNo) || input.sequenceNo < 1 || input.sequenceNo > maxSequence) {
      throw new IssueWindowError(
        'INVALID_SEQUENCE',
        rationType === 'FRESH'
          ? 'A Fresh issue must be numbered 1, 2 or 3.'
          : `There is one ${humanRationType(rationType)} per period, numbered 1.`,
        'sequenceNo',
        { rationType, sequenceNo: input.sequenceNo }
      );
    }

    const startDate = parseIsoDate(input.startDate, 'startDate');
    const endDate = parseIsoDate(input.endDate, 'endDate');
    this.requireOrderedRange(startDate, endDate);
    this.requireWithinPeriod(startDate, endDate, period);
    const operatingDays = this.requireOperatingDays(input.operatingDays, startDate, endDate);
    const notes = this.normaliseNotes(input.notes);

    // Only FRESH numbers its schedules; for the rest the code is the type.
    // The database's identity CHECK requires exactly this, and derives the
    // stored value the same way.
    const windowCode = (
      rationType === 'FRESH' ? `FRESH_${input.sequenceNo}` : rationType
    ) as WindowCode;
    const existing = await this.windows.findActiveByCode(input.periodId, windowCode);
    if (existing !== null) {
      throw new IssueWindowError(
        'DUPLICATE_WINDOW',
        `${humanWindow(windowCode)} is already configured for "${period.name}" (${existing.start_date} to ${existing.end_date}). Edit that window, or retire it first.`,
        'sequenceNo',
        { windowId: existing.id, windowCode }
      );
    }

    await this.requireNoClash(input.periodId, rationType, input.sequenceNo, startDate, endDate);

    const created = await this.windows.create({
      periodId: input.periodId,
      rationType,
      sequenceNo: input.sequenceNo,
      startDate,
      endDate,
      operatingDays,
      notes,
      staffId: context.principalId,
    });

    await this.audit(context, 'RIK_ISSUE_WINDOW_CONFIGURED', created.id, null, {
      periodId: created.period_id,
      windowCode: created.window_code,
      startDate: created.start_date,
      endDate: created.end_date,
      operatingDays: created.operating_days,
    });
    return created;
  }

  async update(
    context: AuthContext,
    windowId: string,
    input: UpdateWindowInput
  ): Promise<IssueWindowRecord> {
    const before = await this.get(windowId);

    const touched =
      input.startDate !== undefined ||
      input.endDate !== undefined ||
      input.operatingDays !== undefined ||
      input.notes !== undefined ||
      input.isActive !== undefined;
    if (!touched) {
      throw new IssueWindowError(
        'NOTHING_TO_CHANGE',
        'The request changes nothing about this issue schedule.'
      );
    }

    const startDate =
      input.startDate === undefined ? before.start_date : parseIsoDate(input.startDate, 'startDate');
    const endDate =
      input.endDate === undefined ? before.end_date : parseIsoDate(input.endDate, 'endDate');
    this.requireOrderedRange(startDate, endDate);

    const period = await this.requirePeriod(before.period_id);
    this.requireWithinPeriod(startDate, endDate, period);

    // The days must suit the window as it will be AFTER this change, not as it
    // was: narrowing the range with the old days still in place would leave an
    // operating day outside its own window, which the database refuses anyway.
    const operatingDays =
      input.operatingDays === undefined
        ? this.requireOperatingDays(before.operating_days, startDate, endDate, 'operatingDays', true)
        : this.requireOperatingDays(input.operatingDays, startDate, endDate);

    // Only a window that will be LIVE can clash with another live window, so
    // a retirement needs no clash check — and must not be refused by one.
    const willBeActive = input.isActive ?? before.is_active;
    if (willBeActive) {
      await this.requireNoClash(
        before.period_id,
        before.ration_type,
        before.sequence_no,
        startDate,
        endDate,
        windowId
      );
    }

    const result = await this.windows.update(windowId, {
      startDate: input.startDate === undefined ? undefined : startDate,
      endDate: input.endDate === undefined ? undefined : endDate,
      operatingDays:
        input.operatingDays === undefined && operatingDays === before.operating_days
          ? undefined
          : operatingDays,
      notes: input.notes === undefined ? undefined : this.normaliseNotes(input.notes),
      isActive: input.isActive,
      staffId: context.principalId,
    });
    if (result === null) {
      throw new IssueWindowError('WINDOW_NOT_FOUND', 'That issue schedule does not exist.');
    }
    const updated = result;

    const action =
      before.is_active && !updated.is_active
        ? 'RIK_ISSUE_WINDOW_DEACTIVATED'
        : !before.is_active && updated.is_active
          ? 'RIK_ISSUE_WINDOW_REACTIVATED'
          : 'RIK_ISSUE_WINDOW_UPDATED';

    await this.audit(
      context,
      action,
      windowId,
      {
        startDate: before.start_date,
        endDate: before.end_date,
        operatingDays: before.operating_days,
        isActive: before.is_active,
      },
      {
        windowCode: updated.window_code,
        startDate: updated.start_date,
        endDate: updated.end_date,
        operatingDays: updated.operating_days,
        isActive: updated.is_active,
      }
    );
    return updated;
  }

  // -------------------------------------------------------- customer view

  /**
   * The schedule for the period containing today, as the customer reads it.
   *
   * ACTIVE windows only, and nothing about who configured them, when, or what
   * it used to say — a revision history is an administrative record and has no
   * business on a customer's screen.
   *
   * Returns null when no period is open. There is no fallback to "the latest
   * period" and no invented window: a schedule the facility has not published
   * must not appear, because an officer could travel on it.
   */
  async currentSchedule(): Promise<{
    period: { id: string; name: string; startDate: string; endDate: string };
    fresh: CustomerIssueWindowView[];
    dry: CustomerIssueWindowView[];
    missMusterFresh: CustomerIssueWindowView[];
    missMusterDry: CustomerIssueWindowView[];
  } | null> {
    const period = await this.periods.findCurrent();
    if (period === null) return null;

    const windows = await this.windows.listByPeriod(period.id, true);
    const view = (w: IssueWindowRecord): CustomerIssueWindowView => ({
      rationType: w.ration_type,
      windowCode: w.window_code,
      sequenceNo: w.sequence_no,
      label: humanWindow(w.window_code),
      startDate: w.start_date,
      endDate: w.end_date,
      operatingDays: w.operating_days,
    });

    return {
      period: {
        id: period.id,
        name: period.name,
        startDate: period.start_date,
        endDate: period.end_date,
      },
      fresh: windows.filter((w) => w.ration_type === 'FRESH').map(view),
      dry: windows.filter((w) => w.ration_type === 'DRY').map(view),
      // Additive: the two existing keys keep their exact meaning and
      // contents, so a client that has not been updated is unaffected.
      missMusterFresh: windows.filter((w) => w.ration_type === 'MISS_MUSTER_FRESH').map(view),
      missMusterDry: windows.filter((w) => w.ration_type === 'MISS_MUSTER_DRY').map(view),
    };
  }

  // ------------------------------------------------------------- internals

  private async requirePeriod(periodId: string) {
    const period = await this.periods.findById(periodId);
    if (period === null) {
      throw new IssueWindowError(
        'PERIOD_NOT_FOUND',
        'That entitlement period does not exist. An issue schedule belongs to a period the facility has already created.',
        'periodId'
      );
    }
    return period;
  }

  private requireOrderedRange(startDate: string, endDate: string): void {
    if (startDate > endDate) {
      throw new IssueWindowError(
        'INVALID_DATE_RANGE',
        `An issue schedule cannot end before it starts (${startDate} to ${endDate}).`,
        'endDate',
        { startDate, endDate }
      );
    }
  }

  private requireWithinPeriod(
    startDate: string,
    endDate: string,
    period: { name: string; start_date: string; end_date: string }
  ): void {
    if (startDate < period.start_date || endDate > period.end_date) {
      throw new IssueWindowError(
        'OUTSIDE_PERIOD',
        `An issue schedule must fall inside its period. "${period.name}" runs ${period.start_date} to ${period.end_date}.`,
        'startDate',
        { periodStart: period.start_date, periodEnd: period.end_date }
      );
    }
  }

  /**
   * At least one operating day, each a real date, each inside the window, in
   * ascending order and with no repeats.
   *
   * `fromStored` relaxes nothing — it only changes which field a refusal
   * names, so that narrowing a window reports the dates as the problem rather
   * than blaming a field the administrator did not send.
   */
  private requireOperatingDays(
    days: string[],
    startDate: string,
    endDate: string,
    field = 'operatingDays',
    fromStored = false
  ): string[] {
    if (!Array.isArray(days) || days.length === 0) {
      throw new IssueWindowError(
        'NO_OPERATING_DAYS',
        'An issue schedule must have at least one operating day — the days the facility will actually issue on.',
        field
      );
    }
    const parsed = days.map((day, i) => parseIsoDate(day, `${field}[${i}]`));

    const seen = new Set<string>();
    for (const day of parsed) {
      if (seen.has(day)) {
        throw new IssueWindowError(
          'DUPLICATE_OPERATING_DAY',
          `${day} is listed twice as an operating day.`,
          field,
          { day }
        );
      }
      seen.add(day);
      if (day < startDate || day > endDate) {
        throw new IssueWindowError(
          'OPERATING_DAY_OUTSIDE_WINDOW',
          fromStored
            ? `This issue already has an operating day on ${day}, which falls outside ${startDate} to ${endDate}. Send the operating days with the new dates.`
            : `Operating day ${day} falls outside the window (${startDate} to ${endDate}).`,
          field,
          { day, startDate, endDate }
        );
      }
    }

    // Ascending, because the database stores them that way
    // (rik_issue_days_well_formed) and a reviewer reads them in order.
    return [...parsed].sort();
  }

  /**
   * The two refusals that need another row to explain them.
   *
   * Overlap is reported before ordering: two windows covering the same day is
   * the plainer complaint, and the ordering trigger deliberately ignores
   * overlapping pairs for the same reason.
   */
  private async requireNoClash(
    periodId: string,
    rationType: RationType,
    sequenceNo: number,
    startDate: string,
    endDate: string,
    excludeWindowId?: string
  ): Promise<void> {
    const overlapping = await this.windows.findOverlapping(
      periodId,
      rationType,
      startDate,
      endDate,
      excludeWindowId
    );
    if (overlapping.length > 0) {
      const clash = overlapping[0]!;
      throw new IssueWindowError(
        'OVERLAPPING_WINDOW',
        `${humanWindow(clash.window_code)} already covers part of those dates (${clash.start_date} to ${clash.end_date}). Move it or retire it first.`,
        'startDate',
        { conflictingWindowId: clash.id, conflictingWindowCode: clash.window_code }
      );
    }

    const misordered = await this.windows.findOutOfOrder(
      periodId,
      rationType,
      sequenceNo,
      startDate,
      endDate,
      excludeWindowId
    );
    if (misordered.length > 0) {
      const other = misordered[0]!;
      throw new IssueWindowError(
        'OUT_OF_SEQUENCE',
        `Those dates would put this issue out of order with ${humanWindow(other.window_code)} (${other.start_date} to ${other.end_date}): issue 1 must run before issue 2, and issue 2 before issue 3.`,
        'startDate',
        { conflictingWindowId: other.id, conflictingWindowCode: other.window_code }
      );
    }
  }

  private normaliseNotes(notes: string | null | undefined): string | null {
    if (notes === undefined || notes === null) return null;
    const trimmed = notes.trim();
    if (trimmed === '') {
      // The database refuses a blank-but-present note; absent is the way to
      // say "no note", so this reports the distinction rather than guessing.
      throw new IssueWindowError(
        'BLANK_NOTES',
        'A note cannot be blank. Leave it out to record no note.',
        'notes'
      );
    }
    return trimmed;
  }

  /**
   * Why there is no error-message parsing here.
   *
   * DatabaseService deliberately rewraps every driver error into a
   * SafeDatabaseError with one fixed, generic sentence — no constraint name,
   * no detail — so that a driver message can never reach a client. That is
   * the right policy and this service does not try to defeat it: matching on
   * the text would be matching on something it cannot see.
   *
   * So the specific refusals an administrator needs — which window clashes,
   * which one is out of order — come from the READ-BASED pre-checks above,
   * exactly as migration 0043 established for overlapping pool scales. The
   * database constraint remains the boundary that cannot be talked past, and
   * the integration suite proves it by attempting the same write in raw SQL
   * and watching it refused. If a pre-check ever misses a case the database
   * catches, the request fails loudly as a 500 rather than quietly
   * succeeding — which is the correct way round.
   */

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
      entityType: 'rik.issue_window',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}

/** The facility's own words for each window. One place, used by both surfaces. */
/**
 * The label the facility uses, for one schedule.
 *
 * THE ONE PLACE THESE WORDS LIVE on the server: this service, the voucher
 * service and the issue-windows controller all read their labels from here,
 * so "Window" became "Issue" in a single edit. The stored codes did not
 * change — only what a human is shown.
 */
export function humanWindow(code: WindowCode): string {
  switch (code) {
    case 'FRESH_1':
      return 'Fresh Issue 1';
    case 'FRESH_2':
      return 'Fresh Issue 2';
    case 'FRESH_3':
      return 'Fresh Issue 3';
    case 'DRY':
      return 'Dry Issue';
    case 'MISS_MUSTER_FRESH':
      return 'Miss Muster Fresh';
    case 'MISS_MUSTER_DRY':
      return 'Miss Muster Dry';
  }
}

/** Every ration type this module accepts, in the order the schedule is shown. */
export const RATION_TYPES: readonly RationType[] = [
  'FRESH',
  'DRY',
  'MISS_MUSTER_FRESH',
  'MISS_MUSTER_DRY',
];

/** The label for a whole ration type, used where no single schedule is meant. */
export function humanRationType(rationType: RationType): string {
  switch (rationType) {
    case 'FRESH':
      return 'Fresh Issue';
    case 'DRY':
      return 'Dry Issue';
    case 'MISS_MUSTER_FRESH':
      return 'Miss Muster Fresh';
    case 'MISS_MUSTER_DRY':
      return 'Miss Muster Dry';
  }
}
