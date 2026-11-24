import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '@esamagri/config';
import {
  MediaError,
  MediaStorage,
  type MediaErrorCode,
  type StoredImage,
} from '../../shared/services/media-storage.service';

/**
 * Product and category images, uploaded by the client's own staff
 * (PHASE F).
 *
 * THE REQUIREMENT THIS MEETS: the facility adds a product photo from their
 * own computer, through the admin portal, without a developer and without a
 * deployment. The RIK category covers are files committed to the repository
 * because they are a fixed set of 18 agreed artwork files; a grocery
 * catalogue of thousands of SKUs cannot work that way.
 *
 * THE MECHANISM NOW LIVES IN shared/services/media-storage.service.ts, which
 * RIK's own provision pictures use as well. Nothing observable moved with
 * it: the keys are still `pif/products/<uuid>.png` and
 * `pif/categories/<uuid>.png`, the magic-byte check still admits only PNG,
 * JPEG and WebP, the limit is still PIF_MEDIA_MAX_BYTES, the root is still
 * PIF_MEDIA_ROOT, and every error code and message is unchanged. Read that
 * file for why an upload cannot choose its own filename or escape the root.
 */

export { MediaError };
export type { MediaErrorCode, StoredImage };

@Injectable()
export class PifMediaService {
  private readonly storage: MediaStorage;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.storage = new MediaStorage({
      root: config.get('PIF_MEDIA_ROOT', { infer: true }),
      prefix: 'pif',
      scopes: ['products', 'categories'],
      maxBytes: config.get('PIF_MEDIA_MAX_BYTES', { infer: true }),
    });
  }

  get limitBytes(): number {
    return this.storage.limitBytes;
  }

  store(scope: 'products' | 'categories', buffer: Buffer): Promise<StoredImage> {
    return this.storage.store(scope, buffer);
  }

  read(key: string): Promise<{ buffer: Buffer; contentType: string }> {
    return this.storage.read(key);
  }

  remove(key: string | null): Promise<void> {
    return this.storage.remove(key);
  }
}
