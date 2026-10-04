-- =============================================================================
-- ROOMS, RATES AND TAX in the Settings console (P3; D27-258)
-- =============================================================================
-- Refers to its migration by what it does - "rooms, rates and tax" - never by
-- its number: the master renumbers at merge. The rules the database itself
-- keeps; builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; h2 uuid; rt uuid; refused boolean; r21 numeric; r22 numeric; g uuid; stay uuid; said text;
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

  /* D27-263: a new hotel starts empty - no automatic STD/DLX/EXE/STE. The
     fixtures and the demo still name a template; the door names none. */
  h2 := app.provision_property_unchecked('RRN', 'Rooms Empty Test', 'Nowhere', p_template_set => 'none');
  perform test.ok('rooms rates tax', 'a property with no template starts with no room types (D27-263)',
    not exists (select 1 from room_types where hotel_id = h2), '');
  perform test.ok('rooms rates tax', 'the Add a hotel door asks for no template (D27-263)',
    pg_get_functiondef('app.provision_property(text,text,text,text,text,text,text,text)'::regprocedure)
      like '%p_template_set => ''none''%', '');

  /* D27-258 Q7: a rule applies on the business dates it is valid for - one
     ended, one current, one not begun, all for the same slab. */
  insert into tax_rules (hotel_id, kind, over_amount, rate, valid_to)   values (h, 'other', 0, 12, app.business_date(h));
  insert into tax_rules (hotel_id, kind, over_amount, rate, valid_from) values (h, 'other', 0, 18, app.business_date(h));
  insert into tax_rules (hotel_id, kind, over_amount, rate, valid_from) values (h, 'other', 0, 28, app.business_date(h) + 1);
  perform test.ok('rooms rates tax', 'a tax rule applies on the business dates it is valid for (D27-258)',
    app.gst_rate_or_null(h, 'other', 100) = 18, coalesce(app.gst_rate_or_null(h, 'other', 100)::text, 'none'));

  /* The edge (the master, D27-258): one stay - its night of the 21st on the
     old rate, its night of the 22nd on the new one. The night audit posts each
     night on that night's business date. */
  insert into tax_rules (hotel_id, kind, over_amount, rate, valid_to)   values (h, 'room', 0, 12, date '2026-09-22');
  insert into tax_rules (hotel_id, kind, over_amount, rate, valid_from) values (h, 'room', 0, 5, date '2026-09-22');
  update hotels set business_date = date '2026-09-21' where id = h;
  r21 := app.gst_rate(h, 'room', 4000);
  update hotels set business_date = date '2026-09-22' where id = h;
  r22 := app.gst_rate(h, 'room', 4000);
  perform test.ok('rooms rates tax', 'the 21st on the old rate and the 22nd on the new, in one stay (D27-258)',
    r21 = 12 and r22 = 5, r21 || ' then ' || r22);

  /* D27-258 Q5: the voucher reads the booking hotel's meal days through a
     definer (the sweep has nobody signed in). */
  insert into hotel_meal_days (hotel_id, meal_plan, breakfast) values (h, 'CP', array['stay', 'departure']);
  insert into guests (full_name) values ('Meal Days Guest') returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, 'RRT-MEAL-1', g, rt, date '2026-09-21', date '2026-09-23', 1000, 'confirmed') returning id into stay;
  select array_to_string(breakfast, ',') into said from app.voucher_meal_days(stay) where meal_plan = 'CP';
  perform test.ok('rooms rates tax', 'the voucher reads the hotel''s meal days for the booking (D27-258 Q5)',
    said = 'stay,departure', coalesce(said, 'none'));
  delete from reservations where id = stay;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;

  -- ---------- and the fixtures go ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, h2);
  alter table hotels enable trigger hotels_no_delete;
end $$;
