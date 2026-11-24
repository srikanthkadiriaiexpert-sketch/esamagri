import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadApiEnv } from '@esamagri/config';
// Root barrel — see the comment in main.ts for why apps/api uses this
// import path rather than the '@esamagri/config/api-env' subpath.
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { CustomerModule } from './customer/customer.module';
import { RikModule } from './rik/rik.module';
import { PifModule } from './pif/pif.module';
import { AdminModule } from './admin/admin.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { NotificationModule } from './notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Fail-fast: loadApiEnv (packages/config/src/api-env.ts) throws a
      // single, itemized error if any required var is missing or
      // malformed, and never echoes a secret's value. Nest surfaces
      // that thrown error during bootstrap, so the process refuses to
      // start half-configured — the non-negotiable rule from the
      // Phase 3B authorization.
      validate: (rawEnv) => loadApiEnv(rawEnv as Record<string, string | undefined>),
    }),

    // --- Module boundaries mirror the frozen Phase 2 DB schemas
    //     (shared / rik / pif), per the approved Phase 3A blueprint.
    //     RikModule and PifModule must NEVER import each other or reach
    //     into one another's repositories/services — only SharedModule
    //     is common ground. CommonModule carries no domain meaning
    //     (health, error/validation infra, correlation ids).
    //
    //     DatabaseModule (STEP 5) is its own layer, beneath all of
    //     these: connection/pool/transaction infrastructure only, no
    //     schema knowledge. It is @Global and imported first so
    //     SharedModule/RikModule/PifModule (STEP 6+) can inject
    //     DatabaseService to build real repositories on top of it.
    DatabaseModule,
    CommonModule,
    SharedModule,
    AuthModule,
    CustomerModule,
    RikModule,
    PifModule,
    AdminModule,
    // Customer-facing read of shared.announcements. Beside RIK and PIF,
    // not inside either: a notice may be addressed to one module or to
    // everyone, and those two must never import one another.
    AnnouncementsModule,
    NotificationModule,
  ],
})
export class AppModule {}
