-- =============================================================================
-- 129 · One rule for "In house" and "Empty" (the owner's D21-36, D21-37)
-- =============================================================================
-- The same minute, the same hotel, and the screens disagreed: the property
-- page said In house 11 / Vacant 9 while the Dashboard and Rooms said 10 / 7
-- (14 September). Each screen counted for itself - reservations by status,
-- rooms by stay, "sold tonight" against "occupied now" - and the walk-in asked
-- a fourth thing, the stored column rooms.occupancy_status.
--
-- The owner decided, 21 September:
--
--   D21-36  In house   checked in and not yet checked out, whatever the
--                      departure date says. A late checkout still counts.
--   D21-37  Vacant     ("Empty" on the screens) nobody in it AND sellable
--                      tonight. Out-of-order and blocked rooms are their own
--                      count.
--
-- Written once, here, and every screen reads it through
-- GET /api/hotels/:code/house-now.
--
-- ⚠ FD-8, THE FOURTH DEFINITION. The walk-in refused room 208 at 5 Elements
-- - "Somebody is already in that room" - while Rooms showed it Free. The
-- walk-in read rooms.occupancy_status, and 070 set that column 'occupied' on
-- the INSERT of any live assignment: a room given in advance to a booking
-- arriving on the 27th was "occupied" from the moment the clerk chose it,
-- with nobody in it. The demo shows it twice (208 and 307, each held for a
-- confirmed booking days away). A room a guest moved out of mid-stay was the
-- same: 054 shortens that assignment rather than releasing it, and 070 only
-- ever looked at releases, so the room stayed "occupied" behind them.
--
-- A live assignment is a room HELD, not a room somebody is in. So the column
-- stops being a second answer: it is set from the rule below by the same two
-- triggers that set it before, plus one on a stay's status, and corrected
-- once for every room at the end of this file.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- D21-36 · Who is in house, and which room they are in now
-- -----------------------------------------------------------------------------
-- The room is app.room_for (072) on the property's own business date: the room
-- tonight is charged for, else the last one still held. So a moved guest is in
-- the room they moved to, and a guest past their departure date who has not
-- checked out is still in their room - which is what D21-36 says. NULL room
-- for a stay checked in with none held (054's unassign allows it); the stay is
-- still in house.
create or replace function app.in_house(p_hotel uuid)
returns table (reservation_id uuid, room_id uuid)
language sql
stable
as $$
  select r.id, rm.id
    from reservations r
    left join rooms rm
           on rm.hotel_id = r.hotel_id
          and rm.number = app.room_for(r.id, app.business_date(r.hotel_id))
   where r.hotel_id = p_hotel
     and r.status = 'checked_in'
$$;

comment on function app.in_house(uuid) is
  'D21-36: every stay checked in and not yet checked out, whatever its '
  'departure date, with the room it is in now (app.room_for on the business '
  'date). The one definition of In house.';

grant execute on function app.in_house(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- D21-37 · Every room, and which of the three it is tonight
-- -----------------------------------------------------------------------------
--   in_house      an in-house stay is in it (above)
--   out_of_order  a block covers the business date - the dated block, as
--                 app.sellable_rooms and every occupancy figure read it
--                 (INV-6, D17-11), inclusive on both ends
--   empty         neither: nobody in it and sellable tonight
--
-- The first two are independent facts. A guest still in a room a block has
-- started on counts in both, because both are true and each is somebody's job.
create or replace function app.house_now(p_hotel uuid)
returns table (
  room_id      uuid,
  number       text,
  in_house     boolean,
  out_of_order boolean,
  empty        boolean
)
language sql
stable
as $$
  with bd as (select app.business_date(p_hotel) as d),
       here as (select distinct i.room_id from app.in_house(p_hotel) i
                 where i.room_id is not null),
       flags as (
         select rm.id, rm.number,
                rm.id in (select h.room_id from here h) as in_house,
                exists (select 1 from room_blocks b, bd
                         where b.room_id = rm.id
                           and bd.d >= b.from_date
                           and (b.to_date is null or bd.d <= b.to_date)) as out_of_order
           from rooms rm
          where rm.hotel_id = p_hotel and rm.is_active)
  select id, number, in_house, out_of_order, not (in_house or out_of_order)
    from flags
   order by number
$$;

comment on function app.house_now(uuid) is
  'D21-37: every active room on the business date - in house (app.in_house), '
  'out of order (a block covers the date), or empty (neither). What the '
  'Dashboard, Rooms, In house, the property page and the housekeeping board '
  'count, through GET /api/hotels/:code/house-now.';

grant execute on function app.house_now(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- rooms.occupancy_status, set from the rule and from nothing else
-- -----------------------------------------------------------------------------
-- Only a change is written: 103 wakes the housekeeping board on every update
-- of this column, and a write of the same value is a board re-reading for
-- nothing.
create or replace function app.sync_room_occupancy(p_room uuid)
returns void
language sql
as $$
  update rooms rm
     set occupancy_status = s.status
    from (select r.id,
                 case when exists (select 1 from app.in_house(r.hotel_id) i
                                    where i.room_id = r.id)
                      then 'occupied' else 'vacant' end as status
            from rooms r where r.id = p_room) s
   where rm.id = s.id
     and rm.occupancy_status is distinct from s.status
$$;

comment on function app.sync_room_occupancy(uuid) is
  'Sets rooms.occupancy_status from app.in_house. A held room is not an '
  'occupied one (FD-8): only a checked-in guest in it now makes it occupied.';

grant execute on function app.sync_room_occupancy(uuid) to pms_app;



-- A room, and every room the same stay still holds. A move inserts the new
-- room AFTER shortening the old one, and only then does app.room_for say the
-- guest has left the old room - so the old room is re-read too.
create or replace function app.sync_stay_rooms(p_reservation uuid, p_room uuid)
returns void
language plpgsql
as $$
begin
  perform app.sync_room_occupancy(x.room_id)
     from (select p_room as room_id
           union
           select ra.room_id from room_assignments ra
            where ra.reservation_id = p_reservation
              and ra.released_at is null) x
    where x.room_id is not null;
end $$;

grant execute on function app.sync_stay_rooms(uuid, uuid) to pms_app;


-- Taking a room (070's trigger, same name and return type). A booking given
-- its room in advance leaves the room vacant: it is held, and nobody is in it.
create or replace function app.assigned_room_is_occupied()
returns trigger
language plpgsql
as $$
begin
  perform app.sync_stay_rooms(new.reservation_id, new.room_id);
  return new;
end $$;

comment on function app.assigned_room_is_occupied() is
  'A new assignment re-reads the rooms its stay holds against app.in_house. A '
  'room held for a guest who has not arrived stays vacant (FD-8).';


-- Leaving a room (070/074's trigger, same name and return type).
--
-- What makes a room dirty is 074's, unchanged: a RELEASE, never one where
-- the booking ended with nobody arriving, never a room out of service, and
-- not while another live assignment holds the room. Only the occupancy moved:
-- it is re-read from app.in_house instead of being set to 'vacant' here.
-- (That last guard also keeps clean a room checked out of while a LATER
-- booking holds it - FD-12, left for housekeeping and the owner.)
create or replace function app.vacated_room_is_dirty()
returns trigger
language plpgsql
as $$
declare v_status text;
begin
  perform app.sync_stay_rooms(new.reservation_id, new.room_id);

  -- Only the moment of RELEASE. An assignment written and released in the
  -- same statement, or a row updated for some other reason, must not
  -- re-dirty a room housekeeping has already turned around.
  if old.released_at is not null or new.released_at is null then
    return new;
  end if;

  select r.status into v_status
    from reservations r where r.id = new.reservation_id;

  update rooms
     set housekeeping_status = case
           when housekeeping_status = 'out_of_service' then housekeeping_status
           when v_status in ('void', 'no_show', 'cancelled')
             then housekeeping_status
           else 'dirty'
         end
   where id = new.room_id
     -- Somebody else may already be in it (070's words, 074's guard).
     and not exists (
       select 1 from room_assignments ra
        where ra.room_id = new.room_id
          and ra.released_at is null
          and ra.id <> new.id
     );

  return new;
end $$;

comment on function app.vacated_room_is_dirty() is
  'A released assignment means a guest has left a room, so the room is dirty '
  '-- unless another assignment holds it or the booking ended without anybody '
  'arriving (074). Every change re-reads the rooms the stay holds against '
  'app.in_house for their occupancy.';


-- A stay's status is the other half of the rule: a check-in puts a guest in
-- the room they hold, a check-out takes them out of it.
create or replace function app.stay_status_moves_room()
returns trigger
language plpgsql
as $$
begin
  perform app.sync_stay_rooms(new.id, null);
  return null;                                    -- AFTER trigger; ignored
end $$;

comment on function app.stay_status_moves_room() is
  'Re-reads each room a stay holds against app.in_house when its status '
  'changes, so rooms.occupancy_status follows check-in and check-out.';

drop trigger if exists reservations_occupancy on reservations;
create trigger reservations_occupancy
  after update of status on reservations
  for each row
  when (old.status is distinct from new.status)
  execute function app.stay_status_moves_room();

-- ponytail: the column is re-read on every write that can change it. A move
-- dated in the FUTURE changes the guest's room when the business date reaches
-- it, with no write, so the column can be a night behind until the next write
-- to that stay. The screens, the walk-in and house-now read app.in_house live
-- and are never behind; only the column's other readers (inventory's "retire
-- a room") can be. Re-sync a hotel's rooms when its night audit completes if
-- that ever matters.


-- -----------------------------------------------------------------------------
-- Every room once, now. 208 and 307 in the demo; whatever else the old rule
-- left behind wherever this runs. Re-running it changes nothing.
-- -----------------------------------------------------------------------------
select app.sync_room_occupancy(id) from rooms;
