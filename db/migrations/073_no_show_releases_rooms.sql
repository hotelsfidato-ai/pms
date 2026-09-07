-- =============================================================================
-- 073 · A no-show holds no room. Neither does a cancellation.
-- =============================================================================
-- 042 wrote this exact rule for VOID, and wrote down why:
--
--   "The assignment is what makes a room unavailable. Leaving it behind on a
--    voided booking holds a room out of inventory for a stay that never
--    existed — and it is the kind of thing found weeks later, by a clerk who
--    cannot sell a room that looks empty."
--
-- Every word of that is true of a NO-SHOW, and a no-show is far commoner than
-- a void. The trigger covered one status and the reasoning covered three.
--
-- FOUND BY CLOSING TWO REAL NIGHTS. The audit marked two arrivals no-show,
-- correctly, and left one of them holding room 305 from the 5th to the 8th.
-- The tape chart drew a bar over a room nobody was in, and the exclusion
-- constraint refused to sell it:
--
--   ERROR: conflicting key value violates exclusion constraint
--          "ra_no_double_booking"
--   DETAIL: (305, [2026-09-07,2026-09-08)) conflicts with
--           (305, [2026-09-05,2026-09-08))
--
-- So the property could not sell tonight a room whose guest never came. That
-- is revenue, it is silent, and it happens on every no-show.
--
-- CANCELLED IS HERE TOO. It is the same sentence again, and a cancellation
-- that arrives after a room has been allocated is ordinary.
-- =============================================================================

create or replace function app.void_releases_rooms()
returns trigger language plpgsql as $$
begin
  /* THE SET IS "the booking is over and nobody came or is coming".
     Named as one list rather than three triggers: a fourth terminal
     status added later must arrive HERE, and a reader can see in one
     line which statuses give a room back. */
  if new.status in ('void', 'no_show', 'cancelled')
     and old.status is distinct from new.status then
    update room_assignments
       set released_at = now()
     where reservation_id = new.id and released_at is null;
  end if;
  return new;
end $$;

comment on function app.void_releases_rooms() is
  'A booking in a terminal state gives its room back: void, no_show or '
  'cancelled. The assignment is what makes a room unavailable, so leaving it '
  'behind holds a room out of sale for a stay that is not happening.';

-- The trigger already exists from 042 and fires on the same event. Recreated
-- idempotently so a database that somehow lacks it gets one.
drop trigger if exists reservations_void_releases on reservations;
create trigger reservations_void_releases
  after update of status on reservations
  for each row execute function app.void_releases_rooms();

-- -----------------------------------------------------------------------------
-- The rooms already held by bookings that are over
-- -----------------------------------------------------------------------------
-- A trigger fixes what happens next. It does nothing about the rooms already
-- out of sale, and those are the ones costing money today — at Akkalkot, 305
-- for three nights against a guest the audit marked no-show an hour ago.
--
-- Narrow on purpose: only assignments still live, only against reservations in
-- a terminal state. A checked-out stay is not touched — check-out releases its
-- own room and does other things besides.
-- -----------------------------------------------------------------------------
update room_assignments ra
   set released_at = now()
  from reservations r
 where r.id = ra.reservation_id
   and ra.released_at is null
   and r.status in ('void', 'no_show', 'cancelled');
