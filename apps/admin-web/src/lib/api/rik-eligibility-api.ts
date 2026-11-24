import { apiRequest, apiUpload } from './client';

/**
 * Eligibility import and eligible-day adjustment (STEP 15B Phase B).
 *
 * The shapes below mirror the server's responses exactly. In particular the
 * preview carries BOTH names — what the spreadsheet said and what e-Samagri
 * holds — and the raw eligible-days text as typed, because a reviewer cannot
 * judge a mismatch or a refused number without seeing the original.
 *
 * Nothing here computes a delta, resolves an officer, or decides an outcome.
 * All three are the server's, and are read from its response: the screen that
 * recomputed a delta locally would be stating a second, unenforced version of
 * the rule.
 */

export type ImportStatus = 'PENDING_REVIEW' | 'APPLIED' | 'DISCARDED';

/**
 * Which of an officer's two eligibility figures a sheet applies to
 * (STEP 16 / migration 0066).
 *
 * The workbook still carries only `Name | Mobile Number | Eligible Days`, so
 * this is chosen on the screen — the FRESH and DRY buttons — exactly as the
 * period already is. The server refuses an upload that omits it.
 */
export type EligibilityRationType = 'FRESH' | 'DRY';

export const RATION_TYPES: ReadonlyArray<EligibilityRationType> = ['FRESH', 'DRY'];

/** The facility's approved maximum for each figure, in days. */
export const RATION_TYPE_MAX_DAYS: Readonly<Record<EligibilityRationType, number>> = {
  FRESH: 30,
  DRY: 60,
};

export const RATION_TYPE_LABELS: Readonly<Record<EligibilityRationType, string>> = {
  FRESH: 'Fresh',
  DRY: 'Dry',
};

export type RowOutcome =
  | 'MATCHED_CHANGED'
  | 'MATCHED_NO_CHANGE'
  | 'UNMATCHED_MOBILE_NOT_FOUND'
  | 'NAME_MISMATCH'
  | 'DUPLICATE_IN_FILE'
  | 'INVALID_MOBILE'
  | 'INVALID_ELIGIBLE_DAYS'
  | 'MISSING_FIELD';

