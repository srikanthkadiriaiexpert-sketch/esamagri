import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RateLimit } from './rate-limit.guard';

interface HealthResponse {
  status: 'ok';
  service: 'esamagri-api';
  timestamp: string;
}

/**
 * LIVENESS — is this process alive?
 *
 * Deliberately has NO database dependency, so it keeps answering 200 through
 * a brief database blip and the process is not killed and restarted for
 * something a restart cannot fix.
 *
 * READINESS — should traffic be sent here? — is a different question with a
 * different answer, and it already has an endpoint:
 * `GET /health/ready`, in DatabaseModule's DatabaseHealthController, which
 * asks the database and reports whether the live schema still matches the
 * approved contract (200 ready / 503 not). It is NOT duplicated here: one
 * address, one answer. `GET /health/views` lives there too.
 *
 * NOTHING LEAKS. Two words and a timestamp — no connection string, no
 * version, no host, no stack. Unauthenticated, because a health check has
 * no credential, and exempt from rate limiting, because a probe polls it
 * every few seconds by design.
 */
@Controller('health')
export class HealthController {
  @Get()
  @Public()
  @RateLimit('none')
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'esamagri-api',
      timestamp: new Date().toISOString(),
    };
  }
}
