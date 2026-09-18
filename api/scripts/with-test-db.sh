#!/usr/bin/env bash
# =============================================================================
# with-test-db.sh — the API tests get their own database
# =============================================================================
# DECISION D1 in MEMORY.md. Every file in `api/test` used to connect to the
# live `fidato` database: the one the demo loader fills, the one the dev server
# serves, the one somebody is clicking around in. That single decision produced
# ELEVEN defects, and they alternate direction —
#
#   clean up too little   the demo fills with phantom guests and bookings
#                         nobody can tell from real ones   (27 41 54 79 100
#                                                            112 114 115 116)
#   clean up too much     a teardown scoped `where hotel_id = $1` deletes a
#                         REAL banquet booking somebody just entered  (120)
#
# Both are the same root. A test that has to reason about which rows belong to
# somebody else is doing a job it should never have been given, and every fix
# so far made the teardowns CLEVERER — `id <> all($2)`, pid-tagged fixtures,
# recording ids in beforeAll, restoring a module flag to what it was. All of
# that is overhead that exists only because the database is shared.
#
# The pattern was already in this repo and this gate was the one that skipped
# it: `db/verify-backup.sh` restores into a scratch database and drops it
# whether it passes or fails, and `db/tests/run.sh` builds from zero.
#
# So: a scratch database per run, migrated, seeded with the demo, and dropped
# afterwards — pass or fail. The tests are unchanged and cannot reach anything
# real. Run them while somebody is using the app; nothing happens to it.
#
#   cd api && npm test              all of them
#   cd api && npm test -- pos       vitest's own filter, passed through
#   KEEP_TEST_DB=1 npm test         leave it behind to inspect
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-D:/fidato-pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
APPPASS="${APPPASS:-CHANGE_ME_app}"
DB="fidato_test_$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# WHICH psql. `$PGBIN/psql.exe` was hardcoded here, which is defect 188
# again — `restore.sh` carried the same line and could not run on the Linux
# box it existed for. `db/migrate.sh` was given this block when 188 was
# fixed; this file was missed, so the API gate was Windows-only. Same
# spelling as migrate.sh on purpose: a fourth variant of "find psql" is how
# the third one got missed.
if [ -n "${PSQL:-}" ]; then
  :                                       # told explicitly; use it
elif [ -x "$PGBIN/psql.exe" ]; then
  PSQL="$PGBIN/psql.exe"
elif [ -x "$PGBIN/psql" ]; then
  PSQL="$PGBIN/psql"
elif command -v psql >/dev/null 2>&1; then
  PSQL="$(command -v psql)"
else
  printf "[31m  x no psql found. Set PGBIN or PSQL.[0m
" >&2
  exit 1
fi
S="-h $PGHOST -p $PGPORT -U $SUPER"
export PGPASSWORD="$SUPERPASS"
export PGCLIENTENCODING=UTF8

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
dim()   { printf "\033[2m%s\033[0m\n" "$1"; }

drop_db() {
  if [ "${KEEP_TEST_DB:-}" = "1" ]; then
    dim "  test database kept: $DB"
    return
  fi
  # Anything still holding a connection would block the DROP. The pool is
  # closed by each file's afterAll, but a crashed run leaves one open.
  "$PSQL" $S -d postgres -q -c \
    "select pg_terminate_backend(pid) from pg_stat_activity
      where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null 2>&1
  "$PSQL" $S -d postgres -q -c "drop database if exists $DB" >/dev/null 2>&1
}
trap 'drop_db' EXIT

dim "-- a database for this test run only ----------------------"
"$PSQL" $S -d postgres -q -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null 2>&1 \
  || { red "  x could not create $DB — is Postgres running on $PGPORT?"; exit 1; }

# ⚠ IN THE SERVER'S TIME ZONE, NOT THIS MACHINE'S, and that is deliberate.
#
# The hotel's box keeps its database in GMT (`show timezone` on the server, 18
# September). This laptop keeps it in Asia/Kolkata. A bare timestamp means the
# SESSION's zone, so for weeks a banquet time stored here landed on the hotel's
# clock by luck and would have landed five and a half hours out in Akkalkot -
# and no test on this machine could tell (BQ-8, root MEMORY 297).
#
# UTC here makes every API test ask the question the live server asks. A test
# that needs a particular zone says so itself.
"$PSQL" $S -d postgres -q -v ON_ERROR_STOP=1   -c "alter database $DB set timezone to 'UTC'" >/dev/null 2>&1   || { red "  x could not set $DB to UTC"; exit 1; }
dim "   $DB · UTC, as the hotel's server runs"

