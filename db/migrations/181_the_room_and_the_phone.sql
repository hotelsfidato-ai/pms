-- =============================================================================
-- 181 · The room and the phone, during the stay (D27-235 2.4)
-- =============================================================================
-- The owner, 2 October (against the recommendation to keep the room QR alone):
-- a guest staying now may type their ROOM NUMBER and their PHONE NUMBER, and
-- the WhatsApp code goes ONLY to the booking's own number, and only when both
-- match. Every answer reads the same, matched or not, with limits per address
-- (the door's) and per booking (here).
--
-- A match makes a NEW booking link for the stay - the token is made by the
-- door, only its hash comes here - and from there it is the ordinary door: the
-- code is `app.guest_code_make` (158) on that link, the answer is
-- `app.guest_code_answer` (158). A mismatch writes nothing at all.
--
-- `app.guest_link_open` is NOT touched (online-checkin rule 8, D27-225).
-- The master renumbers at merge; refer to this file as "the room and the phone".
-- =============================================================================

-- 121 set the origins on every replay; this file adds one and runs after it.
alter table guest_links drop constraint if exists guest_links_origin_check;
alter table guest_links add constraint guest_links_origin_check
  check (origin in ('desk', 'confirmation', 'qr', 'room', 'room-phone'));

-- The stay in this room NOW (the room card's rule, 121: a live assignment on a
-- checked-in booking from the hotel's own business date, the latest winning
-- when the one due out is still in), and its phone the same number - the last
-- ten digits of each, so "+91 98765 43210" is "9876543210". True, and a link
-- for the stay with the door's token hash, only when both match and this
-- stay has had fewer than three such links in the last hour. False otherwise,
-- and nothing written.
create or replace function app.guest_room_phone_link(
  p_hotel_code text, p_room text, p_phone text, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_digits text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_hotel  uuid;
  v_stay   uuid;
  v_out    date;
  v_phone  text;
begin
  if length(v_digits) <> 10 or coalesce(length(p_token_hash), 0) <> 64
     or coalesce(btrim(p_room), '') = '' then
    return false;
  end if;

  select h.id into v_hotel from hotels h
   where h.code = upper(btrim(p_hotel_code)) and h.is_active;
  if v_hotel is null then return false; end if;

  select r.id, r.check_out,
         right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10)
    into v_stay, v_out, v_phone
    from rooms rm
    join room_assignments ra on ra.room_id = rm.id and ra.released_at is null
    join reservations r      on r.id = ra.reservation_id and r.status = 'checked_in'
    join guests g            on g.id = r.guest_id
   where rm.hotel_id = v_hotel
     and rm.number = btrim(p_room)
     and ra.from_date <= app.business_date(v_hotel)
   order by ra.from_date desc, ra.created_at desc
   limit 1;

  if v_stay is null or v_phone is distinct from v_digits then
    return false;
  end if;

  if (select count(*) from guest_links
       where reservation_id = v_stay and origin = 'room-phone'
         and created_at > now() - interval '1 hour') >= 3 then
    return false;
  end if;

  insert into guest_links (hotel_id, reservation_id, token_hash, origin, expires_at)
  values (v_hotel, v_stay, p_token_hash, 'room-phone', app.guest_link_expires(v_hotel, v_out));
  return true;
end
$fn$;

comment on function app.guest_room_phone_link(text, text, text, text) is
  'D27-235 2.4: a booking link for the stay in this room now, only when the '
  'typed phone is the booking''s own (last ten digits) and fewer than three were '
  'made in the hour. Returns only true or false; the code goes to the booking''s '
  'number through app.guest_code_make.';

revoke all on function app.guest_room_phone_link(text, text, text, text) from public;
grant execute on function app.guest_room_phone_link(text, text, text, text) to pms_app;
