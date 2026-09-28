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
