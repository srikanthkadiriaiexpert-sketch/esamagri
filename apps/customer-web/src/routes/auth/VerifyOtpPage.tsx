import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Input } from '../../design-system/Input';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError, NetworkError } from '../../lib/api/client';
import { registrationHandoffFrom } from '../../lib/api/auth-api';

const OTP_PATTERN = /^\d{6}$/;
const RESEND_COOLDOWN_SECONDS = 30;

const OTP_ERROR_COPY: Record<string, string> = {
  OTP_INVALID: 'That code is incorrect. Please try again.',
  OTP_EXPIRED: 'This code has expired. Request a new one.',
  OTP_LOCKED: 'Too many incorrect attempts. Please request a new code.',
};

/**
 * "That code is incorrect" USED TO BE SHOWN FOR A CORRECT CODE.
 *
 * When a correct code belonged to no account, the server answered
 * OTP_INVALID — deliberately, so that verifying could not be used to discover
 * which numbers have accounts — and this screen dutifully told the resident
 * their code was wrong. It was the one message on this screen that could be
 * false, and it sent people looking for a problem that was not there.
 *
 * The server now says ACCOUNT_NOT_REGISTERED and hands back a ticket proving
 * the number was verified. This screen carries them to the registration form
 * with it, so nobody is asked for a second code.
 */
const ACCOUNT_NOT_REGISTERED = 'ACCOUNT_NOT_REGISTERED';

interface RegistrationState {
  name: string;
  quarterBlock: string;
  quarterNumber: string;
}

export function VerifyOtpPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyOtp, requestOtp, register, requestRegistrationOtp } = useAuth();
  const routeState = location.state as
    | { mobileNumber?: string; registration?: RegistrationState }
    | null;
  const mobileNumber = routeState?.mobileNumber;
  /**
   * Present only when RegisterPage sent us here. Its presence is what makes
   * this ONE screen serve both flows: the OTP entry, the resend cooldown, the
   * expiry and lock copy are identical for a login and a registration, and a
   * second copy of them would be a second place for them to drift.
   */
  const registration = routeState?.registration;
  const isRegistering = registration !== undefined;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    timerRef.current = window.setInterval(() => {
      setResendCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timerRef.current);
  }, []);

  if (!mobileNumber) {
    // Direct navigation to /auth/verify without going through step 1 —
    // there is nothing to verify against, send them back.
    return <Navigate to="/auth/login" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!OTP_PATTERN.test(code) || submitting || !mobileNumber) return;
    setSubmitting(true);
    setError(null);
    try {
      if (registration !== undefined) {
        // The "Create an account" path: a REGISTER-purpose code, with the
        // number it was sent to. The other path never reaches this screen a
        // second time — it is carried to the form with a ticket instead.
        await register({ mobileNumber, code }, registration);
      } else {
        await verifyOtp(mobileNumber, code);
      }
      // ONE HOME SCREEN, FOR EVERY RESIDENT.
      //
      // Both flows land on '/'. There is one Customer App, one home screen,
      // and the server decides what each resident may do on it: the RIK
      // module card is offered only to a ration-approved resident, while the
      // banners, New Arrivals, Nutrition Info, announcements, product
      // showcase and the PIF shop are common to all.
      //
      // THIS USED TO SEND A NEW REGISTRATION TO '/pif', on the reasoning that
      // a self-registered resident is PIF-only by definition and a home
      // screen offering RIK would be "a door that answers 403". The reasoning
      // was sound for the screen as it then was; the approved
      // common-customer-experience decision replaces it. A PIF-only resident
      // now gets the same home screen as everybody else, minus one card, and
      // sending them past it was what made a new account look half-built.
      //
      // `replace: true` on both: the OTP has been consumed and cannot be
      // re-submitted, so Back must not return to this screen.
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === ACCOUNT_NOT_REGISTERED) {
        const handoff = registrationHandoffFrom(err.details);
        if (handoff !== null) {
          /**
           * STRAIGHT ON TO REGISTRATION, WITH NO SECOND CODE.
           *
           * The ticket is the proof. It travels in router state rather than
           * in the URL: a query parameter would end up in history, in the
           * browser's address bar and in any analytics or server log that
           * records paths, and this is a credential with a short life rather
           * than a page address.
           *
           * `replace: true` because the code behind this screen has been
           * consumed — Back must not return to a form that can no longer be
           * submitted.
           */
          navigate('/auth/register', {
            state: {
              verified: { mobileNumber: handoff.mobileNumber, registrationTicket: handoff.registrationTicket },
            },
            replace: true,
          });
          return;
        }
        // Claimed the handoff and did not supply a usable ticket. Rather than
        // navigate to a form that cannot be submitted, say what the server
        // said and let them start again.
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(OTP_ERROR_COPY[err.code] ?? err.message);
      } else if (err instanceof NetworkError) {
        setError('No internet connection. Please check your network and try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (resendCooldown > 0 || resending || !mobileNumber) return;
    setResending(true);
    setError(null);
    try {
      // Resend the SAME kind of code. A registration code and a login code are
      // different purposes server-side, and resending the wrong one would send
      // a code that cannot complete the flow the resident is in.
      if (isRegistering) {
        await requestRegistrationOtp(mobileNumber);
      } else {
        await requestOtp(mobileNumber);
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError('Could not resend the code. Please try again in a moment.');
    } finally {
      setResending(false);
    }
  }

  return (
    // min-h-screen-safe: centred content on iOS Safari — see LoginMobilePage
    // and the note in index.css.
    <div className="app-shell flex min-h-screen-safe flex-col justify-center px-6 py-10">
      <div className="mb-8">
        <h1 className="text-xl font-extrabold text-brand-forest">
          {isRegistering ? 'Confirm your number' : 'Verify your number'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter the 6-digit code sent to <span className="font-semibold text-slate-700">{mobileNumber}</span>
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Verification code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6-digit code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button type="submit" size="lg" fullWidth disabled={!OTP_PATTERN.test(code)} loading={submitting}>
          {isRegistering ? 'Create account' : 'Verify & Continue'}
        </Button>

        <button
          type="button"
          onClick={onResend}
          disabled={resendCooldown > 0 || resending}
          className="inline-flex min-h-touch items-center justify-center text-sm font-semibold text-brand-green disabled:text-slate-400"
        >
          {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : resending ? 'Sending…' : 'Resend code'}
        </button>
      </form>
    </div>
  );
}
