#!/usr/bin/env bash
# =============================================================================
# base-backup.sh — the weekly base copy for restore to any minute (D27-373, A3)
# =============================================================================
# Installed by launch.sh as /usr/local/bin/fidato-base-backup. Cron runs it
# as `postgres` on Sundays (deploy/README.md, "Restore to any minute"), into
# the nightly backup's log:
#
#   /usr/local/bin/fidato-base-backup >> /var/log/fidato-backup.log 2>&1
#
# A restore to a minute starts from a base copy and replays the archived
# journal (db/wal.sh) after it. This takes one with pg_basebackup (the whole
# server's files, compressed, with the journal it needs to be consistent on
# its own), packs it into ONE file and copies it to
#   <BACKUP_UPLOAD_URL>/base/base-<UTC stamp>.tar
# The bucket keeps 31 days (its lifecycle rule), so a minute in the last
# month can be reached from the copy before it.
#
# Its last line is one a program reads (Connection health, Backups row):
#   base-backup-status 2026-11-01T22:30:05Z ok|failed
# =============================================================================
set -uo pipefail

# Which pg_basebackup, and where it listens: as db/backup.sh.
if command -v pg_basebackup >/dev/null 2>&1; then
  PGBASEBACKUP="$(command -v pg_basebackup)"
  PGHOST="${PGHOST:-/var/run/postgresql}"   # socket: peer auth, no password
  PGPORT="${PGPORT:-5432}"
else
  PGBASEBACKUP="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}/pg_basebackup.exe"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-55432}"
fi
SUPER="${SUPER:-postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WAL="${WAL_SH:-/usr/local/bin/fidato-wal}"
[ -x "$WAL" ] || WAL="$ROOT/db/wal.sh"
BACKUP_ENV="${BACKUP_ENV:-/etc/fidato-backup.env}"
[ -r "$BACKUP_ENV" ] && . "$BACKUP_ENV"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d "${BACKUP_DIR:-/var/backups/fidato}/base-XXXXXX") || exit 1
trap 'rc=$?; rm -rf "$WORK"
      echo "base-backup-status $(date -u +%Y-%m-%dT%H:%M:%SZ) $([ $rc -eq 0 ] && echo ok || echo failed)"' EXIT

echo "-- base copy $STAMP ---------------------------------------"
[ -n "${BACKUP_UPLOAD_URL:-}" ] \
  || { echo "  x no BACKUP_UPLOAD_URL in $BACKUP_ENV - a base copy on this disk alone is no use"; exit 1; }

# -c fast: start now rather than at the next checkpoint. -X stream: the
# journal written meanwhile comes along (pg_wal.tar.gz).
"$PGBASEBACKUP" -h "$PGHOST" -p "$PGPORT" -U "$SUPER" -D "$WORK/b" -Ft -z -X stream -c fast \
  || { echo "  x pg_basebackup failed - see above"; exit 1; }

F="$WORK/base-$STAMP.tar"
tar -cf - -C "$WORK/b" . > "$F" || exit 1
bash "$WAL" send "$F" "base/base-$STAMP.tar" || { echo "  x the copy off the box FAILED"; exit 1; }
echo "  ok base/base-$STAMP.tar ($(du -k "$F" | cut -f1) KB) copied off the box"
