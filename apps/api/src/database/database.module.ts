import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { DatabaseHealthController } from './database-health.controller';

/**
 * Database connection infrastructure — and only that. This module owns
 * the `pg.Pool` lifecycle, safe query/transaction primitives, and
 * readiness/schema-contract checking. It is deliberately kept separate
 * from SharedModule (shared.* domain repositories), RikModule, and
 * PifModule, per the STEP 5 requirement for a clear boundary between
 * "database connection infrastructure" and the application modules
 * built on top of it — SharedModule/RikModule/PifModule (STEP 6+) will
 * inject DatabaseService to build their own repositories; none of them
 * own or configure a connection themselves.
 *
 * @Global so every other module can inject DatabaseService without
 * each one re-importing DatabaseModule — it is imported exactly once,
 * from AppModule, ahead of the modules that will depend on it.
 */
@Global()
@Module({
  controllers: [DatabaseHealthController],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
