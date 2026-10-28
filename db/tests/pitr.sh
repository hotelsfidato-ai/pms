#!/usr/bin/env bash
# =============================================================================
# pitr.sh — restore to any minute, rehearsed on this PC (D27-373, A3)
# =============================================================================
# On PostgreSQL 16, the server's major version (the 16.15 binaries in the main
# checkout's .local/pg16, as db/tests/pg16.sh), in a cluster of its own: a
# scratch folder, port 55497 (and 55498 for the restore's temporary copy),
# stopped and removed at the end. A FOLDER is the bucket. Nothing touches the
# shared clusters on 55432 and 55433.
#
#   1  archiving on, through db/wal.sh, as the server will run it
#   2  the weekly base copy, through db/base-backup.sh
#   3  bookings after it; the minute noted; then the mistake: all deleted
#   4  db/pitr-restore.sh to that minute: fidato_pitr has them, the live
#      database still has none, and the temporary copy archived nothing
#   5  a minute after the last piece of journal: refused, nothing created;
#      `latest`: everything in the bucket, as live has it (a new server)
#   6  the link emptied: pg_stat_archiver says failing, as the Backups row
#      reads it; and well again once the link is back
#
# The server's own steps: deploy/README.md, "Restore to any minute".
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MAIN="$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)/.." && { pwd -W 2>/dev/null || pwd; })"
BIN="${PG16:-$MAIN/.local/pg16}/pgsql/bin"
[ -x "$BIN/pg_ctl.exe" ] || [ -x "$BIN/pg_ctl" ] || { echo "  x no PostgreSQL 16 in $BIN"; exit 1; }
w() { cygpath -m "$1" 2>/dev/null || printf "%s" "$1"; }    # this PC's PostgreSQL takes C:/ paths

