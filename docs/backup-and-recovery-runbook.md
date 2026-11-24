# e-Samagri — Backup and Recovery Runbook

**Base Victualling Yard, Visakhapatnam — RIK and PIF**
Written for whoever is on duty when something has gone wrong. It assumes no
knowledge of the application's internals.

---

## 0. The one-minute version

| You want to | Run |
| --- | --- |
| Take a backup now | `ops/esamagri-backup.sh` |
| Prove a backup is good | `ops/esamagri-verify-backup.sh <backup-set>` |
| Restore a backup | `ops/esamagri-restore.sh --target <database> <backup-set>` |
| Check the app's view of the database | `GET /health/ready` |

All three scripts refuse to half-finish: a failed backup is renamed
`*.FAILED` rather than left looking complete, and a restore into a database
that already holds e-Samagri data stops and tells you what it found.

---

## 1. What a complete backup of this application is

Three things. A backup missing any one of them cannot bring the service back.

1. **The database** — `pg_dump -Fc`, **with ownership and privileges**. This
   matters more here than in a typical application. The separation between
   RIK and PIF is not enforced by application code; it is enforced by
   PostgreSQL privileges (`app_rik` holds nothing in the `pif` schema, and
   the reverse), and the append-only history spines work because the
   application role holds `INSERT` but **not** `UPDATE` or `DELETE` on
   `rik.issue_vouchers`, `rik.issue_voucher_outcomes`, `pif.orders`,
   `pif.order_items`, `pif.order_events` and the product-import tables. A
   dump taken with `--no-owner --no-acl` would restore a database in which
   the application can rewrite a delivered order. **Never add those flags.**
2. **The cluster's roles** — `pg_dumpall --roles-only`. Roles live in the
   cluster, not in the database, so a database-only dump restores tables that
   grant privileges to roles which do not exist.
3. **The uploaded images, from both media stores** — PIF product and category
   photographs under `PIF_MEDIA_ROOT`, and RIK provision photographs under
   `RIK_MEDIA_ROOT`, each referenced by an `image_ref` column. Restore the
   database without them and every uploaded photograph is a broken picture.
   They are archived separately (`pif-media.tar.gz`, `rik-media.tar.gz`) so
   either store can be restored without disturbing the other, and a backup set
   taken before RIK provision pictures existed has no RIK archive — which
   restores cleanly and says so.

   A reference beginning `/catalogue/` is **not** in either store. Those are
   files committed to the web apps' own bundles; they travel with the code,
   they have never been in a media archive, and the verification step
   deliberately does not demand a file for one. Before that distinction was
   drawn, the check demanded a file for every reference and so reported every
   committed asset as missing — 212 of them on a current database — turning a
   healthy backup into `NOT VERIFIED`.

`ops/esamagri-backup.sh` takes all three, plus a manifest (the schema
contract and row counts as they stood) and a `SHA256SUMS` file.

### Who the backup must run as

The API writes uploaded images as mode `0640`, owned by the user the API runs
as. **The backup must therefore run as that user, or as root** — not as the
database user. A backup run by a user who cannot read `PIF_MEDIA_ROOT` or
`RIK_MEDIA_ROOT` fails on step 3 and says so; it does not quietly produce a
database-only backup.

### Schedule

| What | When | Keep |
| --- | --- | --- |
| `ops/esamagri-backup.sh` | Nightly, after the last issue window closes | 30 days (`RETAIN_DAYS`) |
| `ops/esamagri-verify-backup.sh` on the newest set | Weekly | — |
| Off-machine copy of the newest set | Nightly, after the backup | per the yard's own policy |

Retention only ever deletes directories matching this application's own
naming pattern inside `BACKUP_DIR`, and never the set just written.

A nightly cron entry, running as the application's user:

```cron
15 2 * * *  cd /srv/esamagri && BACKUP_DIR=/srv/backups ops/esamagri-backup.sh >> /var/log/esamagri-backup.log 2>&1
30 3 * * 0  cd /srv/esamagri && ops/esamagri-verify-backup.sh "$(ls -1dt /srv/backups/esamagri-* | head -1)" >> /var/log/esamagri-backup.log 2>&1
```

**A backup that lives only on the same machine as the database is not a
backup.** Copy each night's set to the yard's own off-machine storage.

