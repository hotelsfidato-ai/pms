-- =============================================================================
-- 113 · A time a person types belongs to the PROPERTY, not to the server
-- =============================================================================
-- BQ-8, root MEMORY 297, found by the first CI run on 18 September and fixed on
-- the owner's word the same day.
--
-- WHAT WAS WRONG. `banquet.ts` wrote `$7::timestamptz` from a bare string -
-- `2026-09-17T19:00`, no offset - and Postgres reads a bare time in the
-- SESSION's time zone. The laptop this was written on runs Asia/Kolkata, so it
-- happened to mean the hotel's own clock and every screen looked right. **The
-- hotel's server runs its database in GMT** (checked on the box: `show
-- timezone` -> GMT). There, a clerk's 19:00 became 19:00 GMT - half past
-- midnight the next morning in Akkalkot.
--
-- Then the two readers disagreed about the same row: the diary printed
-- `to_char(starts_at, …)`, the session's zone, and showed 19:00; the till
-- converted `at time zone h.timezone`, correctly, and saw the next day. One
-- moment, two days, depending on which screen asked.
--
-- WHY IT IS FIXED HERE AND NOT IN THE ROUTE. Three files already spelled this
-- rule three ways. A rule spelled three ways is a rule that will be spelled a
-- fourth, and the fourth will be wrong - defect 188's lesson about `psql`, one
-- table along. These two functions are the only place the conversion happens,
-- and everything else calls them.
--
-- NOTHING IS RE-READ. The live database holds no banquet events and no venues
-- (checked, 18 September), so there is no row whose meaning this changes. Had
-- there been, this migration would have had to shift them, and that would have
-- been the owner's decision rather than a tidy-up.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A local time, as the property means it
-- -----------------------------------------------------------------------------
-- A string that already carries an offset is absolute and is taken as it is: a
-- channel manager sending `2026-09-17T19:00+05:30` has said exactly which
-- moment, and second-guessing it would be worse than useless. Everything else
-- is what a person typed on a screen in the hotel, and means the hotel's clock.
create or replace function app.hotel_moment(p_hotel uuid, p_local text)
returns timestamptz
language plpgsql
stable
as $fn$
declare v_tz text;
begin
  if p_local is null or btrim(p_local) = '' then
    return null;
  end if;

  if p_local ~ '(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    return p_local::timestamptz;
  end if;

  select timezone into v_tz from hotels where id = p_hotel;
  if v_tz is null then
    -- Not "no time zone": a property this session cannot see has no clock to
    -- read a time by, and guessing one would put the event on a day nobody
    -- chose.
    raise exception
      'app.hotel_moment: no property % is visible here, so "%" has no clock to be read by.',
      p_hotel, p_local
      using hint = 'The caller must be rostered at that property.';
  end if;

  return (p_local::timestamp) at time zone v_tz;
end
$fn$;

comment on function app.hotel_moment(uuid, text) is
  'A time a person typed at a property, as the moment it means. A bare time is '
  'read in that property''s own zone; one that carries an offset is taken as '
  'it is. BQ-8: the server''s zone is not the hotel''s.';

-- -----------------------------------------------------------------------------
-- And the same moment, back on the property's clock
-- -----------------------------------------------------------------------------
-- Every screen that shows a banquet time reads it through this, so the diary
-- and the till cannot disagree about which day a function is on.
create or replace function app.hotel_clock(
  p_hotel uuid, p_at timestamptz, p_format text default 'YYYY-MM-DD"T"HH24:MI'
)
returns text
language plpgsql
stable
as $fn$
declare v_tz text;
begin
  if p_at is null then
    return null;
  end if;
  select timezone into v_tz from hotels where id = p_hotel;
  if v_tz is null then
    raise exception
      'app.hotel_clock: no property % is visible here, so its times cannot be read.',
      p_hotel;
  end if;
  return to_char(p_at at time zone v_tz, p_format);
end
$fn$;

comment on function app.hotel_clock(uuid, timestamptz, text) is
  'A stored moment on the property''s own clock. The one way a time is shown, '
  'so two screens cannot place one function on two days (BQ-8).';

-- -----------------------------------------------------------------------------
-- The day that moment falls on, at the property
-- -----------------------------------------------------------------------------
-- What "is this function running today?" asks. A function that ends at
-- midnight ended on the day before: the last second it occupies is the one
-- that counts, which is why the end is asked a second early.
create or replace function app.hotel_day(p_hotel uuid, p_at timestamptz)
returns date
language sql
stable
as $fn$
  select (app.hotel_clock(p_hotel, p_at, 'YYYY-MM-DD'))::date;
$fn$;

comment on function app.hotel_day(uuid, timestamptz) is
  'The property''s own date for a stored moment (BQ-8).';

grant execute on function app.hotel_moment(uuid, text) to pms_app;
grant execute on function app.hotel_clock(uuid, timestamptz, text) to pms_app;
grant execute on function app.hotel_day(uuid, timestamptz) to pms_app;
