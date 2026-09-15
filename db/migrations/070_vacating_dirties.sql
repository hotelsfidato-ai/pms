-- =============================================================================
-- 070_vacating_dirties.sql — a room somebody slept in is dirty
-- =============================================================================
-- Check-out already set the room vacant and dirty, in the API, at the one call
-- site that does it. Nothing else did.
--
-- A ROOM IS VACATED BY MORE THAN A CHECK-OUT:
--
--   move_room        the guest goes to 205 and 201 is left behind
--   exchange_rooms   two guests swap, and both rooms were slept in
--   unassign_room    the assignment is taken back
--
-- None of those touched `rooms`. So 201 sat there marked `occupied` and
-- `clean` — occupied because nothing set it back, clean because nobody had
-- ever said otherwise — and housekeeping never saw it. The next guest walked
-- into a bed that had been slept in, and the board that exists to prevent
-- exactly that had no idea.
--
-- THE RULE BELONGS WHERE THE FACT IS, not in three call sites and whichever
-- fourth gets written next. Releasing an assignment IS a guest leaving a room:
-- every path already does it, because that is what "the guest is no longer in
-- this room" means. So the trigger goes there, and anything added later gets
-- it without knowing.
--
-- WHY DIRTY AND NOT "NEEDS INSPECTION". Somebody slept in it. What happens
-- next — cleaned, inspected, held out of service — is housekeeping's to
-- decide, and 003 keeps `housekeeping_status` independent of occupancy for
-- precisely that reason. This sets the one thing that is certainly true.
-- =============================================================================

create or replace function app.vacated_room_is_dirty()
returns trigger
language plpgsql
as $$
begin
  -- Only the moment of RELEASE. An assignment written and released in the
  -- same statement, or a row updated for some other reason, must not
  -- re-dirty a room housekeeping has already turned around.
  if old.released_at is not null or new.released_at is null then
    return new;
  end if;

  update rooms
     set occupancy_status = 'vacant',
         /* NOT if it is out of service. A room held out for a leaking tap
            is not clean and is not dirty — it is unavailable, and 022 gave
            that its own state precisely so a check-out could not quietly
            put it back into the cleaning queue and from there into
            inventory. */
         housekeeping_status = case
           when housekeeping_status = 'out_of_service' then housekeeping_status
           else 'dirty'
         end
   where id = new.room_id
     -- Somebody else may already be in it. An exchange writes the new
     -- occupant before releasing the old one, and marking the room vacant
     -- underneath a guest who is standing in it would be worse than the
     -- problem this fixes.
     and not exists (
       select 1 from room_assignments ra
        where ra.room_id = new.room_id
          and ra.released_at is null
          and ra.id <> new.id
     );

  return new;
end $$;

comment on function app.vacated_room_is_dirty() is
  'A released assignment means a guest has left a room, so the room is vacant '
  'and dirty. One rule, at the fact, rather than at the three call sites that '
  'vacate a room today and the fourth that gets written next.';

drop trigger if exists room_assignments_vacate on room_assignments;
create trigger room_assignments_vacate
  after update on room_assignments
  for each row execute function app.vacated_room_is_dirty();


-- -----------------------------------------------------------------------------
-- ...and taking a room dirties nothing, but it does OCCUPY it
-- -----------------------------------------------------------------------------
-- The mirror. Check-in set `occupancy_status = 'occupied'` in the API and
-- nothing else did, so a room reached by a move showed as vacant while
-- somebody slept in it. Same fix, same reason, same place.
create or replace function app.assigned_room_is_occupied()
returns trigger
language plpgsql
as $$
begin
  if new.released_at is not null then
    return new;
  end if;

  update rooms set occupancy_status = 'occupied' where id = new.room_id;
  return new;
end $$;

comment on function app.assigned_room_is_occupied() is
  'A live assignment means somebody is in the room. The mirror of '
  'app.vacated_room_is_dirty(), for the same reason.';

drop trigger if exists room_assignments_occupy on room_assignments;
create trigger room_assignments_occupy
  after insert on room_assignments
  for each row execute function app.assigned_room_is_occupied();


-- -----------------------------------------------------------------------------
-- What is waiting to be cleaned, and how long it has been waiting
-- -----------------------------------------------------------------------------
-- The board shows rooms that ARE dirty. It could not say for how long, so a
-- room dirtied at eleven and a room dirtied three days ago looked identical —
-- and the second one is the one that matters, because it means somebody
-- forgot.
--
-- Derived from the assignment that vacated it, so there is nothing to keep in
-- step and nothing to go stale.
create or replace function app.room_dirty_since(p_room uuid)
returns timestamptz
language sql
stable
as $$
  select max(ra.released_at)
    from room_assignments ra
   where ra.room_id = p_room
     and ra.released_at is not null
     -- Only if nobody has been in it since. A room turned around and re-let
     -- is not "dirty since last Tuesday".
     and not exists (
       select 1 from room_assignments later
        where later.room_id = p_room
          and later.released_at is null
     )
$$;

comment on function app.room_dirty_since(uuid) is
  'When the last guest left, for a room still waiting. A board that cannot '
  'say how long has no way to show that somebody forgot.';

grant execute on function app.room_dirty_since(uuid) to pms_app;
