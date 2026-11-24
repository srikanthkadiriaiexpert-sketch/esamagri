import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface RemoteImageProps {
  /** The URL the server gave, or null/undefined when there is none. */
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** What to show instead: no URL, or a URL that would not load. */
  fallback: ReactNode;
}

/**
 * An image that falls back to a placeholder when it cannot be loaded.
 *
 * WHY THIS EXISTS, FOUND IN VERIFICATION. A product's `image_ref` is a key in
 * the database and the picture itself is a FILE on the API's media volume.
 * Those two can disagree — a volume restored without its files, a file
 * cleaned up, a CDN that has not caught up — and when they do, the row still
 * says "this product has a picture" while the request for it answers 404.
 * The browser then draws its own broken-image glyph, which is the one thing
 * on a shop screen that makes a facility look unmaintained.
 *
 * So the rule is: a URL is a CLAIM, not a guarantee. If the claim fails, this
 * shows the same placeholder a product with no picture shows. Nothing is
 * hidden from anyone — the administrator still sees the product and can
 * upload a new picture, and the customer sees a clean card instead of a
 * broken one.
 */
export function RemoteImage({ src, alt, className, fallback }: RemoteImageProps) {
  const [failed, setFailed] = useState(false);

  // A new URL deserves a fresh attempt: replacing a picture must not inherit
  // the previous one's failure.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src === null || src === undefined || src === '' || failed) {
    return <>{fallback}</>;
  }

  // Lazy + async so a list of photographs never blocks first paint, and
  // `onError` keeps the graceful fallback for a picture that has gone.
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
