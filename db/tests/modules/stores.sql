-- =============================================================================
-- STORES — what the hotel keeps, per store
-- =============================================================================
-- The Store service's own database checks. db/tests/suite.sql's `store` group
-- (069's ledger) is frozen history and still runs; these are what came after.
-- Builds its own properties and leaves them, like shared.sql.
-- =============================================================================


-- =============================================================================
-- STOCK HELD PER STORE, AND MOVES BETWEEN STORES (106)
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  main uuid; kitchen uuid; bar uuid; lobby uuid; theirs uuid;
  rice uuid; soap uuid;
  pair uuid; out_leg bigint; in_leg bigint; n int;
begin
  h     := app.provision_property_unchecked('STP', 'Stores Per Place', 'Nowhere');
  other := app.provision_property_unchecked('STQ', 'Stores Other', 'Nowhere');

  select id into main    from locations where hotel_id = h and name = 'Main store';
  select id into kitchen from locations where hotel_id = h and name = 'Kitchen store';
  select id into bar     from locations where hotel_id = h and name = 'Bar store';
  select id into theirs  from locations where hotel_id = other and name = 'Main store';
  insert into locations (hotel_id, name, kind) values (h, 'Lobby', 'public_area')
  returning id into lobby;

  insert into stock_items (hotel_id, name, unit) values (h, 'Basmati rice', 'kg') returning id into rice;
  insert into stock_items (hotel_id, name, unit) values (h, 'Soap', 'piece') returning id into soap;

  -- ---------- which store ----------
  perform test.ok('stores per store', 'the Main store is the one named Main store (D17-2)',
    app.main_store(h) = main);

  insert into stock_movements (hotel_id, item_id, business_date, kind, quantity, unit_cost)
  values (h, rice, app.business_date(h), 'receipt', 50, 90);
  perform test.ok('stores per store', 'a movement that names no store sits in the Main store (D17-2)',
    (select location_id from stock_movements where item_id = rice order by id limit 1) = main);

  perform test.raises('stores per store', 'a store at another property is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1)$q$, h, soap, theirs, h),
    '23514');
  perform test.raises('stores per store', 'a place that is not a store holds no stock',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1)$q$, h, soap, lobby, h),
    '23514');

  -- ---------- on hand per store ----------
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, rice, kitchen, app.business_date(h), 'receipt', 5);
  perform test.ok('stores per store', 'on hand is counted per store',
    app.stock_on_hand(rice, main) = 50 and app.stock_on_hand(rice, kitchen) = 5
      and app.stock_on_hand(rice, bar) = 0);
  perform test.ok('stores per store', 'and the total is every store together',
    app.stock_on_hand(rice) = 55);

  -- ---------- a move between stores ----------
  pair := app.transfer_stock(rice, main, kitchen, 12, null, 'For the week');
  select count(*) into n from stock_movements where transfer_id = pair;
  perform test.ok('stores per store', 'a move writes two halves', n = 2, n || ' written');
  perform test.ok('stores per store', 'the stock leaves one store and arrives in the other',
    app.stock_on_hand(rice, main) = 38 and app.stock_on_hand(rice, kitchen) = 17);
  perform test.ok('stores per store', 'and the total does not move', app.stock_on_hand(rice) = 55);

  perform test.raises('stores per store', 'a move to the store it is already in is refused',
    format($q$select app.transfer_stock(%L, %L, %L, 1, null)$q$, rice, main, main), '23514');
  perform test.raises('stores per store', 'a move of more than the store holds is refused',
    format($q$select app.transfer_stock(%L, %L, %L, 39, null)$q$, rice, main, bar), '23514');

  /* The check reads the rows a statement wrote, when the statement ends. A move
     writes both halves in one statement; one half on its own is refused. */
  perform test.raises('stores per store', 'half a move, on its own, is refused',
    format($q$insert into stock_movements
                (hotel_id, item_id, location_id, business_date, kind, quantity, transfer_id)
              values (%L, %L, %L, app.business_date(%L), 'transfer', -1, gen_random_uuid())$q$,
           h, rice, main, h),
    '23514');
  perform test.raises('stores per store', 'a move of an item to itself in one store is refused',
    format($q$insert into stock_movements
                (hotel_id, item_id, location_id, business_date, kind, quantity, transfer_id)
              select %L, %L, %L, app.business_date(%L), 'transfer', q, t
                from (values (-1), (1)) v(q), (select gen_random_uuid() as t) g$q$,
           h, rice, main, h),
    '23514');
  perform test.raises('stores per store', 'a transfer id on anything but a move is refused',
    format($q$insert into stock_movements
                (hotel_id, item_id, location_id, business_date, kind, quantity, transfer_id)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, gen_random_uuid())$q$,
           h, soap, main, h),
    '23514');

  -- ---------- undoing a move ----------
  /* Its own move, so that if this guard ever lets half an undo through, the
     assertions after it still run against a move nobody has touched. */
  declare other_pair uuid; other_in bigint;
  begin
    other_pair := app.transfer_stock(rice, main, bar, 1, null, 'For the half-undo check');
    select id into other_in from stock_movements where transfer_id = other_pair and quantity > 0;
    perform test.raises('stores per store', 'undoing only half a move is refused',
      format($q$insert into stock_movements
                  (hotel_id, item_id, location_id, business_date, kind, quantity, reverses_id)
                values (%L, %L, %L, app.business_date(%L), 'adjustment', -1, %s)$q$,
             h, rice, bar, h, other_in),
      '23514');
    perform app.reverse_stock_movement(other_in, null);
  exception when others then
    perform test.ok('stores per store', 'undoing only half a move is refused',
      false, 'the check let half an undo through: ' || sqlerrm);
  end;

  select id into out_leg from stock_movements where transfer_id = pair and quantity < 0;
  select id into in_leg  from stock_movements where transfer_id = pair and quantity > 0;

  perform app.reverse_stock_movement(in_leg, null);
  perform test.ok('stores per store', 'undoing either half of a move undoes both',
    (select count(*) from stock_movements where reverses_id in (out_leg, in_leg)) = 2);
  perform test.ok('stores per store', 'and the stock is back where it was',
    app.stock_on_hand(rice, main) = 50 and app.stock_on_hand(rice, kitchen) = 5);
  perform test.ok('stores per store', 'each undo is written in the store its half was in',
    (select location_id from stock_movements where reverses_id = out_leg) = main
      and (select location_id from stock_movements where reverses_id = in_leg) = kitchen);
  perform test.raises('stores per store', 'a move cannot be undone twice',
    format($q$select app.reverse_stock_movement(%s, null)$q$, out_leg), 'P0001');
