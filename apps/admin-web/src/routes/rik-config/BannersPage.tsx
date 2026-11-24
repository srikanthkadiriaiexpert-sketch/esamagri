import { useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createBanner,
  fetchBanners,
  removeBanner,
  removeBannerImage,
  setBannerPublished,
  updateBanner,
  uploadBannerImage,
  type BannerListing,
} from '../../lib/api/rik-banners-api';
import { ImageUploadField } from '../../design-system/ImageUploadField';
import { LoadingState, EmptyState, FailureState } from '../../design-system/States';
import {
  AddPanel,
  ConfigError,
  ConfigNotice,
  ConfigTable,
  FieldLabel,
  PrimaryButton,
  SecondaryButton,
  Td,
  TextInput,
  Th,
} from '../../design-system/ConfigUI';

/**
 * Seasonal promotional banners — Diwali, Sankranti, Christmas, a summer
 * offer — for the customer home screen.
 *
 * WHAT THIS SCREEN CANNOT DO, AND SHOULD NEVER APPEAR TO. It cannot touch
 * the e-Samagri hero. That banner is a committed brand asset rendered by the
 * customer app itself; it is permanent, it is not stored in any table, and
 * nothing on this page addresses it. Everything managed here renders BELOW
 * it. With no banner published the customer home screen is exactly what it
 * is today — which is why the empty state below says so in those words,
 * rather than reading as though something is missing.
 *
 * IT CHANGES NO ENTITLEMENT. No pool, scale, conversion, provision, pack
 * size, availability rule or voucher is read or written from here. A
 * seasonal picture cannot alter what any officer is entitled to.
 *
 * THE ORDER OF WORK, and why the screen enforces it: title first, then the
 * picture, then publish. A banner IS its picture, so the server refuses to
 * publish one without an image — and this page keeps the Publish button
 * disabled until there is one, so an administrator meets the rule as
 * guidance rather than as a refusal.
 */
export function BannersPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const banners = useResource(() => fetchBanners(), [reloadKey]);

  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => setReloadKey((k) => k + 1);

  async function act<T>(id: string, action: () => Promise<T>, message: string) {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      await action();
      setNotice(message);
      reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">Seasonal banners</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Promotional pictures for the customer home screen — a festival, a seasonal offer, a new range. They
          appear <strong>below</strong> the permanent e-Samagri banner, never in place of it, and only between
          the dates you set. This is a display setting only: it does not change entitlement, eligibility, pack
          sizes, availability or any product.
        </p>
      </header>

      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      <ConfigError error={error} />

      <AddForm
        disabled={banners.status !== 'success'}
        onCreated={(title) => {
          setNotice(`"${title}" saved as a draft. Upload its picture on the row below, then press Publish.`);
          setError(null);
          reload();
        }}
        onError={(err) => {
          setError(err);
          setNotice(null);
        }}
      />

      {banners.status === 'loading' ? <LoadingState label="Loading banners…" /> : null}
      {banners.status === 'error' ? <FailureState error={banners.error} onRetry={reload} /> : null}
      {banners.status === 'success' && banners.data.length === 0 ? (
        <EmptyState
          title="No seasonal banners"
          description="The customer home screen is showing the permanent e-Samagri banner on its own, which is the normal state. Add one above to run a festival or seasonal promotion alongside it."
        />
      ) : null}

      {banners.status === 'success' && banners.data.length > 0 ? (
        <ConfigTable
          caption="Seasonal banners shown below the permanent home-screen banner"
          head={
            <>
              <Th>Title</Th>
              <Th>Picture</Th>
              <Th>Description</Th>
              <Th>Shown</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </>
          }
        >
          {banners.data.map((banner) => (
            <BannerRow
              key={banner.id}
              banner={banner}
              busy={busyId === banner.id}
              onPublish={(next) =>
                act(
                  banner.id,
                  () => setBannerPublished(banner.id, next),
                  next
                    ? `"${banner.title}" is now live on the customer home screen.`
                    : `"${banner.title}" is no longer shown to customers.`
                )
              }
              onField={(patch, what) =>
                act(banner.id, () => updateBanner(banner.id, patch), `${what} saved for "${banner.title}".`)
              }
              onUpload={async (file) => {
                await uploadBannerImage(banner.id, file);
                setNotice(`Picture saved for "${banner.title}".`);
                setError(null);
                reload();
              }}
              onRemoveImage={async () => {
                const after = await removeBannerImage(banner.id);
                setNotice(
                  after.unpublished
                    ? `Picture removed from "${banner.title}". It has been unpublished, because a banner cannot be shown without one.`
                    : `Picture removed from "${banner.title}".`
                );
                setError(null);
                reload();
              }}
              onDelete={() =>
                act(
                  banner.id,
                  () => removeBanner(banner.id),
                  `"${banner.title}" deleted. No product or entitlement was affected.`
                )
              }
            />
          ))}
        </ConfigTable>
      ) : null}
    </section>
  );
}

/**
 * Create the banner row.
 *
 * Title and dates only. The picture is uploaded on the row afterwards,
 * because the file has to be attached to a banner that already exists — and
 * because that order lets the administrator see the preview against the real
 * row rather than in a form that has not been saved.
 */
