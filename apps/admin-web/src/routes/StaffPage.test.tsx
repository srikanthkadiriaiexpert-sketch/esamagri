import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffPage } from './StaffPage';
import type { StaffSession } from '../lib/api/admin-api';
import type { RoleSummary, StaffAccount, StaffListResponse } from '../lib/api/staff-api';
import { ApiError } from '../lib/api/client';
import { rikAdmin, superAdmin, pifCashier } from '../test/staff-session';

/**
 * Staff Management, as a Super Admin actually uses it.
 *
 * The API module is mocked and the auth context is mocked — everything else is
 * the real component. So these tests say what a staff member sees and which
 * request each control sends, which is the part a screen can get wrong on its
 * own. Whether the SERVER then allows it is a different question, answered by
 * the role x route matrix and staff.integration.spec.ts in apps/api against a
 * real database; nothing here could prove that, and nothing here pretends to.
 */

let current: StaffSession | null = null;

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({
    status: 'authenticated',
    session: current,
    login: vi.fn(),
    logout: vi.fn(),
    can: (p: string) => current?.permissions.includes(p) ?? false,
    hasRole: (r: string) => current?.roles.includes(r) ?? false,
  }),
}));

const api = {
  fetchStaff: vi.fn(),
  fetchStaffRoles: vi.fn(),
  createStaff: vi.fn(),
  updateStaff: vi.fn(),
  setStaffStatus: vi.fn(),
  assignStaffRole: vi.fn(),
  revokeStaffRole: vi.fn(),
  resetStaffPassword: vi.fn(),
};

vi.mock('../lib/api/staff-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api/staff-api')>();
  return {
    ...actual,
    fetchStaff: (...a: unknown[]) => api.fetchStaff(...a),
    fetchStaffRoles: (...a: unknown[]) => api.fetchStaffRoles(...a),
    createStaff: (...a: unknown[]) => api.createStaff(...a),
    updateStaff: (...a: unknown[]) => api.updateStaff(...a),
    setStaffStatus: (...a: unknown[]) => api.setStaffStatus(...a),
    assignStaffRole: (...a: unknown[]) => api.assignStaffRole(...a),
    revokeStaffRole: (...a: unknown[]) => api.revokeStaffRole(...a),
    resetStaffPassword: (...a: unknown[]) => api.resetStaffPassword(...a),
  };
});

function account(over: Partial<StaffAccount> = {}): StaffAccount {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    username: 'a.kumar',
    displayName: 'A Kumar',
    status: 'ACTIVE',
    roles: ['RIK_ADMIN'],
    totpEnabled: false,
    lastLoginAt: '2026-11-09T06:00:00.000Z',
    createdAt: '2026-11-01T06:00:00.000Z',
    updatedAt: '2026-11-01T06:00:00.000Z',
    ...over,
  };
}

/** The six roles the approved seed actually holds. Note: no RIK_STAFF. */
const SEEDED_ROLES: RoleSummary[] = [
  { name: 'SUPER_ADMIN', description: 'Shared-scope super-administrator.', permissions: ['shared.user.manage', 'shared.role.grant'] },
  { name: 'RIK_ADMIN', description: 'RIK-scope administrator.', permissions: ['rik.order.manage'] },
  { name: 'PIF_ADMIN', description: 'PIF-scope administrator.', permissions: ['pif.order.manage'] },
  { name: 'PIF_CASHIER', description: 'PIF counter cashier.', permissions: ['pif.order.prepare'] },
  { name: 'RIK_PICKUP_STAFF', description: 'Narrow, counter-facing RIK pickup role.', permissions: ['rik.order.mark_collected', 'rik.order.mark_ready'] },
  { name: 'DELIVERY_STAFF', description: 'PIF delivery role.', permissions: ['pif.order.mark_delivered', 'pif.order.mark_not_delivered'] },
];

function list(items: StaffAccount[], total = items.length): StaffListResponse {
  return { items, total, limit: 100, offset: 0 };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  current = superAdmin();
  api.fetchStaff.mockResolvedValue(list([account()]));
  api.fetchStaffRoles.mockResolvedValue({ roles: SEEDED_ROLES });
});

