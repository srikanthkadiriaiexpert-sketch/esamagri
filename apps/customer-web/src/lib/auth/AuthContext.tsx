import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setAccessToken, setOnSessionExpired, setRefreshHandler } from '../api/client';
import {
  fetchMe,
  logout as apiLogout,
  refreshSession,
  registerCustomer,
  type RegistrationCredential,
  requestCustomerOtp,
  requestRegistrationOtp as apiRequestRegistrationOtp,
  verifyCustomerOtp,
  type AccessTokenPrincipal,
} from '../api/auth-api';
import { fetchMyProfile, rikModuleHidden } from '../api/customer-api';

/**
 * THE BOOT REFRESH, DE-DUPLICATED ACROSS MOUNTS — and the bug it fixes.
 *
 * On load the app asks /auth/refresh to turn the long-lived cookie back
 * into a session. That call MUST happen exactly once per page load, and
 * before this it could happen twice.
 *
 * WHY TWICE. main.tsx renders inside <React.StrictMode>, and React 18's
 * StrictMode deliberately mounts every component, runs its effects,
 * unmounts and mounts again — in development only — to surface effects
 * that are not safe to run twice. The boot effect below is exactly such
 * an effect, and it was not safe.
 *
 * WHY THAT WAS FATAL RATHER THAN MERELY WASTEFUL. Refresh tokens ROTATE:
 * each call revokes the token it was given and issues a replacement in
 * the same family. Two calls firing together both present the SAME
 * token. The first rotates it. The second presents a token that is now
 * revoked AND carries a replaced_by_id — which is precisely the
 * signature of a stolen, replayed token, so TokenService does the right
 * thing and revokes THE ENTIRE FAMILY (REFRESH_TOKEN_REUSE_DETECTED).
 *
 * The session is then gone, server-side, seconds after the page opened.
 * The symptom is a 401 from /auth/refresh and an apparently random
 * sign-out shortly after loading — which reads as an idle timeout, and
 * is not one. There is no idle timer in this application.
 *
 * The theft detection is correct and is NOT weakened here. What is fixed
 * is the client racing itself: both mounts now await ONE promise, so one
 * token is presented once. The cache is module-level on purpose — a
 * value inside the component would be discarded by the very unmount that
 * causes the problem.
 *
 * Not cleared afterwards, deliberately: a page load gets one boot
 * refresh. Every LATER refresh goes through runRefreshOnce() in
 * api/client.ts, which has always had this same single-flight guard for
 * the 401-retry path — this brings the boot path up to it.
 */
let bootRefreshInFlight: ReturnType<typeof refreshSession> | null = null;

