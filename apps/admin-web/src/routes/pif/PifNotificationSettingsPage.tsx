import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  serverMessage,
} from '../../design-system/ConfigUI';
import { FailureState, LoadingState, UnauthorizedState } from '../../design-system/States';
import { ApiError } from '../../lib/api/client';
import {
  alertSoundUrl,
  fetchOrderAlertSound,
  replaceOrderAlertSound,
  restoreOrderAlertSound,
  type OrderAlertSound,
} from '../../lib/api/pif-admin-api';
import { useStaffAuth } from '../../lib/auth/StaffAuthContext';

/**
 * PIF NOTIFICATION SETTINGS — the order-alert sound, managed by the client.
 *
 * THE REQUIREMENT THIS MEETS: the facility changes the sound their order desk
 * hears, from their own computer, whenever they like, without a developer and
 * without a deployment. The sound is held on the SERVER, so every authorized
 * PIF staff member on every computer hears the same one, and the choice
 * survives a refresh, a logout and a different browser.
 *
 * WHAT THIS SCREEN DOES NOT DECIDE. Not whether the file is acceptable — the
 * server checks that by the file's own first bytes and by its configured size
 * limit, and every refusal shown here is the server's own sentence. The checks
 * this screen makes before uploading are a courtesy that saves a round trip,
 * never the boundary. Not who may change it either: `pif.product.manage` is
 * read from the live grant on every request, so a staff member without it is
 * refused by the API whether or not this screen offers them a button.
 *
 * PIF ONLY. Nothing here reads or writes a RIK table, a RIK permission or an
 * entitlement rule, and no order is touched.
 */

/** Human bytes, for a limit and a file size stated in the same breath. */
function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * A refusal in words.
 *
 * `serverMessage` is the house helper and passes the server's own 400 and 409
 * sentences through, which is what we want. Its 403 wording, however, names
 * RIK configuration — it was written for the RIK screens that share it — so
 * that one case is answered here instead. ConfigUI is shared with RIK and is
 * deliberately not edited.
 */
function refusalMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) {
    return 'Your account does not hold the PIF catalogue permission (pif.product.manage), so it cannot change the order-alert sound.';
  }
  return serverMessage(err);
}

function changedLabel(iso: string | null): string {
  if (iso === null) return '—';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleString();
}

