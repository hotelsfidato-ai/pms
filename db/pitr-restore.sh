#!/usr/bin/env bash
# =============================================================================
# pitr-restore.sh — the database as it was at a chosen minute, as a NEW
# database beside the live one (D27-373, A3)
# =============================================================================
# Installed by launch.sh as /usr/local/bin/fidato-pitr-restore. As `postgres`:
#
#   RESTORE_FROM='<the read link, ending /o/>' \
#     fidato-pitr-restore base-20261101T223005Z.tar '2026-11-03 14:05:00+05:30'
#
# NEVER OVER LIVE. The base copy and the journal after it are restored into a
# SEPARATE, temporary PostgreSQL (its own folder, its own socket, no network,
# no archiving) and replayed up to that minute. The hotel database is then
# copied out of it into a new database, `fidato_pitr`, on the live server,
# and the temporary one is removed. Nothing else on the live server is
# touched. Comparing, and switching if that is the decision, are steps a
# person takes (deploy/README.md, "Restore to any minute").
#
#   the base copy   a name in the bucket's base/ (fetched from RESTORE_FROM),
#                   or a file already on this disk. It must be from BEFORE
#                   the minute.
#   the minute      a time with its offset from UTC (+05:30 for India), as
#                   PostgreSQL's recovery_target_time takes it; or `latest`,
#                   everything in the bucket (a new server after the old one
#                   died: deploy/IF-THE-SERVER-DIES.md)
#   RESTORE_FROM    the read link the owner keeps off the server, or a folder
#
# A minute later than the last journal piece in the bucket stops with
# PostgreSQL's own "recovery ended before configured recovery target was
# reached", and nothing is created.
# =============================================================================
set -uo pipefail

# Which binaries, and where the live server listens: as db/backup.sh.
if command -v pg_ctl >/dev/null 2>&1; then
  B=""
  PGHOST="${PGHOST:-/var/run/postgresql}"
  PGPORT="${PGPORT:-5432}"
else
  B="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}/"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-55432}"
fi
SUPER="${SUPER:-postgres}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WAL="${WAL_SH:-/usr/local/bin/fidato-wal}"
[ -x "$WAL" ] || WAL="$ROOT/db/wal.sh"
# How the temporary server calls it: the script itself on the server; this
# PC's PostgreSQL needs bash named (db/tests/pitr.sh).
WAL_CMD="${WAL_CMD:-$WAL}"
DB="${DB:-fidato}"
NEW="${NEW:-${DB}_pitr}"
WORK="${WORK:-/var/lib/pgsql/pitr-work}"
TPORT="${PITR_PORT:-5499}"

BASE="${1:-}"; TARGET="${2:-}"
die() { printf "\033[31m  x %s\033[0m\n" "$1" >&2; exit 1; }
[ -n "$BASE" ] && [ -n "$TARGET" ] \
  || die "use: fidato-pitr-restore <base copy> '<YYYY-MM-DD HH:MM:SS+05:30>' (or latest)"
case "$TARGET" in *"'"*|*\\*) die "the minute has a quote in it" ;; esac
[ -n "${RESTORE_FROM:-}" ] || die "RESTORE_FROM is empty: the read link (or a folder)"
export RESTORE_FROM

live() { "${B}psql" -h "$PGHOST" -p "$PGPORT" -U "$SUPER" -v ON_ERROR_STOP=1 -tAq "$@"; }
[ -z "$(live -d postgres -c "select 1 from pg_database where datname = '$NEW'")" ] \
  || die "$NEW already exists. Look at it, then drop or rename it; nothing was changed."
[ ! -e "$WORK" ] || die "$WORK is there: a restore still running, or one left over. Remove it first."

# The temporary server: on a socket in its own folder, or (this PC) on the
# address given.
if [ -n "${PITR_HOST:-}" ]; then
  H="$PITR_HOST"; NET="-c listen_addresses=$PITR_HOST"
else
  H="$WORK"; NET="-c listen_addresses='' -c unix_socket_directories='$WORK'"
fi
tmp() { "${B}psql" -h "$H" -p "$TPORT" -U "$SUPER" -tAq "$@"; }

mkdir -p "$WORK/data" && chmod 700 "$WORK" "$WORK/data" || die "cannot make $WORK"
trap '"${B}pg_ctl" -D "$WORK/data" -m fast -w stop >/dev/null 2>&1
      [ -n "${KEEP_WORK:-}" ] || rm -rf "$WORK"' EXIT

