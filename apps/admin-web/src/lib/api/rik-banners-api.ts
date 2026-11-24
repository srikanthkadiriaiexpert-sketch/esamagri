import { apiRequest, apiUpload } from './client';

/**
 * Seasonal promotional banners, as the Admin Portal manages them.
 *
 * SEPARATE FROM rik-config-api.ts ON PURPOSE. That module is the entitlement
 * configuration surface — pools, scales, conversions, provisions, pack sizes.
 * A seasonal picture is not configuration of anything an officer is entitled
 * to, and putting it in the same file is how the two start borrowing each
 * other's types. The endpoints are under /admin/rik/banners rather than
 * /admin/rik/config for the same reason.
 *
 * THE HERO IS NOT HERE. The customer home screen's permanent hero is a
 * committed brand asset in the customer app. No function in this module can
 * address it, and nothing a staff member does on the Banners screen can
 * change, reorder or hide it.
 */

const BANNERS = '/admin/rik/banners';

export interface BannerListing {
  id: string;
  title: string;
  description: string | null;
  imageRef: string | null;
  imageUrl: string | null;
  hasImage: boolean;
  isPublished: boolean;
  startsOn: string | null;
  endsOn: string | null;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface Listed<T> {
  items: T[];
}

export async function fetchBanners(signal?: AbortSignal): Promise<BannerListing[]> {
  const body = await apiRequest<Listed<BannerListing>>(BANNERS, { signal });
  return body.items;
}

/**
 * Create the banner row.
 *
 * It is always a draft with no picture: the image is a separate multipart
 * request, and a banner cannot be published until it has one. There is
 * deliberately no `isPublished` argument here — offering one could only
 * produce a refusal the administrator can do nothing about.
 */
export function createBanner(input: {
  title: string;
  description?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  displayOrder?: number;
}): Promise<BannerListing> {
  return apiRequest<BannerListing>(BANNERS, { method: 'POST', body: input });
}

export function updateBanner(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
    displayOrder?: number;
  }
): Promise<BannerListing> {
  return apiRequest<BannerListing>(`${BANNERS}/${id}`, { method: 'PATCH', body: patch });
}

export function setBannerPublished(id: string, isPublished: boolean): Promise<BannerListing> {
  return apiRequest<BannerListing>(`${BANNERS}/${id}/published`, {
    method: 'POST',
    body: { isPublished },
  });
}

export function removeBanner(id: string): Promise<{ removed: boolean; title: string }> {
  return apiRequest<{ removed: boolean; title: string }>(`${BANNERS}/${id}`, { method: 'DELETE' });
}

/**
 * Sent through `apiUpload`, not `apiRequest`: the browser has to write the
 * Content-Type itself so that it carries the multipart boundary it generated.
 */
export function uploadBannerImage(id: string, file: File): Promise<BannerListing> {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<BannerListing>(`${BANNERS}/${id}/image`, form);
}

/**
 * Remove the picture.
 *
 * A published banner cannot exist without one, so the server unpublishes it
 * in the same operation and says so in `unpublished` — which the screen
 * reports, rather than letting the administrator discover the status flip.
 */
export function removeBannerImage(id: string): Promise<BannerListing & { unpublished: boolean }> {
  return apiRequest<BannerListing & { unpublished: boolean }>(`${BANNERS}/${id}/image`, {
    method: 'DELETE',
  });
}
