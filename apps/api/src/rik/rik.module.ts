import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { IssueSchedulesRepository } from './repositories/issue-schedules.repository';
import { EntitlementConfigRepository } from './repositories/entitlement-config.repository';
import { EntitlementConfigAdminRepository } from './repositories/entitlement-config-admin.repository';
import { PickupLocationsRepository } from './repositories/pickup-locations.repository';
import { OfficersRepository } from './repositories/officers.repository';
import { EligibilityImportRepository } from './repositories/eligibility-import.repository';
import { CustomerEligibilityFiguresRepository } from './repositories/customer-eligibility-figures.repository';
import { IssueWindowsRepository } from './repositories/issue-windows.repository';
import { IssueVouchersRepository } from './repositories/issue-vouchers.repository';
import { IncomingRequestsRepository } from './repositories/incoming-requests.repository';
import { FulfillmentRepository } from './repositories/fulfillment.repository';
import { EntitlementPeriodsRepository } from './repositories/entitlement-periods.repository';
import { RikEntitlementPeriodsController } from './rik-entitlement-periods.controller';
import { RikEntitlementPeriodService } from './services/rik-entitlement-period.service';
import { EntitlementSelectionsRepository } from './repositories/entitlement-selections.repository';
import { RikConversionService } from './services/rik-conversion.service';
import { RikEligibilityService } from './services/rik-eligibility.service';
import { RikEntitlementService } from './services/rik-entitlement.service';
import { RikSelectionValidationService } from './services/rik-selection-validation.service';
import { RikAdminConfigService } from './services/rik-admin-config.service';
import { RikOfficerService } from './services/rik-officer.service';
import { ExcelEligibilityParserService } from './services/excel-eligibility-parser.service';
import { RikEligibilityAdminService } from './services/rik-eligibility-admin.service';
import { RikIssueWindowService } from './services/rik-issue-window.service';
import { RikIssueVoucherService } from './services/rik-issue-voucher.service';
import { RikVoucherExportService } from './services/rik-voucher-export.service';
import { RikIncomingRequestService } from './services/rik-incoming-request.service';
import { RikFulfillmentService } from './services/rik-fulfillment.service';
import { RikMediaService } from './services/rik-media.service';
import { RikController } from './rik.controller';
import { CommonContentController } from './common-content.controller';
import { RikNewArrivalsAdminController } from './rik-new-arrivals-admin.controller';
import { NewArrivalsRepository } from './repositories/new-arrivals.repository';
import { RikNewArrivalsService } from './services/rik-new-arrivals.service';
import { RikBannersAdminController } from './rik-banners-admin.controller';
import { PromotionalBannersRepository } from './repositories/promotional-banners.repository';
import { RikBannersService } from './services/rik-banners.service';
import { RikMediaController } from './rik-media.controller';
import { RikAdminController } from './rik-admin.controller';
import { RikOfficersController } from './rik-officers.controller';
import { RikEligibilityController } from './rik-eligibility.controller';
import { RikIssueWindowsController } from './rik-issue-windows.controller';
import { RikIssueVouchersController } from './rik-issue-vouchers.controller';
import { RikIncomingRequestsController } from './rik-incoming-requests.controller';
import { RikFulfillmentController } from './rik-fulfillment.controller';

/**
 * Owns the `rik.*` schema (Ration in Kind — entitlement, catalog,
 * orders, issue schedules).
 *
 * STEP 11 adds the entitlement and conversion engine: a configuration
 * repository, the eligibility / entitlement / conversion / validation
 * services, and the customer-facing "Know Your Ration" API.
 *
 * STEP 11C adds the administrative side of the same configuration: a
 * write repository, a validation/audit service, and RikAdminController
 * under /admin/rik/config. It writes the very tables the engine reads,
 * so an administrator's change is in force on the next calculation. Not
 * one line of the calculation engine changed for it — the engine was
 * already data-driven, which is the whole reason this step is a new
 * controller rather than a rewrite.
 *
 * The engine holds no business rule of its own. Scales, ratios, limits
 * and dietary applicability all live in the database, so a RIK
 * administrator changes behaviour by changing rows — never by asking for
 * a code change.
 *
 * Boundary rule (non-negotiable): RikModule may import SharedModule.
 * RikModule must NEVER import PifModule, and no RikModule provider may
 * be imported by PifModule. This mirrors the RIK/PIF separation
 * required at the database, API, and UI-state level — the customer
 * app's RIK/PIF toggle is a convenience only, never a security
 * boundary, and this module split is the same principle applied to the
 * backend's own internal structure.
 */
