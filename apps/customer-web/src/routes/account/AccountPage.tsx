import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../../design-system/Header';
import { Button } from '../../design-system/Button';
import { Dialog } from '../../design-system/Dialog';
import { LoadingState, ErrorState } from '../../design-system/StateViews';
import { useAuth } from '../../lib/auth/AuthContext';
import { useResource } from '../../lib/api/resource';
import { ApiError } from '../../lib/api/client';
import { fetchMyProfile, formatResidence, type CustomerProfile } from '../../lib/api/customer-api';

/**
 * Customer Account (STEP 9, spec ACC-1) — now backed by the real
 * `GET /customer/me` endpoint rather than the STEP 8 placeholder.
 *
 * Shows only the approved customer information: name, mobile number and
 * quarter/residence. No defence-specific field is collected, displayed
 * or invented.
 *
 * The screen never asks for a customer id: the server resolves identity
 * from the access token, so there is nothing here a user could edit to
 * reach someone else's account. Route hiding is not the security
 * control — the backend is (see CustomerController).
 *
 * RIK and PIF order histories are separate entry points (spec ORD-1)
 * and are deliberately never merged into one list.
 */
export function AccountPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const profile = useResource<CustomerProfile>(() => fetchMyProfile(), undefined, [reloadKey]);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const doLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      navigate('/auth/login', { replace: true });
    }
  }, [logout, navigate]);

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <Header title="Account" />
      <main className="mx-auto w-full max-w-app px-4 pt-4">
        {profile.status === 'loading' ? <LoadingState /> : null}

        {profile.status === 'error' ? (
          <ErrorState variant={errorVariant(profile.error)} onRetry={retry} />
        ) : null}

        {profile.status === 'not_implemented' ? (
          <ErrorState variant="error" title="Profile unavailable" description="We couldn't reach your profile just now." onRetry={retry} />
        ) : null}

        {profile.status === 'success' ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-forest text-base font-bold text-white"
                  aria-hidden="true"
                >
                  {initialsOf(profile.data.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{profile.data.name}</p>
                  <p className="text-xs text-slate-500">{profile.data.mobileNumber}</p>
                </div>
              </div>

              <dl className="mt-4 border-t border-slate-100 pt-3">
                <dt className="text-xs font-medium text-slate-400">Quarter / residence</dt>
                <dd className="mt-0.5 text-sm text-slate-700">
                  {formatResidence(profile.data.residence) ?? (
                    <span className="text-slate-400">Not added yet</span>
                  )}
                </dd>
              </dl>

              <Button
                variant="outline"
                accent="neutral"
                size="sm"
                fullWidth
                className="mt-4"
                onClick={() => navigate('/account/profile')}
              >
                {profile.data.residence ? 'Edit profile' : 'Complete your profile'}
              </Button>
            </section>

            <nav className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <AccountLink label="My RIK Orders" hint="Ration requests" onClick={() => navigate('/rik/orders')} />
              <AccountLink label="My PIF Orders" hint="Grocery orders" onClick={() => navigate('/pif/orders')} />
              <AccountLink label="RIK entitlement information" onClick={() => navigate('/rik')} />
              <AccountLink label="Notifications" onClick={() => navigate('/account/notifications')} />
            </nav>

            <Button
              variant="outline"
              accent="neutral"
              fullWidth
              className="mt-4 border-semantic-danger/30 text-semantic-danger"
              onClick={() => setConfirmLogout(true)}
            >
              Log out
            </Button>
          </>
        ) : null}
      </main>

      <Dialog
        open={confirmLogout}
        title="Log out?"
        description="You'll need your mobile number and a new OTP to sign back in."
        confirmLabel={loggingOut ? 'Logging out…' : 'Log out'}
        confirmAccent="neutral"
        danger
        onConfirm={doLogout}
        onClose={() => setConfirmLogout(false)}
      />
    </div>
  );
}

/**
 * A 401 here means the session died between mount and this request —
 * the AuthProvider's refresh already had its single attempt — so the
 * customer is told their session expired rather than shown a generic
 * failure. 403 is shown as forbidden, which for a customer's own
 * profile should never happen and is therefore worth surfacing plainly.
 */
function errorVariant(error: unknown): 'error' | 'unauthorized' | 'forbidden' | 'offline' | 'session_expired' {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'session_expired';
    if (error.status === 403) return 'forbidden';
    return 'error';
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'error';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function AccountLink({ label, hint, onClick }: { label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-touch w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-xs text-slate-400">{hint}</span> : null}
      </span>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate-300" fill="none">
        <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
