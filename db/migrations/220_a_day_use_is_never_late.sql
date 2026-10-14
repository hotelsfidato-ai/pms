-- =============================================================================
-- 220 · A day use is never a late departure (the owner's D27-319 (2), 14 October)
-- =============================================================================
-- 217's app.departure_is_late(hotel, at, departure) was given the departure
-- date only. A day use (out the day it comes, reservations.is_day_use, 015)
-- leaves ON its departure date, so after the property's check-out time it was
-- asked "Leaving after check-out time" and charged the late fee - for a stay
-- that is all one day and has its own hours. A day use is never late: never
-- asked, never charged. Everything else as 217: on or after the departure date
-- by the hotel's BUSINESS date, the check-out time on the property's clock.
--
-- So the rule is given the arrival too. Still the one rule the check-out route
-- asks (operations.ts); no screen decides it.
--
-- The version without the arrival is dropped, so nothing can ask the old
-- question. Re-runnable: the replay makes 217's version first; this drops it
-- again and replaces its own.
-- =============================================================================

drop function if exists app.departure_is_late(uuid, timestamptz, date);

create or replace function app.departure_is_late(
  p_hotel uuid, p_at timestamptz, p_arrival date, p_departure date)
returns boolean language sql stable as $$
  select p_departure > p_arrival
     and app.business_date(h.id) >= p_departure
     and (p_at at time zone h.timezone)::time > h.check_out_time
    from hotels h where h.id = p_hotel;
$$;

comment on function app.departure_is_late(uuid, timestamptz, date, date) is
  'True when the stay is not a day use, the hotel''s business date is on or '
  'after the departure date and the hour, on the PROPERTY''S clock, is past its '
  'check-out time. Before the date is leaving early (D27-314); a day use is '
  'never late (D27-319).';

grant execute on function app.departure_is_late(uuid, timestamptz, date, date) to pms_app;
