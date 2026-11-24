import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE BUG THIS FILE EXISTS FOR.
 *
 * main.tsx renders the app inside <React.StrictMode>. In development
 * React 18 mounts, runs effects, unmounts and mounts again on purpose.
 * AuthProvider's boot effect calls /auth/refresh — so it ran twice, with
 * the same refresh token.
 *
 * Refresh tokens rotate. The first call revokes the presented token; the
 * second presents one that is already revoked and replaced, which is the
 * exact signature of a replayed stolen token, so the server revokes the
 * WHOLE session family. The session died seconds after every page load,
 * and the 401 that followed looked like an idle timeout.
 *
 * These tests fail against the old code and pass against the fix. The
 * first one is the regression test; the second proves the theft
 * detection it protects is still intact client-side (a genuine later
 * refresh is still possible); the third proves a failed boot still signs
 * the user out rather than hanging on a spinner.
 */

const refreshSession = vi.fn();

vi.mock('../api/auth-api', () => ({
  refreshSession: (...args: unknown[]) => refreshSession(...args),
  fetchMe: vi.fn().mockResolvedValue({ principalType: 'CUSTOMER', principalId: 'c1' }),
  logout: vi.fn().mockResolvedValue(undefined),
  registerCustomer: vi.fn(),
  requestCustomerOtp: vi.fn(),
  requestRegistrationOtp: vi.fn(),
  verifyCustomerOtp: vi.fn(),
}));

vi.mock('../api/customer-api', () => ({
  fetchMyProfile: vi.fn().mockResolvedValue({ rikAuthorised: true }),
  rikModuleHidden: () => false,
}));

vi.mock('../api/client', () => ({
  setAccessToken: vi.fn(),
  setOnSessionExpired: vi.fn(),
  setRefreshHandler: vi.fn(),
}));

const SESSION = {
  accessToken: 'test-access-token',
  principal: { principalType: 'CUSTOMER' as const, principalId: 'c1' },
};

/** Imported fresh each time, so the module-level guard starts empty. */
async function loadProvider() {
  vi.resetModules();
  const mod = await import('./AuthContext');
  return mod;
}

function Probe({ useAuth }: { useAuth: () => { status: string } }) {
  const { status } = useAuth();
  return <span data-testid="status">{status}</span>;
}

beforeEach(() => {
  refreshSession.mockReset();
});

describe('the boot refresh under StrictMode', () => {
  it('asks the server to restore the session EXACTLY ONCE, not twice', async () => {
    refreshSession.mockResolvedValue(SESSION);
    const { AuthProvider, useAuth } = await loadProvider();

    render(
      <React.StrictMode>
        <AuthProvider>
          <Probe useAuth={useAuth} />
        </AuthProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));

    // THE ASSERTION. Two calls here means two rotations of one token,
    // which the server reads as theft and answers by revoking the family.
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('still signs in, so the de-duplication did not break the restore', async () => {
    refreshSession.mockResolvedValue(SESSION);
    const { AuthProvider, useAuth } = await loadProvider();

    render(
      <React.StrictMode>
        <AuthProvider>
          <Probe useAuth={useAuth} />
        </AuthProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticated'));
  });

  it('signs the visitor out when there is no session to restore', async () => {
    refreshSession.mockRejectedValue(new Error('401'));
    const { AuthProvider, useAuth } = await loadProvider();

    render(
      <React.StrictMode>
        <AuthProvider>
          <Probe useAuth={useAuth} />
        </AuthProvider>
      </React.StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated'));
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });
});
