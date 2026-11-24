import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SettingsPage } from './SettingsPage';
import { ApiError } from '../lib/api/client';
import type { PifSelfRegistrationStatus } from '../lib/api/admin-api';

/**
 * The Settings screen: the PIF self-registration switch.
 *
 * WHAT THESE TESTS ARE REALLY DEFENDING:
 *
 *   1. Nothing changes without a confirmation. This switch governs a
 *      PUBLIC endpoint, so a single mis-click must not open it.
 *   2. The screen never shows its own optimism. The status rendered is
 *      always the server's; there is no local "we think it is on now".
 *   3. A staff member without `shared.settings.write` is told so instead
 *      of being shown a control that would 403 — while the real
 *      enforcement stays on the server, which these tests cannot and
 *      should not stand in for.
 *   4. OFF explains WHY: never configured, or configured unreadably.
 */

const can = vi.fn();
const fetchPifSelfRegistration = vi.fn();
const setPifSelfRegistration = vi.fn();

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({
    status: 'authenticated',
    session: null,
    can: (permission: string) => can(permission) as boolean,
  }),
}));

vi.mock('../lib/api/admin-api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api/admin-api')>('../lib/api/admin-api');
  return {
    ...actual,
    fetchPifSelfRegistration: (...a: unknown[]) => fetchPifSelfRegistration(...a),
    setPifSelfRegistration: (...a: unknown[]) => setPifSelfRegistration(...a),
  };
});

const OFF_NEVER_SET: PifSelfRegistrationStatus = {
  enabled: false,
  neverSet: true,
  malformed: false,
  updatedAt: null,
  updatedByUserId: null,
  updatedByName: null,
};

const ON: PifSelfRegistrationStatus = {
  enabled: true,
  neverSet: false,
  malformed: false,
  updatedAt: '2026-11-14T11:30:00.000Z',
  updatedByUserId: '22222222-2222-7222-8222-222222222222',
  updatedByName: 'Facility Super Admin',
};

const OFF_EXPLICIT: PifSelfRegistrationStatus = { ...ON, enabled: false };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>
  );
}

function statusText(): string {
  return screen.getByTestId('pif-self-registration-status').textContent ?? '';
}

beforeEach(() => {
  can.mockReset().mockReturnValue(true);
  fetchPifSelfRegistration.mockReset().mockResolvedValue(OFF_NEVER_SET);
  setPifSelfRegistration.mockReset().mockResolvedValue(ON);
});

describe('SettingsPage — permission', () => {
  it('refuses the screen to a staff member without shared.settings.write', async () => {
    can.mockReturnValue(false);
    renderPage();

    expect(await screen.findByText(/shared\.settings\.write/i)).toBeInTheDocument();
    // Nothing is even requested: there is no control to render.
    expect(fetchPifSelfRegistration).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /turn on/i })).not.toBeInTheDocument();
  });

  it('asks for exactly that permission, not a near neighbour', async () => {
    renderPage();
    await waitFor(() => expect(can).toHaveBeenCalled());
    expect(can).toHaveBeenCalledWith('shared.settings.write');
  });
});

describe('SettingsPage — reading the current state', () => {
  it('shows a loading state before the setting arrives', () => {
    fetchPifSelfRegistration.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows OFF, and explains that it has never been configured', async () => {
    renderPage();
    expect(await screen.findByTestId('pif-self-registration-status')).toHaveTextContent('OFF');
    expect(screen.getByText(/never been changed/i)).toBeInTheDocument();
    expect(screen.getByText(/never changed/i)).toBeInTheDocument();
  });

  it('shows ON with who changed it', async () => {
    fetchPifSelfRegistration.mockResolvedValue(ON);
    renderPage();

    await waitFor(() => expect(statusText()).toContain('ON'));
    expect(screen.getByText(/Facility Super Admin/)).toBeInTheDocument();
  });

  it('EXPLAINS A MALFORMED VALUE instead of leaving OFF unexplained', async () => {
    fetchPifSelfRegistration.mockResolvedValue({ ...OFF_EXPLICIT, malformed: true });
    renderPage();

    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
    expect(statusText()).toContain('OFF');
  });

  it('surfaces a failed load with a retry rather than an empty screen', async () => {
    fetchPifSelfRegistration.mockRejectedValue(new ApiError(500, { code: 'X', message: 'boom' }));
    renderPage();
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });

  it('says plainly that RIK access is not included', async () => {
    renderPage();
    // The one sentence an administrator most needs before turning this on.
    expect(await screen.findByText(/RIK access stays with authorised officers only/i)).toBeInTheDocument();
  });
});

