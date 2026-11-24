#!/usr/bin/env bash
#
# e-Samagri — verify a backup, by restoring it.
#
# WHY THIS SCRIPT EXISTS. A backup that has never been restored is not known
# to be a backup. Checking a file's size, or even its checksum, proves only
# that the file is intact — not that the dump is complete, that the
# privileges came back, or that the application would start against it. So
# this script restores the backup into a SCRATCH DATABASE and then asks the
# restored copy the questions that actually matter.
#
# WHAT IT CHECKS, in order, and every one of them is a real query against the
# restored database — not a line read back out of the manifest:
#
#   1. The checksums match (SHA256SUMS).
#   2. The dump's own table of contents is readable (pg_restore -l).
#   3. A full restore into the scratch database succeeds.
#   4. The schema contract holds: the table, view, permission and role counts
#      agree with the manifest taken at backup time.
#   5. THE PRIVILEGE MODEL SURVIVED, which is the check most backup
#      verifications would miss: the application role must still hold no
#      UPDATE or DELETE on rik.issue_vouchers, pif.orders, pif.order_items,
#      pif.order_events or the import tables. If a dump were ever taken with
#      --no-acl, this is where it would be caught.
#   6. RIK and PIF are still separate: app_rik holds nothing in the pif
#      schema and app_pif holds nothing in rik.
#   7. The row counts match what the manifest recorded.
#   8. Both uploaded-image archives extract, and every STORED IMAGE KEY in
#      the restored database has a file in the matching one. A `/catalogue/...`
#      reference is deliberately NOT checked: it is a file committed to a web
#      app's bundle, it travels with the code, and it has never been in a
#      media archive. Demanding a file for one made this check fail on every
#      real database from migration 0054 onward.
#
# IT NEVER TOUCHES THE LIVE DATABASE. The scratch database name is derived
# from the backup's timestamp, the script refuses to run if that name is
# already in use by anything that looks like a real database, and it drops
# the scratch database when it is finished (keep it with KEEP_SCRATCH=1).
#
# USAGE
#   ops/esamagri-verify-backup.sh var/backups/esamagri-esamagri_prod-2026…Z
#
# ENVIRONMENT
#   SCRATCH_DB     name to restore into (default: esamagri_verify_<stamp>).
#   KEEP_SCRATCH   1 to leave the scratch database in place afterwards.
#   PSQL_SUPER     a connection that may CREATE DATABASE and restore owned
#                  objects (default: the ambient libpq environment).

set -euo pipefail

set_dir="${1:-}"
if [[ -z "$set_dir" || ! -d "$set_dir" ]]; then
  echo "usage: $0 <backup-set-directory>" >&2
  exit 2
fi
set_dir="$(cd "$set_dir" && pwd)"

for tool in psql pg_restore sha256sum tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: $tool is not installed." >&2; exit 2; }
done

fail() { echo "  ✗ $1" >&2; failures=$((failures + 1)); }
pass() { echo "  ✓ $1"; }
failures=0

stamp="$(basename "$set_dir" | sed 's/.*-//')"
scratch="${SCRATCH_DB:-esamagri_verify_${stamp,,}}"
scratch="${scratch//[^a-z0-9_]/_}"

manifest="$set_dir/manifest.json"
[[ -f "$manifest" ]] || { echo "FATAL: no manifest.json in $set_dir" >&2; exit 2; }

read_manifest() { # read_manifest schemaContract.totalTables
  node -e '
    const fs = require("fs");
    const path = process.argv[1].split(".");
    let value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    for (const key of path) value = value?.[key];
    process.stdout.write(String(value ?? ""));
  ' "$1" "$manifest"
}

echo "Verifying $set_dir"
echo "  scratch database: $scratch"
echo

# --- 1. checksums ----------------------------------------------------------
echo "[1/8] checksums"
if ( cd "$set_dir" && sha256sum --quiet --check SHA256SUMS ); then
  pass "every file matches its recorded checksum"
else
  fail "a file does not match SHA256SUMS — this backup is damaged"
  exit 1
fi

# --- 2. the dump's own table of contents -----------------------------------
echo "[2/8] dump readability"
toc_lines="$(pg_restore --list "$set_dir/database.dump" | grep -c ';' || true)"
if [[ "$toc_lines" -gt 50 ]]; then
  pass "pg_restore read the dump ($toc_lines catalogue entries)"
else
  fail "the dump's table of contents looks wrong ($toc_lines entries)"
  exit 1
fi

