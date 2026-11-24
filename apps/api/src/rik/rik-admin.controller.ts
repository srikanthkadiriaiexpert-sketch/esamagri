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
  Query,
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
import {
  ConfigRecordNotFoundError,
  ConfigValidationError,
  RikAdminConfigService,
} from './services/rik-admin-config.service';
import {
  CreateConversionDto,
  CreatePoolDto,
  CreateProvisionDto,
  CreateScaleDto,
  SetActiveDto,
  SupersedeScaleDto,
  UpdateConversionDto,
  UpdatePoolDto,
  UpdateProvisionDto,
  UpdateScaleDto,
  CreatePickupLocationDto,
  UpdatePickupLocationDto,
} from './dto/rik-admin-config.dto';
import type {
  AdminConversionRow,
  AdminPoolRow,
  AdminProvisionRow,
  AdminScaleRow,
} from './repositories/entitlement-config-admin.repository';
import type { AuditEntryRecord } from '../shared/repositories/audit-log.repository';
import type { PickupLocationRecord } from './repositories/pickup-locations.repository';
import { MediaError, RikMediaService, rikImageUrl } from './services/rik-media.service';

/**
 * A hard ceiling on what the request parser will even hold in memory. The
 * real, configurable limit is PIF_MEDIA_MAX_BYTES, enforced in
 * RikMediaService; this one exists so an enormous upload is dropped at the
 * transport instead of being buffered first.
 */
const UPLOAD_BACKSTOP_BYTES = 8_000_000;

/**
 * RIK entitlement configuration API (STEP 11C).
 *
 * AUTHORIZATION — no new role, no new permission.
 * The approved seed already contains exactly the two codes this needs,
 * and both are held by RIK_ADMIN and by no other role:
 *
 *   rik.entitlement.adjust  — pools, daily scales, conversions.
 *                             The rules that decide how much a person
 *                             is entitled to.
 *   rik.product.manage      — provisions (the SKU master), pack sizes,
 *                             limits, issue period and availability.
 *                             The items that entitlement is spent on.
 *
 * SUPER_ADMIN deliberately does NOT hold either: in the approved seed it
 * holds only the five shared user/role/settings/audit/announcement
 * codes. That is reported, not worked around — widening it would be a
 * database change and is the facility's decision, not this step's.
 * PIF_ADMIN, RIK_PICKUP_STAFF and PIF_PICKUP_STAFF hold neither code,
 * so every write route below is 403 for them, and a CUSTOMER holds no
 * permissions at all.
 *
 * READ is gated identically to WRITE on each route. A staff member who
 * may not change the entitlement rules has no business reading the full
 * administrative view of them either — including the retired rows,
 * which the customer-facing engine never exposes.
 *
 * WHAT THIS CONTROLLER DOES NOT DO.
 * It holds no business rule. It converts an HTTP request into a service
 * call and a service error into a status code; every quantity, ratio,
 * date-window and uniqueness rule is decided in RikAdminConfigService,
 * so a rule cannot be bypassed by reaching the service another way.
 *
 * THE LINK TO THE ENGINE.
 * These routes write the same four tables STEP 11B's
 * EntitlementConfigRepository reads. There is no cache, no copy and no
 * publish step: a change committed here is in force on the next
 * calculation. Not one line of the calculation engine was modified for
 * this step.
 */
@Controller('admin/rik/config')
@UseGuards(JwtAuthGuard, AuthorizationGuard)
export class RikAdminController {
  constructor(
    private readonly config: RikAdminConfigService,
    private readonly media: RikMediaService
  ) {}

  // ================================================================ pools

  @Get('pools')
  @RequirePermissions('rik.entitlement.adjust')
  async listPools() {
    const items = await this.config.listPools();
    return { items: items.map(poolView) };
  }

  @Post('pools')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async createPool(@CurrentAuthContext() context: AuthContext, @Body() dto: CreatePoolDto) {
    return this.run(() => this.config.createPool(context, dto), poolView);
  }

  @Patch('pools/:id')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async updatePool(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePoolDto
  ) {
    return this.run(() => this.config.updatePool(context, id, dto), poolView);
  }

