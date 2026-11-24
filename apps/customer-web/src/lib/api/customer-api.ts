import { apiRequest } from './client';

/**
 * The customer's own profile (STEP 9). These shapes mirror the real
 * `CustomerController` responses exactly — unlike `lib/api/types.ts`,
 * which holds provisional shapes for modules that don't exist yet,
 * everything here is a live backend contract.
 *
 * Note what is absent: no customer id is ever sent by this client. The
 * app calls `/customer/me` and the server resolves identity from the
 * verified access token, so there is no id in the browser for anyone
 * to tamper with. The id-addressed route exists server-side and is
 * ownership-guarded, but the customer app has no reason to use it.
 */
export interface CustomerResidence {
  label: string | null;
  quarterBlock: string;
  quarterNumber: string;
  landmark: string | null;
}

export interface CustomerProfile {
  customerId: string;
  name: string;
  mobileNumber: string;
  /** null when no residence has been recorded yet — render an empty state, not an error. */
  residence: CustomerResidence | null;
  /**
   * Whether this customer has an approved, active RIK profile.
   *
   * Decides whether the app OFFERS the RIK module. It is NOT what protects it:
   * every RIK endpoint is refused independently by the server's own
   * @RequireRikCustomer check, so a client that ignored this flag — or forged
   * it in a devtools console — would get 403s and nothing else. Hiding the
   * module is a courtesy to the person using the app, not a security control.
   *
   * Optional in this type on purpose: a server that predates the field, or a
   * test that stubs the profile without it, must not accidentally HIDE RIK
   * from an officer. See `rikModuleHidden` below for the rule that follows
   * from that.
   */
  rikAuthorised?: boolean;
}

/**
 * Whether to hide the RIK module.
 *
 * Hides ONLY on an explicit `false`. An absent or unknown flag shows RIK,
 * because the two failure directions are not equally bad: showing the module
 * to someone who cannot use it produces visible, self-correcting 403s, while
 * hiding it from an officer who IS entitled produces no error anywhere and
 * would surface only as a confused phone call. The real server always sends
 * the boolean, so in production this is exactly "show only when approved".
 */
export function rikModuleHidden(profile: Pick<CustomerProfile, 'rikAuthorised'> | null): boolean {
  return profile?.rikAuthorised === false;
}

export interface UpdateCustomerProfileInput {
  name?: string;
  quarterBlock?: string;
  quarterNumber?: string;
  landmark?: string;
  label?: string;
}

export function fetchMyProfile(signal?: AbortSignal): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customer/me', { signal });
}

/**
 * Sends only the fields the customer actually changed. The backend
 * rejects anything outside the approved set (name, quarter block,
 * quarter number, landmark, label) with VALIDATION_FAILED, so this
 * never tries to be clever about extra keys.
 */
export function updateMyProfile(input: UpdateCustomerProfileInput): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customer/me', { method: 'PATCH', body: input });
}

/** "Block 4 · Qtr 12 (near the parade ground)" — or null when nothing is recorded. */
export function formatResidence(residence: CustomerResidence | null): string | null {
  if (!residence) return null;
  const base = `${residence.quarterBlock} · ${residence.quarterNumber}`;
  return residence.landmark ? `${base} (${residence.landmark})` : base;
}
