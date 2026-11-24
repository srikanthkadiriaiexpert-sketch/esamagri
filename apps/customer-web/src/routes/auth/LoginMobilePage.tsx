import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../../design-system/Logo';
import { Input } from '../../design-system/Input';
import { Button } from '../../design-system/Button';
import { Alert } from '../../design-system/Alert';
import { useAuth } from '../../lib/auth/AuthContext';
import { ApiError, NetworkError } from '../../lib/api/client';

const MOBILE_PATTERN = /^\d{10}$/;

/**
 * Step 1 of the customer auth flow, and the ONLY way into the app: mobile
 * number -> request OTP. No fake success path — a request failure (rate
 * limit, validation) surfaces the real backend error.
 *
 * ONE DOOR. Existing RIK officers, existing PIF residents and people with no
 * account at all all start here and type the same thing. What happens after
 * the code is checked is the server's decision, taken from its own records:
 * see VerifyOtpPage, which carries an unregistered number straight to the
 * registration form with a ticket rather than asking for a second code.
 */
export function LoginMobilePage() {
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { requestOtp } = useAuth();
  const navigate = useNavigate();

  const valid = MOBILE_PATTERN.test(mobile);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    const fullNumber = `+91${mobile}`;
    try {
      await requestOtp(fullNumber);
      navigate('/auth/verify', { state: { mobileNumber: fullNumber } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code === 'OTP_RATE_LIMITED' ? 'Too many attempts. Please try again later.' : err.message);
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
    // min-h-screen-safe, not min-h-screen: this column is centred, and on iOS
    // Safari 100vh is taller than the visible area, which pushed "Send OTP"
    // under the browser toolbar on a short phone. See index.css.
    <div className="app-shell flex min-h-screen-safe flex-col justify-center px-6 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        {/* Larger so the brand is the first thing read on the first screen.
            The form below keeps its own spacing, and the column is
            justify-center, so nothing is pushed off a short screen. */}
        <Logo className="h-28 w-28" />
        <h1 className="mt-4 text-2xl font-extrabold text-brand-forest">Welcome to e Samagri</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in with your registered mobile number</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Mobile number"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="10-digit mobile number"
          maxLength={10}
          value={mobile}
          onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
          leftAdornment="+91"
          error={mobile.length > 0 && !valid ? 'Enter a valid 10-digit mobile number' : undefined}
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <Button type="submit" size="lg" fullWidth disabled={!valid} loading={submitting}>
          Send OTP
        </Button>
      </form>

      {/*
        NO SEPARATE REGISTRATION ENTRY POINT, AND THAT IS THE DESIGN.

        There used to be a "New resident? Create an account" link here. It
        asked the resident to classify themselves before anyone had checked
        who they were, and it was the wrong question: a resident does not know
        whether the facility has them on the ration roll, and the app must not
        take their word for it either.

        One mobile number and one OTP is now the whole of it. The server looks
        the number up in its own records and decides what happens next — sign
        the resident in, or hand back a registration ticket that carries them
        straight to the short form. Nobody picks RIK or PIF on a screen, and
        nothing a client sends can add to what the backend granted.
      */}
    </div>
  );
}
