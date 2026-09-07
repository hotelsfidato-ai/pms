-- =============================================================================
-- 074 · A room nobody entered is not dirty
-- =============================================================================
-- 070 put one rule at the fact instead of at the call sites: "a released
-- assignment means a guest has left a room, so the room is vacant and dirty."
-- That was right for the three ways a room is vacated by a PERSON — check-out,
-- move, exchange — and it is the reason a slept-in bed can no longer be handed
-- to the next guest.
--
-- 073 then made a fourth thing release an assignment: a booking reaching a
-- terminal state without anybody arriving. The premise stops holding there.
-- Nobody was in the room, so nothing in it is dirty.
--
-- CAUGHT IMMEDIATELY, on the screen, by the fix's own side effect: releasing
-- no-show 305 put it straight into the cleaning queue and took it back out of
-- tonight's availability -- 8 Deluxe, one occupied, six sellable. The room was
-- lost to housekeeping instead of to the constraint. A fix that moves a fault
-- rather than removing it is not a fix.
--
-- The room still becomes VACANT, because it is. Only the cleanliness is left
-- alone: whatever housekeeping last recorded is still true of a room nobody
-- opened.
-- =============================================================================

create or replace function app.vacated_room_is_dirty()
returns trigger
language plpgsql
as $$
declare v_status text;
begin
  -- Only the moment of RELEASE. An assignment written and released in the
  -- same statement, or a row updated for some other reason, must not
  -- re-dirty a room housekeeping has already turned around.
  if old.released_at is not null or new.released_at is null then
    return new;
  end if;

  /* DID ANYBODY ACTUALLY GO IN? The three terminal states 073 releases on
     all mean the guest never arrived — a void is a booking that never
     existed, a cancellation is one that was called off, a no-show is one
     that did not turn up. The room is given back, and it is exactly as
     clean as housekeeping last left it. */
  select r.status into v_status
    from reservations r where r.id = new.reservation_id;

  update rooms
     set occupancy_status = 'vacant',
         /* NOT if it is out of service. A room held out for a leaking tap
            is not clean and is not dirty — it is unavailable, and 022 gave
            that its own state precisely so a check-out could not quietly
            put it back into the cleaning queue and from there into
            inventory. */
         housekeeping_status = case
           when housekeeping_status = 'out_of_service' then housekeeping_status
           when v_status in ('void', 'no_show', 'cancelled')
             then housekeeping_status
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
  'and dirty -- UNLESS the booking ended without anybody arriving, in which '
  'case it is vacant and exactly as clean as it was. One rule, at the fact, '
  'rather than at the call sites that vacate a room.';

-- -----------------------------------------------------------------------------
-- The rooms 073 put in the cleaning queue on its way past
-- -----------------------------------------------------------------------------
-- Narrow: dirty, empty, and the only thing that ever touched them is a booking
-- nobody arrived for. A room with any history of an actual guest is left
-- alone -- housekeeping's record of it is not ours to overwrite.
-- -----------------------------------------------------------------------------
update rooms rm
   set housekeeping_status = 'clean'
 where rm.housekeeping_status = 'dirty'
   and not exists (
     select 1 from room_assignments ra
      where ra.room_id = rm.id and ra.released_at is null)
   and exists (
     select 1 from room_assignments ra
       join reservations r on r.id = ra.reservation_id
      where ra.room_id = rm.id
        and r.status in ('void', 'no_show', 'cancelled'))
   and not exists (
     select 1 from room_assignments ra
       join reservations r on r.id = ra.reservation_id
      where ra.room_id = rm.id
        and r.status not in ('void', 'no_show', 'cancelled'));
