import { useState } from 'react';
import type { FormEvent } from 'react';
import { useResource } from '../../lib/api/resource';
import {
  createNewArrival,
  fetchNewArrivals,
  removeNewArrival,
  removeNewArrivalImage,
  setNewArrivalPublished,
  uploadNewArrivalImage,
  updateNewArrival,
  type NewArrivalListing,
} from '../../lib/api/rik-config-api';
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
 * New Arrivals — which existing RIK products to put in the shop window.
 *
 * MERCHANDISING, NOT ENTITLEMENT. Nothing on this screen changes what an
 * officer may take, how much of it, or whether they are eligible. It decides
 * one thing: which products the customer app highlights as newly introduced.
 * A product can be featured here and still be unavailable to a given officer,
 * and that is correct — Know Your Ration is the only screen that answers an
 * allowance.
 *
 * ONLY EXISTING PRODUCTS. The picker lists the real RIK catalogue. There is
 * no "create product" path on this screen and none behind it: the API takes a
 * provision id and refuses anything that is not one, so a PIF product cannot
 * be listed even by a hand-made request.
 *
 * REMOVE MEANS UNLIST. The remove button says so, and asks first, because
 * "remove" on a screen full of products is exactly the word somebody will
 * worry about. The underlying provision is never touched — the server's reply
 * states `provisionDeleted: false` and this screen repeats it back.
 *
 * DRAFT FIRST. A new listing is created unpublished, so an entry can be
 * prepared and checked before any customer sees it. Publishing is a separate,
 * deliberate click.
 */
/**
 * Thrown when the server reports something that must never happen. It carries
 * no message of its own: the sentence is already on screen in the alarm
 * banner, and letting it reach `setError` as well would stack a second,
 * generic alert underneath the specific one.
 */
class IntegrityAlarm extends Error {}

