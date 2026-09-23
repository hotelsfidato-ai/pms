-- =============================================================================
-- FRONT DESK — one rule for In house and Empty (the owner's D21-36, D21-37)
-- =============================================================================
-- Refers to its migration by what it does — "one in-house rule" — not by its
-- number. app.in_house says who is in house and in which room; app.house_now
-- says, for every room, in house / out of order / empty; and the column
-- rooms.occupancy_status is set from that rule and nothing else (FD-8: a room
-- HELD for a later booking read "occupied" and refused a walk-in).
--
-- The routes' half - the walk-in, and every screen's count - is
-- api/test/modules/front-desk/inHouseRule.test.ts.
-- Builds a property of its own on 25 August 2026 and removes it.
-- =============================================================================
do $$
declare
  h uuid; t uuid; g uuid;
  r101 uuid; r102 uuid; r103 uuid; r104 uuid; r105 uuid; r106 uuid; r107 uuid;
  held uuid; arriving uuid; late uuid; moving uuid; leaving uuid; later uuid;
  occ text; n int;
  f record;
begin
  h := app.provision_property_unchecked('FDH','In House Rule Test','Nowhere');
  update hotels set business_date = date '2026-08-25' where id = h;
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 107);
  select id into t from room_types where hotel_id = h and code = 'STD';
  select id into r101 from rooms where hotel_id = h and number = '101';
  select id into r102 from rooms where hotel_id = h and number = '102';
  select id into r103 from rooms where hotel_id = h and number = '103';
  select id into r104 from rooms where hotel_id = h and number = '104';
  select id into r105 from rooms where hotel_id = h and number = '105';
  select id into r106 from rooms where hotel_id = h and number = '106';
  select id into r107 from rooms where hotel_id = h and number = '107';
  insert into guests (full_name) values ('In-house rule fixture guest') returning id into g;

  -- ---------- FD-8: a room HELD for a later booking is not occupied ---------
  -- 208 at 5 Elements: given in advance to a booking arriving on the 27th, and
  -- "occupied" from that moment, so a one-night walk-in on the 25th was told
  -- somebody was in it. Nobody was.
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-HELD', g, t, date '2026-08-27', date '2026-08-30', 2000, 'confirmed')
  returning id into held;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, held, r101, date '2026-08-27', date '2026-08-30', 'arrival');

  select occupancy_status into occ from rooms where id = r101;
  perform test.ok('one in-house rule','a room held for a later booking stays vacant (FD-8)',
    occ = 'vacant', 'got ' || occ);
  perform test.ok('one in-house rule','and it is Empty tonight',
    (select empty from app.house_now(h) where room_id = r101));

  -- ---------- a check-in puts the guest in the room --------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-ARRIVE', g, t, date '2026-08-25', date '2026-08-27', 2000, 'confirmed')
  returning id into arriving;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, arriving, r102, date '2026-08-25', date '2026-08-27', 'arrival');
  select occupancy_status into occ from rooms where id = r102;
  perform test.ok('one in-house rule','arriving today and not yet in: vacant',
    occ = 'vacant', 'got ' || occ);

  update reservations set status = 'checked_in' where id = arriving;
  select occupancy_status into occ from rooms where id = r102;
  perform test.ok('one in-house rule','checked in: occupied', occ = 'occupied', 'got ' || occ);

  -- ---------- D21-36: a late checkout is still in house ----------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-LATE', g, t, date '2026-08-22', date '2026-08-24', 2000, 'checked_in')
  returning id into late;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, late, r103, date '2026-08-22', date '2026-08-24', 'arrival');
  perform test.ok('one in-house rule','departed yesterday by the dates, not checked out: in house',
    exists (select 1 from app.in_house(h) where reservation_id = late and room_id = r103));
  select occupancy_status into occ from rooms where id = r103;
  perform test.ok('one in-house rule','and the room is occupied', occ = 'occupied', 'got ' || occ);

  -- ---------- a guest moved mid-stay is in the new room, not the old ---------
  -- 054 shortens the old room's assignment instead of releasing it, so 070's
  -- trigger never saw it and the old room stayed "occupied" behind them.
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-MOVE', g, t, date '2026-08-23', date '2026-08-28', 2000, 'checked_in')
  returning id into moving;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, moving, r104, date '2026-08-23', date '2026-08-28', 'arrival');
  perform app.move_room(h, moving, r105, date '2026-08-25', 'move', null);

  select occupancy_status into occ from rooms where id = r104;
  perform test.ok('one in-house rule','the room a guest moved out of is vacant',
    occ = 'vacant', 'got ' || occ);
  select occupancy_status into occ from rooms where id = r105;
  perform test.ok('one in-house rule','the room they moved into is occupied',
    occ = 'occupied', 'got ' || occ);
  perform test.ok('one in-house rule','in house, once, in the new room',
    (select array_agg(room_id) from app.in_house(h) where reservation_id = moving) = array[r105]);

  -- ---------- leaving a room held for a later booking: vacant ----------------
  -- 070 set the column 'vacant' only when no other live assignment held the
  -- room, so a room checked out of while next week's booking held it stayed
  -- "occupied". (It also stays clean - that guard is housekeeping's, FD-12.)
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-LEAVE', g, t, date '2026-08-24', date '2026-08-25', 2000, 'checked_in')
  returning id into leaving;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, leaving, r106, date '2026-08-24', date '2026-08-25', 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'FDH-LATER', g, t, date '2026-08-28', date '2026-08-30', 2000, 'confirmed')
  returning id into later;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, later, r106, date '2026-08-28', date '2026-08-30', 'arrival');

  update reservations set status = 'checked_out' where id = leaving;
  update room_assignments set released_at = now() where reservation_id = leaving;
  select occupancy_status into occ from rooms where id = r106;
  perform test.ok('one in-house rule','a room checked out of, held for next week: vacant',
    occ = 'vacant', 'got ' || occ);

  -- ---------- D21-37: a block is its own count, never Empty ------------------
  insert into room_blocks (hotel_id, room_id, from_date, to_date, reason)
  values (h, r107, date '2026-08-25', date '2026-08-25', 'out_of_order');
  select * into f from app.house_now(h) where room_id = r107;
  perform test.ok('one in-house rule','a room blocked tonight is out of order, not Empty',
    f.out_of_order and not f.empty and not f.in_house);

  -- ---------- the three counts, and the column, are the one rule -------------
  select count(*) into n from app.house_now(h) where in_house;
  perform test.ok('one in-house rule','In house: 102, 103 and 105', n = 3, n || ' rooms');
  select count(*) into n from app.house_now(h) where empty;
  perform test.ok('one in-house rule','Empty: 101, 104 and 106', n = 3, n || ' rooms');
  select count(*) into n from app.house_now(h) where out_of_order;
  perform test.ok('one in-house rule','Out of order: 107', n = 1, n || ' rooms');

  select count(*) into n
    from app.house_now(h) x join rooms rm on rm.id = x.room_id
   where (rm.occupancy_status = 'occupied') <> x.in_house;
  perform test.ok('one in-house rule','rooms.occupancy_status agrees with In house for every room',
    n = 0, n || ' disagree');

  -- ---------- and the fixture goes ----------------------------------------------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;

  select count(*) into n from hotels where code = 'FDH';
  perform test.ok('one in-house rule','the fixture does not outlive the test', n = 0, n || ' left behind');
end $$;
