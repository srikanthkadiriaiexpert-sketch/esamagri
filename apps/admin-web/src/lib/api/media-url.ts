import { env } from '../../env';

/**
 * An image URL the browser can load.
 *
 * TWO KINDS OF REFERENCE LIVE IN `image_ref` AND THEY ARE SERVED BY DIFFERENT
 * ORIGINS, which is the whole of this function:
 *
 *   * An UPLOADED image is stored by the API and addressed as `/pif/media/...`
 *     or `/rik/media/...`. The admin app runs on a different origin, so the
 *     API's base has to be put back in front of it.
 *   * ANY OTHER REFERENCE belongs to the CUSTOMER app, not to the API and not
 *     to this one — the 180 committed `/catalogue/rik/...` provision pictures
 *     and every `/catalogue/pif/category/...` cover. Sending one to the API
 *     asks a server with no such route and the picture comes back 404.
 *
 * THE PIF COPY OF THIS FUNCTION DID NOT HAVE THE SECOND BRANCH. It prefixed
 * every relative path, which was harmless only because the admin app never
 * rendered a `/catalogue/...` reference. The RIK provisions table renders
 * exactly those, so the omission would have reproduced the defect that
 * customer-web's pif-media-url.test.ts was written for. pif-admin-api.ts now
 * re-exports this function, so PIF picks the fix up too.
 *
 * The allowlist is deliberately narrow: a reference with no leading slash
 * (the image-reference box accepts free text) must be left alone rather than
 * concatenated into `http://host:3000rik/catalogue/ghee.jpg`.
 *
 * A `/catalogue/...` picture will not display inside the admin portal, because
 * the customer app serves it and nothing proxies that across. Showing it as
 * "not shown here" is honest; prefixing it with an origin that 404s is not.
 */
const API_MEDIA_ROUTES = ['/pif/media/', '/rik/media/'];

export function mediaUrl(url: string | null): string | null {
  if (url === null) return null;
  if (/^https?:\/\//.test(url)) return url;
  if (API_MEDIA_ROUTES.some((route) => url.startsWith(route))) {
    return `${env.VITE_API_BASE_URL}${url}`;
  }
  return url;
}

/** True when this reference is a committed asset of the customer app, not an upload. */
export function isCatalogueAsset(url: string | null): boolean {
  return url !== null && !/^https?:\/\//.test(url) && !API_MEDIA_ROUTES.some((r) => url.startsWith(r));
}
