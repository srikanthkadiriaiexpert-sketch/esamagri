import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, NetworkError } from '../../lib/api/client';
import { VerifyOtpPage } from './VerifyOtpPage';
import { LoginMobilePage } from './LoginMobilePage';

/**
 * THE REGISTRATION HANDOFF, PROVEN BY RENDERING THE REAL SCREEN.
 *
 * WHY THIS FILE EXISTS, AND WHAT IT IS A REACTION TO.
 *
 * An unregistered number was tested end to end. The API answered correctly —
 * `ACCOUNT_NOT_REGISTERED`, with a registration ticket and the canonical
 * mobile number in `details`, captured from the browser's own network tab —
 * and the app showed the message instead of opening the registration form.
 *
 * Every layer was then inspected and every layer was correct. What was
 * MISSING was a test that mounted the actual screen, handed it the actual
 * error object, and asserted where the router was sent. The strings were
 * present in the built bundle, and that proves nothing: a string in a bundle
 * is not an executed branch. So the shipped code was never shown to work,
 * and the first time anybody found out was in a live test.
 *
 * These tests close that. They do not mock the screen's logic — they mock
 * only what is outside it (the auth hook and the router) and then drive the
 * real component through a real click.
 *
 * NOTHING SENSITIVE IS WRITTEN HERE. The ticket below is a placeholder with
 * the same SHAPE as a real one and no real signature; no OTP, no real number,
 * no token. One test asserts positively that the ticket never reaches a URL.
 */

const navigate = vi.fn();
const requestOtp = vi.fn();
const verifyOtp = vi.fn();
const requestRegistrationOtp = vi.fn();
const register = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useLocation: () => ({
      state: { mobileNumber: '+919999999999' },
      pathname: '/auth/verify',
      search: '',
      hash: '',
      key: 'test',
    }),
  };
});

vi.mock('../../lib/auth/AuthContext', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    principal: null,
    rikAuthorised: null,
    requestOtp,
    verifyOtp,
    requestRegistrationOtp,
    register,
    logout: vi.fn(),
  }),
  useRikVisibility: () => null,
}));

/**
 * THE ENVELOPE AS THE SERVER ACTUALLY SENDS IT, field for field, including
 * the flat `correlationId` the global exception filter adds. Writing it out
 * rather than building a convenient object is the point: a test that invents
 * a tidier shape than production sends is how a passing suite hides a
 * nesting bug.
 */
const TICKET = 'v1.eyJwbGFjZWhvbGRlciI6dHJ1ZX0.AAAABBBBCCCCDDDDEEEEFFFF';
const ACCOUNT_NOT_REGISTERED_BODY = {
  code: 'ACCOUNT_NOT_REGISTERED',
  message: 'This number is not registered yet. Please complete your registration.',
  correlationId: '0193aaaa-bbbb-cccc-dddd-eeeeffff0000',
  details: { registrationTicket: TICKET, mobileNumber: '9999999999' },
};

async function submitCode(code = '246813') {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <VerifyOtpPage />
    </MemoryRouter>
  );
  await user.type(screen.getByLabelText(/verification code/i), code);
  await user.click(screen.getByRole('button', { name: /verify & continue/i }));
}

beforeEach(() => {
  navigate.mockReset();
  verifyOtp.mockReset();
  register.mockReset();
  requestOtp.mockReset();
  requestRegistrationOtp.mockReset();
});

// ------------------------------------------------------- the handoff itself

