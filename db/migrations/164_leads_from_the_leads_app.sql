-- =============================================================================
-- 164 · Leads and WhatsApp, read from the leads app (D27-100, D27-108, D27-168)
-- =============================================================================
-- The market-to-revenue app keeps running and staff keep replying there
-- (D27-100). The PMS SHOWS its leads and their conversations, read-only, with
-- the read-only Google login the owner creates (D27-103). This is the PMS's
-- copy of what it read, kept so a restart never reads it all again: the app is
-- on the free plan, 50,000 reads a day SHARED with the live app, and every
-- read is counted (api/src/modules/leads/sync.ts).
--
-- ⚠ PERSONAL DATA. A lead is a guest's name, number and words, so:
--   - only the hotels named in M2R_HOTELS are kept; any other hotel's lead is
--     read, dropped and never written here;
--   - a lead erased in the app (D27-108), or cleared by its yearly clear-out,
--     is deleted here with its messages when the sync finds it gone; its
--     stays and bills are untouched (tax law), and nothing else refers to it;
--   - `remote_id` is the app's own id and CONTAINS THE GUEST'S NUMBER: it is
--     used to read the app and nowhere else - never in a PMS address, which
--     carries `id`;
--   - staff's internal notes are not copied, only the guest's messages and
--     the replies.
--
-- READ by whoever may see guests (the role gate: `customer` view), at their
-- own hotel (the policies). WRITTEN only by the sync, which has nobody signed
-- in, through app.leads_apply(): pms_app may not insert, change or delete a
-- row itself.
-- =============================================================================

create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  remote_id       text not null unique,
  name            text,
  phone           text,
  status          text not null,
  category        text,
  -- The app's own bucket (leads/model.js sourceOf): whatsapp_ad,
  -- whatsapp_unknown, or how a hand-added lead came (phone, walk_in, ...).
  source          text,
  -- As the lead arrived with it; a WhatsApp ad's is the ad's id.
  campaign_id     text,
  booking_ref     text,
  booking_value   numeric(12, 2),
  do_not_contact  boolean not null default false,
  received_at     timestamptz,
  last_message_at timestamptz,
  last_message    text,
  -- The app's updatedAt: when it last changed there.
  changed_at      timestamptz not null,
  -- The time of the last message read: the next read of this lead starts
  -- there (inclusive; one already held is skipped).
  read_to         timestamptz
);

create index if not exists leads_by_hotel on leads (hotel_id, last_message_at desc);

create table if not exists lead_messages (
  lead_id    uuid not null references leads(id) on delete cascade,
  hotel_id   uuid not null references hotels(id) on delete cascade,
  remote_id  text not null,
  direction  text not null check (direction in ('in', 'out')),
  kind       text not null,
  body       text not null default '',
  at         timestamptz not null,
  primary key (lead_id, remote_id)
);

-- Where the sync got to: the app's updatedAt of the last lead read, never
-- a lead's id (it holds the guest's number). One row for the whole group.
create table if not exists leads_sync (
  one        boolean primary key default true check (one),
  cursor_at  timestamptz,
  last_run   timestamptz,
  last_error text
);

alter table leads enable row level security;
alter table leads force row level security;
alter table lead_messages enable row level security;
alter table lead_messages force row level security;
alter table leads_sync enable row level security;
alter table leads_sync force row level security;

drop policy if exists leads_by_hotel on leads;
create policy leads_by_hotel on leads
  for select using (hotel_id in (select app.auth_hotel_ids()));
drop policy if exists lead_messages_by_hotel on lead_messages;
create policy lead_messages_by_hotel on lead_messages
  for select using (hotel_id in (select app.auth_hotel_ids()));
-- leads_sync: no policy, so nobody reads it but the definers below.

-- ⚠ 010's default privileges give pms_app all four on every new table.
revoke all on leads, lead_messages, leads_sync from public, pms_app;
grant select on leads, lead_messages to pms_app;

comment on table leads is
  'The leads app''s leads for the hotels in M2R_HOTELS, as last read (D27-100). '
  'Personal data: deleted when the app no longer has it (D27-108). Written only '
  'by app.leads_apply().';
comment on table lead_messages is
  'The guest''s messages and the replies of each lead, as read from the leads '
  'app. No staff notes. Deleted with the lead.';