export function NewArrivalsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const listings = useResource(() => fetchNewArrivals(), [reloadKey]);

  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * An INTEGRITY ALARM, kept separate from `error` on purpose.
   *
   * `error` carries a refusal the server meant to send, and ConfigError
   * renders it through `serverMessage`, which flattens anything that is not
   * an ApiError into a generic sentence. These two conditions — the product
   * reported deleted, the catalogue image reported changed — are things that
   * must never happen, so their wording has to survive verbatim and be
   * impossible to miss. A generic "something went wrong" would bury exactly
   * the message somebody needs to act on.
   */
  const [alarm, setAlarm] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => setReloadKey((k) => k + 1);

  async function act<T>(id: string, action: () => Promise<T>, message: string) {
    setError(null);
    setNotice(null);
    setAlarm(null);
    setBusyId(id);
    try {
      await action();
      setNotice(message);
      reload();
    } catch (err) {
      // An alarm has already put its own, specific sentence on screen.
      if (!(err instanceof IntegrityAlarm)) setError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-lg font-semibold text-slate-900">New Arrivals</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Announce something new to customers: type a name, add a picture, publish. This is a display setting
          only — it does not change entitlement, eligibility, pack sizes or availability, and it never creates,
          changes or deletes a RIK product.
        </p>
      </header>

      {alarm ? (
        <p role="alert" className="rounded-xl border-2 border-red-500 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {alarm}
        </p>
      ) : null}
      {notice ? <ConfigNotice>{notice}</ConfigNotice> : null}
      <ConfigError error={error} />

      <AddForm
        disabled={listings.status !== 'success'}
        onCreated={(name) => {
          setNotice(`"${name}" saved as a draft. Upload its image, then press Publish to show it to customers.`);
          setError(null);
          reload();
        }}
        onError={(err) => {
          setError(err);
          setNotice(null);
        }}
      />

      {listings.status === 'loading' ? <LoadingState label="Loading New Arrivals…" /> : null}
      {listings.status === 'error' ? <FailureState error={listings.error} onRetry={reload} /> : null}
      {listings.status === 'success' && listings.data.items.length === 0 ? (
        <EmptyState
          title="Nothing is featured yet"
          description="Add a product above: type its name, save the draft, upload a picture, then publish. Customers see an empty New Arrivals screen until something here is published."
        />
      ) : null}

      {/*
        `head` is a FRAGMENT of <Th> cells, not a <tr>. ConfigTable already
        renders <thead><tr>{head}</tr></thead>, so wrapping them in a row of
        their own nests one <tr> inside another — invalid markup that React
        warns about and that the browser silently recovers from. Every other
        screen using ConfigTable passes a fragment; this one did not.
      */}
      {listings.status === 'success' && listings.data.items.length > 0 ? (
        <ConfigTable
          caption="RIK products currently featured as New Arrivals"
          head={
            <>
              <Th>Product</Th>
              <Th>Promotional image</Th>
              <Th>Headline</Th>
              <Th>Shown</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </>
          }
        >
          {listings.data.items.map((listing) => (
            <ListingRow
              key={listing.id}
              listing={listing}
              busy={busyId === listing.id}
              onPublish={(next) =>
                act(
                  listing.id,
                  () => setNewArrivalPublished(listing.id, next),
                  next
                    ? `"${listing.name}" is now live in the customer app.`
                    : `"${listing.name}" is no longer shown to customers.`
                )
              }
              onHeadline={(headline) =>
                act(listing.id, () => updateNewArrival(listing.id, { headline }), `Headline saved for "${listing.name}".`)
              }
              onRename={(productName) =>
                act(
                  listing.id,
                  () => updateNewArrival(listing.id, { productName }),
                  `Renamed to "${productName}".`
                )
              }
              /*
                Both image handlers report the failure AND rethrow.

                Reporting puts the server's own sentence on the screen —
                "that file is not a PNG, JPEG or WebP image" — instead of a
                silent no-op. Rethrowing lets ImageUploadField keep the chosen
                file, so the next press of Save is a retry rather than a
                re-selection. Swallowing the error would do neither.
              */
              onUploadImage={async (file) => {
                setError(null);
                setNotice(null);
                setAlarm(null);
                try {
                  await uploadNewArrivalImage(listing.id, file);
                  setNotice(
                    listing.standalone
                      ? `Image saved for "${listing.name}". You can publish it now.`
                      : `Promotional image saved for "${listing.name}". The product's own catalogue image is unchanged.`
                  );
                  reload();
                } catch (err) {
                  if (!(err instanceof IntegrityAlarm)) setError(err);
                  throw err;
                }
              }}
              onRemoveImage={async () => {
                setError(null);
                setNotice(null);
                setAlarm(null);
                try {
                  const result = await removeNewArrivalImage(listing.id);
                  if (result.provisionImageChanged) {
                    setAlarm(
                      `The server reported that the catalogue image for "${listing.name}" changed while removing its promotional image, which must never happen. Do not continue — report this.`
                    );
                    throw new IntegrityAlarm('provisionImageChanged');
                  }
                  setNotice(
                    result.unpublished
                      ? `Image removed from "${listing.name}". A listing cannot be shown without a picture, so it has been unpublished — upload a new image to publish it again.`
                      : listing.standalone
                        ? `Image removed from "${listing.name}".`
                        : `Promotional image removed from "${listing.name}". It now shows the product's catalogue image.`
                  );
                  reload();
                } catch (err) {
                  if (!(err instanceof IntegrityAlarm)) setError(err);
                  throw err;
                }
              }}
              onRemove={() =>
                act(
                  listing.id,
                  async () => {
                    const result = await removeNewArrival(listing.id);
                    if (result.provisionDeleted) {
                      setAlarm(
                        `The server reported that the product "${listing.name}" itself was deleted, which must never happen. Do not continue — report this.`
                      );
                      throw new IntegrityAlarm('provisionDeleted');
                    }
                  },
                  listing.standalone
                    ? `"${listing.name}" removed from New Arrivals.`
                    : `"${listing.name}" removed from New Arrivals. The product is still in the RIK catalogue.`
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
 * Manual entry. Type a name, optionally a line of copy and a date window,
 * and save.
 *
 * NO CATALOGUE PICKER. A New Arrivals card is an announcement, so staff are
 * not made to find — or create — an entitlement product before they can put
 * one up. The listing references nothing, which is also why it cannot carry
 * a RIK or a PIF product id across a module boundary.
 *
 * ALWAYS A DRAFT. The picture is uploaded to the row once it exists, which
 * is what keeps the existing validated upload path (magic-byte check,
 * generated file key, row updated before the old file is deleted) in use
 * unchanged. The server refuses to create a standalone listing already
 * published for exactly that reason, so the two-step order is enforced on
 * both sides rather than only in this form.
 */
function AddForm({
  disabled,
  onCreated,
  onError,
}: {
  disabled: boolean;
  onCreated: (name: string) => void;
  onError: (err: unknown) => void;
}) {
  const [productName, setProductName] = useState('');
  const [headline, setHeadline] = useState('');
  const [publishedFrom, setPublishedFrom] = useState('');
  const [publishedUntil, setPublishedUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(true);

  const trimmedName = productName.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmedName === '') return;
    setSaving(true);
    try {
      await createNewArrival({
        productName: trimmedName,
        headline: headline.trim() === '' ? null : headline.trim(),
        publishedFrom: publishedFrom === '' ? null : publishedFrom,
        publishedUntil: publishedUntil === '' ? null : publishedUntil,
        // Always a draft. Publishing is a separate, deliberate action, and
        // the image has to be attached before it is possible at all.
        isPublished: false,
      });
      setProductName('');
      setHeadline('');
      setPublishedFrom('');
      setPublishedUntil('');
      onCreated(trimmedName);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AddPanel title="Add a New Arrival" open={open} onToggle={() => setOpen((v) => !v)}>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <FieldLabel
          label="Product name"
          hint="What customers will see as the title of the card. Up to 140 characters."
        >
          <TextInput
            value={productName}
            maxLength={140}
            required
            onChange={(e) => setProductName(e.target.value)}
            placeholder="e.g. Himalayan Pink Salt"
            aria-label="Product name"
          />
        </FieldLabel>

        <FieldLabel
          label="Headline / description (optional)"
          hint="A short line shown under the name, up to 140 characters."
        >
          <TextInput
            value={headline}
            maxLength={140}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="e.g. Now in a 1 kg pack"
          />
        </FieldLabel>

        <FieldLabel label="Show from (optional)" hint="Leave blank to show as soon as you publish it.">
          <TextInput type="date" value={publishedFrom} onChange={(e) => setPublishedFrom(e.target.value)} />
        </FieldLabel>

        <FieldLabel label="Show until (optional)" hint="Leave blank to keep showing until you unpublish it.">
          <TextInput type="date" value={publishedUntil} onChange={(e) => setPublishedUntil(e.target.value)} />
        </FieldLabel>

        <div className="md:col-span-2">
          <PrimaryButton type="submit" disabled={saving || disabled || trimmedName === ''}>
            {saving ? 'Saving…' : 'Save as draft'}
          </PrimaryButton>
          <p className="mt-2 text-xs text-slate-500">
            Saved as a draft. Upload an image on its row below, then press Publish — a listing cannot go live
            without a picture.
          </p>
        </div>
      </form>
    </AddPanel>
  );
}

function ListingRow({
  listing,
  busy,
  onPublish,
  onHeadline,
  onRename,
  onRemove,
  onUploadImage,
  onRemoveImage,
}: {
  listing: NewArrivalListing;
  busy: boolean;
  onPublish: (next: boolean) => void;
  onHeadline: (headline: string | null) => void;
  onRename: (productName: string) => void;
  onRemove: () => void;
  onUploadImage: (file: File) => Promise<void>;
  onRemoveImage: () => Promise<void>;
}) {
  const [headline, setHeadline] = useState(listing.headline ?? '');
  const [name, setName] = useState(listing.productName ?? '');
  const [confirming, setConfirming] = useState(false);
  const dirty = (listing.headline ?? '') !== headline;
  // Renaming applies to a standalone listing only: a linked one takes its
  // name from the catalogue, and the server refuses to rename it here.
  const nameDirty = listing.standalone && name.trim() !== '' && name.trim() !== (listing.productName ?? '');
  /**
   * Does the LISTING own its picture, or is it borrowing the product's? The
   * server answers this directly, so the screen never has to infer it from
   * the shape of a storage key.
   */
  const hasOwnImage = listing.hasOwnImage;

  return (
    <tr>
      <Td>
        {listing.standalone ? (
          <>
            <TextInput
              value={name}
              maxLength={140}
              onChange={(e) => setName(e.target.value)}
              aria-label={`Product name for ${listing.name}`}
            />
            {nameDirty ? (
              <SecondaryButton type="button" disabled={busy} onClick={() => onRename(name.trim())}>
                Save name
              </SecondaryButton>
            ) : null}
          </>
        ) : (
          <span className="font-medium text-slate-900">
            {listing.brand ? `${listing.brand} ${listing.name}` : listing.name}
          </span>
        )}
        {/*
          Catalogue facts exist only on a listing deliberately linked to a
          provision. A standalone listing has none, so the sub-line is built
          from whatever is present and omitted entirely when nothing is.
        */}
        {listing.code || listing.poolName ? (
          <span className="block text-xs text-slate-500">
            {[listing.code, listing.poolName].filter(Boolean).join(' · ')}
          </span>
        ) : null}
        {listing.provisionIsActive === false ? (
          <span className="mt-1 block text-xs font-medium text-amber-700">
            This product is retired, so customers will not see it even while published.
          </span>
        ) : null}
      </Td>

      {/*
        PROMOTIONAL IMAGE — a SECOND picture, belonging to this listing.

        `imageRef` carries the listing's own upload when it has one and the
        product's catalogue picture when it does not, so the thumbnail always
        shows what a customer would see. The distinction matters for the
        controls: `hasOwnImage` is what decides whether Remove is offered,
        because removing is only ever meaningful for a picture this listing
        owns. There is no control here that can reach the product's own.
      */}
      <Td>
        <ImageUploadField
          label={`${listing.name} image`}
          imageRef={listing.imageRef}
          imageUrl={listing.effectiveImageUrl}
          onUpload={onUploadImage}
          onRemove={onRemoveImage}
        />
        <span className="mt-1 block max-w-[16rem] text-xs text-slate-500">
          {listing.standalone
            ? hasOwnImage
              ? 'Shown on the customer card. Removing it also unpublishes the listing, because a card cannot be shown without a picture.'
              : 'Required before this listing can be published.'
            : hasOwnImage
              ? 'Shown instead of the catalogue image. Removing it falls back to the catalogue image; the product keeps its own picture either way.'
              : 'Optional. With none set, the customer card shows the product’s catalogue image.'}
        </span>
      </Td>

      <Td>
        <TextInput
          value={headline}
          maxLength={140}
          onChange={(e) => setHeadline(e.target.value)}
          aria-label={`Headline for ${listing.name}`}
          placeholder="—"
        />
        {dirty ? (
          <SecondaryButton
            type="button"
            disabled={busy}
            onClick={() => onHeadline(headline.trim() === '' ? null : headline.trim())}
          >
            Save headline
          </SecondaryButton>
        ) : null}
      </Td>

      <Td>
        <span className="text-xs text-slate-600">
          {listing.publishedFrom ?? 'immediately'} → {listing.publishedUntil ?? 'until unpublished'}
        </span>
      </Td>

      <Td>
        {listing.isPublished ? (
          <span className="font-medium text-emerald-700">Live</span>
        ) : (
          <span className="font-medium text-slate-500">Draft</span>
        )}
      </Td>

      <Td>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={() => onPublish(!listing.isPublished)}>
            {listing.isPublished ? 'Unpublish' : 'Publish'}
          </SecondaryButton>

          {confirming ? (
            <>
              <SecondaryButton
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  onRemove();
                }}
              >
                Yes, unlist it
              </SecondaryButton>
              <SecondaryButton type="button" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </SecondaryButton>
            </>
          ) : (
            <SecondaryButton
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              title="Removes it from New Arrivals. The product stays in the RIK catalogue."
            >
              Remove from New Arrivals
            </SecondaryButton>
          )}
        </div>
        {confirming ? (
          <p className="mt-1 text-xs text-slate-600">
            {listing.standalone ? (
              <>
                This deletes the <strong>{listing.name}</strong> listing and its uploaded picture. No RIK product
                is affected — this listing never referenced one.
              </>
            ) : (
              <>
                This removes the listing only. <strong>{listing.name}</strong> stays in the RIK catalogue with its
                pack size, entitlement rules and history unchanged.
              </>
            )}
          </p>
        ) : null}
      </Td>
    </tr>
  );
}
