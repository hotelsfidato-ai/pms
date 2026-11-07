-- ════════════════════════════════════════════════════════════════════
-- 280 — Bringing in an old system's guests and bookings (D27-383 item 7,
--       built under D27-396; refer to it as "old system import", the
--       master renumbers at merge)
--
--   A hotel coming from IDS, WinHMS, eZee or a spreadsheet brings its
--   guests, its bookings to come and its past stays. The files are read
--   and every row checked by the API (api/src/modules/admin/oldSystem.ts);
--   this is what holds the result and what takes it back.
--
--   1 app.imports_old_data     who may: the owner or an Admin at the hotel
--   2 data_imports             each import: who, when, the file, rows in,
--                              rows refused, and its undo
--   3 data_import_items        what each import brought in, for its undo
--   4 imported_stays           a past stay: HISTORY ONLY - never a folio,
--                              an invoice, revenue, tax or a night-audit day
--   5 a booking with no rate   agreed_rate may be empty on a booking still
--                              to arrive; a dash, never a zero
--   6 the undo                 everything an import brought in, removed,
--                              only while nothing has touched it
--   7 Guest 360 and the visit count read the past stays
--   8 a test hotel's trade; the full reset keeps what came in
--   9 no voucher unless the import's tick says so
--
-- Re-runnable.
-- ════════════════════════════════════════════════════════════════════


-- =============================================================================
-- 1 · WHO MAY
-- =============================================================================
-- The owner or an Admin AT THIS HOTEL, or a group administrator - the module
-- switches' pair (D17-36), not the GM: an import writes a whole hotel's
-- history at once.
create or replace function app.imports_old_data(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'admin'));
$$;

comment on function app.imports_old_data(uuid) is
  'D27-383 item 7: the owner or an Admin at this hotel, or a group administrator, may bring '
  'in (and undo) an old system''s guests and bookings.';

grant execute on function app.imports_old_data(uuid) to pms_app;


-- =============================================================================
-- 2 · EACH IMPORT
-- =============================================================================
create table if not exists data_imports (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id),
  kind          text not null check (kind in ('guests', 'bookings')),
  -- The old system, as the person named it: "IDS", "eZee", "Our spreadsheet".
  system        text not null check (length(btrim(system)) between 1 and 60),
  file_name     text not null check (length(btrim(file_name)) between 1 and 200),
  -- How the file's columns were matched: field -> the file's heading. The
  -- next file of this kind at this hotel starts from it (the saved mapping).
  columns       jsonb not null default '{}',
  rows_in       int not null check (rows_in >= 0),
  rows_refused  int not null check (rows_refused >= 0 and rows_refused <= rows_in),
  -- Each refused or skipped row: {line, reason}.
  refused       jsonb not null default '[]',
  -- "Send each guest our booking voucher" (the master, under D27-396): off
  -- unless ticked - the old system confirmed these bookings already.
  send_vouchers boolean not null default false,
  made_by       uuid references staff(id) default app.current_user_id(),
  made_at       timestamptz not null default now(),
  undone_by     uuid references staff(id),
  undone_at     timestamptz,
  -- The transaction that undid it: the one in which the guards below let
  -- its own rows go.
  undone_tx     xid8,
  constraint data_imports_undone check ((undone_at is null) = (undone_by is null))
);
-- A table made before the tick (a re-run on a copy that had it): the column
-- first, so the grants below can name it.
alter table data_imports add column if not exists send_vouchers boolean not null default false;
create index if not exists data_imports_by_hotel on data_imports (hotel_id, made_at desc);

comment on table data_imports is
  'D27-383 item 7: an old system''s guests or bookings brought in from a file. Who, when, the '
  'file, rows in, rows refused; undone only while nothing has touched what it brought in.';

alter table data_imports enable row level security;
alter table data_imports force row level security;
drop policy if exists data_imports_read on data_imports;
drop policy if exists data_imports_add on data_imports;
drop policy if exists data_imports_count on data_imports;
create policy data_imports_read on data_imports for select
  using (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id));
create policy data_imports_add on data_imports for insert
  with check (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id));
-- The refused rows are counted once the rows are made, in the same save.
create policy data_imports_count on data_imports for update
  using (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id) and undone_at is null)
  with check (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id) and undone_at is null);
