import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthContext } from '../../auth/auth-context';
import { AuditLogRepository } from '../../shared/repositories/audit-log.repository';
import { EntitlementPeriodsRepository } from '../repositories/entitlement-periods.repository';
import {
  EligibilityImportRepository,
  type AdjustmentRecord,
  type ImportBatchRecord,
  type ImportRowRecord,
  type OfficerPeriodEligibility,
  type PeriodUploadStatus,
  type PreparedRow,
  type RowOutcome,
} from '../repositories/eligibility-import.repository';
import { RATION_TYPE_MAX_DAYS, type EligibilityRationType } from '../dto/rik-eligibility.dto';
import { OfficersRepository } from '../repositories/officers.repository';
import { normaliseMobile, OfficerValidationError } from './rik-officer.service';
import {
  ExcelEligibilityParserService,
  type RawEligibilityRow,
} from './excel-eligibility-parser.service';

/**
 * Eligibility import and eligible-day adjustment (STEP 15B Phase B).
 *
 * RECONSTRUCTED from the approved Phase B report after the working container
 * was lost; not the recovered original bytes. The field names and error codes
 * are pinned by the recovered controller, which reads them.
 *
 * THE WORKFLOW, AND WHY IT IS SHAPED LIKE THIS
 *
 *     UPLOAD -> VALIDATE -> MAP -> PREVIEW -> CONFIRM -> APPLY -> AUDIT
 *
 * Upload parses the sheet, maps every row and records a batch in
 * PENDING_REVIEW. It changes no officer's eligible days. Confirm is a
 * separate call. "Never silently apply a spreadsheet" is therefore a property
 * of the API's shape rather than a flag that could be defaulted wrongly.
 *
 * MATCHING IS NARROW ON PURPOSE
 *
 * The mobile number is the stable identifier, normalised with exactly the
 * same function registration used. The name is then VERIFIED — trimmed,
 * internal whitespace collapsed, compared case-insensitively against either
 * the officer's own name or the facility's official spelling. That is all.
 * There is no fuzzy matching, no edit distance, no "did you mean": a name
 * that does not match is an exception for a human to settle, because the
 * alternative is an import quietly moving the wrong officer's entitlement.
 *
 * AND IT NEVER CREATES AN OFFICER. An unrecognised mobile number is an
 * exception, always. A typo would otherwise become a person.
 */

export type EligibilityAdminCode =
  | 'PERIOD_NOT_FOUND'
  | 'BATCH_NOT_FOUND'
  | 'BATCH_NOT_PENDING'
  | 'NOTHING_TO_APPLY'
  | 'OFFICER_NOT_FOUND'
  | 'INVALID_ELIGIBLE_DAYS'
  | 'NO_CHANGE'
  | 'BLANK_REASON'
  | 'DUPLICATE_MOBILE_IN_DATABASE';

export class EligibilityAdminError extends Error {
  readonly code: EligibilityAdminCode;
  readonly field?: string;
  readonly detail: Record<string, unknown>;

  constructor(
    code: EligibilityAdminCode,
    message: string,
    field?: string,
    detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'EligibilityAdminError';
    this.code = code;
    this.field = field;
    this.detail = detail;
  }
}

