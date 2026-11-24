import type { Pool } from 'pg';

/**
 * The approved database contract. This module re-checks it from inside
 * the application at startup, so a schema drift is caught automatically
 * rather than relying on someone remembering to re-run a manual check.
 *
 * Changing these numbers is only ever a *symptom fix* for a genuine,
 * separately-approved migration — never a way to make a real mismatch
 * go away. See DATABASE_CHANGE_REQUIRED in the Phase 3B authorization.
 *
 * HISTORY OF THIS CONTRACT
 * ------------------------
 * Phase 2 / Phase 3B STEP 4 — STEP 10:
 *   47 base tables (shared 14 / rik 13 / pif 20) and 5 views.
 *
 * Phase 3B STEP 11 — 55 base tables (shared 14 / rik 21 / pif 20) and
 *   5 views. The rik schema gained the eight tables of the entitlement
 *   and conversion engine in migration 0025, explicitly authorized for
 *   that step:
 *
 *     rik.entitlement_pools              rik.provisions
 *     rik.pool_scales                    rik.customer_period_eligibility
 *     rik.pool_conversions               rik.entitlement_selections
 *     rik.entitlement_selection_items    rik.entitlement_elections
 *
 *   Nothing was dropped or altered destructively: shared and pif are
 *   unchanged at 14 and 20, the view count is unchanged at 5, and the
 *   thirteen pre-existing rik tables — rik.entitlements among them —
 *   are all still present. This guard did its job: it failed the whole
 *   integration suite the moment the new tables appeared, and was
 *   updated deliberately rather than loosened.
 *
 * Phase 3B STEP 11E — 56 base tables (shared 14 / rik 22 /
 *   pif 20) and 5 views. Migration 0029 added exactly one table:
 *
 *     rik.pickup_locations
 *
 *   the collection points a customer may choose, maintained by the
 *   facility from the RIK administration dashboard. `shared.settings`
 *   was considered instead and rejected: it is the SUPER_ADMIN settings
 *   surface, so a RIK catalogue there would belong to the wrong role
 *   and give up per-row history.
 *
 *   The same migration added COLUMNS to rik.entitlement_selections for
 *   the fulfillment a confirmation carries. Columns are not counted
 *   here, which is why the number moved by one and not by more.
 *   shared and pif are unchanged at 14 and 20; the view count is
 *   unchanged at 5; nothing was dropped.
 *
 * STEP 15B Phase B — 59 base tables (shared 14 / rik 25 /
 *   pif 20) and 5 views. Migration 0045 added exactly three tables:
 *
 *     rik.eligibility_import_batches   one per uploaded eligibility sheet
 *     rik.eligibility_import_rows      one per spreadsheet row, raw beside resolved
 *     rik.eligibility_adjustments      the append-only eligible-day ledger
 *
 *   STEP 15B Phase A (migration 0044) moved this number NOT AT ALL. It
 *   added `rik_id`, `official_name` and `created_by` to
 *   shared.customers, and columns are not counted here — the same
 *   reason 0029 moved it by one rather than by more.
 *
 *   shared and pif are unchanged at 14 and 20; the view count is
 *   unchanged at 5; nothing was dropped.
 *
 * STEP 15C Phase C — 61 base tables (shared 14 / rik 27 /
 *   pif 20) and 5 views. Migration 0047 added exactly two tables:
 *
 *     rik.issue_windows            the configured physical issue schedule
 *     rik.issue_window_revisions   who changed a window, when, and from what
 *
 *   Both carry their own protection: the windows table refuses DELETE and
 *   enforces no-overlap, within-period and Fresh-ordering in the database;
 *   the revisions table is append-only and is written by a trigger on the
 *   windows table, not by the application.
 *
 *   shared and pif are unchanged at 14 and 20; the view count is
 *   unchanged at 5; nothing was dropped.
 *
 * PHASE D (current) — 62 base tables (shared 14 / rik 28 / pif 20) and 5
 *   views. Migration 0048 added exactly ONE table:
 *
 *     rik.issue_vouchers   the operational issue voucher
 *
 *   One, not three. The voucher is an ENVELOPE: its contents come from the
 *   confirmed selection's own `rule_snapshot`, so there is no voucher
 *   line-item table and no second copy of the ration to drift out of step
 *   with the first. It carries no issue-window column either — a Fresh
 *   voucher spans Windows 1 to 3 and follows the configured schedule — and
 *   its history is written to the existing shared.audit_log rather than to a
 *   new audit table.
 *
 *   The application holds SELECT and INSERT on it and nothing else, which is
 *   what makes "creating a voucher consumes no entitlement" structural
 *   rather than a matter of care.
 *
 *   shared and pif are unchanged at 14 and 20; the view count is
 *   unchanged at 5; nothing was dropped.
 *
 * PHASE E — 65 base tables (shared 14 / rik 31 / pif 20) and 5 views.
 *   Migration 0049 added exactly three tables, all of them records of
 *   what physically happened:
 *
 *     rik.issue_voucher_outcomes      the fulfilment event — collected,
 *                                     not collected, out for delivery,
 *                                     delivered, not delivered, and the
 *                                     controlled reversal of one
 *     rik.issue_voucher_issue_lines   the provisions and quantities
 *                                     actually handed over, including
 *                                     approved substitutions
 *     rik.dry_carry_forward           one previous month's unissued Dry
 *                                     balance, frozen and lapsing
 *
 *   Three tables rather than one because they answer three different
 *   questions and have three different lifetimes: an event happens once,
 *   a line belongs to an event, and a carried balance outlives both. No
 *   view was added. shared and pif are unchanged at 14 and 20; nothing
 *   was dropped; and rik.issue_vouchers gained no column — a voucher's
 *   status is now a projection of the outcome log, applied by a
 *   SECURITY DEFINER trigger, and the application still holds no UPDATE
 *   on that table at all.
 *
 * PHASE F — 66 base tables (shared 14 / rik 31 / pif 21) and 5 views.
 *   Migration 0050 added exactly ONE table:
 *
 *     pif.order_events                the PIF order's operational history —
 *                                     placed, accepted, preparing, ready,
 *                                     out for delivery, delivered, cash
 *                                     collected, cancelled, not delivered —
 *                                     and the only path by which an order's
 *                                     status moves.
 *
 *   Everything else PHASE F needed already existed and was reused: the six
 *   Phase 2 PIF tables (categories with their parent_id, products, carts,
 *   cart_items, orders, order_items) and pif.tax_rates. They gained columns
 *   — brand, pack, availability, order limits, variants, and the money and
 *   address snapshots an order must keep — but no table was added for them
 *   and none was dropped. rik and shared are unchanged at 31 and 14; the 14
 *   superseded PIF tables from the old point-of-sale/purchasing scope remain
 *   in place, empty, referenced by no code, because dropping them would be a
 *   migration against a frozen baseline for no functional gain.
 * LAUNCH PREPARATION — 68 base tables (shared 14 / rik 31 / pif 23) and 5
 *   views. Migration 0051 added exactly TWO tables, both of them belonging
 *   to the bulk product import and referenced by nothing else:
 *
 *     pif.product_import_batches      one uploaded spreadsheet: who, when,
 *                                     what the preview found, what was
 *                                     decided.
 *     pif.product_import_rows         one spreadsheet row: its parsed values,
 *                                     its verdict (create / update /
 *                                     invalid), its problems, and whether it
 *                                     has been applied.
 *
 *   No view was added, nothing was dropped, no permission or role changed,
 *   and no catalogue, order, cart, entitlement or voucher table was touched.
 *   An import calls the same catalogue rules the admin screen calls.
 */
