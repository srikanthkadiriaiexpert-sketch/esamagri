import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ApiError, NetworkError } from '../lib/api/client';

const login = vi.fn<[string, string, string | undefined], Promise<void>>();
const navigate = vi.fn();

vi.mock('../lib/auth/StaffAuthContext', () => ({
  useStaffAuth: () => ({ status: 'unauthenticated', session: null, login, logout: vi.fn(), can: () => false, hasRole: () => false }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

async function submit(username = 'rik.admin', password = 'correct-horse', totp = '') {
  await userEvent.type(screen.getByLabelText(/^username$/i), username);
  await userEvent.type(screen.getByLabelText(/^password$/i), password);
  if (totp) await userEvent.type(screen.getByLabelText(/authenticator code/i), totp);
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  login.mockReset();
  navigate.mockReset();
});

describe('LoginPage — staff sign-in on the existing STEP 6 flow', () => {
  it('collects username, password and an optional authenticator code', () => {
    renderLogin();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument();
  });

  it('passes the credentials through and lands on the dashboard on success', async () => {
    login.mockResolvedValue();
    renderLogin();
    await submit('rik.admin', 'correct-horse', '123456');
    expect(login).toHaveBeenCalledWith('rik.admin', 'correct-horse', '123456');
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('omits the TOTP code entirely when none was entered, rather than sending an empty one', async () => {
    login.mockResolvedValue();
    renderLogin();
    await submit();
    expect(login).toHaveBeenCalledWith('rik.admin', 'correct-horse', undefined);
  });

  it('gives one identical message for bad credentials, so staff accounts cannot be enumerated', async () => {
    renderLogin();
    login.mockRejectedValueOnce(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'no such user' }));
    await submit('does.not.exist', 'anything');
    const first = (await screen.findByRole('alert')).textContent;

    login.mockRejectedValueOnce(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'wrong password' }));
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect((await screen.findByRole('alert')).textContent).toBe(first);
    expect(first).toMatch(/those sign-in details are not correct/i);
  });

  it('never echoes the server message or the submitted password back to the screen', async () => {
    login.mockRejectedValue(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'bcrypt compare failed for user 42' }));
    renderLogin();
    await submit('rik.admin', 'super-secret-value');
    await screen.findByRole('alert');
    expect(document.body.textContent).not.toContain('bcrypt');
    expect(document.body.textContent).not.toContain('super-secret-value');
  });

  it('asks for the authenticator code when the account requires one', async () => {
    login.mockRejectedValue(new ApiError(401, { code: 'TOTP_REQUIRED', message: 'totp required' }));
    renderLogin();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/requires an authenticator code/i);
  });

  it('distinguishes a locked account from wrong details', async () => {
    login.mockRejectedValue(new ApiError(423, { code: 'ACCOUNT_LOCKED', message: 'locked' }));
    renderLogin();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/account is locked/i);
  });

  it('reports an unreachable server as a connection problem, not a credential problem', async () => {
    login.mockRejectedValue(new NetworkError());
    renderLogin();
    await submit();
    expect(await screen.findByRole('alert')).toHaveTextContent(/server could not be reached/i);
  });

  it('does not navigate anywhere when sign-in fails', async () => {
    login.mockRejectedValue(new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'nope' }));
    renderLogin();
    await submit();
    await screen.findByRole('alert');
    expect(navigate).not.toHaveBeenCalled();
  });
});
