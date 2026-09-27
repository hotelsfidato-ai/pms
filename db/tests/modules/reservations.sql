-- =============================================================================
-- RESERVATIONS — the module's own assertions
-- =============================================================================
-- One file per service (docs/SERVICE-FOLDERS-PLAN.md); run after suite.sql, in
-- the same session. Everything here builds its own property and removes it,
-- so it depends on nothing the suite left behind and leaves nothing for what
-- runs next.
-- =============================================================================


-- =============================================================================
-- A BOOKING SENT TWICE IS ONE BOOKING (091, RES-3)
-- =============================================================================
-- The API answers a repeat politely before it writes anything. This is the part
-- that holds when two copies race past that check: the database refuses the
-- second line 1, whoever sent it.
--
--   1. the same sender's reference, from the same channel, cannot make line 1
--      twice;
--   2. but the same reference from ANOTHER channel is a different booking;
--   3. one request's several rooms share a reference and differ by line;
--   4. the desk's bookings carry no reference and never collide;
--   5. a line number is meaningless without its reference, channel and
--      fingerprint, and is refused alone.
-- =============================================================================
do $$
declare
  h uuid; dlx uuid; g uuid; src_a uuid; src_b uuid; n int;
  base text := $b$insert into reservations
      (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
       agreed_rate, booking_source_id, ota_reference, ota_line, ota_fingerprint)
    values (%L, %L, %L, %L, date '2028-02-01', date '2028-02-03', 3000,
            %s, %s, %s, %s)$b$;
begin
  h := app.provision_property_unchecked('RSX','Repeat Booking Test','Nowhere');
  select id into dlx from room_types where hotel_id = h and code = 'DLX';
  insert into guests (full_name) values ('RES-3 fixture guest') returning id into g;

  select id into src_a from booking_sources where is_active order by created_at, id limit 1;
  select id into src_b from booking_sources where is_active and id <> src_a
   order by created_at, id limit 1;

  perform test.ok('repeat-booking','the fixture has a room type, a guest and two channels',
    dlx is not null and g is not null and src_a is not null and src_b is not null);

  -- ---------- 1 · the first copy lands ----------
  perform test.allows('repeat-booking','a sender''s booking is stored with its reference and line',
    format(base, h, 'RSX-1', g, dlx,
           quote_literal(src_a), quote_literal('OTA-777'), '1', quote_literal('fp-one')));

  -- ---------- the second copy's line 1 does not ----------
  perform test.raises('repeat-booking','the same reference from the same channel cannot make line 1 twice',
    format(base, h, 'RSX-2', g, dlx,
           quote_literal(src_a), quote_literal('OTA-777'), '1', quote_literal('fp-one')),
    '23505');

  -- ---------- 3 · one request, several rooms ----------
  perform test.allows('repeat-booking','the second room of the same request is line 2, and is allowed',
    format(base, h, 'RSX-3', g, dlx,
           quote_literal(src_a), quote_literal('OTA-777'), '2', quote_literal('fp-one')));

  -- ---------- 2 · another channel's number is another booking ----------
  perform test.allows('repeat-booking','the same reference from another channel is a different booking',
    format(base, h, 'RSX-4', g, dlx,
           quote_literal(src_b), quote_literal('OTA-777'), '1', quote_literal('fp-two')));

  -- ---------- 4 · the desk ----------
  perform test.allows('repeat-booking','a desk booking with no reference is allowed',
    format(base, h, 'RSX-5', g, dlx, quote_literal(src_a), 'null', 'null', 'null'));
  perform test.allows('repeat-booking','and a second one does not collide with it',
    format(base, h, 'RSX-6', g, dlx, quote_literal(src_a), 'null', 'null', 'null'));

  -- ---------- 5 · a line number alone ----------
  perform test.raises('repeat-booking','a line number without a reference is refused',
    format(base, h, 'RSX-7', g, dlx,
           quote_literal(src_a), 'null', '1', quote_literal('fp-one')),
    '23514');
  perform test.raises('repeat-booking','a line number without a fingerprint is refused',
    format(base, h, 'RSX-8', g, dlx,
           quote_literal(src_a), quote_literal('OTA-778'), '1', 'null'),
    '23514');
  perform test.raises('repeat-booking','a line number without a channel is refused',
    format(base, h, 'RSX-9', g, dlx,
           'null', quote_literal('OTA-779'), '1', quote_literal('fp-one')),
    '23514');
  perform test.raises('repeat-booking','a blank reference is refused',
    format(base, h, 'RSX-10', g, dlx,
           quote_literal(src_a), quote_literal('   '), '1', quote_literal('fp-one')),
    '23514');
  perform test.raises('repeat-booking','line 0 is refused — lines count from 1',
    format(base, h, 'RSX-11', g, dlx,
           quote_literal(src_a), quote_literal('OTA-780'), '0', quote_literal('fp-one')),
    '23514');

  select count(*) into n from reservations where hotel_id = h;
  perform test.ok('repeat-booking','exactly the five allowed rows exist',
    n = 5, n || ' rows');

  -- ---------- and the fixture goes ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;

  select count(*) into n from hotels where code = 'RSX';
  perform test.ok('repeat-booking','the fixture does not outlive the test',
    n = 0 and not exists (select 1 from guests where id = g), n || ' left behind');
