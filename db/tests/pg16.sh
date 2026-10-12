#!/usr/bin/env bash
# =============================================================================
# pg16.sh — the database suite and the replay, once more on PostgreSQL 16
# =============================================================================
# The live server runs PostgreSQL 16.15 (read 4 October); this PC tests on
# 17.6. Something only 17 understands would pass every other gate and stop the
# live update half-way (safely: one transaction, nothing changes). A plpgsql
# body is not checked until it runs, so the suite runs too, not only the
# migrations. The owner's yes, 4 October.
#
# A cluster of its own, made on first use, on port 55433, started for this run
# and stopped after it. The official 16.15 binaries (EnterpriseDB's
# postgresql-16.15-5-windows-x64-binaries.zip) are unzipped in .local/pg16/.
# One run at a time: gates.sh takes the database queue around it.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The MAIN checkout's .local/pg16, shared by every copy under
# .claude/worktrees, found through git's common directory. It was
# "D:/fidato pms/.local/pg16" until the project moved to another machine on
# 9 October (scripts/gates.sh finds its Postgres the same way).
MAIN="$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)/.." && { pwd -W 2>/dev/null || pwd; })"
PG16="${PG16:-$MAIN/.local/pg16}"
BIN="$PG16/pgsql/bin"
DATA="$PG16/data"
PORT=55433

[ -x "$BIN/pg_ctl.exe" ] || { echo "  x no PostgreSQL 16 in $BIN: unzip the 16.15 binaries there"; exit 1; }

# The same shape as the 17 cluster: UTF8, C collation, postgres/pw.
if [ ! -f "$DATA/PG_VERSION" ]; then
  pw="$PG16/initdb-pw.txt"
  echo pw > "$pw"
  "$BIN/initdb.exe" -D "$DATA" -U postgres --pwfile="$pw" -A scram-sha-256 -E UTF8 --locale=C > "$PG16/initdb.log" 2>&1
  code=$?; rm -f "$pw"
  [ $code -eq 0 ] || { echo "  x initdb failed; see $PG16/initdb.log"; exit 1; }
  echo "synchronous_commit = off" >> "$DATA/postgresql.conf"
fi

if ! "$BIN/pg_ctl.exe" -D "$DATA" status > /dev/null 2>&1; then
  "$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -l "$PG16/pg.log" -w -t 300 start > /dev/null \
    || { echo "  x PostgreSQL 16 did not start; see $PG16/pg.log"; exit 1; }
fi
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m fast -w stop > /dev/null 2>&1' EXIT INT TERM
"$BIN/postgres.exe" --version

PGBIN="$BIN" PGPORT=$PORT bash "$ROOT/db/tests/run.sh" || exit 1
PGBIN="$BIN" PGPORT=$PORT bash "$ROOT/db/tests/rerun.sh"
