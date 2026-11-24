import { apiRequest } from './client';
import { mediaUrl } from './media-url';

/**
 * The seasonal banners the customer home screen shows today.
 *
 * NOT THE HERO. The home screen's permanent hero is a committed brand asset
 * rendered by HomePage.tsx's own HeroBanner component. It is not fetched, not
 * configurable and not addressable from here. This module returns the
 * OPTIONAL seasonal pictures that render beneath it, and an empty list — the
 * normal state — leaves the home screen exactly as it is.
 *
 * COMMON CONTENT, NOT RIK CONTENT. This reads `/content/banners`, which
 * requires a customer rather than a ration-approved customer. It used to
 * read `/rik/banners`, and that is why a PIF-only resident's home screen had
 * no promotional banners: the request 403'd and this module's silent-failure
 * rule — correct in itself — turned the refusal into an empty space nobody
 * could see the cause of. The file name is historical.
 *
 * The server does the date arithmetic. It returns only banners that are
 * published, have a picture, and whose window covers today, so the screen
 * never has to decide what "active" means and a clock-skewed phone cannot
 * show a banner early or hold an expired one on display.
 */

export interface SeasonalBanner {
  id: string;
  title: string;
  description: string | null;
  /** Always present: the server filters out rows with no picture. */
  imageUrl: string;
  startsOn: string | null;
  endsOn: string | null;
}

interface ServerBanner {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

export async function fetchSeasonalBanners(signal?: AbortSignal): Promise<SeasonalBanner[]> {
  const body = await apiRequest<{ asOf: string; items: ServerBanner[] }>('/content/banners', {
    signal,
  });
  return body.items
    .map((row) => {
      const url = mediaUrl(row.imageUrl);
      return url === null ? null : { ...row, imageUrl: url };
    })
    // A row whose key did not resolve to a URL is dropped rather than
    // rendered as a broken image under the hero.
    .filter((row): row is SeasonalBanner => row !== null);
}