describe('StaffPage — who may see it', () => {
  it('shows the screen to a Super Admin', async () => {
    render(<StaffPage />);
    expect(await screen.findByRole('heading', { name: /staff management/i })).toBeInTheDocument();
    expect(await screen.findByLabelText(/^username$/i)).toBeInTheDocument();
  });

  it('refuses a RIK_ADMIN, and asks the server for nothing', async () => {
    current = rikAdmin();
    render(<StaffPage />);
    expect(await screen.findByText(/reserved to super admin/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
    expect(api.fetchStaff).not.toHaveBeenCalled();
  });

  it('refuses a PIF_CASHIER too', async () => {
    current = pifCashier();
    render(<StaffPage />);
    expect(await screen.findByText(/reserved to super admin/i)).toBeInTheDocument();
    expect(api.fetchStaff).not.toHaveBeenCalled();
  });

  it('keeps the heading visible when refusing, so the page is not a blank', async () => {
    current = rikAdmin();
    render(<StaffPage />);
    expect(await screen.findByRole('heading', { name: /staff management/i })).toBeInTheDocument();
  });
});

describe('StaffPage — the list', () => {
  it('renders exactly what the server returned', async () => {
    api.fetchStaff.mockResolvedValue(
      list([account(), account({ id: 'x', username: 'b.rao', displayName: 'B Rao', status: 'SUSPENDED', roles: [] })])
    );
    render(<StaffPage />);

    const kumar = await screen.findByTestId('staff-row-a.kumar');
    expect(within(kumar).getByText('A Kumar')).toBeInTheDocument();
    expect(within(kumar).getByText('RIK_ADMIN')).toBeInTheDocument();
    expect(within(kumar).getByText('ACTIVE')).toBeInTheDocument();

    const rao = screen.getByTestId('staff-row-b.rao');
    expect(within(rao).getByText('SUSPENDED')).toBeInTheDocument();
    expect(within(rao).getByText(/no role/i)).toBeInTheDocument();
  });

  it('never puts a password hash or a TOTP secret on screen', async () => {
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');
    const dom = document.body.textContent ?? '';
    expect(dom).not.toMatch(/\$2[aby]\$/); // a bcrypt hash prefix
    expect(dom).not.toMatch(/password_hash|passwordHash|totp_secret|totpSecret/i);
  });

  it('says so honestly when nothing matches', async () => {
    api.fetchStaff.mockResolvedValue(list([]));
    render(<StaffPage />);
    expect(await screen.findByText(/no staff accounts match/i)).toBeInTheDocument();
  });

  it('shows a refusal rather than an empty table when the list is forbidden', async () => {
    api.fetchStaff.mockRejectedValue(
      new ApiError(403, { code: 'FORBIDDEN', message: 'You may not do that.', correlationId: 'c1' })
    );
    render(<StaffPage />);
    // The portal's shared FailureState answers a forbidden READ with its
    // standard unauthorized panel. What must never happen is a table that
    // looks empty, as though there were simply no staff.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('staff-row-a.kumar')).not.toBeInTheDocument();
  });

  it('shows the server failure for an unexpected error', async () => {
    api.fetchStaff.mockRejectedValue(
      new ApiError(500, { code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'c9' })
    );
    render(<StaffPage />);
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });

  it('sends the search text, the role filter and the status filter to the server', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    await user.type(screen.getByLabelText(/search staff by name or username/i), 'kumar');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(api.fetchStaff).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'kumar' }));

    await user.selectOptions(screen.getByLabelText(/filter by role/i), 'PIF_CASHIER');
    expect(api.fetchStaff).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'PIF_CASHIER' }));

    await user.selectOptions(screen.getByLabelText(/filter by status/i), 'SUSPENDED');
    expect(api.fetchStaff).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'SUSPENDED' }));
  });
});

