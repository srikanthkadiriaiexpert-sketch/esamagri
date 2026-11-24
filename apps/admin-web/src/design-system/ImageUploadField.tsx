import { useEffect, useRef, useState } from 'react';
import { SecondaryButton, PrimaryButton } from './ConfigUI';
import { isCatalogueAsset, mediaUrl } from '../lib/api/media-url';

/**
 * Attaching a photograph to one catalogue row.
 *
 * THE SHAPE OF THIS CONTROL IS A CORRECTION OF THE PIF ONE. On the PIF
 * products screen, choosing a file uploads it on the `change` event
 * (PifProductsPage.tsx) — so picking the wrong file immediately replaces the
 * live picture and deletes the old one, with no preview, no confirmation and
 * no way back short of a backup restore. Here:
 *
 *   choose  ->  SEE IT  ->  Save        nothing is sent until Save
 *   Replace                              is the same choose/see/Save
 *   Remove  ->  confirm                  because it deletes a file
 *
 * Every control is disabled while a request is in flight, so a double-click
 * cannot start two uploads whose order nobody controls.
 *
 * THE LOCAL PREVIEW IS A `blob:` URL, revoked when it is replaced or when the
 * component unmounts. It is a preview of the file on the administrator's own
 * disk and is never what gets displayed after saving — that comes back from
 * the server, so what the screen shows afterwards is what was really stored.
 *
 * A COMMITTED `/catalogue/...` PICTURE CANNOT BE SHOWN HERE. Those files live
 * in the customer app's bundle, which this origin does not serve, so the
 * control says so plainly rather than rendering a broken image. Uploading
 * over one is allowed and leaves the committed file untouched on disk.
 */
/**
 * What the control shows as the limit, and refuses before sending.
 *
 * The server is the authority — PIF_MEDIA_MAX_BYTES, which governs RIK
 * pictures too — and its refusal carries the real figure in the message. This
 * exists so a 40 MB holiday photograph is rejected in the browser instead of
 * being uploaded in order to be told no. It matches the shipped default; if an
 * operator raises the server's limit, this only means the browser is stricter
 * than it needs to be, never the reverse.
 *
 * It lives here rather than beside the API client because it is a property of
 * the control, not of the contract — and because a test that mocks the API
 * client module would otherwise blank it and render the field with no limit.
 */