-- -----------------------------------------------------------------------------
-- The sync's one way in. Nobody is signed in when it runs, and leads is FORCE
-- row-secured, so it writes through here: the leads it read (upserted by the
-- app's id), their new messages, the leads that are gone, and where it got to.
--   p = { cursor: timestamp | null,
--         leads:    [{remote_id, hotel_code, name, phone, status, category,
--                     source, campaign_id, booking_ref, booking_value,
--                     do_not_contact, received_at, last_message_at,
--                     last_message, changed_at}],
--         messages: [{lead, remote_id, direction, kind, body, at}],
--         read_to:  [{lead, at}],
--         gone:     [remote_id] }
-- A lead whose hotel code is not a hotel here is not written.
-- -----------------------------------------------------------------------------
create or replace function app.leads_apply(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from leads where remote_id in (select jsonb_array_elements_text(coalesce(p->'gone', '[]')));

  insert into leads as l (hotel_id, remote_id, name, phone, status, category, source, campaign_id,
                          booking_ref, booking_value, do_not_contact, received_at,
                          last_message_at, last_message, changed_at)
  select h.id, x.remote_id, x.name, x.phone, x.status, x.category, x.source, x.campaign_id,
         x.booking_ref, x.booking_value, coalesce(x.do_not_contact, false), x.received_at,
         x.last_message_at, x.last_message, x.changed_at
    from jsonb_to_recordset(coalesce(p->'leads', '[]')) as x(
           remote_id text, hotel_code text, name text, phone text, status text, category text,
           source text, campaign_id text, booking_ref text, booking_value numeric,
           do_not_contact boolean, received_at timestamptz, last_message_at timestamptz,
           last_message text, changed_at timestamptz)
    join hotels h on h.code = x.hotel_code
  on conflict (remote_id) do update
     set hotel_id = excluded.hotel_id, name = excluded.name, phone = excluded.phone,
         status = excluded.status, category = excluded.category, source = excluded.source,
         campaign_id = excluded.campaign_id, booking_ref = excluded.booking_ref,
         booking_value = excluded.booking_value, do_not_contact = excluded.do_not_contact,
         received_at = excluded.received_at, last_message_at = excluded.last_message_at,
         last_message = excluded.last_message, changed_at = excluded.changed_at;

  -- A lead moved to another hotel takes its messages with it.
  update lead_messages m set hotel_id = l.hotel_id
    from leads l where l.id = m.lead_id and m.hotel_id <> l.hotel_id;

  insert into lead_messages (lead_id, hotel_id, remote_id, direction, kind, body, at)
  select l.id, l.hotel_id, x.remote_id, x.direction, x.kind, coalesce(x.body, ''), x.at
    from jsonb_to_recordset(coalesce(p->'messages', '[]')) as x(
           lead text, remote_id text, direction text, kind text, body text, at timestamptz)
    join leads l on l.remote_id = x.lead
  on conflict (lead_id, remote_id) do nothing;

  update leads l set read_to = x.at
    from jsonb_to_recordset(coalesce(p->'read_to', '[]')) as x(lead text, at timestamptz)
   where l.remote_id = x.lead;

  insert into leads_sync (one, cursor_at, last_run)
  values (true, (p->>'cursor')::timestamptz, now())
  on conflict (one) do update
     set cursor_at = coalesce(excluded.cursor_at, leads_sync.cursor_at),
         last_run  = now(), last_error = null;
end $$;

comment on function app.leads_apply(jsonb) is
  'The leads sync''s only write (164): leads read from the leads app, their new '
  'messages, the ones gone from it (D27-108) and the cursor. SECURITY DEFINER '
  'because the sync has nobody signed in and leads is FORCE row-secured.';

revoke all on function app.leads_apply(jsonb) from public;
grant execute on function app.leads_apply(jsonb) to pms_app;


-- What the sync needs to know, for a caller with nobody signed in: where it
-- got to, and what it already holds of each lead, by the app's id.
-- The screen asks the same, for when it last read and whether that failed.
create or replace function app.leads_sync_state()
returns table (cursor_at timestamptz, last_run timestamptz, last_error text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cursor_at, last_run, last_error from leads_sync
$$;

create or replace function app.leads_known(p_remote text[])
returns table (remote_id text, changed_at timestamptz, read_to timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select remote_id, changed_at, read_to from leads where remote_id = any(p_remote)
$$;

-- The erasure check: the app's ids this PMS holds for one hotel, and whether
-- each has a last message (the app's count sees only those).
create or replace function app.leads_held(p_hotel_code text)
returns table (remote_id text, counted boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.remote_id, l.last_message_at is not null
    from leads l join hotels h on h.id = l.hotel_id where h.code = p_hotel_code
$$;

-- A run that failed says so on the screen, by its kind only.
create or replace function app.leads_sync_failed(p_kind text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into leads_sync (one, last_run, last_error) values (true, now(), p_kind)
  on conflict (one) do update set last_run = now(), last_error = excluded.last_error
$$;

revoke all on function app.leads_sync_state(), app.leads_known(text[]),
                       app.leads_held(text), app.leads_sync_failed(text) from public;
grant execute on function app.leads_sync_state(), app.leads_known(text[]),
                          app.leads_held(text), app.leads_sync_failed(text) to pms_app;


-- -----------------------------------------------------------------------------
-- The reads, on System health (D27-91): a third kind of telemetry event,
-- 'firestore_read', one row a minute. No guest data in it: `place` is 'leads',
-- `what` is which read (leads, messages, erasure check). The daily cap is
-- counted from here, from midnight Pacific, when Google resets the free plan.
-- -----------------------------------------------------------------------------
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
  'plan''s 50,000 (164). SECURITY DEFINER because the sync has nobody signed in '
  'and telemetry_events answers only the owner and administrators.';

revoke all on function app.leads_reads_today() from public;
grant execute on function app.leads_reads_today() to pms_app;