end $$;


-- =============================================================================
-- LEVELS PER STORE, AND CYLINDERS FULL AND EMPTY (D25-12, D25-18)
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  main uuid; kitchen uuid; lobby uuid; theirs uuid;
  oil uuid; gas uuid; theirs_item uuid;
  back bigint;
begin
  h     := app.provision_property_unchecked('STL', 'Stores Levels', 'Nowhere');
  other := app.provision_property_unchecked('STM', 'Stores Levels Other', 'Nowhere');
  select id into main    from locations where hotel_id = h and name = 'Main store';
  select id into kitchen from locations where hotel_id = h and name = 'Kitchen store';
  select id into theirs  from locations where hotel_id = other and name = 'Main store';
  insert into locations (hotel_id, name, kind) values (h, 'Levels lobby', 'public_area')
  returning id into lobby;

  insert into stock_items (hotel_id, name, unit) values (h, 'Oil', 'litre') returning id into oil;
  insert into stock_items (hotel_id, name, unit) values (h, 'LPG', ' Cylinders ') returning id into gas;
  insert into stock_items (hotel_id, name, unit) values (other, 'Oil', 'litre') returning id into theirs_item;

  -- ---------- a level is per store, at this property ----------
  insert into stock_levels (hotel_id, item_id, location_id, reorder_level) values (h, oil, kitchen, 5);
  perform test.ok('stores levels', 'a level is set for one store',
    (select reorder_level from stock_levels where item_id = oil and location_id = kitchen) = 5);
  perform test.raises('stores levels', 'a level at another property''s store is refused',
    format($q$insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
              values (%L, %L, %L, 1)$q$, h, oil, theirs), '23514');
  perform test.raises('stores levels', 'a level at a place that is not a store is refused',
    format($q$insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
              values (%L, %L, %L, 1)$q$, h, oil, lobby), '23514');
  perform test.raises('stores levels', 'a level on another property''s item is refused',
    format($q$insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
              values (%L, %L, %L, 1)$q$, h, theirs_item, main), '23503');
  perform test.raises('stores levels', 'a level below zero is refused',
    format($q$insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
              values (%L, %L, %L, -1)$q$, h, oil, main), '23514');
  perform test.ok('stores levels', 'the application may not delete a level',
    not has_table_privilege('pms_app', 'stock_levels', 'DELETE'));

  -- ---------- empties are counted apart from full ----------
  perform test.ok('stores cylinders', 'an item counted in cylinders is a cylinder, whatever the case and spaces',
    app.counted_in_cylinders(' Cylinders ') and app.counted_in_cylinders('cylinder')
      and not app.counted_in_cylinders('kg'));

  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, gas, kitchen, app.business_date(h), 'receipt', 3, 1850);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, empty)
  values (h, gas, kitchen, app.business_date(h), 'receipt', 2, true)
  returning id into back;
  perform test.ok('stores cylinders', 'on hand is the full cylinders only',
    app.stock_on_hand(gas) = 3 and app.stock_on_hand(gas, kitchen) = 3);
  perform test.ok('stores cylinders', 'the empties are counted apart, per store and in all',
    app.stock_empties(gas, kitchen) = 2 and app.stock_empties(gas) = 2 and app.stock_empties(gas, main) = 0);
  perform test.ok('stores cylinders', 'an empty back does not change what a full cylinder cost',
    app.stock_unit_cost(gas) = 1850);

  perform test.raises('stores cylinders', 'an empty on an item not counted in cylinders is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, empty)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, true)$q$, h, oil, main, h),
    '23514');
  perform test.raises('stores cylinders', 'an empty carries no cost',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost, empty)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 10, true)$q$, h, gas, kitchen, h),
    '23514');
  perform test.raises('stores cylinders', 'an empty is not issued - it comes back, goes back, or is counted',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, empty)
              values (%L, %L, %L, app.business_date(%L), 'issue', -1, true)$q$, h, gas, kitchen, h),
    '23514');

  perform app.reverse_stock_movement(back, null);
  perform test.ok('stores cylinders', 'the undo of empties is itself marked empty',
    (select empty from stock_movements where reverses_id = back));
  perform test.ok('stores cylinders', 'undoing empties takes back empties, not full cylinders',
    app.stock_empties(gas) = 0 and app.stock_on_hand(gas) = 3);

  -- ---------- the deposit ----------
  perform test.raises('stores cylinders', 'a deposit below zero is refused',
    format($q$update stock_items set deposit_per_cylinder = -1 where id = %L$q$, gas), '23514');
  perform test.ok('stores cylinders', 'a deposit nobody typed is null, not zero',
    (select cylinders_on_deposit is null and deposit_per_cylinder is null from stock_items where id = gas));