/*
 * RIK NEW ARRIVALS — APPLIED 30 October 2026.
 *
 * Migration 0055 adds exactly one table, rik.new_arrivals — a staff-curated
 * listing of which EXISTING provision is being featured on the customer New
 * Arrivals screen. It holds no quantity, ratio, limit, eligibility or stock
 * column, and no code reads it when resolving an entitlement.
 *
 * APPLIED to esamagri_staging on 30 October 2026, from
 * `database/migrations/0055_rik_new_arrivals_pgadmin.sql` — the pgAdmin
 * variant of the original, byte-identical apart from BEGIN;/COMMIT;, the
 * removal of SET ROLE / RESET ROLE, and an added pre-state assertion. It
 * committed in a single transaction, and its own verification block asserted
 * that the new table is empty, that the foreign key to rik.provisions is
 * ON DELETE RESTRICT, that no PIF role holds a grant on it, and that the
 * permission and role sets are still 22 and 6.
 *
 * The live schema therefore holds 69 base tables (rik 31 -> 32) and 5 views,
 * and the values below say 69. The two must agree exactly or the API refuses
 * to start (see DatabaseService.onModuleInit).
 *
 * THE TWO HALVES MOVED IN THIS ORDER, which is the order any future table
 * addition must follow:
 *
 *   1. apply the migration, so the database holds the new count;
 *   2. then change `rik` and `totalTables` below, and the matching fixtures in
 *      schema-contract.spec.ts and database.service.spec.ts.
 *
 * Doing (2) before (1) stops the API booting against the current database;
 * doing (1) before (2) stops it booting against the new one. Neither order is
 * dangerous — the check is read-only and repairs nothing — but both halves
 * have to land for the API to serve traffic.
 *
 * ONE PREREQUISITE THAT WAS NOT OBVIOUS, recorded so the next person does not
 * rediscover it the hard way: 0055's two GRANT statements target app_rik and
 * app_reporting_rik. Neither role existed in this cluster — migration 0018
 * creates six roles, and only esamagri_owner was present — so the first
 * attempt failed with `role "app_rik" does not exist` and rolled back
 * cleanly, creating nothing. The five missing roles were then created exactly
 * as 0018 defines them (NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN, no
 * password, no memberships) and 0055 was re-run unchanged. Those roles hold
 * no grant anywhere except on rik.new_arrivals: 0018's ownership-reassignment
 * and grant sections remain unapplied in this database, which is a separate
 * open item and NOT something this contract tracks.
 *
 * NOTE ON ROLES AND PERMISSIONS: New Arrivals reuses `rik.product.manage`,
 * which already exists, so the approved set stays at 22 permissions and 6
 * roles. Those counts are asserted by the migration guards, not here.
 */