  /**
   * Retire or restore a pool. Deliberately not DELETE: the database
   * revokes DELETE on this table from the application role, because a
   * confirmed selection's rule snapshot refers to the configuration
   * that produced it.
   */
  @Post('pools/:id/active')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async setPoolActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetActiveDto
  ) {
    return this.run(() => this.config.setPoolActive(context, id, dto.isActive), poolView);
  }

  // =============================================================== scales

  @Get('scales')
  @RequirePermissions('rik.entitlement.adjust')
  async listScales(@Query('poolId') poolId?: string) {
    const items = await this.config.listScales(poolId ?? null);
    return { items: items.map(scaleView) };
  }

  @Post('scales')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async createScale(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateScaleDto) {
    return this.run(() => this.config.createScale(context, dto), scaleView);
  }

  @Patch('scales/:id')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async updateScale(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateScaleDto
  ) {
    return this.run(() => this.config.updateScale(context, id, dto), scaleView);
  }

  /**
   * Change a scale from a date forward without rewriting the past: the
   * current row is closed the day before, a new row opens on the date
   * given. The old row stays readable with the window it applied to.
   */
  @Post('scales/:id/supersede')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async supersedeScale(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SupersedeScaleDto
  ) {
    try {
      const result = await this.config.supersedeScale(context, id, dto);
      return { closed: scaleView(result.closed), created: scaleView(result.created) };
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  @Post('scales/:id/active')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async setScaleActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetActiveDto
  ) {
    return this.run(() => this.config.setScaleActive(context, id, dto.isActive), scaleView);
  }

  // ========================================================== conversions

  @Get('conversions')
  @RequirePermissions('rik.entitlement.adjust')
  async listConversions() {
    const items = await this.config.listConversions();
    return { items: items.map(conversionView) };
  }

  @Post('conversions')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async createConversion(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateConversionDto) {
    return this.run(() => this.config.createConversion(context, dto), conversionView);
  }

  @Patch('conversions/:id')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async updateConversion(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConversionDto
  ) {
    return this.run(() => this.config.updateConversion(context, id, dto), conversionView);
  }

  @Post('conversions/:id/active')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async setConversionActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetActiveDto
  ) {
    return this.run(() => this.config.setConversionActive(context, id, dto.isActive), conversionView);
  }

  // =========================================================== provisions
  // Gated by rik.product.manage, not rik.entitlement.adjust: a provision
  // is an item, not an entitlement rule. Both codes are RIK_ADMIN-only
  // today, so the practical effect is the same — but the codes mean
  // different things and if the facility ever splits those duties the
  // split already works without a code change.

  @Get('provisions')
  @RequirePermissions('rik.product.manage')
  async listProvisions(@Query('poolId') poolId?: string) {
    const items = await this.config.listProvisions(poolId ?? null);
    return { items: items.map(provisionView) };
  }

  /**
   * Pools, for the provision editors' pool picker. Gated by
   * `rik.product.manage` so the SKU screens do not require the
   * entitlement-rule permission just to show a pool's name.
   */
  @Get('provision-pools')
  @RequirePermissions('rik.product.manage')
  async listPoolsForProvisions() {
    const items = await this.config.listPools();
    return { items: items.map(poolView) };
  }

  @Post('provisions')
  @RequirePermissions('rik.product.manage')
  @UsePipes(configPipe())
  async createProvision(@CurrentAuthContext() context: AuthContext, @Body() dto: CreateProvisionDto) {
    return this.run(() => this.config.createProvision(context, dto), provisionView);
  }

  @Patch('provisions/:id')
  @RequirePermissions('rik.product.manage')
  @UsePipes(configPipe())
  async updateProvision(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProvisionDto
  ) {
    return this.run(() => this.config.updateProvision(context, id, dto), provisionView);
  }

  @Post('provisions/:id/active')
  @RequirePermissions('rik.product.manage')
  @UsePipes(configPipe())
  async setProvisionActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetActiveDto
  ) {
    return this.run(() => this.config.setProvisionActive(context, id, dto.isActive), provisionView);
  }

  // ------------------------------------------------- provision pictures
  //
  // Gated by `rik.product.manage`, the same code as the rest of the SKU
  // master: a photograph is a catalogue detail, and an administrator who may
  // rename a provision may illustrate it. Nothing here can reach an
  // entitlement figure.
  //
  // WHAT THE 180 EXISTING PICTURES DO. They are `/catalogue/rik/...` paths
  // typed into the image-reference field and served by the customer app's own
  // bundle. They are untouched by these two routes: this store does not own
  // such a key, so `remove` on one is a deliberate no-op and no committed
  // artwork file can be deleted by a row changing.

  /**
   * Upload a provision picture from the administrator's own computer, or
   * replace the one already there.
   *
   * The file is held in memory, checked by its MAGIC BYTES (not its name or
   * its declared type), size-limited by configuration, and written under a
   * generated key. The database row is updated FIRST and the previous file
   * deleted only afterwards, so a failure can never leave a row pointing at
   * a file that has already gone.
   */
  @Post('provisions/:id/image')
  @RequirePermissions('rik.product.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_BACKSTOP_BYTES, files: 1 } }))
  async uploadProvisionImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: { buffer?: Buffer; size?: number; originalname?: string }
  ) {
    try {
      if (file?.buffer === undefined) {
        throw new MediaError('EMPTY', 'No file was uploaded.');
      }
      const stored = await this.media.store(file.buffer);
      const { before, after } = await this.config.setProvisionImage(context, id, stored.key);
      // Only ever deletes a key this store owns, so a `/catalogue/...` path
      // that was replaced by an upload is left on disk where it belongs.
      await this.media.remove(before.image_ref);
      return {
        id,
        code: after.code,
        imageRef: stored.key,
        imageUrl: rikImageUrl(stored.key),
        bytes: stored.bytes,
        contentType: stored.contentType,
        sha256: stored.sha256,
      };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  /** Detach a provision's picture, and delete the file if we stored it. */
  @Delete('provisions/:id/image')
  @RequirePermissions('rik.product.manage')
  async removeProvisionImage(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    try {
      const { before, after } = await this.config.setProvisionImage(context, id, null);
      await this.media.remove(before.image_ref);
      return { id, code: after.code, imageRef: null, imageUrl: null };
    } catch (err) {
      throw toMediaHttp(err);
    }
  }

  // ==================================================== pickup locations
  //
  // Gated by `rik.entitlement.adjust`, the same code that governs the
  // entitlement rules. A collection point decides where an officer must
  // travel to receive their ration, which is a facility policy rather
  // than a catalogue detail — so it sits with the rules, not with the
  // SKU master.

  @Get('pickup-locations')
  @RequirePermissions('rik.entitlement.adjust')
  async listPickupLocations() {
    const items = await this.config.listPickupLocations();
    return { items: items.map(pickupLocationView) };
  }

  @Post('pickup-locations')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async createPickupLocation(
    @CurrentAuthContext() context: AuthContext,
    @Body() dto: CreatePickupLocationDto
  ) {
    return this.run(() => this.config.createPickupLocation(context, dto), pickupLocationView);
  }

  @Patch('pickup-locations/:id')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async updatePickupLocation(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePickupLocationDto
  ) {
    return this.run(() => this.config.updatePickupLocation(context, id, dto), pickupLocationView);
  }

  /** Retire or restore. No delete: a confirmed selection names one. */
  @Post('pickup-locations/:id/active')
  @RequirePermissions('rik.entitlement.adjust')
  @UsePipes(configPipe())
  async setPickupLocationActive(
    @CurrentAuthContext() context: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetActiveDto
  ) {
    return this.run(() => this.config.setPickupLocationActive(context, id, dto.isActive), pickupLocationView);
  }

  // ========================================================= rule history

  /**
   * What changed, who changed it and when — read from the append-only
   * shared.audit_log, filtered to the four RIK configuration tables.
   * Gated by `rik.entitlement.adjust` because the history includes the
   * entitlement rules themselves.
   */
  @Get('history')
  @RequirePermissions('rik.entitlement.adjust')
  async history(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit?: string
  ) {
    const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      throw new BadRequestException({ code: ERROR_CODES.VALIDATION_FAILED, message: 'limit must be a number.' });
    }
    const items = await this.config.listHistory({
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      limit: parsedLimit,
    });
    return { items: items.map(historyView) };
  }

  // ============================================================= internals

  private async run<TRow, TView>(action: () => Promise<TRow>, view: (row: TRow) => TView): Promise<TView> {
    try {
      return view(await action());
    } catch (err: unknown) {
      throw this.toHttp(err);
    }
  }

  /**
   * A refused configuration change is 400 with the machine-readable
   * reason and the offending field, so the screen can point at the
   * input rather than showing a wall of text. A missing row is 404.
   * Anything else is left alone for the global filter — an unexpected
   * failure must not be dressed up as a validation problem.
   */
  private toHttp(err: unknown): unknown {
    if (err instanceof ConfigValidationError) {
      return new BadRequestException({
        code: ERROR_CODES.VALIDATION_FAILED,
        message: err.message,
        details: { reason: err.code, field: err.field, ...err.detail },
      });
    }
    if (err instanceof ConfigRecordNotFoundError) {
      return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
    }
    return err;
  }
}

function configPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}

/**
 * The upload routes' error mapping.
 *
 * A refused file is the administrator's mistake to correct — wrong format,
 * too large, nothing attached — so it is a 400 carrying the reason code and
 * a message written for a person. A missing provision is a 404. `NOT_FOUND`
 * and `BAD_KEY` cannot arise on these two routes (the key is generated here,
 * never supplied), but they are mapped to 404 rather than 400 so that if
 * they ever do, the status still describes what happened.
 */
function toMediaHttp(err: unknown): unknown {
  if (err instanceof ConfigRecordNotFoundError) {
    return new NotFoundException({ code: ERROR_CODES.NOT_FOUND, message: err.message });
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

// ----------------------------------------------------------- view shapes
// snake_case rows become camelCase JSON here and nowhere else, so the
// admin console never sees a column name and a column rename does not
// reach the frontend.

function poolView(r: AdminPoolRow) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    rationType: r.ration_type,
    unit: r.unit,
    description: r.description,
    // The category's cover picture, or null. Presentation only.
    imageRef: r.image_ref,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
  };
}

function scaleView(r: AdminScaleRow) {
  return {
    id: r.id,
    poolId: r.pool_id,
    poolCode: r.pool_code,
    poolName: r.pool_name,
    poolUnit: r.pool_unit,
    dietaryPreference: r.dietary_preference,
    dailyQty: r.daily_qty,
    notes: r.notes,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
  };
}