-- Its undo is app.undo_data_import's, never the application's: pms_app
-- cannot set who undid it, or when, or in which transaction.
revoke all on data_imports from pms_app;
grant select on data_imports to pms_app;
grant insert (hotel_id, kind, system, file_name, columns, rows_in, rows_refused, refused, send_vouchers)
  on data_imports to pms_app;
grant update (rows_refused, refused) on data_imports to pms_app;

drop trigger if exists data_imports_audit on data_imports;
create trigger data_imports_audit after insert or update or delete on data_imports
  for each row execute function app.write_audit();


-- =============================================================================
-- 3 · WHAT EACH IMPORT BROUGHT IN
-- =============================================================================
--   guest         a guest record it made
--   guest_filled  a guest on file whose empty fields it filled: `filled`
--                 names them ("documents": an ID-papers row it added)
--   booking       a booking it made (with its bill)
--   payment       an advance it recorded: the folio posting's id
create table if not exists data_import_items (
  import_id  uuid not null references data_imports(id) on delete cascade,
  kind       text not null check (kind in ('guest', 'guest_filled', 'booking', 'payment')),
  row_id     text not null,
  line       int,
  -- The old system's own reference for a booking.
  reference  text,
  filled     jsonb,
  primary key (import_id, kind, row_id)
);
create index if not exists data_import_items_by_row on data_import_items (kind, row_id);

alter table data_import_items enable row level security;
alter table data_import_items force row level security;
drop policy if exists data_import_items_mine on data_import_items;
create policy data_import_items_mine on data_import_items for all
  using (exists (select 1 from data_imports d where d.id = import_id))
  with check (exists (select 1 from data_imports d where d.id = import_id and d.undone_at is null));
revoke all on data_import_items from pms_app;
grant select, insert on data_import_items to pms_app;
-- A returning guest two bookings of one file fill: the fields add up.
grant update (filled) on data_import_items to pms_app;


-- =============================================================================
-- 4 · A PAST STAY, AS HISTORY ONLY
-- =============================================================================
-- What the old system says happened: who, when, which room type and room,
-- its reference and source, as written. NO MONEY: never a folio, an invoice,
-- revenue, tax or a night-audit day, so no report and no GST return changes
-- (decided under D27-396: the history of money stays in the old system).
create table if not exists imported_stays (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id),
  import_id  uuid not null references data_imports(id) on delete cascade,
  guest_id   uuid not null references guests(id),
  arrival    date not null,
  departure  date not null,
  room_type  text check (length(room_type) <= 80),
  room       text check (length(room) <= 20),
  reference  text check (length(reference) <= 100),
  source     text check (length(source) <= 100),
  adults     int check (adults between 1 and 20),
  children   int check (children between 0 and 20),
  constraint imported_stays_dates check (departure >= arrival)
);
create index if not exists imported_stays_by_guest on imported_stays (guest_id);
create index if not exists imported_stays_by_import on imported_stays (import_id);

comment on table imported_stays is
  'D27-383 item 7: a stay from an old system, history only (Guest 360, the visit count). '
  'Never a booking, a bill, revenue, tax or a night-audit day.';

alter table imported_stays enable row level security;
alter table imported_stays force row level security;
drop policy if exists imported_stays_mine on imported_stays;
create policy imported_stays_mine on imported_stays for all
  using (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id))
  with check (hotel_id in (select app.auth_hotel_ids()) and app.imports_old_data(hotel_id));
revoke all on imported_stays from pms_app;
grant select, insert on imported_stays to pms_app;

-- A real hotel's stay never holds a test hotel's guest, nor the other way (212).
drop trigger if exists imported_stays_keeps_sides on imported_stays;
create trigger imported_stays_keeps_sides
  before insert or update of hotel_id, guest_id on imported_stays
  for each row execute function app.keep_sides('guest_id', 'guests');


-- =============================================================================
-- 5 · A BOOKING BROUGHT IN WITH NO RATE
-- =============================================================================
-- No default prices: a booking whose old system gave no rate comes in with
-- none - a dash - and the desk sets it before the guest arrives (Change the
-- rate). Only a booking still to arrive, or one that never did, may be
-- without: check-in refuses it in words (front desk), and this is the
-- guarantee behind the words. The night audit posts only stays in the house.
alter table reservations alter column agreed_rate drop not null;
alter table reservations drop constraint if exists reservations_rate_by_arrival;
alter table reservations add constraint reservations_rate_by_arrival
  check (agreed_rate is not null or status in ('tentative', 'confirmed', 'cancelled', 'no_show', 'void'));

