-- =============================================================================
-- LAUNDRY — the price list, and a docket for every bag (docs/briefs/laundry.md)
-- =============================================================================
-- Refers to its migration by what it does — "the laundry service" — never by
-- its number: the master renumbers whichever of two lanes merges second.
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here; what the APPLICATION may do is checked through its
-- grants, and row isolation through FORCE.
--
-- WHAT THIS FILE IS FOR. Three of the service's rules are the database's, not a
-- screen's, and each one is checked here by trying to break it:
--   * a docket says whose it is, and the hotel's own can never be charged (D18-5)
--   * a bag with anything unpriced in it has NO total and cannot be charged
--   * nothing comes back that never went out
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  clerk uuid; elsewhere uuid;
  guest uuid; stay uuid; stay_other uuid;
  shirt uuid; saree uuid; sheet uuid;
  bag uuid; linen uuid;
  line_shirt uuid; line_saree uuid; line_sheet uuid;
  folio uuid; posting bigint;
  n int; v text; t numeric; failed boolean;
begin
  -- ---------- two properties ------------------------------------------------
  h     := app.provision_property_unchecked('LDY','Laundry Test','Nowhere');
  other := app.provision_property_unchecked('LDZ','Laundry Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 101);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);

  insert into staff (email, full_name) values ('ldy-clerk@fidato.in', 'Laundry Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('ldy-else@fidato.in', 'Laundry Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (elsewhere, other, 'gm');

  perform set_config('app.user_id', clerk::text, true);

  insert into guests (full_name) values ('Laundry Guest') returning id into guest;

  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest,
          (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 1, 2000, 'checked_in')
  returning id into stay;

  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (other, app.next_reference(other), guest,
          (select id from room_types where hotel_id = other limit 1),
          current_date, current_date + 1, 2000, 'confirmed')
  returning id into stay_other;

  -- ---------- the switch is OFF everywhere, and this file does not turn it on -
  perform test.ok('laundry','a property does not run a laundry until it is switched on',
    app.module_enabled(h, 'laundry') = false, 'it was already on');

  -- ---------- nothing ships -------------------------------------------------
  select count(*) into n from laundry_price_items where hotel_id = h;
  perform test.ok('laundry','a new property has an empty price list', n = 0, n || ' arrived');
  select count(*) into n from laundry_dockets where hotel_id = h;
  perform test.ok('laundry','a new property has no dockets', n = 0, n || ' arrived');

  -- ---------- an item may exist with NO price, for ever ---------------------
  insert into laundry_price_items (hotel_id, name, service, price, created_by)
  values (h, 'Shirt', 'wash', 60.00, clerk) returning id into shirt;
  insert into laundry_price_items (hotel_id, name, service, created_by)
  values (h, 'Saree', 'dry_clean', clerk) returning id into saree;
  insert into laundry_price_items (hotel_id, name, service, price, created_by)
  values (h, 'Bed sheet', 'wash', 25.00, clerk) returning id into sheet;

  select price into t from laundry_price_items where id = saree;
  perform test.ok('laundry','an item nobody has priced stays NULL, never 0',
    t is null, 'it came back as ' || coalesce(t::text, 'null'));

  -- one line per item and service, whatever the capitals
  failed := false;
  begin
    insert into laundry_price_items (hotel_id, name, service, price, created_by)
    values (h, '  shirt ', 'wash', 80.00, clerk);
  exception when unique_violation then failed := true;
  end;
  perform test.ok('laundry','the same item and service cannot be listed twice',
    failed, 'a second "shirt / wash" was accepted');

  -- the same name under a DIFFERENT service is a different line
  insert into laundry_price_items (hotel_id, name, service, price, created_by)
  values (h, 'Shirt', 'press', 30.00, clerk);
  perform test.ok('laundry','the same item under another service is its own line',
    true, '');

  -- ---------- D18-5: whose it is ------------------------------------------
  failed := false;
  begin
    insert into laundry_dockets (hotel_id, number, belongs_to, business_date, created_by)
    values (h, 'LD-9001', 'guest', current_date, clerk);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a guest''s docket cannot exist without a stay',
    failed, 'one was accepted with no stay on it');

  failed := false;
  begin
    insert into laundry_dockets (hotel_id, number, belongs_to, reservation_id,
                                 business_date, created_by)
    values (h, 'LD-9002', 'hotel', stay, current_date, clerk);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','the hotel''s own linen cannot belong to a stay',
    failed, 'one was accepted carrying a stay');

  failed := false;
  begin
    insert into laundry_dockets (hotel_id, number, belongs_to, reservation_id,
                                 business_date, created_by)
    values (h, 'LD-9003', 'whoever', stay, current_date, clerk);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a docket is a guest''s or the hotel''s and nothing else',
    failed, 'an unknown owner was accepted');

  -- a guest docket cannot name a stay at ANOTHER property
  failed := false;
  begin
    insert into laundry_dockets (hotel_id, number, belongs_to, reservation_id,
                                 business_date, created_by)
    values (h, 'LD-9004', 'guest', stay_other, current_date, clerk);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a docket cannot name a stay at another property',
    failed, 'another property''s stay was accepted');

  -- ---------- the numbering -------------------------------------------------
  perform test.ok('laundry','the first docket a property is offered is LD-0001',
    app.next_laundry_docket_number(h) = 'LD-0001', app.next_laundry_docket_number(h));

  insert into laundry_dockets (hotel_id, number, belongs_to, reservation_id,
                               business_date, created_by)
  values (h, app.next_laundry_docket_number(h), 'guest', stay, current_date, clerk)
  returning id into bag;
  perform test.ok('laundry','the next docket is LD-0002',
    app.next_laundry_docket_number(h) = 'LD-0002', app.next_laundry_docket_number(h));

  -- MEMORY 280: lpad CUTS. The thousandth docket must not become the second.
  insert into laundry_dockets (hotel_id, number, belongs_to, business_date, created_by)
  values (h, 'LD-9999', 'hotel', current_date, clerk);
  perform test.ok('laundry','after LD-9999 the numbering grows, it does not wrap',
    app.next_laundry_docket_number(h) = 'LD-10000', app.next_laundry_docket_number(h));
  delete from laundry_dockets where hotel_id = h and number = 'LD-9999';

  -- ---------- an unpriced line has no total, and no charge -----------------
  insert into laundry_docket_lines
    (hotel_id, docket_id, price_item_id, description, service, quantity, unit_price)
  values (h, bag, shirt, 'Shirt', 'wash', 2, 60.00) returning id into line_shirt;

  perform test.ok('laundry','a priced bag comes to what its lines come to',
    app.laundry_docket_total(bag) = 120.00,
    coalesce(app.laundry_docket_total(bag)::text, 'null'));

  insert into laundry_docket_lines
    (hotel_id, docket_id, price_item_id, description, service, quantity, unit_price)
  values (h, bag, saree, 'Saree', 'dry_clean', 1, null) returning id into line_saree;

  perform test.ok('laundry','one unpriced thing makes the WHOLE bag unpriced - not a part-total',
    app.laundry_docket_total(bag) is null,
    'it quoted ' || coalesce(app.laundry_docket_total(bag)::text, 'null'));

  -- and the charge is refused while that is true
  insert into folios (hotel_id, reservation_id, status) values (h, stay, 'open')
  returning id into folio;
  insert into folio_postings (hotel_id, folio_id, business_date, category,
                              description, amount)
  values (h, folio, current_date, 'laundry', 'Laundry LD-0001', 120.00)
  returning id into posting;

  failed := false;
  begin
    update laundry_dockets set charge_posting_id = posting where id = bag;
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a bag with anything unpriced in it cannot be charged',
    failed, 'the charge was attached anyway');

  -- price the saree, re-read the line, and it can be charged
  update laundry_price_items set price = 150.00 where id = saree;
  update laundry_docket_lines set unit_price = 150.00 where id = line_saree;
  perform test.ok('laundry','pricing the missing thing gives the bag a total',
    app.laundry_docket_total(bag) = 270.00,
    coalesce(app.laundry_docket_total(bag)::text, 'null'));

  update laundry_dockets set charge_posting_id = posting where id = bag;
  perform test.ok('laundry','a fully priced guest bag charges to the room', true, '');

  -- ---------- a charged bag is settled --------------------------------------
  failed := false;
  begin
    insert into laundry_docket_lines
      (hotel_id, docket_id, price_item_id, description, service, quantity, unit_price)
    values (h, bag, shirt, 'Shirt', 'wash', 1, 60.00);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','nothing is added to a bag that is already on the bill',
    failed, 'a line was added after the charge');

  failed := false;
  begin
    update laundry_docket_lines set quantity = 9 where id = line_shirt;
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a charged bag''s counts cannot be changed underneath the bill',
    failed, 'a quantity moved after the charge');

  -- ---------- the hotel's own linen: counted out and back ------------------
  insert into laundry_dockets (hotel_id, number, belongs_to, business_date, created_by)
  values (h, app.next_laundry_docket_number(h), 'hotel', current_date, clerk)
  returning id into linen;
  insert into laundry_docket_lines
    (hotel_id, docket_id, price_item_id, description, service, quantity, unit_price)
  values (h, linen, sheet, 'Bed sheet', 'wash', 40, 25.00) returning id into line_sheet;

  failed := false;
  begin
    update laundry_dockets set charge_posting_id = posting where id = linen;
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','the hotel''s own linen can NEVER be charged to anybody',
    failed, 'a hotel docket took a charge');

  update laundry_docket_lines set returned_quantity = 37 where id = line_sheet;
  select quantity - returned_quantity into n from laundry_docket_lines where id = line_sheet;
  perform test.ok('laundry','what is still out is what went out minus what came back',
    n = 3, n || ' still out');

  failed := false;
  begin
    update laundry_docket_lines set returned_quantity = 41 where id = line_sheet;
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','more cannot come back than ever went out',
    failed, '41 of 40 sheets came back');

  failed := false;
  begin
    insert into laundry_docket_lines
      (hotel_id, docket_id, description, service, quantity, unit_price)
    values (h, linen, 'Towel', 'wash', 0, 10.00);
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a line of nothing is not a line',
    failed, 'a quantity of 0 was accepted');

  -- ---------- "returned" and "came back at" are one fact --------------------
  failed := false;
  begin
    update laundry_dockets set status = 'returned' where id = linen;
  exception when check_violation then failed := true;
  end;
  perform test.ok('laundry','a docket cannot be marked returned with no time on it',
    failed, 'returned with no returned_at');

  -- ---------- a time belongs to its property (113) --------------------------
  update hotels set timezone = 'Asia/Kolkata' where id = h;
  update laundry_dockets
     set collected_at = app.hotel_moment(h, '2026-09-18T09:30')
   where id = linen;
  select app.hotel_clock(h, collected_at) into v from laundry_dockets where id = linen;
  perform test.ok('laundry','a time typed at the property reads back as the same time',
    v = '2026-09-18T09:30', coalesce(v, 'null'));

  -- ---------- one property cannot read another's ---------------------------
  perform set_config('app.user_id', elsewhere::text, true);
  set local role pms_app;
  select count(*) into n from laundry_dockets where hotel_id = h;
  reset role;
  perform test.ok('laundry','a property''s dockets are invisible at another property',
    n = 0, n || ' rows were readable from LDZ');

  perform set_config('app.user_id', clerk::text, true);

  -- ---------- the application may not delete history ------------------------
  set local role pms_app;
  failed := false;
  begin
    delete from laundry_dockets where id = linen;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('laundry','the application cannot delete a docket',
    failed, 'a docket was deleted by pms_app');

  -- ---------- clean up ------------------------------------------------------
  delete from laundry_docket_lines where hotel_id in (h, other);
  delete from laundry_dockets       where hotel_id in (h, other);
  delete from laundry_price_items   where hotel_id in (h, other);
  /* The folio the charge landed on goes with the property. `folio_postings`
     is append-only by trigger — correct for the ledger, and in the way of a
     fixture removing itself — so the delete is bracketed, exactly as the
     equipment register's file brackets its own append-only history. */
  alter table folio_postings disable trigger folio_postings_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table folio_postings enable trigger folio_postings_append_only;
  /* A guest is never deleted - stay history depends on the row (the database
     says so itself). The fixture leaves the person and takes the property. */
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  update staff set is_active = false where id in (clerk, elsewhere);

  select count(*) into n from hotels where code in ('LDY', 'LDZ');
  perform test.ok('laundry','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
