import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { apiRequest, setAccessToken, setOnSessionExpired, setRefreshHandler } from '../api/client';
import { fetchStaffSession, type StaffSession } from '../api/admin-api';

export type StaffAuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface StaffAuthContextValue {
  status: StaffAuthStatus;
  session: StaffSession | null;
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** UX convenience only — the server re-checks every permission on every request. */
  can: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

const StaffAuthContext = createContext<StaffAuthContextValue | null>(null);

interface StaffLoginResponse {
  accessToken: string;
  principal: { principalType: 'STAFF' | 'CUSTOMER'; principalId: string };
}

/**
 * ONE BOOT REFRESH PER PAGE LOAD — and the bug it fixes.
 *
 * On load this provider asks POST /auth/refresh to turn the long-lived
 * httpOnly cookie back into a session. That call MUST happen exactly once per
 * page load, and before this it happened twice.
 *
 * WHY TWICE. main.tsx renders inside <React.StrictMode>, and React 18's
 * StrictMode deliberately mounts every component, runs its effects, unmounts
 * and mounts again — in development only — to surface effects that are not
 * safe to run twice. The boot effect below is exactly such an effect, and it
 * was not safe. Its `cancelled` flag stops a discarded mount APPLYING a
 * result; it does not abort the request that is already in flight.
 *
 * WHY THAT WAS FATAL RATHER THAN MERELY WASTEFUL. Refresh tokens ROTATE: each
 * call revokes the token it was given and issues a replacement in the same
 * family. Two calls firing together both present the SAME token. The first
 * rotates it. The second presents a token that is now revoked AND carries a
 * replaced_by_id — precisely the signature of a stolen, replayed token — so
 * TokenService does the right thing and revokes THE ENTIRE FAMILY
 * (REFRESH_TOKEN_REUSE_DETECTED). The replacement issued moments earlier is
 * revoked with it, and AuthController then clears the cookie on its way out,
 * so reloading cannot recover the session either.
 *
 * The staff session was therefore destroyed milliseconds after every page
 * load, and the 401 that followed read as an idle timeout. There is no idle
 * timer in this application.
 *
 * The theft detection is correct and is NOT weakened here. What is fixed is
 * the client racing itself: both mounts now await ONE promise, so one token is
 * presented once. The cache is module-level on purpose — a value inside the
 * component would be discarded by the very unmount that causes the problem.
 *
 * Not cleared afterwards, deliberately: a page load gets one boot refresh.
 * Every LATER refresh goes through runRefreshOnce() in api/client.ts, which
 * has always had this same single-flight guard for the 401-retry path.
 *
 * This mirrors refreshSessionOncePerPageLoad in customer-web's
 * AuthContext.tsx, where this bug was found and fixed first. The admin portal
 * was missed.
 */
let bootRefreshInFlight: Promise<StaffLoginResponse> | null = null;

function refreshOncePerPageLoad(): Promise<StaffLoginResponse> {
  bootRefreshInFlight ??= apiRequest<StaffLoginResponse>('/auth/refresh', {
    method: 'POST',
    skipAuthRetry: true,
  });
  return bootRefreshInFlight;
}

/**
 * Staff session for the admin application, on the EXISTING STEP 6
 * authentication. `POST /auth/staff/login` (username + password, plus
 * TOTP where the account requires it), the same rotating refresh-cookie
 * session, the same in-memory access token. No parallel authentication
 * system is introduced and no auth endpoint is added.
 *
 * The roles and permissions held here come from `GET /admin/session`,
 * which resolves them fresh from the database per request. They drive
 * navigation visibility only: `can()` decides what to render, never
 * what is allowed. Every guarded action is authorized again server-side,
 * so a staff member who edits the DOM or types a URL gains nothing.
 *
 * A CUSTOMER principal is explicitly refused here even if one somehow
 * authenticates: the staff console fails closed rather than rendering a
 * shell for a non-staff identity.
 */
export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StaffAuthStatus>('loading');
  const [session, setSession] = useState<StaffSession | null>(null);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setSession(null);
    setStatus('unauthenticated');
  }, []);

  const loadSession = useCallback(async (): Promise<boolean> => {
    try {
      const next = await fetchStaffSession();
      setSession(next);
      setStatus('authenticated');
      return true;
    } catch {
      clearSession();
      return false;
    }
  }, [clearSession]);

  useEffect(() => {
    setRefreshHandler(async () => {
      try {
        const refreshed = await apiRequest<StaffLoginResponse>('/auth/refresh', { method: 'POST', skipAuthRetry: true });
        if (refreshed.principal.principalType !== 'STAFF') {
          clearSession();
          return false;
        }
        setAccessToken(refreshed.accessToken);
        return true;
      } catch {
        return false;
      }
    });
    setOnSessionExpired(() => clearSession());
    return () => {
      setRefreshHandler(null);
      setOnSessionExpired(null);
    };
  }, [clearSession]);

  // One silent refresh on mount: the httpOnly cookie is the only thing
  // that can recover a session across a reload, since the access token
  // is deliberately memory-only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Not apiRequest directly: see refreshOncePerPageLoad. StrictMode runs
        // this effect twice, and two concurrent refreshes present the same
        // rotating token, which the server correctly reads as token theft and
        // answers by revoking the whole family.
        const refreshed = await refreshOncePerPageLoad();
        if (cancelled) return;
        if (refreshed.principal.principalType !== 'STAFF') {
          clearSession();
          return;
        }
        setAccessToken(refreshed.accessToken);
        await loadSession();
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (username: string, password: string, totpCode?: string) => {
      const result = await apiRequest<StaffLoginResponse>('/auth/staff/login', {
        method: 'POST',
        body: totpCode ? { username, password, totpCode } : { username, password },
        skipAuthRetry: true,
      });
      if (result.principal.principalType !== 'STAFF') {
        clearSession();
        throw new Error('This account is not a staff account.');
      }
      setAccessToken(result.accessToken);
      const ok = await loadSession();
      if (!ok) {
        throw new Error('Signed in, but your staff profile could not be loaded.');
      }
    },
    [clearSession, loadSession]
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>('/auth/logout', { method: 'POST', skipAuthRetry: true });
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<StaffAuthContextValue>(
    () => ({
      status,
      session,
      login,
      logout,
      can: (permission: string) => session?.permissions.includes(permission) ?? false,
      hasRole: (role: string) => session?.roles.includes(role) ?? false,
    }),
    [status, session, login, logout]
  );

  return <StaffAuthContext.Provider value={value}>{children}</StaffAuthContext.Provider>;
}

export function useStaffAuth(): StaffAuthContextValue {
  const ctx = useContext(StaffAuthContext);
  if (!ctx) throw new Error('useStaffAuth must be used within <StaffAuthProvider>');
  return ctx;
}
