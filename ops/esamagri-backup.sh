#!/usr/bin/env bash
#
# e-Samagri — take a complete, verifiable backup.
#
# WHAT A COMPLETE BACKUP OF THIS APPLICATION IS. Three things, and a backup
# missing any one of them cannot restore a working system:
#
#   1. THE DATABASE, as a custom-format dump that KEEPS OWNERSHIP AND
#      PRIVILEGES. This matters more here than in most applications: the
#      whole RIK/PIF separation is privileges (migration 0018 onward), and
#      the status spines depend on the application role holding INSERT but
#      not UPDATE. A dump taken with --no-owner/--no-acl would restore a
#      database in which the application could rewrite history. So this
#      script does NOT pass those flags, and the verification step checks
#      that the privileges came back.
#   2. THE DATABASE ROLES. The login roles (app_shared, app_rik, app_pif,
#      the two reporting roles) and the group roles live in the CLUSTER, not
#      in the database, so a database dump alone restores tables that grant
#      privileges to roles that do not exist. `pg_dumpall --roles-only`
#      captures them. Passwords come across as hashes; if your secrets
#      process rotates them, that is still the source of truth.
#   3. THE UPLOADED IMAGES, from BOTH media stores. These are files on disk —
#      PIF product and category photographs under PIF_MEDIA_ROOT, and RIK
#      provision photographs under RIK_MEDIA_ROOT — each referenced by an
#      `image_ref` in the database. Restore the database without them and
#      every uploaded photograph is a broken picture.
#
#      The two stores are separate directories on purpose, so either can be
#      moved or restored without disturbing the other, and they are archived
#      separately for the same reason. A reference beginning `/catalogue/` is
#      NOT in either store: those are files committed to the web apps'
#      bundles, they travel with the code, and nothing here needs to capture
#      them.
#
# WHAT IT ALSO WRITES, and why. A manifest recording the schema contract as
# it stood (table, view, permission and role counts), the application
# version, the PostgreSQL version and the exact file names, plus a
# SHA256SUMS file. A backup nobody has verified is a hope, not a backup —
# `esamagri-verify-backup.sh` reads both.
#
# USAGE
#   ops/esamagri-backup.sh                      # uses DATABASE_URL / PG* env
#   DATABASE_URL=postgresql://... ops/esamagri-backup.sh
#   BACKUP_DIR=/srv/backups ops/esamagri-backup.sh
#
# ENVIRONMENT
#   DATABASE_URL      libpq URL of the database to back up. If unset, the
#                     usual PGHOST/PGUSER/PGDATABASE variables are used.
#   BACKUP_DIR        where to write (default: var/backups).
#   PIF_MEDIA_ROOT    uploaded images directory
#                     (default: apps/api/var/pif-media).
#   RETAIN_DAYS       delete backup SETS older than this many days
#                     (default: 30; set to 0 to keep everything).
#
# EXIT STATUS. Non-zero on any failure, and a partial backup directory is
# renamed with a `.FAILED` suffix rather than left looking complete.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_root="${BACKUP_DIR:-$here/var/backups}"
media_root="${PIF_MEDIA_ROOT:-$here/apps/api/var/pif-media}"
rik_media_root="${RIK_MEDIA_ROOT:-$here/apps/api/var/rik-media}"
retain_days="${RETAIN_DAYS:-30}"

for tool in pg_dump pg_dumpall psql sha256sum tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: $tool is not installed." >&2; exit 2; }
done

# --- where the database is -------------------------------------------------
psql_args=()
dump_args=()
if [[ -n "${DATABASE_URL:-}" ]]; then
  psql_args+=("$DATABASE_URL")
  dump_args+=("--dbname=$DATABASE_URL")
fi

db_name="$(psql "${psql_args[@]}" -XAt -c 'SELECT current_database()')"
server_version="$(psql "${psql_args[@]}" -XAt -c 'SHOW server_version')"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
set_dir="$backup_root/esamagri-$db_name-$stamp"

cleanup_on_failure() {
  if [[ -d "$set_dir" ]]; then
    mv "$set_dir" "$set_dir.FAILED"
    echo "FAILED: incomplete backup left at $set_dir.FAILED" >&2
    echo >&2
    echo "If it failed on the images: the API writes them as mode 0640 owned by" >&2
    echo "the user it runs as, so this script must run as that user (or root)," >&2
    echo "not as a database user that cannot read $media_root." >&2
  fi
}
trap cleanup_on_failure ERR

mkdir -p "$set_dir"
echo "e-Samagri backup -> $set_dir"

