-- =============================================================================
-- 185 — a room is dirtied only by a guest who was in it (FD-10, FD-12;
--       the owner's D27-239, 2 October)
-- =============================================================================
-- app.vacated_room_is_dirty (070, 074, 129) dirties a room when its assignment
-- is released. Two things were wrong with when:
--
-- FD-10. It dirtied on every release but a void, no-show or cancelled booking,
-- so a CONFIRMED booking's room, given ahead and then let go (unassigned, or
-- the guest checked into another room), went to cleaning with nobody ever in
-- it. Now only a stay that ARRIVED (checked_in, checked_out) dirties its room.
-- (Check-in now releases a pre-assigned other room before the stay turns
-- checked_in, so that room stays as it was.)
--
-- FD-12. It skipped the room while ANY other live assignment held it, so a
-- room checked out of while a LATER booking holds it (next week's guest)
-- stayed "clean" with a used bed. Now it skips only while somebody is IN the
-- room (app.in_house, the one rule, 129).
--
-- Same name, same trigger (room_assignments_vacate), create or replace.
-- =============================================================================

create or replace function app.vacated_room_is_dirty()
returns trigger
language plpgsql
as $$
declare v_status text; v_hotel uuid;
begin
  perform app.sync_stay_rooms(new.reservation_id, new.room_id);

  -- Only the moment of RELEASE. An assignment written and released in the
  -- same statement, or a row updated for some other reason, must not
  -- re-dirty a room housekeeping has already turned around.
  if old.released_at is not null or new.released_at is null then
    return new;
  end if;

  select r.status, r.hotel_id into v_status, v_hotel
    from reservations r where r.id = new.reservation_id;

  update rooms
     set housekeeping_status = case
           when housekeeping_status = 'out_of_service' then housekeeping_status
           -- FD-10: only a guest who arrived leaves a used room behind.
           when v_status in ('checked_in', 'checked_out') then 'dirty'
           else housekeeping_status
         end
   where id = new.room_id
     -- FD-12: somebody else IN the room now - not merely holding it later.
     and not exists (
       select 1 from app.in_house(v_hotel) h
        where h.room_id = new.room_id
          and h.reservation_id <> new.reservation_id
     );

  return new;
end $$;

comment on function app.vacated_room_is_dirty() is
  'A released assignment of a stay that arrived means a guest has left a room, '
  'so the room is dirty - unless somebody else is in it now (app.in_house). A '
  'booking that never arrived leaves its room as it was (185: FD-10, FD-12). '
  'Every change re-reads the rooms the stay holds against app.in_house for '
  'their occupancy.';
