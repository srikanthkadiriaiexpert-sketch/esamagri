import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { PifMediaService } from './services/pif-media.service';

/**
 * Serving an uploaded product or category image (PHASE F).
 *
 * WHY THIS IS PUBLIC, stated plainly. A browser loads an image with a plain
 * `<img src>`, which carries no Authorization header, so an authenticated
 * image route would simply show broken pictures in both the shop and the
 * admin portal. What is exposed is therefore a grocery product photograph,
 * at a URL containing a random v4 UUID that appears nowhere but in the
 * database row and the page that renders it. No customer data, no order, no
 * price and no personal information is reachable here.
 *
 * WHAT CANNOT BE REACHED. The key's shape is enforced by a pattern
 * (`pif/products/<uuid>.png` and its two siblings) and the resolved path is
 * re-checked to be inside the configured media root, so `..`, an absolute
 * path, a symlink-shaped key or any other traversal attempt is refused
 * before the filesystem is touched. A key that does not match answers 404,
 * exactly as a key that matches but was never stored.
 *
 * Images are immutable: a replacement gets a new key, so the response may be
 * cached hard. That is also why removing an image deletes its file —
 * nothing else would ever overwrite it.
 */
@Controller('pif/media')
export class PifMediaController {
  constructor(private readonly media: PifMediaService) {}

  @Get('pif/:scope/:file')
  @Public()
  // One catalogue screen legitimately asks for 25 pictures at once, and the
  // responses are immutable and cacheable; counting them against the
  // caller's read allowance would throttle a page for loading itself.
  @RateLimit('none')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async image(
    @Param('scope') scope: string,
    @Param('file') file: string,
    @Res() res: Response
  ): Promise<void> {
    try {
      const { buffer, contentType } = await this.media.read(`pif/${scope}/${file}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      // Belt and braces: the body is an image, and nothing about this
      // response should ever be interpreted as a document.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.end(buffer);
    } catch {
      throw new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: 'No such image.' });
    }
  }
}
