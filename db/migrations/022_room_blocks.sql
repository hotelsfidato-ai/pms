-- =============================================================================
-- 022_room_blocks.sql — when a room is not sellable, and for how long
-- =============================================================================
-- Found at CP9e, moving the statistics repository from fixtures onto SQL.
--
-- THE PROBLEM:
--   Occupancy divides by AVAILABLE ROOM-NIGHTS. The real Monthly Statistics
--   export for this property shows 17 available rooms most days and 18 on
--   8–13 August, because one room came back into inventory for a week. That is
--   what makes the arithmetic close:
--
--       19 days × 17  +  6 days × 18  =  431 available room-nights
--       132 sold / 431                =  30.63%
--
--   Nothing in the schema could express it. `rooms.housekeeping_status` holds
--   the room's state RIGHT NOW, and `room_status_log` records that a change
--   happened — neither can answer "how many rooms were sellable on the 10th",
--   and neither can hold a block that starts next week.
--
--   So the availability curve lived in a TypeScript fixture, and every
--   occupancy figure in the product was reading a number the database did not
--   know. The calibration was smuggled in rather than derived.
--
-- WHAT THIS ADDS:
--   A date range per room, with a reason. Availability on any date becomes a
--   query, the 431 becomes derivable, and the calibration turns from data the
--   product carries into a CHECK on what the database says.
--
--   `to_date` is nullable and means indefinite — which is the honest shape for
--   "this room is out until further notice", the commonest case.
-- =============================================================================

create table if not exists room_blocks (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  room_id     uuid not null references rooms(id)  on delete cascade,

  from_date   date not null,
  -- NULL means indefinite. A room out for refurbishment has no known return
  -- date, and inventing one puts it back on sale on a day nobody chose.
  to_date     date,

  reason      text not null,
  note        text,

  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),

  constraint room_blocks_dates_ordered
    check (to_date is null or to_date >= from_date),

  constraint room_blocks_reason_valid check (reason in (
    'out_of_service',   -- deliberately held back; still counts as inventory
    'out_of_order',     -- broken
    'refurbishment',
    'house_use',        -- staff, storage, an office
    'owner_occupied'
  ))
);

create index if not exists room_blocks_lookup
  on room_blocks (hotel_id, from_date, to_date);

create index if not exists room_blocks_room_idx
  on room_blocks (room_id);


-- -----------------------------------------------------------------------------
-- Isolation. Caught by the suite's own coverage assertion the first time this
-- migration ran: "every table in public has RLS enabled — room_blocks".
--
-- A new table without a policy is a new table every tenant can read. The
-- assertion exists because that is easy to forget and impossible to notice.
-- -----------------------------------------------------------------------------
alter table room_blocks enable row level security;
alter table room_blocks force row level security;

drop policy if exists room_blocks_isolation on room_blocks;
create policy room_blocks_isolation on room_blocks
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

comment on table room_blocks is
  'When a room is not sellable, and for how long. Availability on a date is '
  'active rooms minus the blocks covering it — which is what occupancy '
  'divides by. rooms.housekeeping_status is the state NOW; this is the state '
  'over time, and only this can answer what was sellable last Tuesday.';


-- -----------------------------------------------------------------------------
-- Sellable rooms on a given date.
-- -----------------------------------------------------------------------------
-- One definition, used by every report, so occupancy cannot mean two things on
-- two screens. STABLE, not IMMUTABLE: it reads tables.
-- -----------------------------------------------------------------------------
create or replace function app.sellable_rooms(p_hotel_id uuid, p_date date)
returns integer
language sql
stable
as $$
  select count(*)::int
    from rooms r
   where r.hotel_id = p_hotel_id
     and r.is_active
     and not exists (
       select 1 from room_blocks b
        where b.room_id = r.id
          and p_date >= b.from_date
          and (b.to_date is null or p_date <= b.to_date)
     )
$$;

comment on function app.sellable_rooms(uuid, date) is
  'Rooms that could be sold on this date. The denominator of every occupancy '
  'figure in the product. Never count rooms directly for this — a room held '
  'out of service is inventory that cannot be sold, and the two differ.';


-- -----------------------------------------------------------------------------
-- Backfill from the state the rooms are in now.
-- -----------------------------------------------------------------------------
-- A room currently out of service has been out indefinitely as far as anything
-- recorded knows. This makes the new table agree with the old column rather
-- than silently disagreeing on day one.
--
-- The demo loader overwrites these with the real dates, because for that one
-- property the actual curve is known from the export.
-- -----------------------------------------------------------------------------
insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, note)
select r.hotel_id, r.id, current_date, null,
       case r.housekeeping_status
         when 'out_of_order' then 'out_of_order'
         else 'out_of_service'
       end,
       'Backfilled by migration 022 from housekeeping_status.'
  from rooms r
 where r.housekeeping_status in ('out_of_service', 'out_of_order')
   and not exists (
     select 1 from room_blocks b where b.room_id = r.id and b.to_date is null
   );


do $$
begin
  if not exists (select 1 from pg_tables where tablename = 'room_blocks') then
    raise exception '022: room_blocks was not created';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'sellable_rooms'
  ) then
    raise exception '022: app.sellable_rooms() was not created';
  end if;
end $$;
