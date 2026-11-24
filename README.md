# e Samagri — Application Monorepo

Phase 3B foundation, built on the Phase 2 database contract, which is **frozen and must never be modified by application code**.

## Product specification (read first)

Application behaviour is governed by `docs/`, not by any earlier blueprint where the two
disagree:

- `docs/product-specification.md` — the corrected, authoritative product requirements
  (customer app, RIK, PIF, staff/admin).
- `docs/implementation-backlog.md` — every requirement mapped to the phase that builds it.
- `docs/open-decisions.md` — `BUSINESS_DECISION_REQUIRED`, `DATABASE_CHANGE_REQUIRED` and
  `ASSET_REQUIRED` registers. Items listed there are never guessed or hardcoded.

## Repository layout

```
esamagri-app/
├── docs/                Corrected product specification, implementation backlog and the
│                         open-decisions registers. Authoritative for application behaviour.
├── database/            Approved Phase 2 database — 47 tables, 5 views, 24 migrations,
│                         9 test files. Copied verbatim from the delivered esamagri-db
│                         repository. DO NOT EDIT. Any schema gap is reported as
│                         DATABASE_CHANGE_REQUIRED, never silently patched here.
├── apps/
│   ├── api/              NestJS backend (REST API, modular monolith)
│   ├── customer-web/     Customer PWA (React + TypeScript + Vite, mobile-first)
│   └── admin-web/        Admin panel (React + TypeScript + Vite, desktop-first)
└── packages/
    └── shared-types/     TypeScript types/enums shared between api and both frontends
                          (roles, permission codes, DTO shapes) — single source of
                          truth so a type change is caught at compile time everywhere.
```

## Database contract

The database in `database/migrations/` is the approved, frozen Phase 2 contract:

- 47 tables (Shared 14 / RIK 13 / PIF 20)
- 5 views
- 24 migrations
- 9 test files

The application layer (`apps/api`) connects to this schema as it already exists. It does **not** own schema, does not auto-migrate, and does not run an ORM's schema-sync feature. See `apps/api/src/database/` for how the connection is made.

## Getting started (local development)

```bash
npm install
cp apps/api/.env.example apps/api/.env            # fill in local values
cp apps/customer-web/.env.example apps/customer-web/.env
cp apps/admin-web/.env.example apps/admin-web/.env

# apply the existing, unmodified migrations to a local dev database
# (see database/README or docs/migration-structure.md for the exact command)

npm run typecheck
npm run build
```

## What this foundation includes (Phase 3B, Steps 1–10)

Repository/app structure, environment configuration with validated config loading, frontend foundations for both web apps (Vite + React + TS + PWA), NestJS backend foundation with module boundaries mirroring the database schema (`shared`/`rik`/`pif`), a read-only database connection layer proven against the real schema, authentication/session scaffolding, RBAC guard infrastructure backed by the database's own permission tables, shared API/error/validation/security middleware, and minimal customer/admin UI shells.

It deliberately does **not** include the RIK/PIF business modules themselves (entitlement engine, inventory engine, POS, etc.) — those are later Phase 3B/3C+ stages per the approved implementation sequence.
