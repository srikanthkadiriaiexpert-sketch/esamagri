import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { ApiEnv } from '@esamagri/config';

/** What the rest of the app reads off the request. */
export interface CorrelatedRequest extends Request {
  correlationId?: string;
}

/**
 * One id per request, in the log, in the response header, and in every
 * error body (LAUNCH HARDENING).
 *
 * WHY IT MATTERS OPERATIONALLY. `ApiErrorBody` has always declared
 * `correlationId` as required — "correlates this error to a server log line"
 * — but nothing was setting one, so a facility reporting "it said something
 * went wrong at about eleven" gave the operator nothing to search for. Now
 * the caller is shown an id, the same id is on the log line, and the two meet.
 *
 * AN INBOUND ID IS ACCEPTED BUT NOT TRUSTED. A caller may pass its own
 * correlation id (a reverse proxy often does) and it is honoured so one id
 * spans the whole hop — but only if it is already a safe id: 8–64 characters
 * drawn from letters, digits, dot, underscore and hyphen, and nothing else.
 * An id is echoed into log lines and into a response header, so a header
 * value is attacker-controlled input like any other. Note what is NOT done
 * here: a hostile value is not "cleaned up" and then used, because stripping
 * `<script>alert(1)</script>` down to `scriptalert1script` would still echo
 * the attacker's text back into the log and the header. Anything that is not
 * already an id is simply replaced by one of ours.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly header: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.header = config.get('CORRELATION_ID_HEADER', { infer: true });
  }

  use(req: CorrelatedRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers[this.header.toLowerCase()];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    req.correlationId = acceptable(candidate) ?? randomUUID();
    res.setHeader(this.header, req.correlationId);
    next();
  }
}

/** An id is taken as given, or not at all. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

function acceptable(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SAFE_ID.test(trimmed) ? trimmed : null;
}