---

## 2. Verifying a backup — and why it is not optional

A backup that has never been restored is a hope, not a backup.
`ops/esamagri-verify-backup.sh` restores the set into a **scratch database**
and then asks the restored copy eight questions, every one a real query
against it rather than a line read back out of the manifest:

1. the checksums match;
2. `pg_restore` can read the dump's table of contents;
3. a full restore succeeds;
4. the schema contract holds — tables, views, `pif` tables, permissions,
   roles, all equal to what the manifest recorded;
5. **the privilege model survived** — no `UPDATE`/`DELETE` on any
   append-only table. This is the check an ordinary backup verification would
   miss, and the one that catches a dump taken with the wrong flags;
6. RIK and PIF are still separate — no cross-schema grant in either
   direction;
7. the row counts match the manifest;
8. every `image_ref` in the restored database has a file in the image
   archive.

It drops the scratch database when it finishes (`KEEP_SCRATCH=1` to keep it)
and **never touches the live database**.

Output ends in one of two lines, and only one of them means anything good:

```
VERIFIED: this backup restores to a correct, correctly-privileged database.
NOT VERIFIED: 1 check(s) failed. Do not rely on this backup.
```

### If check 8 fails

`N image_ref values have no file` means the database refers to a photograph
that is not on disk. The shop will show the placeholder picture rather than
breaking, but the data and the disk disagree. Usual causes: the image
directory was moved or restored separately from the database; the backup ran
as a user that could read only part of `PIF_MEDIA_ROOT`; or the rows were
created by a test run against this database. Find them with:

```sql
SELECT sku, name, image_ref FROM pif.products WHERE image_ref IS NOT NULL;
```

Re-upload the photograph on the product's own screen, or clear it there.

---

## 3. Restoring

```bash
ops/esamagri-restore.sh --target esamagri_production /srv/backups/esamagri-…Z
```

The script is deliberately awkward to point at a live system:

* the target must be named explicitly;
* if the target already holds e-Samagri data it **stops** and reports how
  many rows it found. Overwriting needs `--i-have-a-fresh-backup`, spelled
  that way because the first step of restoring into a live database is
  backing up the thing you are about to replace;
* when the target is replaced, the whole database is dropped and recreated,
  so no row of the old data can survive to be mistaken for restored data.

**Three things a dump cannot restore for you**, which the script also prints
when it finishes:

1. **the application roles' passwords** — set them from the yard's own
   secrets store (`ALTER ROLE app_shared WITH PASSWORD '…'`, and the same for
   `app_rik`, `app_pif`, `app_reporting_rik`, `app_reporting_pif`). Until
   this is done those roles exist but cannot authenticate, which is
   fail-closed and intended;
2. **the API's own configuration** — `DATABASE_URL` pointing at the restored
   database, and `JWT_ACCESS_SECRET`, `OTP_HASH_PEPPER` and
   `CORS_ALLOWED_ORIGINS` set to this environment's values. A restored
   database running with another environment's secrets is a silent
   half-migration;
3. **a verification run** — start the API, check `GET /health/ready` reports
   `ready`, then sign in as a RIK administrator and a PIF administrator and
   confirm each sees only their own module.

---

## 4. Incident procedures

### 4.1 A bad deployment, no data loss

Stop the API, put the previous release back, start it, check
`GET /health/ready`. The database is untouched; nothing needs restoring.
If the release included a migration, see 4.3.

### 4.2 Data was corrupted or wrongly bulk-changed

1. **Stop write traffic** — stop the API. Do not try to fix rows under live
   traffic.
2. **Take a backup of the damaged state anyway.** It is evidence, and you
   may need something out of it.
3. **Restore the last verified backup into a NEW database**, not over the
   live one:
   `ops/esamagri-restore.sh --target esamagri_recovered <set>`
4. **Compare** — what is in the restored copy that is missing from the
   damaged one, and the reverse. Decide what has to be carried across.
5. **Cut over** by pointing `DATABASE_URL` at the recovered database, or by
   restoring into the live name once you are satisfied.

