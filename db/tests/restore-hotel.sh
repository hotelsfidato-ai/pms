#!/usr/bin/env bash
# =============================================================================
# restore-hotel.sh - deploy/restore-hotel.sh, proved on scratch databases
# =============================================================================
#   bash db/tests/restore-hotel.sh
#
# Builds a "live" database from the migrations, the suite's two hotels (AGR,
# PUN) and the demo hotel (5EL), backs it up with db/backup.sh, then deletes
# by mistake one 5EL booking with its bill and its guest, and the guest's ID
# documents (D27-376) - as only a slip with the guards off could - and checks
# that the tool:
#
#   shows them; changes nothing on a look, or without the code typed again;
#   lists the ID photo coming back, to be opened in the PMS (it is in Drive);
#   brings back the booking, the bill, the guest and the guest's ID documents,
#   parents first, as they were - and no ID document of a guest still in live;
#   leaves the bill lines (append-only) and the invoice series (kept
#   apart) to the owner; never overwrites a row changed since; leaves every
#   other hotel's rows exactly as they were; reads a copy already restored
#   (A3's way) without dropping it; and refuses a hotel whose own row is gone.
#
# Every database it makes is fidato_test_restore_*, and all are dropped.
# =============================================================================
set -uo pipefail

PGBIN="${PGBIN:-D:/fidato pms/.local/pg/pgsql/bin}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-55432}" PGUSER=postgres
export PGPASSWORD="${SUPERPASS:-pw}" PGCLIENTENCODING=UTF8 PGTZ=UTC
if [ -x "$PGBIN/psql.exe" ]; then PSQL="$PGBIN/psql.exe" PGRESTORE="$PGBIN/pg_restore.exe"
else PSQL="$PGBIN/psql" PGRESTORE="$PGBIN/pg_restore"; fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TOOL="$ROOT/deploy/restore-hotel.sh"

LIVE="fidato_test_restore_live_$$"
COPY="fidato_test_restore_copy_$$"          # a copy already restored (A3's way)
GONE="fidato_test_restore_gone_$$"          # a live database whose hotel is gone
TMP="$(mktemp -d)"
q() { "$PSQL" -X -q -v ON_ERROR_STOP=1 -tA -d "$@"; }

red()   { printf "\033[31m%s\033[0m\n" "$1"; }
green() { printf "\033[32m%s\033[0m\n" "$1"; }
PASS=0 FAIL=0
ok() {                          # ok <what> <condition...>
  local what="$1"; shift
  if "$@"; then PASS=$((PASS + 1)); green "  ✓ $what"
  else FAIL=$((FAIL + 1)); red "  x $what"; fi
}
has() { printf '%s' "$1" | tr -s ' ' | grep -qE -- "$2"; }   # has <text> <regex>, spaces squeezed

