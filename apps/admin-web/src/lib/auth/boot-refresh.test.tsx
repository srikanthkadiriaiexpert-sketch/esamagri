import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { superAdmin } from '../../test/staff-session';

/**
 * THE BUG THIS FILE EXISTS FOR.
 *
 * main.tsx renders the admin portal inside <React.StrictMode>. In development
 * React 18 mounts, runs effects, unmounts and mounts again on purpose.
 * StaffAuthProvider's boot effect calls POST /auth/refresh — so it ran twice,
 * with the same refresh token.
 *
 * Refresh tokens rotate. The first call revokes the presented token; the
 * second presents one that is already revoked AND replaced, which is the exact
 * signature of a replayed stolen token, so the API revokes the WHOLE session
 * family and then clears the cookie on its way out. The staff session died
 * milliseconds after every page load, and the 401 that followed looked like an
 * idle timeout. There is no idle timer in this application.
 *
 * The fix is refreshOncePerPageLoad() in StaffAuthContext.tsx — the same
 * module-level single-flight guard customer-web has had since this bug was
 * found there. These tests fail against the old code and pass against the fix.
 *
 * This is the first admin test that mounts the REAL StaffAuthProvider; every
 * other one replaces the module with vi.mock. So the network boundary is
 * mocked here, and nothing else is.
 */

const apiRequest = vi.fn();
const setAccessToken = vi.fn();
const fetchStaffSession = vi.fn();

// The indirection is deliberate: vi.mock factories are hoisted above these
// const declarations, so the factory must reach the spy lazily at call time
// rather than capturing it at definition time.
vi.mock('../api/client', () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  setAccessToken: (...args: unknown[]) => setAccessToken(...args),
  setRefreshHandler: vi.fn(),
  setOnSessionExpired: vi.fn(),
}));

vi.mock('../api/admin-api', () => ({
  fetchStaffSession: (...args: unknown[]) => fetchStaffSession(...args),
}));

const STAFF_REFRESH = {
  accessToken: 'test-access-token',
  principal: { principalType: 'STAFF' as const, principalId: 'staff-1' },
};

const CUSTOMER_REFRESH = {
  accessToken: 'customer-access-token',
  principal: { principalType: 'CUSTOMER' as const, principalId: 'cust-1' },
};

/** Imported fresh each time, so the module-level guard starts empty. */
async function loadProvider() {
  vi.resetModules();
  return import('./StaffAuthContext');
}

function Probe({ useStaffAuth }: { useStaffAuth: () => { status: string } }) {
  const { status } = useStaffAuth();
  return <span data-testid="status">{status}</span>;
}

async function renderProvider() {
  const { StaffAuthProvider, useStaffAuth } = await loadProvider();
  render(
    <React.StrictMode>
      <StaffAuthProvider>
        <Probe useStaffAuth={useStaffAuth} />
      </StaffAuthProvider>
    </React.StrictMode>
  );
  return { useStaffAuth };
}

const statusText = () => screen.getByTestId('status').textContent;

const refreshCalls = () => apiRequest.mock.calls.filter(([path]) => path === '/auth/refresh');

beforeEach(() => {
  apiRequest.mockReset();
  setAccessToken.mockReset();
  fetchStaffSession.mockReset();
  fetchStaffSession.mockResolvedValue(superAdmin());
});

describe('the boot refresh under StrictMode', () => {
  it('asks the server to restore the session EXACTLY ONCE, not twice', async () => {
    apiRequest.mockResolvedValue(STAFF_REFRESH);

    await renderProvider();
    await waitFor(() => expect(statusText()).toBe('authenticated'));

    // THE ASSERTION. Two calls here means two rotations of one token, which
    // the server reads as theft and answers by revoking the family.
    expect(refreshCalls()).toHaveLength(1);
  });

  it('still restores the session, so the de-duplication did not break the boot', async () => {
    apiRequest.mockResolvedValue(STAFF_REFRESH);

    await renderProvider();
    await waitFor(() => expect(statusText()).toBe('authenticated'));

    // The second half of the boot must still run: the access token is applied
    // and the staff profile is loaded. A guard that returned a cached promise
    // but skipped these would look fixed and sign nobody in.
    expect(setAccessToken).toHaveBeenCalledWith(STAFF_REFRESH.accessToken);
    expect(fetchStaffSession).toHaveBeenCalled();
  });

  it('sends the boot refresh as a POST that cannot trigger the 401 retry', async () => {
    // skipAuthRetry is what stops a failing refresh chasing its own tail: a 401
    // from /auth/refresh must not provoke another refresh.
    apiRequest.mockResolvedValue(STAFF_REFRESH);

    await renderProvider();
    await waitFor(() => expect(statusText()).toBe('authenticated'));

    const [path, options] = refreshCalls()[0]!;
    expect(path).toBe('/auth/refresh');
    expect(options).toMatchObject({ method: 'POST', skipAuthRetry: true });
  });

  it('signs the visitor out when there is no session to restore', async () => {
    apiRequest.mockRejectedValue(new Error('401'));

    await renderProvider();

    // Must reach a decision, not sit on the spinner for ever.
    await waitFor(() => expect(statusText()).toBe('unauthenticated'));
    expect(refreshCalls()).toHaveLength(1);
  });

  it('refuses a CUSTOMER principal and does not apply its token', async () => {
    // The staff console fails closed rather than rendering a shell for a
    // non-staff identity, and must not adopt that identity's access token.
    apiRequest.mockResolvedValue(CUSTOMER_REFRESH);

    await renderProvider();

    await waitFor(() => expect(statusText()).toBe('unauthenticated'));
    expect(setAccessToken).not.toHaveBeenCalledWith(CUSTOMER_REFRESH.accessToken);
    expect(fetchStaffSession).not.toHaveBeenCalled();
  });

  it('signs the visitor out when the refresh succeeds but the profile will not load', async () => {
    // A session that cannot resolve its roles must not render the console with
    // no permissions — it has to fail closed, not render an empty shell.
    apiRequest.mockResolvedValue(STAFF_REFRESH);
    fetchStaffSession.mockRejectedValue(new Error('500'));

    await renderProvider();

    await waitFor(() => expect(statusText()).toBe('unauthenticated'));
  });
});
