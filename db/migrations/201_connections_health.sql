-- =============================================================================
-- 201 · Connection health: what the database knows about each outside link
-- =============================================================================
-- The owner's D27-276, point 3 (4 October): one page for n8n, Meta, the CRS,
-- Firebase, the backups and rivals' prices - green, amber, red or grey, with
-- the last success and the last error - and an email to the owner when one
-- turns red (api/src/modules/connections-health).
--
-- NO NEW TABLE. Every fact is one the system already keeps:
--   messages_sent          each email and WhatsApp handed to n8n, and its
--                          answer (117); the health alerts themselves, kind
--                          'health-alert', about the connection by name
--   crs_hotels/_bookings   the CRS reader's last read, its last error, the
--                          last booking it took (160)
--   market_rate_settings   the rivals' check: switched on, its last day, and
--   market_rates           the prices it kept (196)
--
-- ONE DEFINER, because the alert sweep has nobody signed in and every one of
-- those tables is FORCE row-secured. The page calls the same function for
-- the one hotel the person is standing in, after the route has checked they
-- work there - the page and the email cannot disagree about a fact.
--
-- Re-runnable; creates no table and no row.
-- =============================================================================

create or replace function app.connection_facts(p_hotel uuid)
returns table (hotel_id uuid, code text, name text, timezone text, facts jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select h.id, h.code, h.name, h.timezone,
    jsonb_build_object(
      -- Each way a message goes: the last that went, the last that did not
      -- (with what the receiver said), and the last three answers, newest first.
      'email',    m.facts -> 'email',
      'whatsapp', m.facts -> 'whatsapp',
      -- Null: this hotel is not connected to the CRS.
      'crs', (select jsonb_build_object(
                       'connectedAt', ch.connected_at,
                       'lastRead',    ch.last_read_at,
                       'lastError',   ch.last_error,
                       'lastBooking', (select max(b.read_at) from crs_bookings b where b.hotel_id = h.id))
                from crs_hotels ch where ch.hotel_id = h.id and ch.is_on),
      -- Null: rivals' prices switched off here (no row is off).
      'rivals', (select jsonb_build_object(
                          'lastRunOn',    s.last_run_on,
                          'lastKept',     (select max(r.fetched_at) from market_rates r where r.hotel_id = h.id),
                          'keptSinceRun', exists (select 1 from market_rates r
                                                   where r.hotel_id = h.id
                                                     and app.hotel_day(h.id, r.fetched_at) >= s.last_run_on))
                   from market_rate_settings s where s.hotel_id = h.id and s.is_on),
      -- When the owner was last emailed about each connection, from here.
      'alerted', coalesce((select jsonb_object_agg(a.about_id, a.at)
                             from (select ms.about_id, max(ms.sent_at) as at
                                     from messages_sent ms
                                    where ms.hotel_id = h.id and ms.kind = 'health-alert'
                                      and ms.about_kind = 'connection'
                                    group by ms.about_id) a), '{}'::jsonb))
    from hotels h
    cross join lateral (
      select jsonb_object_agg(w.channel, jsonb_build_object(
               'lastSent',   (select max(ms.sent_at) from messages_sent ms
                               where ms.hotel_id = h.id and ms.channel = w.channel and ms.status = 'sent'),
               'lastFailed', (select jsonb_build_object('at', ms.sent_at, 'detail', ms.detail)
                                from messages_sent ms
                               where ms.hotel_id = h.id and ms.channel = w.channel and ms.status = 'failed'
                               order by ms.sent_at desc, ms.id desc limit 1),
               'recent',     coalesce((select jsonb_agg(r.status order by r.sent_at desc, r.id desc)
                                         from (select ms.status, ms.sent_at, ms.id from messages_sent ms
                                                where ms.hotel_id = h.id and ms.channel = w.channel
                                                order by ms.sent_at desc, ms.id desc limit 3) r), '[]'::jsonb)
             )) as facts
        from (values ('email'), ('whatsapp')) w(channel)
    ) m
   where case when p_hotel is null then h.is_active else h.id = p_hotel end
   order by h.code
$fn$;

comment on function app.connection_facts(uuid) is
  'Connection health (D27-276): per hotel - or every active hotel, given null - '
  'the last email and WhatsApp sent and failed and the last three answers, the '
  'CRS reader''s last read and error, the rivals'' check, and when the owner was '
  'last emailed about each connection. Reads no guest''s name, number or address.';

revoke all on function app.connection_facts(uuid) from public;
grant execute on function app.connection_facts(uuid) to pms_app;