export function PifNotificationSettingsPage() {
  const { session } = useStaffAuth();
  /*
   * AUTHORIZATION IS THE SERVER'S, and this only mirrors it, exactly as the
   * alert panel's Received button does. A staff member without the permission
   * still sees which sound is configured and can still play it — hearing the
   * alert is not a privilege — but the upload controls are not offered,
   * because the API would refuse them.
   */
  const mayManage = session?.permissions.includes('pif.product.manage') ?? false;

  const [current, setCurrent] = useState<OrderAlertSound | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      setCurrent(await fetchOrderAlertSound(signal));
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /** An object URL per chosen file, released when it stops being the chosen file. */
  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  /**
   * Forget the chosen file, WITHOUT touching the refusal message.
   *
   * Separate from `clearChoice` deliberately. A refused file has to be
   * forgotten — nothing may be uploaded and Save must stay disabled — while
   * the sentence explaining WHY has to stay on screen. Doing both in one
   * function is the one thing this must not do: React applies both updates in
   * the same pass, so `setRefused(null)` would wipe the message in the very
   * render that was meant to show it, and the file would be rejected in
   * silence.
   */
  const resetFile = useCallback((): void => {
    setChosen(null);
    setPreviewUrl((url) => {
      if (url !== null) URL.revokeObjectURL(url);
      return null;
    });
    if (fileRef.current !== null) fileRef.current.value = '';
  }, []);

  /** Forget the file AND any refusal: what Discard, a save and a restore want. */
  const clearChoice = useCallback((): void => {
    resetFile();
    setRefused(null);
  }, [resetFile]);

  /**
   * The courtesy checks, in the order that produces the most useful sentence.
   * The server repeats all of them and does not trust any of them.
   */
  const choose = (file: File | undefined): void => {
    setNotice(null);
    setRefused(null);
    if (file === undefined) {
      clearChoice();
      return;
    }
    const limit = current?.limitBytes ?? 2_000_000;
    if (file.size === 0) {
      setRefused('That file is empty.');
      resetFile();
      return;
    }
    if (file.size > limit) {
      setRefused(`That file is ${mb(file.size)}. The limit is ${mb(limit)}.`);
      resetFile();
      return;
    }
    if (!/\.mp3$/i.test(file.name)) {
      setRefused('The sound needs to be an MP3 file, ending in .mp3.');
      resetFile();
      return;
    }
    // Some browsers report no type at all for a local file; that is not a
    // reason to refuse, because the server checks the contents either way.
    if (file.type !== '' && file.type !== 'audio/mpeg' && file.type !== 'audio/mp3') {
      setRefused(`Your browser reports that file as "${file.type}", not MP3 audio.`);
      resetFile();
      return;
    }
    setPreviewUrl((old) => {
      if (old !== null) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    setChosen(file);
  };

  const save = async (): Promise<void> => {
    if (chosen === null) return;
    setBusy('save');
    setNotice(null);
    try {
      const next = await replaceOrderAlertSound(chosen);
      setCurrent(next);
      clearChoice();
      setNotice({
        ok: true,
        text: `Saved. "${next.filename}" is now the order-alert sound for every PIF staff member. Screens already open will pick it up when they are reloaded.`,
      });
    } catch (err) {
      setNotice({ ok: false, text: `The sound was not changed. ${refusalMessage(err)}` });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (): Promise<void> => {
    setBusy('restore');
    setNotice(null);
    try {
      const next = await restoreOrderAlertSound();
      setCurrent(next);
      clearChoice();
      setConfirmRestore(false);
      setNotice({ ok: true, text: 'Restored. The original supplied sound is active again.' });
    } catch (err) {
      setNotice({ ok: false, text: `The sound was not changed. ${refusalMessage(err)}` });
    } finally {
      setBusy(null);
    }
  };

  if (loadError !== null) {
    return <FailureState error={loadError} onRetry={() => void load()} />;
  }
  if (current === null) {
    return <LoadingState label="Reading the notification settings…" />;
  }

  /*
   * The hash makes this address change when the sound changes, so the player
   * below reloads instead of replaying a cached copy. The API ignores the
   * parameter; it exists purely to defeat the browser's media cache on this
   * one screen, which must always preview the real current file.
   */
  const activeSrc = `${alertSoundUrl()}?v=${current.sha256.slice(0, 12)}`;

  return (
    <section aria-labelledby="pif-notifications-heading">
      <h1 id="pif-notifications-heading" className="mb-1 text-xl font-bold text-brand-blueDark">
        PIF notification settings
      </h1>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        The sound the order desk hears when a new PIF order arrives. It is stored on the server, so
        every PIF staff member hears the same one on every computer. The alert itself always appears
        on screen, with or without sound.
      </p>

      {notice === null ? null : (
        <div
          role="status"
          className={[
            'mb-4 rounded-xl border px-3 py-2 text-sm font-semibold',
            notice.ok
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-rose-300 bg-rose-50 text-rose-900',
          ].join(' ')}
        >
          {notice.text}
        </div>
      )}

      {/* ------------------------------------------------------ what is active */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <h2 className="text-sm font-bold text-slate-900">Currently active sound</h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="text-slate-500">File</dt>
            <dd className="font-semibold text-slate-900">{current.filename}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Source</dt>
            <dd className="font-semibold text-slate-900">
              {current.isDefault ? 'Original supplied sound' : 'Uploaded by the facility'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Size</dt>
            <dd className="font-semibold text-slate-900">{mb(current.bytes)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Last changed</dt>
            <dd className="font-semibold text-slate-900">{changedLabel(current.updatedAt)}</dd>
          </div>
        </dl>

        <div className="mt-3">
          <FieldLabel label="Play the active sound">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="none" src={activeSrc} className="w-full max-w-md">
              Your browser cannot play audio. The alert still appears on screen.
            </audio>
          </FieldLabel>
        </div>
      </div>

      {/* --------------------------------------------------------- replacing it */}
      {!mayManage ? (
        <UnauthorizedState description="Changing the order-alert sound requires the PIF catalogue permission (pif.product.manage). You can hear the configured sound, but not replace it." />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <h2 className="text-sm font-bold text-slate-900">Replace the sound</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Choose an MP3 from this computer, listen to it, then save it. The limit is{' '}
            {mb(current.limitBytes)}. The file is checked by its contents, so renaming another kind
            of file to .mp3 will not work. A short sound of one to three seconds works best, because
            it repeats every 15 seconds until the order is marked Received.
          </p>

          <div className="mt-3">
            <FieldLabel label="MP3 file" hint="From your own computer.">
              <input
                ref={fileRef}
                type="file"
                accept="audio/mpeg,.mp3"
                onChange={(e) => choose(e.target.files?.[0])}
                className="block w-full max-w-md text-sm text-slate-700 file:mr-3 file:min-h-touch file:rounded-lg file:border file:border-slate-300 file:bg-slate-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
              />
            </FieldLabel>
          </div>

          {refused === null ? null : (
            <p role="alert" className="mt-2 text-sm font-semibold text-rose-700">
              {refused}
            </p>
          )}

          {chosen === null || previewUrl === null ? null : (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">
                Preview: {chosen.name} ({mb(chosen.size)})
              </p>
              <p className="mb-2 text-xs text-slate-500">
                Nothing has been saved yet. Listen first, then save to activate it.
              </p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls autoPlay={false} src={previewUrl} className="w-full max-w-md">
                Your browser cannot play audio.
              </audio>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={() => void save()} disabled={chosen === null || busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save and activate'}
            </PrimaryButton>
            {chosen === null ? null : (
              <SecondaryButton onClick={clearChoice} disabled={busy !== null}>
                Discard choice
              </SecondaryButton>
            )}
          </div>

          {/* ------------------------------------------------ restore the default */}
          <div className="mt-5 border-t border-slate-200 pt-4">
            <h3 className="text-sm font-bold text-slate-900">Original sound</h3>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              Returns to the sound the system was supplied with. The MP3 the facility uploaded is
              deleted from the server, so keep your own copy if you may want it again.
            </p>
            {current.isDefault ? (
              <p className="mt-2 text-sm font-semibold text-slate-600">
                The original sound is already active.
              </p>
            ) : !confirmRestore ? (
              <div className="mt-2">
                <SecondaryButton onClick={() => setConfirmRestore(true)} disabled={busy !== null}>
                  Restore original sound
                </SecondaryButton>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PrimaryButton onClick={() => void restore()} disabled={busy !== null}>
                  {busy === 'restore' ? 'Restoring…' : 'Yes, restore the original'}
                </PrimaryButton>
                <SecondaryButton onClick={() => setConfirmRestore(false)} disabled={busy !== null}>
                  Keep the uploaded sound
                </SecondaryButton>
              </div>
            )}
          </div>
        </div>
      )}

      {/*
        Standing advice, not an outcome — so deliberately NOT a live region.
        The one role="status" on this screen is the save/restore result above,
        and a second one would make both announcements ambiguous.
      */}
      <p className="mt-4 rounded-lg border border-brand-green/30 bg-brand-greenLight px-3 py-2 text-sm text-brand-greenDark">
        Each staff member still has to allow sound once per visit — browsers refuse to play audio
        until someone clicks. On a PIF screen, use Enable sound in the alert panel at the bottom
        right. Replacing the sound here does not change that, and it does not affect RIK.
      </p>
    </section>
  );
}