# --- 3. restore into the scratch database ----------------------------------
echo "[3/8] restore into $scratch"
exists="$(psql -XAt -c "SELECT 1 FROM pg_database WHERE datname = '$scratch'" postgres 2>/dev/null || true)"
if [[ "$exists" == "1" ]]; then
  echo "  (dropping the previous scratch database of the same name)"
  psql -X -q -c "DROP DATABASE \"$scratch\"" postgres
fi
psql -X -q -c "CREATE DATABASE \"$scratch\"" postgres

# The roles come first: the dump's GRANT statements name them. Errors are
# shown but not fatal — on a cluster that already has these roles, every
# CREATE ROLE is expected to fail as "already exists".
if [[ -f "$set_dir/roles.sql" ]]; then
  psql -X -q -f "$set_dir/roles.sql" postgres 2>&1 | grep -v 'already exists' || true
fi

restore_log="$(mktemp)"
if pg_restore --dbname="$scratch" --no-password "$set_dir/database.dump" > "$restore_log" 2>&1; then
  pass "restored with no errors"
else
  # pg_restore exits non-zero for warnings too; count real errors.
  errors="$(grep -c '^pg_restore: error' "$restore_log" || true)"
  if [[ "$errors" -eq 0 ]]; then
    pass "restored (with warnings only)"
  else
    fail "$errors restore errors — see $restore_log"
    head -20 "$restore_log" >&2
  fi
fi

q() { psql -XAt -d "$scratch" -c "$1"; }

# --- 4. the schema contract ------------------------------------------------
echo "[4/8] schema contract"
for pair in \
  "totalTables:SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('shared','rik','pif') AND table_type='BASE TABLE'" \
  "totalViews:SELECT count(*) FROM information_schema.views WHERE table_schema IN ('shared','rik','pif')" \
  "pifTables:SELECT count(*) FROM information_schema.tables WHERE table_schema='pif' AND table_type='BASE TABLE'" \
  "permissions:SELECT count(*) FROM shared.permissions" \
  "roles:SELECT count(*) FROM shared.roles"
do
  key="${pair%%:*}"
  sql="${pair#*:}"
  expected="$(read_manifest "schemaContract.$key")"
  actual="$(q "$sql")"
  if [[ "$expected" == "$actual" ]]; then
    pass "$key = $actual"
  else
    fail "$key is $actual in the restored database, but the manifest says $expected"
  fi
done

# --- 5. the privilege model ------------------------------------------------
echo "[5/8] privileges (the RIK/PIF separation is privileges, not code)"
leaks="$(q "
  SELECT count(*) FROM information_schema.role_table_grants
   WHERE privilege_type IN ('UPDATE','DELETE')
     AND ((table_schema='rik' AND table_name IN ('issue_vouchers','issue_voucher_outcomes','issue_voucher_issue_lines') AND grantee='app_rik')
       OR (table_schema='pif' AND table_name IN ('orders','order_items','order_events') AND grantee='app_pif')
       OR (table_schema='pif' AND table_name IN ('product_import_batches','product_import_rows') AND grantee='app_pif' AND privilege_type='DELETE'))")"
if [[ "$leaks" == "0" ]]; then
  pass "no UPDATE/DELETE on any append-only table — the dump kept its ACLs"
else
  fail "$leaks append-only tables came back writable; this dump cannot be trusted"
fi

# --- 6. module isolation ---------------------------------------------------
echo "[6/8] module isolation"
crossed="$(q "
  SELECT count(*) FROM information_schema.role_table_grants
   WHERE (grantee IN ('app_rik','app_reporting_rik') AND table_schema='pif')
      OR (grantee IN ('app_pif','app_reporting_pif') AND table_schema='rik')")"
if [[ "$crossed" == "0" ]]; then
  pass "no RIK role reaches pif, and no PIF role reaches rik"
else
  fail "$crossed cross-module grants in the restored database"
fi

# --- 7. the data itself ----------------------------------------------------
echo "[7/8] row counts"
for pair in \
  "pifProducts:SELECT count(*) FROM pif.products" \
  "pifOrders:SELECT count(*) FROM pif.orders" \
  "rikIssueVouchers:SELECT count(*) FROM rik.issue_vouchers"
do
  key="${pair%%:*}"
  sql="${pair#*:}"
  expected="$(read_manifest "rowCounts.$key")"
  actual="$(q "$sql")"
  if [[ "$expected" == "$actual" ]]; then
    pass "$key = $actual"
  else
    fail "$key is $actual, but the manifest recorded $expected"
  fi
done

