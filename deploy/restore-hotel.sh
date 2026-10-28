#!/usr/bin/env bash
# =============================================================================
# restore-hotel.sh - bring back ONE hotel's rows from a backup (plan A, A4)
# =============================================================================
#   restore-hotel.sh <HOTEL> <backup file | database>                 look
#   restore-hotel.sh <HOTEL> <backup file | database> --bring-back    look, then
#                                         put back what is missing, once the
#                                         hotel's code is typed again
#
# For the day one hotel's records are damaged - a booking, a bill, a guest
# deleted by mistake - and the other hotels must not move. It is the owner's
# tool, run by hand on the server as `postgres` (deploy/README.md, "Bringing
# back one hotel"). The whole-database restore is db/restore.sh; this is not it.
#
# 1. The backup (a file db/backup.sh made: .dump, or .sql from --portable) is
#    restored into a SCRATCH database, dropped at the end whatever happens. Or
#    name a database that already holds the copy (A3's `fidato_pitr`, restored
#    to a minute): it is read, and never dropped.
# 2. One hotel's rows, from every hotel table (app.test_hotel_classes() names
#    them all), are compared with live: missing in live, changed since, new
#    since. Live is opened READ ONLY for this.
# 3. Only with --bring-back, and the code typed again: the rows MISSING in live
#    go back, parents first (a guest before the booking), with any shared row
#    they need (a guest, a company), in one transaction. It never overwrites a
#    row that changed since the backup; never writes an append-only record (the
#    ledger, an issued invoice: reversed in the PMS, never rewritten); never
#    the invoice and bill series, so a number is never issued twice; never a
#    person or a property. Those it lists, and leaves to the owner. A guest
#    who comes back brings their ID documents (D27-376); an ID photo's row
#    comes back with its stay, and the look lists it to be opened once in the
#    PMS: the photo is in Google Drive (D27-209), which this tool never reaches.
#
# Settings, as db/backup.sh: on the server (psql on the PATH) the unix socket
# as postgres; on a development PC the local cluster (PGBIN, PGHOST, PGPORT,
# SUPERPASS). DB is the live database (fidato; fidato_<code> for a customer).
# =============================================================================
set -uo pipefail

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
warn()  { printf "\033[33m%s\033[0m\n" "$1"; }

if command -v psql >/dev/null 2>&1; then
  PSQL=psql PGRESTORE=pg_restore
  export PGHOST="${PGHOST:-/var/run/postgresql}" PGPORT="${PGPORT:-5432}"
  export PGPASSWORD="${SUPERPASS:-}"
else
  PGBIN="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}"
  PSQL="$PGBIN/psql.exe" PGRESTORE="$PGBIN/pg_restore.exe"
  export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}"
  export PGPASSWORD="${SUPERPASS:-pw}"
fi
# One clock and one encoding on both sides, or a time would compare unequal.
export PGUSER="${SUPER:-postgres}" PGTZ=UTC PGCLIENTENCODING=UTF8
DB="${DB:-fidato}"
SQL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/restore-hotel.sql"
q() { "$PSQL" -X -q -v ON_ERROR_STOP=1 -d "$@"; }

HOTEL="" SOURCE="" BRING=0
for a in "$@"; do
  case "$a" in
    --bring-back) BRING=1 ;;
    *) if [ -z "$HOTEL" ]; then HOTEL="$a"; else SOURCE="$a"; fi ;;
  esac
done
case "$HOTEL" in
  ""|*[!A-Z0-9]*)
    red "  x usage: restore-hotel.sh <HOTEL CODE> <backup file | database> [--bring-back]"
    red "    the code as the PMS shows it, in capitals: AMR, 5EL"
    exit 1 ;;
esac
[ -n "$SOURCE" ] || { red "  x name the backup file, or the database holding the copy"; exit 1; }

# ── The copy ────────────────────────────────────────────────────────────────
SCRATCH="" MADE=0
cleanup() {
  [ "$MADE" = 1 ] || return 0
  q postgres -c "drop database if exists $SCRATCH with (force)" >/dev/null 2>&1 \
    && echo "  (the scratch copy $SCRATCH is dropped)" \
    || red "  x could not drop $SCRATCH: drop it by hand"
}
trap cleanup EXIT

