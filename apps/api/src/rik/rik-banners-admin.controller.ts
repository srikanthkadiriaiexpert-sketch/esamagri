import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { CurrentAuthContext } from '../auth/decorators/current-auth-context.decorator';
import type { AuthContext } from '../auth/auth-context';
import { BannerValidationError, RikBannersService } from './services/rik-banners.service';
import type { PromotionalBannerRecord } from './repositories/promotional-banners.repository';
import { MediaError, RikMediaService, rikImageUrl } from './services/rik-media.service';
import { CreateBannerDto, SetBannerPublishedDto, UpdateBannerDto } from './dto/rik-banners.dto';

/**
 * Managing the seasonal promotional banners.
 *
 * AUTHORISATION IS ON THE SERVER, AND IT IS NOT NEW. Every route below sits
 * behind `JwtAuthGuard, AuthorizationGuard` and requires `rik.product.manage`
 * — the same permission that already governs the RIK SKU master and the New
 * Arrivals listings. Deciding which seasonal picture the shop window carries
 * is a merchandising decision of exactly the same kind.
 *
 * WHO THAT LETS IN, AND WHO IT DOES NOT. `rik.product.manage` is held by
 * SUPER_ADMIN and RIK_ADMIN, which is precisely the audience this feature was
 * specified for. PIF_ADMIN, PIF_CASHIER, RIK_PICKUP_STAFF and DELIVERY_STAFF
 * do not hold it and never reach these routes. Customers hold no staff
 * permission at all and are refused by the guard before any handler runs.
 *
 * NO PERMISSION AND NO ROLE WAS ADDED FOR THIS FEATURE. The existing sets are
 * untouched, which is both the requirement and the thing migration 0051's
 * guard would catch if it were not.
 *
 * THE FIXED HERO IS NOT ADDRESSABLE FROM HERE. The home screen's permanent
 * hero is a committed brand asset rendered by the customer app's own
 * component. No route on this controller can reference it, replace it,
 * reorder it or hide it, and removing every banner in the table returns the
 * home screen to exactly what it is today.
 *
 * NOTHING HERE REACHES AN ENTITLEMENT. The service writes one table,
 * rik.promotional_banners, and no statement in the whole feature names
 * rik.provisions, a pool, a scale or a voucher.
 */

/**
 * A hard ceiling on the multipart parser, well above the configured image
 * limit — the same backstop the New Arrivals upload uses. It stops a huge
 * body being buffered at all; the real, configurable limit is enforced by
 * MediaStorage once the bytes are in hand, which is what produces the
 * message staff actually see.
 */
const UPLOAD_BACKSTOP_BYTES = 8_000_000;

@Controller('admin/rik/banners')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikBannersAdminController {
  constructor(
    private readonly service: RikBannersService,
    private readonly media: RikMediaService
  ) {}

  /** Every banner, published or not, in display order. */
  @Get()
  @RequirePermissions('rik.product.manage')
  async list() {
    const items = await this.service.listForStaff();
    return { items: items.map(staffView) };
  }

  /**
   * Create the banner row.
   *
   * It starts as a draft with no picture: the image arrives in a separate
   * multipart request, and only then can it be published.
   */
  @Post()
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async create(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateBannerDto) {
    return this.run(() => this.service.create(context, dto));
  }

  @Patch(':id')
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async update(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBannerDto
  ) {
    return this.run(() => this.service.update(context, id, dto));
  }

  /**
   * Publish or unpublish. Matches the `/published` pattern New Arrivals uses
   * rather than inventing a second idiom for the same decision.
   */
  @Post(':id/published')
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async setPublished(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetBannerPublishedDto
  ) {
    return this.run(() => this.service.setPublished(context, id, dto.isPublished));
  }

  /**
   * Delete the banner and its picture.
   *
   * The row goes first, then the file, and only if the file is one this
   * banner owns — `removeInScope` refuses any key outside `rik/banners/`, so
   * a banner can never delete a provision photograph or a committed asset.
   */
  @Delete(':id')
  @RequirePermissions('rik.product.manage')
  async remove(@CurrentAuthContext() context: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      const before = await this.service.remove(context, id);
      await this.media.removeInScope(before.image_ref, 'banners');
      return { removed: true, title: before.title };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  // ------------------------------------------------------- the picture
  //
  // A banner IS its picture, so unlike a New Arrivals listing there is no
  // fallback to borrow: a banner with no image cannot be published, and
  // removing the image of a published banner takes it off the home screen.

  /**
   * Upload the banner picture, or replace the one it has.
   *
   * The file is held in memory, checked by its MAGIC BYTES rather than its
   * name or its declared type, size-limited by configuration, and written
   * under a generated UUID key — the original filename is never used, so it
   * cannot carry a path, an extension lie or a traversal sequence. The
   * database row is updated FIRST and the previous file deleted only
   * afterwards, so a failure can never leave a row pointing at a file that
   * has already gone.
   */
  @Post(':id/image')
  @RequirePermissions('rik.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_BACKSTOP_BYTES, files: 1 } }))
  async uploadImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: { buffer?: Buffer; size?: number; originalname?: string }
  ) {
    try {
      if (file?.buffer === undefined) {
        throw new MediaError('EMPTY', 'No file was uploaded.');
      }
      const stored = await this.media.storeBanner(file.buffer);
      const { before, after } = await this.service.setImage(context, id, stored.key);
      // Scoped delete: only a key under rik/banners/ can go.
      await this.media.removeInScope(before.image_ref, 'banners');
      return { ...staffView(after), bytes: stored.bytes, contentType: stored.contentType, sha256: stored.sha256 };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  /**
   * Remove the picture.
   *
   * A published banner cannot exist without one, so this unpublishes it in
   * the same breath. The response reports that explicitly rather than
   * leaving the administrator to notice the status flip.
   */
  @Delete(':id/image')
  @RequirePermissions('rik.product.manage')
  async removeImage(@CurrentAuthContext() context: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      const { before, after, unpublished } = await this.service.removeImage(context, id);
      await this.media.removeInScope(before.image_ref, 'banners');
      return { ...staffView(after), unpublished };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  // ============================================================= internals

  private async run(action: () => Promise<PromotionalBannerRecord>) {
    try {
      return staffView(await action());
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  /**
   * A refused banner is 400 with the machine-readable reason and the
   * offending field; a missing one is 404. Anything else is left alone for
   * the global filter — an unexpected failure must not be dressed up as a
   * validation problem.
   */
  private toHttp(err: unknown): unknown {
    if (err instanceof BannerValidationError) {
      if (err.code === 'NOT_FOUND') {
        return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
      }
      return new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.code, field: err.field },
      });
    }
    return err;
  }
}

/** What staff see. The id they act on, the picture both ways, and the dates. */
function staffView(row: PromotionalBannerRecord) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    imageRef: row.image_ref,
    imageUrl: rikImageUrl(row.image_ref),
    hasImage: row.image_ref !== null,
    isPublished: row.is_published,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A refused upload is 400 with the machine-readable reason; a missing banner
 * or an unreadable key is 404. The message comes from MediaError, which never
 * contains a filesystem path — an administrator sees "that file is not a PNG,
 * JPEG or WebP", not a directory on the server.
 */
function toMediaHttp(err: unknown): unknown {
  if (err instanceof BannerValidationError) {
    if (err.code === 'NOT_FOUND') {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code, field: err.field },
    });
  }
  if (err instanceof MediaError) {
    if (err.code === 'NOT_FOUND' || err.code === 'BAD_KEY') {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code },
    });
  }
  return err;
}

function pipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}
