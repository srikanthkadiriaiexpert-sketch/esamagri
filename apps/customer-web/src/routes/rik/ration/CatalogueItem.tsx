import { useEffect, useState } from 'react';
import { mediaUrl } from '../../../lib/api/media-url';

/**
 * How a catalogue item introduces itself to an officer (STEP 12A).
 *
 * Four things, in this order, and nothing else:
 *
 *   picture · provision name · brand · pack size and unit
 *
 * What is deliberately absent is as much the point as what is present.
 * No provision id, no pool id, no code, no "SKU", no "consumption
 * ratio", no pool name — those are how the facility files the item, not
 * how anyone asks for it at the counter. The one place a customer ever
 * sees the pool is as the plain-language category heading the server
 * already supplies.
 *
 * The brand is shown from its own field. It is never read out of the
 * name and never written back into it, which is what lets Paneer from
 * two dairies be one item offered twice rather than two items that look
 * like duplicates.
 *
 * The picture is whatever reference the facility recorded. Nothing here
 * looks a picture up, fetches one from elsewhere or falls back to a
 * lookalike: an item with no recorded image gets the placeholder below,
 * and so does one whose recorded image fails to load. An empty frame is
 * honest; a borrowed photograph of somebody else's tin is not.
 */

export interface CatalogueFields {
  name: string;
  brand: string | null;
  imageRef: string | null;
  packSize: number | null;
  unit: string;
  packUnit: string | null;
}

/** The placeholder. A carton outline — it depicts nothing in particular. */
function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-100"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-slate-400" fill="none" aria-hidden="true">
        <path
          d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M4 8.5 12 13l8-4.5M12 13v7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function ProvisionImage({ item }: { item: CatalogueFields }) {
  const [failed, setFailed] = useState(false);
  // Two kinds of reference arrive here and they are served by different
  // origins: a committed `/catalogue/rik/...` asset this app holds, and an
  // uploaded `/rik/media/...` address only the API can serve. mediaUrl is
  // the one place that distinction is made.
  const src = mediaUrl(item.imageRef);

  // A replacement upload gets a new key, and deserves a fresh attempt.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src === null || failed) {
    return <ImagePlaceholder label={`No picture recorded for ${item.name}`} />;
  }

  return (
    <img
      src={src}
      alt={item.name}
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
    />
  );
}

/**
 * The brand line. Rendered only where a brand was recorded — an item
 * with no brand simply has one fewer line, rather than a line reading
 * "Unbranded", which would tell an officer nothing they wanted.
 */
export function ProvisionBrand({ brand }: { brand: string | null }) {
  if (brand === null) return null;
  return <p className="mt-0.5 text-xs font-medium text-slate-600">{brand}</p>;
}

/**
 * A category's cover picture, for the Know Your Ration list (STEP 14B).
 *
 * The catalogue has two levels of picture and they are not
 * interchangeable. A provision picture shows the item an officer takes;
 * this one is the cover of a whole allowance — Milk, Meat, Cereals —
 * and comes from the entitlement pool's own row. A category with no
 * picture recorded is the ordinary case today and gets the same
 * placeholder the provision rows use, so the list stays even.
 */
export function CategoryImage({ name, imageRef }: { name: string; imageRef: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(imageRef);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src === null || failed) {
    return <ImagePlaceholder label={`No picture recorded for ${name}`} />;
  }

  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="h-14 w-14 shrink-0 rounded-xl border border-slate-200 bg-white object-cover"
    />
  );
}
