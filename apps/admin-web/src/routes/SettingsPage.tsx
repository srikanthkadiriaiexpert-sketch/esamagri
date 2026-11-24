import { useCallback, useState } from 'react';
import { useResource } from '../lib/api/resource';
import {
  fetchPifSelfRegistration,
  setPifSelfRegistration,
  type PifSelfRegistrationStatus,
} from '../lib/api/admin-api';
import { LoadingState, FailureState, UnauthorizedState } from '../design-system/States';
import { ConfigNotice, PrimaryButton, SecondaryButton } from '../design-system/ConfigUI';
import { ApiError, NetworkError } from '../lib/api/client';
import { useStaffAuth } from '../lib/auth/StaffAuthContext';

/**
 * Shared settings — currently one switch: whether a resident may create
 * their own PIF account.
 *
 * THE PERMISSION CHECK HERE IS NOT THE CONTROL. `can()` decides whether to
 * draw the screen; the server refuses `GET` and `PUT
 * /admin/settings/pif-self-registration` with 403 for anyone without
 * `shared.settings.write`, whatever this component chose to render. The
 * UnauthorizedState below exists so a staff member who reaches the URL
 * sees an explanation rather than a failed request — see AdminLayout,
 * which hides the nav entry for the same reason and with the same caveat.
 *
 * WHY A CONFIRMATION STEP. This switch governs a PUBLIC endpoint. Every
 * other control in this console edits facility data that a mistake makes
 * wrong; a mis-click here makes a registration endpoint reachable by
 * anyone with the address. The confirm panel states what will change, in
 * which direction, before anything is sent.
 *
 * WHY THE SCREEN NEVER SHOWS ITS OWN OPTIMISTIC STATE. `status` comes from
 * the server on load and is replaced by the server's re-read after a
 * write. There is no local "we think it is on now" — if the write
 * half-succeeded, the administrator sees what the database holds, not
 * what this component hoped for.
 */

/**
 * Why this screen does not use ConfigUI's `serverMessage`.
 *
 * That helper is written for the seven RIK configuration screens, and its
 * 403 branch says "Your role does not include permission to change RIK
 * configuration." Shown here it would tell a Super Admin they cannot
 * change RIK settings when what they tried to change was a shared one —
 * a confidently wrong sentence. The 400/409 pass-through behaviour is
 * kept, because a refusal the server explained in its own words is worth
 * more than anything this screen could invent.
 */
function writeFailureMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if ((err.status === 400 || err.status === 409) && err.message) return err.message;
    if (err.status === 403) {
      return 'Your account no longer has permission to change this setting. Nothing was changed.';
    }
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    return 'The setting could not be changed. Please try again.';
  }
  if (err instanceof NetworkError) {
    return 'The server could not be reached. Check your connection and try again.';
  }
  return 'The setting could not be changed. Please try again.';
}

/** Renders the stored timestamp in the facility's own words. */
function changedLabel(status: PifSelfRegistrationStatus): string {
  if (status.neverSet || status.updatedAt === null) return 'Never changed';
  const when = new Date(status.updatedAt);
  const stamp = Number.isNaN(when.getTime()) ? status.updatedAt : when.toLocaleString();
  return status.updatedByName === null ? stamp : `${stamp} by ${status.updatedByName}`;
}

/**
 * The permission gate, and the reason it is a separate component.
 *
 * A hook cannot be called conditionally, so a single component that held
 * `useResource` would fire the request before reaching any early return —
 * and a staff member without the permission would silently generate a 403
 * on every visit. Splitting it means the fetching component only mounts
 * when the permission is held, so the request is not made at all.
 *
 * This is still not the control. The server refuses both routes
 * independently; see PifSelfRegistrationPanel's own note.
 */
export function SettingsPage() {
  const { can } = useStaffAuth();

  if (!can('shared.settings.write')) {
    return (
      <section aria-labelledby="settings-heading">
        <h1 id="settings-heading" className="mb-1 text-xl font-bold text-brand-forest">
          Settings
        </h1>
        <UnauthorizedState description="Changing shared settings requires the shared.settings.write permission." />
      </section>
    );
  }

  return <PifSelfRegistrationPanel />;
}