end $$;


-- =============================================================================
-- NEW BOOKING: THE DISCOUNT, THE TITLE AND WAITING (146; D27-35, D27-36)
-- =============================================================================
-- The API refuses each of these first, in words. These are the database's own
-- guards, tested here on their own with the API not standing in front of them
-- (MEMORY 318):
--
--   1. a discount by hand is at most the restaurant's cap (10) and has a reason;
--   2. more is only through a named promotion, and a promotion names a percent;
--   3. a promotion is worth more than 0% and at most 100%;
--   4. a title is one of the owner's four, or none;
--   5. a booking waiting for the hotel is owed no message - the confirmation
--      sweep and the desk's Send voucher both read app.guest_messages_due.
-- =============================================================================
do $$
declare
  h uuid; dlx uuid; g uuid; src uuid; promo uuid; waiting uuid; firm uuid; n int;
  base text := $b$insert into reservations
      (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
       agreed_rate, booking_source_id, discount_percent, discount_reason,
       room_promotion_id)
    values (%L, %L, %L, %L, current_date + 30, current_date + 32, 3000, %L,
            %s, %s, %s)$b$;
begin
  h := app.provision_property_unchecked('NBX','New Booking Test','Nowhere');
  select id into dlx from room_types where hotel_id = h and code = 'DLX';
  insert into guests (full_name, email) values ('NBX fixture guest', 'nbx@example.test')
    returning id into g;
  select id into src from booking_sources where is_active order by created_at, id limit 1;
  insert into room_promotions (hotel_id, name, percent) values (h, 'Owner''s guests', 25)
    returning id into promo;

  -- ---------- 1 · by hand ----------
  perform test.allows('new-booking','10% by hand with a reason is kept',
    format(base, h, 'NBX-1', g, dlx, src, '10', quote_literal('Returning family'), 'null'));
  perform test.raises('new-booking','a discount by hand with no reason is refused',
    format(base, h, 'NBX-2', g, dlx, src, '5', 'null', 'null'), '23514');
  perform test.raises('new-booking','a blank reason is no reason',
    format(base, h, 'NBX-3', g, dlx, src, '5', quote_literal('   '), 'null'), '23514');
  perform test.raises('new-booking','11% by hand, with a reason, is refused',
    format(base, h, 'NBX-4', g, dlx, src, '11', quote_literal('Asked nicely'), 'null'), '23514');
  perform test.raises('new-booking','a discount of 0% is refused',
    format(base, h, 'NBX-5', g, dlx, src, '0', quote_literal('None'), 'null'), '23514');

  -- ---------- 2 · a promotion ----------
  perform test.allows('new-booking','25% through a named promotion is kept, no reason needed',
    format(base, h, 'NBX-6', g, dlx, src, '25', 'null', quote_literal(promo)));
  perform test.raises('new-booking','a promotion with no percent is refused',
    format(base, h, 'NBX-7', g, dlx, src, 'null', 'null', quote_literal(promo)), '23514');
  perform test.allows('new-booking','no discount at all is the ordinary booking',
    format(base, h, 'NBX-8', g, dlx, src, 'null', 'null', 'null'));

  -- ---------- 3 · what a promotion may be worth ----------
  perform test.raises('new-booking','a promotion worth 0% is refused',
    format('insert into room_promotions (hotel_id, name, percent) values (%L, %L, 0)', h, 'Zero'),
    '23514');
  perform test.raises('new-booking','a promotion worth 101% is refused',
    format('insert into room_promotions (hotel_id, name, percent) values (%L, %L, 101)', h, 'Refund'),
    '23514');

  -- ---------- 4 · the title ----------
  perform test.raises('new-booking','a title not on the owner''s list is refused',
    format('update guests set title = %L where id = %L', 'Sir', g), '23514');
  perform test.allows('new-booking','Dr is a title',
    format('update guests set title = %L where id = %L', 'Dr', g));

  -- ---------- 5 · waiting for the hotel sends nothing ----------
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, booking_source_id, status)
  values (h, 'NBX-W', g, dlx, current_date + 40, current_date + 41, 3000, src, 'tentative')
  returning id into waiting;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, booking_source_id, status)
  values (h, 'NBX-C', g, dlx, current_date + 50, current_date + 51, 3000, src, 'confirmed')
  returning id into firm;
  perform test.ok('new-booking','a booking waiting for the hotel is owed no confirmation',
    not exists (select 1 from app.guest_messages_due(null, 3, '10:00', '09:00', '21:00', h)
                 where reservation_id = waiting));
  perform test.ok('new-booking','the same booking confirmed is owed one - the check can see one',
    exists (select 1 from app.guest_messages_due(null, 3, '10:00', '09:00', '21:00', h)
             where reservation_id = firm and kind = 'booking-confirmation'));

  -- ---------- and the fixture goes ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;

  select count(*) into n from hotels where code = 'NBX';
  perform test.ok('new-booking','the fixture does not outlive the test',
    n = 0 and not exists (select 1 from guests where id = g), n || ' left behind');
end $$;
