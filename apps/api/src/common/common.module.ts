import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  RATE_LIMIT_SETTINGS,
  RateLimitGuard,
  rateLimitSettingsFromConfig,
} from './rate-limit.guard';

/**
 * Cross-cutting infrastructure with no RIK/PIF/shared-domain meaning
 * (LAUNCH HARDENING).
 *
 * This module is where the four things every request passes through now
 * live, and the order matters:
 *
 *   1. CorrelationIdMiddleware — runs first, so everything after it,
 *      including the filter, has an id to quote.
 *   2. RateLimitGuard (APP_GUARD) — a global guard, so it runs before any
 *      controller's own JwtAuthGuard/AuthorizationGuard and an
 *      unauthenticated flood is stopped before it reaches them.
 *   3. GlobalExceptionFilter (APP_FILTER) — catches everything, including
 *      what the guard throws, and gives one envelope to every caller.
 *   4. HealthController — liveness. Readiness is DatabaseModule's, because
 *      it has to ask the database.
 *
 * Every other module may depend on CommonModule. CommonModule depends on
 * nothing domain-specific, by design. DatabaseModule is @Global, which is
 * how the readiness check reaches the pool without a domain import.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: RATE_LIMIT_SETTINGS,
      inject: [ConfigService],
      useFactory: rateLimitSettingsFromConfig,
    },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
