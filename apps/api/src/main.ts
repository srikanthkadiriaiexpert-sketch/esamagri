import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import type { ApiEnv } from '@esamagri/config';
// Root barrel, not the '@esamagri/config/api-env' subpath: apps/api's
// tsconfig uses "moduleResolution": "node" (the traditional Nest/
// CommonJS setup), which doesn't resolve package.json "exports"
// subpaths — only "main"/"types". The subpath export exists for
// apps/customer-web and apps/admin-web (Vite, "moduleResolution":
// "Bundler", which does understand it) to avoid pulling this Node-only
// file into a browser bundle's type-check graph. apps/api importing the
// full barrel is safe in the other direction: customer-web-env.ts and
// admin-web-env.ts use only zod and plain strings, nothing Node-hostile.
import { AppModule } from './app.module';

/**
 * Bootstrap.
 *
 * LAUNCH HARDENING added the global middleware that STEP 4 deliberately
 * deferred, and it is all here rather than scattered through the modules so
 * that what every request passes through can be read in one place:
 *
 *   helmet                  security headers, with a strict CSP for the API's
 *                           own responses (it serves JSON and images, never
 *                           a page, so nothing legitimate needs a script)
 *   express.json limit      an oversized body is refused at the parser
 *   trust proxy             so `req.ip` is the real client behind nginx,
 *                           which is what rate limiting counts
 *   ValidationPipe          globally, so a route cannot be added WITHOUT
 *                           validation by forgetting a decorator
 *   cookie-parser           the refresh-token cookie
 *   CORS                    the validated allowlist, credentials on
 *
 * The correlation id, the rate-limit guard and the exception filter are
 * wired in CommonModule, because Nest needs them as providers.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const bootConfig = app.get(ConfigService<ApiEnv, true>);

  // --- Security headers -------------------------------------------------
  // This API answers with JSON and with product images. It never serves a
  // document, so the Content-Security-Policy can be as tight as it gets:
  // nothing may be loaded, framed or scripted from an API response. HSTS is
  // left to the TLS-terminating proxy, which is the only component that
  // knows whether HTTPS is actually in force.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'img-src': ["'self'", 'data:'],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // the two web apps are a different origin
      referrerPolicy: { policy: 'no-referrer' },
      hsts: false,
    })
  );
  app.disable('x-powered-by');

  // --- Request body limits ---------------------------------------------
  // A JSON body here is a form or a cart. Files go through the multipart
  // route, which has its own limit. Anything larger is refused by the
  // parser rather than buffered into memory first.
  const bodyLimit = bootConfig.get('REQUEST_BODY_LIMIT', { infer: true });
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: bodyLimit }));

  // --- Real client address ---------------------------------------------
  // Rate limiting counts per caller, so `req.ip` has to be the client and
  // not the reverse proxy. The number of hops is configuration, never a
  // guess: trusting a forwarded header that nobody set lets a caller claim
  // any address it likes.
  const hops = bootConfig.get('TRUST_PROXY_HOPS', { infer: true });
  app.set('trust proxy', hops === 0 ? false : hops);

  // --- Validation, globally --------------------------------------------
  // `whitelist` strips what is not declared and `forbidNonWhitelisted`
  // refuses it outright, so a stray field is a visible 400 rather than a
  // silent write. Controllers that already declare their own pipe keep
  // behaving identically; what changes is that a NEW route cannot ship
  // without validation by forgetting the decorator.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  );

  // Required for AuthController to read the HttpOnly refresh-token
  // cookie (shared.auth_sessions rotation) via req.cookies — see
  // auth/auth.controller.ts.
  app.use(cookieParser());

  // Lets DatabaseModule's DatabaseService.onModuleDestroy (pool.end())
  // run on SIGTERM/SIGINT, so a deploy/restart closes every pooled
  // Postgres connection cleanly instead of dropping them mid-query.
  app.enableShutdownHooks();

  const config = app.get(ConfigService<ApiEnv, true>);
  const port = config.get('PORT', { infer: true });

  // customer-web/admin-web send credentials:'include' (the httpOnly
  // refresh cookie), so `credentials: true` is required — that in turn
  // means we must echo an explicit allowed origin rather than `*`.
  // Origins come only from CORS_ALLOWED_ORIGINS (comma-separated,
  // zod-validated, fail-fast at startup) — never a runtime wildcard.
  const allowedOrigins = config
    .get('CORS_ALLOWED_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(
    `[api] listening on port ${port} (env=${config.get('NODE_ENV', { infer: true })}) — Phase 3B STEP 4/5 foundation`
  );
}

bootstrap().catch((err: unknown) => {
  // A bootstrap failure (including a fail-fast env validation error from
  // @esamagri/config) must stop the process, not start half-configured.
  // eslint-disable-next-line no-console
  console.error('[api] fatal error during bootstrap:', err);
  process.exit(1);
});
