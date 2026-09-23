-- =============================================================================
-- 125 · What the guest is owed, and their booking's own link
-- =============================================================================
-- Written as the next free number in the guest-messaging copy; the master
-- settles the number at merge (MEMORY 301, 302). Refer to this file by what it
-- does - "what the guest is owed" - never by its number.
--
-- The owner's D18-11 and D18-12: a booking confirmed from anywhere gets its
-- confirmation with the guest's own link, and the link again the day before
-- arrival. The sweep that sends them (api/src/modules/guest-messaging/jobs.ts)
-- runs with NOBODY SIGNED IN - it is three in the morning - and `reservations`,
-- `guests`, `messages_sent` and `guest_links` are all FORCE row-secured on
-- `app.auth_hotel_ids()`, which answers for a signed-in person. So the sweep
-- has exactly two ways in, both here, both SECURITY DEFINER, the shape
-- migration 117 gave `app.record_message_sent` for the same reason:
--
--   app.guest_messages_due         which bookings are owed which message
--   app.guest_booking_link_issue   mint ONE booking's own page (114's family)
--
-- and one record, written once: the moment sending was first switched on
-- (`guest_messaging_began`, through `app.guest_messages_begin`).
--
-- The owner's answers these carry:
--   · D21-33  every future booking is owed its confirmation, whenever it was
--             made - the window is a parameter, and the sweep passes none
--   · D21-34  soonest arrival first
--   · D21-35, D21-72  which WAY it goes is decided in jobs.ts (`channelFor`),
--             so this answers the tick (`whatsapp_agreed`, one guest one
--             record) and the addresses, and decides nothing about them
--   · D22-39, D22-40  the reminder at 10:00 on the hotel's clock (passed in),
--             and never within a day of the confirmation
--   · D22-41  ONE confirmation and one reminder per group, to its lead guest
--   · D22-42  a catch-up confirmation - for a booking made before sending was
--             switched on - only between 09:00 and 21:00 on the hotel's clock
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · When a booking's link dies
-- -----------------------------------------------------------------------------
-- 11:00 on the property's own clock the morning after check-out - a page that
-- outlives the stay is a bill left on a table (D18-9) - and never less than a
-- day from now, or a link made on the departure morning is dead before the
-- guest reaches the lift. The rule the desk's route in api/src/routes/guestDoor.ts
-- writes inline; it lives here so that route can call it too, and the rule is
-- then written once.
create or replace function app.guest_link_expires(p_hotel uuid, p_check_out date)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $fn$
  select greatest(app.hotel_moment(p_hotel, (p_check_out + 1)::text || 'T11:00'),
                  now() + interval '24 hours')
$fn$;

comment on function app.guest_link_expires(uuid, date) is
  'When a booking''s own link dies: 11:00 the morning after check-out on the '
  'property''s clock, never less than 24 hours from now (D18-9).';


