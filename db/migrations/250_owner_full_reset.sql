-- =============================================================================
-- 250 · The owner's full reset of one real hotel (D27-342, D27-365 (3))
-- =============================================================================
-- The owner, 17 October: "an option to do a full reset which is only for my
-- ID"; 26 October, all four answers as recommended: one hotel at a time,
-- refused while any guest is checked in, a backup first, and the test hotels
-- keep their own Reset. The plan is docs/plans/owner-full-reset.md.
--
-- Until now a reset was `api/scripts/reset-property.ts`, typed on the server
-- as the superuser, because clearing a hotel lifts the append-only guards and
-- the API's own role (pms_app) cannot. This file moves the clearing into the
-- database, where the script and the new button both call it, so the two
-- cannot differ:
--
--   owner_reset.steps(fresh)    the list, in order: what goes, children first
--                               (was the script's CLEAR and FRESH)
--   owner_reset.guards(fresh)   the triggers lifted for it (GUARDS, FRESH_GUARDS)
--   owner_reset.counts(code)    the dry run: what WOULD go, and why it would be
--                               refused (a test hotel; a guest checked in)
--   owner_reset.clear(...)      the clear, as `--fresh-start --yes` did it, in
--                               the caller's transaction: all or nothing. The
--                               business date becomes today, invoice numbers
--                               carry on, and one audit line says who, which
--                               hotel, how many rows and the backup's name.
--   owner_reset.id_photos_in_drive   the cleared guests' ID photos still to
--                               delete from Google Drive (D27-379), listed by
--                               the clear, each struck off once Drive has
--                               deleted it - after the commit (section 1b)
--
-- WHO MAY CALL IT. A login of its own, pms_owner_reset, which may do exactly
-- two things - count and clear - and nothing else: no table, no other
-- function, not the `app` schema. The functions run as their owner (the table
-- owner, pms_migrate), which is what may lift a guard. pms_app cannot call
-- them at all (it reads and strikes off the ID photo list, nothing more).
-- The API connects as pms_owner_reset only for this, through
-- RESET_DATABASE_URL, after checking the signed-in e-mail against
-- RESET_OWNER_EMAIL (api/src/modules/admin/ownerReset.ts).
--
-- The role is made WITH NO PASSWORD: nobody signs in as it until the owner
-- sets one on the server (deploy/README.md, "The owner's full reset"). A
-- default here would be the most powerful password the system has.
--
-- THE GUARDS ARE LIFTED THE WAY THE SCRIPT LIFTED THEM: `alter table ...
-- disable trigger` inside the transaction, put back before it commits. The
-- lock that takes holds every other writer to those tables until the commit,
-- so no other transaction ever sees a guard down - and nothing about any
-- guard changes for anybody else. (The test hotels' way past the guards, a
-- setting checked in each guard, is not used: it would have to let a REAL
-- hotel's rows through, which 212 refuses on purpose.)
--
-- Re-runnable: replayed on every deploy (db/migrate.sh, one transaction).
-- =============================================================================


-- =============================================================================
-- 1 · THE LOGIN
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pms_owner_reset') then
    create role pms_owner_reset login;
  end if;
end $$;
-- Nothing above the two functions below, whatever somebody grants it later by hand.
alter role pms_owner_reset nosuperuser nocreatedb nocreaterole noinherit nobypassrls noreplication;

create schema if not exists owner_reset;
alter schema owner_reset owner to pms_migrate;
revoke all on schema owner_reset from public;
grant usage on schema owner_reset to pms_owner_reset;


-- =============================================================================
-- 1b · THE ID PHOTOS STILL IN GOOGLE DRIVE (D27-379)
-- =============================================================================
-- The owner, 29 October: a cleared hotel keeps no IDs - the backup keeps the
-- records, the photos go for good. A photo's row goes with its booking, but
-- the photo is an encrypted file in Drive (D27-209), and Drive is asked only
-- AFTER the clear has committed, so a refused or undone clear deletes
-- nothing. The clear therefore lists the files here, in its own transaction,
-- and whoever ran it - the API (ownerReset.ts) or reset-property.ts - asks
-- Drive through idPhotos.ts's own `remove` and strikes each off once Drive
-- has deleted it. One Drive would not delete stays listed, and the next
-- clear of the hotel lists it again and tries it. Nothing of a guest is
-- here: the file's id and its hotel.
--
-- pms_app may read and strike off (the API, after the commit, on its own
-- connection); the reset login may not even read it.
create table if not exists owner_reset.id_photos_in_drive (
  drive_file_id text primary key,
  hotel_id      uuid not null references hotels(id),
  -- The photo's own copy of its hotel's code: Drive's folder is chosen by it.
  hotel_code    text not null,
  listed_at     timestamptz not null default now()
);
alter table owner_reset.id_photos_in_drive owner to pms_migrate;
revoke all on owner_reset.id_photos_in_drive from public;
grant usage on schema owner_reset to pms_app;
grant select, delete on owner_reset.id_photos_in_drive to pms_app;

comment on table owner_reset.id_photos_in_drive is
  'D27-379: a cleared hotel''s ID photo files still to delete from Google Drive. Listed by owner_reset.clear, struck off after the commit once Drive has deleted each.';


-- =============================================================================
-- 2 · THE LIST: WHAT GOES, IN ORDER
-- =============================================================================
-- The script's CLEAR then, with --fresh-start, its FRESH. ORDER IS THE WHOLE
-- OF IT: a child before its parent, every time, or Postgres refuses on a
-- foreign key part-way through (defect 115). api/test/resetOrder.test.ts reads
-- this list and checks it against the schema's keys: every table exists, no
-- parent goes before its child, and nothing left behind points at what goes.
-- The history of each line is in the script's comments up to release 14
-- (git log -- api/scripts/reset-property.ts); the reasons that still matter:
--
--   * VAT bills point at an order, a bill and its tax invoice; their series
--     stays, as the GST one does.
--   * pos_orders.ticket_id points at pos_tickets: ORDERS BEFORE TICKETS (the
--     first production run failed there with 17 orders on the file).
--   * a spa treatment, a laundry bag and a guest's link each point at a stay
--     and the line they put on its bill; a refund's row at its refund line; a
--     repair's costs at the work order - none cascades.
--   * a guest's papers go only when the guest has no stay at ANOTHER property
--     (a guest is a person for the whole group; D27-298).
--   * a booking group has no hotel of its own: it goes once nothing at another
--     hotel points at it - no booking and no group bill there - and it is not
--     led by another hotel. (Written so, rather than "no booking anywhere",
--     the count before the clear is what the clear removes. 29 October: the
--     old clause took a group with no bookings whose bill was at another
--     hotel, and the clear stopped on the key - found by running the script
--     on the database suite's own data; and it took a group another hotel
--     leads that had no bookings yet.)
--   * the Store: count lines, then movements (an undo and its movement in one
--     statement); a bar bill's lines, movements, then the bills.
--   * what is owed to suppliers (246, 249; release 14's gate run, 28 October)
--     points at a bar bill or a purchase order: the reversals first, then
--     payments and credit notes, then the bills - before either.
--
-- FRESH (D27-298, "a fresh launch - delete all the old data"): the practice
-- paperwork too - purchase requests and approvals, equipment moves and
-- history (the register itself stays), the CRS and OTA booking records and
-- the messages-sent log. The audit trail stays.
create or replace function owner_reset.steps(p_fresh boolean)
returns table (step int, table_name text, where_sql text)
language sql
immutable
as $fn$
  select s.step::int, s.e ->> 0, s.e ->> 1
    from (
      select e, o as step from jsonb_array_elements($list$[
        ["vat_bills",                 "hotel_id = $1"],
        ["guest_food_orders",         "hotel_id = $1"],
        ["pos_order_tenders",         "order_id in (select id from pos_orders where hotel_id = $1)"],
        ["pos_order_lines",           "hotel_id = $1"],
        ["pos_tender_changes",        "hotel_id = $1"],
        ["pos_requests",              "hotel_id = $1"],
        ["pos_orders",                "hotel_id = $1"],
        ["pos_tickets",               "hotel_id = $1"],
        ["pos_cash_movements",        "hotel_id = $1"],
        ["pos_denominations",         "day_end_id in (select id from pos_day_ends where hotel_id = $1)"],
        ["pos_day_ends",              "hotel_id = $1"],
        ["banquet_event_packages",    "hotel_id = $1"],
        ["cashier_float_claims",      "closed_shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_denominations",     "shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_movements",         "hotel_id = $1"],
        ["cashier_shifts",            "hotel_id = $1"],
        ["cash_deposit_notes",        "hotel_id = $1"],
        ["cash_deposits",             "hotel_id = $1"],
        ["company_payments",          "hotel_id = $1"],
        ["spa_appointments",          "hotel_id = $1"],
        ["laundry_dockets",           "hotel_id = $1"],
        ["table_bookings",            "hotel_id = $1"],
        ["guest_id_photo_views",      "hotel_id = $1"],
        ["guest_id_photos",           "hotel_id = $1"],
        ["guest_digilocker_attempts", "hotel_id = $1"],
        ["guest_links",               "hotel_id = $1"],
        ["form_c_filings",            "hotel_id = $1"],
        ["form_iii_stays",            "hotel_id = $1"],
        ["closed_day_corrections",    "hotel_id = $1"],
        ["invoices",                  "hotel_id = $1"],
        ["refunds",                   "hotel_id = $1"],
        ["payments",                  "hotel_id = $1"],
        ["loyalty_points",            "hotel_id = $1"],
        ["folio_postings",            "hotel_id = $1"],
        ["folios",                    "hotel_id = $1"],
        ["guest_documents",           "guest_id in (select guest_id from reservations where hotel_id = $1) and not exists (select 1 from reservations r where r.guest_id = guest_documents.guest_id and r.hotel_id <> $1)"],
        ["housekeeping_assignments",  "hotel_id = $1"],
        ["room_assignments",          "hotel_id = $1"],
        ["room_status_log",           "hotel_id = $1"],
        ["work_order_costs",          "hotel_id = $1"],
        ["work_orders",               "hotel_id = $1"],
        ["wake_up_calls",             "hotel_id = $1"],
        ["lost_items",                "hotel_id = $1"],
        ["room_blocks",               "hotel_id = $1"],
        ["banquet_events",            "hotel_id = $1"],
        ["reservations",              "hotel_id = $1"],
        ["reservation_groups",        "(lead_hotel_id is null or lead_hotel_id = $1) and not exists (select 1 from reservations r where r.group_id = reservation_groups.id and r.hotel_id <> $1) and not exists (select 1 from folios f where f.group_id = reservation_groups.id and f.hotel_id <> $1)"],
        ["night_audit_runs",          "hotel_id = $1"],
        ["bar_request_lines",         "hotel_id = $1"],
        ["bar_requests",              "hotel_id = $1"],
        ["bar_closed_days",           "hotel_id = $1"],
        ["supplier_reversals",        "hotel_id = $1"],
        ["supplier_payments",         "hotel_id = $1"],
        ["supplier_credit_notes",     "hotel_id = $1"],
        ["supplier_bills",            "hotel_id = $1"],
        ["bar_purchase_lines",        "hotel_id = $1"],
        ["stock_count_lines",         "hotel_id = $1"],
        ["stock_movements",           "hotel_id = $1"],
        ["bar_purchases",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
      union all
      select e, 1000 + o from jsonb_array_elements($list$[
        ["equipment_moves",           "hotel_id = $1"],
        ["equipment_history",         "hotel_id = $1"],
        ["purchase_request_lines",    "hotel_id = $1"],
        ["purchase_requests",         "hotel_id = $1"],
        ["approvals",                 "hotel_id = $1"],
        ["crs_bookings",              "hotel_id = $1"],
        ["channel_bookings",          "hotel_id = $1"],
        ["messages_sent",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
       where p_fresh
    ) s
   order by s.step
$fn$;

-- The guards lifted for it, READ OUT OF pg_trigger, not remembered (the first
-- list had four and the run died on the fifth). The test hotels' Reset has its
-- own way past them (212) and is untouched.
create or replace function owner_reset.guards(p_fresh boolean)
returns table (table_name text, trigger_name text)
language sql
immutable
as $fn$
  select g.e ->> 0, g.e ->> 1
    from jsonb_array_elements($list$[
      ["folio_postings",         "folio_postings_append_only"],
      ["folio_postings",         "folio_postings_closed_date"],
      ["closed_day_corrections", "closed_day_corrections_append_only"],
      ["invoices",               "invoices_immutable"],
      ["vat_bills",              "vat_bills_immutable"],
      ["pos_order_lines",        "pos_order_lines_frozen"],
      ["pos_order_lines",        "pos_order_lines_void_cascade"],
      ["pos_order_tenders",      "pos_order_tenders_no_delete_settled"],
      ["pos_orders",             "pos_orders_no_reopen"],
      ["pos_orders",             "pos_orders_clear_final"],
      ["reservations",           "reservations_void_releases"],
      ["room_assignments",       "ra_within_stay"],
      ["guests",                 "guests_no_delete"],
      ["pos_line_events",        "pos_line_events_no_delete"],
      ["loyalty_points",         "loyalty_points_append_only"],
      ["stock_movements",        "stock_movements_append_only"],
      ["stock_count_lines",      "stock_count_lines_append_only"],
      ["key_cards",              "key_cards_append_only"]
    ]$list$::jsonb) as g(e)
  union all
  select g.e ->> 0, g.e ->> 1
    from jsonb_array_elements($list$[
      ["equipment_moves",        "equipment_moves_append_only"],
      ["equipment_history",      "equipment_history_append_only"]
    ]$list$::jsonb) as g(e)
   where p_fresh
$fn$;


-- =============================================================================
-- 3 · THE GUESTS THAT GO, AND WHY A CLEAR IS REFUSED
-- =============================================================================
-- A guest is a person for the whole group, with no hotel. One goes when no
-- stay and no function at ANOTHER hotel is left - the same set before the
-- clear as after it, so the dry run's count is what goes.
create or replace function owner_reset.orphans(p_hotel uuid)
returns uuid[]
language sql
stable
as $fn$
  select array_agg(g.id)
    from guests g
   where not exists (select 1 from reservations r where r.guest_id = g.id and r.hotel_id <> p_hotel)
     and not exists (select 1 from banquet_events b where b.guest_id = g.id and b.hotel_id <> p_hotel)
$fn$;

-- The ID photo files a clear of the hotel has Drive delete (D27-379): of the
-- photo rows the clear removes (guest_id_photos, `hotel_id = $1` in the list
-- above) the ones whose file Drive still holds - kept, or removed with
-- Drive's delete still owed (`drive_delete_failed_at`) - and any an earlier
-- clear listed that Drive has not deleted yet. Not a pending row (no file
-- was ever named on it) and not a removed one Drive already deleted.
create or replace function owner_reset.drive_files(p_hotel uuid)
returns table (drive_file_id text, hotel_code text)
language sql
stable
as $fn$
  select p.drive_file_id, p.hotel_code
    from guest_id_photos p
   where p.hotel_id = p_hotel and p.drive_file_id is not null
     and (p.status = 'stored' or p.drive_delete_failed_at is not null)
  union
  select l.drive_file_id, l.hotel_code
    from owner_reset.id_photos_in_drive l
   where l.hotel_id = p_hotel
$fn$;

-- Null when the hotel may be cleared; otherwise the sentence that says why not.
--   * a test hotel keeps its own Reset (D27-365 (3), the fourth answer);
--   * a guest checked in would lose an open bill (the second answer): named.
create or replace function owner_reset.refusal(p_hotel uuid)
returns text
language sql
stable
as $fn$
  select case
    when h.test_of is not null then
      format('%s is a test hotel. It keeps its own Reset, on %s''s card on Properties.',
             h.code, (select r.code from hotels r where r.id = h.test_of))
    when i.n > 0 then
      format('%s checked in at %s: %s. Check them out before the hotel is cleared.',
             case when i.n = 1 then 'A guest is still' else i.n || ' guests are still' end,
             h.name, i.names)
    end
    from hotels h
    cross join lateral (
      select count(*) as n, string_agg(g.full_name, ', ' order by g.full_name) as names
        from reservations r join guests g on g.id = r.guest_id
       where r.hotel_id = h.id and r.status = 'checked_in') i
   where h.id = p_hotel
$fn$;


-- =============================================================================
-- 4 · THE DRY RUN
-- =============================================================================
-- What would go, table by table (only the tables with something in them), the
-- guests, the ID photos Drive is then asked to delete, and the refusal if
-- there is one. The screen's window and the
-- script's dry run both print this, so they cannot disagree.
create or replace function owner_reset.counts(p_code text, p_fresh boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  h        hotels;
  s        record;
  v_n      bigint;
  v_tables jsonb := '{}';
begin
  select * into h from hotels where code = upper(btrim(p_code));
  if h.id is null then
    raise exception 'No property with code %.', upper(btrim(p_code)) using errcode = 'no_data_found';
  end if;
  for s in select * from owner_reset.steps(p_fresh) loop
    execute format('select count(*) from public.%I where %s', s.table_name, s.where_sql)
       into v_n using h.id;
    if v_n > 0 then
      v_tables := v_tables || jsonb_build_object(s.table_name, v_n);
    end if;
  end loop;
  return jsonb_build_object(
    'code',         h.code,
    'name',         h.name,
    'businessDate', h.business_date,
    'tables',       v_tables,
    'guests',       coalesce(cardinality(owner_reset.orphans(h.id)), 0),
    'idPhotos',     (select count(*) from owner_reset.drive_files(h.id)),
    'refusal',      owner_reset.refusal(h.id));
end $fn$;


-- =============================================================================
-- 5 · THE CLEAR
-- =============================================================================
-- In the caller's transaction, so a failure anywhere takes the whole of it
-- back. Every refusal comes before the first delete (MEMORY 243).
create or replace function owner_reset.clear(
  p_code text, p_fresh boolean, p_actor uuid, p_backup text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  h         hotels;
  s         record;
  v_n       bigint;
  v_removed bigint := 0;
  v_guests  bigint;
  v_tables  jsonb := '{}';
  v_orphans uuid[];
  v_refusal text;
  v_photos  jsonb;
begin
  -- One clear of a hotel at a time.
  select * into h from hotels where code = upper(btrim(p_code)) for update;
  if h.id is null then
    raise exception 'No property with code %.', upper(btrim(p_code)) using errcode = 'no_data_found';
  end if;

  -- The guards are lifted FIRST: lifting one takes its table's lock, so from
  -- here no check-in can land between the question below and the clear.
  for s in select * from owner_reset.guards(p_fresh) loop
    execute format('alter table public.%I disable trigger %I', s.table_name, s.trigger_name);
  end loop;

  v_refusal := owner_reset.refusal(h.id);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'check_violation';
  end if;

  -- The ID photos' Drive files, listed before their rows go, in this same
  -- transaction: undone with it, kept with it (D27-379, section 1b).
  insert into owner_reset.id_photos_in_drive (drive_file_id, hotel_id, hotel_code)
  select f.drive_file_id, h.id, f.hotel_code from owner_reset.drive_files(h.id) f
  on conflict (drive_file_id) do nothing;
  select coalesce(jsonb_agg(jsonb_build_object('hotelCode', l.hotel_code, 'driveFileId', l.drive_file_id)), '[]')
    into v_photos
    from owner_reset.id_photos_in_drive l where l.hotel_id = h.id;

  for s in select * from owner_reset.steps(p_fresh) loop
    execute format('delete from public.%I where %s', s.table_name, s.where_sql) using h.id;
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;
    if v_n > 0 then
      v_tables := v_tables || jsonb_build_object(s.table_name, v_n);
    end if;
  end loop;

  -- The guests now left with no stay anywhere - and first everything that
  -- points at them with no cascade (read out of pg_constraint, D27-298). Their
  -- ID papers go by cascade.
  v_orphans := owner_reset.orphans(h.id);
  delete from loyalty_points
   where member_id in (select id from loyalty_members where guest_id = any (v_orphans));
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from loyalty_members where guest_id = any (v_orphans);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from guest_joins where joined_id = any (v_orphans) or kept_id = any (v_orphans);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from guest_not_same where a = any (v_orphans) or b = any (v_orphans);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from guest_detail_submissions where guest_id = any (v_orphans);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from form_c_filings where guest_id = any (v_orphans);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  -- A guest kept elsewhere who was joined INTO one of these points at them.
  update guests set joined_into = null
   where joined_into = any (v_orphans) and not (id = any (v_orphans));
  delete from guests where id = any (v_orphans);
  get diagnostics v_guests = row_count;
  v_removed := v_removed + v_guests;

  -- Every room vacant and clean; TODAY in the hotel's own time zone. The
  -- invoice and VAT series are not touched: numbers carry on, never reused.
  update rooms set occupancy_status = 'vacant', housekeeping_status = 'clean'
   where hotel_id = h.id;
  update hotels set business_date = (now() at time zone timezone)::date where id = h.id;

  for s in select * from owner_reset.guards(p_fresh) loop
    execute format('alter table public.%I enable trigger %I', s.table_name, s.trigger_name);
  end loop;

  -- One line in the audit trail: who, which hotel, how many rows, the backup.
  -- (When: its own `at`.) The script passes no person and no backup.
  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (h.id, p_actor, 'hotels', h.id::text, 'OWNER_RESET', null,
          jsonb_build_object(
            'removed',    v_removed,
            'backup',     p_backup,
            'freshStart', p_fresh,
            'idPhotos',   jsonb_array_length(v_photos),
            'by', coalesce((select full_name from staff where id = p_actor),
                           'reset-property.ts, on the server')));

  return jsonb_build_object(
    'removed',      v_removed,
    'tables',       v_tables,
    'guests',       v_guests,
    'rooms',        (select count(*) from rooms where hotel_id = h.id),
    'businessDate', (select business_date from hotels where id = h.id),
    -- For whoever ran it to have Drive delete AFTER the commit. Never shown:
    -- the API and the script say how many, not which.
    'idPhotos',     v_photos);
end $fn$;


-- =============================================================================
-- 6 · OWNED BY THE TABLES' OWNER; CALLED BY THE ONE LOGIN
-- =============================================================================
-- pms_migrate owns every table (db/ownership.sql), so it is what may lift a
-- guard; db/ownership.sql hands it `app`'s functions, not this schema's, so
-- these are handed over here. Every function is closed to everybody first
-- (Postgres opens a new function to PUBLIC), then two are opened to the one
-- login that needs them.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'owner_reset'
  loop
    execute format('alter function %s owner to pms_migrate', f.sig);
    execute format('revoke all on function %s from public', f.sig);
  end loop;
end $$;
grant execute on function owner_reset.counts(text, boolean)             to pms_owner_reset;
grant execute on function owner_reset.clear(text, boolean, uuid, text)  to pms_owner_reset;

comment on schema owner_reset is
  'D27-342: the owner''s full reset of one real hotel. Called by pms_owner_reset only (the API, RESET_DATABASE_URL) and by api/scripts/reset-property.ts as the superuser.';
comment on function owner_reset.clear(text, boolean, uuid, text) is
  'D27-342: clears one real hotel''s transactions, as --fresh-start did; refuses a test hotel or a guest checked in; business date today; invoice numbers carry on; one OWNER_RESET audit line.';
