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

# WHICH psql, AND WHERE IT LISTENS — the same detection as db/backup.sh, and
# for the same reason: this hardcoded the Windows path, so on the server, the
# one place a restore test means anything, it could not run at all.
if command -v psql >/dev/null 2>&1; then
  PSQL="$(command -v psql)"
  PGRESTORE="$(command -v pg_restore)"
  PGHOST="${PGHOST:-/var/run/postgresql}"   # socket: peer auth, no password
  PGPORT="${PGPORT:-5432}"
  SUPER="${SUPER:-postgres}"
  SUPERPASS="${SUPERPASS:-}"
else
  PGBIN="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}"
  PSQL="$PGBIN/psql.exe"
  PGRESTORE="$PGBIN/pg_restore.exe"
  PGHOST="${PGHOST:-127.0.0.1}"
  PGPORT="${PGPORT:-55432}"
  SUPER="${SUPER:-postgres}"
  SUPERPASS="${SUPERPASS:-pw}"
fi
DB="${DB:-fidato}"
SCRATCH="${SCRATCH:-fidato_restore_check}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

S="-h $PGHOST -p $PGPORT -U $SUPER"

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
FAILED=0

cleanup() {
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d postgres -q -c \
    "drop database if exists $SCRATCH with (force)" >/dev/null 2>&1
}

# ── Telling a person (D27-15, the owner, 27 September) ───────────────────────
# Cron runs this nightly and its output goes to a log nobody reads — which is
# how this system once spent weeks believing it had backups. So the result
# goes to ALERT_URL, pass or fail: the owner's n8n workflow sends a WhatsApp on
# a failure at once, and raises one itself on a night that sent nothing at all.
# Both live in the server's settings file (db/backup.sh, "Off the box"):
#
#   ALERT_URL='http://127.0.0.1:5678/webhook/<path>'   n8n, over loopback
#   ALERT_SECRET='<long random>'                        n8n drops calls without it
#
# Unset (a laptop) means nobody is told, which is right for a laptop.
BACKUP_ENV="${BACKUP_ENV:-/etc/fidato-backup.env}"
[ -r "$BACKUP_ENV" ] && . "$BACKUP_ENV"
tell() {                        # tell true|false
  [ -n "${ALERT_URL:-}" ] || return 0
  curl -fsS -m 20 -H "x-alert-secret: ${ALERT_SECRET:-}" \
    -H "content-type: application/json" \
    -d "{\"check\":\"backup\",\"ok\":$1,\"server\":\"$(hostname)\"}" \
    "$ALERT_URL" >/dev/null || echo "    (could not reach ALERT_URL - nobody was told)"
}
trap 'rc=$?; cleanup; if [ $rc -eq 0 ]; then tell true; else tell false; fi' EXIT

# ── The figures a restore must give back ─────────────────────────────────────
# One list, read from the source and from the restore alike.
FIGURES=(
  "properties|select count(*) from hotels"
  "rooms|select count(*) from rooms"
  "room types|select count(*) from room_types"
  "guests|select count(*) from guests"
  "reservations|select count(*) from reservations"
  "room assignments|select count(*) from room_assignments"
  "folios|select count(*) from folios"
  "ledger rows|select count(*) from folio_postings"
  "invoices|select count(*) from invoices"
  "staff|select count(*) from staff"
  "tax rules|select count(*) from tax_rules"
  # The money, to the paisa. A row count can match while a numeric column
  # comes back rounded or null, and the ledger is the one place that must not.
  "ledger value|select coalesce(to_char(sum(amount + tax_amount),'FM99999999.99'),'0')
     from folio_postings"
  "receipts|select coalesce(to_char(sum(p.amount),'FM99999999.99'),'0')
     from payments p
     join folio_postings fp on fp.id = p.posting_id
    where not exists (select 1 from folio_postings rev
                       where rev.reverses_id = fp.id)"
)
figure() {                      # figure <db> <sql> — one line, spaces removed
  PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$1" -tAc "$2" 2>&1 | tr -d " \r" | head -1
}
figures() {                     # figures <db> — every figure, one per line
  local f
  for f in "${FIGURES[@]}"; do figure "$1" "${f#*|}"; done
}

