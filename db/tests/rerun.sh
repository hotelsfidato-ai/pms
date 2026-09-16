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

PSQL="$PGBIN/psql.exe"
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
if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 \
     -c "insert into hotels (code, name, city) values ('RRN','Rerun Property','Nowhere')" 2>&1); then
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
