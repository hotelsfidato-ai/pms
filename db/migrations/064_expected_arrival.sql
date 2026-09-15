-- =============================================================================
-- 064 — when the guest says they will get here
-- =============================================================================
-- A booking carries the DATE somebody arrives and has never carried the HOUR.
-- The desk needs both, and for different reasons:
--
--   "arriving late, around 11pm"     do not release the room at six, and
--                                    leave the key with the night porter
--   "arriving at 8 in the morning"   this is an early arrival before it
--                                    happens, not a surprise at the desk
--   nothing said                     the ordinary case, and the common one
--
-- NULLABLE, and that is the point. Most guests do not say, and a system that
-- demands an hour would get a made-up one — which is worse than none, because
-- somebody would then hold a room against it. NULL reads as "not said"
-- everywhere, never as midnight.
--
-- A TIME, NOT A TIMESTAMP. The date is already on the booking, and carrying it
-- twice is how the two come to disagree — amend the stay and the timestamp
-- still points at the old day. The property's own clock, like check_in_time.
-- =============================================================================

alter table reservations add column if not exists expected_arrival time;

comment on column reservations.expected_arrival is
  'The hour the guest said they would arrive, in the property''s own time. '
  'NULL means they did not say, which is the common case — it is never '
  'midnight, and nothing should hold a room against a time nobody gave.';

/* Today's arrivals, in the order the desk will meet them. Somebody who said
   nothing sorts last: the desk works through the people it can plan for, and
   the rest arrive when they arrive. */
create index if not exists reservations_expected_arrival_idx
  on reservations (hotel_id, check_in, expected_arrival nulls last)
  where status in ('confirmed', 'tentative');
