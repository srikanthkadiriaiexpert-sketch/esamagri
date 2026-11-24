-- =============================================================================
-- Migration 0004: shared.auth_sessions, otp_requests, notification_outbox,
--                  audit_log, idempotency_keys
-- Phase 2 Rev1 Section 04, 22, 24, 27.
-- =============================================================================

CREATE TABLE shared.auth_sessions (
  id                  uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  principal_type      text        NOT NULL,
  principal_id        uuid        NOT NULL,
  family_id           uuid        NOT NULL,
  refresh_token_hash  text        NOT NULL,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  revoked_at          timestamptz,
  replaced_by_id      uuid,
  ip_address          inet,
  device_info         text,
  CONSTRAINT auth_sessions_pk PRIMARY KEY (id),
  CONSTRAINT auth_sessions_token_uq UNIQUE (refresh_token_hash),
  CONSTRAINT auth_sessions_principal_type_chk CHECK (principal_type IN ('STAFF','CUSTOMER')),
  CONSTRAINT auth_sessions_replaced_by_fk FOREIGN KEY (replaced_by_id) REFERENCES shared.auth_sessions (id)
);
CREATE INDEX auth_sessions_principal_idx ON shared.auth_sessions (principal_type, principal_id);
CREATE INDEX auth_sessions_family_idx ON shared.auth_sessions (family_id);
COMMENT ON TABLE shared.auth_sessions IS 'Server-side refresh-token tracking, rotated on every use. principal_id is polymorphic (STAFF->users.id, CUSTOMER->customers.id), app-validated, not a physical FK (Section 04). Phase 2 Section 22.';

CREATE TABLE shared.otp_requests (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  mobile_number   text        NOT NULL,
  otp_hash        text        NOT NULL,
  purpose         text        NOT NULL,
  expires_at      timestamptz NOT NULL,
  attempt_count   smallint    NOT NULL DEFAULT 0,
  max_attempts    smallint    NOT NULL DEFAULT 5,
  consumed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_requests_pk PRIMARY KEY (id),
  CONSTRAINT otp_requests_purpose_chk CHECK (purpose IN ('LOGIN','REGISTER')),
  CONSTRAINT otp_requests_attempts_chk CHECK (attempt_count <= max_attempts)
);
CREATE INDEX otp_requests_mobile_created_idx ON shared.otp_requests (mobile_number, created_at);

CREATE TABLE shared.notification_outbox (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  principal_type  text        NOT NULL,
  principal_id    uuid        NOT NULL,
  channel         text        NOT NULL,
  event_type      text        NOT NULL,
  payload         jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING',
  attempts        smallint    NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CONSTRAINT notification_outbox_pk PRIMARY KEY (id),
  CONSTRAINT notification_outbox_channel_chk CHECK (channel IN ('SMS','WHATSAPP','PUSH','INAPP')),
  CONSTRAINT notification_outbox_status_chk CHECK (status IN ('PENDING','SENT','FAILED'))
);
CREATE INDEX notification_outbox_poll_idx ON shared.notification_outbox (status, created_at);

CREATE TABLE shared.audit_log (
  id              uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  actor_id        uuid,
  actor_role      text,
  module          text        NOT NULL,
  action          text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  ip_address      inet,
  device_info     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_pk PRIMARY KEY (id),
  CONSTRAINT audit_log_module_chk CHECK (module IN ('shared','rik','pif'))
);
CREATE INDEX audit_log_actor_idx ON shared.audit_log (actor_id);
CREATE INDEX audit_log_module_idx ON shared.audit_log (module);
CREATE INDEX audit_log_entity_idx ON shared.audit_log (entity_type, entity_id);
CREATE INDEX audit_log_created_idx ON shared.audit_log (created_at);
COMMENT ON TABLE shared.audit_log IS 'Append-only. INSERT-only for all application roles; UPDATE/DELETE blocked by trigger (migration 0006). Phase 2 Section 24.';

CREATE TABLE shared.idempotency_keys (
  id                  uuid        NOT NULL DEFAULT shared.uuid_generate_v7(),
  idempotency_key     text        NOT NULL,
  endpoint            text        NOT NULL,
  principal_id        uuid        NOT NULL,
  response_snapshot   jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_pk PRIMARY KEY (id),
  CONSTRAINT idempotency_keys_key_endpoint_uq UNIQUE (idempotency_key, endpoint)
);
CREATE INDEX idempotency_keys_created_idx ON shared.idempotency_keys (created_at);
COMMENT ON TABLE shared.idempotency_keys IS 'Required V1 infrastructure (not optional) — mandatory duplicate-processing guard for every operation listed in Section 27. principal_id is polymorphic, app-validated, not a physical FK.';
