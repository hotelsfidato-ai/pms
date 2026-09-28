-- =============================================================================
-- 153 — a booking reference takes the hotel's BUSINESS month (BK-12, D27-123)
-- =============================================================================
-- 092 made one reference, FH-<hotel code>-<YYMM>-<number>, with YYMM "the year
-- and month the booking was MADE, on the hotel's own clock". The QA of 28
-- September booked at 5 Elements while the hotel was still working 25 August
-- and got FH-5EL-2609-5032: September from the wall clock, on a booking made
-- in the hotel's August. The owner, D27-123: the month is the hotel's business
-- date, not the wall clock - the day every posting, report and closed day is
-- already filed under (app.business_date, 023).
--
-- Only the month changes. Same name, arguments and return type, so CREATE OR
-- REPLACE is enough and a replay of 092 before this is harmless (MEMORY 317).
-- Old references keep what they were issued with.
-- =============================================================================

create or replace function app.next_reference(p_hotel_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_next bigint;
begin
  select code into v_code from hotels where id = p_hotel_id;
  if v_code is null then
    raise exception 'Unknown hotel %', p_hotel_id;
  end if;

  -- 092's lock, unchanged: the caller inserts in the same transaction.
  perform pg_advisory_xact_lock(hashtext('reservation_ref:' || p_hotel_id::text));

  select coalesce(max(substring(reference from '[0-9]+$')::bigint), 5000) + 1
    into v_next
    from reservations
   where hotel_id = p_hotel_id;

  return 'FH-' || v_code
      || '-' || to_char(app.business_date(p_hotel_id), 'YYMM')
      -- NOT lpad alone: it CUTS a longer number (092).
      || '-' || case when length(v_next::text) < 4
                     then lpad(v_next::text, 4, '0')
                     else v_next::text end;
end
$$;

comment on function app.next_reference(uuid) is
  'The next booking reference for a hotel: FH-<hotel code>-<YYMM>-<number>, '
  'YYMM from the hotel''s business date (D27-123), e.g. FH-5EL-2608-4858. '
  'Takes a per-hotel lock held until the transaction ends, so the caller must '
  'insert the reservation in that same transaction. The number continues the '
  'hotel''s existing count and is never truncated.';

grant execute on function app.next_reference(uuid) to pms_app;
