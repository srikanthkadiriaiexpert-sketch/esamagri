import { apiRequest } from './client';

/**
 * Officer registration and lookup (STEP 15B Phase A).
 *
 * Every field below is what the server sends. Nothing here derives,
 * reformats or invents an identifier: `rikId` arrives already formatted,
 * because it is generated at the database boundary and the screen's job is to
 * display it, not to compose it.
 *
 * There is deliberately no eligible-day field on this surface. Eligibility is
 * facility data that arrives through its own import (Phase B); showing a
 * blank or a zero here would state something untrue about an officer who has
 * simply just been registered.
 */

export type DietaryPreference = 'PV' | 'EV' | 'NV';
export type OfficerStatus = 'ACTIVE' | 'INACTIVE';

export interface OfficerResidence {
  quarterBlock: string;
  quarterNumber: string;
  landmark: string | null;
}

export interface Officer {
  officerId: string;
  /** RIK-O-######, system generated and permanent. */
  rikId: string;
  /** The officer's own display name, which they may later edit themselves. */
  name: string;
  /** The facility's name for the same person, used to verify an import. */
  officialName: string | null;
  mobileNumber: string;
  dietaryPreference: DietaryPreference | null;
  residence: OfficerResidence | null;
  status: OfficerStatus;
  createdAt: string;
}

export interface OfficerListResponse {
  items: Officer[];
  total: number;
  limit: number;
  offset: number;
}

export interface RegisterOfficerInput {
  name: string;
  mobileNumber: string;
  quarterBlock: string;
  quarterNumber: string;
  landmark?: string;
  /**
   * OPTIONAL, AND THE OPTIONALITY IS THE FEATURE.
   *
   * Required when registering a new officer. Omitted when the mobile number
   * belongs to a resident who already has an e-Samagri account: their dietary
   * preference is their own, and a staff member filling in this form must not
   * be able to overwrite it (approved decisions T2-2 and T2-9).
   *
   * `undefined` means "not sent". It must never be sent as an empty string —
   * the server's `@IsIn(['PV','EV','NV'])` would refuse that, and the
   * administrator would be told the preference is invalid when the truth is
   * that the form deliberately did not ask for one.
   */
  dietaryPreference?: DietaryPreference;
}

/** Which of the two things the server did with the submitted details. */
export type RegisterOfficerOutcome = 'REGISTERED' | 'LINKED';

/**
 * The register response: an officer, plus what happened to them.
 *
 *   REGISTERED — a new customer row was created and issued a RIK ID.
 *   LINKED     — an existing PIF-only resident was issued a RIK ID in place.
 *
 * The screen needs the distinction because the two deserve different
 * sentences. Reporting a link as a registration would tell an administrator
 * that a resident who has been shopping on PIF for six months was created a
 * moment ago.
 *
 * ON A LINKED RESULT, `name` AND `dietaryPreference` ARE THE RESIDENT'S OWN —
 * not anything this form submitted. The server writes neither on that path, so
 * the response is the authority on what the record now holds, and the screen
 * displays it rather than echoing the typed input back.
 */
export interface RegisterOfficerResult extends Officer {
  outcome: RegisterOfficerOutcome;
}

const BASE = '/admin/rik/officers';

export function fetchOfficers(
  params: { q?: string } = {},
  signal?: AbortSignal
): Promise<OfficerListResponse> {
  const query = new URLSearchParams();
  if (params.q && params.q.trim().length > 0) query.set('q', params.q.trim());
  const suffix = query.toString().length > 0 ? `?${query.toString()}` : '';
  return apiRequest<OfficerListResponse>(`${BASE}${suffix}`, { signal });
}

export function fetchOfficer(officerId: string, signal?: AbortSignal): Promise<Officer> {
  return apiRequest<Officer>(`${BASE}/${officerId}`, { signal });
}

/**
 * Register a new officer, or link a resident who already has an account.
 *
 * ONE ENDPOINT, DELIBERATELY. The server decides which of the two happened,
 * after it has canonicalised the mobile number and looked it up — so there is
 * no "check this number first" call here and no second approval surface. The
 * caller submits once and reads `outcome` from the reply.
 */
export function registerOfficer(input: RegisterOfficerInput): Promise<RegisterOfficerResult> {
  return apiRequest<RegisterOfficerResult>(BASE, { method: 'POST', body: input });
}

export function setOfficerActive(officerId: string, isActive: boolean): Promise<Officer> {
  return apiRequest<Officer>(`${BASE}/${officerId}/active`, { method: 'POST', body: { isActive } });
}

export interface RevokeSessionsResult extends Officer {
  /** How many active sessions were ended. 0 is a normal answer, not a failure. */
  revokedSessions: number;
}

/**
 * Sign this officer out of every device.
 *
 * WHAT IT IS FOR. A customer session lasts a rolling year, so a lost or
 * handed-on phone would otherwise stay signed in for one. This ends every
 * session the officer has; they keep their RIK ID, their eligibility and
 * their entitlement, and may sign in again with a fresh OTP.
 *
 * NOT IMMEDIATE, AND THE SCREEN SAYS SO. An access token already issued
 * stays valid until it expires — up to 15 minutes — because the API verifies
 * a JWT's signature without consulting the session table. What is immediate
 * is that no new access token can be obtained.
 *
 * No token value is sent or returned: the request names an officer and the
 * response carries a count.
 */
export function revokeOfficerSessions(officerId: string): Promise<RevokeSessionsResult> {
  return apiRequest<RevokeSessionsResult>(`${BASE}/${officerId}/sessions/revoke`, {
    method: 'POST',
  });
}

