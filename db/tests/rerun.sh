#!/usr/bin/env bash
# =============================================================================
# rerun.sh — can the migrations be applied to a database that already has them?
# =============================================================================
# `run.sh` rebuilds from ZERO, so it only ever proves the FIRST run. Every
# deploy after the first one applies the same files to a database that already
# has most of them, and that is a completely different question.
#
# It was answered by hand once, destructively, against the live database. Half
# of 013_policies.sql applied before it aborted, `staff`'s RLS policy went
# recursive, the demo loader died, and the cluster had to be rebuilt with
# initdb. Defect 119, and decision D2 in MEMORY.md.
#
# So this builds a SCRATCH database, migrates it twice, and drops it whether it
# passes or fails — the shape `verify-backup.sh` has used since it was written.
# It is never the database the app uses.
#
#   ./db/tests/rerun.sh            all 61, second pass, report failures
#   ./db/tests/rerun.sh --keep     leave the scratch database for inspection
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-D:/fidato-pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
DB="fidato_rerun_$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# WHICH psql. This said `$PGBIN/psql.exe` and nothing else, so this suite ran
# on one Windows machine and nowhere else - not on the server, and not on a
# Linux runner, which is exactly where a gate belongs. The same ladder as
# db/migrate.sh and api/scripts/with-test-db.sh, which both learned it the
# hard way (defect 188). A fourth spelling of "find psql" is how they drift,
# so this is the third and last copy.
if [ -n "${PSQL:-}" ]; then
  :                                       # told explicitly; use it
elif [ -x "$PGBIN/psql.exe" ]; then
  PSQL="$PGBIN/psql.exe"
elif [ -x "$PGBIN/psql" ]; then
  PSQL="$PGBIN/psql"
elif command -v psql >/dev/null 2>&1; then
  PSQL="$(command -v psql)"
else
  printf "[31m  x no psql found. Set PGBIN to the directory holding it, or PSQL to the binary.[0m
"
  exit 1
fi
S="-h $PGHOST -p $PGPORT -U $SUPER"
export PGPASSWORD="$SUPERPASS"
export PGCLIENTENCODING=UTF8

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

cleanup() {
  if [ "${1:-}" = "--keep" ]; then
    dim "  scratch database kept: $DB"
    return
  fi
  "$PSQL" $S -d postgres -q -c "drop database if exists $DB" >/dev/null 2>&1
}
trap 'cleanup' EXIT

echo "-- a scratch database, never the one the app uses ----------"
"$PSQL" $S -d postgres -q -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null 2>&1 \
  || { red "  x could not create $DB"; exit 1; }
dim "  $DB"

# ---- first pass: this must be clean, or the second pass means nothing -------
echo "-- first pass ---------------------------------------------"
FIRST_FAIL=0
for f in "$ROOT"/db/migrations/*.sql; do
  if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    red "  x $(basename "$f") failed on a FRESH database"
    echo "$out" | grep -m1 "ERROR" | sed 's/^/      /'
    FIRST_FAIL=$((FIRST_FAIL + 1))
  fi
done

if [ "$FIRST_FAIL" -ne 0 ]; then
  red "  $FIRST_FAIL migration(s) fail from zero. Fix those before reading below."
  exit 1
fi
green "  all migrations applied to an empty database"

# ---- between the passes: a property, as production has ---------------------
# An EMPTY database hides every replay fault that depends on rows. Found
# 16 September (MEMORY 284): 095 re-adds a check on approval kinds, 096 then
# writes a kind 095's list does not have — but only for properties that exist.
# Here there were none, so the second pass was green; the local database had
# one, and failed. Production has five. So give the second pass a property.
# AND A BANQUET FUNCTION WITH A BILL. 056 re-added "a folio belongs to a stay or
# a group" over 060's "…or a function", and the first confirmed banquet would
# have failed every deploy after (MEMORY 299). A folio owned by a function is
# the row that proves 056 leaves the wider rule alone.
#
# AND GIVE SOMEBODY EVERY ROLE THERE IS. 078 re-added the role constraint with
# its own older, narrower list, and the first Revenue Manager (a role 093 added)
# would have failed every deploy after - while this script, which gave nobody
# any role, stayed green (MEMORY 299). One person per assignable role means a
# role list narrowed by ANY earlier file is caught here, not in production.
#
# And SWITCH A MODULE ON for it. A constraint on `hotel_modules.module` is
# validated against the rows that are there, so a migration that rewrites that
# constraint is only tested by a replay that has such a row. Without this, 087
# put the narrow module list back over 108's wider one and every pass here was
# green while the next real deploy would have rolled back (MEMORY 293).
if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 \
     -c "insert into hotels (code, name, city) values ('RRN','Rerun Property','Nowhere')" \
     -c "insert into hotel_modules (hotel_id, module, is_enabled)
         select id, 'channel_manager', true from hotels where code = 'RRN'"      -c "with people as (
           insert into staff (email, full_name)
           select 'rerun-' || r || '@fidato.in', 'Rerun ' || r
             from unnest(app.assignable_roles()) as r
           returning id, full_name)
         insert into staff_hotels (staff_id, hotel_id, role)
         select p.id, h.id, replace(p.full_name, 'Rerun ', '')
           from people p, hotels h where h.code = 'RRN'"      -c "with hall as (
           insert into banquet_venues (hotel_id, name)
           select id, 'Rerun Hall' from hotels where code = 'RRN'
           returning id, hotel_id),
         fn as (
           insert into banquet_events
             (hotel_id, venue_id, reference, title, starts_at, ends_at,
              business_date, host_name, registered_by)
           select hall.hotel_id, hall.id, 'BQ-RERUN-1', 'Rerun function',
                  now(), now() + interval '4 hours', current_date, 'Rerun Host',
                  (select id from staff where email like 'rerun-%' limit 1)
             from hall
           returning id, hotel_id)
         insert into folios (hotel_id, event_id, status)
         select hotel_id, id, 'open' from fn" 2>&1); then
  red "  x could not create a property between the passes"
  echo "$out" | grep -m1 "ERROR" | sed 's/^/      /'
  exit 1
fi
dim "  a property created between the passes, as a real database has"

# ---- second pass: the one every deploy after the first performs ------------
echo "-- second pass — what a redeploy actually does ------------"
TOTAL=0
FAILED=0
FAILED_LIST=""
for f in "$ROOT"/db/migrations/*.sql; do
  TOTAL=$((TOTAL + 1))
  name=$(basename "$f")
  if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    FAILED=$((FAILED + 1))
    FAILED_LIST="$FAILED_LIST$name\n"
    red "  x $name"
    echo "$out" | grep -m1 "ERROR" | sed 's/^/      /'
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  green "  all $TOTAL migrations are re-runnable"
  exit 0
fi

red "  $FAILED of $TOTAL abort on a second run"
dim "  Every deploy after the first one stops at the first of these."
exit 1