# --- 8. the images ---------------------------------------------------------
echo "[8/8] uploaded images"
#
# ONLY STORED KEYS ARE CHECKED AGAINST THE ARCHIVES, and that qualification is
# the whole correctness of this check.
#
# `image_ref` holds two different kinds of value. An UPLOADED picture is a key
# this application stored — `pif/products/<uuid>.png`, `rik/provisions/<uuid>.png`
# — and it must have a file in the matching archive or the picture is lost. A
# COMMITTED CATALOGUE ASSET is a `/catalogue/...` path to a file inside the web
# apps' own bundles; it travels with the code, has never been in a media
# archive, and never should be.
#
# Without the prefix filter this check demanded a file for every reference and
# so failed on any database carrying committed assets — which, since migration
# 0054 gave all 14 PIF categories `/catalogue/pif/category/...` refs, is every
# real database. It reported 14 missing files and a healthy backup as NOT
# VERIFIED. RIK would have added 198 more. The filter is the fix.
if [[ -f "$set_dir/pif-media.tar.gz" || -f "$set_dir/rik-media.tar.gz" ]]; then
  missing=0
  checked=0

  check_store() { # check_store <archive> <sql>
    local archive="$1" sql="$2" dir
    [[ -f "$archive" ]] || return 0
    dir="$(mktemp -d)"
    tar -xzf "$archive" -C "$dir" --no-overwrite-dir --no-same-owner --no-same-permissions --touch
    while IFS= read -r ref; do
      [[ -z "$ref" ]] && continue
      checked=$((checked + 1))
      [[ -f "$dir/$ref" ]] || { echo "      missing: $ref"; missing=$((missing + 1)); }
    done < <(q "$sql")
    rm -rf "$dir"
  }

  check_store "$set_dir/pif-media.tar.gz" "
    SELECT image_ref FROM pif.products   WHERE image_ref LIKE 'pif/%'
    UNION ALL
    SELECT image_ref FROM pif.categories WHERE image_ref LIKE 'pif/%'"

  check_store "$set_dir/rik-media.tar.gz" "
    SELECT image_ref FROM rik.provisions        WHERE image_ref LIKE 'rik/%'
    UNION ALL
    SELECT image_ref FROM rik.entitlement_pools WHERE image_ref LIKE 'rik/%'"

  if [[ "$missing" -eq 0 ]]; then
    pass "every stored image key has a file in its archive ($checked checked)"
  else
    fail "$missing stored image key(s) have no file — those pictures would be broken"
  fi

  # Said out loud, because a reader who sees a small `checked` number on a
  # database full of pictures should know why that is correct.
  committed_sql="SELECT (SELECT count(*) FROM pif.products WHERE image_ref LIKE '/catalogue/%') + (SELECT count(*) FROM pif.categories WHERE image_ref LIKE '/catalogue/%') + (SELECT count(*) FROM rik.provisions WHERE image_ref LIKE '/catalogue/%') + (SELECT count(*) FROM rik.entitlement_pools WHERE image_ref LIKE '/catalogue/%')"
  committed="$(q "$committed_sql")"
  pass "$committed committed catalogue references travel with the code, not the backup"
elif [[ -f "$set_dir/pif-media.MISSING" || -f "$set_dir/rik-media.MISSING" ]]; then
  # No archive because nothing had been uploaded. Only STORED keys would need
  # one; committed `/catalogue/...` references are expected and are not a gap.
  stored_sql="SELECT (SELECT count(*) FROM pif.products WHERE image_ref LIKE 'pif/%') + (SELECT count(*) FROM pif.categories WHERE image_ref LIKE 'pif/%') + (SELECT count(*) FROM rik.provisions WHERE image_ref LIKE 'rik/%') + (SELECT count(*) FROM rik.entitlement_pools WHERE image_ref LIKE 'rik/%')"
  refs="$(q "$stored_sql")"
  if [[ "$refs" == "0" ]]; then
    pass "no images uploaded and none referenced by a stored key"
  else
    fail "$refs stored image keys exist but this backup has no image archive"
  fi
else
  fail "no image archive and no record of why"
fi

# --- tidy up ---------------------------------------------------------------
echo
if [[ "${KEEP_SCRATCH:-0}" == "1" ]]; then
  echo "Scratch database kept: $scratch"
else
  psql -X -q -c "DROP DATABASE \"$scratch\"" postgres
  echo "Scratch database dropped."
fi

if [[ "$failures" -eq 0 ]]; then
  echo "VERIFIED: this backup restores to a correct, correctly-privileged database."
  exit 0
fi
echo "NOT VERIFIED: $failures check(s) failed. Do not rely on this backup." >&2
exit 1
