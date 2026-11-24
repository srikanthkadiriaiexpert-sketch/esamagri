import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '../../design-system/Logo';
import { Input } from '../../design-system/Input';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError, NetworkError } from '../../lib/api/client';

const MOBILE_PATTERN = /^\d{10}$/;

/**
 * PIF self-registration — who you are and where you live.
 *
 * WHAT IT COLLECTS, AND WHY NOTHING ELSE. Name, quarter block, quarter number
 * and mobile number — the four fields the project owner approved. There is no
 * RIK ID field, because a resident registering for PIF does not have one and
 * must not be asked for one; and no dietary preference, because that belongs
 * to RIK and the resident records their own later from their profile.
 *
 * ================================================================
 * TWO WAYS IN, AND ONE OF THEM ASKS FOR NO CODE AT ALL
 * ================================================================
 *
 * ALREADY VERIFIED (the common-login path). The resident signed in with their
 * number, the code was correct, and no account existed behind it — so the
 * server handed back a ticket proving the verification and the login screen
 * carried them here with it. The mobile field is then filled in and locked,
 * there is no "Send OTP", and pressing the button CREATES THE ACCOUNT. Asking
 * for a second code here would be asking them to prove the same thing twice.
 *
 * FROM THE START ("Create an account"). No ticket. This asks the server to
 * send a REGISTER-purpose code and hands the details to the verify screen,
 * which registers only once the code checks out. A half-finished registration
 * leaves nothing behind.
 *
 * The ticket and the details both travel in router state rather than a store
 * or the URL: they are needed by one screen for one step, a reload should
 * discard them rather than resurrect a stale half-filled form, and a
 * credential has no business in an address bar or a server log.
 */
interface VerifiedHandoff {
  mobileNumber: string;
  registrationTicket: string;
}

export function RegisterPage() {
  const location = useLocation();
  const verified = (location.state as { verified?: VerifiedHandoff } | null)?.verified;
  const alreadyVerified = verified !== undefined;

  const [name, setName] = useState('');
  const [quarterBlock, setQuarterBlock] = useState('');
  const [quarterNumber, setQuarterNumber] = useState('');
  // Pre-filled from the verified hand-off, and read-only there: the number
  // that gets registered comes out of the signed ticket on the server, so
  // letting it be edited here would show a number that is not the one being
  // registered.
  const [mobile, setMobile] = useState(() =>
    verified === undefined ? '' : verified.mobileNumber.replace(/^\+91/, '')
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { requestRegistrationOtp, register } = useAuth();
  const navigate = useNavigate();

  const mobileValid = MOBILE_PATTERN.test(mobile);
  const valid =
    name.trim() !== '' &&
    quarterBlock.trim() !== '' &&
    quarterNumber.trim() !== '' &&
    (alreadyVerified || mobileValid);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    const fullNumber = `+91${mobile}`;
    const details = {
      name: name.trim(),
      quarterBlock: quarterBlock.trim(),
      quarterNumber: quarterNumber.trim(),
    };
    try {
      if (verified !== undefined) {
        /**
         * ALREADY VERIFIED: create the account now.
         *
         * The ticket goes up ALONE — no mobile number, no code. The server
         * refuses a body carrying both, and the number it registers is the
         * one inside the ticket, not the one in the field above. On success
         * the session is live and this lands on the common home screen, the
         * same one every other resident sees.
         */
        await register({ registrationTicket: verified.registrationTicket }, details);
        navigate('/', { replace: true });
        return;
      }

      await requestRegistrationOtp(fullNumber);
      navigate('/auth/verify', {
        state: { mobileNumber: fullNumber, registration: details },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        // Two codes get their own sentence; everything else — including the
        // 503 the server sends while self-registration is switched off —
        // shows the server's own message rather than a guess at what it meant.
        setError(
          err.code === 'OTP_RATE_LIMITED'
            ? 'Too many attempts. Please try again later.'
            : err.code === 'REGISTRATION_TICKET_INVALID'
              ? 'This registration session has expired. Please sign in again to continue.'
              : err.message
        );
      } else if (err instanceof NetworkError) {
        setError('No internet connection. Please check your network and try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // min-h-screen-safe, matching LoginMobilePage — see the note in index.css.
    <div className="app-shell flex min-h-screen-safe flex-col justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo className="h-20 w-20" />
        <h1 className="mt-4 text-2xl font-extrabold text-brand-forest">
          {alreadyVerified ? 'Finish your registration' : 'Create your account'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {alreadyVerified
            ? 'Your number is verified. Just tell us your name and quarter.'
            : 'For residents of the community. You do not need a RIK ID.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Full name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quarter block"
            type="text"
            placeholder="e.g. B"
            maxLength={60}
            value={quarterBlock}
            onChange={(e) => setQuarterBlock(e.target.value)}
          />
          <Input
            label="Quarter number"
            type="text"
            placeholder="e.g. 12"
            maxLength={60}
            value={quarterNumber}
            onChange={(e) => setQuarterNumber(e.target.value)}
          />
        </div>

        {/*
          Read-only once verified. The server registers the number inside the
          signed ticket, so an editable field here would invite someone to
          change a value that has no effect — and then wonder why the account
          carries the other number.
        */}
        <Input
          label={alreadyVerified ? 'Mobile number (verified)' : 'Mobile number'}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile number"
          maxLength={10}
          value={mobile}
          readOnly={alreadyVerified}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
          leftAdornment="+91"
          error={
            !alreadyVerified && mobile.length > 0 && !mobileValid
              ? 'Enter a valid 10-digit mobile number'
              : undefined
          }
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button type="submit" size="lg" fullWidth disabled={!valid} loading={submitting}>
          {alreadyVerified ? 'Create account' : 'Send OTP'}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/auth/login" className="font-semibold text-brand-green">
          Sign in
        </Link>
      </p>
    </div>
  );
}
