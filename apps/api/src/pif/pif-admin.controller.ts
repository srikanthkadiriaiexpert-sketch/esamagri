import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ERROR_CODES } from '@esamagri/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { RequireAnyPermission } from '../auth/decorators/require-any-permission.decorator';
import { CurrentAuthContext } from '../auth/decorators/current-auth-context.decorator';
import type { AuthContext } from '../auth/auth-context';
import { CatalogueError, PifCatalogueService } from './services/pif-catalogue.service';
import { OrderError, PifOrderService } from './services/pif-order.service';
import { MediaError, PifMediaService } from './services/pif-media.service';
import { ImportError, PifImportService } from './services/pif-import.service';
import { PifAlertSoundService, type ActiveAlertSound } from './services/pif-alert-sound.service';
import {
  CategoryDto,
  ProductDto,
  ProductFlagsDto,
  ProductPriceDto,
  TaxRateDto,
} from './dto/pif-catalogue.dto';
import { OrderNoteDto, OrderStatusDto } from './dto/pif-order.dto';
import { ImportRowsQueryDto } from './dto/pif-import.dto';
import { imageUrl, productView } from './pif.controller';
import type { ProductRecord } from './repositories/pif-catalogue.repository';
import type {
  OrderEventRecord,
  OrderItemRecord,
  OrderRecord,
  StaffQueueRecord,
} from './repositories/pif-orders.repository';
import type { ImportBatchRecord, ImportRowRecord } from './repositories/pif-import.repository';

/**
 * PIF administration, inside the one e Samagri admin portal (PHASE F).
 *
 * AUTHORIZATION, and the point of it. Every route below names the permission
 * it needs, and the AuthorizationGuard reads the live grant out of
 * shared.role_permissions on each request. Nothing is inferred from a role's
 * name and nothing depends on what the navigation shows:
 *
 *   catalogue, prices, images     `pif.product.manage`   PIF_ADMIN, SUPER_ADMIN
 *   the order desk                `pif.order.manage`     PIF_ADMIN, SUPER_ADMIN
 *   picking and packing           `pif.order.prepare`    + PIF_CASHIER
 *   recording a delivery          `pif.order.mark_delivered` / `…not_delivered`
 *                                                        DELIVERY_STAFF, SUPER_ADMIN
 *
 * RIK_ADMIN holds no `pif.*` permission at all, so every route here answers
 * it 403 — not because this file checks for RIK_ADMIN, but because it holds
 * no grant. The same is true in reverse: PIF_ADMIN holds no `rik.*`, and the
 * RIK controllers refuse it. SUPER_ADMIN holds both, explicitly, as rows
 * added by migration 0050.
 *
 * WHAT IS NOT HERE. No point of sale, no bill, no invoice, no cash drawer,
 * no purchase order, no supplier, no stock receipt, no stock quantity. The
 * corrected PIF scope excludes all of it, and the facility's own billing
 * software does the billing.
 */
/**
 * A hard ceiling on what the request parser will even hold in memory. The
 * real, configurable limit is PIF_MEDIA_MAX_BYTES, enforced in
 * PifMediaService; this one exists so an enormous upload is dropped at the
 * transport instead of being buffered first.
 */
const UPLOAD_BACKSTOP_BYTES = 8_000_000;

// A multer-level backstop for the spreadsheet upload. The REAL limit is
// PIF_IMPORT_MAX_BYTES, enforced in PifImportService where it can be
// reported to the operator in words; this one only stops a wildly oversized
// upload from being buffered in the first place.
const IMPORT_BACKSTOP_BYTES = 25_000_000;

