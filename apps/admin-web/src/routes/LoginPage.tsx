import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';
import { ApiError, NetworkError } from '../lib/api/client';

/**
 * Staff sign-in, on the existing STEP 6 `POST /auth/staff/login`
 * endpoint — username, password, and a TOTP code where the account
 * requires one. No second authentication mechanism is introduced and
 * no credential is ever stored in the browser beyond the in-memory
 * access token.
 *
 * Failures are reported in the same words regardless of whether the
 * username exists, so this form cannot be used to enumerate staff
 * accounts.
 */
export function LoginPage() {
  const { login } = useStaffAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password, totpCode.trim() || undefined);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/brand/e-samagri-logo.jpg" alt="e Samagri" className="h-16 w-16 rounded object-contain" />
          <div>
            <h1 className="text-lg font-bold text-brand-forest">e Samagri Admin</h1>
            <p className="text-sm text-slate-500">Staff sign-in</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          {error ? (
            <p role="alert" className="rounded-lg border border-semantic-danger/30 bg-semantic-dangerLight px-3 py-2 text-sm text-semantic-danger">
              {error}
            </p>
          ) : null}

          <label className="text-sm font-medium text-slate-700">
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-medium text-slate-700">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm font-medium text-slate-700">
            Authenticator code <span className="font-normal text-slate-400">(if enabled for your account)</span>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              className="mt-1 min-h-touch w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-widest"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="min-h-touch rounded-lg bg-brand-forest px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'TOTP_REQUIRED') return 'This account requires an authenticator code.';
    if (err.code === 'TOTP_INVALID') return 'That authenticator code is not valid.';
    if (err.code === 'ACCOUNT_LOCKED') return 'This account is locked. Contact a super administrator.';
    if (err.code === 'ACCOUNT_INACTIVE') return 'This account is not active.';
    if (err.status === 401) return 'Those sign-in details are not correct.';
    return 'Sign-in could not be completed. Please try again.';
  }
  if (err instanceof NetworkError) return 'The server could not be reached. Check your connection and try again.';
  return 'Sign-in could not be completed. Please try again.';
}