describe('ACCOUNT_NOT_REGISTERED opens the PIF registration form', () => {
  beforeEach(() => {
    verifyOtp.mockRejectedValue(new ApiError(404, ACCOUNT_NOT_REGISTERED_BODY));
  });

  it('navigates to /auth/register', async () => {
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(navigate.mock.calls[0]![0]).toBe('/auth/register');
  });

  it('carries the registration ticket and the number in router state', async () => {
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const [, options] = navigate.mock.calls[0] as [string, { state?: unknown; replace?: boolean }];
    expect(options.state).toEqual({
      verified: { mobileNumber: '9999999999', registrationTicket: TICKET },
    });
  });

  it('replaces the history entry, because the code behind this screen is spent', async () => {
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const [, options] = navigate.mock.calls[0] as [string, { replace?: boolean }];
    expect(options.replace).toBe(true);
  });

  it('NEVER puts the ticket in the path or a query string', async () => {
    // A credential in a URL ends up in history, in the address bar and in
    // every log that records paths. It travels in router state only.
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(String(navigate.mock.calls[0]![0])).not.toContain(TICKET);
  });

  it('does NOT tell the resident their code was wrong', async () => {
    // The whole defect this replaces: a correct code reported as incorrect.
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(screen.queryByText(/code is incorrect/i)).not.toBeInTheDocument();
  });

  it('does not ask for a second code', async () => {
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(requestOtp).not.toHaveBeenCalled();
    expect(requestRegistrationOtp).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------- the cases that must NOT pass

describe('a malformed handoff is refused rather than half-honoured', () => {
  it('does not navigate when the ticket is missing from details', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(404, { ...ACCOUNT_NOT_REGISTERED_BODY, details: { mobileNumber: '9999999999' } })
    );
    await submitCode();
    await waitFor(() =>
      expect(screen.getByText(ACCOUNT_NOT_REGISTERED_BODY.message)).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when details is absent entirely', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(404, {
        code: 'ACCOUNT_NOT_REGISTERED',
        message: 'This number is not registered yet.',
        correlationId: 'c',
      })
    );
    await submitCode();
    await waitFor(() =>
      expect(screen.getByText(/not registered yet/i)).toBeInTheDocument()
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when the ticket is an empty string', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(404, {
        ...ACCOUNT_NOT_REGISTERED_BODY,
        details: { registrationTicket: '', mobileNumber: '9999999999' },
      })
    );
    await submitCode();
    await waitFor(() => expect(screen.getByText(/not registered yet/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a bodyless 404 never becomes a handoff', async () => {
    // A 404 stripped of its body by a proxy arrives as NotImplementedError,
    // not as an ApiError. It must not be mistaken for "please register".
    verifyOtp.mockRejectedValue(new Error('/api/auth/customer/otp/verify is not implemented yet'));
    await submitCode();
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('every other outcome behaves as it did before', () => {
  it('a registered customer reaches the common home screen', async () => {
    verifyOtp.mockResolvedValue(undefined);
    await submitCode();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('a wrong code is still reported as a wrong code', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(400, { code: 'OTP_INVALID', message: 'The code is incorrect.', correlationId: 'c' })
    );
    await submitCode();
    await waitFor(() => expect(screen.getByText(/That code is incorrect/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('an expired code is still reported as expired', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(400, { code: 'OTP_EXPIRED', message: 'expired', correlationId: 'c' })
    );
    await submitCode();
    await waitFor(() => expect(screen.getByText(/has expired/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the facility message, and does not navigate, when self-registration is OFF', async () => {
    verifyOtp.mockRejectedValue(
      new ApiError(503, {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Self-registration is not yet available. Please ask the facility to register you.',
        correlationId: 'c',
      })
    );
    await submitCode();
    await waitFor(() => expect(screen.getByText(/not yet available/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a lost connection as a lost connection', async () => {
    verifyOtp.mockRejectedValue(new NetworkError());
    await submitCode();
    await waitFor(() => expect(screen.getByText(/No internet connection/i)).toBeInTheDocument());
    expect(navigate).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------- one door only

describe('the login screen offers one door and no account-type question', () => {
  it('has NO "Create an account" link', async () => {
    render(
      <MemoryRouter>
        <LoginMobilePage />
      </MemoryRouter>
    );
    expect(screen.queryByText(/create an account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/new resident/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /register/i })).not.toBeInTheDocument();
  });

  it('asks the resident to choose neither RIK nor PIF', async () => {
    // The server decides from its own records. A screen that asked would be
    // asking the resident to classify themselves, which they cannot know and
    // which must never be believed.
    const { container } = render(
      <MemoryRouter>
        <LoginMobilePage />
      </MemoryRouter>
    );
    expect(container.textContent ?? '').not.toMatch(/\bRIK\b/);
    expect(container.textContent ?? '').not.toMatch(/\bPIF\b/);
  });

  it('still keeps the mobile number field and the Send OTP action', async () => {
    render(
      <MemoryRouter>
        <LoginMobilePage />
      </MemoryRouter>
    );
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send otp/i })).toBeInTheDocument();
  });

  it('sends the code and moves to the verify screen', async () => {
    requestOtp.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginMobilePage />
      </MemoryRouter>
    );
    await user.type(screen.getByLabelText(/mobile number/i), '9999999999');
    await user.click(screen.getByRole('button', { name: /send otp/i }));
    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('+919999999999'));
    expect(navigate).toHaveBeenCalledWith('/auth/verify', {
      state: { mobileNumber: '+919999999999' },
    });
  });
});
