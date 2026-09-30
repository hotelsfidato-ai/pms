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
