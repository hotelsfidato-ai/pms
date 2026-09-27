#!/usr/bin/env bash
# =============================================================================
# backup.sh — take a backup
# =============================================================================
#   ./db/backup.sh                      write to db/backups/
#   ./db/backup.sh /mnt/somewhere       write there instead
#
# Custom format (-Fc), not plain SQL. Three reasons, in order of how much they
# matter at 03:00 on the day you need it:
#
#   · pg_restore can pull ONE table out of it. Plain SQL is all-or-nothing,
#     and "we lost the folio_postings table" is a far more likely disaster
#     than "we lost the server".
#   · it is compressed, so nobody is tempted to skip a night because the disk
#     is filling up
#   · it restores in parallel
#
# OFF THE BOX. A backup on the same disk as the database is not a backup — it
#   is a copy that dies in the same fire. When the server's settings file names
#   a bucket (BACKUP_UPLOAD_URL, below), every file is also copied there, and a
#   copy that did not arrive intact fails the backup. Without it, it says so.
#
# WHAT THIS SCRIPT DOES NOT DO, AND YOU SHOULD KNOW IT:
#
#   It does not schedule itself, and it does not tell anyone. Cron runs
#   db/verify-backup.sh nightly, which runs this, restores the result, and
#   reports pass or fail to a person (deploy/launch.sh, "Backups").
#
#   It is not a backup until db/verify-backup.sh has restored it. Run that.
# =============================================================================
set -uo pipefail

# WHICH pg_dump, AND WHERE IT LISTENS
#
# This script runs in two places that share nothing: a Windows
# development box with a throwaway cluster on a high port, and the
# server, where cron runs it nightly against the unix socket.
#
# It used to hardcode the Windows path and `pg_dump.exe`. Installed on
# the server as /usr/local/bin/fidato-backup it therefore failed EVERY
# NIGHT, exited 1, and wrote into a log file nobody reads. A backup that
# silently does not exist is worse than none, because you stop worrying
# about it. Detect rather than assume.
if command -v pg_dump >/dev/null 2>&1; then
  PGDUMP="$(command -v pg_dump)"
  PGHOST="${PGHOST:-/var/run/postgresql}"   # socket: peer auth, no password
  PGPORT="${PGPORT:-5432}"
  SUPER="${SUPER:-postgres}"
  SUPERPASS="${SUPERPASS:-}"
else
  PGBIN="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}"
  PGDUMP="$PGBIN/pg_dump.exe"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-55432}"
  SUPER="${SUPER:-postgres}"
  SUPERPASS="${SUPERPASS:-pw}"
fi
DB="${DB:-fidato}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── --portable ───────────────────────────────────────────────────────────────
# A DUMP ONLY RESTORES FORWARDS. pg_dump 17 writes a file header that
# pg_restore 16 refuses outright:
#
#     pg_restore: error: unsupported version (1.16) in file header
#
# Found moving a real property from a laptop running 17.6 onto a server
# running 16 -- which is the one journey this script exists to make. The
# default custom format is smaller and restores faster, and is right between
# machines on the same major version. It is useless between different ones,
# and the error says nothing about a version being the problem.
#
# --portable writes plain SQL and strips the single line an older server
# rejects: SET transaction_timeout, a parameter added in PostgreSQL 17.
# Everything else this schema emits -- tables, functions, row level security,
# triggers, partial indexes -- has been valid since 13.
#
# Restore it with psql, NOT pg_restore:
#     psql -d fidato -f the-file.sql
PORTABLE=""
if [ "${1:-}" = "--portable" ]; then
  PORTABLE=1
  shift
fi

OUTDIR="${1:-$ROOT/db/backups}"
mkdir -p "$OUTDIR"

STAMP=$(date +%Y%m%d-%H%M%S)
if [ -n "$PORTABLE" ]; then
  FILE="$OUTDIR/${DB}-${STAMP}.sql"
