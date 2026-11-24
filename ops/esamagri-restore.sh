#!/usr/bin/env bash
#
# e-Samagri — restore a backup into a named database.
#
# THIS SCRIPT IS DELIBERATELY AWKWARD TO POINT AT A LIVE SYSTEM. A restore
# overwrites data, and the one thing a recovery tool must never do is make
# that easy to do by accident:
#
#   * the target database must be named explicitly, with --target;
#   * if the target already contains e-Samagri data, the script STOPS and
#     tells you what it found. Overwriting it needs --i-have-a-fresh-backup,
#     which is spelled that way on purpose, because the first step of any
#     restore into a live database is a fresh backup of the thing you are
#     about to replace;
#   * nothing is dropped unless the target is being replaced, in which case
#     the whole database is dropped and recreated, so no row of the old data
#     can survive to be mistaken for restored data.
#
# WHAT IT RESTORES. All three parts of a backup set: the cluster roles (so
# the grants in the dump have something to grant to), the database itself
# WITH its ownership and privileges, and the uploaded product images.
#
# AFTER IT FINISHES it tells you the three things a human still has to do —
# the application's own connection secrets, the bootstrap credential, and a
# verification run — because none of them can be inferred from a dump.
#
# USAGE
#   ops/esamagri-restore.sh --target esamagri_production var/backups/esamagri-…
#   ops/esamagri-restore.sh --target esamagri_staging --i-have-a-fresh-backup var/backups/…
#
# ENVIRONMENT
#   PIF_MEDIA_ROOT   where to restore the images to
#                    (default: apps/api/var/pif-media).
#   SKIP_ROLES=1     do not attempt the roles file (managed services often
#                    forbid CREATE ROLE; create the roles by hand first).

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
media_root="${PIF_MEDIA_ROOT:-$here/apps/api/var/pif-media}"
rik_media_root="${RIK_MEDIA_ROOT:-$here/apps/api/var/rik-media}"

target=""
force=0
set_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target="${2:-}"; shift 2 ;;
    --i-have-a-fresh-backup) force=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) set_dir="$1"; shift ;;
  esac
done

if [[ -z "$target" || -z "$set_dir" || ! -d "$set_dir" ]]; then
  echo "usage: $0 --target <database> [--i-have-a-fresh-backup] <backup-set-directory>" >&2
  exit 2
fi
set_dir="$(cd "$set_dir" && pwd)"
[[ -f "$set_dir/database.dump" ]] || { echo "FATAL: no database.dump in $set_dir" >&2; exit 2; }

for tool in psql pg_restore tar sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: $tool is not installed." >&2; exit 2; }
done

echo "e-Samagri restore"
echo "  from: $set_dir"
echo "  into: $target"
echo

# --- the backup must be intact before anything is touched ------------------
if [[ -f "$set_dir/SHA256SUMS" ]]; then
  ( cd "$set_dir" && sha256sum --quiet --check SHA256SUMS ) \
    || { echo "FATAL: this backup set fails its own checksums. Nothing was changed." >&2; exit 1; }
  echo "  checksums: OK"
fi

# --- refuse to flatten a live database by accident -------------------------
exists="$(psql -XAt -c "SELECT 1 FROM pg_database WHERE datname = '$target'" postgres 2>/dev/null || true)"
if [[ "$exists" == "1" ]]; then
  rows="$(psql -XAt -d "$target" -c "
    SELECT coalesce(sum(n), 0) FROM (
      SELECT (SELECT count(*) FROM pif.orders) AS n
      UNION ALL SELECT (SELECT count(*) FROM rik.issue_vouchers)
      UNION ALL SELECT (SELECT count(*) FROM shared.customers)
    ) t" 2>/dev/null || echo 0)"
  if [[ "${rows:-0}" -gt 0 && "$force" -ne 1 ]]; then
    cat >&2 <<MSG
STOPPED. "$target" already holds e-Samagri data ($rows rows across orders,
vouchers and customers). Restoring would replace all of it.

If that is genuinely what you intend:
  1. Back up what is there now:  ops/esamagri-backup.sh
  2. Re-run this command with --i-have-a-fresh-backup
MSG
    exit 1
  fi
  echo "  dropping and recreating $target…"
  psql -X -q -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                  WHERE datname = '$target' AND pid <> pg_backend_pid()" postgres >/dev/null
  psql -X -q -c "DROP DATABASE \"$target\"" postgres
fi
psql -X -q -c "CREATE DATABASE \"$target\"" postgres

# --- 1. roles --------------------------------------------------------------
if [[ "${SKIP_ROLES:-0}" != "1" && -f "$set_dir/roles.sql" ]]; then
  echo "  [1/3] roles…"
  psql -X -q -f "$set_dir/roles.sql" postgres 2>&1 | grep -v 'already exists' || true
else
  echo "  [1/3] roles: skipped"
fi

