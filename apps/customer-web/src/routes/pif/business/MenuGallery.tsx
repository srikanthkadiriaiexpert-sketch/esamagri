import { useEffect, useState } from 'react';
import type { MenuImage } from '../../../lib/businesses/businesses';

/**
 * The supplied menu artwork, shown as a gallery with tap-to-enlarge.
 *
 * READING A MENU ON A PHONE is the whole problem here. These are A4-shaped
 * price lists with small print; shrunk to 360 px they are legible as a
 * picture but not as prices. So each page is shown at full column width as a
 * light preview, and tapping opens the CLIENT'S ORIGINAL FILE in an overlay
 * that can be pinch-zoomed and scrolled. Nothing is cropped, redrawn or
 * retyped at either size — no item, price or name is touched.
 *
 * The overlay is a plain element, not <dialog>: jsdom has no dialog support
 * and a menu does not need modality beyond Escape and a backdrop click.
 */
export function MenuGallery({
  images,
  businessName,
}: {
  images: readonly MenuImage[];
  businessName: string;
}) {
  const [open, setOpen] = useState<MenuImage | null>(null);

  // Escape closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <ul className="flex flex-col gap-4">
        {images.map((image) => (
          <li key={image.full}>
            <figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
              <button
                type="button"
                onClick={() => setOpen(image)}
                className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-green"
                aria-label={`Enlarge ${businessName} menu — ${image.caption}`}
              >
                <img
                  src={image.preview}
                  alt={`${businessName} menu — ${image.caption}`}
                  className="block w-full"
                  loading="lazy"
                />
              </button>
              <figcaption className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {image.caption}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(image)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-brand-greenDark hover:bg-brand-greenLight focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                >
                  Tap to enlarge
                </button>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>

      {open === null ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${businessName} menu — ${open.caption}`}
          // Opaque, not translucent: at 90% the bottom navigation showed
          // faintly through a price list, which reads as a rendering fault.
          className="fixed inset-0 z-50 flex flex-col bg-neutral-950"
          onClick={() => setOpen(null)}
          data-testid="menu-lightbox"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white safe-top">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{open.caption}</p>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="shrink-0 rounded-xl bg-white/15 px-3 py-1.5 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Close
            </button>
          </div>
          {/* The original file. overflow-auto plus a natural-width image is
              what lets a phone pinch and pan around the small print. */}
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <img
              src={open.full}
              alt={`${businessName} menu — ${open.caption}`}
              className="mx-auto h-auto w-full max-w-3xl rounded-lg bg-white"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </>
  );
}
