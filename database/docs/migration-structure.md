# Phase 3A / Phase 2 Revision 2 — Migration File Structure

Plain, forward-only, numbered `.sql` files. No ORM, no migration
framework — applied in order with:

```
psql -d <database> -v ON_ERROR_STOP=1 -f migrations/<file>
```

Every file was applied to a live `esamagri_test` database (PostgreSQL
16.13) and confirmed clean before the next was written. There are no
down-migrations (see `docs/deployment-and-rollback.md` for why, and what
to do instead). Migrations `0001`-`0019` are Phase 3A; `0020`-`0023` are
Phase 2 Revision 2 (announcements + RIK issue schedules), approved with
corrections — see `docs/reconciliation-report.md` items 14-19. `0024` is
a final-release-audit fix (least-privilege correction, no new objects) —
see `docs/reconciliation-report.md` item 20.

| # | File | Contents | Depends on |
|---|------|----------|------------|
| 0001 | `extensions_and_schemas.sql` | `pg_trgm`, `btree_gist` extensions; `shared`/`rik`/`pif` schemas | — |
| 0002 | `shared_uuidv7.sql` | `shared.uuid_generate_v7()`, `shared.uuid_v7_extract_timestamp()` | 0001 |
| 0003 | `shared_core_identity.sql` | `shared.users`, `customers`, `customer_addresses`, `roles`, `permissions`, `role_permissions`, `user_roles`, `settings` | 0002 |
| 0004 | `shared_auth_audit_idempotency.sql` | `shared.auth_sessions`, `otp_requests`, `notification_outbox`, `audit_log`, `idempotency_keys` | 0002 |
| 0005 | `shared_functions.sql` | `shared.log_audit_event()`, `assert_customer_exists()`, `assert_staff_user_exists()`, `trg_audit_log_immutable()` + trigger | 0003, 0004 |
| 0006 | `shared_view.sql` | `shared.v_customer_profile` | 0003 |
| 0007 | `rik_catalog_inventory.sql` | `rik.categories`, `products`, `inventory`, `inventory_transactions` | 0002 |
| 0008 | `rik_entitlements.sql` | `rik.entitlement_periods`, `entitlements`, `entitlement_ledger` + `rik.v_entitlement_balance`, `v_entitlement_consumption_by_product` | 0007 |
| 0009 | `rik_cart_orders.sql` | `rik.carts`, `cart_items`, `orders`, `order_items`, `order_status_history` | 0007, 0008 |
| 0010 | `rik_functions_triggers.sql` | `rik.trg_validate_customer_ref`, `trg_validate_order_status_transition`, `trg_validate_ledger_product_match` + wiring | 0005, 0008, 0009 |
| 0011 | `pif_catalog_inventory.sql` | `pif.categories`, `tax_rates`, `products`, `inventory`, `inventory_transactions` | 0002 |
| 0012 | `pif_purchasing.sql` | `pif.suppliers`, `purchase_orders`, `purchase_order_items`, `goods_receipts`, `goods_receipt_items` | 0011 |
| 0013 | `pif_shifts_online_orders.sql` | `pif.cashier_shifts`, `carts`, `cart_items`, `orders`, `order_items` | 0011 |
| 0014 | `pif_pos_billing_cash.sql` | `pif.pos_bills`, `pos_bill_items`, `cash_movements` | 0013 (needs `pif.orders` for `online_order_id`) |
| 0015 | `pif_returns.sql` | `pif.returns`, `return_items` | 0014 |
| 0016 | `pif_functions_triggers.sql` | `pif.trg_validate_customer_ref/cashier_ref/handled_by_ref`, order + bill status-transition triggers, bill-items immutability trigger | 0005, 0013, 0014 |
| 0017 | `shared_idempotency_functions.sql` | `shared.claim_idempotency_key()`, `store_idempotent_response()`, `get_idempotent_response()` | 0004 |
| 0018 | `roles_and_grants.sql` | `esamagri_owner` + 5 app roles; ownership reassignment; all least-privilege grants; default privileges | every prior migration (needs every object to exist) |
| 0019 | `seed_data.sql` | Roles, permissions, role_permissions, bootstrap `SUPER_ADMIN`, minimal category taxonomy, 0% tax rate, settings placeholders | 0018 (applies as `esamagri_owner`) |
| 0020 | `0020_shared_announcements.sql` | `shared.announcements` — physical FKs `created_by`/`updated_by` → `shared.users.id` (Revision 2 correction #2) | 0003 (needs `shared.users`), applies as `esamagri_owner` |
| 0021 | `0021_rik_issue_schedules.sql` | `rik.issue_schedules` (scope-XOR, status/time-window CHECKs, 3 partial-unique duplicate-prevention indexes) + new `rik.trg_validate_staff_ref()` function/trigger | 0007 (needs `rik.categories`/`rik.products`), 0005 (needs `shared.assert_staff_user_exists`), applies as `esamagri_owner` |
| 0022 | `0022_revision2_views.sql` | `shared.v_active_announcements`, `rik.v_issue_schedule` — brings the total to 5 views | 0020, 0021, applies as `esamagri_owner` |
| 0023 | `0023_revision2_permissions_and_grants.sql` | 2 new permission codes (`shared.announcement.manage`, `rik.issue_schedule.manage`) + `role_permissions` assignments; grants on `shared.announcements`/`shared.v_active_announcements`; targeted `REVOKE DELETE` on `rik.issue_schedules`/`rik.v_issue_schedule` from `app_rik` (narrowing migration 0018's schema-wide default-privileges rule for this one soft-delete-only table, without altering that rule itself); `GRANT EXECUTE` on `shared.assert_staff_user_exists` to `app_rik` | 0018 (roles must exist), 0020-0022, applies as `esamagri_owner` |
| 0024 | `0024_revoke_public_execute_security_definer.sql` | Final-release-audit fix: `REVOKE EXECUTE ... FROM PUBLIC` on all 6 `SECURITY DEFINER` functions in `shared` — closes a real privilege-escalation gap where `app_reporting_rik`/`app_reporting_pif` could call `log_audit_event()`/`claim_idempotency_key()`/etc. via the default PostgreSQL PUBLIC-execute grant, despite holding no table grant. No new objects; no change to any legitimate app role's access. | 0005, 0017, 0018, 0023 (functions and their intended grants must already exist), applies as `esamagri_owner` |

## Test files (`tests/`)

Not part of the migration chain — run against an already-migrated
database, each one either self-contained inside a `BEGIN; ... ROLLBACK;`
transaction (no residue) or, for the two true-concurrency scripts,
cleaning up its own rows explicitly at the end.

| File | Scenarios covered |
|---|---|
| `000_uuidv7_validation.sql` | UUIDv7 version/variant/timestamp/ordering/bulk-uniqueness |
| `000b_uuidv7_concurrency.sh` | UUIDv7 uniqueness under real concurrent backends |
| `010_rik_entitlement_and_inventory.sql` | #2, #3, #5, #6, #7, #10 (RIK half) |
| `020_pif_billing_and_inventory.sql` | #8, #10 (PIF half), #11, #12, #13, #14, #20 |
| `030_isolation_security_rbac.sql` | #1, #15, #16, #18 |
| `040_idempotency_and_auth.sql` | #17, #19 |
| `050_concurrency.sh` | #4, #9 (true cross-process concurrency) |
| `060_revision2_announcements_and_schedules.sql` | Revision 2 checklist: publish/unpublish, date-based active filtering, expiry, open-ended, ALL/RIK/PIF audience, priority ordering, soft deletion, RIK schedule date queries, category/product/general schedule, scope-XOR, duplicate-prevention (all 3 partial-unique indexes), time-window validation, FK/trigger reference integrity (incl. the loose non-FK `related_reference_id`), permissions, unauthorized admin attempts, view/grant access, plus an audit-integration smoke test |
| `070_audit_concurrency.sh` | Final-release-audit additions, real cross-process concurrency not covered by `050`: #A RIK inventory reservation locking (`rik.inventory`, `SELECT...FOR UPDATE`), #B duplicate COD-collection prevention under true concurrency (`pif_cash_movements_cod_order_uq`), #C duplicate idempotent-request prevention under true concurrency (`shared.claim_idempotency_key()`) |

See `docs/final-verification-report.md` for the numbered scenario list
mapped to results, and `docs/reconciliation-report.md` item 13 for how the
20th Phase 3A scenario was determined.