if [ -f "$SOURCE" ]; then
  SCRATCH="${SCRATCH_DB:-fidato_restore_$(echo "$HOTEL" | tr 'A-Z' 'a-z')_$$}"
  echo "-- the backup into a scratch database, $SCRATCH -----------"
  # Never over something that is there: a name in use is somebody's database.
  q postgres -c "create database $SCRATCH" >/dev/null || { red "  x could not create $SCRATCH"; exit 1; }
  MADE=1
  case "$SOURCE" in
    *.sql) q "$SCRATCH" -f "$SOURCE" >/dev/null 2>&1 ;;
    *)     "$PGRESTORE" -d "$SCRATCH" --no-owner --no-acl "$SOURCE" ;;
  esac || { red "  x the backup would not restore: $SOURCE"; exit 1; }
  SRC="$SCRATCH"
elif [ "$(q postgres -tAc "select 1 from pg_database where datname = '$SOURCE'" 2>/dev/null)" = "1" ]; then
  SRC="$SOURCE"
else
  red "  x $SOURCE is neither a file nor a database"; exit 1
fi
[ "$SRC" != "$DB" ] || { red "  x the copy and the live database are the same one ($DB)"; exit 1; }

# ── The hotel, in the copy and in live ──────────────────────────────────────
HID=$(q "$SRC" -tAc "select id from hotels where code = '$HOTEL'") \
  || { red "  x $SRC does not read as a PMS database"; exit 1; }
[ -n "$HID" ] || { red "  x the backup has no hotel $HOTEL"; exit 1; }
LIVE=$(q "$DB" -tAc "select coalesce((select 'same' from hotels where id = '$HID'),
                                     (select 'other' from hotels where code = '$HOTEL'), 'none')") \
  || { red "  x could not read the live database $DB"; exit 1; }
if [ "$LIVE" = "other" ]; then
  red "  x the live $HOTEL is not the property in the backup (another id). Nothing to compare."
  exit 1
fi
if [ "$LIVE" = "none" ]; then
  red "  x $HOTEL itself (its row in hotels, id $HID) is not in the live database."
  red "    Every row of a hotel hangs off that row, so it comes back first, by hand,"
  red "    and that is a job to plan with help (deploy/README.md, \"Bringing back one hotel\")."
  echo "    The server, as postgres, with the backup in a database of its own:"
  if [ "$SRC" = "$SOURCE" ]; then BACK="$SRC"; else
    BACK=fidato_hotel_back
    echo "      createdb $BACK && pg_restore -d $BACK --no-owner --no-acl $SOURCE"
  fi
  echo "      psql -d $BACK -c \"\\copy (select * from hotels where id = '$HID') to '/tmp/hotel.csv' csv\""
  echo "      psql -d $DB -c \"\\copy hotels from '/tmp/hotel.csv' csv\""
  echo "    The database then adds a new property's own defaults (stores, payment"
  echo "    methods, the series). Run this again: it shows those as new since, and"
  echo "    what can come back."
  exit 1
fi
M_SRC=$(q "$SRC" -tAc "select count(*) from schema_migrations")
M_LIVE=$(q "$DB" -tAc "select count(*) from schema_migrations")

echo
echo "  hotel   $HOTEL ($HID)"
echo "  backup  $SOURCE"
echo "  live    $DB on $PGHOST"
[ "$M_SRC" = "$M_LIVE" ] || warn "  the backup is from another version of the PMS ($M_SRC migrations, live $M_LIVE): rows are compared on the columns both have"

compare() {                     # compare 0|1 [expected]: 1 writes
  q "$SRC" -v export=1 -v hid="$HID" -f "$SQL" \
    | q "$DB" -v export=0 -v write="$1" -v hid="$HID" -v expect="${2:-0}" -f "$SQL"
}

OUT=$(compare 0) || { echo "$OUT"; red "  x the comparison failed - nothing was changed"; exit 1; }
echo "$OUT"
COME=$(echo "$OUT" | sed -n 's/^  can come back: \([0-9]*\) rows$/\1/p')

if [ "$BRING" != 1 ]; then
  echo
  echo "  A look only: nothing was changed. To put back what can come back, run"
  echo "  this again with --bring-back."
  exit 0
fi
if [ "${COME:-0}" = 0 ]; then
  echo
  green "  Nothing can come back, so nothing was changed."
  exit 0
fi

# ── The second step ─────────────────────────────────────────────────────────
echo
warn "  ABOUT TO WRITE $COME rows back into the live database $DB, at $HOTEL."
printf "  Type the hotel's code to confirm (%s): " "$HOTEL"
read -r TYPED
if [ "$TYPED" != "$HOTEL" ]; then
  echo
  red "  x not confirmed. Nothing was changed."
  exit 1
fi
if ! compare 1 "$COME"; then
  red "  x refused, so nothing was brought back (one transaction: all of it or none)."
  exit 1
fi
green "  ✓ brought back. Open the hotel in the PMS and look at what came back."
