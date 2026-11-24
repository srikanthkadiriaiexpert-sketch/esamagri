import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from '../common/rate-limit.guard';
import { DatabaseService } from './database.service';

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  database: {
    reachable: boolean;
    /** Whether the live schema still matches the approved contract, as of startup. */
    schemaContractOk: boolean;
  };
  timestamp: string;
}

/**
 * DATABASE READY, distinct from GET /health (APPLICATION ALIVE — see
 * common/health.controller.ts, which has no DB dependency and must
 * keep responding even if the database is down). A load balancer /
 * orchestrator should use this endpoint, not /health, to decide
 * whether to route real traffic here — it returns HTTP 503 when the
 * database is unreachable or the schema contract check failed at
 * startup, 200 otherwise.
 *
 * Never exposes DATABASE_URL, SQL, driver error detail, or internal
 * paths — only booleans and a fixed reason, matching DatabaseService's
 * own contract (see checkReadiness / getLastContractCheck).
 */
@Controller('health')
export class DatabaseHealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get('ready')
  @Public()
  // A probe polls readiness every few seconds by design, and must not be
  // throttled into reporting a healthy service as unreachable.
  @RateLimit('none')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const readiness = await this.db.checkReadiness();
    const contract = this.db.getLastContractCheck();
    const schemaContractOk = contract?.matches ?? false;
    const isReady = readiness.ready && schemaContractOk;

    res.status(isReady ? 200 : 503);

    return {
      status: isReady ? 'ready' : 'not_ready',
      database: {
        reachable: readiness.ready,
        schemaContractOk,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Confirms read access to the approved views without modifying them
   * — surfaces the view names the startup schema-contract check already
   * found queryable in information_schema.views (a real, minimal
   * metadata read, not a guess). This is the STEP 5 requirement 10
   * proof point, kept separate from `ready` above so that endpoint
   * stays a cheap, constant-time check.
   */
  @Get('views')
  @Public()
  @RateLimit('none')
  views(): { status: 'ok'; views: string[] } {
    const contract = this.db.getLastContractCheck();
    return { status: 'ok', views: contract?.actual.viewNames ?? [] };
  }
}
