#!/usr/bin/env bash
# =============================================================================
# migrate.sh — bring a REAL database up to date, without destroying it
# =============================================================================
# This is the one that touches `fidato`. It creates the database if it is not
# there, applies every migration in order, and stops on the first error. It
# NEVER drops anything.
#
# It exists because `db/tests/run.sh` used to do both jobs, and the second job
# is destructive. `run.sh` drops and rebuilds from zero — correct for proving
# the migrations apply to an empty database, catastrophic for the database the
# hotel is using. It wiped the live data four separate times, most recently
# taking the owner's own front-desk settings with it.
#
# So the two jobs are now two files, and only this one is aimed at the app's
# database:
#
#   db/migrate.sh          the live database, additive, never drops
#   db/tests/run.sh        a scratch database, dropped from zero every run
#   db/tests/rerun.sh      a scratch database, migrated TWICE
#
# The migrations are re-runnable — all 65 of them, proved by rerun.sh — so
# running this against a database that already has most of them is the normal
# case, not a special one. That is what an upgrade IS.
#
#   ./db/migrate.sh                 bring `fidato` up to date
#   DB=fidato_staging ./db/migrate.sh
#   ./db/migrate.sh --with-dev-identities   also link local sign-in accounts
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-C:/Users/rozar/AppData/Local/Temp/claude/D--PMS-FIDATO/6f5bb0bf-ad16-442f-bd1d-566b371924fa/scratchpad/pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
DB="${DB:-fidato}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PSQL="$PGBIN/psql.exe"
S="-h $PGHOST -p $PGPORT -U $SUPER"
export PGPASSWORD="$SUPERPASS"
export PGCLIENTENCODING=UTF8

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

# -- is the server even up? --------------------------------------------------
# Named separately because "database does not exist" and "postgres is not
# running" produce advice that cannot work for the other one.
if ! "$PSQL" $S -d postgres -tAc "select 1" >/dev/null 2>&1; then
  red "  x Postgres is not answering on $PGHOST:$PGPORT."
  echo "    Start it, then run this again:"
  echo "      pg_ctl -D <datadir> -l <logfile> -o '-p $PGPORT' start"
  echo "    Note the port — a plain start comes up on 5432 and every URL"
  echo "    in this project expects $PGPORT."
  exit 1
fi

# -- create only if absent ---------------------------------------------------
EXISTS=$("$PSQL" $S -d postgres -tAc \
  "select 1 from pg_database where datname = '$DB'")

if [ "$EXISTS" = "1" ]; then
  echo "── $DB exists — applying migrations on top ────────────────"
else
  echo "── $DB does not exist — creating it ───────────────────────"
  OUT=$("$PSQL" $S -d postgres -q -v ON_ERROR_STOP=1 \
        -c "create database $DB;" 2>&1)
  if [ $? -ne 0 ]; then
    red "  x Could not create $DB:"
    echo "$OUT" | sed 's/^/      /'
    exit 1
  fi
fi

# -- what is in there now, so the report can say what CHANGED ----------------
# A migration run that prints "65 applied" tells you nothing about whether the
# database moved. Counting the tables before and after does.
BEFORE=$("$PSQL" $S -d "$DB" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'" \
  2>/dev/null || echo 0)

echo "── migrations ─────────────────────────────────────────────"
N=0
for f in "$ROOT"/db/migrations/*.sql; do
  out=$("$PSQL" $S -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1)
  if [ $? -ne 0 ]; then
    red "  x $(basename "$f")"
    echo "$out" | grep -iE "ERROR|HINT" | head -4 | sed 's/^/      /'
    red "    Stopped here. The migrations before this one are applied;"
    red "    this one and everything after it are not."
    exit 1
  fi
  N=$((N + 1))
done

AFTER=$("$PSQL" $S -d "$DB" -tAc \
  "select count(*) from information_schema.tables where table_schema='public'")

green "  ✓ $N migrations applied to $DB"
if [ "$BEFORE" = "$AFTER" ]; then
  dim "    $AFTER tables — unchanged, so this database was already current."
else
  dim "    $BEFORE tables → $AFTER tables."
fi

# -- local sign-in, on request only ------------------------------------------
# NOT a migration, and deliberately opt-in. See db/dev/dev-identities.sql for
# why these must never ship as one.
if [ "${1:-}" = "--with-dev-identities" ]; then
  if [ -f "$ROOT/db/dev/dev-identities.sql" ]; then
    echo "── dev identities ─────────────────────────────────────────"
    "$PSQL" $S -d "$DB" -v ON_ERROR_STOP=1 -q \
      -f "$ROOT/db/dev/dev-identities.sql" 2>&1 \
      | grep -viE "^(UPDATE|DO|$)" | head -5
    green "  ✓ local sign-in accounts linked"
  else
    red "  x --with-dev-identities asked for, but db/dev/dev-identities.sql is missing"
    exit 1
  fi
fi

# -- what this did NOT do ----------------------------------------------------
# Said out loud, because the script it replaced did all of this and the habit
# is the dangerous part.
dim ""
dim "  Nothing was dropped, no fixture was loaded, and no property was"
dim "  created. This file only moves the schema forward."