cleanup() {
  for d in "$LIVE" "$COPY" "$GONE"; do
    q postgres -c "drop database if exists $d with (force)" >/dev/null 2>&1
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

# ── A live database: the migrations, the suite's hotels, the demo hotel ─────
echo "-- building $LIVE ------------------------------------------"
q postgres -c "create database $LIVE" || exit 1
q postgres -c "alter database $LIVE set timezone to 'UTC'"
for f in "$ROOT"/db/migrations/*.sql "$ROOT/db/ownership.sql"; do
  q "$LIVE" -f "$f" >/dev/null 2>&1 || { red "  x $(basename "$f")"; exit 1; }
done
q "$LIVE" -f "$ROOT/db/tests/harness.sql" -f "$ROOT/db/tests/suite.sql" >/dev/null 2>&1 \
  || { red "  x the suite's fixtures"; exit 1; }
( cd "$ROOT/api" && SUPER_DATABASE_URL="postgres://postgres:$PGPASSWORD@$PGHOST:$PGPORT/$LIVE" \
    DATABASE_URL="postgres://pms_app:CHANGE_ME_app@$PGHOST:$PGPORT/$LIVE" ALLOW_DEV_AUTH=1 \
    FIREBASE_SERVICE_ACCOUNT="" npx tsx scripts/load-demo.ts >/dev/null 2>&1 ) \
  || { red "  x the demo would not load"; exit 1; }

H5=$(q "$LIVE" -c "select id from hotels where code = '5EL'")
# A 5EL booking with a bill that has lines and a payment, whose guest has no
# other booking.
read -r RES FOLIO GUEST <<EOF
$(q "$LIVE" -F ' ' -c "
  select r.id, f.id, r.guest_id from reservations r join folios f on f.reservation_id = r.id
   where r.hotel_id = '$H5'
     and exists (select 1 from payments y join folio_postings p on p.id = y.posting_id where p.folio_id = f.id)
     and (select count(*) from reservations o where o.guest_id = r.guest_id) = 1
     and (select count(*) from folios o where o.reservation_id = r.id) = 1
   order by r.id limit 1")
EOF
[ -n "$FOLIO" ] || { red "  x the demo has no booking to test with"; exit 1; }

# The guest's ID documents (D27-376): what their ID says (guest_documents) and
# their ID photo's row (the photo itself is in Google Drive, D27-209). And a
# guest with no 5EL booking, who stays in live and loses their ID document alone.
STAFF=$(q "$LIVE" -c "select id from staff order by id limit 1")
OTHER=$(q "$LIVE" -c "select g.id from guests g where g.test_hotel_id is null
                        and not exists (select 1 from reservations r where r.guest_id = g.id and r.hotel_id = '$H5')
                      order by g.id limit 1")
[ -n "$OTHER" ] || { red "  x no guest outside 5EL to test with"; exit 1; }
q "$LIVE" >/dev/null <<SQL || { red "  x the guest's ID documents would not go in"; exit 1; }
insert into guest_documents (guest_id, id_type, id_number, country, captured_at)
values ('$GUEST', 'passport', 'Z1234567', 'IN', now()), ('$OTHER', 'passport', 'Y7654321', 'IN', now())
    on conflict (guest_id) do nothing;
insert into guest_id_photos (hotel_id, hotel_code, reservation_id, guest_id, uploaded_by, sides,
                             notice_version, status, stored_at, drive_file_id, cipher_sha256, cipher_bytes)
values ('$H5', '5EL', '$RES', '$GUEST', '$STAFF', '{front,back}', '2026-09-30', 'stored', now(),
        'restore-test-drive-file', repeat('a', 64), 1234);
SQL
docs() { q "$LIVE" -c "select count(*) || ' ' || coalesce(md5(string_agg(t, '' order by t)), '') from (
  select md5(x::text) t from guest_documents x where guest_id = '$GUEST' union all
  select md5(x::text) from guest_id_photos x where guest_id = '$GUEST') s"; }
RESREF=$(q "$LIVE" -c "select reference from reservations where id = '$RES'")
GNAME=$(q "$LIVE" -c "select full_name from guests where id = '$GUEST'")

# What each of those rows was, and every other hotel's rows: to compare after.
row() { q "$LIVE" -c "select md5(x::text) from $1 x where id = '$2'"; }
OTHERS="
  select md5(string_agg(t, '' order by t)) from (
    select md5(x::text) t from reservations x where hotel_id <> '$H5' union all
    select md5(x::text) from folios x where hotel_id <> '$H5' union all
    select md5(x::text) from folio_postings x where hotel_id <> '$H5' union all
    select md5(x::text) from room_assignments x where hotel_id <> '$H5' union all
    select md5(x::text) from rooms x where hotel_id <> '$H5' union all
    select md5(x::text) from audit_log x where hotel_id <> '$H5' union all
    select md5(x::text) from invoice_series x where hotel_id <> '$H5' union all
    select md5(x::text) from guest_documents x where guest_id not in ('$GUEST', '$OTHER') union all
    select md5(x::text) from guests x where id <> '$GUEST') s"
WAS_RES=$(row reservations "$RES") WAS_FOLIO=$(row folios "$FOLIO") WAS_GUEST=$(row guests "$GUEST")
WAS_DOCS=$(docs)
case "$WAS_DOCS" in "2 "?*) ;; *) red "  x the guest's ID documents did not all go in ($WAS_DOCS)"; exit 1 ;; esac
WAS_OTHERS=$(q "$LIVE" -c "$OTHERS")
POSTINGS=$(q "$LIVE" -c "select count(*) from folio_postings where folio_id = '$FOLIO'")

# ── The backup, as the server takes it ──────────────────────────────────────
DB="$LIVE" PGBIN="$PGBIN" BACKUP_ENV=/nonexistent bash "$ROOT/db/backup.sh" "$TMP" >/dev/null 2>&1
FILE=$(ls -1 "$TMP"/*.dump 2>/dev/null | head -1)
[ -s "$FILE" ] || { red "  x db/backup.sh made no file"; exit 1; }

# ── The mistake ─────────────────────────────────────────────────────────────
# Only someone with the database's own keys, and its guards switched off, can
# do this: the ledger and the guest refuse a delete otherwise.
q "$LIVE" >/dev/null <<SQL || { red "  x the mistake would not happen"; exit 1; }
begin;
alter table folio_postings disable trigger user;
alter table guests disable trigger user;
delete from payments where posting_id in (select id from folio_postings where folio_id = '$FOLIO');
delete from folio_postings where folio_id = '$FOLIO';
delete from folios where id = '$FOLIO';
delete from room_assignments where reservation_id = '$RES';
delete from guest_id_photos where reservation_id = '$RES';
delete from guest_documents where guest_id = '$GUEST';
delete from reservations where id = '$RES';
delete from guests where id = '$GUEST';
delete from guest_documents where guest_id = '$OTHER';
delete from invoice_series where hotel_id = '$H5';
alter table folio_postings enable trigger user;
alter table guests enable trigger user;
-- and one row the desk changed since the backup
update rooms set floor = 77
 where id = (select id from rooms where hotel_id = '$H5' order by number limit 1);
commit;
SQL
CHANGED_ROOM=$(q "$LIVE" -c "select id from rooms where floor = 77")
gone() { [ -z "$(q "$LIVE" -c "select 1 from $1 where id = '$2'")" ]; }

run() {                          # run <live db> <args...> - stdin is what is typed
  OUT=$(DB="$1" SCRATCH_DB="fidato_test_restore_scratch_$$" PGBIN="$PGBIN" bash "$TOOL" "${@:2}" 2>&1)
  RC=$?
}
step() { printf '%s' "$OUT" | tr -s ' ' | grep -E "^ [0-9]+ \| $1 \|" | awk '{print $1}'; }

# ── A look ──────────────────────────────────────────────────────────────────
echo "-- a look ------------------------------------------------------"
run "$LIVE" 5EL "$FILE" </dev/null
ok "a look exits 0" [ "$RC" = 0 ]
ok "it shows the booking missing" has "$OUT" "reservations \| trading \| [0-9]+ \| 1 \|"
ok "...its bill" has "$OUT" "folios \| trading \| [0-9]+ \| 1 \|"
ok "...and its guest, as a shared row the booking needs" has "$OUT" "guests \| shared \| \| 1 \|"
ok "it shows the room changed since" has "$OUT" "rooms \| setup \| [0-9]+ \| 0 \| [1-9]"
ok "the bill's lines stay missing: append-only" has "$OUT" "folio_postings \| $POSTINGS \| append-only"
ok "the payment stays missing: it needs a bill line" \
  has "$OUT" "payments \| [0-9]+ \| needs a row that stays missing \(folio_postings\)"
ok "the invoice series stays missing: kept apart" has "$OUT" "invoice_series \| 1 \| kept apart"
STEPS=$(printf '%s' "$OUT" | tr -s ' ' | grep -E '^ [0-9]+ \| (guests|reservations|folios) ' | awk '{print $3}' | tr '\n' ' ')
ok "the guest comes back before the booking, the booking before its bill ($STEPS)" \
  [ "$STEPS" = "guests reservations folios " ]
ok "it shows what the guest's ID says (guest_documents) missing, coming back with the guest" \
  has "$OUT" "guest_documents \| shared \| \| 1 \|"
ok "...after the guest (step $(step guest_documents), the guest's $(step guests))" \
  [ "$(step guest_documents)" -gt "$(step guests)" ] 2>/dev/null
ok "...the ID photo's row" has "$OUT" "guest_id_photos \| trading \| [0-9]+ \| 1 \|"
ok "...listed: the photo is in Google Drive, out of the tool's reach" \
  has "$OUT" "ID PHOTOS coming back - the photo itself is in Google Drive"
ok "...by its booking ($RESREF), to be opened once in the PMS" \
  has "$OUT" "^ $RESREF \| \[\"front\", \"back\"\] \|"
ok "...never by the guest's name" eval '! printf "%s" "$OUT" | grep -qF -- "$GNAME"'
ok "the scratch copy of the backup is dropped" \
  [ -z "$(q postgres -c "select 1 from pg_database where datname = 'fidato_test_restore_scratch_$$'")" ]
ok "a look changes nothing" gone reservations "$RES"
ok "...nor the ID documents" [ "$(docs)" = "0 " ]

# ── The second step, refused ────────────────────────────────────────────────
echo "-- the second step, refused ------------------------------------"
run "$LIVE" 5EL "$FILE" --bring-back <<< "AGR"
ok "the wrong code typed: refused" [ "$RC" = 1 ]
ok "...and nothing changed" gone reservations "$RES"
ok "...nor the guest" gone guests "$GUEST"
ok "...nor the guest's ID documents" [ "$(docs)" = "0 " ]

# ── A3's way: a copy already in a database, which is read and kept ──────────
echo "-- from a database already restored ----------------------------"
q postgres -c "create database $COPY" && "$PGRESTORE" -d "$COPY" --no-owner --no-acl "$FILE" >/dev/null 2>&1
run "$LIVE" 5EL "$COPY" </dev/null
ok "a database as the copy: the same look" has "$OUT" "can come back: [1-9][0-9]* rows"
ok "...and that database is kept" [ -n "$(q postgres -c "select 1 from pg_database where datname = '$COPY'")" ]

# ── The second step ─────────────────────────────────────────────────────────
echo "-- the second step ---------------------------------------------"
run "$LIVE" 5EL "$FILE" --bring-back <<< "5EL"
ok "the code typed again: brought back" [ "$RC" = 0 ]
has "$OUT" "committed" || printf '%s\n' "$OUT" | tail -25
ok "the booking is back, as it was" [ "$(row reservations "$RES")" = "$WAS_RES" ]
ok "the bill is back, as it was" [ "$(row folios "$FOLIO")" = "$WAS_FOLIO" ]
ok "the guest is back, as they were" [ "$(row guests "$GUEST")" = "$WAS_GUEST" ]
ok "the guest's ID documents are back, as they were: what their ID says, and the photo's row" \
  [ "$(docs)" = "$WAS_DOCS" ]
ok "a guest with no 5EL booking, still in live, does not get their lost ID document back from 5EL" \
  [ -z "$(q "$LIVE" -c "select 1 from guest_documents where guest_id = '$OTHER'")" ]
ok "the bill's lines are not written (append-only)" \
  [ "$(q "$LIVE" -c "select count(*) from folio_postings where folio_id = '$FOLIO'")" = 0 ]
ok "the invoice series is not written" \
  [ -z "$(q "$LIVE" -c "select 1 from invoice_series where hotel_id = '$H5'")" ]
ok "the room changed since keeps what it is today" \
  [ "$(q "$LIVE" -c "select floor from rooms where id = '$CHANGED_ROOM'")" = 77 ]
ok "every other hotel's rows are as they were" [ "$(q "$LIVE" -c "$OTHERS")" = "$WAS_OTHERS" ]
for h in AGR PUN; do            # and by the tool's own look: every hotel table
  run "$LIVE" "$h" "$COPY" </dev/null
  ok "...$h: nothing differs from the backup, in any of its tables" \
    [ "$(printf '%s\n' "$OUT" | awk '/WHAT DIFFERS/{f=1;next} /Changed and new rows/{f=0} f' | tail -n +3 | grep -c '|')" = 0 ]
done

run "$LIVE" 5EL "$COPY" </dev/null
ok "a second look: nothing more can come back" has "$OUT" "can come back: 0 rows"

# ── A hotel whose own row is gone ───────────────────────────────────────────
echo "-- a hotel that is not there at all ----------------------------"
q postgres -c "create database $GONE" && "$PGRESTORE" -d "$GONE" --no-owner --no-acl "$FILE" >/dev/null 2>&1
q "$GONE" -c "set session_replication_role = replica; delete from hotels where code = 'PUN'" >/dev/null
run "$GONE" PUN "$COPY" --bring-back <<< "PUN"
ok "a hotel missing in live: refused" [ "$RC" = 1 ]
ok "...saying its own row comes back first, and how" has "$OUT" "is not in the live database"
ok "...and nothing was written" [ -z "$(q "$GONE" -c "select 1 from hotels where code = 'PUN'")" ]

echo
if [ "$FAIL" = 0 ]; then green "  all $PASS checks passed"
else red "  $FAIL of $((PASS + FAIL)) checks FAILED"; printf '%s\n' "$OUT" | tail -40; exit 1; fi
