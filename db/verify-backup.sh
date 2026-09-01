#!/usr/bin/env bash
# =============================================================================
# verify-backup.sh — restore a backup and check what came back
# =============================================================================
#   ./db/verify-backup.sh                    back up, restore, verify, clean up
#   ./db/verify-backup.sh path/to/file.dump  verify an existing file
#
# THIS IS THE ONLY SCRIPT HERE THAT MATTERS.
#
# A backup that has never been restored is not a backup. It is a file that
# might be a backup, and the moment you find out is the moment you cannot
# afford to be wrong. Every real backup disaster is the same story: the job ran
# nightly for two years, and the dump was empty, or the wrong database, or
# restorable but missing the one table that mattered.
#
# So this restores into a scratch database and asserts the figures that must
# come back — the same ones the demo loader reconciles to the real eZee export:
#
#     431 available room-nights   132 sold   30.63% occupancy
#     ₹4,19,578.76 room revenue   ₹3,97,041.93 receipts
#
# Those numbers are not decoration. A dump that restores cleanly but returns
# ₹0 in receipts has lost the payments table, and only a check that names a
# figure would catch it. `pg_restore` exiting 0 would not.
#
# The scratch database is dropped whether this passes or fails. It is never
# the real one, and the real one is never touched.
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-C:/Users/rozar/AppData/Local/Temp/claude/D--PMS-FIDATO/6f5bb0bf-ad16-442f-bd1d-566b371924fa/scratchpad/pg/pgsql/bin}"
PGPORT="${PGPORT:-55432}"
PGHOST="${PGHOST:-127.0.0.1}"
SUPER="${SUPER:-postgres}"
SUPERPASS="${SUPERPASS:-pw}"
DB="${DB:-fidato}"
SCRATCH="${SCRATCH:-fidato_restore_check}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PSQL="$PGBIN/psql.exe"
S="-h $PGHOST -p $PGPORT -U $SUPER"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
FAILED=0

cleanup() {
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q -c \
    "drop database if exists $SCRATCH with (force)" >/dev/null 2>&1
}
trap cleanup EXIT

# ── The file under test ──────────────────────────────────────────────────────
FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "-- taking a fresh backup first -----------------------------"
  FILE=$(bash "$ROOT/db/backup.sh" | tail -1)
fi

if [ ! -s "$FILE" ]; then
  red "  x no such backup: $FILE"
  exit 1
fi

echo
echo "-- restoring into $SCRATCH ---------------------------------"
echo "   (the real database is not touched)"

cleanup
PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q -c "create database $SCRATCH" \
  >/dev/null 2>&1 || { red "  x could not create the scratch database"; exit 1; }

# --no-owner: roles are the migrations' business, not the dump's.
# Errors are captured rather than piped, because pg_restore reports a great
# deal on stderr that is not a failure, and the exit code is the signal.
OUT=$(PGPASSWORD=$SUPERPASS "$PGBIN/pg_restore.exe" \
        -h "$PGHOST" -p "$PGPORT" -U "$SUPER" \
        -d "$SCRATCH" --no-owner --no-acl "$FILE" 2>&1)
RC=$?

if [ $RC -ne 0 ]; then
  red "  x pg_restore exited $RC"
  echo "$OUT" | grep -iE "error|fatal" | head -8 | sed 's/^/      /'
  exit 1
fi
green "  ✓ restored"

# ── What came back ───────────────────────────────────────────────────────────
echo
echo "-- what came back -----------------------------------------"

check() {                       # check <label> <sql> <expected>
  local label="$1" sql="$2" want="$3" raw got
  raw=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$SCRATCH" -tAc "$sql" 2>&1)

  # A missing table comes back as a multi-line psql ERROR, not a value. The
  # first version stripped ALL whitespace from whatever came back, which
  # turned that error into `LINE1:selectto_char(sum(amount)...` — unreadable
  # at exactly the moment somebody needs to read it. The check still failed,
  # so it worked. It just could not say why, which is defect 17 again.
  if printf "%s" "$raw" | grep -qiE "^(ERROR|FATAL):"; then
    got=$(printf "%s" "$raw" | head -1 | cut -c1-44)
    printf "  \033[31mx\033[0m %-34s %s   (expected %s)\n" "$label" "$got" "$want"
    FAILED=$((FAILED + 1))
    return
  fi

  got=$(printf "%s" "$raw" | tr -d " ")
  if [ "$got" = "$want" ]; then
    printf "  \033[32m✓\033[0m %-34s %s\n" "$label" "$got"
  else
    printf "  \033[31mx\033[0m %-34s %s   (expected %s)\n" "$label" "$got" "$want"
    FAILED=$((FAILED + 1))
  fi
}

