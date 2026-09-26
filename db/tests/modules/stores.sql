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
  perform test.ok('stores cylinders', 'undoing empties takes back empties, not full cylinders',
    app.stock_empties(gas) = 0 and app.stock_on_hand(gas) = 3);

  -- ---------- the deposit ----------
  perform test.raises('stores cylinders', 'a deposit below zero is refused',
    format($q$update stock_items set deposit_per_cylinder = -1 where id = %L$q$, gas), '23514');
  perform test.ok('stores cylinders', 'a deposit nobody typed is null, not zero',
    (select cylinders_on_deposit is null and deposit_per_cylinder is null from stock_items where id = gas));
end $$;
