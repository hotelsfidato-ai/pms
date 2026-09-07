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
# WHAT THIS SCRIPT DOES NOT DO, AND YOU SHOULD KNOW IT:
#
#   It does not put the file anywhere else. A backup on the same disk as the
#   database is not a backup — it is a copy that dies in the same fire. Copying
#   it off-box is one line and it depends on where production lives, which is
#   still an open question (PROGRESS.md, "Still needing a person", item 1).
#
#   It does not schedule itself. That is cron, or the managed provider's own
#   backup, and again depends on the answer to that question.
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
  PGBIN="${PGBIN:-C:/Users/rozar/AppData/Local/Temp/claude/D--PMS-FIDATO/6f5bb0bf-ad16-442f-bd1d-566b371924fa/scratchpad/pg/pgsql/bin}"
  PGDUMP="$PGBIN/pg_dump.exe"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-55432}"
  SUPER="${SUPER:-postgres}"
  SUPERPASS="${SUPERPASS:-pw}"
fi
DB="${DB:-fidato}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OUTDIR="${1:-$ROOT/db/backups}"
mkdir -p "$OUTDIR"

STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUTDIR/${DB}-${STAMP}.dump"

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
PGPASSWORD="$SUPERPASS" "$PGDUMP" \
  -h "$PGHOST" -p "$PGPORT" -U "$SUPER" \
  -Fc --no-owner --no-acl \
  -f "$FILE" "$DB" 2>&1 | sed 's/^/    /'

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

echo "$FILE"
