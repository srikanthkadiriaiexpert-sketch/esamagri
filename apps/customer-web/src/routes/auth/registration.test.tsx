import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';
import { VerifyOtpPage } from './VerifyOtpPage';
import { ApiError, NetworkError } from '../../lib/api/client';

/**
 * PIF self-registration, from the resident's side (Stage 2, Option A).
 *
 * WHAT THIS SUITE IS FOR. The backend path is covered by
 * customer-auth.service.spec.ts — the OTP purpose, the duplicate-number
 * branch, the absent rik_id. None of that says whether a resident can
 * actually reach it, which is a question about these two screens and the
 * router state they pass between them. That hand-off is the only place the
 * details live between step 1 and step 2, so it is the thing worth pinning.
 *
 * THE THREE THINGS THESE TESTS REALLY DEFEND:
 *
 *   1. The details reach `register()` unchanged and trimmed, and no account is
 *      created before the code is checked.
 *   2. A REGISTRATION lands in PIF and a LOGIN still lands on the home
 *      screen. The two flows share one screen, so a change to one can silently
 *      move the other — and a registered resident is PIF-only by definition
 *      (rik_id NULL), so home would offer them a RIK door that answers 403.
 *   3. The 503 the server returns while PIF_SELF_REGISTRATION_ENABLED is false
 *      is shown to the resident as the server worded it, not swallowed and not
 *      reworded into something that blames them.
 *
 * `useNavigate` and `useAuth` are stubbed because what matters is WHAT is
 * requested and WHERE the resident is sent. The router itself is real, and the
 * registration details are passed through a real history entry.
 */

const navigate = vi.fn();
const requestRegistrationOtp = vi.fn();
const register = vi.fn();
const verifyOtp = vi.fn();
const requestOtp = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
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
}));

const MOBILE = '+919000000001';
const DETAILS = { name: 'Asha Kumar', quarterBlock: 'B', quarterNumber: '12' };

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/auth/register']}>
      <RegisterPage />
    </MemoryRouter>
  );
}

/**
 * The state travels through MemoryRouter's own history entry rather than a
 * mocked useLocation: that exercises the real router, which is the thing the
 * screens actually read the registration details out of.
 */
function renderVerify(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/auth/verify', state }]}>
      <VerifyOtpPage />
    </MemoryRouter>
  );
}

/** Fills the four fields on the registration form. */
async function fillRegistrationForm(
  user: ReturnType<typeof userEvent.setup>,
  over: Partial<typeof DETAILS & { mobile: string }> = {}
) {
  await user.type(screen.getByLabelText(/full name/i), over.name ?? DETAILS.name);
  await user.type(screen.getByLabelText(/quarter block/i), over.quarterBlock ?? DETAILS.quarterBlock);
  await user.type(screen.getByLabelText(/quarter number/i), over.quarterNumber ?? DETAILS.quarterNumber);
  await user.type(screen.getByLabelText(/mobile number/i), over.mobile ?? '9000000001');
}

beforeEach(() => {
  navigate.mockReset();
  requestRegistrationOtp.mockReset().mockResolvedValue(undefined);
  register.mockReset().mockResolvedValue(undefined);
  verifyOtp.mockReset().mockResolvedValue(undefined);
  requestOtp.mockReset().mockResolvedValue(undefined);
});

describe('RegisterPage — collecting the approved fields', () => {
  it('asks for name, quarter block, quarter number and mobile, and nothing else', () => {
    renderRegister();

    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/quarter block/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/quarter number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/mobile number/i)).toBeInTheDocument();

    // A PIF resident has neither, and must not be asked for either.
    expect(screen.queryByLabelText(/rik/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/diet/i)).not.toBeInTheDocument();
  });

  it('says plainly that no RIK ID is needed, so a resident does not think they are ineligible', () => {
    renderRegister();
    expect(screen.getByText(/do not need a RIK ID/i)).toBeInTheDocument();
  });

  it('keeps submit disabled until all four fields are valid', async () => {
    const user = userEvent.setup();
    renderRegister();
    const submit = screen.getByRole('button', { name: /send otp/i });

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/full name/i), DETAILS.name);
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/quarter block/i), DETAILS.quarterBlock);
    await user.type(screen.getByLabelText(/quarter number/i), DETAILS.quarterNumber);
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/mobile number/i), '9000000001');
    expect(submit).toBeEnabled();
  });

  it('rejects a short mobile number with a message, and does not submit it', async () => {
    const user = userEvent.setup();
    renderRegister();
    await fillRegistrationForm(user, { mobile: '90000' });

    expect(screen.getByText(/valid 10-digit mobile number/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send otp/i })).toBeDisabled();
    expect(requestRegistrationOtp).not.toHaveBeenCalled();
  });

  it('offers a route back to sign-in for someone already registered', () => {
    renderRegister();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/auth/login');
  });
});