PORT=55497
S="$(w "$(mktemp -d "${TMPDIR:-/tmp}/fidato-pitr-XXXXXX")")"
D="$S/data"
FAILED=0
ok()    { printf "  \033[32mok\033[0m %s\n" "$1"; }
bad()   { printf "  \033[31mx\033[0m %s\n" "$1"; FAILED=$((FAILED + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: $2, expected $3"; fi; }
q()     { "$BIN/psql" -h 127.0.0.1 -p $PORT -U postgres -tAq -v ON_ERROR_STOP=1 "$@"; }
until_true() {                  # until_true <seconds> <sql>
  local i
  for i in $(seq 1 "$1"); do [ "$(q -d postgres -c "$2")" = t ] && return 0; sleep 1; done
  return 1
}
trap '"$BIN/pg_ctl" -D "$D" -m fast -w stop >/dev/null 2>&1; rm -rf "$S"' EXIT

"$BIN/postgres" --version
"$BIN/initdb" -D "$D" -U postgres -A trust -E UTF8 --locale=C > "$S/initdb.log" 2>&1 \
  || { echo "  x initdb failed"; exit 1; }

echo "-- 1 · archiving on, through db/wal.sh --------------------"
mkdir -p "$S/bucket"
# PGBIN: where wal.sh finds pg_controldata (on the server it is on the path).
export BACKUP_ENV="$S/backup.env" WAL_SPOOL="$S/spool" WAL_STATUS="$S/wal.status" PGBIN="$BIN"
echo "BACKUP_UPLOAD_URL='$S/bucket'" > "$BACKUP_ENV"
push() { bash "$ROOT/db/wal.sh" push 2>/dev/null; }    # cron's job on the server
# PostgreSQL on Windows runs a command through cmd, so bash is named; on the
# server the script runs itself.
if [ -x "$BIN/pg_ctl.exe" ]; then
  WAL_CMD="\"$(w /usr/bin/bash)\" \"$(w "$ROOT/db/wal.sh")\""
else
  WAL_CMD="$ROOT/db/wal.sh"
fi
cat >> "$D/postgresql.conf" <<EOF
archive_mode = on
archive_command = '$WAL_CMD put "%p" "%f"'
archive_timeout = 3600
EOF
"$BIN/pg_ctl" -D "$D" -l "$S/pg.log" -o "-p $PORT" -w -t 120 start > /dev/null \
  || { tail -n 20 "$S/pg.log"; echo "  x PostgreSQL 16 did not start"; exit 1; }
check "archive_mode" "$(q -d postgres -c "show archive_mode")" on

echo "-- 2 · the weekly base copy -------------------------------"
q -d postgres -c "create database fidato"
q -d fidato -c "create table reservations (n int primary key)" -c "insert into reservations select generate_series(1, 100)"
PGBIN="$BIN" PGHOST=127.0.0.1 PGPORT=$PORT BACKUP_DIR="$S" WAL_SH="$ROOT/db/wal.sh" \
  bash "$ROOT/db/base-backup.sh" > "$S/base.log" 2>&1
sed 's/^/    /' "$S/base.log"
check "its status line" "$(tail -n 1 "$S/base.log" | cut -d' ' -f3)" ok
BASE="$(ls "$S/bucket/base" 2>/dev/null)"
check "one base copy in the bucket" "$(printf "%s" "$BASE" | grep -c '^base-.*\.tar$')" 1

echo "-- 3 · more bookings, the minute, then the mistake --------"
q -d fidato -c "insert into reservations select generate_series(101, 150)"
sleep 1; MINUTE="$(q -d postgres -c "select now()::text")"; sleep 1
q -d fidato -c "delete from reservations"
SEG="$(q -d postgres -c "select pg_walfile_name(pg_switch_wal())")"
until_true 60 "select coalesce(last_archived_wal >= '$SEG', false) from pg_stat_archiver" \
  && ok "archive_command put the journal up to the mistake in the spool ($SEG)" || bad "$SEG never reached the spool"
push
check "the push's status line" "$(cut -d' ' -f1,3,5 "$WAL_STATUS")" "wal-push ok waiting=0"
ID="$(q -d postgres -c "select system_identifier from pg_control_system()")"
check "$SEG in the bucket, under this server's own folder" "$([ -s "$S/bucket/wal/$ID/$SEG.gz" ] && echo yes || echo no)" yes
echo "    the minute: $MINUTE"

restore() {                     # restore <minute> <new database> - pitr-restore.sh as the server runs it
  RESTORE_FROM="$S/bucket" PGBIN="$BIN" PGHOST=127.0.0.1 PGPORT=$PORT PITR_HOST=127.0.0.1 PITR_PORT=55498 \
    WORK="$S/work" WAL_CMD="$WAL_CMD" WAL_SH="$ROOT/db/wal.sh" NEW="$2" \
    bash "$ROOT/db/pitr-restore.sh" "$BASE" "$1" 2>&1
}

echo "-- 4 · back to the minute, beside the live database --------"
OUT="$(restore "$MINUTE" fidato_pitr)"; rc=$?
printf "%s\n" "$OUT" | sed 's/^/    /'
check "pitr-restore.sh" "$rc" 0
check "bookings in fidato_pitr" "$(q -d fidato_pitr -c "select count(*) from reservations" 2>&1)" 150
check "bookings in the live database (the mistake stands)" "$(q -d fidato -c "select count(*) from reservations")" 0
# Its own timeline, 2: a name that starts 00000002 (in the spool, after "<server>-").
check "pieces the temporary copy archived" \
  "$(find "$S/bucket/wal" "$S/spool" -name '00000002*' -o -name '*-00000002*' | wc -l | tr -d ' ')" 0
check "the temporary folder" "$([ -e "$S/work" ] && echo there || echo removed)" removed

echo "-- 5 · a minute after the last piece of journal ------------"
OUT="$(restore "$(q -d postgres -c "select (now() + interval '1 hour')::text")" fidato_late)"; rc=$?
printf "%s\n" "$OUT" | tail -n 4 | sed 's/^/    /'
check "refused" "$([ "$rc" -ne 0 ] && echo yes || echo no)" yes
check "PostgreSQL's own reason" "$(printf "%s" "$OUT" | grep -c "recovery ended before configured recovery target was reached")" 1
check "fidato_late created" "$(q -d postgres -c "select count(*) from pg_database where datname = 'fidato_late'")" 0

echo "-- 5b · latest: everything in the bucket (a new server) ----"
OUT="$(restore latest fidato_latest)"; rc=$?
printf "%s\n" "$OUT" | grep -E "recovery|fidato_latest is" | sed 's/^/    /'
check "pitr-restore.sh latest" "$rc" 0
check "bookings in fidato_latest (past the mistake, as live)" "$(q -d fidato_latest -c "select count(*) from reservations" 2>&1)" 0

echo "-- 6 · when it fails, what the Backups row reads ------------"
push    # what the restores wrote meanwhile
SEG="$(q -d postgres -c "select last_archived_wal from pg_stat_archiver")"
q -d fidato -c "insert into reservations values (1)" -c "select pg_switch_wal()" > /dev/null
until_true 60 "select coalesce(last_archived_wal > '$SEG', false) from pg_stat_archiver" || bad "nothing new archived"
echo "BACKUP_UPLOAD_URL=''" > "$BACKUP_ENV"
push
check "the link emptied: the push's status line" "$(head -n 1 "$WAL_STATUS" | cut -d' ' -f1,3,5)" "wal-push failed waiting=1"
check "... and why" "$(sed -n 2p "$WAL_STATUS" | grep -c "no BACKUP_UPLOAD_URL")" 1
echo "BACKUP_UPLOAD_URL='$S/bucket'" > "$BACKUP_ENV"
push
check "the link back: the piece goes" "$(cut -d' ' -f1,3,4,5 "$WAL_STATUS")" "wal-push ok sent=1 waiting=0"

# The spool unwritable (a file where its folder should be): the database's
# own archiving fails, as pg_stat_archiver counts it (health.ts reads it so).
FAILING="select coalesce(last_failed_time > coalesce(last_archived_time, '-infinity'), false) from pg_stat_archiver"
: > "$S/not-a-folder"
printf "BACKUP_UPLOAD_URL='%s'\nWAL_SPOOL='%s'\n" "$S/bucket" "$S/not-a-folder" > "$BACKUP_ENV"
q -d fidato -c "insert into reservations values (2)" -c "select pg_switch_wal()" > /dev/null
until_true 60 "$FAILING" && ok "the spool unwritable: pg_stat_archiver says failing" || bad "pg_stat_archiver never said failing"
echo "BACKUP_UPLOAD_URL='$S/bucket'" > "$BACKUP_ENV"
q -d postgres -c "select pg_switch_wal()" > /dev/null
until_true 180 "select not ($FAILING)" && ok "and well again once it is a folder again" || bad "still failing"

echo
if [ $FAILED -eq 0 ]; then
  echo "  restore to any minute: every check passed on $("$BIN/postgres" --version)"
else
  echo "  x $FAILED check(s) failed"; exit 1
fi