-- -----------------------------------------------------------------------------
-- 2 · The moment sending was first switched on (D22-42), recorded once
-- -----------------------------------------------------------------------------
-- "Made before switch-on" has to mean one fixed moment, or the catch-up hours
-- would slide: a booking made at 23:00 on switch-on day must not become a
-- "new" one because somebody restarted the API. So the sweep records the
-- moment on its FIRST pass that finds sending switched on (n8n's settings and
-- the owner's pace, jobs.ts), and nothing can move it afterwards:
--
--   · one row, ever - the primary key is a boolean that can only be true
--   · written only by `app.guest_messages_begin`, which inserts and never
--     updates; the application's role holds no privilege on the table at all
--     (010's default privileges would have given it every one - revoked here)
--   · closed to row-level reads too: force-secured with no policy
--
-- Nothing recorded means sending has never been switched on - so every booking
-- that exists was made before it.
create table if not exists guest_messaging_began (
  only_one  boolean primary key default true,
  began_at  timestamptz not null default now(),
  constraint guest_messaging_began_once check (only_one)
);

comment on table guest_messaging_began is
  'The moment the guest-messages sweep first found sending switched on '
  '(D22-42): one row, written once by app.guest_messages_begin. A booking made '
  'before it is a catch-up, confirmed only between 09:00 and 21:00.';

alter table guest_messaging_began enable row level security;
alter table guest_messaging_began force  row level security;
revoke all on guest_messaging_began from public, pms_app, pms_readonly;

-- The first switched-on pass records it; every pass after answers the same.
create or replace function app.guest_messages_begin()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into guest_messaging_began (only_one) values (true)
  on conflict (only_one) do nothing;
  return (select began_at from guest_messaging_began);
end
$fn$;

comment on function app.guest_messages_begin() is
  'Records the moment sending was first switched on, once, and answers it '
  '(D22-42). Called by the sweep, never by a screen.';


-- -----------------------------------------------------------------------------
-- 3 · Which bookings are owed which message
-- -----------------------------------------------------------------------------
-- A CONFIRMED booking arriving today or later on the property's own clock (a
-- tentative one is not confirmed; a walk-in is checked in the moment it is
-- made, so it is never owed a confirmation).
--
-- ONE PER GROUP (D22-41). Several rooms booked together share a group, and the
-- group - not each room - is owed one confirmation and one reminder, sent
-- about its LEAD booking: the group's room booked first that still stands
-- (not cancelled, voided or a no-show), to that booking's guest and by that
-- booking's WhatsApp tick. `reservation_groups` names no lead guest, and every
-- room of a booking made together carries the one guest who made it
-- (reservations/book.ts), so the room booked first IS that guest's. The other
-- rooms are covered: a message sent about any room of the group counts for
-- all of them, so none is ever owed on its own - not even when the lead is
-- cancelled after the confirmation went. A booking in no group is its own
-- party, exactly as before. (`coalesce(group_id, id)`: the same "several rooms
-- once" key as app.guest_visits in one guest, one record.)
--
--   booking-confirmation   none has been sent to the party, fewer than
--                          p_most_attempts have failed, and - only when a
--                          window is passed - the lead was made within
--                          p_within_hours. NULL: every future booking (D21-33).
--   arrival-reminder       the day before the lead's arrival on the property's
--                          clock, from p_remind_from on that clock (D22-39),
--                          none sent, fewer than p_most_attempts failed - and
--                          NOT while its confirmation is still owed or went
--                          out in the last day (D22-40): the confirmation
--                          carries the same link.
--
-- HELD (D22-42): a confirmation owed to a booking made BEFORE sending was
-- switched on (section 2) is answered with held = true outside p_catch_up_from
-- to p_catch_up_until on the property's clock. It is still OWED - the desk's
-- list of bookings no message can reach reads this same answer, and must not
-- change with the hour - but the sweep sends it only in the day. A booking made
-- after switch-on is never held: it is confirmed at once, at any hour.
--
-- "Sent" and "failed" are read from `messages_sent`, which the one door out
-- (api/src/sending.ts) writes for every attempt. `about_id` is text and not
-- always a booking, so it is compared as text and never cast (MSG-1). A
-- booking with nowhere to send is never attempted, so it stays owed: jobs.ts
-- counts those, and the desk's screen lists them (MSG-3), from THIS answer.
--
-- TEXT dates, not date: a `date` reaches node as a Date at midnight in the
-- server's zone, which is how the 29th becomes the 28th (migration 113).
--
-- p_hotel: one property (the desk's screen); NULL for every one (the sweep).
--
-- Its return type changed before it was ever merged, so the file drops it
-- first, by both signatures it has had, and makes it again every run (MEMORY
-- 317: never reshape a function another migration makes; this one is ours).
drop function if exists app.guest_messages_due(integer, integer, time, uuid);
drop function if exists app.guest_messages_due(integer, integer, time, time, time, uuid);
create function app.guest_messages_due(
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
    select coalesce(r.group_id, r.id) as party
      from reservations r
      join hotels h on h.id = r.hotel_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  -- ponytail: an expression over every reservation, once a minute; fine for
  -- seven hotels' bookings, an index on coalesce(group_id, id) if it is not.
  lead as (
    select distinct on (coalesce(r.group_id, r.id))
           coalesce(r.group_id, r.id) as party, r.id
      from reservations r
     where coalesce(r.group_id, r.id) in (select party from future)
       and r.status not in ('cancelled', 'void', 'no_show')
     order by coalesce(r.group_id, r.id), r.created_at, r.reference
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
           -- Made before switch-on: before the moment recorded, or nothing
           -- recorded yet (sending has never been on).
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
   -- Soonest arrival first (D21-34): on switch-on day every future booking is
   -- owed at once, and the guest arriving tomorrow is the one who needs it.
   order by d.check_in, d.created_at, d.kind
$fn$;

comment on function app.guest_messages_due(integer, integer, time, time, time, uuid) is
  'Which confirmed bookings are owed their confirmation or their day-before '
  'reminder, one per group to its lead booking (D22-41), soonest arrival first; '
  'held = a catch-up confirmation outside its hours (D22-42). SECURITY DEFINER '
  'because the sweep has no staff session. Decides nothing about the channel.';


-- -----------------------------------------------------------------------------
-- 4 · A booking's own link, for the message that carries it
-- -----------------------------------------------------------------------------
-- A BOOKING'S link - not a room's fixed card (D21-7, migration 121): it names
-- exactly one reservation, and origin says the confirmation made it. The shape
-- of 114's functions, kept:
--
--   · THE TOKEN NEVER REACHES THE DATABASE. The API makes it, hashes it, and
--     passes the hash; the token itself lives for one message and then only
--     in the guest's hands. A hash that is not sha256-shaped is refused, so a
--     token passed by mistake is not stored as if it were one.
--   · ONLY A CONFIRMED BOOKING. The sweep asks for no other, and a function
--     anybody connected as pms_app may call gives no more than the sweep needs:
--     no link for a cancelled, voided, finished or merely tentative booking.
--   · NOBODY MADE IT. created_by stays null, as `sent_by` does on the message.
--
-- Answers whether a link was made; false has written nothing.
create or replace function app.guest_booking_link_issue(p_reservation uuid, p_token_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into guest_links (hotel_id, reservation_id, token_hash, origin, expires_at)
  select r.hotel_id, r.id, p_token_hash, 'confirmation',
         app.guest_link_expires(r.hotel_id, r.check_out)
    from reservations r
   where r.id = p_reservation
     and r.status = 'confirmed';

  return found;
end
$fn$;

comment on function app.guest_booking_link_issue(uuid, text) is
  'Mints one CONFIRMED booking''s own page for the message that carries it, '
  'from the hash of a token the API made. Never a room card (D21-7).';


-- -----------------------------------------------------------------------------
-- Who may call what: the API's role, and nobody else
-- -----------------------------------------------------------------------------
revoke all on function app.guest_messages_due(integer, integer, time, time, time, uuid) from public;
revoke all on function app.guest_booking_link_issue(uuid, text)                           from public;
revoke all on function app.guest_messages_begin()                                         from public;
grant execute on function app.guest_messages_due(integer, integer, time, time, time, uuid) to pms_app;
grant execute on function app.guest_booking_link_issue(uuid, text)                           to pms_app;
grant execute on function app.guest_messages_begin()                                         to pms_app;
grant execute on function app.guest_link_expires(uuid, date)                                 to pms_app;