@Controller('admin/pif')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class PifAdminController {
  constructor(
    private readonly catalogue: PifCatalogueService,
    private readonly orders: PifOrderService,
    private readonly media: PifMediaService,
    private readonly imports: PifImportService,
    private readonly alertSound: PifAlertSoundService
  ) {}

  // ---------------------------------------------------------------- dashboard

  /**
   * The PIF operational dashboard — its OWN dashboard, separate from RIK's.
   * `newOrders` is what the order desk's alert watches.
   */
  @Get('dashboard')
  @RequireAnyPermission('pif.order.prepare', 'pif.order.manage', 'pif.product.manage')
  async dashboard() {
    const counts = await this.orders.statusCounts();
    const queue = await this.orders.staffQueue({ openOnly: true, page: 1, pageSize: 10 });
    const products = await this.catalogue.adminProducts({ page: 1, pageSize: 1 });
    const unavailable = await this.catalogue.adminProducts({
      status: 'UNAVAILABLE',
      page: 1,
      pageSize: 1,
    });
    return {
      counts,
      newOrders: counts.PLACED ?? 0,
      openOrders: queue.total,
      recent: queue.items.map(orderQueueView),
      catalogue: { products: products.total, unavailable: unavailable.total },
    };
  }

  // --------------------------------------------------------------- categories

  @Get('categories')
  @RequirePermissions('pif.product.manage')
  async categories() {
    const rows = await this.catalogue.adminCategories();
    return {
      items: rows.map((category) => ({
        id: category.id,
        name: category.name,
        parentId: category.parent_id,
        parentName: category.parent_name,
        description: category.description,
        imageUrl: imageUrl(category.image_ref),
        sortOrder: category.sort_order,
        active: category.active,
        businessSlug: category.business_slug,
        productCount: category.product_count,
      })),
    };
  }

  @Post('categories')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async createCategory(@CurrentAuthContext() context: AuthContext, @Body() dto: CategoryDto) {
    try {
      const id = await this.catalogue.createCategory(context, {
        name: dto.name,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder,
        active: dto.active,
      });
      return { id, name: dto.name };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Patch('categories/:categoryId')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateCategory(
    @CurrentAuthContext() context: AuthContext,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() dto: CategoryDto
  ) {
    try {
      await this.catalogue.updateCategory(context, categoryId, {
        name: dto.name,
        parentId: dto.parentId ?? null,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder,
        active: dto.active,
      });
      return { id: categoryId, updated: true };
    } catch (err) {
      throw toHttp(err);
    }
  }

  // ----------------------------------------------------------------- products

  @Get('products')
  @RequirePermissions('pif.product.manage')
  async products(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    const result = await this.catalogue.adminProducts({
      query: q ?? null,
      categoryId: categoryId ?? null,
      status: isStatusFilter(status) ? status : 'ALL',
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 25),
    });
    return {
      items: result.items.map(adminProductView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  // ------------------------------------------------------- bulk product import

  /**
   * The blank spreadsheet the facility fills in.
   *
   * Served as a real .xlsx with the exact headings the importer understands
   * and a second sheet explaining each one, so nobody has to guess a column
   * name — and so "the client must not edit source code to manage the
   * catalogue" extends to the bulk path as well as the manual one.
   */
  @Get('products/import/template')
  @RequirePermissions('pif.product.manage')
  async importTemplate(@Res() res: Response): Promise<void> {
    const workbook = await this.imports.template();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="esamagri-products-template.xlsx"');
    res.setHeader('Content-Length', workbook.length);
    res.end(workbook);
  }

  /** Recent imports: what was uploaded, by whom, and what came of it. */
  @Get('products/import')
  @RequirePermissions('pif.product.manage')
  async importBatches(@Query('limit') limit?: string) {
    const rows = await this.imports.batches(Number(limit ?? 20) || 20);
    return { items: rows.map(importBatchView) };
  }

  /**
   * Upload a file and see what it WOULD do. Nothing is written to the
   * catalogue by this route — that is the whole point of it.
   */
  @Post('products/import/preview')
  @RequirePermissions('pif.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_BACKSTOP_BYTES, files: 1 } }))
  async importPreview(
    @CurrentAuthContext() context: AuthContext,
    @UploadedFile() file?: { buffer?: Buffer; size?: number; originalname?: string }
  ) {
    try {
      const summary = await this.imports.preview(context, file ?? {});
      return {
        batch: importBatchView(summary.batch),
        missingCategories: summary.missingCategories,
        unknownTaxRates: summary.unknownTaxRates,
        ignoredColumns: summary.ignoredColumns,
        unknownColumns: summary.unknownColumns,
        columnsUsed: summary.columnsUsed,
      };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Get('products/import/:batchId')
  @RequirePermissions('pif.product.manage')
  async importBatch(@Param('batchId', new ParseUUIDPipe()) batchId: string) {
    try {
      return { batch: importBatchView(await this.imports.batch(batchId)) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Get('products/import/:batchId/rows')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async importRows(
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @Query() query: ImportRowsQueryDto
  ) {
    try {
      const page = await this.imports.rows(batchId, {
        verdict: query.verdict,
        limit: query.limit ?? 100,
        offset: query.offset ?? 0,
      });
      return { items: page.items.map(importRowView), total: page.total };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /** Write the previewed rows to the catalogue. Single-shot, by claim. */
  @Post('products/import/:batchId/apply')
  @RequirePermissions('pif.product.manage')
  async importApply(
    @CurrentAuthContext() context: AuthContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string
  ) {
    try {
      return { batch: importBatchView(await this.imports.apply(context, batchId)) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('products/import/:batchId/discard')
  @RequirePermissions('pif.product.manage')
  async importDiscard(
    @CurrentAuthContext() context: AuthContext,
    @Param('batchId', new ParseUUIDPipe()) batchId: string
  ) {
    try {
      return { batch: importBatchView(await this.imports.discard(context, batchId)) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  // NOTE ON ROUTE ORDER: every import route is declared BEFORE
  // `products/:productId`, because Express matches in declaration order and
  // `/products/import` would otherwise be read as a product whose id is the
  // word "import" and answer 400.
  @Get('products/:productId')
  @RequirePermissions('pif.product.manage')
  async product(@Param('productId', new ParseUUIDPipe()) productId: string) {
    try {
      return adminProductView(await this.catalogue.adminProduct(productId));
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('products')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async createProduct(@CurrentAuthContext() context: AuthContext, @Body() dto: ProductDto) {
    try {
      const id = await this.catalogue.createProduct(context, dto);
      return { id, sku: dto.sku.trim().toUpperCase() };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Patch('products/:productId')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateProduct(
    @CurrentAuthContext() context: AuthContext,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: ProductDto
  ) {
    try {
      await this.catalogue.updateProduct(context, productId, dto);
      return { id: productId, updated: true };
    } catch (err) {
      throw toHttp(err);
    }
  }

  /** Activate / deactivate, and today's availability. */
  @Patch('products/:productId/flags')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async setFlags(
    @CurrentAuthContext() context: AuthContext,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: ProductFlagsDto
  ) {
    try {
      await this.catalogue.setFlags(context, productId, dto);
      return { id: productId, updated: true };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Patch('products/:productId/price')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async setPrice(
    @CurrentAuthContext() context: AuthContext,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() dto: ProductPriceDto
  ) {
    try {
      await this.catalogue.setPrice(context, productId, dto);
      return { id: productId, updated: true };
    } catch (err) {
      throw toHttp(err);
    }
  }

  // -------------------------------------------------------------------- images

  /**
   * Upload a product photo from the administrator's own computer.
   *
   * The file is held in memory, checked by its MAGIC BYTES (not its name or
   * its declared type), size-limited by configuration, and written under a
   * generated key. A previously uploaded image is deleted once the new key is
   * recorded, so an orphan file is not left behind.
   */
  @Post('products/:productId/image')
  @RequirePermissions('pif.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_BACKSTOP_BYTES, files: 1 } }))
  async uploadProductImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @UploadedFile() file?: { buffer?: Buffer; size?: number; originalname?: string }
  ) {
    try {
      const existing = await this.catalogue.adminProduct(productId);
      if (file?.buffer === undefined) {
        throw new MediaError('EMPTY', 'No file was uploaded.');
      }
      const stored = await this.media.store('products', file.buffer);
      await this.catalogue.setProductImage(context, productId, stored.key);
      await this.media.remove(existing.image_ref);
      return {
        id: productId,
        imageRef: stored.key,
        imageUrl: imageUrl(stored.key),
        bytes: stored.bytes,
        contentType: stored.contentType,
        sha256: stored.sha256,
      };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Delete('products/:productId/image')
  @RequirePermissions('pif.product.manage')
  async removeProductImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('productId', new ParseUUIDPipe()) productId: string
  ) {
    try {
      const existing = await this.catalogue.adminProduct(productId);
      await this.catalogue.setProductImage(context, productId, null);
      await this.media.remove(existing.image_ref);
      return { id: productId, imageRef: null };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('categories/:categoryId/image')
  @RequirePermissions('pif.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_BACKSTOP_BYTES, files: 1 } }))
  async uploadCategoryImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @UploadedFile() file?: { buffer?: Buffer }
  ) {
    try {
      if (file?.buffer === undefined) {
        throw new MediaError('EMPTY', 'No file was uploaded.');
      }
      const stored = await this.media.store('categories', file.buffer);
      await this.catalogue.setCategoryImage(context, categoryId, stored.key);
      return { id: categoryId, imageRef: stored.key, imageUrl: imageUrl(stored.key) };
    } catch (err) {
      throw toHttp(err);
    }
  }

  // ----------------------------------------------------------------- tax rates

  @Get('tax-rates')
  @RequirePermissions('pif.product.manage')
  async taxRates() {
    const rows = await this.catalogue.taxRates();
    return {
      items: rows.map((rate) => ({
        id: rate.id,
        name: rate.name,
        ratePct: Number(rate.rate_pct),
        active: rate.active,
      })),
    };
  }

  @Post('tax-rates')
  @RequirePermissions('pif.product.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async createTaxRate(@Body() dto: TaxRateDto) {
    const id = await this.catalogue.createTaxRate(dto.name, dto.ratePct);
    return { id, name: dto.name, ratePct: dto.ratePct };
  }

  // -------------------------------------------------------------- order desk

  @Get('orders')
  @RequireAnyPermission(
    'pif.order.prepare',
    'pif.order.manage',
    'pif.order.mark_delivered',
    'pif.order.mark_not_delivered'
  )
  async orderQueue(
    @Query('status') status?: string,
    @Query('open') open?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    const result = await this.orders.staffQueue({
      status: status ?? null,
      openOnly: open !== 'false',
      query: q ?? null,
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 25),
    });
    return {
      items: result.items.map(orderQueueView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  /**
   * One order, as the staff member fulfilling it needs to see it: the
   * customer's name and number, where it goes, what to pick, what to collect
   * in cash, and the whole history with each actor named.
   */
  @Get('orders/:orderId')
  @RequireAnyPermission(
    'pif.order.prepare',
    'pif.order.manage',
    'pif.order.mark_delivered',
    'pif.order.mark_not_delivered'
  )
  async order(@Param('orderId', new ParseUUIDPipe()) orderId: string) {
    try {
      const view = await this.orders.staffView(orderId);
      return staffOrderView(view.order, view.items, view.events, this.orders.nextSteps(view.order.status));
    } catch (err) {
      throw toHttp(err);
    }
  }

  /**
   * Record an operational move.
   *
   * ONE ROUTE for the whole lifecycle, because the authority check is
   * per-STATUS, not per-URL: the service refuses a status the caller holds no
   * permission for, so a delivery staff member can record DELIVERED and
   * nothing else, and the rule lives in one readable place rather than
   * scattered across eight endpoints.
   */
  @Post('orders/:orderId/status')
  @RequireAnyPermission(
    'pif.order.prepare',
    'pif.order.manage',
    'pif.order.mark_delivered',
    'pif.order.mark_not_delivered'
  )
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async recordStatus(
    @CurrentAuthContext() context: AuthContext,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: OrderStatusDto
  ) {
    try {
      const recorded = await this.orders.recordStatus(context, orderId, {
        status: dto.status,
        reason: dto.reason ?? null,
        notes: dto.notes ?? null,
      });
      return { orderId, ...recorded };
    } catch (err) {
      throw toHttp(err);
    }
  }

  @Post('orders/:orderId/notes')
  @RequireAnyPermission('pif.order.prepare', 'pif.order.manage')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async addNote(
    @CurrentAuthContext() context: AuthContext,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: OrderNoteDto
  ) {
    try {
      const eventId = await this.orders.addNote(context, orderId, dto.note);
      return { orderId, eventId };
    } catch (err) {
      throw toHttp(err);
    }
  }

  // ------------------------------------------------- notification settings

  /**
   * THE PIF ORDER-ALERT SOUND, read.
   *
   * Open to every staff member who can reach a PIF screen, because hearing
   * the alert is not a privilege — the same codes that let someone see the
   * order queue or the catalogue let them learn which sound is configured.
   * Nothing here exposes a filesystem path: `url` is the API route that
   * streams the audio, and the stored key is not returned at all.
   */
  @Get('settings/order-alert-sound')
  @RequireAnyPermission(
    'pif.product.manage',
    'pif.order.prepare',
    'pif.order.manage',
    'pif.order.mark_delivered',
    'pif.order.mark_not_delivered'
  )
  async orderAlertSound() {
    try {
      return alertSoundView(await this.alertSound.active(), this.alertSound.limitBytes);
    } catch (err) {
      throw toHttp(err);
    }
  }

  /**
   * Replace it with the administrator's own MP3.
   *
   * `pif.product.manage` — the same code that governs every other piece of
   * client-managed PIF content, product and category images included. A
   * staff member without it is refused here by the AuthorizationGuard, which
   * reads the live grant on every request; the disabled button in the portal
   * is a courtesy that explains the refusal in advance, not the check.
   *
   * The file is held in memory, checked by its MAGIC BYTES (not its name and
   * not its declared type), size-limited by configuration, and written under
   * a generated key inside a server-configured directory. The file it
   * replaces is deleted once the new one is recorded.
   */
  @Post('settings/order-alert-sound')
  @RequirePermissions('pif.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_BACKSTOP_BYTES, files: 1 } }))
  async replaceOrderAlertSound(
    @CurrentAuthContext() context: AuthContext,
    @UploadedFile() file?: { buffer?: Buffer; originalname?: string }
  ) {
    try {
      if (file?.buffer === undefined) {
        throw new MediaError('EMPTY', 'No file was uploaded.');
      }
      const active = await this.alertSound.replace(
        file.buffer,
        file.originalname,
        context.principalId
      );
      return alertSoundView(active, this.alertSound.limitBytes);
    } catch (err) {
      throw toHttp(err);
    }
  }

  /** Back to the sound the system was supplied with. */
  @Delete('settings/order-alert-sound')
  @RequirePermissions('pif.product.manage')
  async restoreOrderAlertSound() {
    try {
      return alertSoundView(await this.alertSound.restoreDefault(), this.alertSound.limitBytes);
    } catch (err) {
      throw toHttp(err);
    }
  }
}

/**
 * What the portal is told about the configured sound.
 *
 * Deliberately NOT the stored key and never a filesystem path: `url` is the
 * route that streams the audio, and `filename` is the uploaded file's own
 * name kept for display only. `limitBytes` is included so the screen can
 * state the real limit rather than hard-code a number that could drift from
 * PIF_MEDIA_MAX_BYTES.
 */
function alertSoundView(active: ActiveAlertSound, limitBytes: number) {
  return {
    filename: active.filename,
    isDefault: active.isDefault,
    bytes: active.bytes,
    sha256: active.sha256,
    updatedAt: active.updatedAt,
    url: '/pif/alert-sound',
    limitBytes,
  };
}

function adminProductView(product: ProductRecord) {
  return {
    ...productView(product),
    barcode: product.barcode,
    taxRateId: product.tax_rate_id,
    purchasePrice: product.purchase_price === null ? null : Number(product.purchase_price),
    active: product.active,
    variantGroup: product.variant_group,
    imageRef: product.image_ref,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
    createdBy: product.created_by,
    updatedBy: product.updated_by,
  };
}

function orderQueueView(order: StaffQueueRecord) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    fulfillmentMode: order.fulfillment_mode,
    customerName: order.customer_name,
    customerMobile: order.customer_mobile,
    itemCount: order.item_count,
    // The delivery charge on this order, so the desk and the driver can see
    // what the total is made of. 0 on pickup and on any order that reached
    // the free-delivery threshold.
    deliveryTotal: Number(order.delivery_total),
    total: Number(order.total),
    placedAt: order.placed_at,
    updatedAt: order.updated_at,
    /*
     * FOR THE ORDER DESK'S INCOMING-ORDER ALERT, both derived, both
     * read-only, neither stored. `business` is 'grocers', 'fresh-mart',
     * 'mixed' or null -- an order holds no business of its own, because the
     * customer has one PIF cart rather than one per shop. `acknowledged`
     * says whether a staff member has marked the alert Received; it is read
     * from the order's NOTE events and says NOTHING about the order's
     * status, which only a STATUS event can move.
     */
    business: order.business_slug,
    acknowledged: order.acknowledged,
  };
}

function staffOrderView(
  order: OrderRecord,
  items: OrderItemRecord[],
  events: OrderEventRecord[],
  nextSteps: readonly string[]
) {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    nextSteps,
    fulfillmentMode: order.fulfillment_mode,
    paymentMethod: order.payment_method,
    customer: {
      id: order.customer_id,
      name: order.customer_name,
      mobile: order.customer_mobile,
      contactName: order.contact_name,
      contactMobile: order.contact_mobile,
    },
    deliveryAddress: order.delivery_address_snapshot,
    customerNote: order.customer_note,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discount_total),
    taxTotal: Number(order.tax_total),
    /**
     * The delivery charge as it was applied to THIS order. A past order keeps
     * the figure it was placed with, whatever today's rule would say.
     */
    deliveryTotal: Number(order.delivery_total),
    total: Number(order.total),
    /** What to collect in cash at handover, delivery included. Not a bill. */
    codAmount: order.cod_amount === null ? null : Number(order.cod_amount),
    codCollectedAt: order.cod_collected_at,
    placedAt: order.placed_at,
    items: items.map((item) => ({
      productId: item.product_id,
      sku: item.sku,
      name: item.product_name,
      brand: item.brand,
      unit: item.unit,
      packSize: item.pack_size === null ? null : Number(item.pack_size),
      imageUrl: imageUrl(item.image_ref),
      qty: Number(item.qty),
      unitPrice: Number(item.unit_price),
      taxRateName: item.tax_rate_name,
      taxRatePct: Number(item.tax_rate_pct),
      discountPct: Number(item.discount_pct),
      lineSubtotal: Number(item.line_subtotal),
      lineDiscount: Number(item.line_discount),
      lineTax: Number(item.line_tax),
      lineTotal: Number(item.line_total),
    })),
    history: events.map((event) => ({
      eventId: event.id,
      sequenceNo: event.sequence_no,
      eventType: event.event_type,
      status: event.status,
      reason: event.reason,
      notes: event.notes,
      recordedAt: event.recorded_at,
      recordedBy: {
        staffId: event.recorded_by,
        name: event.recorded_by_name,
        role: event.recorded_by_role,
      },
    })),
  };
}

function isStatusFilter(value: string | undefined): value is 'ALL' | 'ACTIVE' | 'INACTIVE' | 'UNAVAILABLE' {
  return value === 'ALL' || value === 'ACTIVE' || value === 'INACTIVE' || value === 'UNAVAILABLE';
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Each refusal gets the status code that describes it, never a bare 500. */
function importBatchView(batch: ImportBatchRecord) {
  return {
    id: batch.id,
    filename: batch.source_filename,
    format: batch.source_format,
    bytes: batch.byte_size,
    status: batch.status,
    totalRows: batch.total_rows,
    createRows: batch.create_rows,
    updateRows: batch.update_rows,
    invalidRows: batch.invalid_rows,
    appliedRows: batch.applied_rows,
    failureReason: batch.failure_reason,
    uploadedBy: batch.uploaded_by_name,
    uploadedAt: batch.created_at,
    decidedBy: batch.decided_by_name,
    decidedAt: batch.decided_at,
  };
}

function importRowView(row: ImportRowRecord) {
  const parsed = (row.parsed.input ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    rowNo: row.row_no,
    verdict: row.verdict,
    sku: row.sku,
    name: row.name,
    productId: row.target_product_id,
    problems: row.problems,
    appliedAt: row.applied_at,
    // Enough of the parsed row for the operator to recognise it, not the
    // whole payload: a preview screen is for judging, not for re-reading
    // the spreadsheet.
    sellingPrice: typeof parsed.sellingPrice === 'number' ? parsed.sellingPrice : null,
    unit: typeof parsed.unit === 'string' ? parsed.unit : null,
    categoryId: typeof parsed.categoryId === 'string' ? parsed.categoryId : null,
    available: typeof parsed.available === 'boolean' ? parsed.available : null,
    active: typeof parsed.active === 'boolean' ? parsed.active : null,
  };
}

function toHttp(err: unknown): unknown {
  if (err instanceof CatalogueError) {
    if (err.code === 'PRODUCT_NOT_FOUND' || err.code === 'CATEGORY_NOT_FOUND') {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    if (err.code === 'DUPLICATE_SKU' || err.code === 'DUPLICATE_CATEGORY' || err.code === 'CATEGORY_IN_USE') {
      return new ConflictException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.code, ...(err.details ?? {}) },
      });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code, ...(err.details ?? {}) },
    });
  }
  if (err instanceof OrderError) {
    if (err.code === 'ORDER_NOT_FOUND') {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    if (err.code === 'NOT_PERMITTED') {
      return new ForbiddenException({
        code: ERROR_CODES.FORBIDDEN,
        message: err.message,
        details: { reason: err.code, ...(err.details ?? {}) },
      });
    }
    if (err.code === 'ALREADY_FINISHED' || err.code === 'DUPLICATE_REQUEST') {
      return new ConflictException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.code, ...(err.details ?? {}) },
      });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code, ...(err.details ?? {}) },
    });
  }
  if (err instanceof ImportError) {
    if (err.code === 'BATCH_NOT_FOUND') {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    if (err.code === 'BATCH_ALREADY_DECIDED') {
      return new ConflictException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.code, ...(err.details ?? {}) },
      });
    }
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code, ...(err.details ?? {}) },
    });
  }
  if (err instanceof MediaError) {
    return new BadRequestException({
      code: ERROR_CODES.VALIDATION_FAILED,
      message: err.message,
      details: { reason: err.code },
    });
  }
  return err;
}
