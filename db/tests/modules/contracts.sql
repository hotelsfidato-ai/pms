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
