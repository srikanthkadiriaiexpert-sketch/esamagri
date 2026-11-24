import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AccountPage } from './AccountPage';
import type { StaffSession } from '../lib/api/admin-api';
import { rikAdmin, noRoleStaff } from '../test/staff-session';

let current: StaffSession | null = null;
const logout = vi.fn(async () => {});
const navigate = vi.fn();

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ status: 'authenticated', session: current, login: vi.fn(), logout, can: () => false, hasRole: () => false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderAccount(session: StaffSession | null) {
  current = session;
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>
  );
}

describe('AccountPage — the staff member’s own account', () => {
  it('shows identity, roles and the exact permission codes the server enforces', () => {
    renderAccount(rikAdmin());
    expect(screen.getByText('Test RIK_ADMIN')).toBeInTheDocument();
    expect(screen.getByText('rik_admin')).toBeInTheDocument();
    expect(screen.getByText('RIK_ADMIN')).toBeInTheDocument();
    expect(screen.getByText('rik.issue_schedule.manage')).toBeInTheDocument();
    expect(screen.getByText('shared.announcement.manage')).toBeInTheDocument();
  });

  it('exposes no secret of any kind', () => {
    renderAccount(rikAdmin());
    expect(document.body.textContent).not.toMatch(/password|hash|totp secret|bearer|refresh/i);
  });

  it('says plainly when nothing is granted, instead of showing an empty panel', () => {
    renderAccount(noRoleStaff());
    expect(screen.getByText(/no role is assigned to your account/i)).toBeInTheDocument();
    expect(screen.getByText('None granted.')).toBeInTheDocument();
  });

  it('logs out through the real logout path and returns to sign-in', async () => {
    renderAccount(rikAdmin());
    await userEvent.click(screen.getByRole('button', { name: /log out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });
});
