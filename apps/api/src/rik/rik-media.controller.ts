import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { RikMediaService } from './services/rik-media.service';

/**
 * Serving an uploaded RIK provision picture.
 *
 * WHY THIS IS PUBLIC, stated plainly, and for the same reason as its PIF
 * counterpart. A browser loads an image with a plain `<img src>`, which
 * carries no Authorization header, so an authenticated image route would
 * simply show broken pictures in both the ration screens and the admin
 * portal. What is exposed is a photograph of a packet of rice, at a URL
 * containing a random v4 UUID that appears nowhere but in the database row
 * and the page that renders it. No officer, entitlement, eligibility or
 * personal information is reachable here.
 *
 * WHAT CANNOT BE REACHED. The key's shape is enforced by a pattern
 * (`rik/provisions/<uuid>.png` and its two siblings) and the resolved path is
 * re-checked to be inside RIK_MEDIA_ROOT, so `..`, an absolute path or any
 * other traversal attempt is refused before the filesystem is touched. A key
 * that does not match answers 404, exactly as a key that matches but was
 * never stored — so this route tells a prober nothing.
 *
 * Images are immutable: a replacement gets a new key, so the response may be
 * cached hard. That is also why removing a picture deletes its file —
 * nothing else would ever overwrite it.
 */
@Controller('rik/media')
export class RikMediaController {
  constructor(private readonly media: RikMediaService) {}

  @Get('rik/:scope/:file')
  @Public()
  // A ration category screen legitimately asks for a dozen pictures at once,
  // and the responses are immutable and cacheable; counting them against the
  // officer's read allowance would throttle a page for loading itself.
  @RateLimit('none')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async image(
    @Param('scope') scope: string,
    @Param('file') file: string,
    @Res() res: Response
  ): Promise<void> {
    try {
      const { buffer, contentType } = await this.media.read(`rik/${scope}/${file}`);
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