end $$;


-- =============================================================================
-- GST ON A DELIVERY, EXPIRY, DEPARTMENT, BREAKAGE, THE COUNT'S RECORD (D27-238)
-- =============================================================================
do $$
declare
  h uuid; other uuid; main uuid; theirs uuid; restaurant uuid; lobby uuid;
  keeper uuid; rice uuid; plate uuid; theirs_item uuid;
  req uuid; line uuid; line_no_gst uuid;
  n bigint;
begin
  h     := app.provision_property_unchecked('STG', 'Stores GST', 'Nowhere');
  other := app.provision_property_unchecked('STH', 'Stores GST Other', 'Nowhere');
  select id into main   from locations where hotel_id = h and name = 'Main store';
  select id into theirs from locations where hotel_id = other and name = 'Main store';
  insert into staff (email, full_name) values ('st-keeper@fidato.in', 'Stores Keeper')
  on conflict (email) do update set is_active = true returning id into keeper;
  delete from staff_hotels where staff_id = keeper;
  insert into staff_hotels (staff_id, hotel_id, role) values (keeper, h, 'stores');

  insert into stock_items (hotel_id, name, unit) values (h, 'Rice', 'kg') returning id into rice;
  insert into stock_items (hotel_id, name, unit, crockery) values (h, 'Dinner plate', 'piece', true) returning id into plate;
  insert into stock_items (hotel_id, name, unit) values (other, 'Rice', 'kg') returning id into theirs_item;
  insert into locations (hotel_id, name, kind) values (h, 'Restaurant', 'restaurant') returning id into restaurant;
  insert into locations (hotel_id, name, kind) values (h, 'GST lobby', 'public_area') returning id into lobby;

  -- ---------- GST on a delivery: rate, amount, claimable - all three or none ----------
  perform test.allows('stores gst', 'a delivery records its GST: rate, amount, claimable',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                unit_cost, gst_rate, gst_amount, gst_claimable)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 10, 100, 5, 50, false)$q$, h, rice, main, h));
  perform test.allows('stores gst', 'a delivery without GST is not recorded, not zero',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 10, 100)$q$, h, plate, main, h));
  perform test.raises('stores gst', 'a rate without its amount is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                unit_cost, gst_rate, gst_claimable)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 100, 5, true)$q$, h, rice, main, h), '23514');
  perform test.raises('stores gst', 'GST without saying whether it can be claimed is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                unit_cost, gst_rate, gst_amount)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 100, 5, 5)$q$, h, rice, main, h), '23514');
  perform test.raises('stores gst', 'a rate over 100 is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                unit_cost, gst_rate, gst_amount, gst_claimable)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 100, 101, 5, true)$q$, h, rice, main, h), '23514');
  perform test.raises('stores gst', 'an amount below zero is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                unit_cost, gst_rate, gst_amount, gst_claimable)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 100, 5, -1, true)$q$, h, rice, main, h), '23514');
  perform test.raises('stores gst', 'GST on anything but a delivery is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity,
                gst_rate, gst_amount, gst_claimable)
              values (%L, %L, %L, app.business_date(%L), 'issue', -1, 5, 5, true)$q$, h, rice, main, h), '23514');

  -- ---------- expiry on a delivery, department on an issue ----------
  perform test.allows('stores gst', 'a delivery may carry an expiry date',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, expires_on)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, '2027-01-31')$q$, h, rice, main, h));
  perform test.raises('stores gst', 'an expiry on anything but a delivery is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, expires_on)
              values (%L, %L, %L, app.business_date(%L), 'wastage', -1, '2027-01-31')$q$, h, rice, main, h), '23514');
  perform test.allows('stores gst', 'an issue may name a department',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, department)
              values (%L, %L, %L, app.business_date(%L), 'issue', -1, 'Housekeeping')$q$, h, rice, main, h));
  perform test.raises('stores gst', 'a department on anything but an issue is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, department)
              values (%L, %L, %L, app.business_date(%L), 'receipt', 1, 'Kitchen')$q$, h, rice, main, h), '23514');
  perform test.raises('stores gst', 'a blank department is refused - none is null',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, department)
              values (%L, %L, %L, app.business_date(%L), 'issue', -1, '  ')$q$, h, rice, main, h), '23514');

  -- ---------- breakage, with who ----------
  perform test.allows('stores breakage', 'a breakage is recorded, with who broke it',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, broken_by)
              values (%L, %L, %L, app.business_date(%L), 'breakage', -2, %L)$q$, h, plate, main, h, keeper));
  perform test.ok('stores breakage', 'and takes the broken ones off the shelf',
    app.stock_on_hand(plate, main) = 8);
  perform test.allows('stores breakage', 'who broke it may be not known',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'breakage', -1)$q$, h, plate, main, h));
  perform test.raises('stores breakage', 'a breakage that adds stock is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'breakage', 1)$q$, h, plate, main, h), '23514');
  perform test.raises('stores breakage', 'who broke it, on anything but a breakage, is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, broken_by)
              values (%L, %L, %L, app.business_date(%L), 'wastage', -1, %L)$q$, h, plate, main, h, keeper), '23514');
  perform test.raises('stores breakage', 'a breakage carries no cost',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
              values (%L, %L, %L, app.business_date(%L), 'breakage', -1, 10)$q$, h, plate, main, h), '23514');
  perform test.raises('stores breakage', 'breakage is crockery''s - anything else is waste',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'breakage', -1)$q$, h, rice, main, h), '23514');

  -- ---------- crockery in use at an outlet place ----------
  perform app.transfer_stock(plate, main, restaurant, 4, keeper, 'Into use');
  perform test.ok('stores crockery', 'crockery moves into use at a restaurant place',
    app.stock_on_hand(plate, restaurant) = 4 and app.stock_on_hand(plate, main) = 3);
  perform test.allows('stores crockery', 'and breaks there, with who',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, broken_by)
              values (%L, %L, %L, app.business_date(%L), 'breakage', -1, %L)$q$, h, plate, restaurant, h, keeper));
  perform test.allows('stores crockery', 'its par is a level at that place',
    format($q$insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
              values (%L, %L, %L, 6)$q$, h, plate, restaurant));
  perform test.raises('stores crockery', 'anything else at a restaurant place is refused',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'adjustment', 1)$q$, h, rice, restaurant, h), '23514');
  perform test.raises('stores crockery', 'and crockery is not kept in a lobby',
    format($q$insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
              values (%L, %L, %L, app.business_date(%L), 'adjustment', 1)$q$, h, plate, lobby, h), '23514');
  perform test.ok('stores crockery', 'every hotel counts food cost before GST (Q5)',
    (select food_cost_basis from hotels where id = h) = 'before_gst');

  -- ---------- every line of a count is kept ----------
  perform test.allows('stores counts', 'a counted line is kept, matched or not',
    format($q$insert into stock_count_lines (hotel_id, item_id, location_id, book, counted, counted_by, business_date)
              values (%L, %L, %L, 7, 7, %L, app.business_date(%L))$q$, h, plate, main, keeper, h));
  perform test.raises('stores counts', 'a counted line cannot be changed',
    format($q$update stock_count_lines set counted = 9 where item_id = %L$q$, plate), 'P0001');
  perform test.ok('stores counts', 'the application may not delete a counted line',
    not has_table_privilege('pms_app', 'stock_count_lines', 'DELETE')
      and not has_table_privilege('pms_app', 'stock_count_lines', 'UPDATE'));
  perform test.raises('stores counts', 'a count at another property''s store is refused',
    format($q$insert into stock_count_lines (hotel_id, item_id, location_id, book, counted, business_date)
              values (%L, %L, %L, 1, 1, app.business_date(%L))$q$, h, rice, theirs, h), '23514');
  perform test.raises('stores counts', 'a count of another property''s item is refused',
    format($q$insert into stock_count_lines (hotel_id, item_id, location_id, book, counted, business_date)
              values (%L, %L, %L, 1, 1, app.business_date(%L))$q$, h, theirs_item, main, h), '23503');
  perform test.raises('stores counts', 'a count below zero is refused',
    format($q$insert into stock_count_lines (hotel_id, item_id, location_id, book, counted, business_date)
              values (%L, %L, %L, 1, -1, app.business_date(%L))$q$, h, rice, main, h), '23514');

  -- ---------- a purchase line's GST and expiry, set at delivery ----------
  insert into purchase_requests (hotel_id, reference, store_id, reason, requested_by)
  values (h, 'PO-STG-TEST', main, 'For the GST check', keeper) returning id into req;
  insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity, unit_price)
  values (h, req, 1, rice, 10, 100) returning id into line;
  insert into purchase_request_lines (hotel_id, request_id, line_no, item_id, quantity, unit_price)
  values (h, req, 2, plate, 10, 100) returning id into line_no_gst;
  perform test.allows('stores gst', 'a purchase line takes its GST and expiry at delivery',
    format($q$update purchase_request_lines
                 set gst_rate = 5, gst_amount = 50, gst_claimable = true, expires_on = '2027-01-31'
               where id = %L$q$, line));
  perform test.raises('stores gst', 'a purchase line with half its GST is refused',
    format($q$update purchase_request_lines set gst_rate = 18 where id = %L$q$, line_no_gst), '23514');
