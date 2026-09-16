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