function PifSelfRegistrationPanel() {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** The change awaiting confirmation, or null when nothing is pending. */
  const [pending, setPending] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const status = useResource<PifSelfRegistrationStatus>(
    () => fetchPifSelfRegistration(),
    [reloadKey]
  );

  const confirm = async (): Promise<void> => {
    if (pending === null || saving) return;
    setSaving(true);
    setResult(null);
    try {
      const next = await setPifSelfRegistration(pending);
      setPending(null);
      setResult({
        tone: 'ok',
        text: next.enabled
          ? 'New PIF customer registration is now ON.'
          : 'New PIF customer registration is now OFF.',
      });
      // Re-read rather than trusting the response we just rendered: the
      // list of facts on screen (who, when) should come from one place.
      reload();
    } catch (err: unknown) {
      // The server's own wording, including a 403 if the permission was
      // revoked between loading this screen and pressing the button.
      setResult({ tone: 'bad', text: writeFailureMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading" className="mb-1 text-xl font-bold text-brand-forest">
        Settings
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Facility-wide settings. Every change is recorded against your account.
      </p>

      {status.status === 'loading' ? <LoadingState label="Loading settings…" /> : null}
      {status.status === 'error' ? <FailureState error={status.error} onRetry={reload} /> : null}

      {status.status === 'success' ? (
        <article className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">New PIF customer registration</h2>
          <p className="mt-1 text-sm text-slate-600">
            When ON, a resident can verify their mobile number, give their name and quarter, and
            get PIF access immediately — no staff approval. RIK rations are never included: RIK
            access stays with authorised officers only.
          </p>

          <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Current status
              </dt>
              <dd
                className={`mt-0.5 text-lg font-bold ${
                  status.data.enabled ? 'text-semantic-danger' : 'text-slate-900'
                }`}
                data-testid="pif-self-registration-status"
              >
                {status.data.enabled ? 'ON' : 'OFF'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Last changed
              </dt>
              <dd className="mt-0.5 text-sm font-semibold text-slate-900">
                {changedLabel(status.data)}
              </dd>
            </div>
          </dl>

          {status.data.neverSet ? (
            <ConfigNotice>
              This setting has never been changed, so registration is OFF. That is the shipped
              default — there is no stored value until an administrator sets one.
            </ConfigNotice>
          ) : null}

          {status.data.malformed ? (
            <ConfigNotice>
              The stored value for this setting could not be read, so registration is being
              treated as OFF. Pressing “Turn ON” or “Turn OFF” below will write a value the
              server can read.
            </ConfigNotice>
          ) : null}

          {result ? (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-sm font-semibold ${
                result.tone === 'ok'
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-red-50 text-semantic-danger'
              }`}
            >
              {result.text}
            </p>
          ) : null}

          {pending === null ? (
            <div className="mt-5">
              {status.data.enabled ? (
                <SecondaryButton onClick={() => { setResult(null); setPending(false); }}>
                  Turn OFF
                </SecondaryButton>
              ) : (
                <PrimaryButton onClick={() => { setResult(null); setPending(true); }}>
                  Turn ON
                </PrimaryButton>
              )}
            </div>
          ) : (
            <div
              className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
              role="alertdialog"
              aria-labelledby="pif-reg-confirm-heading"
            >
              <h3 id="pif-reg-confirm-heading" className="text-sm font-bold text-amber-900">
                {pending
                  ? 'Turn ON new PIF customer registration?'
                  : 'Turn OFF new PIF customer registration?'}
              </h3>
              <p className="mt-1 text-sm text-amber-900">
                {pending
                  ? 'Any resident who can reach the app will be able to create their own PIF account after verifying a mobile number. This is recorded against your account.'
                  : 'New residents will no longer be able to create an account. Residents who already have one keep it and can still sign in, and no existing account or data is changed.'}
              </p>
              <div className="mt-4 flex gap-3">
                <PrimaryButton onClick={() => void confirm()} disabled={saving}>
                  {saving ? 'Saving…' : pending ? 'Yes, turn it ON' : 'Yes, turn it OFF'}
                </PrimaryButton>
                <SecondaryButton onClick={() => setPending(null)} disabled={saving}>
                  Cancel
                </SecondaryButton>
              </div>
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}