end $$;


-- =============================================================================
-- AN ITEM'S COST IS A RUNNING AVERAGE, UPDATED AT EACH DELIVERY (D27-238)
-- =============================================================================
-- The all-time average of 069 priced rice bought in June at what was paid in
-- June, long after it was eaten. The running average moves at each delivery,
-- by what is on the shelf then; what goes out leaves at the average of its day.
do $$
declare
  h uuid; main uuid; kitchen uuid;
  dal uuid; ghee uuid; salt uuid; sugar uuid;
  waste bigint; late bigint; first_issue bigint;
begin
  h := app.provision_property_unchecked('STA', 'Stores Average', 'Nowhere');
  select id into main    from locations where hotel_id = h and name = 'Main store';
  select id into kitchen from locations where hotel_id = h and name = 'Kitchen store';
  insert into stock_items (hotel_id, name, unit) values (h, 'Dal', 'kg') returning id into dal;
  insert into stock_items (hotel_id, name, unit) values (h, 'Ghee', 'kg') returning id into ghee;
  insert into stock_items (hotel_id, name, unit) values (h, 'Salt', 'kg') returning id into salt;
  insert into stock_items (hotel_id, name, unit) values (h, 'Sugar', 'kg') returning id into sugar;

  -- 10 at 100, 5 go out, 5 more at 130: (5 x 100 + 5 x 130) / 10 = 115.
  -- The all-time average said (10 x 100 + 5 x 130) / 15 = 110.
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, dal, main, app.business_date(h), 'receipt', 10, 100);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, dal, main, app.business_date(h), 'issue', -5) returning id into first_issue;
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, dal, main, app.business_date(h), 'receipt', 5, 130);
  perform test.ok('stores average', 'a delivery moves the average by what is on the shelf then',
    app.stock_unit_cost(dal) = 115, 'got ' || coalesce(app.stock_unit_cost(dal)::text, 'null'));
  perform test.ok('stores average', 'what went out left at the average of its day',
    (select unit_value from app.stock_movement_costs(dal) where movement_id = first_issue) = 100);

  -- Shelf emptied, then bought again: the new price is the price.
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, ghee, main, app.business_date(h), 'receipt', 4, 50);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, ghee, main, app.business_date(h), 'issue', -4);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, ghee, main, app.business_date(h), 'receipt', 4, 80);
  perform test.ok('stores average', 'once the shelf is empty, the next delivery''s cost is the average',
    app.stock_unit_cost(ghee) = 80, 'got ' || coalesce(app.stock_unit_cost(ghee)::text, 'null'));

  -- A delivery nobody priced leaves the average as it was.
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, salt, main, app.business_date(h), 'receipt', 10, 100);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, salt, main, app.business_date(h), 'receipt', 10);
  perform test.ok('stores average', 'a delivery with no cost leaves the average as it was',
    app.stock_unit_cost(salt) = 100);
  -- 15 go out (5 left, at 100), then 5 at 160: (5 x 100 + 5 x 160) / 10 = 130.
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, salt, main, app.business_date(h), 'issue', -15);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, salt, main, app.business_date(h), 'receipt', 5, 160);
  perform test.ok('stores average', 'and the next priced delivery averages with what is left',
    app.stock_unit_cost(salt) = 130, 'got ' || coalesce(app.stock_unit_cost(salt)::text, 'null'));

  -- An undone delivery leaves the walk, as it leaves on hand; a move between
  -- stores does not change what the item cost; waste keeps its day's value.
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, sugar, main, app.business_date(h), 'receipt', 10, 40);
  perform app.transfer_stock(sugar, main, kitchen, 4, null);
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity)
  values (h, sugar, kitchen, app.business_date(h), 'wastage', -2) returning id into waste;
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost)
  values (h, sugar, main, app.business_date(h), 'receipt', 8, 70) returning id into late;
  perform test.ok('stores average', 'a move between stores does not change what an item cost',
    app.stock_unit_cost(sugar) = 55, 'got ' || coalesce(app.stock_unit_cost(sugar)::text, 'null'));
  perform test.ok('stores average', 'waste keeps the value of its day',
    (select unit_value from app.stock_movement_costs(sugar) where movement_id = waste) = 40);
  perform app.reverse_stock_movement(late, null);
  perform test.ok('stores average', 'an undone delivery leaves the average',
    app.stock_unit_cost(sugar) = 40, 'got ' || coalesce(app.stock_unit_cost(sugar)::text, 'null'));
  perform test.ok('stores average', 'and an undone row has no value of its own',
    not exists (select 1 from app.stock_movement_costs(sugar) where movement_id = late));
