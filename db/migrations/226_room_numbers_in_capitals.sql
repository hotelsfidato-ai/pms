-- =============================================================================
-- 226 · Room numbers in capitals (the owner's D27-335, 15 October)
-- =============================================================================
-- "Room numbers are always saved in capitals (111a is saved 111A, so it can
-- never be a second room)." The guest's room-and-phone page (181) matched the
-- typed room exactly, so a guest in 111A who typed 111a was never found - and
-- was told the same words as a match, by design, so nobody would ever know.
--
-- The one change from 181: the room is matched whatever its capitals, on both
-- sides (`upper(rm.number) = upper(btrim(p_room))`). Signature, security,
-- comment and grants are 181's, unchanged. Re-runnable.
-- =============================================================================

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
     and upper(rm.number) = upper(btrim(p_room))
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
