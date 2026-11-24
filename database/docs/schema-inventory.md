# Phase 3A / Phase 2 Revision 2 — Final Reconciled Schema Inventory

**47 tables + 5 views**, confirmed against the live `esamagri_test`
database's own catalog (`information_schema.tables`/`views`), not
retyped from memory. This corrects Phase 2 Section 01/03's original "1
view" (Phase 3A, see `docs/reconciliation-report.md` item 1) and then
Phase 3A's own "45 tables + 3 views" baseline once Revision 2 added two
new tables (Revision 2, see `docs/reconciliation-report.md` item 14).

**Note on the table count:** your Revision 2 approval message states the
final baseline as "45 tables + 5 views." The 5-views figure is exactly
right and matches the authoritative inventory you gave verbatim.
However, "45 tables" is arithmetically the pre-Revision-2 figure — once
`shared.announcements` and `rik.issue_schedules` are added, the true
total is **47 tables** (45 + 2 new). This is stated plainly here rather
than silently repeating "45," the same way earlier numeric
discrepancies in this project were resolved transparently (see
`docs/reconciliation-report.md` items 1 and 13).

## shared (14 tables, 2 views)

| Object | Purpose |
|---|---|
| `users` | Staff accounts only (admins, cashiers, pickup/delivery staff). Customers never appear here. |
| `customers` | One identity shared by a resident's RIK and PIF relationship. |
| `customer_addresses` | Delivery addresses; one `is_default` per customer (partial-UQ). |
| `roles` | The 6 seed RBAC roles. |
| `permissions` | Namespaced `{module}.{resource}.{action}` permission codes. |
| `role_permissions` | Role → permission mapping. |
| `user_roles` | Staff → role grants; `granted_by` mandatory (Section 23). |
| `settings` | Key/value config, including business-decision placeholders. |
| `auth_sessions` | Server-side refresh-token tracking, rotated on every use. |
| `otp_requests` | Customer OTP auth requests. |
| `notification_outbox` | Outbound notification queue. |
| `audit_log` | Append-only audit trail. Writable only via `log_audit_event()`. |
| `idempotency_keys` | Mandatory request-deduplication cache (Section 27). |
| `announcements` | **Revision 2.** Admin-authored customer-facing narrative notices (general, holiday/closure, RIK issue-days, PIF timing, etc.). `created_by`/`updated_by` are physical FKs to `shared.users.id` (same-schema, not weakened — Revision 2 correction #2). |
| `v_customer_profile` (view) | The only cross-schema-readable customer projection. |
| `v_active_announcements` (view) | **Revision 2.** Customer-facing read model: published, not soft-deleted, today within `[start_date, end_date-or-open-ended]`, ordered URGENT-first. Does not itself filter by `target_audience` — the backend must apply audience context (Revision 2 correction #3). |

## rik (13 tables, 3 views)

| Object | Purpose |
|---|---|
| `categories` | RIK product categories. |
| `products` | RIK catalog — no price/tax columns (entitlement issuance, not billing). |
| `inventory` | Denormalized current stock balance, 1:1 with `products`. |
| `inventory_transactions` | Append-only stock ledger, 9 transaction types. |
| `entitlement_periods` | Time-bound entitlement cycles. |
| `entitlements` | One row per customer × (product\|category) × period. |
| `entitlement_ledger` | Append-only entitlement ledger (ALLOCATE/RESERVE/ISSUE/RELEASE/ADJUST). |
| `carts` | One open cart per customer. |
| `cart_items` | Cart line items. |
| `orders` | RIK order lifecycle, 9-state machine, CLOSED-only terminal. |
| `order_items` | Order line items, linked to their RESERVE ledger/inventory rows. |
| `order_status_history` | Status-change audit trail. |
| `issue_schedules` | **Revision 2.** Structured, machine-readable RIK issue calendar — `schedule_date` + (`category_id` XOR `product_id` XOR general) + `status` + optional time window + `notes`. `created_by`/`updated_by` are trigger-validated against `shared.users` (cross-schema, `rik.trg_validate_staff_ref` → `shared.assert_staff_user_exists`), per Revision 2 correction #2. |
| `v_entitlement_balance` (view) | Allocated/Adjusted/Reserved/Issued/Available per entitlement pool. |
| `v_entitlement_consumption_by_product` (view) | Category-pool consumption broken down by product. |
| `v_issue_schedule` (view) | **Revision 2.** Customer-facing RIK Issue Calendar read model: published, not soft-deleted. Deliberately *not* date-filtered (unlike `v_active_announcements`) so a calendar UI can page into history as well as forward. |

## pif (20 tables)

| Object | Purpose |
|---|---|
| `categories` | PIF product categories (self-referential, `parent_id`). |
| `tax_rates` | Tax rate catalog; seeded with a 0% "not applicable" row. |
| `products` | PIF catalog — priced, taxed. |
| `inventory` | Denormalized current stock balance, shared by counter and online paths. |
| `inventory_transactions` | Append-only stock ledger, 9 types. |
| `suppliers` | Supplier master. |
| `purchase_orders` | Purchase order header, 5-state lifecycle. |
| `purchase_order_items` | PO line items. |
| `goods_receipts` | Goods-receipt header — the point a purchase becomes live stock. |
| `goods_receipt_items` | Receipt line items; immutable historical `unit_cost`. |
| `cashier_shifts` | Counter cashier shift, one open per cashier. |
| `pos_bills` | Unified counter + online sale record. `online_order_id` is the sole order↔bill link. |
| `pos_bill_items` | Bill line items; immutable once the parent bill is FINALIZED. |
| `carts` | PIF online cart (separate from RIK's). |
| `cart_items` | Cart line items. |
| `orders` | PIF online-order lifecycle, 10-state machine. No `bill_id` (Revision 1). |
| `order_items` | Order line items. |
| `returns` | Post-sale returns; only against a FINALIZED bill. |
| `return_items` | Return line items. |
| `cash_movements` | Append-only cash ledger (Revision 1 — new table). |

## Cross-schema reference map (no physical FKs)

Every reference below is DB-enforced by a `SECURITY DEFINER`-backed
trigger (`shared.assert_customer_exists` / `assert_staff_user_exists`),
not a physical foreign key — verified structurally in
`tests/030_isolation_security_rbac.sql` (#1a: zero FKs cross `rik`↔`pif`,
or either into `shared`, in `information_schema`).

- `rik.carts.customer_id`, `rik.orders.customer_id`, `rik.entitlements.customer_id` → `shared.customers.id`
- `pif.carts.customer_id`, `pif.orders.customer_id`, `pif.pos_bills.customer_id` → `shared.customers.id`
- `pif.cashier_shifts.cashier_id`, `pif.pos_bills.cashier_id` → `shared.users.id`
- `pif.cash_movements.handled_by` → `shared.users.id`
- **Revision 2:** `rik.issue_schedules.created_by`/`updated_by` → `shared.users.id`, via the new
  `rik.trg_validate_staff_ref()` (first use of the staff-ref-validation pattern in the `rik` schema;
  `app_rik` was granted `EXECUTE` on `shared.assert_staff_user_exists()` for this in migration `0023`).

Attribution-only columns (`created_by`, `received_by`, `changed_by`, etc.)
remain plain unvalidated UUIDs, per Phase 2's explicit "accepted trade-off"
(Section 34) — they are audit fields, not integrity-critical joins. **Revision
2 exception:** `shared.announcements.created_by`/`updated_by` are same-schema
references (`shared.announcements` → `shared.users`, both in `shared`), so per
Revision 2 correction #2 they are ordinary physical foreign keys, not
attribution-only — this is a same-schema case, not a relaxation of the
cross-schema trade-off above.

## Revision 2: `related_reference_type` / `related_reference_id`

`shared.announcements.related_reference_type`/`related_reference_id` is an
**optional, loose, application-validated reference** — deliberately not a
physical FK and not part of the cross-schema map above (per Revision 2
correction #7):

- It may point at a row in another table (e.g. `rik.issue_schedules`), but
  the database does not enforce that the referenced row exists or stays
  valid.
- The application is responsible for validating `related_reference_type`
  against an allowed set of values.
- Soft-deleting or otherwise removing the referenced row can never break the
  referencing announcement — verified directly in
  `tests/060_revision2_announcements_and_schedules.sql` (#15e): an
  announcement stays fully valid and remains in `shared.v_active_announcements`
  even after its related `rik.issue_schedules` row is soft-deleted.
- Rationale for staying non-FK: every other cross-schema-flavored reference
  in this system runs `rik`/`pif` → `shared`, never the reverse; a physical FK
  here would run backward from that established direction.
