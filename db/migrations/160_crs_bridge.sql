-- =============================================================================
-- 160 · The CRS bridge: bookings read from the CRS, as waiting bookings
-- =============================================================================
-- D27-168 (29 September), with D27-35, D27-98, D27-99, D27-102, D27-103, D27-106.
--
-- THE PMS READS; IT NEVER TRUSTS A PUSH. The CRS is a browser app on Firestore
-- with no server, and its webhook key is readable by every CRS user. So every
-- few minutes the PMS signs in to the CRS with a read-only "automation" login
-- (its password only in the server's settings) and reads the bookings changed
-- since the last read. Nothing here is written by the CRS.
--
-- THE KEY IS THE CRS DOCUMENT ID, never the booking number. FH-2026-00001 can
-- repeat (its counter restarts every year); the document id cannot.
-- `crs_bookings.crs_id` is the primary key, and the booking it becomes also
-- carries it as `reservations.ota_reference` under 091's unique index, so the
-- same CRS booking read twice is one booking by two separate guards.
--
-- A CHANGE IN THE CRS AFTER THE BOOKING REACHED THE PMS IS A NOTE, never an
-- edit. The desk reads it and acts; nothing is applied silently.
--
-- Re-runnable; touches no table it does not create; creates no rows.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Which hotel is which in the CRS, and who the reader runs as there
-- -----------------------------------------------------------------------------
create table if not exists crs_hotels (
  hotel_id           uuid primary key references hotels(id) on delete cascade,
  -- The property's document id in the CRS (its address bar: /hotels/<id>).
  crs_hotel_id       text not null,
  -- Which source a CRS booking is filed under. Picked from the group's list;
  -- nothing new is invented here.
  booking_source_id  uuid not null references booking_sources(id),
  -- The service account the reader works as at this hotel, never a person's
  -- login (the channel manager's run_as, 107). Null: nothing is read.
  run_as             uuid references staff(id),
  is_on              boolean not null default false,
  -- Bookings the CRS made BEFORE this moment were typed in by hand; reading
  -- them would book them twice. Only bookings created from here on are taken.
  connected_at       timestamptz not null default now(),
  -- The latest CRS `updatedAt` read so far. Null: start from connected_at.
  read_up_to         timestamptz,
  last_read_at       timestamptz,
  last_error         text,
  -- The day the daily check for bookings deleted in the CRS last ran.
  deleted_checked_on date,
  updated_by         uuid references staff(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint crs_hotels_crs_hotel_id_format
    check (crs_hotel_id ~ '^[A-Za-z0-9_-]{1,64}$')
);

create unique index if not exists crs_hotels_one_per_crs_hotel
  on crs_hotels (crs_hotel_id);

comment on table crs_hotels is
  'A hotel on this system that the CRS sells, by its CRS document id, with the '
  'source its bookings are filed under and the service account the reader runs '
  'as. Only bookings the CRS created after connected_at are read.';


-- -----------------------------------------------------------------------------
-- Which CRS room type is which room type here
-- -----------------------------------------------------------------------------
create table if not exists crs_room_types (
  hotel_id          uuid not null,
  crs_room_type_id  text not null,
  room_type_id      uuid not null,
  updated_by        uuid references staff(id),
  updated_at        timestamptz not null default now(),

  primary key (hotel_id, crs_room_type_id),
  foreign key (hotel_id, room_type_id)
    references room_types (hotel_id, id) on delete cascade,
  constraint crs_room_types_id_format
    check (crs_room_type_id ~ '^[A-Za-z0-9_-]{1,64}$')
);

comment on table crs_room_types is
  'A CRS room type (by its document id) and the room type it is here. A CRS '
  'booking for a room type with no row is not booked; the desk is told why.';


-- -----------------------------------------------------------------------------
-- Every CRS booking the reader acted on
-- -----------------------------------------------------------------------------
create table if not exists crs_bookings (
  -- The CRS document id: the only key that cannot repeat.
  crs_id           text primary key,
  hotel_id         uuid not null references hotels(id) on delete cascade,
  -- What the CRS shows, for the desk: its booking number, who sold it, for whom.
  crs_reference    text not null,
  salesperson      text,
  company          text,
  guest_name       text,
  check_in         date,
  check_out        date,
  crs_status       text not null,
  -- The CRS's own stamp of its last change, as read. A later read with the
  -- same stamp is the same booking and is skipped.
  crs_updated_at   timestamptz not null,
  -- The parts compared on the next read: status, dates, rooms, guest name.
  -- No telephone or email: the guest record holds those.
  seen             jsonb not null,
  -- booked: a waiting booking holds the room · full: nothing was free, so
  -- nothing was made and the salesperson is told · needs_attention: it could
  -- not be booked by itself, and `reason` says why.
  outcome          text not null,
  reason           text,
  reservation_ids  uuid[] not null default '{}',
  read_at          timestamptz not null default now(),

  -- A change made in the CRS after the booking reached the PMS, for the desk
  -- to act on. Cleared by a person pressing Done, never by the reader.
  change_note      text,
  changed_at       timestamptz,
  change_done_at   timestamptz,
  change_done_by   uuid references staff(id),

  -- The hotel's answer, written to the CRS's booking register once.
  answer           text,
  answered_at      timestamptz,
  answer_tries     smallint not null default 0,
  answer_error     text,

  constraint crs_bookings_outcome_known
    check (outcome in ('booked', 'full', 'needs_attention')),
  constraint crs_bookings_answer_known
    check (answer is null or answer in ('confirmed', 'refused', 'full', 'partly')),
  constraint crs_bookings_id_format
    check (crs_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint crs_bookings_booked_has_rooms
    check (outcome <> 'booked' or cardinality(reservation_ids) > 0),
  constraint crs_bookings_stay_sane
    check (check_in is null or check_out is null or check_out > check_in)
);

-- 'partly' (D27-174): every room of a CRS booking of several rooms has an
-- answer, and they differ. Dropped and added so a database that ran this file
-- before the owner's answer takes it on the next replay.
alter table crs_bookings drop constraint if exists crs_bookings_answer_known;
alter table crs_bookings add constraint crs_bookings_answer_known
  check (answer is null or answer in ('confirmed', 'refused', 'full', 'partly'));

-- What still needs somebody: a note not yet done, a booking not made.
create index if not exists crs_bookings_to_act_on
  on crs_bookings (hotel_id, read_at desc)
  where (change_note is not null and change_done_at is null)
     or outcome = 'needs_attention';

-- The answers not yet written to the register.
create index if not exists crs_bookings_answer_owed
  on crs_bookings (hotel_id)
  where answered_at is null and outcome in ('booked', 'full');

comment on table crs_bookings is
  'Every CRS booking the reader acted on, keyed by its CRS document id: the '
  'waiting booking it became, or why it did not become one. A later change in '
  'the CRS is a note for the desk (change_note), never applied by itself.';


-- -----------------------------------------------------------------------------
-- Row security, grants, audit - the same as every hotel's table
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['crs_hotels', 'crs_room_types', 'crs_bookings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format(
      'create policy hotel_isolation on %I for all
         using      ( hotel_id in (select app.auth_hotel_ids()) )
         with check ( hotel_id in (select app.auth_hotel_ids()) )', t);
    execute format('grant select, insert, update on %I to pms_app', t);
    execute format('revoke delete on %I from pms_app', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function app.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- A room type that is no longer matched is taken out, not left pointing.
grant delete on crs_room_types to pms_app;

drop trigger if exists crs_hotels_touch on crs_hotels;
create trigger crs_hotels_touch before update on crs_hotels
  for each row execute function app.touch_updated_at();

drop trigger if exists crs_hotels_run_as_scope on crs_hotels;
create trigger crs_hotels_run_as_scope
  before insert or update on crs_hotels
  for each row execute function app.assert_staff_has_hotel('run_as');

drop trigger if exists crs_bookings_done_by_scope on crs_bookings;
create trigger crs_bookings_done_by_scope
  before insert or update on crs_bookings
  for each row execute function app.assert_staff_has_hotel('change_done_by');


-- -----------------------------------------------------------------------------
-- Which hotels the reader works for, before it has anybody's session
-- -----------------------------------------------------------------------------
-- The job has no person behind it, so it cannot read crs_hotels under row
-- security to find out. This answers that one question: a hotel and the
-- account to run as, for a hotel switched on whose account is active.
create or replace function app.crs_due()
returns table (hotel_id uuid, run_as uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select ch.hotel_id, ch.run_as
    from crs_hotels ch
    join staff s on s.id = ch.run_as and s.is_active
   where ch.is_on
$fn$;

revoke all on function app.crs_due() from public;
grant execute on function app.crs_due() to pms_app;

comment on function app.crs_due() is
  'Hotels whose CRS bookings are read by themselves: switched on, with an active '
  'service account to run as. Hotel id and account id only.';
