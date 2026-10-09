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

PGBIN="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}"
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
#
# AND ALCOHOL, ON, WITH A RATE AND A SECTION SOLD UNDER IT (D21-90, D21-91).
# 067 used to drop and re-add the menu section's list of headings with its own
# narrow one; the first section set to alcohol would have stopped every deploy
# after it at 067. The 10 is this script's, not anybody's rate.
#
# AND A RESTAURANT BILL SETTLED TO THAT FUNCTION (28 September). 038 put back
# a payment list without 'function' over 099's, and the first bill settled to
# a banquet would have stopped every deploy after it at 038.
#
# AND FOUR MORE, found 10 October on the local demo before a release (MEMORY
# 403): a BREAKAGE of crockery (112 put back a kind list without 180's
# 'breakage'), a room's PHONE link (121 without 181's 'room-phone'), a booking
# with a promotion in RUPEES (146's discount rule without 191's discount_amount)
# and a hotel whose default payment method is ITS OWN (187's four-word check,
# which 191 took away). Each would have stopped the next release at that file.
if ! out=$("$PSQL" $S -d "$DB" -q -v ON_ERROR_STOP=1 \
     -c "insert into hotels (code, name, city) values ('RRN','Rerun Property','Nowhere')" \
     -c "insert into hotel_modules (hotel_id, module, is_enabled)
         select id, m, true
           from hotels, unnest(array['channel_manager','laundry','spa','alcohol']) as m
          where code = 'RRN'" \
     -c "insert into tax_rules (hotel_id, kind, over_amount, rate)
         select id, 'alcohol', 0, 10 from hotels where code = 'RRN'" \
     -c "insert into pos_menu_categories (hotel_id, name, tax_kind)
         select id, 'Rerun Spirits', 'alcohol' from hotels where code = 'RRN'" \
     -c "with people as (
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
         select hotel_id, id, 'open' from fn" \
     -c "with who as (select id from staff where email like 'rerun-%' limit 1),
         outlet as (
           insert into pos_outlets (hotel_id, code, name, staff_id)
           select h.id, 'RRN-REST', 'Rerun Restaurant', who.id
             from hotels h, who where h.code = 'RRN'
           returning id, hotel_id)
         insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                                 status, settled_by, settled_at, payment_method,
                                 event_id, opened_by)
         select outlet.hotel_id, outlet.id, 'RRN-1', current_date,
                'settled', who.id, now(), 'function', e.id, who.id
           from outlet, who, banquet_events e where e.reference = 'BQ-RERUN-1'" \
     -c "with h as (select id from hotels where code = 'RRN'),
         item as (insert into stock_items (hotel_id, name, unit, crockery)
                  select id, 'Rerun Plate', 'piece', true from h returning id, hotel_id)
         insert into stock_movements (hotel_id, item_id, business_date, kind, quantity, location_id)
         select item.hotel_id, item.id, current_date, 'breakage', -1,
                (select l.id from locations l where l.hotel_id = item.hotel_id and l.kind = 'store' limit 1)
           from item" \
     -c "with h as (select id from hotels where code = 'RRN'),
         rt as (insert into room_types (hotel_id, code, name)
                select id, 'RRT', 'Rerun Type' from h returning id, hotel_id),
         rm as (insert into rooms (hotel_id, room_type_id, number)
                select hotel_id, id, '901' from rt returning id, hotel_id)
         insert into guest_links (hotel_id, token_hash, origin, room_id, expires_at)
         select hotel_id, 'rerun-room-phone', 'room-phone', id, now() + interval '1 day' from rm" \
     -c "with h as (select id from hotels where code = 'RRN'),
         promo as (insert into room_promotions (hotel_id, name, amount)
                   select id, 'Rerun Rupees Off', 100 from h returning id, hotel_id),
         g as (insert into guests (full_name) values ('Rerun Guest') returning id)
         insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                   agreed_rate, room_promotion_id, discount_amount)
         select promo.hotel_id, 'RRN-RES-1', g.id, rt.id, current_date + 30, current_date + 31,
                1000, promo.id, 100
           from promo, g, room_types rt where rt.code = 'RRT' and rt.hotel_id = promo.hotel_id" \
     -c "insert into payment_methods (hotel_id, label, kind)
         select id, 'Rerun Wallet', 'wallet' from hotels where code = 'RRN'" \
     -c "update hotels set default_payment_method = 'Rerun Wallet' where code = 'RRN'" 2>&1); then
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