/*
 * SEASONAL PROMOTIONAL BANNERS — migration 0057.
 *
 * Adds exactly one table, rik.promotional_banners: a title, an optional line
 * of copy, an uploaded picture and a date window, managed by staff holding
 * `rik.product.manage`. It holds no quantity, ratio, limit, eligibility or
 * stock column, and no code reads it when resolving an entitlement.
 *
 * IT IS NOT THE HERO. The customer home screen's permanent hero is a
 * committed brand asset rendered by HomePage.tsx's own HeroBanner component.
 * It is owned by no table, reachable from no endpoint, and unaffected by
 * every row in this one. Banners render BELOW it, and an empty table — the
 * normal state — leaves the home screen exactly as it was.
 *
 * The live schema moves to 70 base tables (rik 32 -> 33) and still 5 views.
 * Apply the migration FIRST, then change the values below: the two halves
 * must agree or the API refuses to start.
 *
 * THE GRANT LESSON FROM 0055 IS BAKED INTO 0057. 0055 granted only app_rik
 * and app_reporting_rik, but the API connects as the role in apps/api/.env,
 * whose privileges came from a one-off `GRANT ALL ON ALL TABLES IN SCHEMA`
 * in demo-bootstrap.cjs — a snapshot that cannot cover a table created
 * later. The result was a 500 on every New Arrivals load. 0057 grants the
 * application login role by name as well, and its verification block fails
 * the migration if that role still cannot SELECT and INSERT.
 *
 * NOTE ON ROLES AND PERMISSIONS: banners reuse `rik.product.manage` too, so
 * the approved set stays at 22 permissions and 6 roles.
 */
