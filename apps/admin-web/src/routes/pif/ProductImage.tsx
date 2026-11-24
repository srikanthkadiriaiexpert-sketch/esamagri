import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { mediaUrl } from '../../lib/api/pif-admin-api';

export interface ProductImageProps {
  /** `imageUrl` as the API reported it, or null when the product has none. */
  url: string | null;
  alt: string;
  className?: string;
  /** Shown when there is no picture, or the stored one will not load. */
  fallback: ReactNode;
}

/**
 * A product picture that degrades to its placeholder (PHASE F verification).
 *
 * FOUND BY VERIFYING THE RUNNING APP. A product's `image_ref` is a database
 * key; the picture is a FILE under PIF_MEDIA_ROOT. The two can disagree — a
 * media volume restored without its files, a file removed, a CDN that has
 * not caught up — and the catalogue screen then drew nine broken-image
 * glyphs for rows whose `image_ref` pointed at files that were no longer
 * there. The row is not wrong and the data is not lost; only the file is
 * missing, and the honest thing to show is the same "no picture" placeholder
 * a product without one shows, so the administrator can see which products
 * need a new upload.
 */
export function ProductImage({ url, alt, className, fallback }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(url);

  // A replacement upload gets a new key, and deserves a fresh attempt.
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src === null || failed) return <>{fallback}</>;

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
}
