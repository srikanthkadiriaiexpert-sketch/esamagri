import { env } from '../../env';

/**
 * An image URL the browser can load.
 *
 * TWO KINDS OF REFERENCE LIVE IN `image_ref`, AND THEY ARE SERVED BY DIFFERENT
 * ORIGINS. That distinction is the whole of this function:
 *
 *   * An UPLOADED image is stored by the API under a key, and the API turns
 *     that key into `/pif/media/...` or `/rik/media/...`. Only the API can
 *     serve it, so it gets the API's base URL.
 *   * A STATIC CATALOGUE ASSET lives in this app's own `public/` folder and is
 *     served by this app — `/catalogue/pif/category/...`,
 *     `/catalogue/rik/fresh/...`. Sending it to the API's origin asks a server
 *     that has no such route, and the picture comes back 404.
 *
 * That second case was a real defect: the PIF category pictures were attached
 * correctly, the API returned the right paths, and every card still showed its
 * placeholder because the browser was asking the API for a file the web app
 * holds. Found by loading the running demo and reading the `src` attributes,
 * not by reading the code — which is why pif-media-url.test.ts exists.
 *
 * WHY THIS LIVES IN ITS OWN MODULE. It was written for PIF and sat in
 * pif-api.ts. RIK provision pictures now need exactly the same two branches,
 * and a RIK screen importing from the PIF client to get them would be the
 * wrong dependency and would invite a second, drifting copy. One function,
 * one test, both modules. pif-api.ts re-exports it so nothing that imports it
 * from there had to change.
 *
 * WHY AN ALLOWLIST RATHER THAN "EVERYTHING EXCEPT /catalogue/". The earlier
 * form prefixed every relative path that was not `/catalogue/...`, which is
 * wrong twice over. A reference with no leading slash — and the image-
 * reference box in the admin portal accepts free text, so `rik/catalogue/
 * ghee.jpg` is a thing an administrator can type — came out as
 * `http://localhost:3000rik/catalogue/ghee.jpg`, with no separator and no
 * picture. And a reference to any other folder this app serves would have
 * been sent to the API for the same reason the `/catalogue/` defect did.
 * The honest rule is the narrow one: the API serves exactly its own two
 * media routes, and everything else belongs to this app. Caught by
 * know-your-ration.test.tsx, which already asserted the no-slash case.
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