# --- 1. the database -------------------------------------------------------
# -Fc  custom format: compressed, and selectively restorable.
# No --no-owner and no --no-acl, deliberately: see the header.
echo "  [1/4] database ($db_name)…"
pg_dump "${dump_args[@]}" --format=custom --compress=6 \
  --file="$set_dir/database.dump"

# --- 2. the cluster's roles ------------------------------------------------
#
# Run this as a role that may read pg_authid (the cluster's superuser, or a
# role with pg_read_all_settings/REPLICATION on managed services) if you want
# the password hashes in the file; a lesser role still captures the roles and
# their memberships, which is what the grants need, and the passwords then
# come from your own secrets process at restore time.
echo "  [2/4] roles…"
if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dumpall --dbname="$DATABASE_URL" --roles-only > "$set_dir/roles.sql"
else
  pg_dumpall --roles-only > "$set_dir/roles.sql"
fi

# --- 3. the uploaded images ------------------------------------------------
if [[ -d "$media_root" ]]; then
  echo "  [3/4] uploaded PIF images ($media_root)…"
  tar -czf "$set_dir/pif-media.tar.gz" -C "$media_root" .
else
  echo "  [3/4] uploaded PIF images: none at $media_root (recording that fact)"
  : > "$set_dir/pif-media.MISSING"
fi

# The RIK store, archived separately so either can be restored alone. An
# absent directory is the ordinary state until the first provision picture is
# uploaded, and is recorded as a fact rather than treated as a failure.
if [[ -d "$rik_media_root" ]]; then
  echo "        uploaded RIK images ($rik_media_root)…"
  tar -czf "$set_dir/rik-media.tar.gz" -C "$rik_media_root" .
else
  echo "        uploaded RIK images: none at $rik_media_root (recording that fact)"
  : > "$set_dir/rik-media.MISSING"
fi

# --- 4. the manifest -------------------------------------------------------
echo "  [4/4] manifest…"
read -r tables views pif_tables permissions roles_count products orders vouchers <<<"$(
  psql "${psql_args[@]}" -XAt -F' ' -c "
    SELECT (SELECT count(*) FROM information_schema.tables
             WHERE table_schema IN ('shared','rik','pif') AND table_type='BASE TABLE'),
           (SELECT count(*) FROM information_schema.views
             WHERE table_schema IN ('shared','rik','pif')),
           (SELECT count(*) FROM information_schema.tables
             WHERE table_schema='pif' AND table_type='BASE TABLE'),
           (SELECT count(*) FROM shared.permissions),
           (SELECT count(*) FROM shared.roles),
           (SELECT count(*) FROM pif.products),
           (SELECT count(*) FROM pif.orders),
           (SELECT count(*) FROM rik.issue_vouchers)"
)"

app_version="$(node -e 'process.stdout.write(require("'"$here"'/package.json").version || "unknown")' 2>/dev/null || echo unknown)"

cat > "$set_dir/manifest.json" <<JSON
{
  "application": "e-Samagri",
  "applicationVersion": "$app_version",
  "takenAtUtc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "$db_name",
  "postgresVersion": "$server_version",
  "schemaContract": {
    "totalTables": $tables,
    "totalViews": $views,
    "pifTables": $pif_tables,
    "permissions": $permissions,
    "roles": $roles_count
  },
  "rowCounts": {
    "pifProducts": $products,
    "pifOrders": $orders,
    "rikIssueVouchers": $vouchers
  },
  "files": {
    "database": "database.dump",
    "roles": "roles.sql",
    "media": "pif-media.tar.gz",
    "rikMedia": "rik-media.tar.gz"
  }
}
JSON

( cd "$set_dir" && sha256sum ./* > SHA256SUMS )

trap - ERR

# --- retention -------------------------------------------------------------
# Only ever deletes directories matching this application's own naming
# pattern, inside BACKUP_DIR, and never the set just written.
if [[ "$retain_days" -gt 0 ]]; then
  while IFS= read -r -d '' old; do
    [[ "$old" == "$set_dir" ]] && continue
    echo "  retention: removing $old"
    rm -rf "$old"
  done < <(find "$backup_root" -maxdepth 1 -type d -name "esamagri-${db_name}-*" \
             -mtime "+$retain_days" -print0 2>/dev/null)
fi

echo
echo "Backup complete: $set_dir"
echo "  $(du -sh "$set_dir" | cut -f1) on disk"
echo
echo "NEXT, and not optional: verify it."
echo "  ops/esamagri-verify-backup.sh \"$set_dir\""
