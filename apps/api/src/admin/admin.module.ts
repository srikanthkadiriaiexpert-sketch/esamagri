import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthModule } from '../auth/auth.module';
import { RikModule } from '../rik/rik.module';
import { AdminController } from './admin.controller';
import { StaffController } from './staff.controller';
import { AdminAnnouncementsService } from './services/admin-announcements.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminStaffService } from './services/admin-staff.service';
import { AdminSettingsService } from './services/admin-settings.service';

/**
 * Cross-module administrative concerns that don't belong solely to RIK
 * or solely to PIF: the staff session surface, the dashboard
 * foundation, announcements (with the server-side audience restriction
 * — RIK_ADMIN cannot manage PIF-targeted announcements and vice versa),
 * and the read-only RIK issue-schedule foundation.
 *
 * STAFF ADMINISTRATION (StaffController + AdminStaffService) lives here
 * rather than in AuthModule on purpose: AuthModule answers "who are you
 * and what may you do", which every module depends on, while managing
 * the staff list is an administrative screen like any other. Putting it
 * in AuthModule would make the authentication core depend on an admin
 * surface. It needs no new providers of its own beyond the service: the
 * shared.users / shared.user_roles / shared.auth_sessions repositories
 * come from SharedModule, and PasswordService from AuthModule.
 *
 * NOTE, because getting this wrong cost a round trip: importing a module
 * is not enough to inject one of its providers — the owning module must
 * EXPORT it. PasswordService was provided by AuthModule but not
 * exported, so AdminStaffService's constructor could not be resolved and
 * Nest failed at startup with an unresolvable parameter, while the
 * TypeScript build stayed clean because DI is resolved at runtime. The
 * fix was to export it from AuthModule rather than re-provide it here,
 * which would have created a second instance.
 *
 * STEP 10 populates it. It imports SharedModule (shared.* repositories),
 * AuthModule (the STEP 6/7 guards) and RikModule (the issue-schedule
 * repository, which is rik-scoped and therefore lives in RikModule
 * rather than being duplicated here).
 *
 * Boundary note: AdminModule importing both RikModule and PifModule
 * would be legitimate — administration is cross-cutting by definition —
 * but it must never become the back door that lets RikModule and
 * PifModule reach each other. Nothing here re-exports one module's
 * providers to the other, and PifModule is not imported at all in this
 * phase because no PIF administrative data source exists yet.
 */
@Module({
  imports: [SharedModule, AuthModule, RikModule],
  controllers: [AdminController, StaffController],
  providers: [AdminAnnouncementsService, AdminDashboardService, AdminStaffService, AdminSettingsService],
  exports: [AdminAnnouncementsService],
})
export class AdminModule {}
