-- =============================================================================
-- 167 · Three ways to prove it is you: the code by email, and Google
--       (D27-207, D27-210)
-- =============================================================================
-- The guest's own door (114, 121, 158) took one proof: six digits sent on
-- WhatsApp to the number the booking carries. The owner adds two, the guest's
-- choice, and nothing is sent until they choose (D27-210):
--
--   · THE CODE BY EMAIL, to the email THE STAY carries. Nobody types an
--     address. The same table, the same rules: only the hash is kept, ten
--     minutes, five wrong answers, one live code per link - so
--     `app.guest_code_answer` (158) accepts it unchanged and hands out the
--     same unlock.
--   · CONTINUE WITH GOOGLE. The door checks Google's signed answer; THIS file
--     compares the address Google vouches for with the stay's own, here in the
--     database, and records the same unlock. No account, no session, no guest
--     role (the door's rule 1).
--
-- Every function here is NEW. None changes the signature or the return type of
-- a function an earlier migration makes (MEMORY 317): every deploy replays
-- from 001. That is why the email's hint has its own function and is not a new
-- column of `app.guest_link_open` (121).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1 · An email address as the page may show it
-- -----------------------------------------------------------------------------
-- The first letter and the domain: enough for its owner to know which inbox,
-- not enough to write to it. Null for anything that is not an address, so a
-- typing slip on the booking is "no email", never half of one on a screen.
create or replace function app.masked_email(p_email text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select case
    when btrim(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then left(btrim(p_email), 1) || '…@' || split_part(btrim(p_email), '@', 2)
  end;
$fn$;

revoke all on function app.masked_email(text) from public;

-- -----------------------------------------------------------------------------
-- 2 · What a booking's link may say about the email, before the code
-- -----------------------------------------------------------------------------
-- A booking's own link shows the guest their name and the last digits of
-- their number already; the masked email is the same kind of fact. A ROOM CARD
-- SHOWS NOTHING OF THE GUEST (D21-14): null, whoever is in the room.
create or replace function app.guest_link_ways(p_token_hash text)
returns table (email_hint text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select case when s.room_id is null then app.masked_email(g.email::text) end
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;
$fn$;

comment on function app.guest_link_ways(text) is
  'The masked email a booking''s link may show before the code (D27-207). Null '
  'on a room card, which shows nothing of the guest (D21-14), and where the '
  'booking carries no address.';

revoke all on function app.guest_link_ways(text) from public;
grant execute on function app.guest_link_ways(text) to pms_app;

-- -----------------------------------------------------------------------------
-- 3 · The code, to the email the stay carries
-- -----------------------------------------------------------------------------
-- 158's `app.guest_code_make`, for the other address. A stay with no email
-- answers a row with no code, and nothing is issued - the page says "Ask the
-- desk". A new code ends the one before it, whichever way that one went.
create or replace function app.guest_email_code_make(p_token_hash text)
returns table (code text, sent_to text, email text, reservation_id uuid, reference text,
               guest_name text, hotel_id uuid, hotel_code text, hotel_name text,
               room_card boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link  uuid;
  v_stay  uuid;
  v_room  boolean;
  v_email text;
  v_code  text;
begin
  select s.link_id, s.reservation_id, s.room_id is not null, btrim(g.email::text)
    into v_link, v_stay, v_room, v_email
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null then
    return;                                     -- nothing, and nothing said
  end if;

  if app.masked_email(v_email) is null then
    return query
      select null::text, null::text, null::text, r.id, r.reference, g.full_name,
             h.id, h.code, h.name, v_room
        from reservations r
        join guests g on g.id = r.guest_id
        join hotels h on h.id = r.hotel_id
       where r.id = v_stay;
    return;
  end if;

  v_code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  update guest_link_codes set consumed_at = now()
   where link_id = v_link and consumed_at is null;

  insert into guest_link_codes (link_id, reservation_id, code_hash, sent_to, expires_at)
  values (v_link, v_stay, encode(digest(v_code, 'sha256'), 'hex'),
          app.masked_email(v_email),
          now() + interval '10 minutes');

  return query
    select v_code, app.masked_email(v_email), v_email, r.id, r.reference, g.full_name,
           h.id, h.code, h.name, v_room
      from reservations r
      join guests g on g.id = r.guest_id
      join hotels h on h.id = r.hotel_id
     where r.id = v_stay;
end
$fn$;

comment on function app.guest_email_code_make(text) is
  'A six-digit code for the email THE STAY carries (D27-207): no address is '
  'typed. A stay with no email answers a row with no code, and nothing is issued.';

revoke all on function app.guest_email_code_make(text) from public;
grant execute on function app.guest_email_code_make(text) to pms_app;

-- -----------------------------------------------------------------------------
-- 4 · Google's answer: the address it vouches for must be the stay's own
-- -----------------------------------------------------------------------------
-- The door has already checked that Google signed the answer, for this system,
-- just now, for a verified address. What is decided HERE is whose booking it
-- is: the address must be the one the stay carries, letter case aside. Then
-- the same unlock as a right code (158): this phone, this link, this stay, a
-- day. A wrong address, a stay with none, a dead link: false, and nothing
-- written.
create or replace function app.guest_google_answer(
  p_token_hash text, p_email text, p_unlock_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid;
  v_stay uuid;
  v_same boolean;
begin
  if coalesce(length(p_unlock_hash), 0) <> 64 or coalesce(btrim(p_email), '') = '' then
    return false;
  end if;

  select s.link_id, s.reservation_id,
         lower(btrim(g.email::text)) = lower(btrim(p_email))
    into v_link, v_stay, v_same
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id;

  if v_link is null or v_stay is null or v_same is not true then
    return false;
  end if;

  update guest_links set verified_at = now() where id = v_link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (v_link, v_stay, p_unlock_hash, now() + interval '24 hours');
  return true;
end
$fn$;

comment on function app.guest_google_answer(text, text, text) is
  'Continue with Google (D27-207): true, and this phone unlocked for a day, '
  'only when the address Google vouched for is the one the stay carries.';

revoke all on function app.guest_google_answer(text, text, text) from public;
grant execute on function app.guest_google_answer(text, text, text) to pms_app;