else
  FILE="$OUTDIR/${DB}-${STAMP}.dump"
fi

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }

if [ ! -x "$PGDUMP" ]; then
  red "  x no pg_dump at $PGDUMP - NOT a backup."
  exit 1
fi

echo "-- backing up $DB ------------------------------------------"

# --no-owner / --no-acl: the dump restores into a database whose roles may not
# exist yet. Ownership and grants come from db/migrations/010_roles.sql, which
# is the one place that should ever define them — a dump that carried its own
# would silently diverge from the migrations after the first schema change.
if [ -n "$PORTABLE" ]; then
  PGPASSWORD="$SUPERPASS" "$PGDUMP" \
    -h "$PGHOST" -p "$PGPORT" -U "$SUPER" \
    -Fp --no-owner --no-acl "$DB" \
    | grep -v "^SET transaction_timeout = " > "$FILE"
else
PGPASSWORD="$SUPERPASS" "$PGDUMP" \
  -h "$PGHOST" -p "$PGPORT" -U "$SUPER" \
  -Fc --no-owner --no-acl \
  -f "$FILE" "$DB" 2>&1 | sed 's/^/    /'
fi

if [ ! -s "$FILE" ]; then
  red "  x pg_dump produced nothing. NOT a backup."
  exit 1
fi

SIZE=$(du -k "$FILE" | cut -f1)
green "  ✓ $(basename "$FILE")  (${SIZE} KB)"

# Retention. Keep the last 14; a fortnight is long enough to notice a
# corruption that only shows up in a monthly report, and short enough that
# nobody turns the job off because the disk filled.
KEEP=14
COUNT=$(ls -1 "$OUTDIR"/${DB}-*.dump 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1t "$OUTDIR"/${DB}-*.dump | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old"
    echo "    pruned $(basename "$old")"
  done
fi

# ── Off the box (D27-15, the owner, 27 September) ────────────────────────────
# Where it goes is the server's own setting, in a file written by root and
# readable by postgres alone, because the link in it lets whoever holds it
# write into the bucket:
#
#   BACKUP_UPLOAD_URL='https://…/p/<token>/n/<namespace>/b/<bucket>/o/'
#       an Oracle Object Storage pre-authenticated request on the whole
#       bucket, "Permit object writes" only. It can add files and cannot
#       read, list or delete them, so a break-in on this box cannot reach
#       back and empty the bucket (versioning keeps anything overwritten).
#
# Content-MD5 makes Object Storage hash what arrived and refuse it with a 400
# if it differs from what left, so a success here means the bytes match.
# Failing to copy FAILS THE BACKUP: the local file is fine, the thing this
# step exists for is not, and the nightly check must tell a person.
#
# ⚠ THE STATUS CODE, NOT curl's EXIT CODE. With --retry and an upload, curl
# 8.14 exited 0 on a 400 — a refused copy read as a good one, found testing
# this against a bucket that refuses. Only a 200 is a copy.
BACKUP_ENV="${BACKUP_ENV:-/etc/fidato-backup.env}"
[ -r "$BACKUP_ENV" ] && . "$BACKUP_ENV"
if [ -n "${BACKUP_UPLOAD_URL:-}" ]; then
  MD5=$(openssl dgst -md5 -binary "$FILE" | base64)
  CODE=$(curl -sS --retry 3 -m 900 -o /dev/null -w "%{http_code}" \
           -H "Content-MD5: $MD5" -T "$FILE" \
           "${BACKUP_UPLOAD_URL%/}/$(basename "$FILE")")
  if [ "$CODE" = "200" ]; then
    green "  ✓ copied off the box, checksum matched"
  else
    red "  x the copy off the box FAILED (HTTP $CODE). The file on this disk"
    red "    is fine; the copy that survives this disk does not exist."
    exit 1
  fi
else
  echo "    (no BACKUP_UPLOAD_URL - this copy is on this disk only)"
fi

echo "$FILE"
