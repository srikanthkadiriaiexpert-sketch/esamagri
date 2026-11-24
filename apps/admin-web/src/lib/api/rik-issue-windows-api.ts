import { apiRequest } from './client';

/**
 * RIK issue windows — the configured physical issue schedule (STEP 15C).
 *
 * Every shape mirrors the real `RikIssueWindowsController` response. Nothing
 * here derives a date, a window code or an ordering: the server composes the
 * code from the ration type and the sequence number at the database boundary,
 * and the screen displays what it is told.
 *
 * OPERATING DAYS ARE DATES, not weekday names. The facility normally issues
 * on Tuesday, Wednesday and Friday, but a holiday moves a day, so the
 * schedule records the days it will actually open. No code in this module
 * names a weekday or assumes a week is seven days long.
 */

export type RationType = 'FRESH' | 'DRY' | 'MISS_MUSTER_FRESH' | 'MISS_MUSTER_DRY';
export type WindowCode =
  | 'FRESH_1'
  | 'FRESH_2'
  | 'FRESH_3'
  | 'DRY'
  | 'MISS_MUSTER_FRESH'
  | 'MISS_MUSTER_DRY';
export type WindowStatus = 'ACTIVE' | 'RETIRED';
export type RevisionChangeType = 'CREATED' | 'UPDATED' | 'ACTIVATED' | 'DEACTIVATED';

export interface IssueWindowPeriod {
  periodId: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface IssueWindowStaff {
  staffId: string;
  name: string | null;
}

export interface IssueWindow {
  windowId: string;
  windowCode: WindowCode;
  /** "Fresh Issue 2" — the facility's own words, composed by the server. */
  label: string;
  rationType: RationType;
  sequenceNo: number;
  period: IssueWindowPeriod;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  isActive: boolean;
  status: WindowStatus;
  notes: string | null;
  createdAt: string;
  createdBy: IssueWindowStaff;
  updatedAt: string;
  updatedBy: IssueWindowStaff;
}

/** The database's own jsonb snapshot of a window at one moment. */
export interface IssueWindowState {
  periodId: string;
  rationType: RationType;
  windowCode: WindowCode;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  isActive: boolean;
  notes: string | null;
}

export interface IssueWindowRevision {
  revisionId: string;
  windowId: string;
  revisionNo: number;
  changeType: RevisionChangeType;
  windowCode: WindowCode;
  label: string;
  rationType: RationType;
  /** null on the first revision, which is what CREATED means. */
  before: IssueWindowState | null;
  after: IssueWindowState;
  changedBy: IssueWindowStaff;
  changedAt: string;
}

export interface ConfigureIssueWindowInput {
  periodId: string;
  rationType: RationType;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  operatingDays: string[];
  notes?: string;
}

/**
 * Only the configurable fields. There is no `periodId`, `rationType` or
 * `sequenceNo`: a window is that window, and moving one into another slot
 * would rewrite a schedule officers were already shown.
 */
export interface UpdateIssueWindowInput {
  startDate?: string;
  endDate?: string;
  operatingDays?: string[];
  notes?: string;
  isActive?: boolean;
}

const BASE = '/admin/rik/issue-windows';

export function fetchIssueWindows(
  periodId: string,
  signal?: AbortSignal
): Promise<{ items: IssueWindow[] }> {
  return apiRequest<{ items: IssueWindow[] }>(`${BASE}?periodId=${encodeURIComponent(periodId)}`, {
    signal,
  });
}

export function fetchIssueWindowRevisions(
  windowId: string,
  signal?: AbortSignal
): Promise<{ items: IssueWindowRevision[] }> {
  return apiRequest<{ items: IssueWindowRevision[] }>(`${BASE}/${windowId}/revisions`, { signal });
}

export function configureIssueWindow(input: ConfigureIssueWindowInput): Promise<IssueWindow> {
  return apiRequest<IssueWindow>(BASE, { method: 'POST', body: input });
}

export function updateIssueWindow(
  windowId: string,
  input: UpdateIssueWindowInput
): Promise<IssueWindow> {
  return apiRequest<IssueWindow>(`${BASE}/${windowId}`, { method: 'PATCH', body: input });
}

/**
 * The six issue schedules a period can have, in the order they are shown.
 * One list, one place — the screen renders exactly this, configured or not.
 *
 * The two Miss Muster schedules sit immediately below Dry, and each is its
 * own ration type with sequence 1, which is the shape Dry already has. They
 * are deliberately NOT two sequence numbers under one shared type: migration
 * 0047 scopes its overlap exclusion and its ordering trigger by ration type,
 * so sharing one would stop the Fresh and Dry miss-muster schedules covering
 * the same day and would impose an order between two schedules that have
 * none. Staff set each one's dates independently.
 *
 * The Fresh and Dry structure is unchanged: three Fresh, one Dry, same codes,
 * same sequence numbers. Only the word in the label moved.
 */
export const WINDOW_SLOTS: ReadonlyArray<{
  rationType: RationType;
  sequenceNo: number;
  code: WindowCode;
  label: string;
}> = [
  { rationType: 'FRESH', sequenceNo: 1, code: 'FRESH_1', label: 'Fresh Issue 1' },
  { rationType: 'FRESH', sequenceNo: 2, code: 'FRESH_2', label: 'Fresh Issue 2' },
  { rationType: 'FRESH', sequenceNo: 3, code: 'FRESH_3', label: 'Fresh Issue 3' },
  { rationType: 'DRY', sequenceNo: 1, code: 'DRY', label: 'Dry Issue' },
  { rationType: 'MISS_MUSTER_FRESH', sequenceNo: 1, code: 'MISS_MUSTER_FRESH', label: 'Miss Muster Fresh' },
  { rationType: 'MISS_MUSTER_DRY', sequenceNo: 1, code: 'MISS_MUSTER_DRY', label: 'Miss Muster Dry' },
];

/**
 * The days of a date range, as ISO dates.
 *
 * Used to offer the administrator the days they may tick. Built by UTC
 * arithmetic from the window's own start and end, so it is right for a
 * 28-day February and a 31-day March alike and assumes nothing about how
 * long a month or a week is.
 */
export function daysInRange(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy!, sm! - 1, sd!);
  const end = Date.UTC(ey!, em! - 1, ed!);
  if (end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
    if (out.length > 400) break; // a window longer than a year is not a window
  }
  return out;
}

/**
 * The weekday name of an ISO date, for display only.
 *
 * Shown beside each day so an administrator can see that the schedule falls
 * on the days they meant. Nothing selects, validates or defaults by weekday —
 * the schedule is the dates the facility chose.
 */
export function weekdayLabel(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}
