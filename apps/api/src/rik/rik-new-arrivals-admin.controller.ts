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
import { NewArrivalValidationError, RikNewArrivalsService } from './services/rik-new-arrivals.service';
import type { NewArrivalRecord } from './repositories/new-arrivals.repository';
import { MediaError, RikMediaService, rikImageUrl } from './services/rik-media.service';
import { CreateNewArrivalDto, SetPublishedDto, UpdateNewArrivalDto } from './dto/rik-new-arrivals.dto';

/**
 * Managing the RIK New Arrivals listings.
 *
 * AUTHORISATION IS ON THE SERVER, AND IT IS NOT NEW. Every route below sits
 * behind `JwtAuthGuard, AuthorizationGuard` and requires `rik.product.manage`
 * — the same permission that already governs the RIK SKU master (provisions,
 * pack sizes, availability, pictures). The reasoning: deciding which existing
 * product to put in the shop window is a catalogue-presentation decision, and
 * an administrator who may rename or illustrate a provision may feature it.
 *
 * WHO THAT LETS IN, AND WHO IT DOES NOT. `rik.product.manage` is held by
 * SUPER_ADMIN and RIK_ADMIN. PIF_ADMIN, PIF_CASHIER, RIK_PICKUP_STAFF and
 * DELIVERY_STAFF do not hold it, so none of them reaches these routes — and
 * because authorisation is row-driven rather than name-matched, that stays
 * true without this file knowing any role name. Customers hold no staff
 * permission at all and are refused by the guard before any handler runs.
 *
 * No permission and no role was added for this feature. The set stays at 22
 * and 6, which migration 0051's guard requires and 0055's re-asserts.
 *
 * NOTHING HERE REACHES AN ENTITLEMENT. The service writes one table,
 * rik.new_arrivals, and the only statement in the whole feature that names
 * rik.provisions is a SELECT.
 */
/**
 * A hard ceiling on the multipart parser, well above the configured image
 * limit. It stops a huge body being buffered at all; the real, configurable
 * limit is enforced by MediaStorage once the bytes are in hand, which is what
 * produces the message staff actually see.
 */
const UPLOAD_BACKSTOP_BYTES = 8_000_000;

