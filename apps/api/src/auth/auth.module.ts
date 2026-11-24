import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { ApiEnv } from '@esamagri/config';
import { SharedModule } from '../shared/shared.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthController } from './auth.controller';
import { AuthorizationDemoController } from './authorization-demo.controller';
import { PasswordService } from './services/password.service';
import { OtpService } from './services/otp.service';
import { TotpService } from './services/totp.service';
import { TokenService } from './services/token.service';
import { CustomerAuthService } from './services/customer-auth.service';
import { StaffAuthService } from './services/staff-auth.service';
import { AuthorizationService } from './services/authorization.service';
import { PifRegistrationGate } from './pif-registration.gate.service';
import { RegistrationTicketService } from './services/registration-ticket.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthorizationGuard } from './guards/authorization.guard';

/**
 * Authentication and authorization infrastructure: customer mobile+OTP
 * login, staff password(+TOTP) login, JWT access-token issuance,
 * refresh-token rotation against shared.auth_sessions (STEP 6); the
 * server-side RBAC foundation on top of it — role/permission
 * resolution, the AuthorizationGuard + its decorators, module-scope
 * checks (STEP 7). Still no RIK/PIF business logic: RikModule/
 * PifModule/AdminModule should import this module (for JwtAuthGuard,
 * AuthorizationGuard, AuthorizationService, and the
 * @RequirePermissions/@RequireCustomer/@OwnResourceParam decorators)
 * once they start defining real, permission-gated endpoints — nothing
 * about authorization should ever be reimplemented per-module.
 *
 * Depends on SharedModule for every shared.* repository it needs
 * (including STEP 7's UserRolesRepository); never depends on
 * RikModule or PifModule.
 */
@Module({
  imports: [
    SharedModule,
    // Supplies OtpSmsService. The delivery boundary lives in
    // NotificationModule and holds no verification logic: a code is
    // still generated, hashed and checked here.
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController, AuthorizationDemoController],
  providers: [
    PasswordService,
    OtpService,
    TotpService,
    TokenService,
    CustomerAuthService,
    StaffAuthService,
    AuthorizationService,
    // Reads the PIF self-registration switch from shared.settings on every
    // registration request. SettingsRepository comes from SharedModule,
    // which this module already imports and which now exports it.
    PifRegistrationGate,
    // Mints and verifies the short-lived proof that a mobile number was
    // just verified, so the common login can carry an unregistered
    // resident into the PIF registration form without a second code.
    // Its HMAC key is DERIVED from JWT_ACCESS_SECRET into a separate
    // domain, so it needed no new environment variable and a ticket can
    // never be presented as a bearer token.
    RegistrationTicketService,
    JwtAuthGuard,
    AuthorizationGuard,
  ],
  // PasswordService is exported, not just provided: a provider listed only in
  // `providers` is private to this module, so a module that imports AuthModule
  // cannot inject it. AdminModule's AdminStaffService does (it hashes the
  // password a Super Admin sets for a new or reset staff account), and the
  // alternative — re-providing it there — would construct a SECOND instance
  // and give the application two hashing code paths from one class. Exporting
  // shares the single instance. Nothing else changes: same class, same
  // BCRYPT_SALT_ROUNDS, same behaviour.
  exports: [TokenService, PasswordService, JwtAuthGuard, AuthorizationGuard, AuthorizationService],
})
export class AuthModule {}
