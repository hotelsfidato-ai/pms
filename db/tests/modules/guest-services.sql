-- =============================================================================
-- GUEST SERVICES - a guest's request is a work order for a stay (D27-178, D27-181)
-- =============================================================================
-- Refers to its migration by what it does - "a guest's request is a work
-- order" - never by its number: the master renumbers at merge.
--
-- The guest's page reaches work orders only through three functions behind the
-- code, so each is called HERE, directly, with the link's hash and without an
-- unlock (root MEMORY 318: the door asks first, and would hide a function that
-- forgot to). Builds two properties of its own and removes them.
-- =============================================================================
do $$
declare
  h uuid; other uuid; clerk uuid;
  guest uuid; stay uuid; booked uuid; stay_other uuid;
  r101 uuid; r102 uuid;
  link uuid; link_booked uuid;
  n int; ok boolean; v text; offers text[]; failed boolean;
begin
  h     := app.provision_property_unchecked('GSY','Requests Test','Nowhere');
  other := app.provision_property_unchecked('GSZ','Requests Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 102);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);
  select id into r101 from rooms where hotel_id = h and number = '101';
  select id into r102 from rooms where hotel_id = h and number = '102';

  insert into staff (email, full_name) values ('gsy-clerk@fidato.in', 'Requests Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk');
  perform set_config('app.user_id', clerk::text, true);

  insert into guests (full_name) values ('Requests Guest') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 2, 2000, 'checked_in')
  returning id into stay;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, stay, r101, current_date, current_date + 2, 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          current_date + 5, current_date + 6, 2000, 'confirmed')
  returning id into booked;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (other, app.next_reference(other), guest, (select id from room_types where hotel_id = other limit 1),
          current_date, current_date + 1, 2000, 'checked_in')
  returning id into stay_other;

  -- A booking's link and an unlock for each stay, as the door would make them.
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay, 'gsy-link', now() + interval '1 day') returning id into link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link, stay, 'gsy-unlock', now() + interval '1 hour');
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, booked, 'gsy-link-booked', now() + interval '1 day') returning id into link_booked;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link_booked, booked, 'gsy-unlock-booked', now() + interval '1 hour');

  -- ---------- what the page offers ------------------------------------------
  select o.offers into offers from app.guest_link_open('gsy-link', 'gsy-unlock') o;
  perform test.ok('guest-services','a checked-in guest is offered the three teams',
    offers @> array['housekeeping', 'maintenance', 'fnb'], coalesce(offers::text, 'null'));
  select o.offers into offers from app.guest_link_open('gsy-link-booked', 'gsy-unlock-booked') o;
  perform test.ok('guest-services','a guest not yet checked in is not',
    not (offers && array['housekeeping', 'maintenance', 'fnb']), coalesce(offers::text, 'null'));

  -- ---------- asking --------------------------------------------------------
  ok := app.guest_request_make('gsy-link', 'nope', 'housekeeping', 'Two towels', null);
  select count(*) into n from work_orders where reservation_id = stay;
  perform test.ok('guest-services','the link alone asks nothing - the function checks the unlock itself',
    not ok and n = 0, n || ' written');

  ok := app.guest_request_make('gsy-link-booked', 'gsy-unlock-booked', 'fnb', 'Tea', null);
  select count(*) into n from work_orders where reservation_id = booked;
  perform test.ok('guest-services','a guest not checked in cannot ask a team',
    not ok and n = 0, n || ' written');

  ok := app.guest_request_make('gsy-link', 'gsy-unlock', 'fnb', ' A pot of tea ', 'at 8');
  select count(*) into n from work_orders
   where reservation_id = stay and raised_by_guest and raised_by is null
     and category = 'fnb' and title = 'A pot of tea' and detail = 'at 8'
     and room_id = r101 and status = 'open' and hotel_id = h;
  perform test.ok('guest-services','a team request is a work order for the stay, in its room, from the guest',
    ok and n = 1, n || ' such orders');
  select count(*) into n from guest_requests where reservation_id = stay;
  perform test.ok('guest-services','and not a guest request as well', n = 0, n || ' guest requests');

  -- the desk raises one for the guest: the guest does not see staff words
  insert into work_orders (hotel_id, room_id, reservation_id, title, category, raised_by)
  values (h, r101, stay, 'Guest was short with staff - extra bed', 'housekeeping', clerk);
  select count(*), max(status) into n, v from app.guest_requests_mine('gsy-link', 'gsy-unlock');
  perform test.ok('guest-services','the guest sees their own request, waiting, and not the desk''s',
    n = 1 and v = 'waiting', n || ' seen, ' || coalesce(v, 'null'));
  select count(*) into n from app.guest_requests_mine('gsy-link', 'nope');
  perform test.ok('guest-services','and sees nothing without the unlock', n = 0, n || ' seen');

  -- ten open at most for the stay, the team requests counted
  for i in 1..8 loop
    perform app.guest_request_make('gsy-link', 'gsy-unlock', 'housekeeping', 'Towel ' || i, null);
  end loop;
  ok := app.guest_request_make('gsy-link', 'gsy-unlock', 'desk', 'An eleventh', null);
  perform test.ok('guest-services','ten open is the most a stay may have, work orders included',
    not ok, 'an eleventh was accepted');

  -- ---------- the table's own rules ------------------------------------------
  failed := false;
  begin
    insert into work_orders (hotel_id, reservation_id, title, category, raised_by)
    values (h, stay_other, 'Elsewhere', 'fnb', clerk);
  exception when raise_exception then failed := true;
  end;
  perform test.ok('guest-services','a request cannot name a stay at another property',
    failed, 'one was accepted');

  failed := false;
  begin
    insert into work_orders (hotel_id, title, category, raised_by_guest)
    values (h, 'No stay', 'housekeeping', true);
  exception when check_violation then failed := true;
  end;
  perform test.ok('guest-services','a guest''s request always names its stay',
    failed, 'one was accepted without a stay');

  -- ---------- clean up ------------------------------------------------------
  delete from guest_unlocks where link_id in (link, link_booked);
  delete from guest_links   where id in (link, link_booked);
  delete from work_orders   where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;

  select count(*) into n from hotels where code in ('GSY', 'GSZ');
  perform test.ok('guest-services','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

-- =============================================================================
-- THE ROOM AND THE PHONE (D27-235 2.4) and DIGILOCKER (D27-235 2.5)
-- =============================================================================
-- Refers to its migrations by what they do - "the room and the phone",
-- "DigiLocker". Every function is called here directly (OCI-5).
do $$
declare
  h uuid; other uuid; clerk uuid; guest uuid; stay uuid; booked uuid; stay_other uuid;
  r101 uuid; r102 uuid; o101 uuid; link uuid;
  n int; ok boolean; v text;
  t1 text := repeat('a', 64); t2 text := repeat('b', 64); t3 text := repeat('c', 64);
  t4 text := repeat('d', 64); t5 text := repeat('e', 64);
begin
  h     := app.provision_property_unchecked('GRP','Room Phone Test','Nowhere');
  other := app.provision_property_unchecked('GRQ','Room Phone Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 102);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 101, 101);
  select id into r101 from rooms where hotel_id = h and number = '101';
  select id into r102 from rooms where hotel_id = h and number = '102';
  select id into o101 from rooms where hotel_id = other and number = '101';

  insert into staff (email, full_name) values ('grp-clerk@fidato.in', 'Room Phone Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk'), (clerk, other, 'front_desk');
  perform set_config('app.user_id', clerk::text, true);

  insert into guests (full_name, phone) values ('Room Phone Guest', '+91 98765 43210') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          app.business_date(h), app.business_date(h) + 2, 2000, 'checked_in') returning id into stay;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, stay, r101, app.business_date(h), app.business_date(h) + 2, 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          app.business_date(h), app.business_date(h) + 1, 2000, 'confirmed') returning id into booked;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, booked, r102, app.business_date(h), app.business_date(h) + 1, 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (other, app.next_reference(other), guest,
          (select id from room_types where hotel_id = other limit 1),
          app.business_date(other), app.business_date(other) + 1, 2000, 'checked_in') returning id into stay_other;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (other, stay_other, o101, app.business_date(other), app.business_date(other) + 1, 'arrival');

  -- ---------- the room and the phone ----------------------------------------
  ok := app.guest_room_phone_link('GRP', '101', '98765 43210', t1);
  select count(*) into n from guest_links
   where token_hash = t1 and reservation_id = stay and origin = 'room-phone';
  perform test.ok('guest-services', 'the room and the booking''s phone make a link for that stay',
    ok and n = 1, coalesce(ok::text, 'null') || ', ' || n || ' links');

  select phone into v from app.guest_code_make(t1);
  perform test.ok('guest-services', 'and its code goes to the booking''s own number',
    v = '+91 98765 43210', coalesce(v, 'no number'));

  ok := app.guest_room_phone_link('GRP', '101', '98765 43211', t2);
  select count(*) into n from guest_links where token_hash = t2;
  perform test.ok('guest-services', 'a wrong phone makes nothing', not ok and n = 0, n || ' links');

  ok := app.guest_room_phone_link('GRP', '102', '98765 43210', t2);
  select count(*) into n from guest_links where token_hash = t2;
  perform test.ok('guest-services', 'a room whose guest has not checked in makes nothing',
    not ok and n = 0, n || ' links');

  ok := app.guest_room_phone_link('GRQ', '102', '98765 43210', t2);
  select count(*) into n from guest_links where token_hash = t2;
  perform test.ok('guest-services', 'a room the hotel does not have makes nothing',
    not ok and n = 0, n || ' links');

  ok := app.guest_room_phone_link('GRP', '101', '43210', t2);
  perform test.ok('guest-services', 'a number shorter than ten digits makes nothing', not ok, 'accepted');

  perform app.guest_room_phone_link('GRP', '101', '9876543210', t2);
  perform app.guest_room_phone_link('GRP', '101', '9876543210', t3);
  ok := app.guest_room_phone_link('GRP', '101', '9876543210', t4);
  select count(*) into n from guest_links where token_hash = t4;
  perform test.ok('guest-services', 'three links an hour for a stay, then nothing',
    not ok and n = 0, n || ' links');

  ok := app.guest_code_answer(t5, '123456', repeat('f', 64));
  perform test.ok('guest-services', 'a ticket that matched nothing opens nothing', not ok, 'opened');

  -- ---------- DigiLocker ------------------------------------------------------
  select id into link from guest_links where token_hash = t1;
  ok := app.guest_digilocker_begin(t5, repeat('1', 64), repeat('v', 43));
  perform test.ok('guest-services', 'DigiLocker: a dead link begins nothing', not ok, 'began');

  ok := app.guest_digilocker_begin(t1, repeat('1', 64), repeat('v', 43));
  perform test.ok('guest-services', 'DigiLocker: a live link begins an attempt', ok, 'refused');
  ok := app.guest_digilocker_answer(repeat('1', 64), '9876543210', 'xxxxxxxx1234', 'R Guest', repeat('9', 64));
  perform test.ok('guest-services', 'DigiLocker: an answer before the verifier is taken is refused',
    not ok, 'answered');

  ok := app.guest_digilocker_begin(t1, repeat('2', 64), repeat('v', 43));
  v := app.guest_digilocker_take(repeat('2', 64));
  perform test.ok('guest-services', 'DigiLocker: the verifier comes back once',
    v = repeat('v', 43) and app.guest_digilocker_take(repeat('2', 64)) is null, coalesce(v, 'null'));
  ok := app.guest_digilocker_answer(repeat('2', 64), '+91 99999 00000', 'xxxxxxxx1234', 'R Guest', repeat('8', 64));
  select count(*) into n from guest_unlocks where unlock_hash = repeat('8', 64);
  perform test.ok('guest-services', 'DigiLocker: another mobile unlocks nothing',
    not ok and n = 0, n || ' unlocks');
  ok := app.guest_digilocker_answer(repeat('2', 64), '9876543210', 'xxxxxxxx1234', 'R Guest', repeat('8', 64));
  perform test.ok('guest-services', 'DigiLocker: an attempt answers once', not ok, 'answered twice');

  insert into guest_detail_submissions (hotel_id, reservation_id, guest_id, id_type, id_number, address_line)
  values (h, stay, guest, 'voter', 'ABC1234567', '12 MG Road');
  ok := app.guest_digilocker_begin(t1, repeat('3', 64), repeat('v', 43));
  perform app.guest_digilocker_take(repeat('3', 64));
  ok := app.guest_digilocker_answer(repeat('3', 64), '+919876543210', 'xxxx-xxxx-1234', ' R Guest ', repeat('7', 64));
  select count(*) into n from guest_unlocks where unlock_hash = repeat('7', 64) and link_id = link;
  perform test.ok('guest-services', 'DigiLocker: the booking''s mobile unlocks this phone',
    ok and n = 1, n || ' unlocks');
  select count(*) into n from guest_detail_submissions
   where reservation_id = stay and status = 'waiting' and id_type = 'aadhaar'
     and id_number = 'xxxxxxxx1234' and source = 'digilocker' and id_name = 'R Guest'
     and address_line = '12 MG Road';
  perform test.ok('guest-services', 'DigiLocker: the masked ID waits for the desk, the typed address kept',
    n = 1, n || ' such submissions');

  -- ---------- clean up --------------------------------------------------------
  delete from guest_digilocker_attempts where hotel_id in (h, other);
  delete from guest_detail_submissions where hotel_id in (h, other);
  delete from guest_unlocks where link_id in (select id from guest_links where hotel_id in (h, other));
  delete from guest_link_codes where link_id in (select id from guest_links where hotel_id in (h, other));
  delete from guest_links where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;
  select count(*) into n from hotels where code in ('GRP', 'GRQ');
  perform test.ok('guest-services', 'the room-and-phone fixtures do not outlive the test',
    n = 0, n || ' left');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