@Controller('admin/rik/new-arrivals')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikNewArrivalsAdminController {
  constructor(
    private readonly service: RikNewArrivalsService,
    private readonly media: RikMediaService
  ) {}

  /** Every listing, published or not, in display order. */
  @Get()
  @RequirePermissions('rik.product.manage')
  async list() {
    const items = await this.service.listForStaff();
    return { items: items.map(staffView) };
  }

  @Post()
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async create(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateNewArrivalDto) {
    return this.run(() => this.service.create(context, dto));
  }

  @Patch(':id')
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async update(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateNewArrivalDto
  ) {
    return this.run(() => this.service.update(context, id, dto));
  }

  /**
   * Publish or unpublish. Matches the `/active` pattern used by the rest of
   * the RIK admin API rather than inventing a second idiom.
   */
  @Post(':id/published')
  @RequirePermissions('rik.product.manage')
  @UsePipes(pipe())
  async setPublished(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetPublishedDto
  ) {
    return this.run(() => this.service.setPublished(context, id, dto.isPublished));
  }

  /**
   * Removes the LISTING only.
   *
   * The response says so explicitly, because "remove" on a screen full of
   * products is exactly the word somebody will worry about. The underlying
   * provision is untouched and remains in the catalogue.
   */
  @Delete(':id')
  @RequirePermissions('rik.product.manage')
  async remove(@CurrentAuthContext() context: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      const { name, provisionCode } = await this.service.remove(context, id);
      return { removed: true, name, provisionCode, provisionDeleted: false };
    } catch (err) {
      throw this.toHttp(err);
    }
  }

  // ------------------------------------------- the promotional picture
  //
  // A SECOND, SEPARATE PICTURE. The product's catalogue photograph belongs to
  // the provision and is managed on the Provisions screen; this one belongs to
  // the listing. Uploading, replacing or removing it here CANNOT change the
  // catalogue photograph — this controller only ever writes
  // `rik.new_arrivals.image_ref`, and the delete path is scoped to the
  // `rik/new-arrivals/` directory so a listing can never delete a file another
  // record still shows.
  //
  // A listing with no promotional picture is the normal case and renders the
  // product's own. An image is never required.

  /**
   * Upload the listing's promotional picture, or replace the one it has.
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
      const stored = await this.media.storeNewArrival(file.buffer);
      const { before, after } = await this.service.setImage(context, id, stored.key);
      // Scoped delete: only a key under rik/new-arrivals/ can go. If this
      // listing was previously falling back to the provision's photograph,
      // `before.image_ref` is null and nothing is deleted at all.
      await this.media.removeInScope(before.image_ref, 'new-arrivals');
      return { ...staffView(after), bytes: stored.bytes, contentType: stored.contentType, sha256: stored.sha256 };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  /**
   * Remove the promotional picture; the listing falls back to the product's.
   *
   * The row is cleared first, then the file — and only if the file is one
   * this listing owns.
   */
  @Delete(':id/image')
  @RequirePermissions('rik.product.manage')
  async removeImage(@CurrentAuthContext() context: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    try {
      const { before, after, unpublished } = await this.service.removeImage(context, id);
      await this.media.removeInScope(before.image_ref, 'new-arrivals');
      // `unpublished` tells the screen that removing the picture also took a
      // standalone listing off the customer app, so it can say so rather
      // than leaving the administrator to notice the status flip.
      return { ...staffView(after), provisionImageChanged: false, unpublished };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  // ============================================================= internals

  private async run(action: () => Promise<NewArrivalRecord>) {
    try {
      return staffView(await action());
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  /**
   * A refused listing is 400 with the machine-readable reason and the
   * offending field; a missing one is 404. Anything else is left alone for
   * the global filter — an unexpected failure must not be dressed up as a
   * validation problem.
   */
  private toHttp(err: unknown): unknown {
    if (err instanceof NewArrivalValidationError) {
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

/**
 * What staff see. Carries the listing's id (they have to act on it) and the
 * provision's code and name (they have to recognise it), and nothing about
 * entitlement.
 */
function staffView(row: NewArrivalRecord) {
  // The listing's OWN picture and the one a customer would actually see are
  // reported separately and named differently, because the screen needs both
  // and conflating them is how a "remove" button ends up offered for a
  // picture the listing does not own. `imageRef` is null when the listing is
  // borrowing the product's; `effective*` is what the card renders.
  const effective = row.effective_image_ref;
  return {
    id: row.id,
    /** True for the ordinary listing, which names no catalogue product. */
    standalone: row.provision_id === null,
    provisionId: row.provision_id,
    /** The staff-typed name; null on a listing linked to the catalogue. */
    productName: row.product_name,
    code: row.code,
    /** What to show: the catalogue name when linked, the typed one otherwise. */
    name: row.display_name,
    brand: row.brand,
    poolName: row.pool_name,
    headline: row.headline,
    imageRef: row.image_ref,
    imageUrl: rikImageUrl(row.image_ref),
    hasOwnImage: row.image_ref !== null,
    effectiveImageRef: effective,
    effectiveImageUrl: rikImageUrl(effective),
    isPublished: row.is_published,
    publishedFrom: row.published_from,
    publishedUntil: row.published_until,
    displayOrder: row.display_order,
    provisionIsActive: row.provision_is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A refused upload is 400 with the machine-readable reason; a missing listing
 * or an unreadable key is 404. The message comes from MediaError, which never
 * contains a filesystem path — a customer or an administrator sees "that file
 * is not a PNG, JPEG or WebP", not a directory on the server.
 */
function toMediaHttp(err: unknown): unknown {
  if (err instanceof NewArrivalValidationError) {
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