function refreshSessionOncePerPageLoad(): ReturnType<typeof refreshSession> {
  bootRefreshInFlight ??= refreshSession();
  return bootRefreshInFlight;
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface RegistrationDetails {
  name: string;
  quarterBlock: string;
  quarterNumber: string;
}

interface AuthContextValue {
  status: AuthStatus;
  principal: AccessTokenPrincipal | null;
  /**
   * Whether this customer may use RIK: true, false, or null while unknown.
   *
   * null is a real state, not a placeholder — the profile load is deliberately
   * non-blocking, so the app renders before the answer arrives. Treat null as
   * "not yet known" and NOT as "no": see `rikModuleHidden`, which hides the
   * module only on an explicit false.
   *
   * This never grants anything. Every RIK endpoint is refused independently by
   * the server.
   */
  rikAuthorised: boolean | null;
  /** Step 1 of customer login — sends the OTP, no session yet. */
  requestOtp: (mobileNumber: string) => Promise<void>;
  /** Step 2 — verifying establishes the real session (STEP 6 endpoints only). */
  verifyOtp: (mobileNumber: string, code: string) => Promise<void>;
  /** Step 1 of PIF self-registration — sends the code, no account yet. */
  requestRegistrationOtp: (mobileNumber: string) => Promise<void>;
  /**
   * Step 2 — creates the account and establishes the session. One account and
   * one login: this returns the SAME kind of session verifyOtp does, and a
   * number that already has an account is signed in rather than duplicated.
   */
  register: (
    credential: RegistrationCredential,
    details: RegistrationDetails
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Owns the customer auth session end-to-end against the real STEP 6
 * backend. On mount, attempts one silent /auth/refresh (the httpOnly
 * refresh cookie is the only thing that can recover a session across
 * a page reload — the access token itself lives only in memory, see
 * lib/api/client.ts). No route in this app assumes a session exists
 * before this has resolved past 'loading'.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [principal, setPrincipal] = useState<AccessTokenPrincipal | null>(null);
  const [rikAuthorised, setRikAuthorised] = useState<boolean | null>(null);
  const principalRef = useRef(principal);
  principalRef.current = principal;

  const applySession = useCallback((token: string, nextPrincipal: AccessTokenPrincipal) => {
    setAccessToken(token);
    setPrincipal(nextPrincipal);
    setStatus('authenticated');
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setPrincipal(null);
    setRikAuthorised(null);
    setStatus('unauthenticated');
  }, []);

  /**
   * Asks the server whether this customer may use RIK.
   *
   * Deliberately NON-BLOCKING and deliberately silent on failure. `status`
   * never waits on it, so a slow or failing profile call cannot keep the app
   * on a spinner, and a failure leaves the answer at null — which shows RIK
   * rather than hiding it from someone entitled to it. The server refuses any
   * request that should not succeed, so an optimistic null costs nothing worse
   * than a 403 the user never sees.
   */
  const loadRikAccess = useCallback(async () => {
    try {
      const profile = await fetchMyProfile();
      setRikAuthorised(rikModuleHidden(profile) ? false : (profile.rikAuthorised ?? null));
    } catch {
      setRikAuthorised(null);
    }
  }, []);

  useEffect(() => {
    setRefreshHandler(async () => {
      try {
        const session = await refreshSession();
        applySession(session.accessToken, session.principal);
        return true;
      } catch {
        return false;
      }
    });
    setOnSessionExpired(() => {
      clearSession();
    });
    return () => {
      setRefreshHandler(null);
      setOnSessionExpired(null);
    };
  }, [applySession, clearSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Not refreshSession() directly: see refreshSessionOncePerPageLoad.
        // StrictMode runs this effect twice, and two concurrent refreshes
        // present the same rotating token, which the server correctly
        // reads as token theft and answers by revoking the whole family.
        const session = await refreshSessionOncePerPageLoad();
        if (cancelled) return;
        applySession(session.accessToken, session.principal);
      } catch {
        if (cancelled) return;
        clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve RIK access whenever a session appears, and only then: an
  // unauthenticated visitor has nothing to resolve.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void loadRikAccess();
  }, [status, principal?.principalId, loadRikAccess]);

  const requestOtp = useCallback(async (mobileNumber: string) => {
    await requestCustomerOtp(mobileNumber);
  }, []);

  const requestRegistrationOtp = useCallback(async (mobileNumber: string) => {
    await apiRequestRegistrationOtp(mobileNumber);
  }, []);

  const register = useCallback(
    async (credential: RegistrationCredential, details: RegistrationDetails) => {
      // The credential is passed straight through. This layer deliberately
      // does not inspect, repackage or supplement it: a registration ticket
      // must reach the server exactly as it was minted, and adding a mobile
      // number beside one is refused by the API on purpose.
      const session = await registerCustomer(credential, details);
      applySession(session.accessToken, session.principal);
    },
    [applySession]
  );

  const verifyOtp = useCallback(
    async (mobileNumber: string, code: string) => {
      const session = await verifyCustomerOtp(mobileNumber, code);
      applySession(session.accessToken, session.principal);
      // Confirms the freshly-issued token actually authenticates against
      // the real guarded /auth/me route rather than trusting the login
      // response alone — cheap end-to-end proof, not required by STEP 6.
      try {
        await fetchMe();
      } catch {
        /* non-fatal — session is already applied from the verify response */
      }
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      principal,
      rikAuthorised,
      requestOtp,
      verifyOtp,
      requestRegistrationOtp,
      register,
      logout,
    }),
    [
      status,
      principal,
      rikAuthorised,
      requestOtp,
      verifyOtp,
      requestRegistrationOtp,
      register,
      logout,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}

/**
 * Whether to offer the RIK module — readable WITHOUT an <AuthProvider>.
 *
 * WHY THIS EXISTS AND useAuth DOES NOT CHANGE. `useAuth` throwing outside a
 * provider is correct and stays: a component that signs someone in or out with
 * no session to act on is a bug, and a silent no-op would hide it.
 *
 * This question is different. It has a safe, meaningful answer when there is
 * no provider — "not known" — and `rikModuleHidden` already treats not-known
 * as "show RIK", for the reason set out there: hiding the module from an
 * approved officer fails silently, while offering it to a PIF-only resident
 * fails visibly and harmlessly. Returning null here is that same documented
 * default, not a weakening of a safety check.
 *
 * It also keeps a presentation concern from dragging a provider requirement
 * into screens that have no other need for one. HomePage is rendered directly
 * by its own tests, and AppLayout by the PIF shop tests, both deliberately
 * without an auth session — see those files' own comments. A screen should not
 * have to construct a login just to decide whether to draw a card.
 *
 * It grants nothing. Every RIK endpoint is refused independently by the server.
 */
export function useRikVisibility(): boolean | null {
  const ctx = useContext(AuthContext);
  return ctx === null ? null : ctx.rikAuthorised;
}
