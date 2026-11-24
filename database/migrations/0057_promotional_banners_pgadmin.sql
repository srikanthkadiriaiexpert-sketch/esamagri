-- ===========================================================================
--  0057  Seasonal promotional banners          [pgAdmin variant, revision 2]
-- ===========================================================================
--
--  WHY THIS IS ONE DO BLOCK. Revision 1 was a normal multi-statement script.
--  It was run in pgAdmin and only its final COMMIT; reached the server, which
--  reported "WARNING: there is no transaction in progress" and then "Query
--  returned successfully" while creating nothing at all. A partial run that
--  LOOKS successful is the worst possible outcome for a migration, so the
--  whole body is now a single statement: run a fragment of it and you get a
--  syntax error, not a false success.
--
--  HOW TO RUN IT. Open this file in the pgAdmin Query Tool connected to
--  esamagri_staging. Press Ctrl+A to be certain nothing is selected, then F5.
--  On success the Messages pane ends with the line
--      MIGRATION 0057 APPLIED
--  If you do not see that line, nothing was created.
--
--  WHAT IT DOES. One table, two indexes, four CHECK constraints, one comment
--  and three grants. It creates no role, alters no ownership, revokes nothing
--  and touches no existing row. No pool, scale, conversion, provision, pack
--  size, voucher, eligibility or PIF table is read or written.
--
--  IT IS NOT THE HERO. The customer home screen's permanent hero is a
--  committed brand asset rendered by HomePage.tsx. It is owned by no table
--  and unaffected by every row in this one.
-- ===========================================================================

BEGIN;

DO $migration$
DECLARE
  n_tables   integer;
  n_rik      integer;
  n_views    integer;
  n_roles    integer;
  n_perms    integer;
  n_rows     integer;
