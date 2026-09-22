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
-- The owner's answers these carry (21 September):
--   · D21-33  every future booking is owed its confirmation, whenever it was
--             made - the window is a parameter, and the sweep passes none
--   · D21-34  soonest arrival first
--   · D21-35, D21-72  which WAY it goes is decided in jobs.ts (`channelFor`),
--             so this answers the tick (`whatsapp_agreed`, one guest one
--             record) and the addresses, and decides nothing about them
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
-- 2 · Which bookings are owed which message
-- -----------------------------------------------------------------------------
-- A CONFIRMED booking arriving today or later on the property's own clock (a
-- tentative one is not confirmed; a walk-in is checked in the moment it is
-- made, so it is never owed a confirmation).
--
--   booking-confirmation   none has been sent, fewer than p_most_attempts have
--                          failed, and - only when a window is passed - the
--                          booking was made within p_within_hours. NULL: every
--                          future booking (D21-33).
--   arrival-reminder       the day before arrival on the property's clock, from
--                          p_remind_from on that clock (nobody wants a guest's
--                          phone to ring at one minute past midnight), none
--                          sent, fewer than p_most_attempts failed - and NOT
--                          while its confirmation is still owed or went out in
--                          the last day. The confirmation carries the same link,
--                          so a booking made the day before arrival gets one
--                          message, not two a minute apart.
--
-- "Sent" and "failed" are read from `messages_sent`, which the one door out
-- (api/src/sending.ts) writes for every attempt. A booking with nowhere to send
-- is never attempted, so it stays owed: jobs.ts counts those, and the desk's
-- screen lists them (MSG-3), from THIS answer - one rule for both.
--
-- TEXT dates, not date: a `date` reaches node as a Date at midnight in the
-- server's zone, which is how the 29th becomes the 28th (migration 113).
--
-- p_hotel: one property (the desk's screen); NULL for every one (the sweep).
create or replace function app.guest_messages_due(
  p_within_hours  integer,
  p_most_attempts integer,
  p_remind_from   time,
  p_hotel         uuid default null
)
returns table (
  kind text, reservation_id uuid, reference text,
  hotel_id uuid, hotel_code text, hotel_name text, hotel_phone text,
  guest_name text, guest_phone text, guest_email text, whatsapp_agreed boolean,
  check_in text, check_out text, nights integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with booking as (
    select r.id, r.reference, r.hotel_id, r.created_at, r.check_in, r.check_out,
           r.whatsapp_agreed, h.code, h.name as hotel_name, h.phone as hotel_phone,
           g.full_name, g.phone, g.email::text as email,
           now() at time zone h.timezone as here
      from reservations r
      join hotels h on h.id = r.hotel_id
      join guests g on g.id = r.guest_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  tried as (
    select m.about_id, m.kind,
           max(m.sent_at) filter (where m.status = 'sent') as sent_at,
           count(*) filter (where m.status = 'failed')     as failed
      from messages_sent m
      join booking b on b.hotel_id = m.hotel_id and b.id::text = m.about_id
     where m.about_kind = 'reservation'
       and m.kind in ('booking-confirmation', 'arrival-reminder')
     group by m.about_id, m.kind
  ),
  owed as (
    select b.*,
           c.sent_at as confirmed_at,
           x.sent_at as reminded_at, coalesce(x.failed, 0) as remind_failed,
           c.sent_at is null
             and coalesce(c.failed, 0) < p_most_attempts
             and (p_within_hours is null
                  or b.created_at > now() - make_interval(hours => p_within_hours))
             as confirm_owed
      from booking b
      left join tried c on c.about_id = b.id::text and c.kind = 'booking-confirmation'
      left join tried x on x.about_id = b.id::text and x.kind = 'arrival-reminder'
  ),
  due as (
    select 'booking-confirmation' as kind, o.* from owed o where o.confirm_owed
    union all
    select 'arrival-reminder', o.* from owed o
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
         d.check_in::text, d.check_out::text, (d.check_out - d.check_in)::int
    from due d
   -- Soonest arrival first (D21-34): on switch-on day every future booking is
   -- owed at once, and the guest arriving tomorrow is the one who needs it.
   order by d.check_in, d.created_at, d.kind
$fn$;

comment on function app.guest_messages_due(integer, integer, time, uuid) is
  'Which confirmed bookings are owed their confirmation or their day-before '
  'reminder (D18-11, D18-12, D21-33), soonest arrival first. SECURITY DEFINER '
  'because the sweep has no staff session. Decides nothing about the channel.';


-- -----------------------------------------------------------------------------
-- 3 · A booking's own link, for the message that carries it
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
revoke all on function app.guest_messages_due(integer, integer, time, uuid) from public;
revoke all on function app.guest_booking_link_issue(uuid, text)               from public;
grant execute on function app.guest_messages_due(integer, integer, time, uuid) to pms_app;
grant execute on function app.guest_booking_link_issue(uuid, text)               to pms_app;
grant execute on function app.guest_link_expires(uuid, date)                     to pms_app;