-- =============================================================================
-- WAKE-UP CALLS AND LOST PROPERTY (D27-239, D27-241)
-- =============================================================================
-- Refers to its migration by what it does - "wake-up calls and lost property".
-- The guest's two functions are called directly, with and without the unlock.
do $$
declare
  h uuid; clerk uuid; guest uuid; stay uuid; r101 uuid; link uuid;
  n int; ok boolean; failed boolean; d date;
  tok text := repeat('w', 64); unl text := repeat('u', 64);
begin
  h := app.provision_property_unchecked('GWU','Wake Up Test','Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 101);
  select id into r101 from rooms where hotel_id = h and number = '101';
  insert into staff (email, full_name) values ('gwu-clerk@fidato.in', 'Wake Up Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk');
  perform set_config('app.user_id', clerk::text, true);

  d := app.business_date(h);
  insert into guests (full_name) values ('Wake Up Guest') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          d, d + 2, 2000, 'checked_in') returning id into stay;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, stay, r101, d, d + 2, 'arrival');
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay, tok, now() + interval '1 day') returning id into link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link, stay, unl, now() + interval '1 hour');

  ok := app.guest_wake_up_ask(tok, 'nope', d + 2, '07:00');
  select count(*) into n from wake_up_calls where reservation_id = stay;
  perform test.ok('guest-services', 'wake-up: the link alone asks nothing', not ok and n = 0, n || ' written');

  ok := app.guest_wake_up_ask(tok, unl, d + 2, '07:00');
  select count(*) into n from wake_up_calls
   where reservation_id = stay and status = 'asked' and from_guest and room_id = r101
     and app.hotel_clock(h, call_at) = to_char(d + 2, 'YYYY-MM-DD') || 'T07:00';
  perform test.ok('guest-services', 'wake-up: a guest''s ask waits for the desk, on the hotel''s clock',
    ok and n = 1, n || ' such calls');

  ok := app.guest_wake_up_ask(tok, unl, d + 5, '07:00');
  perform test.ok('guest-services', 'wake-up: not after the stay', not ok, 'accepted');
  ok := app.guest_wake_up_ask(tok, unl, d - 1, '23:59');
  perform test.ok('guest-services', 'wake-up: not in the past', not ok, 'accepted');
  ok := app.guest_wake_up_ask(tok, unl, d + 1, '7am');
  perform test.ok('guest-services', 'wake-up: a time is HH:MM', not ok, 'accepted');

  perform app.guest_wake_up_ask(tok, unl, d + 1, '06:00');
  perform app.guest_wake_up_ask(tok, unl, d + 1, '06:30');
  ok := app.guest_wake_up_ask(tok, unl, d + 1, '06:45');
  perform test.ok('guest-services', 'wake-up: three waiting at most', not ok, 'a fourth was accepted');

  select count(*) into n from app.guest_wake_ups_mine(tok, 'nope');
  perform test.ok('guest-services', 'wake-up: the list shows nothing without the unlock', n = 0, n || ' shown');
  select count(*) into n from app.guest_wake_ups_mine(tok, unl);
  perform test.ok('guest-services', 'wake-up: and the guest''s own with it', n = 3, n || ' shown');

  failed := false;
  begin
    update wake_up_calls set status = 'cancelled', handled_by = clerk, handled_at = now()
     where reservation_id = stay;
  exception when check_violation then failed := true;
  end;
  perform test.ok('guest-services', 'wake-up: a cancel says why', failed, 'cancelled without a reason');

  failed := false;
  begin
    insert into lost_items (hotel_id, what, found_where, status, handled_by, handled_at)
    values (h, 'A watch', 'Lobby', 'returned', clerk, now());
  exception when check_violation then failed := true;
  end;
  perform test.ok('guest-services', 'lost property: returned says to whom', failed, 'returned to nobody');
  failed := false;
  begin
    insert into lost_items (hotel_id, what, found_where, status, handled_by, handled_at)
    values (h, 'A scarf', 'Room 101', 'disposed', clerk, now());
  exception when check_violation then failed := true;
  end;
  perform test.ok('guest-services', 'lost property: disposed says why', failed, 'disposed without a reason');

  delete from wake_up_calls where hotel_id = h;
  delete from lost_items where hotel_id = h;
  delete from guest_unlocks where link_id = link;
  delete from guest_links where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;
  select count(*) into n from hotels where code = 'GWU';
  perform test.ok('guest-services', 'the wake-up fixtures do not outlive the test', n = 0, n || ' left');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
