import { ApiError, NetworkError, apiRequest } from './client';

/**
 * Staff administration client.
 *
 * NOT TO BE CONFUSED WITH rik-officers-api.ts, which manages the CUSTOMERS who
 * draw rations. This file manages the people who operate the portal: separate
 * table (shared.users), separate sign-in (username and password rather than a
 * mobile number and an OTP), separate screen.
 *
 * Every call here reaches a route that requires `shared.user.manage`, and the
 * role calls additionally `shared.role.grant` — both held by SUPER_ADMIN alone
 * in the approved seed. The server decides; this module only asks.
 *
 * NOTE WHAT THE TYPES DO NOT HAVE: no password hash and no TOTP secret. The
 * API does not send them, and there is no field here to put one in, so no
 * component can render one by accident.
 */

export interface StaffAccount {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffDetail extends StaffAccount {
  /** The permissions the account's roles confer, resolved by the server. */
  permissions: string[];
}

export interface StaffListResponse {
  items: StaffAccount[];
  total: number;
  limit: number;
  offset: number;
}

export interface RoleSummary {
  name: string;
  description: string | null;
  permissions: string[];
}

export interface StaffFilters {
  q?: string;
  role?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export const STAFF_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

function queryString(filters: StaffFilters): string {
  const params = new URLSearchParams();
  if (filters.q !== undefined && filters.q.trim() !== '') params.set('q', filters.q.trim());
  if (filters.role !== undefined && filters.role !== '') params.set('role', filters.role);
  if (filters.status !== undefined && filters.status !== '') params.set('status', filters.status);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

export function fetchStaff(filters: StaffFilters = {}, signal?: AbortSignal): Promise<StaffListResponse> {
  return apiRequest<StaffListResponse>(`/admin/staff${queryString(filters)}`, { signal });
}

export function fetchStaffRoles(signal?: AbortSignal): Promise<{ roles: RoleSummary[] }> {
  return apiRequest<{ roles: RoleSummary[] }>('/admin/staff/roles', { signal });
}

export function fetchStaffMember(userId: string, signal?: AbortSignal): Promise<StaffDetail> {
  return apiRequest<StaffDetail>(`/admin/staff/${userId}`, { signal });
}

export function createStaff(input: {
  displayName: string;
  username: string;
  password: string;
  role?: string;
  status?: StaffStatus;
}): Promise<StaffAccount> {
  return apiRequest<StaffAccount>('/admin/staff', { method: 'POST', body: input });
}

export function updateStaff(userId: string, input: { displayName: string }): Promise<StaffAccount> {
  return apiRequest<StaffAccount>(`/admin/staff/${userId}`, { method: 'PATCH', body: input });
}

export function setStaffStatus(
  userId: string,
  input: { status: StaffStatus; reason: string }
): Promise<StaffAccount> {
  return apiRequest<StaffAccount>(`/admin/staff/${userId}/status`, { method: 'POST', body: input });
}

export function assignStaffRole(userId: string, role: string): Promise<StaffAccount> {
  return apiRequest<StaffAccount>(`/admin/staff/${userId}/roles`, { method: 'POST', body: { role } });
}

export function revokeStaffRole(userId: string, role: string): Promise<StaffAccount> {
  return apiRequest<StaffAccount>(`/admin/staff/${userId}/roles/${encodeURIComponent(role)}`, {
    method: 'DELETE',
  });
}

/**
 * Resets a password to one the administrator supplies.
 *
 * The response carries no credential — only how many sessions the reset ended.
 * The administrator conveys the new password to the person out of band; it was
 * never the server's to hand back.
 */
export function resetStaffPassword(
  userId: string,
  input: { newPassword: string; reason: string }
): Promise<{ userId: string; revokedSessions: number }> {
  return apiRequest<{ userId: string; revokedSessions: number }>(
    `/admin/staff/${userId}/password-reset`,
    { method: 'POST', body: input }
  );
}

/** The policy the server enforces, mirrored so the form can say so before submitting. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_RULE_TEXT =
  'At least 12 characters, with a lower-case letter, an upper-case letter, a digit and a symbol. It must not contain the username.';

export function describePasswordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[a-z]/.test(password)) return 'Add a lower-case letter.';
  if (!/[A-Z]/.test(password)) return 'Add an upper-case letter.';
  if (!/\d/.test(password)) return 'Add a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Add a symbol.';
  const user = username.trim().toLowerCase();
  if (user.length >= 3 && password.toLowerCase().includes(user)) {
    return 'The password must not contain the username.';
  }
  return null;
}

/**
 * The server's own explanation of a refusal.
 *
 * WHY THIS EXISTS RATHER THAN ConfigUI's `serverMessage`. That helper was
 * written for the RIK configuration screens and answers a 403 with a fixed
 * sentence about RIK configuration permissions — correct there, because a 403
 * on those screens means exactly one thing. Here it would be both wrong and
 * actively harmful: staff management returns 403 for the refusals that MATTER,
 * and each carries a specific explanation the administrator needs —
 *
 *   "This is the only active Super Admin account…"
 *   "You cannot change your own account status…"
 *   "You cannot remove your own Super Admin role…"
 *
 * Replacing any of those with "your role does not include permission" would
 * tell an administrator they lack a permission they plainly hold, and hide the
 * one fact that explains what to do next. So a 403 with a message is passed
 * through, exactly as a 400 or a 409 is.
 */
export function staffRefusalMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.message) return err.message;
    if (err.status === 403) return 'Managing staff accounts is reserved to Super Admin.';
    return 'The change could not be saved. Please try again.';
  }
  if (err instanceof NetworkError) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  return 'The change could not be saved. Please try again.';
}