describe('StaffPage — roles come from the database', () => {
  it('offers exactly the seeded roles, and no RIK_STAFF', async () => {
    render(<StaffPage />);
    const form = await screen.findByRole('form', { name: /create a staff account/i });
    const select = within(form).getByLabelText(/^role$/i);
    const offered = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');

    expect(offered).toEqual([
      'SUPER_ADMIN',
      'RIK_ADMIN',
      'PIF_ADMIN',
      'PIF_CASHIER',
      'RIK_PICKUP_STAFF',
      'DELIVERY_STAFF',
    ]);
    expect(offered).not.toContain('RIK_STAFF');
  });

  it('shows what each role confers, so DELIVERY_STAFF is not assigned blind', async () => {
    render(<StaffPage />);
    expect(await screen.findByText(/what each role can do \(6 roles\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/pif\.order\.mark_delivered · pif\.order\.mark_not_delivered/)
    ).toBeInTheDocument();
  });
});

describe('StaffPage — creating an account', () => {
  it('posts the details and confirms with the username', async () => {
    const user = userEvent.setup();
    api.createStaff.mockResolvedValue(account({ username: 'c.menon', displayName: 'C Menon' }));
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    const form = screen.getByRole('form', { name: /create a staff account/i });
    await user.type(screen.getByLabelText(/^full name$/i), 'C Menon');
    await user.type(screen.getByLabelText(/^username$/i), 'c.menon');
    await user.type(screen.getByLabelText(/^initial password$/i), 'Monsoon#Harbour47');
    await user.selectOptions(within(form).getByLabelText(/^role$/i), 'RIK_PICKUP_STAFF');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(api.createStaff).toHaveBeenCalledWith({
      displayName: 'C Menon',
      username: 'c.menon',
      password: 'Monsoon#Harbour47',
      role: 'RIK_PICKUP_STAFF',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/c\.menon created/i);
  });

  it('omits the role entirely when none is chosen, rather than sending an empty one', async () => {
    const user = userEvent.setup();
    api.createStaff.mockResolvedValue(account({ username: 'd.singh' }));
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    await user.type(screen.getByLabelText(/^full name$/i), 'D Singh');
    await user.type(screen.getByLabelText(/^username$/i), 'd.singh');
    await user.type(screen.getByLabelText(/^initial password$/i), 'Monsoon#Harbour47');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(api.createStaff).toHaveBeenCalledWith(
      expect.objectContaining({ role: undefined })
    );
  });

  it('will not submit a password that fails the policy, and says which rule', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    await user.type(screen.getByLabelText(/^full name$/i), 'C Menon');
    await user.type(screen.getByLabelText(/^username$/i), 'c.menon');
    await user.type(screen.getByLabelText(/^initial password$/i), 'short1!A');

    expect(screen.getByText(/use at least 12 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
    expect(api.createStaff).not.toHaveBeenCalled();
  });

  it('refuses a password containing the username before the server has to', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    await user.type(screen.getByLabelText(/^full name$/i), 'C Menon');
    await user.type(screen.getByLabelText(/^username$/i), 'c.menon');
    await user.type(screen.getByLabelText(/^initial password$/i), 'C.Menon#2026ab');

    expect(screen.getByTestId('password-problem')).toHaveTextContent(/must not contain the username/i);
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  it('shows the server message when the username is taken', async () => {
    const user = userEvent.setup();
    api.createStaff.mockRejectedValue(
      new ApiError(409, {
        code: 'VALIDATION_FAILED',
        message: 'That username is already in use.',
        correlationId: 'c2',
      })
    );
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');

    await user.type(screen.getByLabelText(/^full name$/i), 'A Kumar');
    await user.type(screen.getByLabelText(/^username$/i), 'a.kumar');
    await user.type(screen.getByLabelText(/^initial password$/i), 'Monsoon#Harbour47');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already in use/i);
  });
});

describe('StaffPage — managing an account', () => {
  async function openPanel() {
    const user = userEvent.setup();
    render(<StaffPage />);
    const row = await screen.findByTestId('staff-row-a.kumar');
    await user.click(within(row).getByRole('button', { name: /manage/i }));
    return user;
  }

  it('suspends an account with a reason, and says the sessions ended', async () => {
    const user = await openPanel();
    api.setStaffStatus.mockResolvedValue(account({ status: 'SUSPENDED' }));

    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Left the facility');
    await user.click(screen.getByRole('button', { name: /^suspend$/i }));

    expect(api.setStaffStatus).toHaveBeenCalledWith('11111111-1111-7111-8111-111111111111', {
      status: 'SUSPENDED',
      reason: 'Left the facility',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/suspended.*sessions were ended/i);
  });

  it('will not suspend without a reason', async () => {
    const user = await openPanel();
    expect(screen.getByRole('button', { name: /^suspend$/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Left');
    expect(screen.getByRole('button', { name: /^suspend$/i })).toBeDisabled(); // under 5 chars
    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'the facility');
    expect(screen.getByRole('button', { name: /^suspend$/i })).toBeEnabled();
  });

  it('offers Reactivate for a suspended account instead of Suspend', async () => {
    api.fetchStaff.mockResolvedValue(list([account({ status: 'SUSPENDED' })]));
    const user = await openPanel();
    api.setStaffStatus.mockResolvedValue(account({ status: 'ACTIVE' }));

    expect(screen.queryByRole('button', { name: /^suspend$/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Returned from leave');
    await user.click(screen.getByRole('button', { name: /^reactivate$/i }));

    expect(api.setStaffStatus).toHaveBeenCalledWith(expect.any(String), {
      status: 'ACTIVE',
      reason: 'Returned from leave',
    });
  });

  it('surfaces the last-active-Super-Admin refusal verbatim', async () => {
    const user = await openPanel();
    api.setStaffStatus.mockRejectedValue(
      new ApiError(403, {
        code: 'FORBIDDEN',
        message:
          'This is the only active Super Admin account. If it were suspended, nobody could manage staff or grant roles. Give another account the Super Admin role first.',
        correlationId: 'c3',
      })
    );

    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Tidying the list');
    await user.click(screen.getByRole('button', { name: /^suspend$/i }));

    // The whole reason this screen does not use ConfigUI's serverMessage: that
    // helper answers any 403 with a sentence about RIK configuration
    // permissions, which would replace this explanation with something both
    // wrong and useless.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/only active super admin/i);
    expect(alert).toHaveTextContent(/give another account the super admin role first/i);
    expect(alert.textContent ?? '').not.toMatch(/rik configuration/i);
  });

  it('grants a role and offers only roles the account does not already hold', async () => {
    const user = await openPanel();
    api.assignStaffRole.mockResolvedValue(account({ roles: ['RIK_ADMIN', 'PIF_CASHIER'] }));

    const select = screen.getByLabelText(/role to add for a\.kumar/i);
    const offered = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== '');
    expect(offered).not.toContain('RIK_ADMIN'); // already held
    expect(offered).toContain('PIF_CASHIER');

    await user.selectOptions(select, 'PIF_CASHIER');
    await user.click(screen.getByRole('button', { name: /grant role/i }));
    expect(api.assignStaffRole).toHaveBeenCalledWith('11111111-1111-7111-8111-111111111111', 'PIF_CASHIER');
  });

  it('revokes a held role', async () => {
    const user = await openPanel();
    api.revokeStaffRole.mockResolvedValue(account({ roles: [] }));
    await user.click(screen.getByRole('button', { name: /remove rik_admin/i }));
    expect(api.revokeStaffRole).toHaveBeenCalledWith('11111111-1111-7111-8111-111111111111', 'RIK_ADMIN');
  });

  it('renames an account but keeps the username untouched', async () => {
    const user = await openPanel();
    api.updateStaff.mockResolvedValue(account({ displayName: 'A Kumar Nair' }));

    const field = screen.getByLabelText(/full name for a\.kumar/i);
    await user.clear(field);
    await user.type(field, 'A Kumar Nair');
    await user.click(screen.getByRole('button', { name: /save name/i }));

    expect(api.updateStaff).toHaveBeenCalledWith('11111111-1111-7111-8111-111111111111', {
      displayName: 'A Kumar Nair',
    });
    // There is no control for changing a username.
    expect(screen.queryByLabelText(/new username/i)).not.toBeInTheDocument();
  });

  it('resets a password and never echoes it back', async () => {
    const user = await openPanel();
    api.resetStaffPassword.mockResolvedValue({
      userId: '11111111-1111-7111-8111-111111111111',
      revokedSessions: 2,
    });

    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Forgotten password');
    await user.type(screen.getByLabelText(/new password for a\.kumar/i), 'Monsoon#Harbour47');
    await user.click(screen.getByRole('button', { name: /reset password/i }));

    expect(api.resetStaffPassword).toHaveBeenCalledWith('11111111-1111-7111-8111-111111111111', {
      newPassword: 'Monsoon#Harbour47',
      reason: 'Forgotten password',
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/2 session\(s\) ended/i);
    expect(status.textContent ?? '').not.toContain('Monsoon#Harbour47');
    expect(document.body.textContent ?? '').not.toContain('Monsoon#Harbour47');
  });

  it('applies the password policy to a reset as well as to creation', async () => {
    const user = await openPanel();
    await user.type(screen.getByLabelText(/reason for changing a\.kumar/i), 'Forgotten password');
    await user.type(screen.getByLabelText(/new password for a\.kumar/i), 'A.Kumar#2026xy');

    expect(screen.getByTestId('password-problem')).toHaveTextContent(/must not contain the username/i);
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
    expect(api.resetStaffPassword).not.toHaveBeenCalled();
  });

  it('will not reset a password without a reason for the audit log', async () => {
    const user = await openPanel();
    await user.type(screen.getByLabelText(/new password for a\.kumar/i), 'Monsoon#Harbour47');
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled();
  });
});

describe('StaffPage — kept distinct from ration officers', () => {
  it('says in the open that officers are managed elsewhere', async () => {
    render(<StaffPage />);
    expect(await screen.findByText(/ration officers are managed separately/i)).toBeInTheDocument();
  });

  it('never calls an officer endpoint', async () => {
    render(<StaffPage />);
    await screen.findByTestId('staff-row-a.kumar');
    for (const call of api.fetchStaff.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/officer/i);
    }
  });
});
