import { Module } from '@nestjs/common';
import { UsersRepository } from './repositories/users.repository';
import { CustomersRepository } from './repositories/customers.repository';
import { OtpRequestsRepository } from './repositories/otp-requests.repository';
import { AuthSessionsRepository } from './repositories/auth-sessions.repository';
import { AuditLogRepository } from './repositories/audit-log.repository';
import { UserRolesRepository } from './repositories/user-roles.repository';
import { CustomerAddressesRepository } from './repositories/customer-addresses.repository';
import { AnnouncementsRepository } from './repositories/announcements.repository';
import { SettingsRepository } from './repositories/settings.repository';

/**
 * Owns the `shared.*` schema (shared.users, shared.customers,
 * shared.roles, shared.permissions, shared.role_permissions,
 * shared.auth_sessions, shared.otp_requests, shared.announcements,
 * shared.audit_log, and the shared views) — the frozen Phase 2 tables
 * that both RIK and PIF depend on.
 *
 * STEP 6 added the shared.* repositories AuthModule's authentication
 * services need (UsersRepository, CustomersRepository,
 * OtpRequestsRepository, AuthSessionsRepository, AuditLogRepository).
 * STEP 7 adds UserRolesRepository — the read path into the DB-backed
 * role/permission graph (shared.user_roles/roles/role_permissions/
 * permissions) that AuthorizationService resolves against. Every one
 * of these is built on top of DatabaseService (STEP 5), never owning a
 * connection itself, and every query is against the frozen Phase 2
 * columns exactly as the 24 approved migrations define them.
 *
 * RikModule and PifModule may depend on SharedModule. They must never
 * depend on each other, and no module outside SharedModule may reach
 * into shared.* repositories directly — everything goes through this
 * module's exported providers.
 */
@Module({
  providers: [
    UsersRepository,
    CustomersRepository,
    OtpRequestsRepository,
    AuthSessionsRepository,
    AuditLogRepository,
    UserRolesRepository,
    CustomerAddressesRepository,
    AnnouncementsRepository,
    // EXPORTED as well as provided, which is the thing that is easy to
    // get wrong here: AuthModule's registration gate and AdminModule's
    // settings service both inject this, and importing SharedModule is
    // not enough on its own — see AdminModule's note about
    // PasswordService.
    SettingsRepository,
  ],
  exports: [
    UsersRepository,
    CustomersRepository,
    OtpRequestsRepository,
    AuthSessionsRepository,
    AuditLogRepository,
    UserRolesRepository,
    CustomerAddressesRepository,
    AnnouncementsRepository,
    SettingsRepository,
  ],
})
export class SharedModule {}
