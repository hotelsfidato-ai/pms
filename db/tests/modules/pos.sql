-- =============================================================================
-- POS — new database checks (db/tests/suite.sql's `pos` groups are frozen history)
-- =============================================================================
-- A BILL SETTLED TO A BANQUET FUNCTION — the owner's D17-21 of 17 September:
-- an order on a function is paid on the function's bill only. Refers to its
-- migration by what it does, "a restaurant bill settled to a banquet function",
-- never by its number (the master renumbers at merge).
--
-- Which functions an order may go on is the banquet service's rule and the
-- API's to enforce (api/test/modules/pos/functionOrders.test.ts). What is
-- proved here is what the database itself holds to: the method exists, a bill
-- settled to a function names one, and nothing else about payment loosened.
--
-- Uses the suite's AGR property and its clerk; makes one outlet and one open
-- order of its own and removes them.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; bd date;
  d text; n int; v_constraint text;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'FNSET', 'Function Settle Test', 'food', v_staff)
  returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff)
  returning id into v_order;

  -- ---------- the method exists ------------------------------------------------
  perform test.allows('pos function', 'an order may be paid "to a function"',
    format($q$update pos_orders set payment_method = 'function' where id = %L$q$, v_order));
  perform test.allows('pos function', 'a payment row may go to a function',
    format($q$insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
              values (%L, %L, 'function', 1, %L)$q$, v_order, a, v_staff));

  -- ---------- a bill settled to a function names the function ------------------
  -- Caught by name, not only by SQLSTATE: every check on pos_orders raises
  -- 23514, and "some check refused it" would pass for the wrong reason.
  --
  -- ⚠ AND UNDONE IF IT IS ALLOWED. The first version let a wrongly allowed
  -- settle stand, and the clean-up below could then not remove a settled
  -- order's payment — the whole suite stopped there instead of this check
  -- failing by name (seen with the constraint taken out, 17 September).
  v_constraint := null;
  begin
    update pos_orders
       set status = 'settled', settled_by = v_staff, settled_at = now(),
           payment_method = 'function'
     where id = v_order;
    v_constraint := 'it was allowed';
    raise exception using errcode = 'P0001', message = 'undo the settle';
  exception
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
    when raise_exception then
      null;  -- allowed, and rolled back with this block
  end;
  perform test.ok('pos function', 'a bill settled to a function with no function is refused',
    v_constraint = 'pos_orders_function_has_event', coalesce(v_constraint, 'it was allowed'));
  select status into d from pos_orders where id = v_order;
  perform test.ok('pos function', 'and the order is still open', d = 'open', d);

  -- ---------- nothing else loosened --------------------------------------------
  perform test.raises('pos function', 'a payment method nobody defined is still refused',
    format($q$update pos_orders set payment_method = 'voucher' where id = %L$q$, v_order),
    '23514');
  perform test.raises('pos function', 'a payment row nobody defined is still refused',
    format($q$insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
              values (%L, %L, 'voucher', 1, %L)$q$, v_order, a, v_staff),
    '23514');
  select pg_get_constraintdef(oid) into d from pg_constraint
   where conname = 'pos_orders_payment_valid';
  perform test.ok('pos function', 'the payment check still holds every earlier method',
    d like '%''room''%' and d like '%''cash''%' and d like '%''card''%'
      and d like '%''upi''%' and d like '%''split''%' and d like '%''function''%', d);

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_order_tenders where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  select count(*) into n from pos_outlets where code = 'FNSET';
  perform test.ok('pos function', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- A DISH STRUCK AFTER THE KITCHEN HAD IT SAYS WHY (D27-119), AND A PAID DISH
-- CAN STILL BE CARRIED OUT OF THE KITCHEN (QA POS-1)
-- =============================================================================
-- Who may strike is the till's to ask (api/test/modules/pos/restaurantFixes).
-- What the database holds to: a strike of food the kitchen had carries a
-- reason, and a settled order's lines stay frozen except for the kitchen
-- status, which the pass has to be able to move for food paid before cooking.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; bd date;
  v_first bigint; v_second bigint; c text; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'STRUCK', 'Struck Test', 'food', v_staff)
  returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff)
  returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, 'Struck Test Dish', 1, 100, 5, v_staff) returning id into v_first;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, 'Paid Test Dish', 1, 100, 5, v_staff) returning id into v_second;
  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1
   where order_id = v_order;

  -- ---------- no reason, no strike ----------------------------------------------
  -- By name, as above: every check on the table raises 23514.
  c := null;
  begin
    update pos_order_lines set voided = true, voided_by = v_staff, voided_at = now()
     where id = v_first;
    c := 'it was allowed';
    raise exception using errcode = 'P0001', message = 'undo the strike';
  exception
    when check_violation then get stacked diagnostics c = constraint_name;
    when raise_exception then null;
  end;
  perform test.ok('pos strike', 'a dish the kitchen had, struck with no reason, is refused',
    c = 'pos_order_lines_sent_strike_says_why', coalesce(c, 'it was allowed'));
  perform test.raises('pos strike', 'a reason of spaces is no reason',
    format($q$update pos_order_lines set voided = true, voided_by = %L, voided_at = now(),
              void_reason = '   ' where id = %L$q$, v_staff, v_first), '23514');
  perform test.allows('pos strike', 'with a reason it is struck',
    format($q$update pos_order_lines set voided = true, voided_by = %L, voided_at = now(),
              void_reason = 'dropped at the pass' where id = %L$q$, v_staff, v_first));
  select count(*) into n from app.pos_struck_after_kitchen(a, bd)
   where name = 'Struck Test Dish' and reason = 'dropped at the pass' and value = 100;
  perform test.ok('pos strike', 'and the day''s list names it, why and what it was worth', n = 1, n::text);

  -- ---------- paid before it was cooked ------------------------------------------
  update pos_orders set status = 'settled', settled_by = v_staff, settled_at = now(),
                        payment_method = 'card'
   where id = v_order;
  perform test.allows('pos strike', 'the kitchen moves a paid dish along',
    format($q$update pos_order_lines set kot_status = 'ready' where id = %L$q$, v_second));
  perform test.raises('pos strike', 'but the paid bill itself stays frozen',
    format($q$update pos_order_lines set qty = 2 where id = %L$q$, v_second), '23000');
  perform test.raises('pos strike', 'nor may a status move carry another change with it',
    format($q$update pos_order_lines set kot_status = 'served', unit_price = 1
              where id = %L$q$, v_second), '23000');

  -- ---------- and the fixtures go ------------------------------------------------
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;
  delete from pos_outlets where id = v_outlet;
  select count(*) into n from pos_outlets where code = 'STRUCK';
  perform test.ok('pos strike', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- THE KOT STATION (D27-159, D27-161) - "one KOT printer per outlet"
-- =============================================================================
-- Which device prints, and what it printed, are the API's to decide
-- (api/test/modules/pos/kotStation.test.ts). What the database holds to: a
-- station is a device, a typed name and a start, together; and a printed
-- docket stays printed - the app role may neither change nor remove the row.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'KOTST', 'KOT Station Test', 'food', v_staff)
  returning id into v_outlet;

  perform test.allows('pos kot station', 'a device, its name and its start switch it on',
    format($q$update pos_outlets set kot_station_device = 'dev-1', kot_station_name = 'Kitchen PC',
              kot_station_since = now() where id = %L$q$, v_outlet));
  perform test.raises('pos kot station', 'a device with no name is refused',
    format($q$update pos_outlets set kot_station_name = null where id = %L$q$, v_outlet), '23514');
  perform test.raises('pos kot station', 'a blank name is refused',
    format($q$update pos_outlets set kot_station_name = '  ' where id = %L$q$, v_outlet), '23514');
  perform test.raises('pos kot station', 'a name with no device is refused',
    format($q$update pos_outlets set kot_station_device = null where id = %L$q$, v_outlet), '23514');

  perform test.ok('pos kot station', 'the app may record a printed docket',
    has_table_privilege('pms_app', 'pos_kot_prints', 'insert'));
  perform test.ok('pos kot station', 'but never change one',
    not has_table_privilege('pms_app', 'pos_kot_prints', 'update'));
  perform test.ok('pos kot station', 'nor remove one',
    not has_table_privilege('pms_app', 'pos_kot_prints', 'delete'));
  perform test.ok('pos kot station', 'and row security keeps it to its hotel',
    (select relforcerowsecurity from pg_class where relname = 'pos_kot_prints'));

  delete from pos_outlets where id = v_outlet;
  select count(*) into n from pos_outlets where code = 'KOTST';
  perform test.ok('pos kot station', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- A DISH WITH SEVERAL VARIATION TYPES (D27-189, D27-192, D27-195)
-- =============================================================================
-- "Pizza": Size (Regular, Large) and a Crust option (Regular, Thin). Which
-- choices a waiter may ring is the till's to ask (api/test/modules/pos/
-- variationTypes.test.ts). What the database holds to: a name is unique within
-- its type, an Option has a heading, and a line names one choice of EVERY
-- type, all of this dish. Refusals are caught by message: every one of the
-- line's refusals is P0001, and "some trigger refused it" would pass for the
-- wrong reason.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; v_cat uuid; v_dish uuid;
  bd date; v_large uuid; v_thin uuid; m text; c text; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'VTYPE', 'Variation Types Test', 'food', v_staff) returning id into v_outlet;
  insert into pos_menu_categories (hotel_id, name)
  values (a, 'Variation Types Test') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_cat, 'Types Test Pizza', 1, 5) returning id into v_dish;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff) returning id into v_order;

  insert into pos_item_variations (hotel_id, item_id, label, price, kind)
  values (a, v_dish, 'Regular', 200, 'size');
  insert into pos_item_variations (hotel_id, item_id, label, price, kind)
  values (a, v_dish, 'Large', 400, 'size') returning id into v_large;

  -- ---------- names, kinds and headings ----------------------------------------
  perform test.allows('pos variation types', 'the same name may be in a second type (D27-195)',
    format($q$insert into pos_item_variations (hotel_id, item_id, type_no, label, price, kind, heading)
              values (%L, %L, 2, 'Regular', 0, 'option', 'Crust')$q$, a, v_dish));
  perform test.raises('pos variation types', 'but not twice in one type',
    format($q$insert into pos_item_variations (hotel_id, item_id, type_no, label, price, kind, heading)
              values (%L, %L, 2, 'Regular', 10, 'option', 'Crust')$q$, a, v_dish), '23505');
  c := null;
  begin
    insert into pos_item_variations (hotel_id, item_id, type_no, label, price, kind)
    values (a, v_dish, 2, 'Thin', 0, 'option');
    c := 'it was allowed';
  exception when check_violation then get stacked diagnostics c = constraint_name;
  end;
  perform test.ok('pos variation types', 'an Option with no heading is refused',
    c = 'pos_item_variations_type_sane', coalesce(c, 'it was allowed'));
  insert into pos_item_variations (hotel_id, item_id, type_no, label, price, kind, heading)
  values (a, v_dish, 2, 'Thin', 0, 'option', 'Crust') returning id into v_thin;

  -- ---------- a line names one choice of every type ----------------------------
  m := null;
  begin
    insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
    values (v_order, a, v_dish, v_large, 'Types Test Pizza (Large)', 1, 400, 5, v_staff);
    m := 'it was allowed';
  exception when raise_exception then get stacked diagnostics m = message_text;
  end;
  perform test.ok('pos variation types', 'a Large with no crust is refused, naming the crust',
    m = 'this dish needs one choice of each type: Crust', coalesce(m, 'it was allowed'));

  m := null;
  begin
    insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, extra_choice_ids,
                                 name, qty, unit_price, tax_rate, added_by)
    values (v_order, a, v_dish, v_large, array[v_thin, v_large], 'Types Test Pizza', 1, 400, 5, v_staff);
    m := 'it was allowed';
  exception when raise_exception then get stacked diagnostics m = message_text;
  end;
  perform test.ok('pos variation types', 'a first-type choice among the others is refused',
    m = 'that choice belongs to a different dish', coalesce(m, 'it was allowed'));

  m := null;
  begin
    insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, extra_choice_ids,
                                 name, qty, unit_price, tax_rate, added_by)
    values (v_order, a, v_dish, v_thin, array[v_thin], 'Types Test Pizza', 1, 0, 5, v_staff);
    m := 'it was allowed';
  exception when raise_exception then get stacked diagnostics m = message_text;
  end;
  perform test.ok('pos variation types', 'a crust cannot stand in for the size, which prices the dish',
    m = 'that variation belongs to a different dish', coalesce(m, 'it was allowed'));

  perform test.allows('pos variation types', 'Large with a Thin crust goes on',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, extra_choice_ids,
                                          name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, %L, array[%L]::uuid[], 'Types Test Pizza (Large, Thin)', 1, 400, 5, %L)$q$,
           v_order, a, v_dish, v_large, v_thin, v_staff));

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_item_variations where item_id = v_dish;
  delete from pos_menu_items where id = v_dish;
  delete from pos_menu_categories where id = v_cat;
  delete from pos_outlets where id = v_outlet;
  select count(*) into n from pos_outlets where code = 'VTYPE';
  perform test.ok('pos variation types', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- IN-ROOM DINING: THE GUEST'S SIDE (D27-224, D27-225; the in-stay plan, A)
-- =============================================================================
-- The guest's page reaches the menu and its own orders only through four
-- functions behind the code, so each is called HERE, with the link's hash and
-- no unlock, and with another stay's unlock (root MEMORY 318, the OCI-5 test).
-- Accept and Decline are the till's (api/test/modules/pos/roomDining.test.ts).
-- Builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; guest uuid; stay uuid; stay2 uuid; booked uuid; r101 uuid; r102 uuid;
  link uuid; link2 uuid; link_booked uuid; outlet uuid; food uuid; bar uuid;
  dal uuid; beer uuid; staff_id uuid; n int; o uuid; ok boolean; p numeric;
begin
  h := app.provision_property_unchecked('GDN', 'Dining Test', 'Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 102);
  select id into r101 from rooms where hotel_id = h and number = '101';
  select id into r102 from rooms where hotel_id = h and number = '102';
  select id into staff_id from staff where email = 'agra@fidato.in';

  insert into guests (full_name) values ('Dining Guest') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 2, 2000, 'checked_in') returning id into stay;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, stay, r101, current_date, current_date + 2, 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 2, 2000, 'checked_in') returning id into stay2;
  insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
  values (h, stay2, r102, current_date, current_date + 2, 'arrival');
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest, (select id from room_types where hotel_id = h limit 1),
          current_date + 5, current_date + 6, 2000, 'confirmed') returning id into booked;

  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay, 'gdn-link', now() + interval '1 day') returning id into link;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link, stay, 'gdn-unlock', now() + interval '1 hour');
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, stay2, 'gdn-link-2', now() + interval '1 day') returning id into link2;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link2, stay2, 'gdn-unlock-2', now() + interval '1 hour');
  insert into guest_links (hotel_id, reservation_id, token_hash, expires_at)
  values (h, booked, 'gdn-link-booked', now() + interval '1 day') returning id into link_booked;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (link_booked, booked, 'gdn-unlock-booked', now() + interval '1 hour');

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'REST', 'Dining Test Restaurant', 'food', staff_id) returning id into outlet;
  insert into pos_menu_categories (hotel_id, name) values (h, 'Food') returning id into food;
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (h, 'Bar', 'alcohol') returning id into bar;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (h, food, 'Dining Dal', 260, 5) returning id into dal;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (h, bar, 'Dining Beer', 300, 18) returning id into beer;

  -- ---------- the menu, behind the code only ----------------------------------
  select count(*) into n from app.guest_menu('gdn-link', null);
  perform test.ok('room dining', 'the link alone shows no menu (OCI-5)', n = 0, n || ' dishes');
  select count(*) into n from app.guest_menu('gdn-link', 'gdn-unlock-2');
  perform test.ok('room dining', 'another stay''s unlock shows no menu', n = 0, n || ' dishes');
  select count(*) into n from app.guest_menu('gdn-link-booked', 'gdn-unlock-booked');
  perform test.ok('room dining', 'a guest not checked in sees no menu', n = 0, n || ' dishes');
  select count(*) into n from app.guest_menu('gdn-link', 'gdn-unlock') m
   where m.item->>'name' = 'Dining Dal';
  perform test.ok('room dining', 'a checked-in guest sees the dal', n = 1, n || ' dals');
  select count(*) into n from app.guest_menu('gdn-link', 'gdn-unlock') m
   where m.item->>'name' = 'Dining Beer';
  perform test.ok('room dining', 'and no alcohol (the owner)', n = 0, n || ' beers');

  -- ---------- the order --------------------------------------------------------
  o := app.guest_food_order_make('gdn-link', null,
         jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 1)), null);
  perform test.ok('room dining', 'the link alone orders nothing', o is null, 'an order was made');
  o := app.guest_food_order_make('gdn-link', 'gdn-unlock',
         jsonb_build_array(jsonb_build_object('itemId', beer, 'qty', 1)), null);
  perform test.ok('room dining', 'a beer cannot be ordered', o is null, 'it was');
  o := app.guest_food_order_make('gdn-link', 'gdn-unlock',
         jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 21)), null);
  perform test.ok('room dining', 'twenty of a dish is the most', o is null, 'twenty-one were ordered');
  o := app.guest_food_order_make('gdn-link', 'gdn-unlock',
         jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 2)), ' No onion ');
  select (basket->0->>'unitPrice')::numeric into p from guest_food_orders where id = o;
  perform test.ok('room dining', 'the guest''s order keeps the price they saw', p = 260, coalesce(p::text, 'none'));
  select count(*) into n from app.guest_food_orders_mine('gdn-link-2', 'gdn-unlock-2');
  perform test.ok('room dining', 'another stay does not see it', n = 0, n || ' seen');

  perform app.guest_food_order_make('gdn-link', 'gdn-unlock',
            jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 1)), null);
  perform app.guest_food_order_make('gdn-link', 'gdn-unlock',
            jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 1)), null);
  o := app.guest_food_order_make('gdn-link', 'gdn-unlock',
         jsonb_build_array(jsonb_build_object('itemId', dal, 'qty', 1)), null);
  perform test.ok('room dining', 'three waiting is the most', o is null, 'a fourth was made');

  -- ---------- taken back, only by the guest and only while waiting --------------
  select id into o from guest_food_orders where reservation_id = stay order by created_at limit 1;
  ok := app.guest_food_order_cancel('gdn-link-2', 'gdn-unlock-2', o);
  perform test.ok('room dining', 'another stay cannot take it back', not ok, 'it did');
  ok := app.guest_food_order_cancel('gdn-link', 'gdn-unlock', o);
  perform test.ok('room dining', 'the guest takes it back while it waits', ok, 'refused');
  ok := app.guest_food_order_cancel('gdn-link', 'gdn-unlock', o);
  perform test.ok('room dining', 'but not twice', not ok, 'cancelled again');

  -- ---------- off, or the restaurant closed ---------------------------------------
  update pos_menu_items set off_until = now() + interval '1 hour' where id = dal;
  select unit_price into p from app.guest_dish_price(h, dal, null, '{}', '{}');
  perform test.ok('room dining', 'a dish off is not priced, so not accepted', p is null, coalesce(p::text, ''));
  update pos_menu_items set off_until = null where id = dal;
  update pos_outlets set closed_until = now() + interval '1 hour' where id = outlet;
  select count(*) into n from app.guest_menu('gdn-link', 'gdn-unlock');
  perform test.ok('room dining', 'a restaurant closed for a while shows no menu', n = 0, n || ' dishes');

  -- ---------- clean up -----------------------------------------------------------
  delete from guest_food_orders where hotel_id = h;
  delete from guest_unlocks where link_id in (link, link2, link_booked);
  delete from guest_links where id in (link, link2, link_booked);
  delete from pos_menu_items where hotel_id = h;
  delete from pos_menu_categories where hotel_id = h;
  delete from pos_outlets where id = outlet;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  select count(*) into n from hotels where code = 'GDN';
  perform test.ok('room dining', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- A BILL CLOSED UNPAID IS FINISHED ON THE FLOOR (POS-33, the owner, 9 October)
-- =============================================================================
-- Close unpaid leaves the bill on its table, as a paid one is left, until
-- somebody clears it. The floor called it `running` or `kot`, with the bill's
-- total, and Tables offers Clear only on a finished tile, so the table could
-- never be freed. Refers to its migration by what it does, "a bill closed
-- unpaid shows as closed unpaid", never by its number.
--
-- Uses the suite's AGR property and its clerk; makes its own outlet, section,
-- table and order, and removes them.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_section uuid; v_table uuid;
  v_order uuid; bd date; st text; amt numeric; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'FLCLS', 'Floor Closed Test', 'food', v_staff)
  returning id into v_outlet;
  insert into pos_sections (hotel_id, outlet_id, name)
  values (a, v_outlet, 'Closed test') returning id into v_section;
  insert into pos_tables (hotel_id, section_id, label)
  values (a, v_section, 'CT1') returning id into v_table;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by, table_id, table_ref)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff, v_table, 'CT1')
  returning id into v_order;

  select f.state into st from app.pos_floor(v_outlet) f where f.label = 'CT1';
  perform test.ok('pos floor', 'an open bill with nothing sent is running', st = 'running', st);

  -- ---------- closed unpaid -------------------------------------------------------
  update pos_orders set status = 'abandoned', abandoned_reason = 'walked out - test'
   where id = v_order;
  select f.state, f.payable into st, amt from app.pos_floor(v_outlet) f where f.label = 'CT1';
  perform test.ok('pos floor', 'a bill closed unpaid is closed, not running', st = 'closed', st);
  perform test.ok('pos floor', 'and its tile shows no amount', amt is null, coalesce(amt::text, ''));

  update pos_orders set printed_at = now() where id = v_order;
  select f.state into st from app.pos_floor(v_outlet) f where f.label = 'CT1';
  perform test.ok('pos floor', 'printed afterwards, it is still closed - not green', st = 'closed', st);

  update pos_orders set cleared_at = now() where id = v_order;
  select f.state into st from app.pos_floor(v_outlet) f where f.label = 'CT1';
  perform test.ok('pos floor', 'cleared, the table is free', st = 'blank', st);

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_orders where id = v_order;
  delete from pos_tables where id = v_table;
  delete from pos_sections where id = v_section;
  delete from pos_outlets where id = v_outlet;
  select count(*) into n from pos_outlets where code = 'FLCLS';
  perform test.ok('pos floor', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- NUMBERED ADD-ONS (the owner's D27-289, 9 October)
-- =============================================================================
-- A numbered list any dish can take, folded into the dish's own line. What
-- the database itself holds to: a price is typed (0 only when Free), one
-- add-on per number while it is in use, the kept add-ons sit on a dish and
-- never on a side, and a dish the kitchen has keeps what it was sent with.
-- Refers to its migration by what it does, "numbered add-ons", never by its
-- number. Uses the suite's AGR property and its clerk; removes what it makes.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; bd date;
  v_dish bigint; v_side bigint; v_group uuid; v_option uuid; n int;
  kept text := '{"dish":"Dal","base":200,"addons":[{"id":"00000000-0000-0000-0000-000000000001","number":2,"name":"Kebab","price":120,"qty":1}]}';
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  -- ---------- the list ------------------------------------------------------------
  perform test.raises('pos numbered addons', 'a 0 nobody ticked Free is refused',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price)
              values (%L, 2, 'Kebab', 0)$q$, a));
  perform test.allows('pos numbered addons', 'a 0 ticked Free is kept',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price, is_free)
              values (%L, 3, 'Onions', 0, true)$q$, a));
  perform test.allows('pos numbered addons', 'a typed price is kept',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price)
              values (%L, 2, 'Kebab', 120)$q$, a));
  perform test.raises('pos numbered addons', 'one add-on per number while it is in use',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price)
              values (%L, 2, 'Paneer', 90)$q$, a), '23505');
  update pos_numbered_addons set is_active = false where hotel_id = a and number = 2;
  perform test.allows('pos numbered addons', 'switched off, its number is free for another',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price)
              values (%L, 2, 'Paneer', 90)$q$, a));

  -- ---------- on a line -------------------------------------------------------------
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'NUMAD', 'Numbered Add-on Test', 'food', v_staff) returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, 'Dal', 1, 200, 5, v_staff) returning id into v_dish;
  -- A real side, as the app makes one: a group and its option.
  insert into pos_addon_groups (hotel_id, label) values (a, 'Numbered test sides')
  returning id into v_group;
  insert into pos_addons (hotel_id, group_id, label, price) values (a, v_group, 'Onions', 25)
  returning id into v_option;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by, parent_line_id, addon_id)
  values (v_order, a, 'Sides: Onions', 1, 25, 5, v_staff, v_dish, v_option) returning id into v_side;

  perform test.allows('pos numbered addons', 'a dish not yet sent takes them',
    format($q$update pos_order_lines set numbered_addons = %L::jsonb where id = %s$q$, kept, v_dish));
  perform test.raises('pos numbered addons', 'a side never carries them',
    format($q$update pos_order_lines set numbered_addons = %L::jsonb where id = %s$q$, kept, v_side), '23514');
  perform test.raises('pos numbered addons', 'an empty set is not a set: none is null',
    format($q$update pos_order_lines set numbered_addons = '{"dish":"Dal","base":200,"addons":[]}'::jsonb where id = %s$q$, v_dish), '23514');

  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1 where id = v_dish;
  perform test.raises('pos numbered addons', 'a dish the kitchen has keeps what it was sent with',
    format($q$update pos_order_lines set numbered_addons = null where id = %s$q$, v_dish), '23514');
  perform test.allows('pos numbered addons', 'and anything else about it still moves along',
    format($q$update pos_order_lines set kot_status = 'preparing' where id = %s$q$, v_dish));

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  delete from pos_addons where id = v_option;
  delete from pos_addon_groups where id = v_group;
  delete from pos_numbered_addons where hotel_id = a;
  select count(*) into n from pos_outlets where code = 'NUMAD';
  perform test.ok('pos numbered addons', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- THREE GUARDS FROM THE AUDIT OF 9 OCTOBER (POS-34, D27-289)
-- =============================================================================
-- A struck copy is what the dish WAS, so the variation rule stands aside for a
-- line struck as it is written and holds for everything sold; Free is 0; the
-- kept add-ons must be a list. Refers to its migration by what it does, "three
-- guards from the audit", never by its number. Uses the suite's AGR property and
-- its clerk; removes what it makes.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; bd date;
  v_cat uuid; v_item uuid; v_large uuid; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  -- ---------- Free is 0 ------------------------------------------------------------
  perform test.raises('pos audit guards', 'an add-on ticked Free carries no price',
    format($q$insert into pos_numbered_addons (hotel_id, number, name, price, is_free)
              values (%L, 41, 'Onions', 50, true)$q$, a), '23514');

  -- ---------- the kept add-ons are a list ------------------------------------------
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'AUDGD', 'Audit Guards Test', 'food', v_staff) returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff) returning id into v_order;
  perform test.raises('pos audit guards', 'kept add-ons with no list are refused',
    format($q$insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by, numbered_addons)
              values (%L, %L, 'Dal', 1, 200, 5, %L, '{"dish":"Dal","base":200}'::jsonb)$q$, v_order, a, v_staff), '23514');

  -- ---------- a struck copy is what the dish was -------------------------------------
  -- A Pizza that has a Crust type now, rung before it had one: its struck copy
  -- carries no crust, and goes in; a SOLD line with no crust is still refused.
  insert into pos_menu_categories (hotel_id, name) values (a, 'Audit guards') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price)
  values (a, v_cat, 'Audit Pizza', 1) returning id into v_item;
  insert into pos_item_variations (hotel_id, item_id, label, price, type_no)
  values (a, v_item, 'Large', 400, 1) returning id into v_large;
  insert into pos_item_variations (hotel_id, item_id, label, price, type_no)
  values (a, v_item, 'Cheese burst', 80, 2);

  perform test.allows('pos audit guards', 'a struck copy with no crust goes in: it is what the dish was',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price,
                                          tax_rate, added_by, voided, voided_by, voided_at, void_reason)
              values (%L, %L, %L, %L, 'Audit Pizza (Large)', 1, 400, 5, %L, true, %L, now(), 'audit test')$q$,
           v_order, a, v_item, v_large, v_staff, v_staff));
  perform test.raises('pos audit guards', 'but a sold line with no crust is still refused',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price,
                                          tax_rate, added_by)
              values (%L, %L, %L, %L, 'Audit Pizza (Large)', 1, 400, 5, %L)$q$,
           v_order, a, v_item, v_large, v_staff));

  -- ---------- and the fixtures go ----------------------------------------------
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where order_id = v_order;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  delete from pos_item_variations where item_id = v_item;
  delete from pos_menu_items where id = v_item;
  delete from pos_menu_categories where id = v_cat;
  delete from pos_numbered_addons where hotel_id = a and number = 41;
  select count(*) into n from pos_outlets where code = 'AUDGD';
  perform test.ok('pos audit guards', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- CUSTOM ADD-ONS, AND ADD-ONS ON A DISH ALREADY SENT (D27-291)
-- =============================================================================
-- An add-on line of its own hangs under a dish, names no menu item and is no
-- side; a numbered one says which. A sent one struck says why, and a dish
-- struck carries its reason to them. Refers to its migration by what it does,
-- never by its number. Uses the suite's AGR property and its clerk; removes
-- what it makes.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; v_dish bigint; v_extra bigint;
  v_numbered uuid; bd date; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'CUSAD', 'Custom Add-on Test', 'food', v_staff) returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, 'Veg Thali', 2, 300, 5, v_staff) returning id into v_dish;
  insert into pos_numbered_addons (hotel_id, number, name, price)
  values (a, 42, 'Kebab', 120) returning id into v_numbered;

  -- ---------- its shape ----------------------------------------------------------
  perform test.allows('pos custom addons', 'a typed add-on under a dish, with its own number',
    format($q$insert into pos_order_lines (order_id, hotel_id, parent_line_id, extra_kind, name, qty,
                                          unit_price, tax_rate, added_by)
              values (%L, %L, %s, 'custom', 'Extra papad', 1, 40, 5, %L)$q$, v_order, a, v_dish, v_staff));
  perform test.raises('pos custom addons', 'a child line that is neither a side nor an add-on is refused',
    format($q$insert into pos_order_lines (order_id, hotel_id, parent_line_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %s, 'Stray', 1, 40, 5, %L)$q$, v_order, a, v_dish, v_staff), '23514');
  perform test.raises('pos custom addons', 'an add-on line hangs under a dish',
    format($q$insert into pos_order_lines (order_id, hotel_id, extra_kind, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, 'custom', 'Extra papad', 1, 40, 5, %L)$q$, v_order, a, v_staff), '23514');
  perform test.raises('pos custom addons', 'a numbered one says which',
    format($q$insert into pos_order_lines (order_id, hotel_id, parent_line_id, extra_kind, name, qty,
                                          unit_price, tax_rate, added_by)
              values (%L, %L, %s, 'numbered', 'Kebab', 1, 120, 5, %L)$q$, v_order, a, v_dish, v_staff), '23514');
  perform test.allows('pos custom addons', 'and with it, goes in',
    format($q$insert into pos_order_lines (order_id, hotel_id, parent_line_id, extra_kind, numbered_addon_id,
                                          name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %s, 'numbered', %L, 'Kebab', 1, 120, 5, %L)$q$, v_order, a, v_dish, v_numbered, v_staff));
  perform test.raises('pos custom addons', 'a kind nobody named is refused',
    format($q$insert into pos_order_lines (order_id, hotel_id, parent_line_id, extra_kind, name, qty,
                                          unit_price, tax_rate, added_by)
              values (%L, %L, %s, 'other', 'Ghee', 1, 20, 5, %L)$q$, v_order, a, v_dish, v_staff), '23514');

  -- ---------- sent, struck -------------------------------------------------------
  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1
   where order_id = v_order;
  select id into v_extra from pos_order_lines where parent_line_id = v_dish and extra_kind = 'custom';
  perform test.raises('pos custom addons', 'a sent add-on struck with no reason is refused',
    format($q$update pos_order_lines set voided = true, voided_by = %L, voided_at = now() where id = %s$q$,
           v_staff, v_extra), '23514');
  perform test.allows('pos custom addons', 'a sent dish struck with a reason strikes its add-ons with it',
    format($q$update pos_order_lines set voided = true, voided_by = %L, voided_at = now(),
                                         void_reason = 'wrong table' where id = %s$q$, v_staff, v_dish));
  select count(*) into n from pos_order_lines
   where parent_line_id = v_dish and voided and void_reason = 'wrong table';
  perform test.ok('pos custom addons', 'its add-ons carry the reason', n = 2, n || ' carry it');
  select count(*) into n from app.pos_struck_after_kitchen(a, bd)
   where name = '+ Extra papad (for Veg Thali)';
  perform test.ok('pos custom addons', 'the day''s struck list names the dish', n = 1, n || ' listed');

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  delete from pos_numbered_addons where id = v_numbered;
  select count(*) into n from pos_outlets where code = 'CUSAD';
  perform test.ok('pos custom addons', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- THE KOT SECTION OF RESTAURANT SETUP (D27-292)
-- =============================================================================
-- Every hotel starts with Kitchen and Bar, never switched off; one computer
-- prints the bills; a line takes its kind when it is sent - its section's own,
-- else by its heading, and an add-on its dish's; a slip is claimed once per
-- kind. Refers to its migration by what it does, never by its number. Uses the
-- suite's AGR property and its clerk; removes what it makes.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_order uuid; v_cat uuid; v_drinks uuid;
  v_item uuid; v_drink uuid; v_dish bigint; v_lime bigint; v_extra bigint;
  v_kitchen uuid; v_bar uuid; v_tandoor uuid; v_s1 uuid; v_s2 uuid; bd date; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_staff from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  -- ---------- the kinds every hotel starts with -----------------------------------
  select id into v_kitchen from pos_kot_kinds where hotel_id = a and role = 'food';
  select id into v_bar from pos_kot_kinds where hotel_id = a and role = 'bar';
  perform test.ok('pos kot section', 'a hotel starts with Kitchen and Bar',
    v_kitchen is not null and v_bar is not null, 'missing');
  perform test.raises('pos kot section', 'Kitchen is never switched off',
    format($q$update pos_kot_kinds set is_active = false where id = %L$q$, v_kitchen), '23514');
  perform test.raises('pos kot section', 'two KOTs of one name are refused',
    format($q$insert into pos_kot_kinds (hotel_id, name) values (%L, ' kitchen ')$q$, a), '23505');
  insert into pos_kot_kinds (hotel_id, name, sort) values (a, 'Tandoor', 3) returning id into v_tandoor;

  -- ---------- one bill printer -------------------------------------------------
  insert into pos_kot_stations (hotel_id, device, name, prints_bills, bills_since)
  values (a, 'device-dbtest-0001', 'Bar PC', true, now()) returning id into v_s1;
  perform test.raises('pos kot section', 'one computer prints the bills',
    format($q$insert into pos_kot_stations (hotel_id, device, name, prints_bills, bills_since)
              values (%L, 'device-dbtest-0002', 'Till PC', true, now())$q$, a), '23505');
  insert into pos_kot_stations (hotel_id, device, name) values (a, 'device-dbtest-0002', 'Kitchen PC')
  returning id into v_s2;
  perform test.raises('pos kot section', 'a kind on a computer says since when',
    format($q$update pos_kot_kinds set station_id = %L where id = %L$q$, v_s2, v_kitchen), '23514');

  -- ---------- stamped when sent ------------------------------------------------
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (a, 'KOT test food', 'restaurant')
  returning id into v_cat;
  insert into pos_menu_categories (hotel_id, name, tax_kind, kot_kind_id)
  values (a, 'KOT test tandoor', 'restaurant', v_tandoor) returning id into v_drinks;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_cat, 'KOT test dal', 200, 5) returning id into v_item;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_drinks, 'KOT test naan', 50, 5) returning id into v_drink;
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'KOTSC', 'KOT Section Test', 'food', v_staff) returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, v_item, 'KOT test dal', 1, 200, 5, v_staff) returning id into v_dish;
  insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, v_drink, 'KOT test naan', 2, 50, 5, v_staff) returning id into v_lime;
  insert into pos_order_lines (order_id, hotel_id, parent_line_id, extra_kind, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, v_dish, 'custom', 'Extra papad', 1, 40, 5, v_staff) returning id into v_extra;

  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1 where order_id = v_order;
  select count(*) into n from pos_order_lines where id = v_dish and kot_kind_id = v_kitchen;
  perform test.ok('pos kot section', 'a dish takes its heading''s kind when sent', n = 1, 'not the Kitchen');
  select count(*) into n from pos_order_lines where id = v_lime and kot_kind_id = v_tandoor;
  perform test.ok('pos kot section', 'a section''s own kind wins over its heading', n = 1, 'not the Tandoor');
  select count(*) into n from pos_order_lines where id = v_extra and kot_kind_id = v_kitchen;
  perform test.ok('pos kot section', 'an add-on goes with its dish', n = 1, 'not with its dish');

  update pos_menu_categories set kot_kind_id = null where id = v_drinks;
  perform test.ok('pos kot section', 'a sent line keeps its kind when the section moves',
    app.pos_line_kot_kind(v_lime) = v_tandoor, 'it moved');

  -- ---------- one claim per kind -----------------------------------------------
  perform test.allows('pos kot section', 'the kitchen''s slip is claimed',
    format($q$insert into pos_kot_prints (hotel_id, order_id, kot_no, kind_id) values (%L, %L, 1, %L)$q$,
           a, v_order, v_kitchen));
  perform test.allows('pos kot section', 'and the tandoor''s, apart',
    format($q$insert into pos_kot_prints (hotel_id, order_id, kot_no, kind_id) values (%L, %L, 1, %L)$q$,
           a, v_order, v_tandoor));
  perform test.raises('pos kot section', 'never the same slip twice',
    format($q$insert into pos_kot_prints (hotel_id, order_id, kot_no, kind_id) values (%L, %L, 1, %L)$q$,
           a, v_order, v_kitchen), '23505');

  -- ---------- a new hotel -------------------------------------------------------
  select count(*) into n from information_schema.triggers where trigger_name = 'hotels_kot_kinds';
  perform test.ok('pos kot section', 'a hotel made later starts with them too', n = 1, 'no trigger');

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_kot_prints where order_id = v_order;
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  delete from pos_menu_items where id in (v_item, v_drink);
  delete from pos_menu_categories where id in (v_cat, v_drinks);
  update pos_kot_kinds set station_id = null, station_since = null where hotel_id = a;
  delete from pos_kot_kinds where id = v_tandoor;
  delete from pos_kot_stations where id in (v_s1, v_s2);
  select count(*) into n from pos_outlets where code = 'KOTSC';
  perform test.ok('pos kot section', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- A PAID RESTAURANT BILL VOIDED (the owner's D27-324 (1), 14 October)
-- =============================================================================
-- The owner, an administrator or the GM may void a PAID bill, with a reason:
-- the same business day, before that outlet's day is closed; never a bill
-- that went to a room or a function (it is reversed on that bill); a card or
-- UPI bill names the refund's reference. The bill keeps its number, is void
-- for good, and keeps its payments and lines. Its cash goes back to the guest
-- out of the restaurant's tin, where the notes still are the same day; the
-- voiding person's own drawer is not touched (D27-327).
-- =============================================================================
do $$
declare
  h uuid; waiter uuid; gm uuid; v_out uuid; v_shut uuid; bd date;
  cash_bill uuid; card_bill uuid; open_bill uuid; old_bill uuid; shut_bill uuid;
  sh uuid; tin_before numeric; d text;
begin
  h := app.provision_property_unchecked('PVD', 'Void Rules Test', 'Nowhere');
  select id into waiter from staff where email = 'agra@fidato.in';
  select id into gm from staff where email = 'pune@fidato.in';
  insert into staff_hotels (staff_id, hotel_id, role) values (waiter, h, 'pos'), (gm, h, 'gm')
  on conflict (staff_id, hotel_id) do update set role = excluded.role;
  bd := app.business_date(h);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'VOID', 'Void Test', 'food', waiter) returning id into v_out;
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'SHUT', 'Closed Day Test', 'food', waiter) returning id into v_shut;
  insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash)
  values (h, v_out, bd, 0);
  insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash,
                            counted_cash, closed_by, closed_at)
  values (h, v_shut, bd, 0, 0, gm, now());

  -- Five bills of ₹500 + 5% GST: cash, card, still open, yesterday's, and one
  -- at an outlet whose day is closed.
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, waiter) returning id into cash_bill;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, waiter) returning id into card_bill;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, waiter) returning id into open_bill;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd - 1), bd - 1, waiter) returning id into old_bill;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_shut, app.pos_next_order_no(h, bd), bd, waiter) returning id into shut_bill;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  select o, h, 'Thali', 1, 500, 5, waiter
    from unnest(array[cash_bill, card_bill, open_bill, old_bill, shut_bill]) o;

  update pos_orders set status = 'settled', settled_by = waiter, settled_at = now(),
                        payment_method = 'cash'
   where id in (cash_bill, old_bill, shut_bill);
  update pos_orders set status = 'settled', settled_by = waiter, settled_at = now(),
                        payment_method = 'card'
   where id = card_bill;
  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  select o, h, 'cash', 525, waiter from unnest(array[cash_bill, old_bill, shut_bill]) o;
  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  values (card_bill, h, 'card', 525, waiter);

  -- The cash bill's alcohol had its VAT bill when it was paid (135).
  insert into vat_bills (hotel_id, fin_year, number, pos_order_id, taxable_value, vat_total,
                         total, business_date)
  values (h, app.current_fin_year(h), app.next_vat_bill_number(h, app.current_fin_year(h)),
          cash_bill, 100, 10, 110, bd);

  -- The GM's own drawer, open with ₹1,000 before the void.
  insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_by, opened_at)
  values (h, gm, bd, 1000, gm, now() - interval '1 minute') returning id into sh;
  tin_before := app.pos_expected_cash(v_out, bd);

  -- ---------- who --------------------------------------------------------------
  perform set_config('app.user_id', waiter::text, true);
  perform test.raises('pos void', 'a waiter cannot void a paid bill',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'wrong table' where id = %L$q$, waiter, cash_bill), '42501');

  -- ---------- which bills -------------------------------------------------------
  perform set_config('app.user_id', gm::text, true);
  perform test.raises('pos void', 'an open bill is not voided (it is closed unpaid)',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'x' where id = %L$q$, gm, open_bill), '23514');
  perform test.raises('pos void', 'a void says why',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = '  ' where id = %L$q$, gm, cash_bill), '23514');
  perform test.raises('pos void', 'only on the bill''s own business day',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'late' where id = %L$q$, gm, old_bill), '23514');
  perform test.raises('pos void', 'never after the outlet''s day is closed',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'late' where id = %L$q$, gm, shut_bill), '23514');
  perform test.raises('pos void', 'a card bill names the refund''s reference',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'double charged' where id = %L$q$, gm, card_bill), '23514');
  perform test.raises('pos void', 'never a bill that went to a room',
    format($q$update pos_orders set status = 'void', payment_method = 'room', voided_by = %L,
                     voided_at = now(), void_reason = 'x' where id = %L$q$, gm, cash_bill), '23514');

  -- ---------- the GM voids the cash bill and the card bill ----------------------
  -- The row names the waiter as the voider; the database records who it is.
  perform test.allows('pos void', 'the GM voids a paid cash bill, with a reason',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'Billed to the wrong table' where id = %L$q$, waiter, cash_bill));
  perform test.allows('pos void', 'and a card bill, with the refund''s approval code',
    format($q$update pos_orders set status = 'void', voided_by = %L, voided_at = now(),
                     void_reason = 'Charged twice', void_reference = 'APPR 4471'
               where id = %L$q$, gm, card_bill));
  select status into d from pos_orders where id = cash_bill;
  perform test.ok('pos void', 'the bill is void and keeps its number', d = 'void', d);
  perform test.ok('pos void', 'the void records who: the GM, whoever the row named',
    (select voided_by from pos_orders where id = cash_bill) = gm, 'someone else');
  perform test.ok('pos void', 'its VAT bill is cancelled with it, the figures negated, with the reason',
    exists (select 1 from vat_bills c join vat_bills v on v.id = c.cancels_id
             where v.pos_order_id = cash_bill and c.total = -110
               and c.reason like '%voided: Billed to the wrong table'),
    'no cancellation');

  perform test.raises('pos void', 'a void stays void',
    format($q$update pos_orders set status = 'settled' where id = %L$q$, cash_bill), '23514');
  perform test.raises('pos void', 'and its reason stays as written',
    format($q$update pos_orders set void_reason = 'something else' where id = %L$q$, cash_bill), '23514');
  perform test.raises('pos void', 'its payments are evidence: never removed',
    format($q$delete from pos_order_tenders where order_id = %L$q$, cash_bill), 'P0001');
  perform test.raises('pos void', 'its lines are history: never changed',
    format($q$update pos_order_lines set qty = 2 where order_id = %L$q$, cash_bill), '23000');

  -- ---------- the money ---------------------------------------------------------
  perform test.ok('pos void', 'the cash goes back out of the restaurant''s tin: Expected less 525',
    app.pos_expected_cash(v_out, bd) = tin_before - 525,
    tin_before || ' -> ' || app.pos_expected_cash(v_out, bd));
  -- The GM counts the drawer a moment later (one transaction here: now() is
  -- the void's own instant, so the close is after it).
  update cashier_shifts set closed_at = now() + interval '1 second', counted_cash = 1000,
                            closed_by = gm
   where id = sh;
  perform test.ok('pos void', 'the GM''s own drawer is not touched (D27-327): it still expects 1,000',
    app.cashier_expected_cash(sh) = 1000, app.cashier_expected_cash(sh)::text);
  perform test.ok('pos void', 'the day''s sales leave both voided bills out',
    (select settled_orders from app.pos_day_summary(v_out, bd)) = 0,
    (select settled_orders || ' settled' from app.pos_day_summary(v_out, bd)));

  perform set_config('app.user_id', '', true);
end $$;


-- =============================================================================
-- THE BAR ROLE (the owner's D27-324 (2))
-- =============================================================================
-- `bar` is a role a person may be given; a Bar person puts on a bill only a
-- dish on the menu's Bar tab - its section sells under Bar or Alcohol,
-- whichever KOT it prints on (the owner's D27-329 (1)) - and cannot raise
-- the count of any other; a waiter is unchanged. Refers to
-- its migration by what it does, never by its number. Uses the suite's AGR
-- property and its clerk; makes one Bar person, one waiter, two sections, one
-- outlet and one order, and removes them. Each step through test.allows or
-- test.raises, so a database without the role fails by name.
-- =============================================================================
do $$
declare
  a uuid; v_clerk uuid; v_bar uuid; v_waiter uuid; v_outlet uuid; v_order uuid;
  v_food uuid; v_drinks uuid; v_dal uuid; v_beer uuid; v_dal_line bigint; bd date; n int;
begin
  select id into a from hotels where code = 'AGR';
  select id into v_clerk from staff where email = 'agra@fidato.in';
  bd := app.business_date(a);

  perform test.ok('pos bar role', 'bar is a role a person may be given',
    'bar' = any (app.assignable_roles()), array_to_string(app.assignable_roles(), ','));

  insert into staff (email, full_name) values ('bar-role@fidato.in', 'Bar Role Test')
  on conflict (email) do update set is_active = true returning id into v_bar;
  insert into staff (email, full_name) values ('waiter-role@fidato.in', 'Waiter Role Test')
  on conflict (email) do update set is_active = true returning id into v_waiter;
  delete from staff_hotels where staff_id in (v_bar, v_waiter);
  perform test.allows('pos bar role', 'a person is rostered as Bar',
    format($q$insert into staff_hotels (staff_id, hotel_id, role) values (%L, %L, 'bar')$q$, v_bar, a));
  insert into staff_hotels (staff_id, hotel_id, role) values (v_waiter, a, 'pos');

  -- A food section and a drinks section, each by its tax heading.
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (a, 'Bar role food', 'restaurant')
  returning id into v_food;
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (a, 'Bar role drinks', 'bar')
  returning id into v_drinks;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_food, 'Bar role dal', 200, 5) returning id into v_dal;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_drinks, 'Bar role beer', 300, 18) returning id into v_beer;
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'BARRL', 'Bar Role Test', 'food', v_clerk) returning id into v_outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_clerk) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, a, v_dal, 'Bar role dal', 2, 200, 5, v_clerk) returning id into v_dal_line;

  -- ---------- as the Bar person ------------------------------------------------
  perform set_config('app.user_id', v_bar::text, true);
  perform test.allows('pos bar role', 'a Bar person orders a dish on the Bar tab',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, 'Bar role beer', 2, 300, 18, %L)$q$, v_order, a, v_beer, v_bar));
  perform test.raises('pos bar role', 'and is refused a dish off it',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, 'Bar role dal', 1, 200, 5, %L)$q$, v_order, a, v_dal, v_bar), '42501');
  perform test.raises('pos bar role', 'and more of one the waiter put on',
    format($q$update pos_order_lines set qty = 3 where id = %s$q$, v_dal_line), '42501');
  perform test.allows('pos bar role', 'but may take one off',
    format($q$update pos_order_lines set qty = 1 where id = %s$q$, v_dal_line));
  update pos_menu_categories set kot_kind_id = (select id from pos_kot_kinds where hotel_id = a and role = 'bar')
   where id = v_food;
  perform test.raises('pos bar role', 'a food section sent to the Bar KOT is still not the bar''s (D27-329)',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, 'Bar role dal', 1, 200, 5, %L)$q$, v_order, a, v_dal, v_bar), '42501');
  update pos_menu_categories set kot_kind_id = null where id = v_food;
  update pos_menu_categories set kot_kind_id = (select id from pos_kot_kinds where hotel_id = a and role = 'food')
   where id = v_drinks;
  perform test.allows('pos bar role', 'a drinks section sent to the kitchen''s KOT is still the bar''s (D27-329)',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, 'Bar role beer', 1, 300, 18, %L)$q$, v_order, a, v_beer, v_bar));
  update pos_menu_categories set kot_kind_id = null where id = v_drinks;

  -- ---------- as the waiter: unchanged ----------------------------------------
  perform set_config('app.user_id', v_waiter::text, true);
  perform test.allows('pos bar role', 'a waiter still orders from the kitchen',
    format($q$insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
              values (%L, %L, %L, 'Bar role dal', 1, 200, 5, %L)$q$, v_order, a, v_dal, v_waiter));
  perform set_config('app.user_id', '', true);

  -- ---------- and the fixtures go ----------------------------------------------
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  delete from pos_outlets where id = v_outlet;
  delete from pos_menu_items where id in (v_dal, v_beer);
  delete from pos_menu_categories where id in (v_food, v_drinks);
  delete from staff_hotels where staff_id in (v_bar, v_waiter);
  update staff set is_active = false where id in (v_bar, v_waiter);
  select count(*) into n from pos_outlets where code = 'BARRL';
  perform test.ok('pos bar role', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- A REPRINTED KOT PRINTS AT THE STATION (the owner's D27-329 (2))
-- =============================================================================
-- Reprint asks for the slip again; it waits for the computer that prints that
-- KOT's kind, which claims it before the paper, as it claims a new KOT. Which
-- computer, and who may ask, are the API's (api/test/modules/pos/
-- kotReprint.test.ts). What the database holds to: a reprint asked is kept
-- until it is printed; the app may ask one and mark it printed, never change
-- what was asked nor remove it; row security keeps it to its hotel; a test
-- hotel counts it as trading.
-- =============================================================================
do $$
declare
  t boolean := to_regclass('public.pos_kot_reprints') is not null;
begin
  perform test.ok('pos kot reprint', 'a reprint asked is kept until the station prints it', t);
  perform test.ok('pos kot reprint', 'the app may ask one',
    case when t then has_table_privilege('pms_app', 'pos_kot_reprints', 'insert') else false end);
  perform test.ok('pos kot reprint', 'and mark it printed',
    case when t then has_column_privilege('pms_app', 'pos_kot_reprints', 'printed_at', 'update') else false end);
  perform test.ok('pos kot reprint', 'but never change which KOT was asked',
    case when t then not has_column_privilege('pms_app', 'pos_kot_reprints', 'kot_no', 'update')
                 and not has_column_privilege('pms_app', 'pos_kot_reprints', 'kind_id', 'update') else false end);
  perform test.ok('pos kot reprint', 'nor remove one',
    case when t then not has_table_privilege('pms_app', 'pos_kot_reprints', 'delete') else false end);
  perform test.ok('pos kot reprint', 'row security keeps it to its hotel',
    coalesce((select relforcerowsecurity from pg_class where oid = to_regclass('public.pos_kot_reprints')), false));
  perform test.ok('pos kot reprint', 'a test hotel counts it as trading',
    exists (select 1 from app.test_hotel_classes() c
             where c.table_name = 'pos_kot_reprints' and c.class = 'trading'));
end $$;


-- =============================================================================
-- A RESTAURANT BILL GIVEN FREE: NC (the owner's D27-351, 21 October)
-- =============================================================================
-- The owner, an administrator or the GM may close an OPEN bill as NC, no
-- charge, with a reason; their name is the approval. NC for good, its lines
-- frozen with it, and no sale: the day's sales read `status = 'settled'`.
-- =============================================================================
do $$
declare
  h uuid; waiter uuid; gm uuid; v_out uuid; bd date;
  open_bill uuid; paid_bill uuid; d text;
begin
  h := app.provision_property_unchecked('PNC', 'NC Rules Test', 'Nowhere');
  select id into waiter from staff where email = 'agra@fidato.in';
  select id into gm from staff where email = 'pune@fidato.in';
  insert into staff_hotels (staff_id, hotel_id, role) values (waiter, h, 'pos'), (gm, h, 'gm')
  on conflict (staff_id, hotel_id) do update set role = excluded.role;
  bd := app.business_date(h);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'NCT', 'NC Test', 'food', waiter) returning id into v_out;
  insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash)
  values (h, v_out, bd, 0);

  -- Two bills of ₹500 + 5% GST: one still open, one paid in cash.
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, waiter) returning id into open_bill;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, waiter) returning id into paid_bill;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  select o, h, 'Thali', 1, 500, 5, waiter from unnest(array[open_bill, paid_bill]) o;
  update pos_orders set status = 'settled', settled_by = waiter, settled_at = now(),
                        payment_method = 'cash'
   where id = paid_bill;
  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  values (paid_bill, h, 'cash', 525, waiter);

  -- ---------- who --------------------------------------------------------------
  perform set_config('app.user_id', waiter::text, true);
  perform test.raises('pos nc', 'a waiter cannot give a bill NC',
    format($q$update pos_orders set status = 'no_charge', nc_by = %L, nc_at = now(),
                     nc_reason = 'staff meal' where id = %L$q$, waiter, open_bill), '42501');

  -- ---------- which bills ------------------------------------------------------
  perform set_config('app.user_id', gm::text, true);
  perform test.raises('pos nc', 'a paid bill is not given NC (it is voided)',
    format($q$update pos_orders set status = 'no_charge', nc_by = %L, nc_at = now(),
                     nc_reason = 'x' where id = %L$q$, gm, paid_bill), '23514');
  perform test.raises('pos nc', 'NC says why',
    format($q$update pos_orders set status = 'no_charge', nc_by = %L, nc_at = now(),
                     nc_reason = '  ' where id = %L$q$, gm, open_bill), '23514');

  -- ---------- the GM gives the open bill NC -------------------------------------
  -- The row names the waiter as the giver; the database records who it is.
  perform test.allows('pos nc', 'the GM gives an open bill NC, with a reason',
    format($q$update pos_orders set status = 'no_charge', nc_by = %L, nc_at = now(),
                     nc_reason = 'Owner''s guests' where id = %L$q$, waiter, open_bill));
  select status into d from pos_orders where id = open_bill;
  perform test.ok('pos nc', 'the bill is NC', d = 'no_charge', d);
  perform test.ok('pos nc', 'NC records who: the GM, whoever the row named',
    (select nc_by from pos_orders where id = open_bill) = gm, 'someone else');

  perform test.raises('pos nc', 'NC stays NC',
    format($q$update pos_orders set status = 'open' where id = %L$q$, open_bill), '23514');
  perform test.raises('pos nc', 'and its reason stays as written',
    format($q$update pos_orders set nc_reason = 'something else' where id = %L$q$, open_bill), '23514');
  perform test.raises('pos nc', 'its lines are history: never changed',
    format($q$update pos_order_lines set qty = 2 where order_id = %L$q$, open_bill), '23000');

  -- ---------- no value ---------------------------------------------------------
  perform test.ok('pos nc', 'no sale: the day''s sales count the paid bill alone',
    (select settled_orders = 1 and settled_value = 525 from app.pos_day_summary(v_out, bd)),
    (select settled_orders || ' settled, ' || settled_value from app.pos_day_summary(v_out, bd)));

  perform set_config('app.user_id', '', true);
end $$;


-- =============================================================================
-- A DISH'S MRP (the owner's D27-373, 254): optional - none is NULL, a dash -
-- and a typed one is above zero, on a dish and on a variation alike.
-- =============================================================================
do $$
declare h uuid; cat uuid; dish uuid;
begin
  select id into h from hotels where code = 'PNC';
  insert into pos_menu_categories (hotel_id, name) values (h, 'MRP Test') returning id into cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (h, cat, 'Lassi', 50, 5) returning id into dish;
  perform test.ok('pos mrp', 'a new dish has none, whatever its price',
    (select mrp is null from pos_menu_items where id = dish));
  perform test.raises('pos mrp', 'a dish''s MRP is above zero',
    format('update pos_menu_items set mrp = 0 where id = %L', dish), '23514');
  perform test.allows('pos mrp', 'and is kept as typed',
    format('update pos_menu_items set mrp = 60 where id = %L', dish));
  perform test.raises('pos mrp', 'a variation''s MRP is above zero too',
    format($q$insert into pos_item_variations (hotel_id, item_id, label, price, kind, mrp)
              values (%L, %L, 'Half', 30, 'quantity', -1)$q$, h, dish), '23514');
end $$;
