-- =============================================================================
-- 131 · A group's lead guest, decided once
-- =============================================================================
-- Written as the next free number in this copy; the master settles it at merge
-- (MEMORY 301, 302). Refer to this file by what it does - "a group's lead" -
-- never by its number.
--
-- The owner, 23 September:
--   · D22-52  a group's lead guest is, by default, the room booked first that
--             still stands; the desk can also assign the lead. The group's one
--             confirmation (D22-41) goes to the lead.
--   · D22-10  a group is asked for a review once, at the lead guest's room.
--
-- Until now the lead was worked out inline, in "what the guest is owed"
-- (app.guest_messages_due). Two services need it now, and the desk can move
-- it, so it is ONE function every caller asks: the sweep, the desk's group
-- screen and the review request. A rule in two places is wrong in one of them
-- (086).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The lead the desk assigned, if any
-- -----------------------------------------------------------------------------
-- NULL means nobody assigned one: the default below decides. A reservation is
-- never deleted in practice, but a test fixture may be, so the lead lets go
-- rather than blocking it. Whether the room is in THIS group is the route's
-- check (api/src/modules/reservations/groups.ts) - and app.group_lead ignores
-- a lead that is not, so a stray value can never make another group's room
-- lead this one.
alter table reservation_groups
  add column if not exists lead_reservation_id uuid
      references reservations(id) on delete set null;

comment on column reservation_groups.lead_reservation_id is
  'The room the desk assigned as the group''s lead (D22-52). NULL: the room '
  'booked first that still stands. Read through app.group_lead, never directly.';


-- -----------------------------------------------------------------------------
-- 2 · Who leads a group
-- -----------------------------------------------------------------------------
-- Among the group's rooms that still stand (not cancelled, voided or a
-- no-show - as "what the guest is owed" had it): the one the desk assigned,
-- else the one booked first. An assigned lead that is later cancelled stops
-- leading, and the default takes over.
--
-- SECURITY DEFINER so every caller gets the SAME answer: the sweep runs with
-- nobody signed in, and a clerk at one property cannot see a group's rooms at
-- another - without it, a group spanning two properties would have a lead per
-- clerk. It answers one id and nothing else.
--
-- NULL for no group, or a group with no room standing.
create or replace function app.group_lead(p_group uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select r.id
    from reservations r
    join reservation_groups g on g.id = r.group_id
   where r.group_id = p_group
     and r.status not in ('cancelled', 'void', 'no_show')
   order by (r.id = g.lead_reservation_id) is true desc, r.created_at, r.reference
   limit 1
$fn$;

comment on function app.group_lead(uuid) is
  'A group''s lead room (D22-52): the one the desk assigned if it still '
  'stands, else the room booked first that still stands. The one answer for '
  'the group''s confirmation (D22-41) and its review request (D22-10).';

revoke all on function app.group_lead(uuid) from public;
grant execute on function app.group_lead(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 3 · What the guest is owed - its lead now asked of app.group_lead
-- -----------------------------------------------------------------------------
-- The same signature and return type as "what the guest is owed" makes, so
-- CREATE OR REPLACE is enough and a replay replaces it with itself (MEMORY
-- 317). The ONLY change is the `lead` step; every other line is as it was, and
-- that migration's comments explain them.
create or replace function app.guest_messages_due(
  p_within_hours    integer,
  p_most_attempts   integer,
  p_remind_from     time,
  p_catch_up_from   time,
  p_catch_up_until  time,
  p_hotel           uuid default null
)
returns table (
  kind text, reservation_id uuid, reference text,
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
           now() at time zone h.timezone as here
      from lead l
      join reservations r on r.id = l.id
      join hotels h on h.id = r.hotel_id
      join guests g on g.id = r.guest_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  tried as (
    select coalesce(x.group_id, x.id) as party, m.kind,
           max(m.sent_at) filter (where m.status = 'sent') as sent_at,
           count(*) filter (where m.status = 'failed')     as failed
      from messages_sent m
      join reservations x on x.hotel_id = m.hotel_id and x.id::text = m.about_id
     where m.about_kind = 'reservation'
       and m.kind in ('booking-confirmation', 'arrival-reminder')
       and coalesce(x.group_id, x.id) in (select party from booking)
     group by 1, 2
  ),
  owed as (
    select b.*,
           c.sent_at as confirmed_at,
           x.sent_at as reminded_at, coalesce(x.failed, 0) as remind_failed,
           c.sent_at is null
             and coalesce(c.failed, 0) < p_most_attempts
             and (p_within_hours is null
                  or b.created_at > now() - make_interval(hours => p_within_hours))
             as confirm_owed,
           coalesce(b.created_at < (select began_at from guest_messaging_began), true)
             as catch_up
      from booking b
      left join tried c on c.party = b.party and c.kind = 'booking-confirmation'
      left join tried x on x.party = b.party and x.kind = 'arrival-reminder'
  ),
  due as (
    select 'booking-confirmation' as kind, o.*,
           o.catch_up
             and not (o.here::time >= p_catch_up_from and o.here::time < p_catch_up_until)
             as held
      from owed o where o.confirm_owed
    union all
    select 'arrival-reminder', o.*, false from owed o
     where o.reminded_at is null
       and o.remind_failed < p_most_attempts
       and o.check_in = o.here::date + 1
       and o.here::time >= p_remind_from
       and not o.confirm_owed
       and (o.confirmed_at is null or o.confirmed_at < now() - interval '24 hours')
  )
  select d.kind, d.id, d.reference,
         d.hotel_id, d.code, d.hotel_name, d.hotel_phone,
         d.full_name, d.phone, d.email, d.whatsapp_agreed,
         d.check_in::text, d.check_out::text, (d.check_out - d.check_in)::int,
         d.held
    from due d
   order by d.check_in, d.created_at, d.kind
$fn$;

comment on function app.guest_messages_due(integer, integer, time, time, time, uuid) is
  'Which confirmed bookings are owed their confirmation or their day-before '
  'reminder, one per group to its lead booking (app.group_lead, D22-41, '
  'D22-52), soonest arrival first; held = a catch-up confirmation outside its '
  'hours (D22-42). SECURITY DEFINER because the sweep has no staff session. '
  'Decides nothing about the channel.';