end $$;


-- =============================================================================
-- BAR STOCK (the owner's D27-354, 21 October; migration 235)
-- =============================================================================
-- What a bar dish takes is ml of a bottle or whole ones, one row per size. A
-- line SENT takes it off the bar's store as an issue marked with the line; a
-- struck one, a line still waiting and a dish with nothing set take nothing;
-- nothing is taken twice. The Bar stock report may be emailed.
-- =============================================================================
do $$
declare
  h uuid; v_staff uuid; v_out uuid; v_cat uuid; v_dish uuid; v_peg uuid; v_bottle uuid;
  v_order uuid; v_line bigint; v_struck bigint; v_bar uuid; v_store uuid; bd date; n numeric;
begin
  h := app.provision_property_unchecked('PBS', 'Bar Stock Test', 'Nowhere');
  select id into v_staff from staff where email = 'owner@fidato.in';
  /* Every KOT takes from the Bar counter (D27-361, 238), never the Bar store. */
  select id into v_bar from locations where hotel_id = h and is_bar_counter;
  select id into v_store from locations where hotel_id = h and is_bar_store;
  bd := app.business_date(h);
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'BSB', 'Bar Stock Bar', 'beverage', v_staff) returning id into v_out;
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (h, 'Whisky', 'bar') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price) values (h, v_cat, 'Blue', 300) returning id into v_dish;
  insert into pos_item_variations (hotel_id, item_id, label, price) values (h, v_dish, '60 ml', 200) returning id into v_peg;
  insert into stock_items (hotel_id, name, unit, category, size_ml)
  values (h, 'Blue 750 ml', 'bottle', 'Bar', 750) returning id into v_bottle;
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, moved_by)
  values (h, v_bottle, v_bar, bd, 'receipt', 6, v_staff), (h, v_bottle, v_store, bd, 'receipt', 6, v_staff);

  perform test.raises('bar stock', 'a dish takes ml or whole ones, not both',
    format($q$insert into bar_pours (hotel_id, item_id, variation_id, stock_item_id, ml, units)
              values (%L, %L, %L, %L, 60, 1)$q$, h, v_dish, v_peg, v_bottle), '23514');
  insert into bar_pours (hotel_id, item_id, variation_id, stock_item_id, ml) values (h, v_dish, v_peg, v_bottle, 60);
  perform test.raises('bar stock', 'one row per size',
    format($q$insert into bar_pours (hotel_id, item_id, variation_id, stock_item_id, ml)
              values (%L, %L, %L, %L, 30)$q$, h, v_dish, v_peg, v_bottle), '23505');

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, v_staff) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, h, v_dish, v_peg, 'Blue (60 ml)', 2, 200, 18, v_staff) returning id into v_line;
  perform test.ok('bar stock', 'a line still waiting takes nothing',
    app.stock_on_hand(v_bottle, v_bar) = 6, app.stock_on_hand(v_bottle, v_bar)::text);

  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1 where id = v_line;
  n := app.stock_on_hand(v_bottle, v_bar);
  perform test.ok('bar stock', 'sent, two 60 ml pegs take 0.16 of a 750 ml bottle', n = 5.84, n::text);
  perform test.ok('bar stock', 'from the Bar counter: the Bar store keeps its 6',
    app.stock_on_hand(v_bottle, v_store) = 6, app.stock_on_hand(v_bottle, v_store)::text);
  perform test.ok('bar stock', 'as an issue to the outlet, marked with the line',
    exists (select 1 from stock_movements where pos_line_id = v_line and kind = 'issue'
             and to_outlet = v_out and quantity = -0.16), 'not found');

  update pos_order_lines set kot_status = 'ready' where id = v_line;
  perform test.ok('bar stock', 'nothing is taken twice as it moves along',
    app.stock_on_hand(v_bottle, v_bar) = 5.84, app.stock_on_hand(v_bottle, v_bar)::text);

  insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by,
                               kot_status, kot_sent_at, kot_no, voided, voided_by, voided_at, void_reason, was_sent_when_voided)
  values (v_order, h, v_dish, v_peg, 'Blue (60 ml)', 1, 200, 18, v_staff, 'sent', now(), 1, true, v_staff, now(), 'x', true)
  returning id into v_struck;
  perform test.ok('bar stock', 'a struck line written as sent takes nothing more',
    app.stock_on_hand(v_bottle, v_bar) = 5.84, app.stock_on_hand(v_bottle, v_bar)::text);

  insert into daily_report_emails (hotel_id, report, is_on) values (h, 'bar-stock', false);
  perform test.ok('bar stock', 'the Bar stock report may be emailed',
    exists (select 1 from daily_report_emails where hotel_id = h and report = 'bar-stock'), 'not saved');
  perform test.ok('bar stock', 'a test hotel copies what each dish takes as setup',
    exists (select 1 from app.test_hotel_classes() c where c.table_name = 'bar_pours' and c.class = 'setup'));
