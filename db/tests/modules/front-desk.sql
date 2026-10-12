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


-- =============================================================================
-- FD-9 · the room a guest moved out of is dirty (the owner's D23-12)
-- =============================================================================
-- 054 shortens the old room's assignment instead of releasing it, and 070 only
-- dirtied on a release, so the room left behind stayed clean for the next
-- guest. Called through app.move_room and app.exchange_rooms directly, as the
-- routes call them (MEMORY 318). Its own property, on 25 August 2026.
do $$
declare
  h uuid; t uuid; g uuid;
  stays uuid[] := '{}'; s uuid;
  hk text; n int;
  room_of text[] := array['201','203','205','206','207'];
  i int;
begin
  h := app.provision_property_unchecked('FDM','Moved Out Test','Nowhere');
  update hotels set business_date = date '2026-08-25' where id = h;
  perform app.bulk_create_rooms(h, 'STD', 2::smallint, 201, 208);
  select id into t from room_types where hotel_id = h and code = 'STD';
  update rooms set housekeeping_status = 'clean' where hotel_id = h;
  insert into guests (full_name) values ('Moved-out fixture guest') returning id into g;

  -- Five stays, each in its room since the 23rd: four checked in, and the one
  -- in 207 confirmed and never arrived.
  for i in 1..5 loop
    insert into reservations (hotel_id, reference, guest_id, room_type_id,
                              check_in, check_out, agreed_rate, status)
    values (h, 'FDM-' || room_of[i], g, t, date '2026-08-23', date '2026-08-28', 2000,
            case when room_of[i] = '207' then 'confirmed' else 'checked_in' end)
    returning id into s;
    insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
    select h, s, id, date '2026-08-23', date '2026-08-28', 'arrival'
      from rooms where hotel_id = h and number = room_of[i];
    stays := stays || s;
  end loop;

  -- Moved tonight: 201 is left behind, slept in.
  perform app.move_room(h, stays[1], (select id from rooms where hotel_id = h and number = '202'),
                        date '2026-08-25', 'move', null);
  select housekeeping_status into hk from rooms where hotel_id = h and number = '201';
  perform test.ok('moved-out room','a guest moved out tonight leaves the old room dirty (FD-9)',
    hk = 'dirty', 'got ' || hk);
  select housekeeping_status into hk from rooms where hotel_id = h and number = '202';
  perform test.ok('moved-out room','and the room they moved into is left as it was',
    hk = 'clean', 'got ' || hk);

  -- Moved from tomorrow: they sleep in 203 tonight, so it is not dirty yet.
  perform app.move_room(h, stays[2], (select id from rooms where hotel_id = h and number = '204'),
                        date '2026-08-26', 'move', null);
  select housekeeping_status into hk from rooms where hotel_id = h and number = '203';
  perform test.ok('moved-out room','a move dated tomorrow leaves tonight''s room clean',
    hk = 'clean', 'got ' || hk);

  -- Two guests swap: somebody is in both rooms, so neither is dirtied under them.
  perform app.exchange_rooms(h, stays[3], stays[4], date '2026-08-25', 'swap', null);
  select count(*) into n from rooms
   where hotel_id = h and number in ('205','206') and housekeeping_status = 'clean';
  perform test.ok('moved-out room','an exchange dirties neither room - both have a guest in them',
    n = 2, n || ' of 2 clean');

  -- Nobody ever went into 207 (FD-10's question): moving the booking dirties nothing.
  perform app.move_room(h, stays[5], (select id from rooms where hotel_id = h and number = '208'),
                        date '2026-08-25', 'move', null);
  select housekeeping_status into hk from rooms where hotel_id = h and number = '207';
  perform test.ok('moved-out room','a booking that never arrived, moved, leaves its room clean',
    hk = 'clean', 'got ' || hk);

  -- The night audit closes the 25th, the way it does: a run opened, then
  -- completed. The move dated the 26th now takes effect, so 203 - slept in
  -- until tonight - is dirty; 204, the room moved into, is not (the owner,
  -- 24 September).
  insert into night_audit_runs (hotel_id, business_date, status)
  values (h, date '2026-08-25', 'running');
  select housekeeping_status into hk from rooms where hotel_id = h and number = '203';
  perform test.ok('moved-out room','a run still running moves no date and dirties nothing',
    hk = 'clean', 'got ' || hk);
  update night_audit_runs set status = 'completed', completed_at = now()
   where hotel_id = h and business_date = date '2026-08-25';
  select housekeeping_status into hk from rooms where hotel_id = h and number = '203';
  perform test.ok('moved-out room','a move dated tomorrow dirties the old room when the day closes',
    hk = 'dirty', 'got ' || hk);
  select count(*) into n from rooms
   where hotel_id = h and number in ('204','205','206','207','208')
     and housekeeping_status = 'clean';
  perform test.ok('moved-out room','and no other room: moved into, swapped, never entered',
    n = 5, n || ' of 5 clean');

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;

  select count(*) into n from hotels where code = 'FDM';
  perform test.ok('moved-out room','the fixture does not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- CASH FROM ONE GUEST (the owner's D25-40; Income-tax Act 2025 s.186)
-- =============================================================================
-- Refers to its migration by what it does - "cash limit and PAN". What only
-- the database can promise: app.cash_taken counts "stay, group and day" (the
-- owner, 26 September) - this stay, its group's stays whoever the guest, and
-- this guest's other stays on the same business day - and leaves out card,
-- another day, a payment reversed as a mistake, and never subtracts a refund.
-- Since the owner's D27-307 (5), "its group" includes the group's master bill
-- (migration "cash with the master bill").
-- The routes' half is api/test/modules/front-desk/cashLimit.test.ts.
-- =============================================================================
do $$
declare
  h uuid; t uuid; g1 uuid; g2 uuid; grp uuid; mf uuid;
  a uuid; b uuid; c uuid; d uuid; e uuid; pid bigint; n int;
begin
  h := app.provision_property_unchecked('FDC','Cash Limit Test','Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 102);
  select id into t from room_types where hotel_id = h and code = 'STD';
  insert into guests (full_name) values ('Cash fixture guest one') returning id into g1;
  insert into guests (full_name) values ('Cash fixture guest two') returning id into g2;
  insert into reservation_groups (name, lead_hotel_id) values ('Cash fixture wedding', h)
  returning id into grp;

  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status, group_id)
  values (h, 'FDC-A', g1, t, '2027-02-01', '2027-02-02', 1000, 'confirmed', grp) returning id into a;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status, group_id)
  values (h, 'FDC-B', g2, t, '2027-02-01', '2027-02-02', 1000, 'confirmed', grp) returning id into b;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status)
  values (h, 'FDC-C', g1, t, '2027-02-01', '2027-02-02', 1000, 'confirmed') returning id into c;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status)
  values (h, 'FDC-D', g1, t, '2027-01-15', '2027-01-16', 1000, 'confirmed') returning id into d;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status)
  values (h, 'FDC-E', g2, t, '2027-02-01', '2027-02-02', 1000, 'confirmed') returning id into e;
  insert into folios (hotel_id, reservation_id)
  select h, x from unnest(array[a, b, c, d, e]) x;

  -- A payment as the desk writes one: a negative posting and its payments row.
  create temporary table cash_fixture (stay uuid, day date, method text, amount numeric) on commit drop;
  insert into cash_fixture values
    (a, '2027-02-01', 'cash', 50000),      -- this stay
    (b, '2027-02-01', 'cash', 30000),      -- the group, another guest
    (c, '2027-02-01', 'cash', 20000),      -- the same guest, another stay, the same day
    (d, '2027-01-15', 'cash', 40000),      -- the same guest, another day
    (a, '2027-02-01', 'card', 70000);      -- not cash
  for pid in
    with made as (
      insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
      select h, f.id, x.day, 'payment', 'Cash fixture ' || x.method, -x.amount
        from cash_fixture x join folios f on f.reservation_id = x.stay
      returning id, folio_id, amount, description)
    insert into payments (hotel_id, posting_id, method, amount)
    select h, m.id, split_part(m.description, ' ', 3), -m.amount from made m
    returning posting_id
  loop null; end loop;

  -- A cash payment reversed as a mistake: never received.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
  select h, f.id, '2027-02-01', 'payment', 'Cash fixture mistake', -10000
    from folios f where f.reservation_id = a returning id into pid;
  insert into payments (hotel_id, posting_id, method, amount) values (h, pid, 'cash', 10000);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, reverses_id)
  select h, f.id, '2027-02-01', 'payment', 'Cash fixture mistake reversed', 10000, pid
    from folios f where f.reservation_id = a;
  -- A refund: money going back does not undo money received.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
  select h, f.id, '2027-02-01', 'refund', 'Cash fixture refund', 5000
    from folios f where f.reservation_id = a;

  perform test.ok('cash limit', 'counts the stay, its group and the guest''s other stay that day',
    app.cash_taken(a, '2027-02-01') = 100000, app.cash_taken(a, '2027-02-01')::text);
  perform test.ok('cash limit', 'a group guest''s own stay counts the group they were in that day',
    app.cash_taken(e, '2027-02-01') = 30000, app.cash_taken(e, '2027-02-01')::text);
  perform test.ok('cash limit', 'another day counts only its own stay',
    app.cash_taken(d, '2027-01-15') = 40000, app.cash_taken(d, '2027-01-15')::text);

  perform test.raises('cash limit', 'a PAN is kept only in its own shape',
    format($q$update payments set pan = 'abcde1234f' where posting_id = %s$q$, pid), '23514');

  -- THE GROUP'S MASTER BILL (the owner's D27-307 (5)): the host's cash is the
  -- same event, so every room of the group counts it, on any day, as it
  -- counts the group's rooms. The master's own count already counted the
  -- rooms (D27-305); now it is both ways. A stay in no group is unchanged.
  insert into folios (hotel_id, group_id) values (h, grp) returning id into mf;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
  values (h, mf, '2027-01-20', 'payment', 'Cash fixture master bill', -25000) returning id into pid;
  insert into payments (hotel_id, posting_id, method, amount) values (h, pid, 'cash', 25000);
  perform test.ok('cash limit', 'a room counts the cash taken on its group''s master bill',
    app.cash_taken(a, '2027-02-01') = 125000, app.cash_taken(a, '2027-02-01')::text);
  perform test.ok('cash limit', 'so does the group''s room in another guest''s name',
    app.cash_taken(b, '2027-02-01') = 105000, app.cash_taken(b, '2027-02-01')::text);
  perform test.ok('cash limit', 'a stay in no group counts no master bill, its figures unchanged',
    app.cash_taken(c, '2027-02-01') = 70000 and app.cash_taken(e, '2027-02-01') = 30000
      and app.cash_taken(d, '2027-01-15') = 40000,
    app.cash_taken(c, '2027-02-01') || ' / ' || app.cash_taken(e, '2027-02-01')
      || ' / ' || app.cash_taken(d, '2027-01-15'));

  -- The master bill holds the group until the hotel's delete takes the bill.
  update reservations set group_id = null where group_id = grp;
  update reservation_groups set lead_hotel_id = null where id = grp;
  alter table folio_postings disable trigger folio_postings_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  delete from reservation_groups where id = grp;
  alter table hotels enable trigger hotels_no_delete;
  alter table folio_postings enable trigger folio_postings_append_only;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (g1, g2);
  alter table guests enable trigger guests_no_delete;

  select count(*) into n from hotels where code = 'FDC';
  perform test.ok('cash limit', 'the fixture does not outlive the test', n = 0, n || ' left behind');
end $$;