describe('SettingsPage — turning it ON requires a confirmation', () => {
  it('SENDS NOTHING on the first press — it asks first', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn on/i }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(setPifSelfRegistration).not.toHaveBeenCalled();
  });

  it('states what will happen, in the ON direction', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn on/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Turn ON new PIF customer registration\?/i);
    expect(dialog).toHaveTextContent(/create their own PIF account/i);
    expect(dialog).toHaveTextContent(/recorded against your account/i);
  });

  it('sends true only after the confirmation is accepted', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it on/i }));

    await waitFor(() => expect(setPifSelfRegistration).toHaveBeenCalledWith(true));
  });

  it('CANCEL SENDS NOTHING and leaves the state alone', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(setPifSelfRegistration).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(statusText()).toContain('OFF');
  });

  it('confirms success in words, and re-reads from the server', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(fetchPifSelfRegistration).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it on/i }));

    expect(await screen.findByText(/now ON/i)).toBeInTheDocument();
    // The screen does not trust its own optimism: it asks again.
    await waitFor(() => expect(fetchPifSelfRegistration).toHaveBeenCalledTimes(2));
  });
});

describe('SettingsPage — turning it OFF', () => {
  beforeEach(() => {
    fetchPifSelfRegistration.mockResolvedValue(ON);
    setPifSelfRegistration.mockResolvedValue(OFF_EXPLICIT);
  });

  it('offers Turn OFF when it is on, and not Turn ON', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /turn off/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^turn on$/i })).not.toBeInTheDocument();
  });

  it('REASSURES THAT EXISTING CUSTOMERS KEEP THEIR ACCOUNTS', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn off/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/keep it and can still sign in/i);
    expect(dialog).toHaveTextContent(/no existing account or data is changed/i);
  });

  it('sends false after confirmation and says so', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /turn off/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it off/i }));

    await waitFor(() => expect(setPifSelfRegistration).toHaveBeenCalledWith(false));
    expect(await screen.findByText(/now OFF/i)).toBeInTheDocument();
  });
});

describe('SettingsPage — when the write fails', () => {
  it('explains a 403 in terms of THIS setting, not RIK configuration', async () => {
    // ConfigUI's shared serverMessage() answers a 403 with "...permission to
    // change RIK configuration", which would be confidently wrong on a
    // shared-settings screen. This screen has its own mapper for that reason.
    const user = userEvent.setup();
    setPifSelfRegistration.mockRejectedValue(new ApiError(403, { code: 'FORBIDDEN', message: '' }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it on/i }));

    const shown = await screen.findByText(/no longer has permission to change this setting/i);
    expect(shown).toBeInTheDocument();
    expect(shown).toHaveTextContent(/Nothing was changed/i);
    expect(screen.queryByText(/RIK configuration/i)).not.toBeInTheDocument();
  });

  it("passes a 400 refusal through in the server's own words", async () => {
    const user = userEvent.setup();
    setPifSelfRegistration.mockRejectedValue(
      new ApiError(400, { code: 'VALIDATION_FAILED', message: 'enabled must be a boolean value.' })
    );
    renderPage();

    await user.click(await screen.findByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it on/i }));

    expect(await screen.findByText(/enabled must be a boolean value\./)).toBeInTheDocument();
  });

  it('DOES NOT CLAIM SUCCESS, and leaves the displayed status as the server last reported it', async () => {
    const user = userEvent.setup();
    setPifSelfRegistration.mockRejectedValue(new ApiError(500, { code: 'X', message: 'nope' }));
    renderPage();

    await user.click(await screen.findByRole('button', { name: /turn on/i }));
    await user.click(await screen.findByRole('button', { name: /yes, turn it on/i }));

    // A 500 body is not written for an administrator, so it is not shown;
    // what matters is that success is NOT claimed and the status does not move.
    await waitFor(() =>
      expect(screen.getByText(/could not be changed/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/nope/)).not.toBeInTheDocument();
    expect(screen.queryByText(/now ON/i)).not.toBeInTheDocument();
    expect(statusText()).toContain('OFF');
  });
});
