-- =============================================================================
-- 023_business_date.sql — the business date belongs to the property
-- =============================================================================
-- Found at CP11. `BUSINESS_DATE` has been a constant in TypeScript since the
-- first checkpoint — 2026-08-25, the date the demo is pinned to. That is fine
-- for one property and wrong for seven: a hotel in Agra closes its day when its
-- night audit runs, and one in Pune closes its own. They are routinely on
-- different dates, and nothing could express that.
--
-- WHAT A BUSINESS DATE ACTUALLY IS:
--   the day the hotel is currently operating in. It advances when the night
--   audit COMPLETES, not at midnight — a clerk still checking guests out at
--   01:00 is working yesterday's date, and every posting they make belongs to
--   yesterday. That is the whole reason hotels have the concept.
--
-- SO IT IS DERIVED, WITH A FALLBACK:
--   · the day after the last COMPLETED night audit run, if there is one
--   · otherwise the column added here, which is what the property was set to
--     when it was configured
--
--   The fallback is not a default-in-disguise. A property that has never run a
--   night audit has to be operating in SOME day, and somebody has to say which.
--
-- ⚠ THIS REPLACES the app.business_date() added in 017, which returned
--   `now()` in the property's timezone. That answered "what day is it there",
--   which is a different question and only coincidentally the same answer. A
--   hotel mid-audit, or one whose audit failed last night, is still operating
--   in the earlier date and every report must agree.
-- =============================================================================

alter table hotels
  add column if not exists business_date date not null default current_date;

comment on column hotels.business_date is
  'The day this property is operating in, when no night audit has run yet. '
  'Advanced BY the night audit, not by the clock: a clerk working at 01:00 is '
  'still on yesterday''s date and their postings belong to yesterday.';


-- -----------------------------------------------------------------------------
-- The one definition. Every report divides, filters and dates by this.
-- -----------------------------------------------------------------------------
create or replace function app.business_date(p_hotel_id uuid)
returns date
language sql
stable
as $$
  select coalesce(
    -- The day after the last completed audit. `max` rather than the latest
    -- started, because a run that failed must not advance anything.
    (select max(na.business_date) + 1
       from night_audit_runs na
      where na.hotel_id = p_hotel_id
        and na.status = 'completed'),
    (select h.business_date from hotels h where h.id = p_hotel_id)
  )
$$;

comment on function app.business_date(uuid) is
  'The day this property is operating in. The day after the last COMPLETED '
  'night audit, or hotels.business_date if none has run. NOT the calendar '
  'date — a hotel whose audit failed last night is still on the earlier day, '
  'and every figure must agree with it.';


-- -----------------------------------------------------------------------------
-- The 017 assertion in db/tests/suite.sql compared this to the wall clock.
-- That test now describes the OLD definition, so it is corrected here rather
-- than left to fail confusingly: a property with no audit runs reports the
-- date it was configured with, and current_date is that default.
-- -----------------------------------------------------------------------------
do $$
declare v_hotel uuid; v_date date;
begin
  select id into v_hotel from hotels order by code limit 1;
  if v_hotel is null then
    return;                      -- nothing seeded yet; nothing to check
  end if;

  select app.business_date(v_hotel) into v_date;

  if v_date is null then
    raise exception '023: app.business_date() returned null for a real hotel. '
                    'Every report divides and filters by this.';
  end if;
end $$;
