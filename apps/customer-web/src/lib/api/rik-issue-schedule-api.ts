import { apiRequest } from './client';

/**
 * The RIK issue schedule, as the officer reads it (STEP 15C).
 *
 * READ ONLY. There is one function here and it is a GET. The schedule is the
 * facility's, configured by a RIK administrator, and this app has no write
 * path to it — not a disabled one, not a guarded one. The server has no
 * customer write route either, so there is nothing for a tampered request to
 * reach.
 *
 * The shapes mirror `RikController.issueSchedule()` exactly. Note what is
 * NOT in them: no schedule id, no `isActive`, no note, no `createdBy` or
 * `updatedBy`, no revision history. Those are administrative records and the
 * server does not send them to an officer.
 *
 * OPERATING DAYS ARE DATES. The facility normally issues on Tuesday,
 * Wednesday and Friday, but a holiday moves a day, so the schedule carries
 * the days it will actually open. Nothing in this module computes a weekday
 * to decide anything; `weekdayOf` exists only to label a date on screen.
 */

export type RationType = 'FRESH' | 'DRY' | 'MISS_MUSTER_FRESH' | 'MISS_MUSTER_DRY';
export type WindowCode =
  | 'FRESH_1'
  | 'FRESH_2'
  | 'FRESH_3'
  | 'DRY'
  | 'MISS_MUSTER_FRESH'
  | 'MISS_MUSTER_DRY';

export interface IssueWindowView {
  rationType: RationType;
  windowCode: WindowCode;
  sequenceNo: number;
  /** "Fresh Issue 2" — composed by the server, displayed as given. */
  label: string;
  startDate: string;
  endDate: string;
  operatingDays: string[];
}

export interface IssueSchedule {
  period: { id: string; name: string; startDate: string; endDate: string };
  fresh: IssueWindowView[];
  dry: IssueWindowView[];
  /**
   * The two Miss Muster schedules, each its own ration type. Optional on the
   * way in so a response from an API that predates migration 0058 still
   * parses; the page treats a missing list as an empty one.
   */
  missMusterFresh?: IssueWindowView[];
  missMusterDry?: IssueWindowView[];
}

export function fetchIssueSchedule(signal?: AbortSignal): Promise<IssueSchedule> {
  return apiRequest<IssueSchedule>('/rik/issue-schedule', { signal });
}

/** A date as the officer reads it: "Tue 14 Mar". Display only. */
export function formatIssueDay(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** An issue's range as one line: "2 Mar – 8 Mar". Display only. */
export function formatRange(startDate: string, endDate: string): string {
  const short = (isoDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  };
  return startDate === endDate ? short(startDate) : `${short(startDate)} – ${short(endDate)}`;
}
