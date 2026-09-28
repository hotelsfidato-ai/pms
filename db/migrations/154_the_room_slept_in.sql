-- =============================================================================
-- 154 — which room a stay was in: the one LEFT last, not a coin toss (FD-5)
-- =============================================================================
-- The QA of 28 September: a booking given room 204 ahead, checked in to 208
-- and checked out. The toast said "Room 208 is now dirty"; the lists, the
-- panel, the invoices and the night audit report then said 204.
--
-- 086's rule was "the room still held, else the most recent", written
--
--     order by ra.released_at nulls first, ra.from_date desc
--
-- After check-out BOTH assignments are released, and at check-in the new one
-- starts on the SAME date as the one it replaced - so "the most recent" by
-- from_date is a tie, and Postgres broke it either way. The room left LAST is
-- the room they slept in: 204 was released at check-in, 208 at check-out. A
-- move is answered the same way (the old room is released at the move).
--
-- Same name, argument and return type: CREATE OR REPLACE (MEMORY 317). The
-- same line, written out in six queries (086 counted them), is changed there
-- by the same commit.
-- =============================================================================

create or replace function app.stay_room(p_reservation uuid)
returns text
language sql stable as $$
  select rm.number
    from room_assignments ra
    join rooms rm on rm.id = ra.room_id
   where ra.reservation_id = p_reservation
   order by ra.released_at desc nulls first, ra.from_date desc
   limit 1;
$$;

comment on function app.stay_room(uuid) is
  'The room a stay is in, or was in: the assignment still held, else the one '
  'released last (FD-5). NULL only when no room was ever assigned. For '
  'DISPLAY - "who is in this room now" is a different question and wants the '
  'held assignment alone.';

grant execute on function app.stay_room(uuid) to pms_app;