function AddForm({
  disabled,
  onCreated,
  onError,
}: {
  disabled: boolean;
  onCreated: (title: string) => void;
  onError: (err: unknown) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [saving, setSaving] = useState(false);
  // Open by default, exactly as the New Arrivals panel is: an administrator
  // who opened this screen came here to add something.
  const [open, setOpen] = useState(true);

  const trimmed = title.trim();
  const windowInverted = startsOn !== '' && endsOn !== '' && endsOn < startsOn;
  const canSave = trimmed.length > 0 && !windowInverted && !saving && !disabled;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await createBanner({
        title: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        startsOn: startsOn === '' ? null : startsOn,
        endsOn: endsOn === '' ? null : endsOn,
      });
      setTitle('');
      setDescription('');
      setStartsOn('');
      setEndsOn('');
      onCreated(trimmed);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AddPanel title="Add a seasonal banner" open={open} onToggle={() => setOpen((v) => !v)}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <FieldLabel
          label="Title"
          hint="Shown to staff on this list, and read aloud to a customer whose screen reader describes the picture."
        >
          <TextInput
            value={title}
            maxLength={140}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Diwali offers"
            aria-label="Banner title"
          />
        </FieldLabel>

        <FieldLabel label="Description (optional)" hint="One short line under the picture.">
          <TextInput
            value={description}
            maxLength={400}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Sweets and dry fruits, all week"
            aria-label="Banner description"
          />
        </FieldLabel>

        <FieldLabel label="Show from (optional)" hint="Leave blank to show as soon as you publish it.">
          <TextInput
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            aria-label="Show banner from"
          />
        </FieldLabel>

        <FieldLabel label="Show until (optional)" hint="Leave blank to keep showing until you unpublish it.">
          <TextInput
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            aria-label="Show banner until"
          />
        </FieldLabel>

        <div className="sm:col-span-2">
          {windowInverted ? (
            <p role="alert" className="mb-2 text-sm font-semibold text-red-700">
              The end date is before the start date, so this banner would never appear.
            </p>
          ) : null}
          <PrimaryButton type="submit" disabled={!canSave}>
            {saving ? 'Saving…' : 'Save as draft'}
          </PrimaryButton>
          <p className="mt-1 text-xs text-slate-600">
            Saved as a draft. Upload its picture on the row below, then press Publish — a banner cannot go live
            without one.
          </p>
        </div>
      </form>
    </AddPanel>
  );
}

function BannerRow({
  banner,
  busy,
  onPublish,
  onField,
  onUpload,
  onRemoveImage,
  onDelete,
}: {
  banner: BannerListing;
  busy: boolean;
  onPublish: (next: boolean) => void;
  onField: (patch: { title?: string; description?: string | null; startsOn?: string | null; endsOn?: string | null }, what: string) => void;
  onUpload: (file: File) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(banner.title);
  const [description, setDescription] = useState(banner.description ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <tr className="align-top">
      <Td>
        <TextInput
          value={title}
          maxLength={140}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next !== '' && next !== banner.title) onField({ title: next }, 'Title');
            else setTitle(banner.title);
          }}
          aria-label={`Title for ${banner.title}`}
        />
      </Td>

      <Td>
        <ImageUploadField
          label={banner.title}
          imageRef={banner.imageRef}
          imageUrl={banner.imageUrl}
          onUpload={onUpload}
          onRemove={onRemoveImage}
        />
      </Td>

      <Td>
        <TextInput
          value={description}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const next = description.trim();
            if (next !== (banner.description ?? '')) onField({ description: next === '' ? null : next }, 'Description');
          }}
          aria-label={`Description for ${banner.title}`}
        />
      </Td>

      <Td>
        <div className="flex flex-col gap-1">
          <TextInput
            type="date"
            value={banner.startsOn ?? ''}
            onChange={(e) => onField({ startsOn: e.target.value === '' ? null : e.target.value }, 'Start date')}
            aria-label={`Show ${banner.title} from`}
          />
          <TextInput
            type="date"
            value={banner.endsOn ?? ''}
            onChange={(e) => onField({ endsOn: e.target.value === '' ? null : e.target.value }, 'End date')}
            aria-label={`Show ${banner.title} until`}
          />
        </div>
      </Td>

      <Td>
        {banner.isPublished ? (
          <span className="font-semibold text-green-700">Live</span>
        ) : (
          <span className="text-slate-600">Draft</span>
        )}
      </Td>

      <Td>
        <div className="flex flex-col gap-2">
          {banner.isPublished ? (
            <SecondaryButton type="button" disabled={busy} onClick={() => onPublish(false)}>
              Unpublish
            </SecondaryButton>
          ) : (
            <>
              <PrimaryButton type="button" disabled={busy || !banner.hasImage} onClick={() => onPublish(true)}>
                Publish
              </PrimaryButton>
              {banner.hasImage ? null : (
                <p className="text-xs text-slate-600">Upload a picture first.</p>
              )}
            </>
          )}

          {confirmingDelete ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold text-red-700">Delete this banner and its picture?</p>
              <div className="flex gap-2">
                <SecondaryButton type="button" disabled={busy} onClick={onDelete}>
                  Yes, delete
                </SecondaryButton>
                <SecondaryButton type="button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <SecondaryButton type="button" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Delete
            </SecondaryButton>
          )}
        </div>
      </Td>
    </tr>
  );
}
