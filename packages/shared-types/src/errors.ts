/**
 * The single API error envelope shape, per the approved Phase 3A
 * blueprint (Section 23 — Error handling). Every non-2xx response
 * from apps/api uses exactly this shape; no endpoint invents its own
 * error format.
 */
export interface ApiErrorBody {
  /** Stable, machine-readable string. Clients switch on this, never on `message`. */
  code: string;
  /** Human-readable, safe to show directly to the caller. */
  message: string;
  /** Correlates this error to a server log line and, where relevant, an audit row. */
  correlationId: string;
  /** Optional, structured, field-level detail — validation errors only. */
  details?: Record<string, unknown>;
}

/**
 * Stable error codes used by the foundation infrastructure itself
 * (global exception filter, auth guards, validation pipe). Domain
 * modules (RIK/PIF) will add their own codes as those modules are
 * built — this is the foundation set only.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  /**
   * No such ADDRESS on this API — distinct from NOT_FOUND, which means the
   * address exists and the thing it names does not.
   *
   * The difference is not pedantry: both web apps use it to tell "this
   * screen's backend route has not shipped yet" (show the planned-feature
   * state) apart from "that voucher does not exist" (show an error). Before
   * the global exception filter existed, the apps told these apart by the
   * ABSENCE of a code on the framework's default 404 body; now every error
   * carries a code, so the distinction has to be stated rather than implied.
   */
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // --- Authentication (STEP 6 — shared auth/session foundation) --------
  // Added alongside the auth guards, per this file's own "global
  // exception filter, auth guards, validation pipe" foundation scope.
  // Each is safe to return verbatim to the caller: every one only
  // becomes visible after the caller has already proven some prior
  // factor (a correctly-requested OTP for OTP_*, a correct password for
  // the staff TOTP_* codes) — see STEP 6 report section H for the
  // account-enumeration reasoning behind that line.
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  TOTP_REQUIRED: 'TOTP_REQUIRED',
  TOTP_INVALID: 'TOTP_INVALID',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',

  // --- Common login: the number is verified, the account does not exist ---
  /**
   * The presented OTP was CORRECT, and no customer account exists behind that
   * mobile number. The response carries a short-lived registration ticket so
   * the app can continue straight to the PIF registration form without asking
   * for a second code.
   *
   * WHY THIS IS SAFE TO RETURN, AND WHAT IT COSTS. Like every OTP_* code
   * above, it becomes visible only after the caller has proven a prior factor
   * — here, possession of a code delivered to that number. It does disclose
   * that the number has no account, which the previous behaviour deliberately
   * hid by reusing OTP_INVALID. That trade was approved as Option 4a of the
   * common-login decision: the alternative was telling a resident with a
   * correct code that their code was wrong, which is a false statement and
   * sent them looking for the wrong problem.
   *
   * The disclosure is bounded: a caller must already hold a valid, unexpired,
   * unconsumed code for the number they are asking about, so this cannot be
   * swept across a range of numbers.
   */
  ACCOUNT_NOT_REGISTERED: 'ACCOUNT_NOT_REGISTERED',
  /**
   * The same situation, with self-registration switched off: the code was
   * correct, there is no account, and the resident cannot create one
   * themselves. No ticket is issued. The message names the facility, because
   * registration by staff is the only remaining route.
   */
  REGISTRATION_UNAVAILABLE: 'REGISTRATION_UNAVAILABLE',
  /**
   * The registration ticket presented with a registration was missing,
   * malformed, expired, or not backed by a recently consumed code for that
   * number. Deliberately distinct from OTP_INVALID: nothing is wrong with any
   * code, and the app's remedy is to start the login again rather than to
   * re-type six digits.
   */
  REGISTRATION_TICKET_INVALID: 'REGISTRATION_TICKET_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