comment on constraint reservations_rate_by_arrival on reservations is
  'D27-383 item 7: a booking brought in from an old system with no rate keeps none until the '
  'desk sets it; a guest is never checked in without one.';


-- =============================================================================
-- 6 · THE UNDO
-- =============================================================================
-- True only inside the transaction of an undo that lists this row: the guards
-- on an append-only ledger and on guests let exactly those rows go.
create or replace function app.import_undo_allows(p_kind text, p_row text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from data_import_items i
                   join data_imports d on d.id = i.import_id
                  where i.kind = p_kind and i.row_id = p_row
                    and d.undone_tx = pg_current_xact_id());
$$;

grant execute on function app.import_undo_allows(text, text) to public;

-- The append-only guard (latest in "night audit guard and undo") and the
-- guest guard (latest in "test hotels"), each with one clause added in place.
do $$
declare d text := pg_get_functiondef('app.forbid_mutation()'::regprocedure);
begin
  if position('import_undo_allows' in d) = 0 then
    if position('  -- D27-296: a test hotel''s own ledger, during its reset.' in d) = 0 then
      raise exception 'forbid_mutation has changed: patch it by hand';
    end if;
    execute replace(d, '  -- D27-296: a test hotel''s own ledger, during its reset.',
      $q$  -- D27-383 item 7: an advance an import brought in, during its undo.
  if tg_op = 'DELETE' and tg_table_name = 'folio_postings'
     and app.import_undo_allows('payment', to_jsonb(old) ->> 'id') then
    return old;
  end if;
  -- D27-296: a test hotel's own ledger, during its reset.$q$);
  end if;
end $$;

do $$
declare d text := pg_get_functiondef('app.forbid_guest_delete()'::regprocedure);
begin
  if position('import_undo_allows' in d) = 0 then
    if position('  -- D27-296: a guest made in a test hotel goes with its reset.' in d) = 0 then
      raise exception 'forbid_guest_delete has changed: patch it by hand';
    end if;
    execute replace(d, '  -- D27-296: a guest made in a test hotel goes with its reset.',
      $q$  -- D27-383 item 7: a guest an import made, during its undo.
  if app.import_undo_allows('guest', old.id::text) then
    return old;
  end if;
  -- D27-296: a guest made in a test hotel goes with its reset.$q$);
  end if;
end $$;

-- Null: undone. Otherwise why not, in words, and nothing changed.
--
-- "Nothing has touched it": every booking, room given, guest and ID-papers
-- row it made or filled is as it left it (written in its own transaction, so
-- nothing of it is later than the import's own time); nothing hangs off a booking it made but what it made
-- (a bill, the advance, the room); and nothing else points at a guest it
-- made. A cascading child of a booking - a guest's request, a key card, an
-- online check-in - is a touch; a plain one stops the delete itself.
create or replace function app.undo_data_import(p_import uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  d          data_imports;
  v_bookings uuid[];
  v_postings bigint[];
  v_guests   uuid[];
  v_why      text;
  v_hit      boolean;
  k          record;
begin
  select * into d from data_imports where id = p_import for update;
  if d.id is null or not (d.hotel_id in (select app.auth_hotel_ids())) then
    return 'No such import.';
  end if;
  if not app.imports_old_data(d.hotel_id) then
    return 'Bringing in an old system''s records, and undoing them, is for the owner or an administrator.';
  end if;
  if d.undone_at is not null then
    return 'This import was undone already.';
  end if;

  select coalesce(array_agg(row_id::uuid), '{}') into v_bookings
    from data_import_items where import_id = d.id and kind = 'booking';
  select coalesce(array_agg(row_id::bigint), '{}') into v_postings
    from data_import_items where import_id = d.id and kind = 'payment';
  select coalesce(array_agg(row_id::uuid), '{}') into v_guests
    from data_import_items where import_id = d.id and kind = 'guest';

  -- A booking changed since, or a room given since.
  select string_agg(r.reference, ', ' order by r.reference) into v_why
    from reservations r
   where r.id = any (v_bookings)
     and (r.updated_at > d.made_at
          or exists (select 1 from room_assignments ra
                      where ra.reservation_id = r.id and ra.created_at > d.made_at));
  if v_why is not null then
    return format('Nothing was undone: %s changed since it came in. Change or cancel it at the desk instead.', v_why);
  end if;

  -- Anything that goes with a booking by cascade is somebody's since.
  for k in
    select c.relname as t, a.attname as col
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = con.conkey[1]
     where con.contype = 'f' and con.confrelid = 'reservations'::regclass and con.confdeltype = 'c'
  loop
    execute format('select exists (select 1 from %I where %I = any ($1))', k.t, k.col)
      into v_hit using v_bookings;
    if v_hit then
      return 'Nothing was undone: a booking it brought in has been used since (a guest''s request, '
          || 'a key card or an online check-in). Change or cancel those bookings at the desk instead.';
    end if;
  end loop;

  -- A guest it made, or filled in, changed since.
  select string_agg(g.full_name, ', ' order by g.full_name) into v_why
    from guests g
   where (g.id = any (v_guests)
          or g.id in (select i.row_id::uuid from data_import_items i
                       where i.import_id = d.id and i.kind = 'guest_filled'))
     and (g.updated_at > d.made_at
          or exists (select 1 from guest_documents gd
                      where gd.guest_id = g.id and gd.updated_at > d.made_at));
  if v_why is not null then
    return format('Nothing was undone: %s changed since it came in.', v_why);
  end if;

  begin
    update data_imports
       set undone_at = now(), undone_by = app.current_user_id(), undone_tx = pg_current_xact_id()
     where id = d.id;

    delete from payments where posting_id = any (v_postings);
    delete from folio_postings where id = any (v_postings);
    delete from folios where reservation_id = any (v_bookings);
    delete from room_assignments where reservation_id = any (v_bookings);
    delete from reservations where id = any (v_bookings);
    delete from imported_stays where import_id = d.id;

    -- A guest on file: the empty fields it filled are empty again.
    update guests g
       set phone = case when i.filled ? 'phone' then null else g.phone end,
           email = case when i.filled ? 'email' then null else g.email end,
           notes = case when i.filled ? 'notes' then null else g.notes end
      from data_import_items i
     where i.import_id = d.id and i.kind = 'guest_filled' and g.id = i.row_id::uuid;
    delete from guest_documents gd
     using data_import_items i
     where i.import_id = d.id and i.kind = 'guest_filled' and i.filled ? 'documents'
       and gd.guest_id = i.row_id::uuid;

    delete from guest_documents where guest_id = any (v_guests);
    delete from guests where id = any (v_guests);
  exception when foreign_key_violation then
    return 'Nothing was undone: something has been added since to what it brought in (a booking for '
        || 'one of its guests, a charge or a payment on one of its bills). Change those records one by one.';
  end;
  return null;
end
$fn$;

comment on function app.undo_data_import(uuid) is
  'D27-383 item 7: removes everything an import brought in, all or nothing, while nothing has '
  'touched it. Null when done; otherwise why not, and nothing changed.';

revoke all on function app.undo_data_import(uuid) from public;
grant execute on function app.undo_data_import(uuid) to pms_app;


-- =============================================================================
-- 7 · GUEST 360 AND THE VISIT COUNT READ THE PAST STAYS
-- =============================================================================
-- 266's two functions, each with one addition made in place: a past stay
-- brought in counts as a visit (the desk's "Stayed with the group once"), and
-- Guest 360 lists it, "imported", with nothing charged (a dash). Nights,
-- charged, first and last stay stay the live stays' alone, as backfill's.
do $$
declare d text := pg_get_functiondef('app.guest_visits(uuid, uuid)'::regprocedure);
begin
  if position('imported_stays' in d) = 0 then
    if position('from backfill_stays b where b.guest_id = p_guest and b.removed_at is null)' in d) = 0 then
      raise exception 'guest_visits has changed: patch it by hand';
    end if;
    execute replace(d, 'from backfill_stays b where b.guest_id = p_guest and b.removed_at is null)',
      'from backfill_stays b where b.guest_id = p_guest and b.removed_at is null)
       + (select count(*)::int from imported_stays i where i.guest_id = p_guest)');
  end if;
end $$;

do $$
declare d text := pg_get_functiondef('app.guest_360(uuid)'::regprocedure);
begin
  if position('imported_stays' in d) = 0 then
    if position('  sent as (' in d) = 0 or position(E'            from backfilled b\n        ) x)' in d) = 0 then
      raise exception 'guest_360 has changed: patch it by hand';
    end if;
    d := replace(d, '  sent as (', $q$  -- D27-383 item 7: a past stay brought in from an old system.
  imported as (
    select s.id, s.arrival, s.departure, h.code as hotel_code, h.name as hotel_name,
           coalesce(nullif(btrim(s.reference), ''), 'Brought in') as reference,
           s.room_type, s.source
      from person p
      join imported_stays s on s.guest_id = p.id
      join hotels h on h.id = s.hotel_id
  ),
  sent as ($q$);
    d := replace(d, E'            from backfilled b\n        ) x)', $q$            from backfilled b
          union all
          select i.arrival, i.reference, jsonb_build_object(
                   'id', i.id, 'hotelCode', i.hotel_code, 'hotelName', i.hotel_name,
                   'reference', i.reference, 'checkIn', i.arrival::text,
                   'checkOut', i.departure::text, 'status', 'imported',
                   'roomType', i.room_type, 'source', i.source, 'charged', null)
            from imported i
        ) x)$q$);
    execute d;
  end if;
end $$;


-- =============================================================================
-- 8 · A TEST HOTEL'S TRADE; THE FULL RESET KEEPS WHAT CAME IN
-- =============================================================================
-- A test hotel's Reset clears its imports with its other trade (212).
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('data_imports' in d) = 0 then
    if position($q$('stay_requests', 'trading')$q$ in d) = 0 then
      raise exception 'test_hotel_classes has changed: patch it by hand';
    end if;
    execute replace(d, $q$('stay_requests', 'trading')$q$,
      $q$('stay_requests', 'trading'), ('data_imports', 'trading'), ('data_import_items', 'trading'), ('imported_stays', 'trading')$q$);
  end if;
end $$;

-- The owner's full reset (250) clears a hotel's live trade - the bookings an
-- import made among it - and the guests left with nothing elsewhere. A past
-- stay brought in is history, not live trade, and is not cleared (as
-- backfill's); so its guest is kept, or the clear would stop on its key. A
-- guest an import brought in is kept too: an old system's guest list is the
-- hotel's history, and another hotel's clear must never take it.
do $$
declare d text := pg_get_functiondef('owner_reset.orphans(uuid)'::regprocedure);
begin
  if position('imported_stays' in d) = 0 then
    if position('and not exists (select 1 from backfill_stays s where s.guest_id = g.id)' in d) = 0 then
      raise exception 'owner_reset.orphans has changed: patch it by hand';
    end if;
    execute replace(d, 'and not exists (select 1 from backfill_stays s where s.guest_id = g.id)',
      'and not exists (select 1 from backfill_stays s where s.guest_id = g.id)
     and not exists (select 1 from imported_stays s where s.guest_id = g.id)
     and not exists (select 1 from data_import_items i join data_imports d on d.id = i.import_id
                      where i.kind = ''guest'' and i.row_id = g.id::text and d.undone_at is null)');
  end if;
end $$;


-- =============================================================================
-- 9 · NO VOUCHER UNLESS THE IMPORT'S TICK SAYS SO
-- =============================================================================
-- Every future booking is owed the hotel's voucher (the owner's D21-33), and
-- the guest-messages sweep sends it within a minute. A booking brought in from
-- an old system was confirmed there already, so its guest is sent nothing at
-- import time unless the import ticked "Send each guest our booking voucher"
-- (the master, under D27-396). The sweep asks this and skips them; the desk's
-- own Send voucher still sends one when somebody chooses to, and every later
-- message follows the hotel's settings as for any booking. A job has no staff
-- session and the import's rows are row-secured: hence security definer.
create or replace function app.quietly_imported(p_reservations uuid[])
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select i.row_id::uuid
    from data_import_items i
    join data_imports d on d.id = i.import_id
   where i.kind = 'booking' and not d.send_vouchers and d.undone_at is null
     and i.row_id = any (select x::text from unnest(p_reservations) x);
$$;

comment on function app.quietly_imported(uuid[]) is
  'D27-383 item 7: of these bookings, the ones an import brought in without its "Send each guest '
  'our booking voucher" tick - the guest-messages sweep sends them no voucher.';

grant execute on function app.quietly_imported(uuid[]) to pms_app;
