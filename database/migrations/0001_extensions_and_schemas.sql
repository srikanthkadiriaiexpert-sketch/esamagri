-- =============================================================================
-- e Samagri — Phase 3A Database Implementation
-- Migration 0001: extensions and schemas
--
-- Source of truth: Phase 2 Revision 1 (esamagri-phase2-database.html), Sections
-- 01, 02, 03. Approved by Srikanth. This migration set targets PostgreSQL 15+.
--
-- Forward-only. Do not edit an applied migration — add a new one (Section 30).
-- =============================================================================

-- pg_trgm powers the fuzzy product-name search index specified in Section 14
-- ("pif.products(name) — GIN, pg_trgm — Fuzzy product-name search").
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- btree_gist backs the RECOMMENDED (not required — Section 05) non-overlapping
-- EXCLUDE constraint on rik.entitlement_periods date ranges. Included because
-- it is cheap, safe, and directly prevents a real data-integrity bug; see
-- docs/reconciliation-report.md for why this was judged in-scope rather than
-- invented.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Three schemas, zero cross-schema foreign keys between rik and pif — the
-- physical backbone of Section 02's isolation model.
CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS rik;
CREATE SCHEMA IF NOT EXISTS pif;

COMMENT ON SCHEMA shared IS 'e Samagri — identity, RBAC, customers, audit, idempotency. Phase 2 Rev1 Section 04.';
COMMENT ON SCHEMA rik IS 'e Samagri — RIK entitlement-based ration distribution. No billing. Phase 2 Rev1 Section 05.';
COMMENT ON SCHEMA pif IS 'e Samagri — PIF commercial grocery (POS + online). Phase 2 Rev1 Section 06.';