BEGIN
  -- -------------------------------------------------------------------
  -- 0. The right database, and only the right database.
  -- -------------------------------------------------------------------
  IF current_database() <> 'esamagri_staging' THEN
    RAISE EXCEPTION
      'Migration 0057 refused: connected to database %, expected esamagri_staging.',
      current_database();
  END IF;

  -- -------------------------------------------------------------------
  -- 1. Preconditions. Any failure here aborts before anything is created.
  -- -------------------------------------------------------------------
  IF to_regclass('rik.promotional_banners') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 0057 refused: rik.promotional_banners already exists. It has been applied; nothing to do.';
  END IF;

  SELECT count(*) INTO n_tables
    FROM information_schema.tables
   WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE';
  IF n_tables <> 69 THEN
    RAISE EXCEPTION 'Migration 0057 refused: expected 69 base tables, found %.', n_tables;
  END IF;

  SELECT count(*) INTO n_rik
    FROM information_schema.tables
   WHERE table_schema = 'rik' AND table_type = 'BASE TABLE';
  IF n_rik <> 32 THEN
    RAISE EXCEPTION 'Migration 0057 refused: expected 32 tables in schema rik, found %.', n_rik;
  END IF;

  SELECT count(*) INTO n_views
    FROM information_schema.views
   WHERE table_schema IN ('shared','rik','pif');
  IF n_views <> 5 THEN
    RAISE EXCEPTION 'Migration 0057 refused: expected 5 views, found %.', n_views;
  END IF;

  -- The role the API connects as. Its absence is the fault that broke
  -- rik.new_arrivals, so this migration will not proceed without it.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'esamagri_demo_app') THEN
    RAISE EXCEPTION
      'Migration 0057 refused: login role esamagri_demo_app does not exist. Granting only app_rik would leave the API unable to read this table.';
  END IF;

  -- Remembered now, compared at the end: this migration must not alter them.
  SELECT count(*) INTO n_roles FROM shared.roles;
  SELECT count(*) INTO n_perms FROM shared.permissions;

  -- -------------------------------------------------------------------
  -- 2. The table.
  -- -------------------------------------------------------------------
  CREATE TABLE rik.promotional_banners (
    id             uuid PRIMARY KEY DEFAULT shared.uuid_generate_v7(),
    title          text NOT NULL,
    description    text,
    image_ref      text,
    is_published   boolean NOT NULL DEFAULT false,
    starts_on      date,
    ends_on        date,
    display_order  integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid REFERENCES shared.users(id),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     uuid REFERENCES shared.users(id),

    CONSTRAINT rik_promotional_banners_title_len
      CHECK (char_length(btrim(title)) BETWEEN 1 AND 140),

    CONSTRAINT rik_promotional_banners_description_len
      CHECK (description IS NULL OR char_length(description) <= 400),

    -- A window that closes before it opens shows nothing, ever, while
    -- looking published.
    CONSTRAINT rik_promotional_banners_window_chk
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),

    -- A banner IS a picture. Publishing without one would put an empty box
    -- on the home screen directly beneath the hero.
    CONSTRAINT rik_promotional_banners_publishable_chk
      CHECK (is_published = false OR image_ref IS NOT NULL)
  );

  COMMENT ON TABLE rik.promotional_banners IS
    'Seasonal promotional banners shown BELOW the fixed home-screen hero. Managed by staff holding rik.product.manage. Never replaces the hero and never affects entitlement.';

  -- The customer read: published banners whose window covers today.
  CREATE INDEX rik_promotional_banners_live_idx
    ON rik.promotional_banners (display_order, created_at DESC)
    WHERE is_published;

  -- The admin list and the window comparison.
  CREATE INDEX rik_promotional_banners_window_idx
    ON rik.promotional_banners (starts_on, ends_on);

  -- -------------------------------------------------------------------
  -- 3. Grants. The API role by name; the design roles only if they exist.
  --    No role is created, no ownership changes, nothing is revoked.
  -- -------------------------------------------------------------------
  GRANT SELECT, INSERT, UPDATE, DELETE ON rik.promotional_banners TO esamagri_demo_app;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rik') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON rik.promotional_banners TO app_rik;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reporting_rik') THEN
    GRANT SELECT ON rik.promotional_banners TO app_reporting_rik;
  END IF;

  -- -------------------------------------------------------------------
  -- 4. Postconditions.
  -- -------------------------------------------------------------------
  SELECT count(*) INTO n_rows FROM rik.promotional_banners;
  IF n_rows <> 0 THEN
    RAISE EXCEPTION 'Migration 0057 failed: expected the new table to be empty, found % row(s).', n_rows;
  END IF;

  SELECT count(*) INTO n_tables
    FROM information_schema.tables
   WHERE table_schema IN ('shared','rik','pif') AND table_type = 'BASE TABLE';
  IF n_tables <> 70 THEN
    RAISE EXCEPTION 'Migration 0057 failed: expected 70 base tables after, found %.', n_tables;
  END IF;

  SELECT count(*) INTO n_rik
    FROM information_schema.tables
   WHERE table_schema = 'rik' AND table_type = 'BASE TABLE';
  IF n_rik <> 33 THEN
    RAISE EXCEPTION 'Migration 0057 failed: expected 33 tables in schema rik, found %.', n_rik;
  END IF;

  SELECT count(*) INTO n_views
    FROM information_schema.views
   WHERE table_schema IN ('shared','rik','pif');
  IF n_views <> 5 THEN
    RAISE EXCEPTION 'Migration 0057 failed: view count changed, found %.', n_views;
  END IF;

  -- Roles and permissions untouched.
  IF (SELECT count(*) FROM shared.roles) <> n_roles THEN
    RAISE EXCEPTION 'Migration 0057 failed: the role set changed.';
  END IF;
  IF (SELECT count(*) FROM shared.permissions) <> n_perms THEN
    RAISE EXCEPTION 'Migration 0057 failed: the permission set changed.';
  END IF;

  -- THE CHECK 0055 DID NOT HAVE: prove the API role can actually use it.
  IF NOT has_table_privilege('esamagri_demo_app', 'rik.promotional_banners', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0057 failed: esamagri_demo_app cannot SELECT rik.promotional_banners.';
  END IF;
  IF NOT has_table_privilege('esamagri_demo_app', 'rik.promotional_banners', 'INSERT') THEN
    RAISE EXCEPTION 'Migration 0057 failed: esamagri_demo_app cannot INSERT into rik.promotional_banners.';
  END IF;

  -- And prove no PIF role picked it up by inheritance.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_pif')
     AND has_table_privilege('app_pif', 'rik.promotional_banners', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 0057 failed: app_pif can read rik.promotional_banners.';
  END IF;

  RAISE NOTICE 'MIGRATION 0057 APPLIED: rik.promotional_banners created, empty, granted to esamagri_demo_app. Tables 69 -> 70, rik 32 -> 33, views 5. Roles and permissions unchanged.';
END
$migration$;

COMMIT;