export interface UploadedWorkbook {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface BatchWithRows {
  batch: ImportBatchRecord;
  rows: ImportRowRecord[];
}

/**
 * The ONE name comparison this application performs: trim, collapse internal
 * whitespace, lower-case. Nothing else. Exported so the test suite asserts
 * the rule itself rather than only its effects.
 */
export function canonicaliseName(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Eligible days, as the sheet wrote them.
 *
 * A whole, non-negative number. Zero is ALLOWED — an officer with no eligible
 * days this period is a real statement the facility may need to make. A
 * decimal is REFUSED rather than rounded: 7.5 means the sheet is wrong, and
 * silently turning it into 7 or 8 would invent an entitlement.
 *
 * STEP 16 — THE UPPER BOUND IS NOW THE FACILITY'S LIMIT FOR THIS RATION TYPE:
 * 30 days for Fresh, 60 for Dry. The message NAMES the limit and the type,
 * because "must be between 0 and 30" against a Dry sheet would send an
 * administrator looking for a fault in a file that is correct.
 *
 * `rationType` is OPTIONAL here, and when it is omitted the original 0..366
 * bound applies unchanged. That is not a default eligibility value — it is
 * this one parser staying usable for the legacy column, which migration 0066
 * leaves in place and which still permits 366. Every caller in the import
 * path passes a type.
 */
export function parseEligibleDays(
  raw: string,
  rationType?: EligibilityRationType
): { ok: true; value: number } | { ok: false; reason: string } {
  const text = (raw ?? '').trim();
  if (text === '') return { ok: false, reason: 'Eligible days is blank.' };
  if (!/^[0-9]+$/.test(text)) {
    if (/^-/.test(text)) {
      return { ok: false, reason: `Eligible days cannot be negative; the sheet says ${text}.` };
    }
    if (/^[0-9]*\.[0-9]+$/.test(text)) {
      return {
        ok: false,
        reason: `Eligible days must be a whole number; the sheet says ${text}.`,
      };
    }
    return { ok: false, reason: `Eligible days is not a number; the sheet says ${text}.` };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: `Eligible days must be between 0 and 366; the sheet says ${text}.` };
  }
  // No ration type: the ORIGINAL sentence, byte for byte. This parser is
  // still called without a type for the legacy column, and a message that
  // merely resembled the old one would be a silent change to behaviour the
  // existing suite asserts on.
  if (rationType === undefined) {
    if (value > 366) {
      return {
        ok: false,
        reason: `Eligible days must be between 0 and 366; the sheet says ${text}.`,
      };
    }
    return { ok: true, value };
  }

  const max = RATION_TYPE_MAX_DAYS[rationType];
  if (value > max) {
    return {
      ok: false,
      reason: `${capitalise(rationType)} eligible days must be between 0 and ${max}; the sheet says ${text}.`,
    };
  }
  return { ok: true, value };
}

/** 'FRESH' -> 'Fresh'. For messages a human reads, nothing else. */
function capitalise(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

@Injectable()
export class RikEligibilityAdminService {
  constructor(
    private readonly parser: ExcelEligibilityParserService,
    private readonly imports: EligibilityImportRepository,
    private readonly periods: EntitlementPeriodsRepository,
    private readonly officers: OfficersRepository,
    private readonly auditLog: AuditLogRepository
  ) {}

  // ------------------------------------------------------------------ upload

  async upload(
    context: AuthContext,
    input: { periodId: string; rationType: EligibilityRationType; file: UploadedWorkbook }
  ): Promise<BatchWithRows> {
    const period = await this.periods.findById(input.periodId);
    if (period === null) {
      throw new EligibilityAdminError(
        'PERIOD_NOT_FOUND',
        'That entitlement period does not exist. An eligibility sheet applies to a period the facility has already created.',
        'periodId'
      );
    }

    const parsed = await this.parser.parse(input.file);
    const rows = await this.map(input.periodId, input.rationType, parsed.rows);

    const batchId = await this.imports.createBatch({
      periodId: input.periodId,
      rationType: input.rationType,
      fileName: input.file.originalname,
      fileHash: createHash('sha256').update(input.file.buffer).digest('hex'),
      fileSizeBytes: input.file.size,
      uploadedBy: context.principalId,
      rows,
    });

    const result = await this.getBatch(batchId);
    await this.audit(context, 'RIK_ELIGIBILITY_IMPORT_UPLOADED', batchId, null, {
      batchRef: result.batch.batch_ref,
      periodId: input.periodId,
      rationType: input.rationType,
      fileName: input.file.originalname,
      totals: {
        rows: result.batch.total_rows,
        changed: result.batch.matched_changed,
        noChange: result.batch.matched_no_change,
        exceptions: result.batch.exception_rows,
      },
    });
    return result;
  }

  /**
   * Four passes, in this order, because each depends on the one before.
   *
   *   1. shape      — missing fields, mobile normalisation, eligible days
   *   2. duplicates — the same officer twice INSIDE the sheet
   *   3. resolution — two bulk queries, never one per row
   *   4. comparison — name verification, then the delta
   */
  private async map(
    periodId: string,
    rationType: EligibilityRationType,
    raw: RawEligibilityRow[]
  ): Promise<PreparedRow[]> {
    /**
     * Rows still in the running after pass 1. An explicit set, because a
     * placeholder OUTCOME cannot carry "not decided yet" — an earlier draft
     * used MISSING_FIELD as the initial value and then filtered on it, which
     * quietly excluded every good row from resolution and turned a correct
     * sheet into nine exceptions.
     */
    const pending = new Set<number>();

    // --- 1. shape
    const prepared: PreparedRow[] = raw.map((row) => {
      const base: PreparedRow = {
        sheetRow: row.sheetRow,
        rawName: row.name,
        rawMobile: row.mobile,
        rawEligibleDays: row.eligibleDays,
        normalisedMobile: null,
        matchedCustomerId: null,
        matchedRikId: null,
        systemName: null,
        systemOfficialName: null,
        previousEligibleDays: null,
        importedEligibleDays: null,
        delta: null,
        outcome: 'MISSING_FIELD',
        exceptionReason: null,
      };

      if (row.name.trim() === '' || row.mobile.trim() === '' || row.eligibleDays.trim() === '') {
        const missing = [
          row.name.trim() === '' ? 'name' : null,
          row.mobile.trim() === '' ? 'mobile number' : null,
          row.eligibleDays.trim() === '' ? 'eligible days' : null,
        ].filter((x) => x !== null);
        return {
          ...base,
          outcome: 'MISSING_FIELD',
          exceptionReason: `The sheet leaves ${missing.join(' and ')} blank.`,
        };
      }

      let normalised: string;
      try {
        normalised = normaliseMobile(row.mobile);
      } catch (err) {
        return {
          ...base,
          outcome: 'INVALID_MOBILE',
          exceptionReason:
            err instanceof OfficerValidationError
              ? err.message
              : 'The mobile number cannot be read.',
        };
      }

      const days = parseEligibleDays(row.eligibleDays, rationType);
      if (!days.ok) {
        return {
          ...base,
          normalisedMobile: normalised,
          outcome: 'INVALID_ELIGIBLE_DAYS',
          exceptionReason: days.reason,
        };
      }

      pending.add(row.sheetRow);
      return { ...base, normalisedMobile: normalised, importedEligibleDays: days.value };
    });

    // --- 2. duplicates within the sheet
    const seen = new Map<string, number>();
    for (const row of prepared) {
      if (!pending.has(row.sheetRow) || row.normalisedMobile === null) continue;
      seen.set(row.normalisedMobile, (seen.get(row.normalisedMobile) ?? 0) + 1);
    }
    for (const row of prepared) {
      if (!pending.has(row.sheetRow) || row.normalisedMobile === null) continue;
      if ((seen.get(row.normalisedMobile) ?? 0) > 1) {
        // EVERY occurrence is marked, not just the later ones: the facility
        // has to decide which line is right, and that is impossible if the
        // preview silently accepts one of them.
        row.outcome = 'DUPLICATE_IN_FILE';
        row.exceptionReason = `This mobile number appears ${seen.get(row.normalisedMobile)} times in the sheet.`;
        pending.delete(row.sheetRow);
      }
    }

    // --- 3. resolution, two bulk queries
    const resolvable = prepared.filter((r) => pending.has(r.sheetRow));
    const mobiles = [...new Set(resolvable.map((r) => r.normalisedMobile!))];
    const candidates = await this.imports.findCandidatesByMobile(mobiles);

    // Keyed by the SAME normalisation registration used — the one
    // implementation, called again here rather than reimplemented. A stored
    // number that cannot be normalised at all is skipped rather than guessed
    // at, and the row then reports the officer as not found.
    const byMobile = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      let key: string;
      try {
        key = normaliseMobile(candidate.mobile_number);
      } catch {
        continue;
      }
      const list = byMobile.get(key) ?? [];
      list.push(candidate);
      byMobile.set(key, list);
    }
    for (const [key, list] of byMobile) {
      if (list.length > 1) {
        // Two live officers on one number should be impossible —
        // shared.customers.mobile_uq — so this is a data fault, not a sheet
        // fault, and the whole upload stops rather than guessing.
        throw new EligibilityAdminError(
          'DUPLICATE_MOBILE_IN_DATABASE',
          `Mobile number ${key} belongs to more than one officer (${list
            .map((c) => c.rik_id)
            .join(', ')}). That must be corrected before an import can run.`,
          'file',
          { mobile: key, officers: list.map((c) => c.rik_id) }
        );
      }
    }

    const matchedIds = resolvable
      .map((r) => byMobile.get(r.normalisedMobile!)?.[0]?.customer_id)
      .filter((x): x is string => x !== undefined);
    // The previous value is read from THIS ration type's column, so a Dry
    // sheet is compared against the Dry figure and never against the Fresh
    // one. Comparing against the wrong column would compute a delta that
    // moved a figure the sheet says nothing about.
    const current = await this.imports.currentEligibleDays(
      periodId,
      [...new Set(matchedIds)],
      rationType
    );

    // --- 4. comparison
    for (const row of resolvable) {
      const candidate = byMobile.get(row.normalisedMobile!)?.[0];
      if (candidate === undefined) {
        row.outcome = 'UNMATCHED_MOBILE_NOT_FOUND';
        row.exceptionReason =
          'No officer holds this mobile number. An import never creates an officer.';
        continue;
      }

      row.matchedCustomerId = candidate.customer_id;
      row.matchedRikId = candidate.rik_id;
      row.systemName = candidate.name;
      row.systemOfficialName = candidate.official_name;

      const sheetName = canonicaliseName(row.rawName);
      const matchesName =
        sheetName === canonicaliseName(candidate.name) ||
        (candidate.official_name !== null &&
          sheetName === canonicaliseName(candidate.official_name));

      if (!matchesName) {
        row.outcome = 'NAME_MISMATCH';
        row.exceptionReason = 'The name does not match the record for this mobile number.';
        row.matchedCustomerId = candidate.customer_id;
        row.previousEligibleDays = null;
        row.importedEligibleDays = null;
        row.delta = null;
        continue;
      }

      const previous = current.get(candidate.customer_id) ?? 0;
      row.previousEligibleDays = previous;
      row.delta = row.importedEligibleDays! - previous;
      row.outcome = row.delta === 0 ? 'MATCHED_NO_CHANGE' : 'MATCHED_CHANGED';
    }

    // A NAME_MISMATCH keeps both names but no figures; the shape CHECK in
    // migration 0045 enforces that, so clear anything left behind.
    for (const row of prepared) {
      if (row.outcome !== 'MATCHED_CHANGED' && row.outcome !== 'MATCHED_NO_CHANGE') {
        row.previousEligibleDays = null;
        row.importedEligibleDays = null;
        row.delta = null;
        if (row.exceptionReason === null) row.exceptionReason = 'Refused.';
      }
    }

    return prepared;
  }

  // --------------------------------------------------------------- decisions

  async getBatch(batchId: string): Promise<BatchWithRows> {
    const batch = await this.imports.findBatch(batchId);
    if (batch === null) {
      throw new EligibilityAdminError('BATCH_NOT_FOUND', 'That eligibility import does not exist.');
    }
    return { batch, rows: await this.imports.listRows(batchId) };
  }

  async listBatches(limit?: number): Promise<ImportBatchRecord[]> {
    return this.imports.listBatches(limit ?? 25);
  }

  async confirm(context: AuthContext, batchId: string): Promise<BatchWithRows> {
    const existing = await this.imports.findBatch(batchId);
    if (existing === null) {
      throw new EligibilityAdminError('BATCH_NOT_FOUND', 'That eligibility import does not exist.');
    }
    if (existing.status === 'DISCARDED') {
      throw new EligibilityAdminError(
        'BATCH_NOT_PENDING',
        `${existing.batch_ref} was discarded and cannot be applied.`
      );
    }
    // Idempotent: an already-applied batch is returned as it stands rather
    // than applied twice or reported as an error.
    if (existing.status === 'APPLIED') return this.getBatch(batchId);

    if (existing.matched_changed === 0) {
      throw new EligibilityAdminError(
        'NOTHING_TO_APPLY',
        `${existing.batch_ref} changes nothing, so there is nothing to apply.`
      );
    }

    const applied = await this.imports.applyBatch(batchId, context.principalId);
    if (applied === null) return this.getBatch(batchId);

    const result = await this.getBatch(batchId);
    await this.audit(
      context,
      'RIK_ELIGIBILITY_IMPORT_APPLIED',
      batchId,
      { status: existing.status },
      { batchRef: result.batch.batch_ref, status: result.batch.status, appliedRows: applied.appliedRows }
    );
    return result;
  }

  async discard(context: AuthContext, batchId: string): Promise<BatchWithRows> {
    const existing = await this.imports.findBatch(batchId);
    if (existing === null) {
      throw new EligibilityAdminError('BATCH_NOT_FOUND', 'That eligibility import does not exist.');
    }
    if (existing.status === 'APPLIED') {
      throw new EligibilityAdminError(
        'BATCH_NOT_PENDING',
        `${existing.batch_ref} has already been applied and cannot be discarded. Correct it with a further import or a single adjustment.`
      );
    }
    if (existing.status === 'DISCARDED') return this.getBatch(batchId);

    await this.imports.discardBatch(batchId, context.principalId);
    const result = await this.getBatch(batchId);
    await this.audit(
      context,
      'RIK_ELIGIBILITY_IMPORT_DISCARDED',
      batchId,
      { status: existing.status },
      { batchRef: result.batch.batch_ref, status: result.batch.status }
    );
    return result;
  }

  // ------------------------------------------------- one officer, by hand

  /**
   * One officer, one period, one figure, one reason.
   *
   * THREE FIGURES ARE REACHABLE FROM HERE, and which one is named decides
   * everything that follows:
   *
   *   rationType ABSENT  the LEGACY `eligible_days` — the figure the
   *                      entitlement engine calculates from. Validated 0–366
   *                      with the message it has always used, compared against
   *                      the legacy column, and written with `ration_type`
   *                      NULL so migration 0066's legacy trigger branch runs.
   *                      This path is restored to exactly what it was.
   *
   *   FRESH / DRY        one of the two figures 0066 added, validated against
   *                      its own maximum (30 / 60), compared against its own
   *                      row and written to its own table.
   *
   * The two are kept apart deliberately rather than unified behind a default:
   * a default would mean a correction aimed at one figure silently moving
   * another, which is the whole class of mistake this work exists to prevent.
   */
  async adjust(
    context: AuthContext,
    input: {
      officerId: string;
      periodId: string;
      /** Absent means the legacy figure the entitlement engine reads. */
      rationType?: EligibilityRationType;
      eligibleDays: number;
      reason: string;
    }
  ): Promise<{ previous: number; delta: number; next: number; adjustmentId: string }> {
    const officer = await this.officers.findById(input.officerId);
    if (officer === null) {
      throw new EligibilityAdminError('OFFICER_NOT_FOUND', 'That officer does not exist.');
    }
    const period = await this.periods.findById(input.periodId);
    if (period === null) {
      throw new EligibilityAdminError(
        'PERIOD_NOT_FOUND',
        'That entitlement period does not exist.',
        'periodId'
      );
    }
    if (input.rationType === undefined) {
      // THE ORIGINAL CHECK AND THE ORIGINAL MESSAGE, restored verbatim. The
      // legacy column still permits up to 366 and nothing about it changed, so
      // neither does what an administrator is told when they overshoot it.
      if (
        !Number.isInteger(input.eligibleDays) ||
        input.eligibleDays < 0 ||
        input.eligibleDays > 366
      ) {
        throw new EligibilityAdminError(
          'INVALID_ELIGIBLE_DAYS',
          'Eligible days must be a whole number between 0 and 366.',
          'eligibleDays'
        );
      }
    } else {
      const max = RATION_TYPE_MAX_DAYS[input.rationType];
      if (
        !Number.isInteger(input.eligibleDays) ||
        input.eligibleDays < 0 ||
        input.eligibleDays > max
      ) {
        throw new EligibilityAdminError(
          'INVALID_ELIGIBLE_DAYS',
          `${capitalise(input.rationType)} eligible days must be a whole number between 0 and ${max}.`,
          'eligibleDays',
          { rationType: input.rationType, maxEligibleDays: max }
        );
      }
    }
    const reason = (input.reason ?? '').trim();
    if (reason === '') {
      throw new EligibilityAdminError(
        'BLANK_REASON',
        'An adjustment must say why it was made.',
        'reason'
      );
    }

    const currentMap = await this.imports.currentEligibleDays(
      input.periodId,
      [input.officerId],
      input.rationType
    );
    const previous = currentMap.get(input.officerId) ?? 0;
    const delta = input.eligibleDays - previous;
    if (delta === 0) {
      // The legacy sentence is the original one, word for word.
      throw new EligibilityAdminError(
        'NO_CHANGE',
        input.rationType === undefined
          ? `${officer.rik_id} already holds ${previous} eligible days for this period, so there is nothing to adjust.`
          : `${officer.rik_id} already holds ${previous} ${input.rationType.toLowerCase()} eligible days for this period, so there is nothing to adjust.`,
        'eligibleDays'
      );
    }

    const adjustmentId = await this.imports.insertAdjustment({
      customerId: input.officerId,
      periodId: input.periodId,
      rationType: input.rationType,
      previous,
      delta,
      next: input.eligibleDays,
      reason,
      staffId: context.principalId,
    });

    // The legacy audit entry carries exactly the fields it always carried; a
    // Fresh or Dry entry adds the figure it moved. An audit record that gained
    // a field retrospectively would make the history of the legacy column read
    // differently before and after this change, which is not something a
    // feature is allowed to do to an audit trail.
    await this.audit(
      context,
      'RIK_ELIGIBILITY_ADJUSTED',
      input.officerId,
      { eligibleDays: previous },
      {
        rikId: officer.rik_id,
        periodId: input.periodId,
        ...(input.rationType === undefined ? {} : { rationType: input.rationType }),
        previousEligibleDays: previous,
        delta,
        newEligibleDays: input.eligibleDays,
        reason,
      }
    );

    return { previous, delta, next: input.eligibleDays, adjustmentId };
  }

  /**
   * Whether this period's Fresh and Dry sheets have been published yet.
   *
   * Always two entries. A type with nothing uploaded is reported as such
   * rather than omitted, because an absent panel reads as a loading failure
   * and a half-finished period has to be obvious to the staff member looking
   * at it. Missing eligibility is never reported as zero days.
   */
  async uploadStatus(periodId: string): Promise<PeriodUploadStatus[]> {
    const period = await this.periods.findById(periodId);
    if (period === null) {
      throw new EligibilityAdminError(
        'PERIOD_NOT_FOUND',
        'That entitlement period does not exist.',
        'periodId'
      );
    }
    return this.imports.uploadStatusForPeriod(periodId);
  }

  async officerEligibility(officerId: string): Promise<{
    periods: OfficerPeriodEligibility[];
    history: AdjustmentRecord[];
  }> {
    const officer = await this.officers.findById(officerId);
    if (officer === null) {
      throw new EligibilityAdminError('OFFICER_NOT_FOUND', 'That officer does not exist.');
    }
    const [periods, history] = await Promise.all([
      this.imports.eligibilityForOfficer(officerId),
      this.imports.listAdjustments(officerId),
    ]);
    return { periods, history };
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
      entityType: 'rik.eligibility',
      entityId,
      before: before ?? undefined,
      after,
    });
  }
}

/** Re-exported for the controller's view layer. */
export type { RowOutcome };
