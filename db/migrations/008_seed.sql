-- =============================================================================
-- 008_seed.sql — TEMPLATE. Replace the placeholder rows with your real seven.
-- =============================================================================
-- The hotel rows below are PLACEHOLDERS with invented names. Replace every one
-- with your actual property before running this anywhere real — codes, names,
-- cities and GSTINs all need to be correct, because the GSTIN prints on every
-- invoice that property issues.
--
-- Seed with REAL rooms and REAL room types. The CRS proved this: building
-- against real property data catches modelling errors that made-up data hides
-- (the property with 3 room types and one accessible room on the ground floor
-- is where your assumptions break, and you want that on day one).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- The seven properties.  <<< REPLACE ALL OF THIS >>>
-- -----------------------------------------------------------------------------
insert into hotels (code, name, city, state, gstin) values
  ('FH01', 'REPLACE — property 1 name', 'REPLACE — city', 'REPLACE', null),
  ('FH02', 'REPLACE — property 2 name', 'REPLACE — city', 'REPLACE', null),
  ('FH03', 'REPLACE — property 3 name', 'REPLACE — city', 'REPLACE', null),
  ('FH04', 'REPLACE — property 4 name', 'REPLACE — city', 'REPLACE', null),
  ('FH05', 'REPLACE — property 5 name', 'REPLACE — city', 'REPLACE', null),
  ('FH06', 'REPLACE — property 6 name', 'REPLACE — city', 'REPLACE', null),
  ('FH07', 'REPLACE — property 7 name', 'REPLACE — city', 'REPLACE', null)
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- The first user. Cannot be created from inside the app — same bootstrap
-- problem the CRS has, and for the same reason: the thing that creates users
-- requires a user.
-- -----------------------------------------------------------------------------
insert into staff (email, full_name, is_group_admin) values
  ('REPLACE@fidato.in', 'REPLACE — your name', true)
on conflict (email) do nothing;


-- -----------------------------------------------------------------------------
-- Room types, per property. Shown for FH01 only — repeat per hotel.
-- -----------------------------------------------------------------------------
insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy, base_rate, sort_order)
select h.id, t.code, t.name, t.base_occ, t.max_occ, t.rate, t.sort
  from hotels h
 cross join (values
    ('STD', 'Standard',    2, 3,  3500.00, 1),
    ('DLX', 'Deluxe',      2, 3,  4800.00, 2),
    ('STE', 'Suite',       2, 4,  7500.00, 3)
 ) as t(code, name, base_occ, max_occ, rate, sort)
 where h.code = 'FH01'
on conflict (hotel_id, code) do nothing;


-- -----------------------------------------------------------------------------
-- Rooms. Generates 101-110 as Standard on floor 1 for FH01.
-- Replace with your real room list — this is only here so you have something
-- to click on the first time you run the app.
-- -----------------------------------------------------------------------------
insert into rooms (hotel_id, room_type_id, number, floor)
select rt.hotel_id, rt.id, (100 + n)::text, 1
  from room_types rt
  join hotels h on h.id = rt.hotel_id
 cross join generate_series(1, 10) as n
 where h.code = 'FH01' and rt.code = 'STD'
on conflict (hotel_id, number) do nothing;

commit;


-- =============================================================================
-- SMOKE TEST — prove the whole thing works end to end.
-- =============================================================================
-- Run this by hand after seeding. If it passes, your tenancy, RLS, ledger and
-- double-booking guard are all wired correctly.
--
--   -- become the admin you seeded above
--   set local app.user_id = (select id from staff where email = 'REPLACE@fidato.in');
--
--   -- 1. the gate returns your hotels (7, because is_group_admin)
--   select count(*) from app.auth_hotel_ids();
--
--   -- 2. create a guest, a booking and a folio
--   with g as (
--     insert into guests (full_name, phone) values ('Test Guest', '9000000000')
--     returning id
--   ), h as (
--     select id from hotels where code = 'FH01'
--   ), r as (
--     insert into reservations (hotel_id, reference, guest_id, room_type_id,
--                               room_id, check_in, check_out, agreed_rate, status)
--     select h.id,
--            app.next_reference(h.id),
--            g.id,
--            (select id from room_types where hotel_id = h.id and code = 'STD'),
--            (select id from rooms      where hotel_id = h.id and number = '101'),
--            current_date, current_date + 2, 3500.00, 'checked_in'
--       from g, h
--     returning id, hotel_id
--   )
--   insert into folios (hotel_id, reservation_id)
--   select hotel_id, id from r returning id;
--
--   -- 3. post two nights of room rent at 12% GST
--   insert into folio_postings (hotel_id, folio_id, business_date, category,
--                               description, amount, tax_rate, tax_amount)
--   select f.hotel_id, f.id, current_date, 'room',
--          'Room 101 - night 1', 3500.00, 12.0, 420.00
--     from folios f order by f.opened_at desc limit 1;
--
--   -- 4. balance should be 3920.00
--   select app.folio_balance(id) from folios order by opened_at desc limit 1;
--
--   -- 5. the ledger must refuse to be edited
--   update folio_postings set amount = 1 where id = (select max(id) from folio_postings);
--   --> ERROR: folio_postings is append-only. Post a reversing entry instead...
--
--   -- 6. the same room on the same nights must be refused
--   insert into reservations (hotel_id, reference, guest_id, room_type_id, room_id,
--                             check_in, check_out, agreed_rate, status)
--   select hotel_id, app.next_reference(hotel_id), guest_id, room_type_id, room_id,
--          check_in, check_out, agreed_rate, 'confirmed'
--     from reservations order by created_at desc limit 1;
--   --> ERROR: conflicting key value violates exclusion constraint
--             "reservations_no_double_booking"
--
-- Steps 5 and 6 failing loudly is the point. That is the database refusing to
-- let you corrupt a guest's bill or sell the same room twice — protection you
-- get on every future screen without writing another line for it.
-- =============================================================================
