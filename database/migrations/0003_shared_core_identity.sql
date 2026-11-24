-- =============================================================================
-- Migration 0003: shared.users, customers, customer_addresses, RBAC tables
-- Phase 2 Rev1 Section 04 (dictionaries), Section 11-13 (constraints).
-- =============================================================================

CREATE TABLE shared.users (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  username        text        NOT NULL,
  password_hash   text        NOT NULL,
  display_name    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'ACTIVE',
  totp_secret     text,
  totp_enabled    boolean     NOT NULL DEFAULT false,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  CONSTRAINT users_pk PRIMARY KEY (id),
  CONSTRAINT users_username_uq UNIQUE (username),
  CONSTRAINT users_status_chk CHECK (status IN ('ACTIVE','SUSPENDED','DISABLED')),
  CONSTRAINT users_created_by_fk FOREIGN KEY (created_by) REFERENCES shared.users (id)
);
COMMENT ON TABLE shared.users IS 'Staff accounts only (admins, cashiers, delivery/pickup staff). Customers never appear here. Phase 2 Section 04.';

CREATE TABLE shared.customers (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  mobile_number   text        NOT NULL,
  name            text        NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT customers_pk PRIMARY KEY (id),
  CONSTRAINT customers_mobile_uq UNIQUE (mobile_number)
);
COMMENT ON TABLE shared.customers IS 'One identity shared by a residents RIK and PIF relationship. Phase 2 Section 04.';

CREATE TABLE shared.customer_addresses (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  customer_id     uuid        NOT NULL,
  label           text,
  quarter_block   text        NOT NULL,
  quarter_number  text        NOT NULL,
  landmark        text,
  is_default      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_addresses_pk PRIMARY KEY (id),
  CONSTRAINT customer_addresses_customer_fk FOREIGN KEY (customer_id) REFERENCES shared.customers (id)
);
CREATE UNIQUE INDEX customer_addresses_one_default_uq ON shared.customer_addresses (customer_id) WHERE is_default;
CREATE INDEX customer_addresses_customer_idx ON shared.customer_addresses (customer_id);
COMMENT ON TABLE shared.customer_addresses IS 'Quarter/residence info; PIF delivery defaults to is_default. Phase 2 Section 04.';

-- ---------------------------------------------------------------------------
-- RBAC — roles / permissions / role_permissions / user_roles (Section 04, 23)
-- ---------------------------------------------------------------------------
CREATE TABLE shared.roles (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  name            text        NOT NULL,
  description     text,
  CONSTRAINT roles_pk PRIMARY KEY (id),
  CONSTRAINT roles_name_uq UNIQUE (name)
);

CREATE TABLE shared.permissions (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  code            text        NOT NULL,
  module          text        NOT NULL,
  description     text,
  CONSTRAINT permissions_pk PRIMARY KEY (id),
  CONSTRAINT permissions_code_uq UNIQUE (code),
  CONSTRAINT permissions_module_chk CHECK (module IN ('shared','rik','pif'))
);

CREATE TABLE shared.role_permissions (
  role_id         uuid        NOT NULL,
  permission_id   uuid        NOT NULL,
  CONSTRAINT role_permissions_pk PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id) REFERENCES shared.roles (id),
  CONSTRAINT role_permissions_permission_fk FOREIGN KEY (permission_id) REFERENCES shared.permissions (id)
);

CREATE TABLE shared.user_roles (
  user_id         uuid        NOT NULL,
  role_id         uuid        NOT NULL,
  granted_by      uuid        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pk PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES shared.users (id),
  CONSTRAINT user_roles_role_fk FOREIGN KEY (role_id) REFERENCES shared.roles (id),
  CONSTRAINT user_roles_granted_by_fk FOREIGN KEY (granted_by) REFERENCES shared.users (id)
);
COMMENT ON TABLE shared.user_roles IS 'granted_by is mandatory (Section 23): every role grant is individually attributable to a SUPER_ADMIN action.';

-- shared.settings.updated_by references shared.users, so settings is created
-- here (deferred FK ordering) alongside the other identity tables.
CREATE TABLE shared.settings (
  key             text        NOT NULL,
  value           jsonb       NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT settings_pk PRIMARY KEY (key),
  CONSTRAINT settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES shared.users (id)
);