# --- 2. the database -------------------------------------------------------
echo "  [2/3] database…"
log="$(mktemp)"
if ! pg_restore --dbname="$target" --no-password "$set_dir/database.dump" > "$log" 2>&1; then
  errors="$(grep -c '^pg_restore: error' "$log" || true)"
  if [[ "$errors" -gt 0 ]]; then
    echo "FATAL: $errors restore errors. Full log: $log" >&2
    head -20 "$log" >&2
    exit 1
  fi
fi

# --- 3. the images ---------------------------------------------------------
if [[ -f "$set_dir/pif-media.tar.gz" ]]; then
  echo "  [3/3] uploaded images -> $media_root…"
  mkdir -p "$media_root"
  # tar replaces a file of the same name by default, which is what a
  # restore should do.
  # --no-overwrite-dir leave the destination directory's own ownership and
  #                   mode as the environment set them — only the files
  #                   inside it are being restored.
  # --no-same-owner
  # --no-same-permissions
  # --touch           do not try to restore ownership, modes or timestamps:
  #                   the
  #                   restoring user is often not the user that took the
  #                   backup, and failing on that would abort a restore for
  #                   a reason that does not matter.
  if ! tar -xzf "$set_dir/pif-media.tar.gz" -C "$media_root" \
        --no-overwrite-dir --no-same-owner --no-same-permissions --touch; then
    cat >&2 <<MSG
FATAL: the database was restored, but the images could not be written to
  $media_root

This is almost always a permissions problem: the API writes uploaded images
as mode 0640 owned by the user the API runs as, so the restore must run as
that user (or as root). Fix the permissions and re-run just this step:

  tar -xzf "$set_dir/pif-media.tar.gz" -C "$media_root" --no-overwrite-dir --no-same-owner --no-same-permissions --touch
MSG
    exit 1
  fi

  # A restore replaces the archive's files but cannot know about files the
  # directory already held. Those are either harmless orphans from the
  # environment's own history or a sign that this is the wrong media
  # directory, and either way the operator should be told the number.
  archived="$(tar -tzf "$set_dir/pif-media.tar.gz" | grep -c '[^/]$' || true)"
  present="$(find "$media_root" -type f | wc -l)"
  if [[ "$present" -gt "$archived" ]]; then
    echo "      note: $((present - archived)) file(s) in $media_root were not in this backup."
    echo "      They were left in place. Check they belong to this environment."
  fi
else
  echo "  [3/3] uploaded PIF images: none in this backup"
fi

# The RIK store. A backup set taken before provision pictures existed has no
# RIK archive at all, which is reported rather than treated as an error — an
# older set must stay restorable.
if [[ -f "$set_dir/rik-media.tar.gz" ]]; then
  echo "        uploaded RIK images -> $rik_media_root…"
  mkdir -p "$rik_media_root"
  if ! tar -xzf "$set_dir/rik-media.tar.gz" -C "$rik_media_root" \
        --no-overwrite-dir --no-same-owner --no-same-permissions --touch; then
    cat >&2 <<MSG
FATAL: the database was restored, but the RIK images could not be written to
  $rik_media_root

This is almost always a permissions problem: the API writes uploaded images
as mode 0640 owned by the user the API runs as, so the restore must run as
that user (or as root). Fix the permissions and re-run just this step:

  tar -xzf "$set_dir/rik-media.tar.gz" -C "$rik_media_root" --no-overwrite-dir --no-same-owner --no-same-permissions --touch
MSG
    exit 1
  fi
  rik_archived="$(tar -tzf "$set_dir/rik-media.tar.gz" | grep -c '[^/]$' || true)"
  rik_present="$(find "$rik_media_root" -type f | wc -l)"
  if [[ "$rik_present" -gt "$rik_archived" ]]; then
    echo "      note: $((rik_present - rik_archived)) file(s) in $rik_media_root were not in this backup."
    echo "      They were left in place. Check they belong to this environment."
  fi
elif [[ -f "$set_dir/rik-media.MISSING" ]]; then
  echo "        uploaded RIK images: none were stored when this backup was taken"
else
  echo "        uploaded RIK images: not in this backup set (taken before provision pictures existed)"
fi

echo
echo "Restored into \"$target\"."
cat <<'NEXT'

THREE THINGS A DUMP CANNOT RESTORE FOR YOU:

  1. The application roles' PASSWORDS. If the roles file was written by a
     role that could not read pg_authid, the login roles exist but cannot
     authenticate. Set them from your own secrets store:
       ALTER ROLE app_shared WITH PASSWORD '…';   -- and app_rik, app_pif,
                                                  -- app_reporting_rik,
                                                  -- app_reporting_pif
  2. The API's own configuration. Point DATABASE_URL at this database, and
     check JWT_ACCESS_SECRET, OTP_HASH_PEPPER and CORS_ALLOWED_ORIGINS are
     the values this environment should use — a restored database with the
     previous environment's secrets is a silent half-migration.
  3. A VERIFICATION RUN. Start the API and check GET /health/ready reports
     "ready" with the expected table and view counts, then sign in as a
     RIK administrator and a PIF administrator and confirm each sees only
     their own module.
NEXT
