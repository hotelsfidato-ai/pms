-- =============================================================================
-- 161 · Leads and WhatsApp, read live from the leads app (D27-100, D27-168, D27-170)
-- =============================================================================
-- The market-to-revenue app keeps running and staff keep replying there
-- (D27-100). The PMS shows its leads and conversations by READING THEM LIVE,
-- every time a screen opens (D27-170): NO COPY of a lead or a message is kept
-- here, so a guest erased in the app is gone from the PMS the next time
-- anybody looks (D27-108). This migration therefore has no lead table at all.
-- It has three things:
--
--   1. reservations.campaign  a booking made from a lead keeps its campaign,
--                             so revenue per campaign comes from real stays
--   2. four booking sources   a lead's booking takes a source by its channel
--                             (D27-170): Meta Ads, Google Ads, WhatsApp, Website
--   3. 'firestore_read'       every read of the app, counted on System health,
--                             and the daily cap counted from it
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The campaign on a booking
-- -----------------------------------------------------------------------------
-- The leads app's own key for the campaign (its campaignKey: the platform and
-- the campaign's id, e.g. meta_120211234567890), the same key its ad spend is
-- filed under. NULL for every booking that did not come from a lead with a
-- known campaign; nothing is guessed (the app's FR-091: unattributed stays
-- unattributed). Not personal data: it names an advertisement, not a guest.
alter table reservations add column if not exists campaign text;

alter table reservations drop constraint if exists reservations_campaign_sane;
alter table reservations add constraint reservations_campaign_sane
  check (campaign is null or (length(campaign) between 1 and 200 and campaign = btrim(campaign)));

comment on column reservations.campaign is
  'The leads app''s campaign key for a booking made from a lead (D27-170), the '
  'key its spend is filed under. NULL when there is none; never guessed.';

create index if not exists reservations_campaign_idx
  on reservations (hotel_id, campaign) where campaign is not null;


-- -----------------------------------------------------------------------------
-- 2 · The four sources a lead's booking takes (D27-170)
-- -----------------------------------------------------------------------------
-- Direct bookings: no booking site stands between the guest and the hotel,
-- so no commission row is made. `on conflict do nothing`: a property that
-- already has one by that name (any capitals) keeps its own.
insert into booking_sources (name, kind, channel_code) values
  ('Meta Ads',   'direct', null),
  ('Google Ads', 'direct', null),
  ('WhatsApp',   'direct', null),
  ('Website',    'direct', null)
on conflict do nothing;


-- -----------------------------------------------------------------------------
-- 3 · The reads, on System health (D27-91)
-- -----------------------------------------------------------------------------
-- A third kind of telemetry event, one row a minute. No guest data: `place` is
-- 'leads', `what` is which read (leads, conversation, booking, marketing).
-- The app is on the free plan, 50,000 reads a day SHARED with the live app;
-- the owner's cap (5,000, D27-170) is counted from here, from midnight
-- Pacific, when Google resets the plan.
alter table telemetry_events drop constraint if exists telemetry_events_kind;
alter table telemetry_events add constraint telemetry_events_kind
  check (kind in ('error', 'slow_query', 'firestore_read'));

create or replace function app.leads_reads_today()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(count), 0)::bigint from telemetry_events
   where kind = 'firestore_read'
     and minute >= (date_trunc('day', now() at time zone 'America/Los_Angeles')
                    at time zone 'America/Los_Angeles')
$$;

comment on function app.leads_reads_today() is
  'Reads of the leads app since midnight Pacific, when Google resets the free '
  'plan (161, D27-170). SECURITY DEFINER because telemetry_events answers only '
  'the owner and administrators, and every screen that reads the app asks this '
  'first.';

revoke all on function app.leads_reads_today() from public;
grant execute on function app.leads_reads_today() to pms_app;
