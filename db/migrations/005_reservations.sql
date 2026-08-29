-- =============================================================================
-- 005_reservations.sql — bookings, and the constraint that prevents
--                        double-booking a room in the database itself.
-- =============================================================================

create extension if not exists btree_gist;   -- needed by the EXCLUDE below


create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- Human-facing number. Per hotel, so Agra and Pune both start at 1.
  -- Generated in 008 by a per-hotel sequence helper.
  reference     text not null,

  guest_id      uuid not null references guests(id),
  company_id    uuid references companies(id),        -- null for walk-ins / OTA
  room_type_id  uuid not null references room_types(id),

  -- Assigned at check-in, not at booking. A reservation is for a room TYPE;
  -- a stay is in a specific ROOM. Conflating them means you cannot overbook a
  -- type deliberately, which every hotel does.
  room_id       uuid references rooms(id),

  check_in      date not null,
  check_out     date not null,
  adults        smallint not null default 1,
  children      smallint not null default 0,

  -- Rate agreed at booking time. Snapshotted, NOT looked up later — if the
  -- rate plan changes in June, a booking made in March must not silently
  -- reprice. This is the same reasoning as gstVersion in the CRS.
  agreed_rate   numeric(12,2) not null,

  status        text not null default 'confirmed',
  source        text not null default 'direct',      -- direct | ota | corporate | walk_in
  ota_reference text,

  notes         text,
  created_by    uuid references staff(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (hotel_id, reference),

  constraint reservations_dates_ordered check (check_out > check_in),
  constraint reservations_rate_positive check (agreed_rate >= 0),
  constraint reservations_status_valid check (status in (
    'tentative',    -- held, not confirmed
    'confirmed',    -- will arrive
    'checked_in',   -- in house
    'checked_out',  -- departed, folio settled
    'no_show',      -- did not arrive; set by night audit
    'cancelled'
  )),
  constraint reservations_occupancy_positive check (adults >= 1)
);

-- -----------------------------------------------------------------------------
-- The double-booking guard.
-- -----------------------------------------------------------------------------
-- This is the single most valuable line in the file. It makes it IMPOSSIBLE for
-- two live reservations to hold the same physical room on overlapping nights —
-- not "unlikely", not "the app checks first", but rejected by Postgres.
--
-- Application-level checks lose this race every time: two clerks at two
-- terminals both read "room 101 is free", both write, and now one guest arrives
-- to find their room occupied. An EXCLUDE constraint is evaluated inside the
-- transaction and cannot be raced.
--
-- daterange(check_in, check_out, '[)') — half-open on purpose. A guest checking
-- out on the 5th and another checking in on the 5th do NOT overlap.
--
-- The WHERE clause means cancelled and no-show bookings release their room.
-- -----------------------------------------------------------------------------
-- ⚠ THIS CONSTRAINT NO LONGER EXISTS AFTER A FULL MIGRATION RUN.
--
--   011_model_additions.sql drops `reservations.room_id`, and dropping a
--   column drops every constraint that depends on it. That is deliberate: a
--   single room_id could not record a room MOVE, and the constraint actively
--   prevented one, because the new room's dates overlapped the old booking.
--
--   The protection did not go away — it moved one table over, to
--   `ra_no_double_booking` on room_assignments, which is what actually holds
--   a room now. Every claim in the fifteen lines above is still true of the
--   system; none of it is true of THIS table any more.
--
--   Left in place rather than deleted because migrations are history: 005 ran
--   as written, and rewriting it would make the file disagree with what the
--   database did. The note is the fix. Found when a concurrency test tried to
--   race a constraint that pg_constraint had never heard of.
--
-- Guarded so the file is re-runnable. `add constraint` has no IF NOT EXISTS
-- form, so a bare ALTER TABLE here fails the second time the migration runs
-- and takes the rest of the file with it under ON_ERROR_STOP.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'reservations_no_double_booking'
       and conrelid = 'reservations'::regclass
  ) then
    alter table reservations
      add constraint reservations_no_double_booking
      exclude using gist (
        room_id with =,
        daterange(check_in, check_out, '[)') with &&
      )
      where (room_id is not null and status in ('confirmed', 'checked_in'));
  end if;
end
$$;


create index if not exists reservations_hotel_arrival_idx
  on reservations (hotel_id, check_in)  where status in ('confirmed', 'checked_in');

create index if not exists reservations_hotel_departure_idx
  on reservations (hotel_id, check_out) where status = 'checked_in';

create index if not exists reservations_guest_idx on reservations (guest_id);

drop trigger if exists reservations_touch on reservations;
create trigger reservations_touch before update on reservations
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- app.next_reference() — per-hotel booking numbers
-- -----------------------------------------------------------------------------
-- Each property numbers its own bookings from 1. Uses an advisory lock rather
-- than a sequence per hotel, so adding hotel #8 still needs no DDL.
-- -----------------------------------------------------------------------------
create or replace function app.next_reference(p_hotel_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_next bigint;
begin
  select code into v_code from hotels where id = p_hotel_id;
  if v_code is null then
    raise exception 'Unknown hotel %', p_hotel_id;
  end if;

  -- Serialise number allocation for THIS hotel only. Other properties are
  -- unaffected, so a busy Agra front desk never blocks Pune.
  perform pg_advisory_xact_lock(hashtext('reservation_ref:' || p_hotel_id::text));

  select coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) + 1
    into v_next
    from reservations
   where hotel_id = p_hotel_id;

  return v_code || '-' || lpad(v_next::text, 6, '0');   -- FH01-000123
end
$$;
