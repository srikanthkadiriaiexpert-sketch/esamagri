import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { PifCatalogueRepository } from './repositories/pif-catalogue.repository';
import { PifOrdersRepository } from './repositories/pif-orders.repository';
import { PifImportRepository } from './repositories/pif-import.repository';
import { PifPricingService } from './services/pif-pricing.service';
import { PifCatalogueService } from './services/pif-catalogue.service';
import { PifMediaService } from './services/pif-media.service';
import { PifAlertSoundService } from './services/pif-alert-sound.service';
import { PifOrderService } from './services/pif-order.service';
import { PifImportService } from './services/pif-import.service';
import { PifController } from './pif.controller';
import { PifAdminController } from './pif-admin.controller';
import { PifMediaController } from './pif-media.controller';
import { PifAlertSoundController } from './pif-alert-sound.controller';

/**
 * Owns the `pif.*` schema — Payment in Facility, the facility's online
 * grocery module (PHASE F).
 *
 * WHAT THIS MODULE IS. A grocery shop: a client-managed catalogue of
 * categories, subcategories and products with their own images and prices; a
 * cart and a cash-on-delivery checkout; and an order desk where the
 * facility's staff accept, pick, pack and hand over what was ordered.
 *
 * WHAT THIS MODULE IS NOT, per the corrected PIF scope. There is no point of
 * sale, no cashier shift, no bill, no invoice, no receipt, no cash drawer, no
 * refund, no purchase order, no supplier, no goods receipt and no stock
 * quantity. Billing happens in the facility's own separate software; this
 * module records what was ordered and what became of it, and carries the
 * order's amounts so the shopper knows what to have ready. The 14 Phase 2
 * tables that served the superseded scope are referenced by nothing here.
 *
 * NO PURCHASING ROLE, and no new role of any kind: PHASE F added exactly two
 * permissions (`pif.order.manage`, `pif.order.prepare`) to the approved
 * six-role set, because the seed had no permission that governed a PIF order
 * at all.
 *
 * Boundary rule (non-negotiable, and unchanged since the Phase 3A blueprint):
 * PifModule may import SharedModule and AuthModule. PifModule must NEVER
 * import RikModule, and no PifModule provider may be imported by RikModule.
 * The two modules share authentication and nothing else — separate tables,
 * separate permissions, separate workflows, separate carts, separate orders.
 */
@Module({
  // SharedModule supplies the shared.* repositories (audit log, customers);
  // AuthModule supplies the guards. Neither reaches into RIK.
  imports: [SharedModule, AuthModule],
  controllers: [
    PifController,
    PifAdminController,
    PifMediaController,
    // Streams the client-configured order-alert sound. PIF-only, like
    // everything else here; it reads no RIK table and no RIK permission.
    PifAlertSoundController,
  ],
  providers: [
    PifCatalogueRepository,
    PifOrdersRepository,
    PifImportRepository,
    PifPricingService,
    PifCatalogueService,
    PifMediaService,
    PifAlertSoundService,
    PifOrderService,
    PifImportService,
  ],
  exports: [PifCatalogueService, PifOrderService],
})
export class PifModule {}
