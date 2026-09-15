-- =============================================================================
-- 085 · A walk-in came through the Walk-in channel, and now says so
-- =============================================================================
-- 082 made the channel compulsory and wrote that the API enforces it. The API
-- has TWO statements that create a reservation:
--
--     api/src/routes/groups.ts      the booking form   requires the channel
--     api/src/routes/operations.ts  the walk-in desk   never set it
--
-- So the desk went on writing source = 'walk_in' with booking_source_id NULL.
-- Found on production on 14 September, one stay in four. Defect 242.
--
-- ⚠ NOTHING LOOKED WRONG, WHICH IS WHY IT LASTED. `app.booking_source_label`
-- falls back to the legacy column and prints "Walk-in", so the stay list read
-- correctly. Everything that counts BY CHANNEL — the Booking sources screen,
-- the commission stamped at booking — did not see the stay at all.
--
-- ⚠ "WHICH SOURCE IS THE WALK-IN CHANNEL" IS ANSWERED ONCE, HERE. The desk
-- asks this function and the back-fill below asks it too. Two spellings of
-- the lookup, by name in one place and by kind in another, would disagree the
-- day somebody renames "Walk-in" to "Walk-in guest".
--
-- By KIND, not by name, so renaming the row cannot break the desk. The oldest
-- active one when there are several: deterministic, and the seeded row is the
-- oldest. NULL when none is switched on, and the desk refuses rather than
-- saving a stay with no channel — the same answer the booking form gives.
-- =============================================================================

create or replace function app.walk_in_source() returns uuid
language sql stable as $$
  select id
    from booking_sources
   where kind = 'walk_in' and is_active
   order by created_at, id
   limit 1;
$$;

comment on function app.walk_in_source() is
  'The booking source a walk-in is recorded against: the oldest active source '
  'of kind walk_in. NULL when none is switched on. The ONE definition — the '
  'walk-in desk and the 085 back-fill both ask it.';

grant execute on function app.walk_in_source() to pms_app;


-- -----------------------------------------------------------------------------
-- The stays the desk took before this
-- -----------------------------------------------------------------------------
-- Only source = 'walk_in': that exact value is what operations.ts wrote, and
-- the booking form writes the source's NAME ("Walk-in") alongside a channel,
-- so it never matches here.
--
-- ⚠ COMMISSION STAYS NULL. 082's rule is that the rate in force on the day is
-- stamped at booking, and it never was for these. Filling one in now would be
-- restating history with today's terms — and NULL already means "not agreed",
-- which renders as a dash.
--
-- Re-runnable: a second run finds nothing with a NULL channel to fill.
-- -----------------------------------------------------------------------------
update reservations
   set booking_source_id = app.walk_in_source()
 where booking_source_id is null
   and source = 'walk_in'
   and app.walk_in_source() is not null;