echo "-- 1 · the base copy ---------------------------------------"
if [ -f "$BASE" ]; then
  cp "$BASE" "$WORK/base.tar" || die "cannot read $BASE"
else
  case "$RESTORE_FROM" in
    http*) curl -sSf --retry 3 -m 900 -o "$WORK/base.tar" "${RESTORE_FROM%/}/base/$BASE" ;;
    *)     cp "$RESTORE_FROM/base/$BASE" "$WORK/base.tar" ;;
  esac || die "could not fetch base/$BASE"
fi
# Read from stdin: GNU tar takes "C:/..." for a remote host (this PC).
mkdir -p "$WORK/b" && tar -xf - -C "$WORK/b" < "$WORK/base.tar" \
  && tar -xzf - -C "$WORK/data" < "$WORK/b/base.tar.gz" \
  && tar -xzf - -C "$WORK/data/pg_wal" < "$WORK/b/pg_wal.tar.gz" \
  || die "the base copy is not a pg_basebackup -Ft -z copy"
rm -rf "$WORK/b" "$WORK/base.tar"
echo "  ok $BASE"

echo "-- 2 · replaying the journal up to $TARGET --------------"
# The last setting in the file wins: these come after anything the live
# server had in it. Archiving OFF, or this copy would write its own journal
# into the live server's bucket.
cat >> "$WORK/data/postgresql.auto.conf" <<EOF
# db/pitr-restore.sh: a temporary copy, removed when it is done.
restore_command = '$WAL_CMD get %f %p'
$([ "$TARGET" = latest ] || echo "recovery_target_time = '$TARGET'")
recovery_target_action = 'promote'
archive_mode = 'off'
EOF
: > "$WORK/data/recovery.signal"
LOG="$WORK/restore.log"
# shellcheck disable=SC2086
"${B}pg_ctl" -D "$WORK/data" -l "$LOG" -w -t 3600 \
  -o "-p $TPORT $NET -c archive_mode=off -c logging_collector=off" start >/dev/null 2>&1 \
  || { tail -n 15 "$LOG" >&2; die "the temporary server did not start or stopped (its log above)"; }
i=0
until [ "$(tmp -d postgres -c "select pg_is_in_recovery()" 2>/dev/null)" = f ]; do
  if ! "${B}pg_ctl" -D "$WORK/data" status >/dev/null 2>&1; then
    tail -n 15 "$LOG" >&2; die "the replay stopped (its log above): nothing was created"
  fi
  i=$((i + 1)); [ $i -lt 720 ] || die "still replaying after an hour"
  sleep 5
done
grep -E "recovery stopping|last completed transaction" "$LOG" | sed 's/^/    /'

echo "-- 3 · into $NEW on the live server --------------------------"
"${B}pg_dump" -h "$H" -p "$TPORT" -U "$SUPER" -Fc -f "$WORK/db.dump" "$DB" || die "pg_dump from the copy failed"
live -d postgres -c "create database $NEW" || die "could not create $NEW"
# Owners and rights kept: the live server has the same roles, so a switch
# needs nothing put back.
if ! OUT=$("${B}pg_restore" -h "$PGHOST" -p "$PGPORT" -U "$SUPER" -d "$NEW" "$WORK/db.dump" 2>&1); then
  echo "$OUT" | grep -iE "error|fatal" | head -8 | sed 's/^/    /'
  live -d postgres -c "drop database $NEW" >/dev/null 2>&1
  die "the restore into $NEW failed; $NEW was removed"
fi

echo "-- 4 · side by side ------------------------------------------"
printf "    %-16s %12s %12s\n" "" "$DB now" "$NEW"
for t in reservations folio_postings invoices guests; do
  printf "    %-16s %12s %12s\n" "$t" \
    "$(live -d "$DB" -c "select count(*) from $t" 2>/dev/null || echo -)" \
    "$(live -d "$NEW" -c "select count(*) from $t" 2>/dev/null || echo -)"
done
echo
printf "\033[32m  %s is %s as it was at %s. The live database is untouched.\033[0m\n" "$NEW" "$DB" "$TARGET"
echo "  Compare, then decide: deploy/README.md, \"Restore to any minute\"."
