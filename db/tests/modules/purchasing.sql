-- =============================================================================
-- PURCHASING — a request, an approval, an order, a delivery (phase 2C)
-- =============================================================================
-- Refers to its migration by what it does — "purchasing" — never by its number
-- (docs/STOCK-AND-EQUIPMENT-PLAN.md § 7).
--
-- Builds its own property and removes it. Runs as the superuser, like every
-- file here; what the APPLICATION may do is checked through its grants, and
-- isolation through FORCE.
--
-- ⚠ THE REFUSALS ARE THE POINT. A file that only proved an order can be sent
-- passes with no guard at all. What is proved here is what the DATABASE stops,
-- because those are the rules another endpoint cannot walk around: who may
-- raise one (D18-2), that an unapproved order cannot go out (D18-4), that one
-- with a line nobody priced cannot go out (the owner's oldest rule), and that
-- a delivery cannot be received against an order never sent.
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  boss uuid; gm uuid; keeper uuid; cook uuid; clerk uuid;
  store uuid; kitchen uuid; lobby uuid; store_other uuid;
  sup uuid; sup_other uuid;
  rice uuid; oil uuid; rice_other uuid;
  req uuid; req2 uuid; line_rice uuid; line_oil uuid;
  ap uuid; n int; v text; amount numeric;
begin
  -- ---------- a property; the rules arrive with it -----------------------------
  h     := app.provision_property_unchecked('PUR','Purchasing Test','Nowhere');
  other := app.provision_property_unchecked('PUQ','Purchasing Other','Nowhere');

  insert into staff (email, full_name, is_group_admin) values ('pu-boss@fidato.in','Purchasing Boss', true)
  on conflict (email) do update set is_active = true returning id into boss;
  insert into staff (email, full_name) values ('pu-gm@fidato.in','Purchasing GM')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('pu-keeper@fidato.in','Purchasing Keeper')
  on conflict (email) do update set is_active = true returning id into keeper;
  insert into staff (email, full_name) values ('pu-cook@fidato.in','Purchasing Cook')
  on conflict (email) do update set is_active = true returning id into cook;
  insert into staff (email, full_name) values ('pu-clerk@fidato.in','Purchasing Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id in (boss, gm, keeper, cook, clerk);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (gm, h, 'gm'), (keeper, h, 'stores'), (cook, h, 'kitchen_manager'),
    (clerk, h, 'front_desk');

  -- Main / Kitchen / Bar arrive with every property (104, D17-3).
  select id into store   from locations where hotel_id = h and name = 'Main store';
  select id into kitchen from locations where hotel_id = h and name = 'Kitchen store';
  select id into store_other from locations where hotel_id = other and name = 'Main store';
  insert into locations (hotel_id, name, kind) values (h, 'Lobby', 'public_area') returning id into lobby;
  insert into suppliers (hotel_id, name, gstin) values (h, 'Akkalkot Traders', '27AAGCF5655F1ZI') returning id into sup;
  insert into suppliers (hotel_id, name) values (other, 'Somebody Else') returning id into sup_other;

  insert into stock_items (hotel_id, name, unit) values (h, 'Basmati rice', 'kg') returning id into rice;
  insert into stock_items (hotel_id, name, unit) values (h, 'Sunflower oil', 'litre') returning id into oil;
  insert into stock_items (hotel_id, name, unit) values (other, 'Basmati rice', 'kg') returning id into rice_other;

  perform set_config('app.user_id', keeper::text, true);

  -- ---------- the owner's two rules arrived with the property ------------------
  select count(*) into n from approval_rules
   where hotel_id = h and kind = 'purchase' and approver_role = 'gm'
     and over_amount is null and is_active;
  perform test.ok('purchasing','a new property sends a purchase to the GM, at any amount (D18-4)',
    n = 1, n || ' rules');

  select count(*) into n from purchase_requesters where hotel_id = h and is_active;
  perform test.ok('purchasing','a new property starts with four roles able to raise one (D18-2)',
    n = 4, n || ' roles');
  select string_agg(role, ',' order by role) into v
    from purchase_requesters where hotel_id = h and is_active;
  perform test.ok('purchasing','and they are the Inventory Manager, the GM, the owner and an administrator',
    v = 'admin,gm,owner,stores', v);

  -- ---------- the setting IS the answer (D18-2) --------------------------------
  perform test.ok('purchasing','the Inventory Manager may raise one',
    app.may_raise_purchase(h), 'refused');

  perform set_config('app.user_id', cook::text, true);
  perform test.ok('purchasing','the kitchen manager may NOT, until the owner switches it on',
    not app.may_raise_purchase(h), 'allowed');

  insert into purchase_requesters (hotel_id, role) values (h, 'kitchen_manager');
  perform test.ok('purchasing','and may the moment they do - no deploy',
    app.may_raise_purchase(h), 'still refused');

  update purchase_requesters set is_active = false where hotel_id = h and role = 'kitchen_manager';
  perform test.ok('purchasing','switching it off again refuses them',
    not app.may_raise_purchase(h), 'still allowed');

  perform set_config('app.user_id', clerk::text, true);
  perform test.ok('purchasing','reception may not raise one',
    not app.may_raise_purchase(h), 'allowed');

  perform set_config('app.user_id', boss::text, true);
  perform test.ok('purchasing','a group administrator may, as the owner',
    app.may_raise_purchase(h), 'refused');
  update purchase_requesters set is_active = false where hotel_id = h and role = 'owner';
  perform test.ok('purchasing','and is refused when the owner role is switched off - the setting is the authority',
    not app.may_raise_purchase(h), 'allowed');
  update purchase_requesters set is_active = true where hotel_id = h and role = 'owner';

  -- ---------- the reference ----------------------------------------------------
  perform test.ok('purchasing','the first order a property is offered is PO-PUR-<month>-0001',
    app.next_purchase_reference(h) like 'PO-PUR-____-0001', app.next_purchase_reference(h));

  -- ---------- raising one ------------------------------------------------------
  perform set_config('app.user_id', keeper::text, true);
  insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
  values (h, app.next_purchase_reference(h), store, 'The rice is down to two days', keeper)
  returning id into req;

  insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity)
  values (h, req, 1, rice, 50) returning id into line_rice;
  insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity, unit_price)
  values (h, req, 2, oil, 10, 140) returning id into line_oil;

  perform test.ok('purchasing','a request starts as requested',
    (select status from purchase_requests where id = req) = 'requested');

  -- ---------- a request without a reason is not a request ----------------------
  perform test.raises('purchasing','a request with a blank reason is refused',
    format('insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
            values (%L, %L, %L, %L, %L)', h, 'PO-PUR-9999-9999', store, '   ', keeper),
    '23514');

  -- ---------- a delivery goes to a STORE, at THIS property ---------------------
  perform test.raises('purchasing','an order cannot be delivered to the lobby',
    format('insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
            values (%L, %L, %L, %L, %L)', h, 'PO-PUR-9999-9998', lobby, 'Nowhere', keeper),
    '23514');
  perform test.raises('purchasing','nor into another property''s store',
    format('insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
            values (%L, %L, %L, %L, %L)', h, 'PO-PUR-9999-9997', store_other, 'Elsewhere', keeper),
    '23503');
  perform test.raises('purchasing','and another property''s item cannot go on this order',
    format('insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity)
            values (%L, %L, 9, %L, 1)', h, req, rice_other),
    '23503');
  perform test.raises('purchasing','nor another property''s supplier',
    format('update purchase_requests set supplier_id = %L where id = %L', sup_other, req),
    '23503');

  -- ---------- one line per item, and a line for nothing is not a line ----------
  perform test.raises('purchasing','the same item cannot be on one order twice',
    format('insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity)
            values (%L, %L, 8, %L, 5)', h, req, rice),
    '23505');
  perform test.raises('purchasing','a line for no quantity is refused',
    format('insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity)
            values (%L, %L, 7, %L, 0)', h, req, oil),
    '23514');

  -- ---------- the approval, through the ONE engine (076) -----------------------
  -- No amount: a line is unpriced, so there is no total to show anybody.
  select case when count(*) filter (where unit_price is null) > 0 then null
              else sum(quantity * unit_price) end
    into amount from purchase_request_lines where request_id = req;
  perform test.ok('purchasing','an order with an unpriced line has NO total - not a part of one',
    amount is null, amount::text);

  ap := app.request_approval(h, 'purchase', 'purchase_requests', req,
                             'The rice is down to two days', amount, keeper);
  perform test.ok('purchasing','raising one puts it in the approvals inbox', ap is not null);
  update purchase_requests set approval_id = ap where id = req;
  perform test.ok('purchasing','and it is the GM who is asked',
    (select approver_role from approvals where id = ap) = 'gm',
    (select approver_role from approvals where id = ap));

  -- ---------- IT CANNOT BE ORDERED YET -----------------------------------------
  perform test.raises('purchasing','an order that is not approved cannot be sent (D18-4)',
    format('select app.mark_purchase_ordered(%L, %L, %L)', req, sup, keeper), '23514');

  -- ---------- nobody approves their own (076, in the database) -----------------
  perform test.raises('purchasing','the person who asked cannot approve it',
    format('select app.decide_approval(%L, %L, %L, null)', ap, 'approved', keeper), '23514');

  perform app.decide_approval(ap, 'approved', gm, null);
  perform test.ok('purchasing','the GM approves it',
    (select status from approvals where id = ap) = 'approved');

  -- ---------- AND STILL NOT, BECAUSE A LINE HAS NO PRICE -----------------------
  perform test.raises('purchasing','an approved order with a line nobody priced STILL cannot be sent',
    format('select app.mark_purchase_ordered(%L, %L, %L)', req, sup, keeper), '23514');

  update purchase_request_lines set unit_price = 62 where id = line_rice;

  perform test.raises('purchasing','and it cannot be sent to nobody',
    format('select app.mark_purchase_ordered(%L, null, %L)', req, keeper), '23514');

  perform app.mark_purchase_ordered(req, sup, keeper);
  perform test.ok('purchasing','priced and approved, the order goes out',
    (select status from purchase_requests where id = req) = 'ordered');
  perform test.ok('purchasing','and it records who sent it, when, and to whom',
    (select ordered_by = keeper and ordered_at is not null and supplier_id = sup
       from purchase_requests where id = req));

  perform test.raises('purchasing','an order already sent is not sent twice',
    format('select app.mark_purchase_ordered(%L, %L, %L)', req, sup, keeper), '23514');

  -- ---------- the delivery -----------------------------------------------------
  insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
  values (h, app.next_purchase_reference(h), kitchen, 'Second order', keeper)
  returning id into req2;
  perform test.raises('purchasing','a delivery against an order never sent is refused',
    format('select app.mark_purchase_received(%L, %L, null)', req2, keeper), '23514');

  -- What was ordered and what came MAY DIFFER, and both stay.
  update purchase_request_lines
     set received_quantity = 45, received_unit_cost = 64 where id = line_rice;
  update purchase_request_lines
     set received_quantity = 10, received_unit_cost = 138 where id = line_oil;
  perform app.mark_purchase_received(req, keeper, 'Five kilos short, agreed with the driver');

  perform test.ok('purchasing','the delivery is recorded',
    (select status from purchase_requests where id = req) = 'received');
  perform test.ok('purchasing','what was ORDERED is not written over by what came',
    (select quantity = 50 and received_quantity = 45
       from purchase_request_lines where id = line_rice),
    (select quantity || ' ordered, ' || received_quantity || ' received'
       from purchase_request_lines where id = line_rice));
  perform test.ok('purchasing','and the short delivery is on the record in words',
    (select delivery_note is not null from purchase_requests where id = req));

  perform test.raises('purchasing','a delivery is not received twice',
    format('select app.mark_purchase_received(%L, %L, null)', req, keeper), '23514');

  -- ---------- the reference never truncates (MEMORY 280) -----------------------
  update purchase_requests set reference = 'PO-PUR-2609-10000' where id = req2;
  perform test.ok('purchasing','past four digits the number GROWS rather than being cut',
    app.next_purchase_reference(h) like 'PO-PUR-____-10001', app.next_purchase_reference(h));

  -- ---------- a cancellation says why ------------------------------------------
  perform test.raises('purchasing','an order cannot be cancelled without a reason',
    format('update purchase_requests set status = %L, cancelled_at = now(), cancelled_by = %L
            where id = %L', 'cancelled', keeper, req2),
    '23514');
  update purchase_requests
     set status = 'cancelled', cancelled_at = now(), cancelled_by = keeper,
         cancelled_reason = 'Bought locally instead'
   where id = req2;
  perform test.ok('purchasing','with one, it is cancelled and stays',
    (select status from purchase_requests where id = req2) = 'cancelled');

  -- ---------- what the application may do --------------------------------------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and privilege_type = 'DELETE'
     and table_name in ('purchase_requesters', 'purchase_requests', 'purchase_request_lines');
  perform test.ok('purchasing','the application cannot DELETE an order, a line or the setting',
    n = 0, n || ' delete grants');

  select count(*) into n from pg_class
   where relname in ('purchase_requesters', 'purchase_requests', 'purchase_request_lines')
     and relrowsecurity and relforcerowsecurity;
  perform test.ok('purchasing','all three tables force row-level security', n = 3, n || ' of 3');

  select count(*) into n from information_schema.triggers
   where event_object_table in ('purchase_requesters', 'purchase_requests')
     and trigger_name like '%_audit';
  perform test.ok('purchasing','what was ordered and who was allowed to order it are both audited',
    n >= 2, n || ' audit triggers');

  -- ---------- and the fixtures go ----------------------------------------------
  alter table stock_movements disable trigger stock_movements_append_only;
  delete from stock_movements where hotel_id in (h, other);
  alter table stock_movements enable trigger stock_movements_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (boss, gm, keeper, cook, clerk);
  update staff set is_active = false where id in (boss, gm, keeper, cook, clerk);

  select count(*) into n from hotels where code in ('PUR', 'PUQ');
  perform test.ok('purchasing','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- A BAR BILL (the owner's D27-354, 21 October; migration 234)
-- =============================================================================
-- A bar bill is recorded with its drinks as receipts into the bar's store. A
-- new hotel's Bar store is marked the bar's; one per hotel; the same bill
-- twice is refused; a bottle's size is sane; a test hotel counts bills as
-- trading.
-- =============================================================================
do $$
declare h uuid; v_bar uuid; v_staff uuid;
begin
  h := app.provision_property_unchecked('PBR', 'Bar Bill Test', 'Nowhere');
  select id into v_staff from staff where email = 'owner@fidato.in';
  select id into v_bar from locations where hotel_id = h and is_bar_store;
  perform test.ok('bar bill', 'a new hotel''s Bar store is marked the bar''s',
    (select name from locations where id = v_bar) = 'Bar store', coalesce(v_bar::text, 'none'));
  perform test.raises('bar bill', 'one bar store per hotel',
    format($q$update locations set is_bar_store = true where hotel_id = %L and name = 'Main store'$q$, h), '23505');

  insert into bar_purchases (hotel_id, supplier, bill_no, bill_date, business_date, recorded_by)
  values (h, 'Shah Wines', 'W-1', current_date, current_date, v_staff);
  perform test.raises('bar bill', 'the same bill twice is refused',
    format($q$insert into bar_purchases (hotel_id, supplier, bill_no, bill_date, business_date, recorded_by)
              values (%L, 'Shah Wines', 'W-1', current_date, current_date, %L)$q$, h, v_staff), '23505');
  perform test.raises('bar bill', 'a bill says who it is from',
    format($q$insert into bar_purchases (hotel_id, supplier, bill_no, bill_date, business_date, recorded_by)
              values (%L, '  ', 'W-2', current_date, current_date, %L)$q$, h, v_staff), '23514');
  perform test.raises('bar bill', 'a bottle''s size is from 1 to 20,000 ml',
    format($q$insert into stock_items (hotel_id, name, unit, category, size_ml)
              values (%L, 'Nothing', 'bottle', 'Bar', 0)$q$, h), '23514');
  perform test.ok('bar bill', 'a test hotel counts a bar bill as trading',
    exists (select 1 from app.test_hotel_classes() c
             where c.table_name = 'bar_purchases' and c.class = 'trading'));
end $$;