export interface EntitlementPeriodOption {
  periodId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface ImportTotals {
  rows: number;
  changed: number;
  noChange: number;
  exceptions: number;
  applied: number;
}

export interface ImportBatchSummary {
  batchId: string;
  batchRef: string;
  periodId: string;
  periodName: string;
  /** null on a batch uploaded before migration 0066. */
  rationType: EligibilityRationType | null;
  fileName: string;
  fileHash: string;
  status: ImportStatus;
  totals: ImportTotals;
  uploadedAt: string;
  decidedAt: string | null;
}

export interface ImportPreviewRow {
  rowId: string;
  /** The row number in the sheet, so a reviewer can find it in the file. */
  sheetRow: number;
  excelName: string;
  excelMobile: string;
  /** Exactly what the cell held — '7.5' stays '7.5' so the refusal is specific. */
  excelEligibleDays: string;
  normalisedMobile: string | null;
  officerId: string | null;
  rikId: string | null;
  systemName: string | null;
  systemOfficialName: string | null;
  previousEligibleDays: number | null;
  importedEligibleDays: number | null;
  delta: number | null;
  outcome: RowOutcome;
  exceptionReason: string | null;
}

export interface ImportBatch extends ImportBatchSummary {
  rows: ImportPreviewRow[];
}

export interface AdjustmentResult {
  previousEligibleDays: number;
  delta: number;
  newEligibleDays: number;
  adjustmentId: string;
}

export interface AdjustmentHistoryEntry {
  adjustmentId: string;
  periodId: string;
  periodName: string;
  /** Which figure this entry moved; null means the legacy column. */
  rationType: EligibilityRationType | null;
  previousEligibleDays: number;
  delta: number;
  newEligibleDays: number;
  reason: string;
  source: 'IMPORT' | 'MANUAL';
  batchRef: string | null;
  staffId: string;
  staffName: string | null;
  createdAt: string;
}

export interface OfficerEligibility {
  periods: Array<{
    periodId: string;
    periodName: string;
    /**
     * The LEGACY single figure. It is NO LONGER what the entitlement engine
     * calculates from — since the Fresh/Dry change, a Fresh pool is scaled
     * by `freshEligibleDays` and a Dry pool by `dryEligibleDays`, and this
     * figure scales nothing. It is kept on record and is what selections
     * confirmed before that change replay from.
     *
     * `null` when the officer has no legacy eligibility row for this period,
     * which is the ordinary state for an officer whose figures arrived
     * through the per-ration-type Excel import.
     */
    eligibleDays: number | null;
    /** null until a Fresh sheet has been applied to this period. */
    freshEligibleDays: number | null;
    /** null until a Dry sheet has been applied to this period. */
    dryEligibleDays: number | null;
    updatedAt: string;
  }>;
  history: AdjustmentHistoryEntry[];
}

/**
 * The derived verification status of one officer's figure for one ration
 * type, as the server computes it.
 *
 * DERIVED, NOT STORED. No column records any of this; it is read off the
 * figure that exists plus the import history.
 *
 *   PUBLISHED              a figure above zero is on record.
 *   PUBLISHED_ZERO         the facility published zero days. A real
 *                          entitlement of nothing, not a gap.
 *   MISSING_PROVEN_ABSENT  no figure, AND an applied sheet for this ration
 *                          type exists that does not contain this officer.
 *                          The only case where absence from the upload is a
 *                          fact rather than an assumption.
 *   MISSING                no figure, and nothing on record proves why.
 */
export type EligibilityVerificationStatus =
  | 'PUBLISHED'
  | 'PUBLISHED_ZERO'
  | 'MISSING_PROVEN_ABSENT'
  | 'MISSING';

export interface OfficerEligibilityGapType {
  rationType: EligibilityRationType;
  label: string;
  /** Published days, or null for "not published". Zero is a figure. */
  days: number | null;
  status: EligibilityVerificationStatus;
}

export interface OfficerEligibilityGap {
  customerId: string;
  rikId: string;
  name: string;
  officialName: string | null;
  /** Always two entries, Fresh then Dry. */
  byRationType: OfficerEligibilityGapType[];
}

export interface EligibilityGapPage {
  period: { id: string; name: string; startDate: string; endDate: string };
  totals: {
    /** Every officer on the roll. */
    officers: number;
    /** Officers with both figures published above zero. */
    complete: number;
    /** Officers with a missing figure or a published zero. */
    needsAttention: number;
  };
  /** True when more officers need attention than `items` lists. */
  truncated: boolean;
  items: OfficerEligibilityGap[];
}

/**
 * The officers who need attention for one period, by name.
 *
 * Read-only. Officers with both figures published above zero are counted in
 * `totals.complete` and not listed — the list is the work queue, not the
 * roll.
 */
export function fetchEligibilityGaps(
  periodId: string,
  signal?: AbortSignal
): Promise<EligibilityGapPage> {
  return apiRequest<EligibilityGapPage>(`${BASE}/periods/${periodId}/eligibility-gaps`, { signal });
}

/**
 * How each derived status reads to a staff member, and what they should do.
 *
 * The wording is fixed here rather than assembled at each call site, so the
 * panel cannot say "not uploaded" where the server only established "no
 * figure on record".
 */
export const VERIFICATION_STATUS_LABELS: Readonly<
  Record<EligibilityVerificationStatus, { label: string; action: string | null }>
> = {
  PUBLISHED: { label: 'Published', action: null },
  PUBLISHED_ZERO: {
    label: 'Uploaded — 0 days',
    action: 'Confirm the sheet really records zero days for this officer.',
  },
  MISSING_PROVEN_ABSENT: {
    label: 'Not in the latest sheet',
    action: 'This officer was not in the applied sheet. Add them and upload again, or adjust manually.',
  },
  MISSING: {
    label: 'Verification required',
    action: 'No figure is on record. Upload the sheet for this ration type, or adjust manually.',
  },
};

/** The five approved officer-level labels, and nothing else. */
export type OfficerGapLabel =
  | 'Complete'
  | 'Fresh verification required'
  | 'Dry verification required'
  | 'Eligibility verification required'
  | 'Uploaded — 0 days';

/**
 * One officer's position in five words, derived from their two statuses.
 *
 * A MISSING FIGURE OUTRANKS A PUBLISHED ZERO. A zero is an entitlement the
 * facility published and an officer can be told about; a missing figure stops
 * them drawing that ration type at all, so it is the headline when both are
 * present. The published zero is still visible in that type's own column, so
 * nothing is hidden by the ordering — it only decides which sentence leads.
 *
 * Pure, so the panel and any test agree on the wording without either one
 * reimplementing the rule.
 */
export function officerGapLabel(gap: Pick<OfficerEligibilityGap, 'byRationType'>): OfficerGapLabel {
  const missing = gap.byRationType.filter(
    (t) => t.status === 'MISSING' || t.status === 'MISSING_PROVEN_ABSENT'
  );

  if (missing.length >= 2) return 'Eligibility verification required';
  if (missing.length === 1) {
    return missing[0]!.rationType === 'FRESH'
      ? 'Fresh verification required'
      : 'Dry verification required';
  }
  if (gap.byRationType.some((t) => t.status === 'PUBLISHED_ZERO')) return 'Uploaded — 0 days';
  return 'Complete';
}

/**
 * Whether a period's Fresh and Dry sheets have been published.
 *
 * Always two entries, one per type. A type with nothing uploaded has
 * `uploaded: false` and `totals: null` — it is reported, not omitted, because
 * an absent panel reads as a loading failure and a half-finished period has
 * to be obvious. `officersWithValue` counts officers whose figure for that
 * type is actually set, which is never inferred from a zero.
 */
export interface EligibilityUploadStatus {
  rationType: EligibilityRationType;
  uploaded: boolean;
  batchId: string | null;
  batchRef: string | null;
  status: ImportStatus | null;
  totals: ImportTotals | null;
  uploadedAt: string | null;
  decidedAt: string | null;
  officersWithValue: number;
}

const BASE = '/admin/rik';

export function fetchPeriods(signal?: AbortSignal): Promise<{ items: EntitlementPeriodOption[] }> {
  return apiRequest<{ items: EntitlementPeriodOption[] }>(`${BASE}/periods`, { signal });
}

export function fetchBatches(
  limit?: number,
  signal?: AbortSignal
): Promise<{ items: ImportBatchSummary[] }> {
  const suffix = limit === undefined ? '' : `?limit=${limit}`;
  return apiRequest<{ items: ImportBatchSummary[] }>(`${BASE}/eligibility-imports${suffix}`, { signal });
}

export function fetchBatch(batchId: string, signal?: AbortSignal): Promise<ImportBatch> {
  return apiRequest<ImportBatch>(`${BASE}/eligibility-imports/${batchId}`, { signal });
}

/**
 * Uploads the workbook and returns the PREVIEW. This changes no officer's
 * eligible days: the server records the batch as PENDING_REVIEW and waits.
 * The period travels as a form field because the sheet carries no period
 * column — the administrator chose it on the screen. So does the ration type,
 * for the same reason: the sheet does not say whether it is Fresh or Dry, the
 * administrator does, by pressing a button.
 *
 * `rationType` is OPTIONAL IN THIS SIGNATURE AND REQUIRED BY THE SERVER. It
 * is optional here only so that the parameter could be added without changing
 * the shape every existing caller and test declares; it is NOT a default. Omit
 * it and the request is refused with a 400, which is the right outcome — a
 * client-side default would silently write Fresh from a Dry sheet, and nothing
 * in the file would contradict it.
 */
export function uploadEligibility(
  periodId: string,
  file: File,
  rationType?: EligibilityRationType
): Promise<ImportBatch> {
  const form = new FormData();
  form.append('periodId', periodId);
  if (rationType !== undefined) form.append('rationType', rationType);
  form.append('file', file);
  return apiUpload<ImportBatch>(`${BASE}/eligibility-imports`, form);
}

/** Per-type upload status for one period. Read-only. */
export function fetchEligibilityStatus(
  periodId: string,
  signal?: AbortSignal
): Promise<{ items: EligibilityUploadStatus[] }> {
  return apiRequest<{ items: EligibilityUploadStatus[] }>(
    `${BASE}/periods/${periodId}/eligibility-status`,
    { signal }
  );
}

/** Applies a reviewed batch. Idempotent on the server: a second call is not an error. */
export function confirmBatch(batchId: string): Promise<ImportBatch> {
  return apiRequest<ImportBatch>(`${BASE}/eligibility-imports/${batchId}/confirm`, { method: 'POST' });
}

export function discardBatch(batchId: string): Promise<ImportBatch> {
  return apiRequest<ImportBatch>(`${BASE}/eligibility-imports/${batchId}/discard`, { method: 'POST' });
}

export function fetchOfficerEligibility(
  officerId: string,
  signal?: AbortSignal
): Promise<OfficerEligibility> {
  return apiRequest<OfficerEligibility>(`${BASE}/officers/${officerId}/eligibility`, { signal });
}

/**
 * Corrects ONE officer's figure, with a reason.
 *
 * `rationType` is OPTIONAL, and omitting it is meaningful rather than lazy: it
 * selects the LEGACY `eligible_days` figure — the one the entitlement engine
 * calculates from, and the one this screen has always corrected. Naming FRESH
 * or DRY selects one of the two figures migration 0066 added instead.
 *
 * Callers must OMIT THE KEY for a legacy adjustment rather than send
 * `undefined`, so the request body carries no `rationType` at all and the
 * server's `ration_type IS NULL` path is unambiguous.
 */
export function adjustOfficerEligibility(
  officerId: string,
  input: {
    periodId: string;
    rationType?: EligibilityRationType;
    eligibleDays: number;
    reason: string;
  }
): Promise<AdjustmentResult> {
  return apiRequest<AdjustmentResult>(`${BASE}/officers/${officerId}/eligibility`, {
    method: 'POST',
    body: input,
  });
}

/** How each outcome reads to a reviewer, and whether it is an exception. */
export const OUTCOME_LABELS: Readonly<Record<RowOutcome, string>> = {
  MATCHED_CHANGED: 'Will change',
  MATCHED_NO_CHANGE: 'No change',
  UNMATCHED_MOBILE_NOT_FOUND: 'Mobile not found',
  NAME_MISMATCH: 'Name differs',
  DUPLICATE_IN_FILE: 'Duplicate in file',
  INVALID_MOBILE: 'Mobile unusable',
  INVALID_ELIGIBLE_DAYS: 'Eligible days unusable',
  MISSING_FIELD: 'Required field blank',
};

export function isException(outcome: RowOutcome): boolean {
  return outcome !== 'MATCHED_CHANGED' && outcome !== 'MATCHED_NO_CHANGE';
}
