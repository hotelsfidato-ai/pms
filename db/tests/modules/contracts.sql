-- =============================================================================
-- CONTRACTS — a company's record and the rates it agreed (D27-178, D27-184)
-- =============================================================================
-- Refers to its migration by what it does ("contracts"), never by its number.
-- What only the database can promise; the routes are proved in the API suite:
--   * a contract prices a night: single for one guest, double for two, the
--     calendar's extra person beyond (C-2); or the day's price less its %
--     (C-1); the calendar's own price where it has no figure (C-4)
--   * an unpriced part is named, never a partial total or a 0
--   * one contract in force per company, hotel and date (C-3)
--   * no contract price of 0, no credit figure of 0
--   * an administrator may change a company (013 let only the owner and the
--     GM); reception may add one but change none, and keeps no contract (C-6, C-7)
-- Builds one property of its own and removes it.
-- =============================================================================
-- As the group administrator, so the file also runs on its own.
select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

do $$
declare
  h uuid; dlx uuid; clerk uuid; adm uuid; ag uuid; corp uuid; k uuid; k2 uuid;
  p record; failed boolean; n int; v text;
begin
  h := app.provision_property_unchecked('CTR', 'Contracts Test', 'Nowhere');
  select id into dlx from room_types where hotel_id = h and code = 'DLX';

  insert into staff (email, full_name) values ('ctr-clerk@fidato.in', 'CTR Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('ctr-admin@fidato.in', 'CTR Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  delete from staff_hotels where staff_id in (clerk, adm);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (adm, h, 'admin');

  -- The calendar: 2,000 a night for two, room only; an extra adult 500; no
  -- extra child's price and nothing on CP.
  insert into rates (hotel_id, room_type_id, meal_plan, price, covers_persons,
                     extra_adult, valid_from, created_by)
  values (h, dlx, 'EP', 2000, 2, 500, date '2026-01-01', adm);

  insert into companies (name, kind) values ('CTR Test Agent', 'travel_agent') returning id into ag;
  insert into companies (name) values ('CTR Test Corporate') returning id into corp;

  -- ---------- who keeps them (C-6, C-7) --------------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing)
    values (h, ag, 'By the desk', date '2026-04-01', date '2026-04-30', 'discount');
  exception when insufficient_privilege then failed := true;
  end;
  update companies set city = 'By the desk' where id = ag;
  reset role;
  perform test.ok('contracts', 'reception keeps no contract', failed, 'the clerk''s contract went in');
  select coalesce(city, '-') into v from companies where id = ag;
  perform test.ok('contracts', 'and changes no company', v = '-', 'city is now ' || v);

  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  update companies set city = 'Pune' where id = ag;
  insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing, commission_pct)
  values (h, ag, 'CTR 2026-27', date '2026-04-01', date '2027-03-31', 'rates', 10)
  returning id into k;
  insert into contract_rates (hotel_id, contract_id, room_type_id, meal_plan, price_single, price_double)
  values (h, k, dlx, 'EP', 1500, 1800);
  insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing, discount_percent)
  values (h, corp, 'CTR Corporate', date '2026-04-01', date '2027-03-31', 'discount', 10)
  returning id into k2;
  reset role;
  select city into v from companies where id = ag;
  perform test.ok('contracts', 'an administrator changes a company (013 refused them)',
    v = 'Pune', coalesce(v, '<null>'));

  -- ---------- fixed rates (C-2) ----------------------------------------------
  select * into p from app.contract_price(k, dlx, 'EP', date '2026-12-14', 1, 0);
  perform test.ok('contracts', 'one guest pays the single rate',
    p.total = 1500 and p.from_contract, p.total || ' ' || p.from_contract);
  select * into p from app.contract_price(k, dlx, 'EP', date '2026-12-14', 1, 1);
  perform test.ok('contracts', 'two guests, a child among them, pay the double',
    p.total = 1800, coalesce(p.total::text, p.unpriced));
  select * into p from app.contract_price(k, dlx, 'EP', date '2026-12-14', 3, 0);
  perform test.ok('contracts', 'a third adult pays the calendar''s extra adult on top',
    p.total = 2300, coalesce(p.total::text, p.unpriced));
  select * into p from app.contract_price(k, dlx, 'EP', date '2026-12-14', 2, 1);
  perform test.ok('contracts', 'an extra child with no price is named, the total null, not 0',
    p.total is null and p.unpriced = 'the extra child', coalesce(p.total::text, p.unpriced));

  -- ---------- no figure: the calendar's price, and it says so (C-4) ----------
  update contract_rates set price_single = null where contract_id = k;
  select * into p from app.contract_price(k, dlx, 'EP', date '2026-12-14', 1, 0);
  perform test.ok('contracts', 'a figure not agreed takes the day''s price, from_contract false',
    p.total = 2000 and not p.from_contract, p.total || ' ' || p.from_contract);
  select * into p from app.contract_price(k, dlx, 'CP', date '2026-12-14', 2, 0);
  perform test.ok('contracts', 'and an unpriced calendar stays unpriced',
    p.total is null and p.unpriced is not null and not p.from_contract);

  -- ---------- a discount off the day's rate (C-1) ----------------------------
  select * into p from app.contract_price(k2, dlx, 'EP', date '2026-12-14', 3, 0);
  perform test.ok('contracts', 'the day''s price less the contract''s %, extra persons included',
    p.total = 2250 and p.from_contract, coalesce(p.total::text, p.unpriced));

  -- ---------- the one in force (C-3) -----------------------------------------
  select count(*) into n from app.contract_in_force(ag, h, date '2026-03-31');
  perform test.ok('contracts', 'nothing is in force before the contract starts', n = 0);
  select count(*) into n from app.contract_in_force(ag, h, date '2027-03-31')
   where id = k and commission_pct = 10;
  perform test.ok('contracts', 'and it is in force on its last day, with its commission', n = 1);

  failed := false;
  begin
    insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing, discount_percent)
    values (h, ag, 'Overlapping', date '2027-03-01', date '2027-06-30', 'discount', 5);
  exception when exclusion_violation then failed := true;
  end;
  perform test.ok('contracts', 'a second contract over the same dates is refused', failed);

  -- ---------- no 0 (the owner: no default prices) -----------------------------
  failed := false;
  begin
    update contract_rates set price_double = 0 where contract_id = k;
  exception when check_violation then failed := true;
  end;
  perform test.ok('contracts', 'a contract price of 0 is refused', failed);
  failed := false;
  begin
    update companies set credit_limit = 0 where id = ag;
  exception when check_violation then failed := true;
  end;
  perform test.ok('contracts', 'a credit limit of 0 is refused: not set is NULL', failed);

  -- ---------- clean up --------------------------------------------------------
  delete from contract_rates where hotel_id = h;
  delete from contracts where hotel_id = h;
  delete from companies where id in (ag, corp);
  delete from rates where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id = h;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  update staff set is_active = false where id in (clerk, adm);

  select count(*) into n from hotels where code = 'CTR';
  perform test.ok('contracts', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

-- =============================================================================
-- ALLOTMENTS — rooms held under a contract (D27-383 item 8, "allotments")
-- =============================================================================
-- What only the database can promise; the refusals in words (never an
-- overbooking, nights inside the contract, the release still ahead, a pickup
-- past what is held) are api/test/modules/contracts/allotments.test.ts:
--   * availability is less what is held; a held room is neither occupied nor
--     sold; a booking from the allotment moves availability once, not twice
--   * the release: nights within their release days go back on sale, the
--     rooms nobody booked recorded once - a second run releases nothing
--   * reception holds no allotment; no allotment of 0 rooms
-- Builds one property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; dlx uuid; clerk uuid; co uuid; k uuid; a uuid; g uuid; r uuid;
  failed boolean; n int; v int; g0 record; g1 record;
begin
  h := app.provision_property_unchecked('ALT', 'Allotment Test', 'Nowhere');
  update hotels set business_date = date '2030-01-01' where id = h;
  perform app.bulk_create_rooms(h, 'DLX', 2::smallint, 201, 205);
  select id into dlx from room_types where hotel_id = h and code = 'DLX';
  insert into staff (email, full_name) values ('alt-clerk@fidato.in', 'ALT Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk');
  insert into companies (name, kind) values ('ALT Test Agent', 'travel_agent') returning id into co;
  insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing, discount_percent)
  values (h, co, 'ALT 2030', date '2030-01-01', date '2030-12-31', 'discount', 10) returning id into k;
  insert into guests (full_name) values ('ALT fixture guest') returning id into g;

  select * into g0 from app.inventory_grid(h, date '2030-01-10', date '2030-01-10') where room_type_id = dlx;

  -- 3 rooms on the nights of 10, 11 and 12 Jan, released 2 days before each.
  insert into allotments (hotel_id, contract_id, room_type_id, first_night, last_night, rooms, release_days)
  values (h, k, dlx, date '2030-01-10', date '2030-01-12', 3, 2) returning id into a;

  select * into g1 from app.inventory_grid(h, date '2030-01-10', date '2030-01-10') where room_type_id = dlx;
  perform test.ok('allotments', 'availability is less the rooms held',
    g1.available = g0.available - 3, g0.available || ' -> ' || g1.available);
  perform test.ok('allotments', 'a held room is neither occupied nor sold',
    g1.occupied = g0.occupied and g1.sold = g0.sold);
  select available into v from app.inventory_grid(h, date '2030-01-13', date '2030-01-13') where room_type_id = dlx;
  perform test.ok('allotments', 'the night after the last is not held', v = g0.available, v::text);

  -- A booking from it, the nights of 10 and 11.
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status, allotment_id)
  values (h, 'ALT-1', g, dlx, date '2030-01-10', date '2030-01-12', 2000, 'confirmed', a)
  returning id into r;
  select * into g1 from app.inventory_grid(h, date '2030-01-10', date '2030-01-10') where room_type_id = dlx;
  perform test.ok('allotments', 'a booking from it moves availability once, not twice',
    g1.available = g0.available - 3 and g1.occupied = g0.occupied + 1, g1.available::text);
  select held into v from app.allotment_held(h, date '2030-01-10', date '2030-01-10') where allotment_id = a;
  perform test.ok('allotments', 'and the allotment holds one room fewer', v = 2, v::text);
  select held into v from app.allotment_held(h, date '2030-01-12', date '2030-01-12') where allotment_id = a;
  perform test.ok('allotments', 'a night it does not cover keeps all three', v = 3, v::text);

  -- ---------- the release ------------------------------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select app.release_allotments(h, date '2030-01-07') into v;
  reset role;
  perform test.ok('allotments', 'the audit of 7 Jan releases nothing: 10 Jan is 3 days off', v = 0, v::text);
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select app.release_allotments(h, date '2030-01-08') into v;
  reset role;
  perform test.ok('allotments', 'the audit of 8 Jan puts the 2 rooms nobody booked on 10 Jan back on sale',
    v = 2, v::text);
  select count(*) into n from allotment_releases where allotment_id = a;
  perform test.ok('allotments', 'one night is recorded released, by whoever closed the day',
    n = 1 and (select released_by from allotment_releases where allotment_id = a) = clerk, n::text);
  select available into v from app.inventory_grid(h, date '2030-01-10', date '2030-01-10') where room_type_id = dlx;
  perform test.ok('allotments', 'a released night is on sale again', v = g0.available - 1, v::text);

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select app.release_allotments(h, date '2030-01-08') into v;
  reset role;
  select count(*) into n from allotment_releases where allotment_id = a;
  perform test.ok('allotments', 'the release is idempotent: the same day again releases nothing',
    v = 0 and n = 1, v || ' rooms, ' || n || ' rows');

  select app.release_allotments(h, date '2030-01-10') into v;
  select count(*) into n from allotment_releases where allotment_id = a;
  perform test.ok('allotments', 'the audit of 10 Jan releases 11 and 12 Jan: 2 and 3 rooms',
    v = 5 and n = 3, v || ' rooms, ' || n || ' rows');

  -- ---------- who, and what the table refuses ----------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    insert into allotments (hotel_id, contract_id, room_type_id, first_night, last_night, rooms, release_days)
    values (h, k, dlx, date '2030-02-01', date '2030-02-02', 1, 1);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('allotments', 'reception holds no allotment', failed);
  failed := false;
  begin
    insert into allotments (hotel_id, contract_id, room_type_id, first_night, last_night, rooms, release_days)
    values (h, k, dlx, date '2030-02-01', date '2030-02-02', 0, 1);
  exception when check_violation then failed := true;
  end;
  perform test.ok('allotments', 'an allotment of 0 rooms is refused', failed);

  -- ---------- clean up --------------------------------------------------------
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id = h;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from companies where id = co;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;
  update staff set is_active = false where id = clerk;
  select count(*) into n from hotels where code = 'ALT';
  perform test.ok('allotments', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
