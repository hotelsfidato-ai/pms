-- =============================================================================
-- 217 · A late departure only on or after the departure date (the owner's
--       D27-314 (2), 13 October)
-- =============================================================================
-- app.departure_is_late (063) compared only the hour: past the property's
-- check-out time was "late" on ANY day. So a guest leaving a day early, in the
-- afternoon, was asked "Leaving after check-out time" and charged the late
-- fee. Leaving before the departure date is leaving early, whatever the hour:
-- never asked, never charged a late fee. On the date, or after it, the
-- check-out time decides, on the property's clock, as before.
--
-- The date is the hotel's BUSINESS date (app.business_date), never the
-- clock's (MEMORY 19): the hotel is on the day its night audit has reached,
-- and "Due out" on the desk is the business date too. The A5 script's early
-- leaver departed after the business date.
--
-- The one rule the check-out route asks (operations.ts); no screen decides it
-- (the Bill tab opens the late dialog only on the route's `needs`).
--
-- The version without the date is dropped, so nothing can ask the old
-- question. Re-runnable: the replay makes 063's two-argument version first;
-- this drops it again and replaces its own.
-- =============================================================================

drop function if exists app.departure_is_late(uuid, timestamptz);

create or replace function app.departure_is_late(
  p_hotel uuid, p_at timestamptz, p_departure date)
returns boolean language sql stable as $$
  select app.business_date(h.id) >= p_departure
     and (p_at at time zone h.timezone)::time > h.check_out_time
    from hotels h where h.id = p_hotel;
$$;

comment on function app.departure_is_late(uuid, timestamptz, date) is
  'True when the hotel''s business date is on or after the departure date and '
  'the hour, on the PROPERTY''S clock, is past its check-out time. Before the '
  'date is leaving early: never a late departure (D27-314).';

grant execute on function app.departure_is_late(uuid, timestamptz, date) to pms_app;
