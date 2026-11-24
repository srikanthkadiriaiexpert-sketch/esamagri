import { apiRequest } from './client';

/**
 * The admin/staff API surface (STEP 10). Every shape here mirrors a
 * real endpoint in apps/api's AdminController — there are no
 * speculative contracts and no fixtures behind any of them.
 *
 * Nothing in this file decides what the caller may do. The server
 * resolves roles and permissions from the database on every request and
 * returns 401/403 accordingly; the fields below are used only to shape
 * the interface, never as the security boundary.
 */
export interface StaffSession {
  userId: string;
  username: string | null;
  displayName: string | null;
  roles: string[];
  permissions: string[];
}

export type DashboardTileStatus = 'available' | 'unavailable';

export interface DashboardTile {
  key: string;
  label: string;
  module: 'shared' | 'rik' | 'pif';
  status: DashboardTileStatus;
  /** Only present on an available tile, and always a real queried figure. */
  value?: number;
  /** Only present on an unavailable tile — why it has no data yet. */
  reason?: string;
}

export type AnnouncementAudience = 'ALL' | 'RIK' | 'PIF';
export type AnnouncementPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type AnnouncementType =
  | 'GENERAL'
  | 'HOLIDAY_CLOSURE'
  | 'RIK_ISSUE_DAYS'
  | 'RIK_CATEGORY_SCHEDULE'
  | 'PIF_TIMING'
  | 'DELIVERY_PICKUP_CHANGE'
  | 'OPERATIONAL'
  | 'TEMPORARY_STOCK_NOTICE';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  announcementType: AnnouncementType;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  startDate: string;
  endDate: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementListResponse {
  items: Announcement[];
  /**
   * Which audiences this staff member may write. Supplied so the form
   * does not offer an option the server will refuse — a usability
   * courtesy, not the restriction itself.
   */
  manageableAudiences: AnnouncementAudience[];
}

export interface IssueSchedule {
  id: string;
  scheduleDate: string;
  categoryId: string | null;
  productId: string | null;
  status: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  isPublished: boolean;
}

export interface IssueScheduleListResponse {
  items: IssueSchedule[];
  /** False in this phase: creating schedules depends on unresolved decisions. */
  canCreate: boolean;
}

export function fetchStaffSession(signal?: AbortSignal): Promise<StaffSession> {
  return apiRequest<StaffSession>('/admin/session', { signal });
}

export function fetchDashboard(signal?: AbortSignal): Promise<{ tiles: DashboardTile[] }> {
  return apiRequest<{ tiles: DashboardTile[] }>('/admin/dashboard', { signal });
}

export function fetchAnnouncements(signal?: AbortSignal): Promise<AnnouncementListResponse> {
  return apiRequest<AnnouncementListResponse>('/admin/announcements', { signal });
}

export function createAnnouncement(input: {
  title: string;
  body: string;
  announcementType: AnnouncementType;
  targetAudience: AnnouncementAudience;
  priority: AnnouncementPriority;
  isPublished: boolean;
}): Promise<Announcement> {
  return apiRequest<Announcement>('/admin/announcements', { method: 'POST', body: input });
}

export function fetchIssueSchedules(signal?: AbortSignal): Promise<IssueScheduleListResponse> {
  return apiRequest<IssueScheduleListResponse>('/admin/rik/issue-schedules', { signal });
}

/**
 * The PIF self-registration switch (Stage 2 Admin Portal control).
 *
 * `enabled` is what the server would actually answer a resident with — not
 * a hope about the stored bytes. `neverSet` and `malformed` exist so the
 * screen can explain WHY it reads OFF: never configured, or configured
 * into a shape the gate refuses to trust. Both of those are OFF, and the
 * server is the one that decided so.
 */
export interface PifSelfRegistrationStatus {
  enabled: boolean;
  /** No row in shared.settings yet — the shipped default. */
  neverSet: boolean;
  /** A row exists but does not parse; the gate fails closed, so enabled is false. */
  malformed: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
  /** Display name, falling back to username, or null if neither is known. */
  updatedByName: string | null;
}

export function fetchPifSelfRegistration(
  signal?: AbortSignal
): Promise<PifSelfRegistrationStatus> {
  return apiRequest<PifSelfRegistrationStatus>('/admin/settings/pif-self-registration', { signal });
}

/**
 * Sets the switch and returns the state the server now holds.
 *
 * The response is re-read server-side after the write, so a caller that
 * renders it is showing the stored truth rather than echoing its own
 * request back at the administrator.
 */
export function setPifSelfRegistration(enabled: boolean): Promise<PifSelfRegistrationStatus> {
  return apiRequest<PifSelfRegistrationStatus>('/admin/settings/pif-self-registration', {
    method: 'PUT',
    body: { enabled },
  });
}
