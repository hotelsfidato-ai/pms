-- =============================================================================
-- 180 · The voucher goes both ways, each way counted on its own (D27-235, D27-241)
-- =============================================================================
-- Numbered for now; the master settles it at merge. Refer to it by what it
-- does - "the voucher both ways" - never by its number.
--
-- The owner, 2 October:
--   2.1  the booking confirmation goes on WhatsApp AND email (replaces D21-35's
--        one or the other): email carries the voucher PDF, WhatsApp the dates
--        and the link;
--   2.2  the PDF goes on WhatsApp too, by the CRS's already-approved voucher
--        template - a SECOND WhatsApp, kind 'booking-voucher', after the
--        confirmation (D27-241, Q1), recorded and owed on its own;
--   Q3   the day-before reminder stays one way: WhatsApp where the guest agreed
--        and there is a number, else email.
--
-- "What the guest is owed" (126, 131) counts sends per booking and kind. Its
-- return type cannot change on a replay (MEMORY 317), so this is a NEW
-- function with the same rules and one more column, `channel`, and every
-- try counted per (booking, kind, channel). The sweep and the desk's Send
-- voucher ask this one; the old one stays for nothing to break on a replay.
--
-- A booking nobody can reach is one row with no channel, as before - the
-- desk's list of bookings no message can reach (MSG-3) reads it.
-- =============================================================================

create or replace function app.guest_messages_owed(
  p_within_hours    integer,
  p_most_attempts   integer,
  p_remind_from     time,
  p_catch_up_from   time,
  p_catch_up_until  time,
  p_hotel           uuid default null
)
returns table (
  kind text, channel text, reservation_id uuid, reference text,
  hotel_id uuid, hotel_code text, hotel_name text, hotel_phone text,
  guest_name text, guest_phone text, guest_email text, whatsapp_agreed boolean,
  check_in text, check_out text, nights integer, held boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with future as (
    select r.group_id, coalesce(r.group_id, r.id) as party
      from reservations r
      join hotels h on h.id = r.hotel_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  -- A booking in no group leads itself; a group asks app.group_lead (D22-52).
  lead as (
    select f.party, coalesce(app.group_lead(f.group_id), f.party) as id
      from (select distinct group_id, party from future) f
  ),
  booking as (
    select l.party, r.id, r.reference, r.hotel_id, r.created_at, r.check_in, r.check_out,
           r.whatsapp_agreed, h.code, h.name as hotel_name, h.phone as hotel_phone,
           g.full_name, g.phone, g.email::text as email,
           now() at time zone h.timezone as here,
           -- Meta's rule (D21-72): WhatsApp only where the guest agreed.
           r.whatsapp_agreed and coalesce(btrim(g.phone), '') <> '' as by_whatsapp,
           coalesce(btrim(g.email::text), '') <> ''                   as by_email,
           coalesce(r.created_at < (select began_at from guest_messaging_began), true)
             as catch_up,
           p_within_hours is null
             or r.created_at > now() - make_interval(hours => p_within_hours) as recent
      from lead l
      join reservations r on r.id = l.id
      join hotels h on h.id = r.hotel_id
      join guests g on g.id = r.guest_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  tried as (
    select coalesce(x.group_id, x.id) as party, m.kind, m.channel,
           max(m.sent_at) filter (where m.status = 'sent') as sent_at,
           count(*) filter (where m.status = 'failed')     as failed
      from messages_sent m
      join reservations x on x.hotel_id = m.hotel_id and x.id::text = m.about_id
     where m.about_kind = 'reservation'
       and m.kind in ('booking-confirmation', 'booking-voucher', 'arrival-reminder')
       and coalesce(x.group_id, x.id) in (select party from booking)
     group by 1, 2, 3
  ),
  -- Every way a booking's confirmation goes; no way at all is one row, NULL.
  way as (
    select b.party, w.channel
      from booking b
      cross join lateral (
        select 'whatsapp'::text as channel where b.by_whatsapp
        union all select 'email' where b.by_email
        union all select null where not b.by_whatsapp and not b.by_email
      ) w
  ),
  confirm as (
    select w.party, w.channel,
           t.sent_at is null and coalesce(t.failed, 0) < p_most_attempts and b.recent as owed
      from way w
      join booking b on b.party = w.party
      left join tried t on t.party = w.party and t.kind = 'booking-confirmation'
                       and t.channel is not distinct from w.channel
  ),
  -- The reminder, one way (Q3), its tries counted across both ways as before;
  -- it waits while any confirmation is still owed, and a day after the last.
  remind as (
    select b.party,
           case when b.by_whatsapp then 'whatsapp' when b.by_email then 'email' end as channel,
           max(t.sent_at) filter (where t.kind = 'arrival-reminder') as reminded_at,
           coalesce(sum(t.failed) filter (where t.kind = 'arrival-reminder'), 0) as failed,
           max(t.sent_at) filter (where t.kind = 'booking-confirmation') as confirmed_at
      from booking b
      left join tried t on t.party = b.party
     group by b.party, b.by_whatsapp, b.by_email
  ),
  due as (
    select 'booking-confirmation' as kind, c.channel, b.*
      from confirm c join booking b on b.party = c.party
     where c.owed
    union all
    -- The CRS's voucher template with the PDF, on WhatsApp only (D27-241).
    select 'booking-voucher', 'whatsapp', b.*
      from booking b
      left join tried t on t.party = b.party and t.kind = 'booking-voucher' and t.channel = 'whatsapp'
     where b.by_whatsapp
       and t.sent_at is null
       and coalesce(t.failed, 0) < p_most_attempts
       and b.recent
    union all
    select 'arrival-reminder', r.channel, b.*
      from remind r join booking b on b.party = r.party
     where r.reminded_at is null
       and r.failed < p_most_attempts
       and b.check_in = b.here::date + 1
       and b.here::time >= p_remind_from
       and not exists (select 1 from confirm c where c.party = b.party and c.owed)
       and (r.confirmed_at is null or r.confirmed_at < now() - interval '24 hours')
  )
  select d.kind, d.channel, d.id, d.reference,
         d.hotel_id, d.code, d.hotel_name, d.hotel_phone,
         d.full_name, d.phone, d.email, d.whatsapp_agreed,
         d.check_in::text, d.check_out::text, (d.check_out - d.check_in)::int,
         -- A catch-up outside its hours waits for the morning (D22-42): the
         -- confirmation and its voucher alike.
         d.kind <> 'arrival-reminder' and d.catch_up
           and not (d.here::time >= p_catch_up_from and d.here::time < p_catch_up_until)
    from due d
   order by d.check_in, d.created_at, d.kind, d.channel nulls last
$fn$;

comment on function app.guest_messages_owed(integer, integer, time, time, time, uuid) is
  'What each confirmed booking is owed, per way (D27-235): its confirmation on '
  'WhatsApp and by email, the CRS voucher with the PDF on WhatsApp (D27-241), '
  'and the day-before reminder one way. One per group, to its lead '
  '(app.group_lead). Every try counted per booking, kind and way. channel NULL: '
  'nowhere to send. held = a catch-up outside its hours (D22-42).';

revoke all on function app.guest_messages_owed(integer, integer, time, time, time, uuid) from public;
grant execute on function app.guest_messages_owed(integer, integer, time, time, time, uuid) to pms_app;
