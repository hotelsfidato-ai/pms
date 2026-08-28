#!/usr/bin/env bash
# =============================================================================
# run.sh — rebuild from zero, migrate, test, report
# =============================================================================
# THE RESTRAINT. Run this before touching a migration and again afterwards.
# A guard that passed before and fails after is a regression, and this exits
# non-zero so it cannot be waved through.
#
#   ./db/tests/run.sh              full rebuild + all suites
#   ./db/tests/run.sh --keep       reuse the existing database
#
# Requires PGBIN, PGPORT, PGPASS in the environment or the defaults below.
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-C:/Users/rozar/AppData/Local/Temp/claude/D--PMS-FIDATO/6f5bb0bf-ad16-442f-bd1d-566b371924fa/scratchpad/pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
APPPASS="${APPPASS:-CHANGE_ME_app}"
DB="${DB:-fidato}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PSQL="$PGBIN/psql.exe"
S="-h $PGHOST -p $PGPORT -U $SUPER"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }

if [ "${1:-}" != "--keep" ]; then
  echo "-- rebuilding $DB ------------------------------------------"

  # A connection still open on $DB makes the DROP fail. This used to print the
  # error and carry on, so the migrations then ran against the OLD database and
  # failed somewhere unrelated -- 005 complaining about a column 011 removed.
  # The confusing error was three steps downstream of the real one.
  #
  # Terminate other backends first, then treat a failed DROP as fatal.
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q -c \
    "select pg_terminate_backend(pid) from pg_stat_activity
      where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null 2>&1

  DROP_OUT=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q \
    -v ON_ERROR_STOP=1 -c "drop database if exists $DB;" 2>&1)
  if [ $? -ne 0 ]; then
    red "  x Could not drop $DB:"
    echo "$DROP_OUT" | sed 's/^/      /'
    red "    Something is still connected. Stop the API and try again."
    exit 1
  fi

  CREATE_OUT=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q \
    -v ON_ERROR_STOP=1 -c "create database $DB;" 2>&1)
  if [ $? -ne 0 ]; then
    red "  x Could not create $DB:"
    echo "$CREATE_OUT" | sed 's/^/      /'
    exit 1
  fi
fi

echo "── migrations ─────────────────────────────────────────────"
for f in "$ROOT"/db/migrations/*.sql; do
  out=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)
  if [ $? -ne 0 ]; then
    red "  ✗ $(basename "$f")"
    echo "$out" | grep -iE "ERROR|HINT" | head -4 | sed 's/^/      /'
    exit 1
  fi
done
green "  ✓ $(ls "$ROOT"/db/migrations/*.sql | wc -l | tr -d ' ') migrations applied"

echo "── harness + suite ────────────────────────────────────────"
PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f "$ROOT/db/tests/harness.sql" -f "$ROOT/db/tests/suite.sql" 2>&1 \
  | grep -iE "^ERROR" | head -5

# RLS suite runs as the application role — a superuser bypasses RLS and would
# report success on a completely open database.
#
# ⚠ THIS USED TO BE `if [ -f ... ]`, AND THE FILE DID NOT EXIST.
#   The branch was skipped in silence for the whole project, so every claim
#   about isolation rested on nothing the suite checked. A guard that quietly
#   does nothing when its subject is missing is worse than no guard: it reads
#   as covered.
#
#   Missing is now FATAL, and any error inside it fails the run.
if [ ! -f "$ROOT/db/tests/rls.sql" ]; then
  red "  ✗ db/tests/rls.sql is missing — isolation is unproven. Refusing to pass."
  exit 1
fi

echo "-- isolation, as pms_app -----------------------------------"
CLERK=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc   "select id from staff where email='agra@fidato.in'")
OTHER=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc   "select id from hotels where code='PUN'")
OWNER=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc \
  "select id from staff where email='owner@fidato.in'")

# Output is shown, not swallowed, and a failure exits non-zero. Piping straight
# into grep made the pipeline's status grep's own, so a raised exception here
# used to leave the whole run green.
RLS_OUT=$(PGPASSWORD=$APPPASS "$PSQL" -h $PGHOST -p $PGPORT -U pms_app -d "$DB"   -q -v ON_ERROR_STOP=1 -v clerk="$CLERK" -v other="$OTHER" -v owner="$OWNER"   -f "$ROOT/db/tests/rls.sql" 2>&1)
RLS_STATUS=$?

echo "$RLS_OUT" | sed '/^$/d' | sed 's/^psql:[^ ]*://' | head -20

if [ $RLS_STATUS -ne 0 ]; then
  red "  x ISOLATION FAILED - a tenant can reach another tenant data."
  exit 1
fi


# Local sign-in identities. NOT a migration — see db/dev/dev-identities.sql for
# why it must never become one.
#
# ⚠ AFTER the suite, not before. The demo staff (owner/agra/pune) and the two
#   properties are created by db/tests/suite.sql, not by 008_seed.sql — the seed
#   migration only creates the REPLACE bootstrap user. Running this first found
#   zero rows and failed its own assertion, which is the assertion working.
if [ -f "$ROOT/db/dev/dev-identities.sql" ]; then
  echo "── dev identities ─────────────────────────────────────────"
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -v ON_ERROR_STOP=1 -q     -f "$ROOT/db/dev/dev-identities.sql" 2>&1 | grep -viE "^(UPDATE|DO|$)" | head -5
fi

echo "── results ────────────────────────────────────────────────"
PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -c "select * from test.report();"

FAILED=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc \
  "select count(*) from test.results where not passed")

if [ "$FAILED" != "0" ]; then
  red "  $FAILED FAILED"
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -c "select * from test.failures();"
  exit 1
fi

TOTAL=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc "select count(*) from test.results")
green "  all $TOTAL assertions passed"