describe('RegisterPage — requesting the code', () => {
  it('requests a REGISTRATION code for the +91 number, never a login code', async () => {
    const user = userEvent.setup();
    renderRegister();
    await fillRegistrationForm(user);
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => expect(requestRegistrationOtp).toHaveBeenCalledWith(MOBILE));
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('hands the trimmed details to the verify screen in router state — and creates nothing yet', async () => {
    const user = userEvent.setup();
    renderRegister();
    await fillRegistrationForm(user, { name: '  Asha Kumar  ' });
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/auth/verify', {
        state: { mobileNumber: MOBILE, registration: DETAILS },
      })
    );
    // Step 1 must leave nothing behind: the account is created only once the
    // code checks out, on the next screen.
    expect(register).not.toHaveBeenCalled();
  });

  it('shows a loading state while the request is in flight', async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    requestRegistrationOtp.mockReturnValue(new Promise<void>((res) => { release = res; }));

    renderRegister();
    await fillRegistrationForm(user);
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /send otp/i })).toBeDisabled());

    // Release and then wait for the resulting state update. Letting the test
    // end with the promise still settling is what produces React's
    // "not wrapped in act(...)" warning — the update lands after teardown.
    release();
    await waitFor(() => expect(requestRegistrationOtp).toHaveBeenCalled());
  });
});

describe('RegisterPage — while self-registration is switched off', () => {
  it("shows the server's own 503 message rather than a guess at what it meant", async () => {
    const user = userEvent.setup();
    const serverMessage =
      'Self-registration is not yet available. Please ask the facility to register you.';
    requestRegistrationOtp.mockRejectedValue(new ApiError(503, { code: 'VALIDATION_FAILED', message: serverMessage }));

    renderRegister();
    await fillRegistrationForm(user);
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(serverMessage)).toBeInTheDocument();
    // Refused means refused: no session, and the resident stays put.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('gives a rate limit its own sentence instead of the raw code', async () => {
    const user = userEvent.setup();
    requestRegistrationOtp.mockRejectedValue(new ApiError(429, { code: 'OTP_RATE_LIMITED', message: 'rate limited' }));

    renderRegister();
    await fillRegistrationForm(user);
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('explains a lost connection without blaming the resident', async () => {
    const user = userEvent.setup();
    requestRegistrationOtp.mockRejectedValue(new NetworkError());

    renderRegister();
    await fillRegistrationForm(user);
    await user.click(screen.getByRole('button', { name: /send otp/i }));

    expect(await screen.findByText(/no internet connection/i)).toBeInTheDocument();
  });
});

describe('VerifyOtpPage — completing a registration', () => {
  const REG_STATE = { mobileNumber: MOBILE, registration: DETAILS };

  it('reads as a registration, not a login', () => {
    renderVerify(REG_STATE);
    expect(screen.getByRole('heading', { name: /confirm your number/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('passes the details through to register() exactly as the form captured them', async () => {
    const user = userEvent.setup();
    renderVerify(REG_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // The credential moved inside an object: a registration can now arrive
    // with a ticket instead of a code, and the two must not be confusable.
    await waitFor(() =>
      expect(register).toHaveBeenCalledWith({ mobileNumber: MOBILE, code: '246813' }, DETAILS)
    );
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('LANDS A NEW RESIDENT IN THE PIF SHOP, because PIF is all they can use', async () => {
    const user = userEvent.setup();
    renderVerify(REG_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    // ONE HOME SCREEN. A newly self-registered resident lands on '/', the
    // same screen a RIK officer sees, minus the RIK module card. This used to
    // expect '/pif', which is what made a new account look half-built.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('resends a REGISTRATION code, never a login one', async () => {
    const user = userEvent.setup();
    renderVerify(REG_STATE);

    // The resend button is on a cooldown when the screen opens; clicking it
    // while disabled must do nothing at all.
    await user.click(screen.getByRole('button', { name: /resend code in/i }));
    expect(requestRegistrationOtp).not.toHaveBeenCalled();
    expect(requestOtp).not.toHaveBeenCalled();
  });

  it('refuses a wrong code with the right sentence, and does not navigate', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(new ApiError(400, { code: 'OTP_INVALID', message: 'invalid' }));
    renderVerify(REG_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/that code is incorrect/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports an expired code as expired, so the resident knows to request a new one', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(new ApiError(400, { code: 'OTP_EXPIRED', message: 'expired' }));
    renderVerify(REG_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/this code has expired/i)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports exhausted attempts as a lockout rather than a wrong code', async () => {
    const user = userEvent.setup();
    register.mockRejectedValue(new ApiError(400, { code: 'OTP_LOCKED', message: 'locked' }));
    renderVerify(REG_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/too many incorrect attempts/i)).toBeInTheDocument();
  });

  it('keeps submit disabled until the code is six digits', async () => {
    const user = userEvent.setup();
    renderVerify(REG_STATE);
    const submit = screen.getByRole('button', { name: /create account/i });

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/verification code/i), '24681');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/verification code/i), '3');
    expect(submit).toBeEnabled();
  });
});

describe('VerifyOtpPage — the login flow is unchanged', () => {
  const LOGIN_STATE = { mobileNumber: MOBILE };

  it('reads as a login when no registration details were passed', () => {
    renderVerify(LOGIN_STATE);
    expect(screen.getByRole('heading', { name: /verify your number/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify & continue/i })).toBeInTheDocument();
  });

  it('calls verifyOtp, never register', async () => {
    const user = userEvent.setup();
    renderVerify(LOGIN_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /verify & continue/i }));

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith(MOBILE, '246813'));
    expect(register).not.toHaveBeenCalled();
  });

  it('STILL LANDS ON THE HOME SCREEN, not in PIF — a returning officer needs RIK', async () => {
    const user = userEvent.setup();
    renderVerify(LOGIN_STATE);

    await user.type(screen.getByLabelText(/verification code/i), '246813');
    await user.click(screen.getByRole('button', { name: /verify & continue/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });
});