export const IMAGE_MAX_BYTES = 2_000_000;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export function ImageUploadField({
  label,
  imageRef,
  imageUrl,
  maxBytes = IMAGE_MAX_BYTES,
  accept = IMAGE_ACCEPT,
  onUpload,
  onRemove,
}: {
  /** Names the row in every accessible label, e.g. a provision code. */
  label: string;
  imageRef: string | null;
  imageUrl: string | null;
  maxBytes?: number;
  accept?: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'saving' | 'removing'>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  /**
   * A file this control refused before sending it. Shown here rather than
   * handed to the page's error banner, because the page's banner reports what
   * the SERVER said and flattens anything else to "the change could not be
   * saved" — which is not what happened and not what the administrator needs
   * to read. The message belongs beside the field that produced it.
   */
  const [refused, setRefused] = useState<string | null>(null);

  // One blob URL at a time, and none left behind. Guarded because a host
  // without object URLs must degrade to "chosen, not saved yet" rather than
  // crash the row: the preview is a courtesy, saving the file is the job.
  useEffect(() => {
    if (chosen === null) {
      setPreview(null);
      return;
    }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(chosen);
    } catch {
      setPreview(null);
      return;
    }
    setPreview(url);
    return () => {
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [chosen]);

  const savedSrc = mediaUrl(imageUrl ?? imageRef);
  const savedIsCommittedAsset = isCatalogueAsset(imageUrl ?? imageRef);
  const megabytes = (maxBytes / 1_000_000).toFixed(1);

  const choose = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (file === null) return;
    // Refused in the browser so a large file is not uploaded in order to be
    // told no. The server checks again, by the file's own bytes, and its
    // answer is the authoritative one.
    if (!accept.split(',').includes(file.type)) {
      setRefused(`${file.name} is not a PNG, JPEG or WebP image.`);
      reset();
      return;
    }
    if (file.size > maxBytes) {
      setRefused(`${file.name} is ${(file.size / 1_000_000).toFixed(1)} MB. The limit is ${megabytes} MB.`);
      reset();
      return;
    }
    setRefused(null);
    setConfirmingRemove(false);
    setChosen(file);
  };

  const reset = () => {
    setChosen(null);
    // Cleared so the same file can be chosen again after a refusal.
    if (input.current) input.current.value = '';
  };

  const save = async () => {
    if (chosen === null) return;
    setBusy('saving');
    try {
      await onUpload(chosen);
      reset();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('removing');
    try {
      await onRemove();
      setConfirmingRemove(false);
      reset();
    } finally {
      setBusy(null);
    }
  };

  const working = busy !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Thumbnail
          // A committed `/catalogue/...` file is served by the customer app,
          // which is not this origin, so there is nothing to point an <img>
          // at. The placeholder says where it lives instead.
          src={preview ?? (savedIsCommittedAsset ? null : savedSrc)}
          alt={preview ? `Chosen picture for ${label}` : `Picture for ${label}`}
          placeholder={savedIsCommittedAsset && preview === null ? 'In bundle' : 'No picture'}
        />
        <div className="flex min-w-0 flex-col gap-1">
          {chosen ? (
            <p className="text-xs font-semibold text-amber-700">
              Not saved yet — press Save to store {chosen.name}.
            </p>
          ) : null}
          {refused ? (
            <p role="alert" className="text-xs font-semibold text-rose-700">
              {refused}
            </p>
          ) : null}
          {savedIsCommittedAsset && preview === null ? (
            <p className="break-all text-xs text-slate-500">
              A picture committed to the customer app, so it cannot be shown here. Uploading replaces it for
              officers and leaves the file in place.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to {megabytes} MB.</p>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept={accept}
        disabled={working}
        aria-label={`Choose a picture for ${label}`}
        onChange={choose}
        className="text-xs"
      />

      <div className="flex flex-wrap gap-2">
        {chosen === null ? null : (
          <>
            <PrimaryButton type="button" disabled={working} onClick={() => void save()}>
              {busy === 'saving' ? 'Saving…' : 'Save image'}
            </PrimaryButton>
            <SecondaryButton type="button" disabled={working} onClick={reset}>
              Discard
            </SecondaryButton>
          </>
        )}

        {imageRef === null || chosen !== null ? null : confirmingRemove ? (
          <>
            <PrimaryButton type="button" disabled={working} onClick={() => void remove()}>
              {busy === 'removing' ? 'Removing…' : 'Yes, remove it'}
            </PrimaryButton>
            <SecondaryButton type="button" disabled={working} onClick={() => setConfirmingRemove(false)}>
              Keep it
            </SecondaryButton>
          </>
        ) : (
          <SecondaryButton
            type="button"
            disabled={working}
            onClick={() => setConfirmingRemove(true)}
            aria-label={`Remove the picture for ${label}`}
          >
            Remove image
          </SecondaryButton>
        )}
      </div>
    </div>
  );
}

/**
 * A square thumbnail that degrades to a label.
 *
 * `image_ref` is a database value and the picture is a file; the two can
 * disagree — after a restore to an earlier snapshot, for instance. An
 * `onError` fallback is the difference between a readable table and a column
 * of broken-image glyphs.
 */
export function Thumbnail({
  src,
  alt,
  placeholder,
  size = 'md',
}: {
  src: string | null;
  alt: string;
  placeholder: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'h-10 w-10' : 'h-16 w-16';

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src === null || failed) {
    return (
      <div
        role="img"
        aria-label={placeholder}
        className={`${box} flex shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-1 text-center text-[10px] leading-tight text-slate-400`}
      >
        {placeholder}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className={`${box} shrink-0 rounded-lg border border-slate-200 bg-white object-cover`}
    />
  );
}