A bulk product import that was applied in error is a narrower case. An import
only ever **creates and updates** products; it never deletes one, never takes
one off sale, and never touches ration entitlements. So the damage is bounded
to the catalogue, and
`Catalogue → Import products` shows which file it was, who applied it, when,
and every row it wrote. Correct those products on their own screens, or
re-import the previous spreadsheet. Do not restore the whole database for a
catalogue mistake.

### 4.3 A migration went wrong

The migrations are **forward-only** by design; there are no down-migrations
(the reasoning is in `database/docs/deployment-and-rollback.md`). So:

* **Before go-live**, with no real data: recreate the database and re-run the
  migrations. That is the expected path.
* **After go-live**: restore from backup (4.2), or — if what needs undoing is
  narrow and additive, such as one wrong settings row — write a new, small
  forward migration. Never re-run `0018` wholesale (its ownership and grant
  statements are not idempotent), and never edit a migration that has already
  been applied anywhere.

### 4.4 The images are gone but the database is fine

Extract just the image archives from the newest verified set — one per store:

```bash
tar -xzf <set>/pif-media.tar.gz -C "$PIF_MEDIA_ROOT" \
    --no-overwrite-dir --no-same-owner --no-same-permissions --touch
tar -xzf <set>/rik-media.tar.gz -C "$RIK_MEDIA_ROOT" \
    --no-overwrite-dir --no-same-owner --no-same-permissions --touch
```

Then re-run `ops/esamagri-verify-backup.sh` to confirm every stored key has
a file again.

### 4.5 "The whole server is gone"

1. Provision PostgreSQL 15+ (developed and tested against 16).
2. Create the database roles, or let `roles.sql` do it (`ops/esamagri-restore.sh`
   runs it; `SKIP_ROLES=1` if your managed service forbids `CREATE ROLE` and
   you created them by hand).
3. `ops/esamagri-restore.sh --target esamagri_production <set>`
4. Set the role passwords and the API configuration (§3).
5. Deploy the application, start it, check `GET /health/ready`.
6. Sign in as a RIK administrator and a PIF administrator and confirm the
   module separation holds.

---

## 5. What was actually rehearsed, and when

Recorded so that nobody has to take this document on faith.

| Date (UTC) | What was done | Result |
| --- | --- | --- |
| 2026-10-10 | `esamagri-backup.sh` against the working database (68 tables / 5 views, 95 products, 168 PIF orders, 424 RIK vouchers, 26 image refs) | Backup set written, 1.3 MB, checksums recorded |
| 2026-10-10 | `esamagri-verify-backup.sh` on that set | **Found a real fault**: 16 `image_ref` values with no file on disk, all belonging to automated-test fixture products in that shared database. Checks 1–7 passed; check 8 failed, correctly |
| 2026-10-10 | All 51 migrations applied to an empty database | 68 tables / 5 views / `pif` 23 / 22 permissions / 6 roles / 18 RIK pools / 189 provisions |
| 2026-10-10 | `esamagri-backup.sh` + `esamagri-verify-backup.sh` on that clean database | **All 8 checks passed**, including the privilege and module-isolation checks |
| 2026-10-10 | `esamagri-restore.sh` into a new database | Restored: 168 orders, 424 vouchers, 95 products, 474 customers, 10 image files — matching the source exactly |
| 2026-10-10 | `esamagri-restore.sh` into a database that already held data, **without** the flag | **Refused**, naming the 1,066 rows it would have replaced |
| 2026-10-10 | The same, **with** `--i-have-a-fresh-backup` | Replaced the database as asked |
| 2026-10-10 | `esamagri-backup.sh` run as a user that could not read `PIF_MEDIA_ROOT` | **Failed loudly**, left the partial set as `*.FAILED`, and named the permissions cause |

Two findings from the rehearsal were fixed in the scripts themselves: the
image restore now leaves the destination directory's own ownership and mode
alone (so a restore does not fail over a `chmod` that does not matter), and
it reports any files in the directory that were not in the backup.

---

## 6. Contacts and escalation

Fill in before go-live — a runbook with no names is half a runbook.

| Role | Name | Reachable at |
| --- | --- | --- |
| Application owner (yard) | | |
| Database / server administrator | | |
| Out-of-hours escalation | | |

Record every restore here: date, which backup set, who authorised it, who ran
it, and what the verification said afterwards.
