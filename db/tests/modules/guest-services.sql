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
