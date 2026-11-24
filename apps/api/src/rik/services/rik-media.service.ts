import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import {
  MediaError,
  MediaStorage,
  mediaRefToUrl,
  type MediaErrorCode,
  type StoredImage,
} from '../../shared/services/media-storage.service';

/**
 * Provision pictures, uploaded by a RIK administrator.
 *
 * THE REQUIREMENT THIS MEETS: a RIK administrator attaches a photograph to a
 * provision from their own computer, through the admin portal, without a
 * developer and without a deployment. Until now the only way a provision
 * could have a picture was for the file to be committed to the customer app's
 * `public/catalogue/` folder and the path typed into a text box — which means
 * a new product could not be illustrated at all without a rebuild.
 *
 * THE 180 PICTURES ALREADY ATTACHED ARE NOT AFFECTED. They are
 * `/catalogue/rik/...` paths, this store does not own them, and every method
 * here leaves a key it does not own completely alone — `remove` on one is a
 * no-op by design, so no committed asset can be deleted by a row changing.
 *
 * THREE SCOPES, AND THEY MUST NOT BLEED INTO EACH OTHER:
 *
 *   `provisions`    the product's own catalogue photograph, managed on the
 *                   Provisions screen and shown everywhere the product is.
 *   `new-arrivals`  an OPTIONAL promotional picture belonging to one New
 *                   Arrivals listing, and to nothing else.
 *   `banners`       the seasonal home-screen banner picture belonging to one
 *                   rik.promotional_banners row, and to nothing else. Unlike
 *                   a New Arrivals listing a banner has no picture to fall
 *                   back on — it IS the picture — so a banner key is never
 *                   shared with another record and its scoped delete can
 *                   never take a photograph another screen still shows.
 *
 * A listing with no promotional picture falls back to the provision's one at
 * read time, which means the same `rik/provisions/...` key can be reached
 * through a listing — so "remove the promotional picture" MUST NOT be allowed
 * to delete it. That is why `removeInScope` exists and why the New Arrivals
 * paths never call plain `remove`: deleting is scoped to the directory that
 * owns the file, so a listing can only ever delete its own.
 *
 * Pool covers remain the committed set of 18 agreed artwork files; nothing
 * here touches them.
 *
 * The mechanism is shared/services/media-storage.service.ts — read it for
 * why an upload cannot choose its own filename or escape the media root.
 * This service only decides the root (RIK_MEDIA_ROOT), the key prefix
 * (`rik`) and the one allowed scope.
 */

export { MediaError };
export type { MediaErrorCode, StoredImage };

/** A stored RIK key becomes a `/rik/media/...` URL; anything else passes through. */
export function rikImageUrl(ref: string | null): string | null {
  return mediaRefToUrl(ref, 'rik');
}

@Injectable()
export class RikMediaService {
  private readonly storage: MediaStorage;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.storage = new MediaStorage({
      root: config.get('RIK_MEDIA_ROOT', { infer: true }),
      prefix: 'rik',
      scopes: ['provisions', 'new-arrivals', 'banners'],
      // Deliberately the same number as PIF: one configured ceiling for every
      // uploaded picture in the application, so an operator raising the limit
      // raises it everywhere rather than discovering a second one later.
      maxBytes: config.get('PIF_MEDIA_MAX_BYTES', { infer: true }),
    });
  }

  get limitBytes(): number {
    return this.storage.limitBytes;
  }

  /** The absolute directory provision pictures are written to. */
  get rootPath(): string {
    return this.storage.rootPath;
  }

  /** The product's own catalogue photograph. */
  store(buffer: Buffer): Promise<StoredImage> {
    return this.storage.store('provisions', buffer);
  }

  /** A promotional picture for one New Arrivals listing. */
  storeNewArrival(buffer: Buffer): Promise<StoredImage> {
    return this.storage.store('new-arrivals', buffer);
  }

  /** The picture for one seasonal home-screen banner. */
  storeBanner(buffer: Buffer): Promise<StoredImage> {
    return this.storage.store('banners', buffer);
  }

  read(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    return this.storage.read(key);
  }

  remove(key: string | null): Promise<void> {
    return this.storage.remove(key);
  }

  /**
   * Delete a key ONLY if it lives in the named scope.
   *
   * The guard that stops a New Arrivals listing deleting a product's
   * catalogue photograph. A listing whose own picture is unset renders the
   * provision's `rik/provisions/<uuid>.jpg`, and that key IS owned by this
   * store — so an unguarded `remove` would happily delete a photograph that
   * every other screen still shows. Anything outside the scope, including a
   * committed `/catalogue/...` path, is a deliberate no-op.
   */
  async removeInScope(key: string | null, scope: 'provisions' | 'new-arrivals' | 'banners'): Promise<void> {
    if (key === null || !key.startsWith(`rik/${scope}/`)) return;
    await this.storage.remove(key);
  }

  /** True only for an uploaded RIK key — never for a committed `/catalogue/...` asset. */
  owns(key: string | null): boolean {
    return this.storage.owns(key);
  }
}