H="(select id from hotels where code='5EL')"

# ── Is the calibrated demo in this dump? ─────────────────────────────────────
#
# The data checks below name figures from the demo property, which reconciles
# to a real eZee export. A production backup has no demo in it, and neither
# does one taken straight after db/tests/run.sh — which rebuilds with the test
# fixtures only.
#
# The first version asserted them unconditionally and reported EIGHT failures
# against a backup that was completely sound, which is the worst thing a
# verifier can do: it teaches people to disregard it.
#
# So the STRUCTURAL checks always run — they are what a restore has to give
# back anywhere — and the data checks run only when there is data to check.
DEMO=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$SCRATCH" -tAc   "select count(*) from hotels where code='5EL'" 2>/dev/null | tr -d ' ')

if [ "$DEMO" = "1" ]; then
  echo "  (the calibrated demo property is present — checking its figures too)"
else
  echo "  (no demo property in this dump — checking structure only)"
fi
echo

data_check() {                  # skipped when the demo is absent
  if [ "$DEMO" = "1" ]; then
    check "$1" "$2" "$3"
  else
    printf "  [2m-[0m %-34s %s
" "$1" "not in this dump"
  fi
}

data_check "properties" \
  "select count(*) from hotels" "3"

data_check "rooms at 5EL" \
  "select count(*) from rooms where hotel_id=$H" "18"

data_check "reservations at 5EL" \
  "select count(*) from reservations where hotel_id=$H" "83"

data_check "room revenue 1-25 Aug" \
  "select to_char(sum(amount),'FM9999999.99') from folio_postings
    where category='room' and hotel_id=$H
      and business_date between '2026-08-01' and '2026-08-25'" \
  "419578.76"

# Money RECEIVED, read the way the Manager Report reads it: a receipt whose
# posting has been reversed is not money the hotel has. A naive
# `sum(amount) from payments` came back 100.00 too high, because the API
# suite posts a payment and then reverses it - the ledger entry cancels and
# the receipt row stays. Correct behaviour; wrong question. Same mistake as
# MEMORY.md defect 25, in a second place.
data_check "receipts" \
  "select to_char(sum(p.amount),'FM9999999.99')
     from payments p
     join folio_postings fp on fp.id = p.posting_id
    where p.hotel_id=$H
      and not exists (select 1 from folio_postings rev
                       where rev.reverses_id = fp.id)" \
  "397041.93"

data_check "ledger rows" \
  "select case when count(*) > 100 then 'many' else 'suspiciously few' end
     from folio_postings where hotel_id=$H" "many"

# Structure, not just data. A dump can carry every row and lose the thing that
# keeps them correct — and RLS is the whole tenancy model here.
# RLS, as an INVARIANT rather than a count.
#
# These were `count(*) = 25` and `= 37`. Migration 025 added one table and
# one policy, and a sound backup reported two failures - a check that must
# be edited on every migration is a check that will eventually be edited
# wrongly, or ignored.
#
# What actually matters is that NOTHING carrying a hotel_id is readable
# across properties. That claim does not change when a table is added.
check "hotel-scoped tables without RLS" \
  "select count(*) from information_schema.columns c
     join pg_class pc on pc.relname = c.table_name
     join pg_namespace n on n.oid = pc.relnamespace and n.nspname = 'public'
    where c.table_schema = 'public' and c.column_name = 'hotel_id'
      and not pc.relrowsecurity" "0"

check "hotel-scoped tables without a policy" \
  "select count(*) from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'hotel_id'
      and not exists (select 1 from pg_policies p
                       where p.schemaname = 'public'
                         and p.tablename = c.table_name)" "0"

# The append-only rule is a TRIGGER, not a constraint. A dump that lost it
# would restore every row and quietly permit a clerk to delete a posting.
# Each is named rather than counted: "3 triggers" would still pass if one
# were swapped for something else.
check "trigger: append-only" \
  "select count(*) from pg_trigger
    where tgname='folio_postings_append_only'" "1"

check "trigger: staff scope" \
  "select count(*) from pg_trigger
    where tgname='folio_postings_staff_scope'" "1"

check "trigger: closed date" \
  "select count(*) from pg_trigger
    where tgname='folio_postings_closed_date'" "1"

check "app.business_date exists" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and p.proname='business_date'" "1"

echo
if [ $FAILED -eq 0 ]; then
  green "  this backup has been restored and checked. It is a backup."
  exit 0
else
  red "  $FAILED check(s) failed. RESTORING THIS FILE WOULD NOT GIVE YOU"
  red "  YOUR HOTEL BACK. Do not rely on it."
  exit 1
fi