/*
 * OFFICER-WISE FRESH AND DRY ELIGIBLE DAYS — migration 0066.
 *
 * Adds exactly one table, rik.customer_period_ration_eligibility: one row per
 * officer, per entitlement period, per ration type, holding that type's
 * eligible-days figure. Fresh is capped at 30 days and Dry at 60 by a CHECK
 * constraint, and the three-column unique key is what makes a Fresh upload
 * structurally incapable of touching the Dry figure.
 *
 * IT IS NOT THE FIGURE THE ENGINE READS. The entitlement engine still
 * resolves its basis from rik.customer_period_eligibility.eligible_days, and
 * migration 0066 does not alter that table at all — not a column, not a
 * constraint, not its unique key, not either of its triggers, not one row.
 * The two new figures are stored, audited and displayed only. A separate
 * table was chosen over two more columns precisely so that the engine's input
 * could not be disturbed: writing a Fresh figure for an officer with no legacy
 * row would otherwise have meant INSERTing one, and eligible_days is NOT NULL
 * with no default, so the insert would have had to invent a legacy 0.
 *
 * 0066 also adds a nullable `ration_type` to rik.eligibility_adjustments and
 * rik.eligibility_import_batches. Those are COLUMNS on existing tables and so
 * do not move the counts below; NULL there means the legacy figure, which is
 * how every pre-0066 row already reads.
 *
 * The live schema moves to 71 base tables (rik 33 -> 34) and still 5 views.
 *
 * ORDER OF OPERATIONS — NOTE THE DEPARTURE FROM THE RULE ABOVE. Every earlier
 * entry here says "apply the migration FIRST, then change the values". For
 * 0066 the values were changed first, deliberately, so that the application
 * change could be reviewed before the database was touched. The consequence
 * is explicit: until 0066 is applied, the API REFUSES TO START against a
 * database that still has 70 tables. The two halves must go live together.
 */
export const EXPECTED_SCHEMA_CONTRACT = {
  tablesBySchema: {
    shared: 14,
    rik: 34,
    pif: 23,
  },
  totalTables: 71,
  totalViews: 5,
} as const;

export interface SchemaContractResult {
  matches: boolean;
  expected: typeof EXPECTED_SCHEMA_CONTRACT;
  actual: {
    tablesBySchema: Record<string, number>;
    totalTables: number;
    totalViews: number;
    viewNames: string[];
  };
}

/**
 * Queries `information_schema` (read-only; never touches the schema
 * itself) and compares the live database against
 * `EXPECTED_SCHEMA_CONTRACT`. Called once at application startup
 * (see DatabaseService.onModuleInit) and exposed for tests / manual
 * checks.
 */
export async function verifySchemaContract(pool: Pool): Promise<SchemaContractResult> {
  // Deliberately pg_catalog, not information_schema. information_schema
  // is privilege-filtered per the SQL standard: it only lists an object
  // if the *current role* holds some privilege on it. The approved
  // Phase 2 grant design (migration 0018) intentionally gives NO role
  // any direct privilege on shared.idempotency_keys — it's reachable
  // only through SECURITY DEFINER wrapper functions — so
  // information_schema would systematically undercount shared's table
  // total for every real application role, forever, regardless of
  // which one is connected. pg_catalog.pg_tables / pg_views report
  // structural existence for any role that can connect to the
  // database, independent of data-access grants — the correct tool for
  // "does the approved schema shape exist", as opposed to "can I read
  // this table's rows".
  const tablesResult = await pool.query<{ table_schema: string; count: string }>(
    `SELECT schemaname AS table_schema, count(*)::text AS count
     FROM pg_catalog.pg_tables
     WHERE schemaname = ANY($1::text[])
     GROUP BY schemaname`,
    [Object.keys(EXPECTED_SCHEMA_CONTRACT.tablesBySchema)]
  );

  const viewsResult = await pool.query<{ view_name: string }>(
    `SELECT schemaname || '.' || viewname AS view_name
     FROM pg_catalog.pg_views
     WHERE schemaname = ANY($1::text[])
     ORDER BY 1`,
    [Object.keys(EXPECTED_SCHEMA_CONTRACT.tablesBySchema)]
  );

  const tablesBySchema: Record<string, number> = {};
  for (const row of tablesResult.rows) {
    tablesBySchema[row.table_schema] = Number(row.count);
  }
  const totalTables = Object.values(tablesBySchema).reduce((sum, n) => sum + n, 0);
  const viewNames = viewsResult.rows.map((r) => r.view_name);

  const matches =
    totalTables === EXPECTED_SCHEMA_CONTRACT.totalTables &&
    viewNames.length === EXPECTED_SCHEMA_CONTRACT.totalViews &&
    (Object.entries(EXPECTED_SCHEMA_CONTRACT.tablesBySchema) as Array<[string, number]>).every(
      ([schema, expectedCount]) => tablesBySchema[schema] === expectedCount
    );

  return {
    matches,
    expected: EXPECTED_SCHEMA_CONTRACT,
    actual: { tablesBySchema, totalTables, totalViews: viewNames.length, viewNames },
  };
}
