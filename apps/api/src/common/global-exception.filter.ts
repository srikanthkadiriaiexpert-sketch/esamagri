import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_CODES, type ApiErrorBody } from '@esamagri/shared-types';
import type { CorrelatedRequest } from './correlation-id.middleware';

/**
 * Every error that leaves this API, in one shape (LAUNCH HARDENING).
 *
 * THE PROBLEM THIS SOLVES. Until now an unhandled error reached the caller
 * as Nest's default `{"message":"Internal server error","statusCode":500}` —
 * no code to switch on, no correlation id to quote, and, for a thrown
 * `Error`, whatever its message happened to say. Domain refusals were already
 * careful; the gap was everything nobody thought about.
 *
 * WHAT IT GUARANTEES
 *
 *   1. ONE ENVELOPE. Every error body is `{ code, message, correlationId }`
 *      plus optional `details` — the `ApiErrorBody` the two web apps have
 *      always parsed.
 *   2. NOTHING LEAKS. A non-HTTP error becomes a flat
 *      INTERNAL_ERROR / "Something went wrong…". The real error, its stack
 *      and the correlation id go to the server log, where they belong. No
 *      stack, no SQL, no table name, no file path ever reaches a caller.
 *   3. WHAT WAS ALREADY GOOD IS PRESERVED. A controller that threw
 *      `BadRequestException({ code, message, details })` keeps its own code,
 *      message and details exactly — this filter only adds the correlation
 *      id. Hundreds of existing assertions depend on those bodies and none
 *      of them change.
 *   4. VALIDATION IS TRANSLATED. The global ValidationPipe's
 *      `{ message: [...], error, statusCode }` becomes
 *      VALIDATION_FAILED with the messages under
 *      `details.validation`, so a client reads one shape for every refusal.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<CorrelatedRequest>();
    const correlationId = req.correlationId ?? 'unknown';
    const route = `${req.method} ${req.originalUrl ?? req.url}`;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = toEnvelope(exception.getResponse(), status, correlationId);

      // "No such address" and "no such thing at this address" are different
      // answers, and both web apps act on the difference: an address that
      // does not exist means a screen whose backend route has not shipped
      // yet, which is a planned-feature state rather than a failure. Nest
      // reports an unmatched route as a NotFoundException whose message is
      // "Cannot GET /x"; that, and only that, is relabelled here.
      if (status === HttpStatus.NOT_FOUND && isUnmatchedRoute(exception.getResponse())) {
        body.code = ERROR_CODES.ROUTE_NOT_FOUND;
      }

      // A 5xx is ours even when it arrives as an HttpException.
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(`${route} -> ${status} [${correlationId}]`, exception.stack);
      }
      res.status(status).json(body);
      return;
    }

    // A refusal raised BEFORE Nest ever saw the request: the body parser
    // rejecting an oversized or unparseable body throws a plain Error with
    // an express-style `status`/`type`, not an HttpException, and without
    // this branch a 413 would be reported to the caller as a 500 "something
    // went wrong" — which is both wrong and unhelpful, because the caller
    // can fix an oversized body and cannot fix our bug.
    const transport = transportRefusal(exception);
    if (transport !== null) {
      this.logger.warn(`${route} -> ${transport.status} [${correlationId}] ${transport.reason}`);
      res.status(transport.status).json({
        code: transport.code,
        message: transport.message,
        correlationId,
      } satisfies ApiErrorBody);
      return;
    }

    // Anything else is a bug or an infrastructure failure. The caller is told
    // only that it happened, and given the id that finds it in the log.
    this.logger.error(
      `${route} -> 500 [${correlationId}] ${describe(exception)}`,
      exception instanceof Error ? exception.stack : undefined
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again, and quote the reference if it continues.',
      correlationId,
    } satisfies ApiErrorBody);
  }
}

/**
 * An HttpException's payload, normalised.
 *
 * Three shapes arrive here: the application's own
 * `{ code, message, details? }`, the ValidationPipe's
 * `{ message: string[], error, statusCode }`, and a bare string from
 * `new NotFoundException('…')`.
 */
function toEnvelope(payload: unknown, status: number, correlationId: string): ApiErrorBody {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;

    if (typeof record.code === 'string') {
      return {
        code: record.code,
        message: typeof record.message === 'string' ? record.message : fallbackMessage(status),
        correlationId,
        ...(isDetails(record.details) ? { details: record.details } : {}),
      };
    }

    // The ValidationPipe's shape: an array of field messages.
    if (Array.isArray(record.message)) {
      return {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The request could not be accepted as sent.',
        correlationId,
        details: { validation: record.message.map(String) },
      };
    }

    if (typeof record.message === 'string') {
      return { code: codeForStatus(status), message: record.message, correlationId };
    }
  }

  if (typeof payload === 'string') {
    return { code: codeForStatus(status), message: payload, correlationId };
  }

  return { code: codeForStatus(status), message: fallbackMessage(status), correlationId };
}

/** Nest's own "no route matched" shape, and nothing else. */
function isUnmatchedRoute(payload: unknown): boolean {
  const message =
    typeof payload === 'string'
      ? payload
      : typeof payload === 'object' && payload !== null
        ? (payload as { message?: unknown }).message
        : undefined;
  return typeof message === 'string' && /^Cannot [A-Z]+ \//.test(message);
}

function isDetails(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stable code for a status that arrived without one. */
function codeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    default:
      return status >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.VALIDATION_FAILED;
  }
}

function fallbackMessage(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return 'That does not exist.';
  if (status === HttpStatus.UNAUTHORIZED) return 'Please sign in.';
  if (status === HttpStatus.FORBIDDEN) return 'Your role does not include permission for this.';
  if (status === HttpStatus.METHOD_NOT_ALLOWED) return 'That is not something this address accepts.';
  if (status >= 500) return 'Something went wrong. Please try again.';
  return 'The request could not be accepted as sent.';
}

interface TransportRefusal {
  status: number;
  code: string;
  message: string;
  /** For the log line only. */
  reason: string;
}

/**
 * An express/body-parser level refusal, translated.
 *
 * These arrive as an `Error` carrying a numeric `status`/`statusCode` and a
 * `type` such as `entity.too.large`. Only 4xx values are honoured — a 5xx
 * from down here is still our problem and still becomes INTERNAL_ERROR — and
 * the message returned is written here, never taken from the error, so
 * nothing from the library's own text can leak.
 */
function transportRefusal(exception: unknown): TransportRefusal | null {
  if (typeof exception !== 'object' || exception === null) return null;
  const err = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof err.type !== 'string') return null;

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : 0;
  if (status < 400 || status >= 500) return null;

  const message = ((): string => {
    switch (err.type) {
      case 'entity.too.large':
        return 'The request is larger than this service accepts.';
      case 'entity.parse.failed':
        return 'The request body could not be read as JSON.';
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return 'The request body uses an encoding this service does not accept.';
      default:
        return 'The request could not be read as sent.';
    }
  })();

  return { status, code: ERROR_CODES.VALIDATION_FAILED, message, reason: err.type };
}

/** For the LOG only — never for the response. */
function describe(exception: unknown): string {
  if (exception instanceof Error) return `${exception.name}: ${exception.message}`;
  return typeof exception === 'string' ? exception : JSON.stringify(exception);
}