function conversionView(r: AdminConversionRow) {
  return {
    id: r.id,
    code: r.code,
    fromPoolId: r.from_pool_id,
    fromPoolCode: r.from_pool_code,
    toPoolId: r.to_pool_id,
    toPoolCode: r.to_pool_code,
    fromQty: r.from_qty,
    toQty: r.to_qty,
    mode: r.mode,
    dietaryPreference: r.dietary_preference,
    description: r.description,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
  };
}

function provisionView(r: AdminProvisionRow) {
  return {
    id: r.id,
    poolId: r.pool_id,
    poolCode: r.pool_code,
    poolName: r.pool_name,
    poolRationType: r.pool_ration_type,
    code: r.code,
    name: r.name,
    brand: r.brand,
    // Both, deliberately. `imageRef` is what the administrator typed or what
    // an upload stored, and the screen still edits it as text for the 180
    // committed `/catalogue/...` pictures. `imageUrl` is the same value
    // resolved to something a browser can actually load.
    imageRef: r.image_ref,
    imageUrl: rikImageUrl(r.image_ref),
    packUnit: r.pack_unit,
    unit: r.unit,
    consumptionRatio: r.consumption_ratio,
    packSize: r.pack_size,
    isLoose: r.is_loose,
    isCustomerSelectable: r.is_customer_selectable,
    wholeUnitsOnly: r.whole_units_only,
    maxQuantity: r.max_quantity,
    maxPacks: r.max_packs,
    minEligibleDays: r.min_eligible_days,
    issuePeriod: r.issue_period,
    dietaryPreference: r.dietary_preference,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
  };
}

function historyView(r: AuditEntryRecord) {
  return {
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorId: r.actor_id,
    actorName: r.actor_display_name ?? r.actor_username,
    actorRole: r.actor_role,
    before: r.before_data,
    after: r.after_data,
    createdAt: r.created_at,
  };
}

function pickupLocationView(r: PickupLocationRecord) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    displayOrder: r.display_order,
    isActive: r.is_active,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    updatedAt: r.updated_at,
  };
}
