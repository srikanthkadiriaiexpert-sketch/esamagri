-- =============================================================================
-- Migration 0019: Seed data
-- Phase 2 Rev1 Section 23 (RBAC), Section 31 (seed data — explicitly safe
-- items only). Zero fake transactional/customer/order/entitlement/bill/
-- purchase/cash/audit data, per Section 31's "Never seeded" list.
--
-- Applied as esamagri_owner (same as the schema-creating migrations) so
-- ownership/attribution is consistent; this migration is pure DML, no
-- object creation, so ownership isn't actually load-bearing here, but SET
-- ROLE is kept for consistency with the rest of the project.
-- =============================================================================

SET ROLE esamagri_owner;

-- ---------------------------------------------------------------------------
-- 1. shared.permissions — the namespaced permission-code catalog. Every
--    code below is taken verbatim from Phase 2 Rev1 Section 23 (the seed
--    roles' "representative permissions" column) or Section 23's own
--    naming-convention example (shared.audit_log.view). This is not an
--    exhaustive application permission set — Section 23 itself only gives
--    "representative" permissions per role — but it is exactly the set
--    Phase 2 names, nothing invented beyond it.
-- ---------------------------------------------------------------------------
INSERT INTO shared.permissions (id, code, module, description) VALUES
  (shared.uuid_generate_v7(), 'shared.user.manage',          'shared', 'Create/manage staff user accounts (Section 23).'),
  (shared.uuid_generate_v7(), 'shared.role.grant',            'shared', 'Grant/revoke roles — the only role that can grant other roles (Section 23).'),
  (shared.uuid_generate_v7(), 'shared.settings.write',        'shared', 'Write shared.settings values (Section 23).'),
  (shared.uuid_generate_v7(), 'shared.audit_log.view',        'shared', 'Read shared.audit_log (Section 23, permission-code naming example).'),
  (shared.uuid_generate_v7(), 'rik.entitlement.allocate',     'rik',    'Allocate a new rik.entitlements row (Section 23).'),
  (shared.uuid_generate_v7(), 'rik.entitlement.adjust',       'rik',    'Write a rik.entitlement_ledger ADJUST row (Section 23).'),
  (shared.uuid_generate_v7(), 'rik.product.manage',           'rik',    'Manage rik.products/categories (Section 23).'),
  (shared.uuid_generate_v7(), 'rik.order.manage',             'rik',    'Manage rik.orders broadly (Section 23).'),
  (shared.uuid_generate_v7(), 'rik.order.mark_ready',         'rik',    'Transition a rik.orders row to READY (Section 23).'),
  (shared.uuid_generate_v7(), 'rik.order.mark_collected',     'rik',    'Transition a rik.orders row to COLLECTED (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.product.manage',           'pif',    'Manage pif.products/categories (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.purchase_order.approve',   'pif',    'Approve a pif.purchase_orders row (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.report.view',               'pif',    'View PIF reporting (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.pos.open_bill',             'pif',    'Open a pif.pos_bills row at the counter (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.pos.finalize_bill',         'pif',    'Finalize a pif.pos_bills row (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.pos.return',                'pif',    'Create a pif.returns row (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.order.mark_delivered',      'pif',    'Transition a pif.orders row to DELIVERED (Section 23).'),
  (shared.uuid_generate_v7(), 'pif.order.mark_not_delivered',  'pif',    'Transition a pif.orders row to NOT_DELIVERED (Section 23).');

-- ---------------------------------------------------------------------------
-- 2. shared.roles — the six seed roles named explicitly in Section 23/31.
--    RIK_PICKUP_STAFF and DELIVERY_STAFF are marked optional in Phase 1
--    (include only if pickup/delivery is handled by dedicated staff); Section
--    31 still lists both among the six seed roles, so both are seeded —
--    an unused role with no assigned users is harmless.
-- ---------------------------------------------------------------------------
INSERT INTO shared.roles (id, name, description) VALUES
  (shared.uuid_generate_v7(), 'SUPER_ADMIN',       'Shared-scope super-administrator. Only role that can grant other roles (Section 23).'),
  (shared.uuid_generate_v7(), 'RIK_ADMIN',         'RIK-scope administrator (Section 23).'),
  (shared.uuid_generate_v7(), 'PIF_ADMIN',         'PIF-scope administrator (Section 23).'),
  (shared.uuid_generate_v7(), 'PIF_CASHIER',       'PIF counter cashier — deliberately excludes pif.product.manage (Section 23).'),
  (shared.uuid_generate_v7(), 'RIK_PICKUP_STAFF',  'Narrow, counter-facing RIK pickup role. Optional per Phase 1 — include only if pickup is handled by dedicated staff (Section 23).'),
  (shared.uuid_generate_v7(), 'DELIVERY_STAFF',    'PIF delivery role. Optional per Phase 1 — include only if delivery is handled by dedicated staff (Section 23).');

-- ---------------------------------------------------------------------------
-- 3. shared.role_permissions — role -> permission mapping exactly matching
--    each seed role's "representative permissions" from Section 23. Note
--    these are the permissions Section 23 names as representative, not
--    necessarily an exhaustive production permission set for each role.
-- ---------------------------------------------------------------------------
INSERT INTO shared.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM shared.roles r, shared.permissions p
WHERE (r.name, p.code) IN (
  ('SUPER_ADMIN', 'shared.user.manage'),
  ('SUPER_ADMIN', 'shared.role.grant'),
  ('SUPER_ADMIN', 'shared.settings.write'),
  ('SUPER_ADMIN', 'shared.audit_log.view'),
  ('RIK_ADMIN', 'rik.entitlement.allocate'),
  ('RIK_ADMIN', 'rik.entitlement.adjust'),
  ('RIK_ADMIN', 'rik.product.manage'),
  ('RIK_ADMIN', 'rik.order.manage'),
  ('PIF_ADMIN', 'pif.product.manage'),
  ('PIF_ADMIN', 'pif.purchase_order.approve'),
  ('PIF_ADMIN', 'pif.report.view'),
  ('PIF_CASHIER', 'pif.pos.open_bill'),
  ('PIF_CASHIER', 'pif.pos.finalize_bill'),
  ('PIF_CASHIER', 'pif.pos.return'),
  ('RIK_PICKUP_STAFF', 'rik.order.mark_ready'),
  ('RIK_PICKUP_STAFF', 'rik.order.mark_collected'),
  ('DELIVERY_STAFF', 'pif.order.mark_delivered'),
  ('DELIVERY_STAFF', 'pif.order.mark_not_delivered')
);

-- ---------------------------------------------------------------------------
-- 4. One bootstrap shared.users row + its SUPER_ADMIN grant — Section 31.
--    password_hash is a deliberate, unusable sentinel, NOT a real
--    credential of any kind and NOT computed by a hashing scheme chosen
--    here (password hashing is an application-layer decision, out of scope
--    for Phase 3A per the brief's "NO APPLICATION CODE YET" fence). This
--    account cannot authenticate until a real out-of-band provisioning
--    step (outside this migration, e.g. a one-time admin CLI command)
--    overwrites password_hash with a real hash and forces an immediate
--    change — exactly Section 31's "forced-reset temporary credential set
--    through a secure out-of-band step... never a hardcoded plaintext
--    password committed in a seed file."
--    granted_by = itself: the one legitimate exception to "every grant
--    attributable to a SUPER_ADMIN action" — there is no prior SUPER_ADMIN
--    to attribute the very first grant to.
-- ---------------------------------------------------------------------------
INSERT INTO shared.users (id, username, password_hash, display_name, status)
VALUES (
  shared.uuid_generate_v7(),
  'bootstrap_super_admin',
  '!UNUSABLE!SET_VIA_SECURE_OUT_OF_BAND_PROVISIONING_STEP!NOT_A_REAL_HASH!',
  'Bootstrap Super Admin (rotate immediately)',
  'ACTIVE'
);

INSERT INTO shared.user_roles (user_id, role_id, granted_by)
SELECT u.id, r.id, u.id
FROM shared.users u, shared.roles r
WHERE u.username = 'bootstrap_super_admin' AND r.name = 'SUPER_ADMIN';

-- ---------------------------------------------------------------------------
-- 5. Minimal starting taxonomy — Section 31's literal example, in both RIK
--    and PIF category tables (two separate schemas, two separate rows each).
-- ---------------------------------------------------------------------------
INSERT INTO rik.categories (id, name) VALUES
  (shared.uuid_generate_v7(), 'Grains'),
  (shared.uuid_generate_v7(), 'Pulses'),
  (shared.uuid_generate_v7(), 'Cooking Oil');

INSERT INTO pif.categories (id, name) VALUES
  (shared.uuid_generate_v7(), 'Grains'),
  (shared.uuid_generate_v7(), 'Pulses'),
  (shared.uuid_generate_v7(), 'Cooking Oil');

-- ---------------------------------------------------------------------------
-- 6. pif.tax_rates — at minimum a 0% row (Section 06/31), usable
--    immediately regardless of how the GST business decision (Section 34)
--    is eventually answered.
-- ---------------------------------------------------------------------------
INSERT INTO pif.tax_rates (id, name, rate_pct, active) VALUES
  (shared.uuid_generate_v7(), 'Not applicable / 0%', 0.00, true);

-- ---------------------------------------------------------------------------
-- 7. shared.settings placeholders for the two Section 34 BUSINESS DECISION
--    REQUIRED settings values named there. Values are clearly-labeled
--    placeholders, not asserted as final (Section 31). Key names: Section
--    34 names rik.not_collected_ttl_days explicitly; the PIF online
--    reservation timeout key is described but not named by Phase 2 — named
--    here as pif.online_reservation_timeout_minutes, following the same
--    {module}.{setting_name} convention as the given key, and called out
--    in docs/reconciliation-report.md as a naming choice made in Phase 3A,
--    not a Phase 2 requirement.
-- ---------------------------------------------------------------------------
INSERT INTO shared.settings (key, value) VALUES
  ('rik.not_collected_ttl_days', '{"value": null, "status": "BUSINESS_DECISION_REQUIRED", "note": "How long a READY RIK order waits before auto-release. Phase 2 Section 34."}'::jsonb),
  ('pif.online_reservation_timeout_minutes', '{"value": null, "status": "BUSINESS_DECISION_REQUIRED", "note": "How long stock stays reserved for an unpaid/unconfirmed PIF online order before auto-release. Phase 2 Section 34. Key name chosen in Phase 3A — Phase 2 does not name this key."}'::jsonb);

RESET ROLE;
