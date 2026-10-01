-- =============================================================================
-- TABLE BOOKINGS - a hotel guest asks for a table (D27-221, D27-224)
-- =============================================================================
-- Refers to its migration by what it does - "a table for the guest" - never by
-- its number: the master renumbers at merge.
--
-- The guest's page reaches table bookings only through four functions behind
-- the code, so each is called HERE, directly, with the link's hash and no
-- unlock, and with another stay's unlock (OCI-5, root MEMORY 318: the door asks
-- first, and would hide a function that forgot to). Builds two properties of
-- its own and removes them.
-- =============================================================================
do $$
declare
  h uuid; other uuid; clerk uuid; rest uuid;
  guest uuid; stay uuid; booked uuid;
  link uuid; link_booked uuid;
  d date; n int; ok boolean; v text; id uuid; slots text[];
begin
  h     := app.provision_property_unchecked('TBK', 'Tables Test', 'Nowhere');
  other := app.provision_property_unchecked('TBL', 'Tables Other', 'Nowhere');
  d     := (now() at time zone 'Asia/Kolkata')::date;

  insert into staff (email, full_name) values ('tbk-clerk@fidato.in', 'Tables Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'pos');

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'REST', 'Tables Test Restaurant', 'food', clerk) returning id into rest;

  insert into guests (full_name) values ('Tables Guest') returning id into guest;
  -- in the house for two nights, and a booking of the same guest arriving in five days
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          d, d + 2, 2000, 'checked_in') returning id into stay;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          d + 5, d + 6, 2000, 'confirmed') returning id into booked;

  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay, 'tbk-link', now() + interval '1 day') returning id into link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link, stay, 'tbk-unlock', now() + interval '1 hour');
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, booked, 'tbk-link-booked', now() + interval '1 day') returning id into link_booked;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link_booked, booked, 'tbk-unlock-booked', now() + interval '1 hour');

  -- ---------- the link alone, and another stay's unlock: nothing (OCI-5) ----------
  select count(*) into n from app.guest_table_offer('tbk-link', 'nope');
  perform test.ok('table bookings', 'the link alone is offered nothing - the function checks the unlock itself',
    n = 0, n || ' rows');
  select count(*) into n from app.guest_table_offer('tbk-link', 'tbk-unlock-booked');
  perform test.ok('table bookings', 'nor with another stay''s unlock', n = 0, n || ' rows');

  ok := app.guest_table_book('tbk-link', 'nope', 'REST', d + 1, '20:00', 2, null);
  ok := ok or app.guest_table_book('tbk-link', 'tbk-unlock-booked', 'REST', d + 1, '20:00', 2, null);
  select count(*) into n from table_bookings where hotel_id = h;
  perform test.ok('table bookings', 'the link alone, or another stay''s unlock, books nothing',
    not ok and n = 0, n || ' written');

  -- ---------- what is offered ----------
  select f.slots into slots from app.guest_table_offer('tbk-link', 'tbk-unlock') f
   where f.outlet = 'REST' and f.night = d + 1;
  perform test.ok('table bookings', 'tomorrow is offered every slot of the owner''s default hours, in the hotel''s time',
    slots = array['12:30','13:00','13:30','14:00','14:30','19:30','20:00','20:30','21:00','21:30','22:00','22:30'],
    coalesce(slots::text, 'null'));
  select count(*) into n from app.guest_table_offer('tbk-link', 'tbk-unlock') f where f.night >= d + 2;
  perform test.ok('table bookings', 'no night after the stay - check-out day is not a night', n = 0, n || ' rows');
  select count(*) into n from app.guest_table_offer('tbk-link-booked', 'tbk-unlock-booked') f where f.night = d + 5;
  perform test.ok('table bookings', 'a confirmed guest not yet arrived may book their night', n = 1, n || ' rows');

  -- ---------- booking ----------
  ok := app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '12:15', 2, null);
  perform test.ok('table bookings', 'a time that is not a slot is refused', not ok, 'accepted');
  ok := app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '20:00', 21, null);
  perform test.ok('table bookings', 'a party over twenty is refused', not ok, 'accepted');

  ok := app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '20:00', 2, ' A quiet corner ');
  select b.id into id from table_bookings b
   where b.reservation_id = stay and b.status = 'requested' and b.party = 2
     and b.note = 'A quiet corner' and b.outlet_id = rest
     and b.at = ((d + 1) + time '20:00') at time zone 'Asia/Kolkata';
  perform test.ok('table bookings', 'a slot is booked, requested, at that time in the hotel''s zone',
    ok and id is not null, coalesce(id::text, 'none'));

  select count(*), max(m.at_time) into n, v from app.guest_table_bookings_mine('tbk-link', 'tbk-unlock') m;
  perform test.ok('table bookings', 'the guest sees it, at their own time', n = 1 and v = '20:00', n || ', ' || coalesce(v, 'null'));
  select count(*) into n from app.guest_table_bookings_mine('tbk-link', 'nope');
  perform test.ok('table bookings', 'and sees nothing without the unlock', n = 0, n || ' seen');

  -- three open at most
  perform app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '13:00', 2, null);
  perform app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '21:00', 2, null);
  ok := app.guest_table_book('tbk-link', 'tbk-unlock', 'REST', d + 1, '21:30', 2, null);
  perform test.ok('table bookings', 'three open is the most a stay may have', not ok, 'a fourth was accepted');

  -- ---------- cancelling ----------
  ok := app.guest_table_cancel('tbk-link', 'nope', id);
  ok := ok or app.guest_table_cancel('tbk-link-booked', 'tbk-unlock-booked', id);
  perform test.ok('table bookings', 'the link alone, or another stay''s unlock, cancels nothing',
    not ok and (select status from table_bookings where table_bookings.id = id) = 'requested', 'cancelled');
  ok := app.guest_table_cancel('tbk-link', 'tbk-unlock', id);
  perform test.ok('table bookings', 'the guest cancels their own request while it waits',
    ok and (select status from table_bookings where table_bookings.id = id) = 'cancelled', 'not cancelled');
  ok := app.guest_table_cancel('tbk-link', 'tbk-unlock', id);
  perform test.ok('table bookings', 'and not twice', not ok, 'cancelled again');

  update table_bookings set status = 'confirmed', answered_by = clerk, answered_at = now()
   where reservation_id = stay and status = 'requested'
     and at = ((d + 1) + time '13:00') at time zone 'Asia/Kolkata'
  returning table_bookings.id into id;
  ok := app.guest_table_cancel('tbk-link', 'tbk-unlock', id);
  perform test.ok('table bookings', 'a confirmed table is not the guest''s to cancel here - they ask the desk',
    not ok and (select status from table_bookings where table_bookings.id = id) = 'confirmed', 'cancelled');

  -- ---------- the hours, and the zone ----------
  update pos_outlets set table_lunch = '', table_dinner = '' where id = rest;
  select count(*) into n from app.guest_table_offer('tbk-link', 'tbk-unlock');
  perform test.ok('table bookings', 'no hours, no table booking at that restaurant', n = 0, n || ' rows');
  update pos_outlets set table_lunch = null, table_dinner = null where id = rest;

  update hotels set timezone = 'Europe/London' where id = h;
  perform test.ok('table bookings', 'a hotel elsewhere has its slots in its own time',
    (select min(s) from app.table_slots(rest, date '2026-11-02') s) = timestamptz '2026-11-02 12:30:00+00',
    (select min(s)::text from app.table_slots(rest, date '2026-11-02') s));
  update hotels set timezone = 'Asia/Kolkata' where id = h;

  -- ---------- and the fixtures go ----------
  delete from table_bookings where hotel_id in (h, other);
  delete from guest_unlocks where link_id in (link, link_booked);
  delete from guest_links   where id in (link, link_booked);
  delete from pos_outlets   where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;
end $$;
