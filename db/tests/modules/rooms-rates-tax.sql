-- =============================================================================
-- ROOMS, RATES AND TAX in the Settings console (P3; D27-258)
-- =============================================================================
-- Refers to its migration by what it does - "rooms, rates and tax" - never by
-- its number: the master renumbers at merge. The rules the database itself
-- keeps; builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; rt uuid; refused boolean;
begin
  h := app.provision_property_unchecked('RRT', 'Rooms Rates Tax Test', 'Nowhere');
  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy, base_rate)
    values (h, 'RRT', 'Test Deluxe', 2, 3, 0) returning id into rt;

  update room_types set base_children = 1, max_adults = 3, max_children = 2,
         beds = '1 King', view_type = 'Garden', size_sqft = 320, colour = '#1f6f5c' where id = rt;
  perform test.ok('rooms rates tax', 'a room type takes adults and children, beds, view, size and colour',
    (select max_children = 2 and colour = '#1f6f5c' from room_types where id = rt), '');

  begin
    update room_types set max_children = 3 where id = rt;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'children stay below the total (SU''s own rule)', refused, '');

  begin
    update room_types set base_children = 2 where id = rt;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'base adults and children never pass the total', refused, '');

  begin
    update room_types set colour = 'green' where id = rt;
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'a colour is #rrggbb', refused, '');

  begin
    insert into hotel_meal_days (hotel_id, meal_plan, breakfast) values (h, 'CP', array['stay', 'brunch']);
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'a meal is served on arrival, stay or departure days only', refused, '');

  begin
    insert into tax_sac (hotel_id, kind, sac_code) values (h, 'restaurant', '99633');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'a SAC code is six digits', refused, '');

  begin
    insert into tax_rules (hotel_id, kind, rate, valid_from, valid_to)
      values (h, 'other', 5, date '2026-06-01', date '2026-05-01');
    refused := false;
  exception when check_violation then refused := true;
  end;
  perform test.ok('rooms rates tax', 'a tax rule ends after it starts', refused, '');

  -- ---------- and the fixtures go ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;
