import { Controller, Get, Header, Headers, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { PifAlertSoundService } from './services/pif-alert-sound.service';

/**
 * Serving the PIF order-alert sound.
 *
 * WHY THIS IS PUBLIC, stated plainly — the same reasoning PifMediaController
 * gives for product photographs, and it applies more strongly here. A browser
 * plays audio with an `Audio` element or an `<audio src>`, neither of which
 * carries an Authorization header, so an authenticated route would simply be
 * silent in every browser. What is exposed is a notification bell: no customer
 * data, no order, no price, no personal information, no filesystem path. A
 * caller who fetches it learns that the facility uses a doorbell sound.
 *
 * The requirement this satisfies is explicit: staff WITHOUT management
 * permission must be able to HEAR the configured sound. Replacing it is the
 * guarded action, and it lives on the admin controller behind
 * `pif.product.manage`.
 *
 * WHAT CANNOT BE REACHED. There is no path parameter at all. The route takes
 * no key, no filename and no scope — it asks the service for "the active
 * sound" and the service resolves that from its own configuration against a
 * server-configured root, with the key's shape enforced and the resolved path
 * re-checked to be inside that root. So there is nothing here to traverse
 * with `..`, nothing to point at `active.json`, and nothing an attacker can
 * vary. A store with no usable configuration serves the committed default
 * rather than an error.
 *
 * CACHING. Unlike an image, this URL is STABLE while its content changes — the
 * client replaces the sound and the address stays the same — so it must not be
 * cached immutably or a desk would keep playing last month's bell. The
 * response carries a strong ETag (the audio's SHA-256) with
 * `no-cache`, which means: reuse the bytes you have, but always ask first. A
 * revalidation costs one 304 and the audio is re-downloaded only when it has
 * actually changed.
 */
@Controller('pif/alert-sound')
export class PifAlertSoundController {
  constructor(private readonly sound: PifAlertSoundService) {}

  @Get()
  @Public()
  // The buzzer revalidates this on every page load, and a busy order desk may
  // have several screens open. The responses are tiny 304s once cached, and
  // counting them against the caller's read allowance would throttle the
  // alert that is the whole point of the feature.
  @RateLimit('none')
  @Header('Cache-Control', 'no-cache')
  async current(
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string
  ): Promise<void> {
    try {
      const { buffer, contentType, sha256 } = await this.sound.readActive();
      const etag = `"${sha256}"`;

      if (ifNoneMatch !== undefined && ifNoneMatch.split(',').some((t) => t.trim() === etag)) {
        res.setHeader('ETag', etag);
        res.status(304).end();
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('ETag', etag);
      // Belt and braces: the body is audio, and nothing about this response
      // should ever be interpreted as a document.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.end(buffer);
    } catch {
      throw new NotFoundException({
        code: ERROR_CODES.NOT_FOUND,
        message: 'No order-alert sound is available.',
      });
    }
  }
}