for f in "$ROOT"/db/migrations/*.sql; do
  if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    red "  x $(basename "$f") failed"
    echo "$out" | grep -m1 "ERROR" | sed 's/^/      /'
    exit 1
  fi
done
dim "   $(ls "$ROOT"/db/migrations/*.sql | wc -l | tr -d ' ') migrations applied"

# THE DEMO STAFF COME FROM THE SUITE, not from a migration. `load-demo` grants
# agra@fidato.in a role at the property and its own comment says why — "the
# demo staff already exist (db/tests/suite.sql)". Migrations alone leave no
# staff at all, and the loader then fails on `undefined.id` several hundred
# rows in, which reads like a loader bug and is a missing fixture.
#
# `run.sh` applies these in the same order for the same reason.
# Both files in ONE psql invocation, the same way run.sh has always done it.
# Two harnesses that run the same files differently will eventually disagree
# about whether the code works, and the one that is wrong is whichever you ran
# second. There is no need for them to differ, so they no longer do.
#
# (This split was briefly blamed for a failure that was really a coin flip in
# suite.sql -- `select id into v_staff from staff order by id limit 1` over
# random uuids. Two samples of a coin flip correlate with whatever you changed
# between them; the real fix is at that line, and it took eight runs to be
# sure. Keeping the single invocation anyway, on the consistency argument
# above.)
if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1              -f "$ROOT/db/tests/harness.sql"              -f "$ROOT/db/tests/suite.sql" 2>&1); then
  red "  x the fixtures failed to load"
  echo "$out" | grep -m1 -iE "(ERROR|FATAL):" | sed 's/^/      /'
  exit 1
fi
dim "   fixtures seeded"

# Local sign-in identities. NOT a migration — db/dev/dev-identities.sql says
# at length why it must never become one.
if [ -f "$ROOT/db/dev/dev-identities.sql" ]; then
  "$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 \
    -f "$ROOT/db/dev/dev-identities.sql" >/dev/null 2>&1
fi

# Everything below this line talks to the scratch database and nothing else.
# `api/.env` is still read for the rest of the configuration, so these must be
# exported AFTER it would have been loaded — which is why the tests read
# process.env rather than the file.
export DATABASE_URL="postgres://pms_app:${APPPASS}@${PGHOST}:${PGPORT}/${DB}"
export SUPER_DATABASE_URL="postgres://${SUPER}:${SUPERPASS}@${PGHOST}:${PGPORT}/${DB}"

# ⚠ NO FIREBASE, EVER, FROM A TEST. `api/.env` on this machine carries the
# PRODUCTION Firebase admin key (poms-fad05) — installed for Stage 3 — and
# this script redirected the database but not that. So any test that got as
# far as `ensureAccount` created real accounts on the live sign-in service.
# On 15 September one did: a proof run against the takeover fix created
# owner@fidato.in and pune@fidato.in there (MEMORY 264). Empty, not unset:
# `process.loadEnvFile` fills only variables that are UNSET, so an empty one
# survives it, and env.ts reads "" as "no service account" — the tests sign
# in through the dev header, and anything reaching Firebase fails loudly.
export FIREBASE_SERVICE_ACCOUNT=""

# ⚠ THE TESTS NAME THEIR OWN CALLER. Every test here signs in with
# `x-dev-staff-id`, which only works with ALLOW_DEV_AUTH, and `env.ts` refuses
# to start with neither that nor a Firebase service account.
#
# It came from the developer's own `api/.env` until 18 September - a file that
# is not committed and cannot be - so the suite ran on the machines that
# happened to have one and nowhere else. On a Linux runner all sixty-two files
# loaded zero tests and the reason was one line down in the log. A harness that
# needs a file it does not create is not a harness.
#
# Safe here, and only here: this script is the test harness, the database it
# points at is a scratch one it made, and `env.ts` throws if this is ever on
# with NODE_ENV=production.
export ALLOW_DEV_AUTH=1

npx tsx scripts/load-demo.ts >/dev/null 2>&1 \
  || { red "  x the demo would not load into $DB"; npx tsx scripts/load-demo.ts; exit 1; }
dim "   demo loaded"
echo

npx vitest run "$@"
STATUS=$?

exit $STATUS