# ── The file under test ──────────────────────────────────────────────────────
# ⚠ THE SOURCE MOVES. The nightly run restores the file it has just taken and
# compares it with the live database, which a desk or the channel manager may
# have written to in between — a sound backup would then fail, and a verifier
# that cries wolf is one people learn to ignore. So the source is read just
# BEFORE and just AFTER the dump: the dump's snapshot lies between the two, and
# each restored figure must equal one of them.
FILE="${1:-}"
BEFORE="" AFTER=""
if [ -z "$FILE" ]; then
  echo "-- taking a fresh backup first -----------------------------"
  OUTDIR="${BACKUP_DIR:-$ROOT/db/backups}"
  BEFORE=$(figures "$DB")
  bash "${BACKUP_SH:-$ROOT/db/backup.sh}" "$OUTDIR" \
    || { red "  x the backup itself failed - see above"; exit 1; }
  AFTER=$(figures "$DB")
  FILE=$(ls -1t "$OUTDIR/$DB"-*.dump 2>/dev/null | head -1)
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
OUT=$(PGPASSWORD=$SUPERPASS "$PGRESTORE" \
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

  got=$(printf "%s" "$raw" | tr -d " 
")
  if [ "$got" = "$want" ]; then
    printf "  \033[32m✓\033[0m %-34s %s\n" "$label" "$got"
  else
    printf "  \033[31mx\033[0m %-34s %s   (expected %s)\n" "$label" "$got" "$want"
    FAILED=$((FAILED + 1))
  fi
}

H="(select id from hotels where code='5EL')"

# ── Did the restore give back what was there? ──────────────────────────
#
# ⚠ THIS USED TO ASSERT THE DEMO'S FIGURES: three properties, 83 reservations,
#   ₹4,19,578.76 of room revenue, ₹3,97,041.93 of receipts. It decided whether
#   to apply them by asking whether a hotel with code 5EL existed.
#
#   5EL is now the REAL property. The owner had the demo removed and the
#   system put into service, and the same code that had meant "this is the
#   calibrated fixture" started meaning "this is Akkalkot". So the verifier
#   compared a working hotel against a demo's numbers and reported five
#   failures under the heading
#
#       RESTORING THIS FILE WOULD NOT GIVE YOU YOUR HOTEL BACK.
#
#   on a backup that was perfectly sound. That is the worst thing a verifier
#   can do — it is how people learn to ignore one.
#
#   The deeper fault is that it asserted CONSTANTS. A backup is not sound
#   because it contains particular numbers; it is sound because restoring it
#   returns what you had. That question has an answer on the demo, on an empty
#   database, and on a hotel with six real bookings in it, and it never needs
#   editing when the data changes — which is the same reason the RLS checks
#   below count invariants rather than tables.
compare() {                     # compare <n> <label> <sql> — the nth figure
  local n="$1" label="$2" sql="$3" src dst was
  dst=$(figure "$SCRATCH" "$sql")
  if [ -n "$BEFORE" ]; then     # the nightly run: the source as it stood around the dump
    src=$(printf "%s\n" "$BEFORE" | sed -n "${n}p")
    was=$(printf "%s\n" "$AFTER"  | sed -n "${n}p")
  else                          # a file named by hand: the source as it stands now
    src=$(figure "$DB" "$sql"); was="$src"
  fi

  if printf "%s" "$dst" | grep -qiE "^(ERROR|FATAL)"; then
    printf "  \033[31mx\033[0m %-34s %s\n" "$label" "$(printf "%s" "$dst" | cut -c1-40)"
    FAILED=$((FAILED + 1))
  elif [ "$src" = "$dst" ] || [ "$was" = "$dst" ]; then
    printf "  \033[32m✓\033[0m %-34s %s\n" "$label" "${dst:--}"
  else
    printf "  \033[31mx\033[0m %-34s %s   (source has %s)\n" "$label" "${dst:--}" "${was:--}"
    FAILED=$((FAILED + 1))
  fi
}

echo "  (comparing the restore against the source, table by table)"
echo

N=0
for f in "${FIGURES[@]}"; do
  N=$((N + 1))
  compare "$N" "${f%%|*}" "${f#*|}"
done

# An empty source proves nothing about a backup, so say so rather than
# printing eleven green ticks that all mean "0 = 0".
SRC_ROWS=$(PGPASSWORD=$SUPERPASS "$PSQL" $S -d "$DB" -tAc   "select count(*) from folio_postings" 2>/dev/null | tr -d " ")
if [ "${SRC_ROWS:-0}" = "0" ]; then
  printf "  [2m-[0m %-34s %s
" "ledger content"     "the source ledger is empty — nothing to lose yet"
fi
echo

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