@Module({
  // SharedModule supplies the shared.* repositories the STEP 7
  // AuthorizationGuard depends on; AuthModule supplies the guards.
  imports: [SharedModule, AuthModule],
  controllers: [
    RikController,
    /**
     * Banners, New Arrivals and the reference catalogue, for EVERY
     * customer rather than ration-approved ones only.
     *
     * Registered here, in RikModule, because the three services it needs
     * — RikBannersService, RikNewArrivalsService and
     * EntitlementConfigRepository — are already provided here. A module
     * of its own would have meant exporting all three and constructing a
     * second import edge for no behavioural gain. The controller's own
     * address is `/content`, so nothing about the RIK routes moves, and
     * RikController's class-level @RequireRikCustomer() is untouched.
     */
    CommonContentController,
    RikAdminController,
    RikOfficersController,
    RikEligibilityController,
    RikIssueWindowsController,
    // Entitlement period administration, so RIK staff open and retire
    // periods from the Admin Portal instead of by SQL. Same guard and the
    // same existing `rik.entitlement.allocate` permission as eligibility.
    RikEntitlementPeriodsController,
    RikIssueVouchersController,
    // PHASE B — the queue of confirmed selections awaiting a voucher. One GET
    // route, guarded by the same `rik.order.manage` as the voucher controller
    // above, because every row it returns exists to be POSTed to that one.
    // It creates nothing itself: there is deliberately only one
    // voucher-creation path in the application.
    RikIncomingRequestsController,
    RikFulfillmentController,
    // Serves an uploaded provision picture. Public, immutable, read-only —
    // see the controller for why an <img> route cannot be authenticated.
    RikMediaController,
    // Staff management of the New Arrivals listings. Same guard and same
    // `rik.product.manage` permission as the rest of the RIK SKU master.
    RikNewArrivalsAdminController,
    // Staff management of the seasonal home-screen banners. Same guard and
    // same `rik.product.manage` permission again — a seasonal picture is a
    // merchandising decision, not an entitlement one. This controller cannot
    // address the customer app's fixed hero, which is a committed asset
    // rendered by the front end and owned by no table.
    RikBannersAdminController,
  ],
  providers: [
    NewArrivalsRepository,
    RikNewArrivalsService,
    PromotionalBannersRepository,
    RikBannersService,
    IssueSchedulesRepository,
    EntitlementConfigRepository,
    EntitlementConfigAdminRepository,
    PickupLocationsRepository,
    OfficersRepository,
    EligibilityImportRepository,
    // STEP 16: a read-only repository for the officer's own Fresh and Dry
    // figures. Separate from RikEligibilityService, which resolves the
    // entitlement engine's basis and is unchanged by this step.
    CustomerEligibilityFiguresRepository,
    IssueWindowsRepository,
    IssueVouchersRepository,
    // PHASE B. Read-only: it holds no INSERT, UPDATE or DELETE and no
    // transaction. Not exported, because nothing outside this module has any
    // business reading the queue directly.
    IncomingRequestsRepository,
    FulfillmentRepository,
    RikAdminConfigService,
    RikOfficerService,
    ExcelEligibilityParserService,
    RikEligibilityAdminService,
    RikIssueWindowService,
    RikIssueVoucherService,
    // PHASE C — the five-sheet Excel export. Read-only: it composes the
    // existing voucher search with the existing snapshot replay and writes
    // nothing. Not exported, because only its own controller uses it.
    RikVoucherExportService,
    RikIncomingRequestService,
    RikFulfillmentService,
    EntitlementPeriodsRepository,
    RikEntitlementPeriodService,
    EntitlementSelectionsRepository,
    RikConversionService,
    RikEligibilityService,
    RikEntitlementService,
    RikSelectionValidationService,
    RikMediaService,
  ],
  exports: [
    IssueSchedulesRepository,
    EntitlementConfigRepository,
    EntitlementConfigAdminRepository,
    PickupLocationsRepository,
    OfficersRepository,
    EligibilityImportRepository,
    IssueWindowsRepository,
    IssueVouchersRepository,
    FulfillmentRepository,
    RikAdminConfigService,
    RikOfficerService,
    ExcelEligibilityParserService,
    RikEligibilityAdminService,
    RikIssueWindowService,
    RikIssueVoucherService,
    RikFulfillmentService,
    EntitlementPeriodsRepository,
    RikEligibilityService,
    RikEntitlementService,
    RikSelectionValidationService,
  ],
})
export class RikModule {}
