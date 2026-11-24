import { apiRequest } from './client';

/**
 * Thin wrappers over the real STEP 6 endpoints — no fake OTP success,
 * no second auth mechanism. Every call here hits apps/api's /auth/*
 * routes exactly as STEP 6 built them.
 */

export interface AccessTokenPrincipal {
  principalType: 'CUSTOMER' | 'STAFF';
  principalId: string;
}

export interface SessionResponse {
  accessToken: string;
  principal: AccessTokenPrincipal;
}

export function requestCustomerOtp(mobileNumber: string): Promise<{ message: string }> {
  return apiRequest('/auth/customer/otp/request', { method: 'POST', body: { mobileNumber } });
}

export function verifyCustomerOtp(mobileNumber: string, code: string): Promise<SessionResponse> {
  return apiRequest('/auth/customer/otp/verify', { method: 'POST', body: { mobileNumber, code } });
}

/**
 * ONE LOGIN, AND THE SERVER DECIDES WHAT HAPPENS NEXT.
 *
 * A correct code can mean three things, and only the first is a session:
 *
 *   signed in                  2xx, a SessionResponse.
 *   number has no account      ApiError, code ACCOUNT_NOT_REGISTERED, carrying
 *                              a registration ticket in `details`.
 *   no account, and residents
 *   may not create one         ApiError, code REGISTRATION_UNAVAILABLE.
 *
 * This reads the second case out of the error. It is deliberately strict: a
 * response that claims ACCOUNT_NOT_REGISTERED without a usable ticket returns
 * null rather than a half-filled object, so the caller shows the server's own
 * message instead of navigating to a form that cannot be submitted.
 *
 * The mobile number here is for DISPLAY on the registration form only. The
 * server reads the number it acts on out of the signed ticket and ignores
 * anything this client says about it.
 */
export interface RegistrationHandoff {
  registrationTicket: string;
  mobileNumber: string;
}

export function registrationHandoffFrom(details: unknown): RegistrationHandoff | null {
  if (details === null || typeof details !== 'object') return null;
  const { registrationTicket, mobileNumber } = details as Record<string, unknown>;
  if (typeof registrationTicket !== 'string' || registrationTicket === '') return null;
  if (typeof mobileNumber !== 'string' || mobileNumber === '') return null;
  return { registrationTicket, mobileNumber };
}

/**
 * Step 1 of PIF self-registration — sends the code. Purpose 'REGISTER'
 * server-side, so the code cannot be used to sign in to an existing account.
 *
 * The server answers 503 with "Self-registration is not yet available" while
 * an administrator has the setting switched off. That is not a bug in this
 * client; the UI surfaces the server's own message. (This note previously
 * described the switch as a compile-time constant awaiting migration 0065; it
 * is a runtime setting in `shared.settings` now.)
 */
export function requestRegistrationOtp(mobileNumber: string): Promise<{ message: string }> {
  return apiRequest('/auth/customer/register/otp/request', {
    method: 'POST',
    body: { mobileNumber },
  });
}

/**
 * Step 2 — verifies the code, creates the account and returns a session.
 *
 * A mobile number that already has an account is NOT an error: the server
 * signs the resident into the account they already have, so there is never a
 * duplicate and this client never has to ask whether a number is registered.
 * Exactly the four approved fields are sent; no RIK ID and no dietary
 * preference, because a PIF resident has neither at this point.
 */
export interface RegistrationDetails {
  name: string;
  quarterBlock: string;
  quarterNumber: string;
}

/**
 * TWO WAYS IN, AND THE BODY SAYS WHICH.
 *
 * A ticket travels ALONE. No mobile number and no code go with it — the
 * server refuses a body carrying both, because a request that presents two
 * credentials has not said which one it wants honoured. That refusal is
 * deliberate and this client must not try to be helpful by sending the number
 * "just in case".
 */
export type RegistrationCredential =
  | { registrationTicket: string }
  | { mobileNumber: string; code: string };

export function registerCustomer(
  credential: RegistrationCredential,
  details: RegistrationDetails
): Promise<SessionResponse> {
  return apiRequest('/auth/customer/register', {
    method: 'POST',
    body: { ...credential, ...details },
  });
}

export function refreshSession(): Promise<SessionResponse> {
  // skipAuthRetry: this IS the refresh call — never chase its own tail.
  return apiRequest('/auth/refresh', { method: 'POST', skipAuthRetry: true });
}

export function logout(): Promise<void> {
  return apiRequest('/auth/logout', { method: 'POST', skipAuthRetry: true });
}

export function fetchMe(): Promise<AccessTokenPrincipal> {
  return apiRequest('/auth/me');
}