end $$;

-- =============================================================================
-- THE KITCHEN'S STOCK AND RECIPES (the owner's D27-373, D27-374; migration 253)
-- =============================================================================
-- Nothing is marked the kitchen's store by the migration, and the bar's never
-- is. A line SENT takes its dish's recipe and its size's on top; a line still
-- waiting and a dish with no recipe take nothing; nothing is taken twice.
-- Struck once sent, the issue is undone and written again as wastage with the
-- reason - stock does not move. A recipe line has one owner.
-- =============================================================================
do $$
declare
  h uuid; v_staff uuid; v_out uuid; v_cat uuid; v_dish uuid; v_plain uuid; v_full uuid; v_paneer uuid;
  v_kitchen uuid; v_bar uuid; v_order uuid; v_line bigint; v_bare bigint; bd date; n numeric;
begin
  h := app.provision_property_unchecked('PKS', 'Kitchen Stock Test', 'Nowhere');
  select id into v_staff from staff where email = 'owner@fidato.in';
  select id into v_kitchen from locations where hotel_id = h and name = 'Kitchen store';
  select id into v_bar from locations where hotel_id = h and is_bar_store;
  bd := app.business_date(h);
  perform test.ok('kitchen stock', 'no store is marked the kitchen''s by the migration',
    not exists (select 1 from locations where hotel_id = h and is_kitchen_store));
  perform test.raises('kitchen stock', 'the bar''s store is never the kitchen''s',
    format('update locations set is_kitchen_store = true where id = %L', v_bar), '23514');
  update locations set is_kitchen_store = true where id = v_kitchen;

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'KSR', 'Kitchen Stock Restaurant', 'food', v_staff) returning id into v_out;
  insert into pos_menu_categories (hotel_id, name, tax_kind) values (h, 'Mains', 'restaurant') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price) values (h, v_cat, 'Tikka', 300) returning id into v_dish;
  insert into pos_menu_items (hotel_id, category_id, name, price) values (h, v_cat, 'Dal', 200) returning id into v_plain;
  insert into pos_item_variations (hotel_id, item_id, label, price) values (h, v_dish, 'Full', 400) returning id into v_full;
  insert into stock_items (hotel_id, name, unit, category) values (h, 'Paneer', 'kg', 'Dairy') returning id into v_paneer;
  insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, moved_by)
  values (h, v_paneer, v_kitchen, bd, 'receipt', 5, v_staff);

  perform test.raises('kitchen stock', 'a recipe line has one owner',
    format($q$insert into recipe_lines (hotel_id, item_id, numbered_addon_id, stock_item_id, quantity)
              values (%L, %L, gen_random_uuid(), %L, 1)$q$, h, v_dish, v_paneer), '23514');
  perform test.raises('kitchen stock', 'a recipe takes more than none',
    format($q$insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values (%L, %L, %L, 0)$q$,
           h, v_dish, v_paneer), '23514');
  insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values (h, v_dish, v_paneer, 0.1);
  insert into recipe_lines (hotel_id, item_id, variation_id, stock_item_id, quantity) values (h, v_dish, v_full, v_paneer, 0.1);
  perform test.raises('kitchen stock', 'an item once per recipe',
    format($q$insert into recipe_lines (hotel_id, item_id, stock_item_id, quantity) values (%L, %L, %L, 0.2)$q$,
           h, v_dish, v_paneer), '23505');

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, v_out, app.pos_next_order_no(h, bd), bd, v_staff) returning id into v_order;
  insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, h, v_dish, v_full, 'Tikka (Full)', 2, 400, 5, v_staff) returning id into v_line;
  insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, h, v_plain, 'Dal', 3, 200, 5, v_staff) returning id into v_bare;
  perform test.ok('kitchen stock', 'a line still waiting takes nothing',
    app.stock_on_hand(v_paneer, v_kitchen) = 5, app.stock_on_hand(v_paneer, v_kitchen)::text);

  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(), kot_no = 1 where order_id = v_order;
  n := app.stock_on_hand(v_paneer, v_kitchen);
  perform test.ok('kitchen stock', 'sent, two Full take the dish''s 0.1 and the size''s 0.1 each', n = 4.6, n::text);
  perform test.ok('kitchen stock', 'as one issue to the outlet, marked with the line',
    exists (select 1 from stock_movements where pos_line_id = v_line and kind = 'issue'
             and to_outlet = v_out and quantity = -0.4), 'not found');
  perform test.ok('kitchen stock', 'a dish with no recipe takes nothing',
    not exists (select 1 from stock_movements where pos_line_id = v_bare), 'took');
  update pos_order_lines set kot_status = 'ready' where id = v_line;
  perform test.ok('kitchen stock', 'nothing is taken twice as it moves along',
    app.stock_on_hand(v_paneer, v_kitchen) = 4.6, app.stock_on_hand(v_paneer, v_kitchen)::text);

  update pos_order_lines set voided = true, voided_by = v_staff, voided_at = now(), void_reason = 'burnt'
   where id = v_line;
  perform test.ok('kitchen stock', 'struck once sent: the stock does not move',
    app.stock_on_hand(v_paneer, v_kitchen) = 4.6, app.stock_on_hand(v_paneer, v_kitchen)::text);
  perform test.ok('kitchen stock', 'struck once sent: the issue undone, wastage with the reason',
    not exists (select 1 from stock_movements m where m.pos_line_id = v_line and m.kind = 'issue'
                 and not exists (select 1 from stock_movements r where r.reverses_id = m.id))
    and exists (select 1 from stock_movements where pos_line_id = v_line and kind = 'wastage'
                 and quantity = -0.4 and note = 'Struck after the KOT: burnt'), 'not as expected');
  perform test.ok('kitchen stock', 'a test hotel copies recipes as setup',
    exists (select 1 from app.test_hotel_classes() c where c.table_name = 'recipe_lines' and c.class = 'setup'));
end $$;
