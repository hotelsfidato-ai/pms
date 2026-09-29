-- =============================================================================
-- LOYALTY — members, points, and points taken off a bill (D27-178, D27-179)
-- =============================================================================
-- Refers to its migration by what it does - "loyalty" - never by its number.
-- One check per rule of src/modules/loyalty/MODULE.md (L3-L16). Builds one
-- property of its own and removes it; every figure here is this file's own,
-- not a rate anybody has decided. The functions are called as pms_app, as the
-- API calls them.
-- =============================================================================
-- As the group's owner, so the file also runs on its own after the harness.
select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

do $$
declare
  h uuid; rt uuid; clerk uuid; gm uuid; g uuid; nophone uuid; twin uuid;
  res uuid; ota_res uuid; ota uuid; fol uuid; ota_fol uuid; bd date;
  n int; v text; line record; disc bigint;
  old_name text; old_rate numeric;
begin
  h := app.provision_property_unchecked('LOY', 'Loyalty Test', 'Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';
  bd := app.business_date(h);
  insert into staff (email, full_name) values ('loy-clerk@fidato.in', 'Loyalty Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('loy-gm@fidato.in', 'Loyalty GM')
  on conflict (email) do update set is_active = true returning id into gm;
  delete from staff_hotels where staff_id in (clerk, gm);
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk'), (gm, h, 'gm');

  insert into guests (full_name, phone) values ('Loyalty Guest', '+91 70000 55501') returning id into g;
  insert into guests (full_name) values ('No Phone Guest') returning id into nophone;
  insert into guests (full_name, phone) values ('Loyalty Twin', '+91 70000 55502') returning id into twin;

  insert into group_settings (id) values (1) on conflict (id) do nothing;
  select loyalty_name, loyalty_points_per_100 into old_name, old_rate from group_settings where id = 1;
  update group_settings set loyalty_name = null, loyalty_points_per_100 = null where id = 1;

  -- ---------- joining (L2, L3, L4) --------------------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  v := app.loyalty_join(h, g);
  reset role;
  perform test.ok('loyalty', 'nobody joins at a hotel where loyalty is off (L2)',
    v like 'Loyalty is off%', coalesce(v, 'joined'));

  insert into hotel_modules (hotel_id, module, is_enabled, changed_by) values (h, 'loyalty', true, clerk);
  set local role pms_app;
  v := app.loyalty_join(h, g);
  reset role;
  perform test.ok('loyalty', 'nobody joins a programme with no name: no words to agree to (L4)',
    v like 'The programme has no name%', coalesce(v, 'joined'));

  update group_settings set loyalty_name = 'Test Rewards' where id = 1;
  set local role pms_app;
  v := app.loyalty_join(h, nophone);
  reset role;
  perform test.ok('loyalty', 'a member needs a mobile number (L3)',
    v like 'A member needs a mobile number%', coalesce(v, 'joined'));

  set local role pms_app;
  v := app.loyalty_join(h, g);
  reset role;
  perform test.ok('loyalty', 'a guest joins, and the words they agreed to are kept (L4)',
    v is null and (select consent_words from loyalty_members where guest_id = g and left_at is null)
      = 'Join Test Rewards: we keep your stays and points to give you rewards. I am 18 or over.',
    coalesce(v, 'joined'));

  -- ---------- earning at check-out (L7-L10) -----------------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, bd - 2, bd, 3000, 'checked_in') returning id into res;
  insert into folios (hotel_id, reservation_id, status) values (h, res, 'open') returning id into fol;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount, tax_scheme)
  values (h, fol, bd, 'room',     'Room night',  3000, 5, 150, 'gst'),
         (h, fol, bd, 'room',     'Room night',  3000, 5, 150, 'gst'),
         (h, fol, bd, 'food',     'Dinner',      1000, 5,  50, 'gst'),
         (h, fol, bd, 'beverage', 'Whisky',       500, 10, 50, 'vat'),
         (h, fol, bd, 'payment',  'Cash',       -7000, 0,   0, 'gst');

  -- ---------- points off the bill (L13-L16) ------------------------------------
  set local role pms_app;
  perform set_config('app.user_id', gm::text, true);
  v := app.loyalty_adjust(h, g, 2000, 'Opening test balance');
  perform set_config('app.user_id', clerk::text, true);
  reset role;
  perform test.ok('loyalty', 'a manager adds points, with a reason (L6)',
    v is null and app.loyalty_balance(g) = 2000, coalesce(v, '') || ' balance ' || app.loyalty_balance(g));

  set local role pms_app;
  v := app.loyalty_adjust(h, g, 100, 'A clerk tries');
  reset role;
  perform test.ok('loyalty', 'a clerk may not add points (L6)', v like 'Points are added or taken by%', coalesce(v, 'added'));

  set local role pms_app;
  v := app.loyalty_redeem(res, 499);
  reset role;
  perform test.ok('loyalty', 'points are used from 500 (L13)', v like 'Points are used from 500%', coalesce(v, 'used'));

  set local role pms_app;
  v := app.loyalty_redeem(res, 2500);
  reset role;
  perform test.ok('loyalty', 'never more than the balance', v = 'The guest has 2000 points.', coalesce(v, 'used'));

  set local role pms_app;
  v := app.loyalty_redeem(res, 1500);
  reset role;
  select fp.id, fp.amount, fp.tax_rate, fp.tax_amount, fp.category into line
    from folio_postings fp where fp.folio_id = fol and fp.source_type = 'loyalty';
  disc := line.id;
  perform test.ok('loyalty', 'points go under the nights as a discount line, taxed at the nights'' rate (L13, CA-L1)',
    v is null and line.category = 'discount' and line.amount = -1500 and line.tax_rate = 5 and line.tax_amount = -75
      and (select count(*) from folio_postings where folio_id = fol and category = 'room') = 2,
    coalesce(v, '') || ' ' || coalesce(line::text, 'no line'));
  perform test.ok('loyalty', 'and the balance goes down by what was used', app.loyalty_balance(g) = 500,
    app.loyalty_balance(g)::text);

  -- 6000 of room less 1500 already taken: 4500 left; the guest has 500.
  update group_settings set loyalty_points_per_100 = 5 where id = 1;
  perform set_config('app.user_id', gm::text, true);
  set local role pms_app;
  v := app.loyalty_adjust(h, g, 5000, 'More for the test');
  perform set_config('app.user_id', clerk::text, true);
  v := app.loyalty_redeem(res, 5000);
  reset role;
  perform test.ok('loyalty', 'never more than the room charges left on the bill (L13)',
    v like 'Points come off room charges only, and this bill has ₹4500%', coalesce(v, 'used'));

  -- ↺ on the discount line gives the points back by itself.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount, reverses_id)
  values (h, fol, bd, 'discount', 'Reversal', 1500, 5, 75, disc);
  perform test.ok('loyalty', 'a reversed discount line gives its points back', app.loyalty_balance(g) = 7000,
    app.loyalty_balance(g)::text);

  -- Earning: 6000 room + 1000 food before GST; not the whisky (VAT), not the
  -- cash. 7000 x 5 / 100 = 350.
  update reservations set status = 'checked_out' where id = res;
  set local role pms_app;
  n := app.loyalty_earn(res);
  reset role;
  perform test.ok('loyalty', 'a stay earns before GST, not alcohol, not payments (L7, L8)', n = 350, n::text);
  set local role pms_app;
  n := app.loyalty_earn(res);
  reset role;
  perform test.ok('loyalty', 'and earns once: a second check-out earns nothing more (L9)',
    n = 0 and (select count(*) from loyalty_points where reservation_id = res and kind = 'earn') = 1, n::text);

  -- An OTA's booking earns on its extras only (L10), and cannot use points (L14).
  insert into booking_sources (name, kind) values ('Loyalty Test OTA', 'ota') returning id into ota;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status, booking_source_id)
  values (h, app.next_reference(h), g, rt, bd, bd + 1, 3000, 'checked_in', ota) returning id into ota_res;
  insert into folios (hotel_id, reservation_id, status) values (h, ota_res, 'open') returning id into ota_fol;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, ota_fol, bd, 'room', 'Room night', 3000, 5, 150),
         (h, ota_fol, bd, 'food', 'Lunch',       400, 5,  20);
  set local role pms_app;
  v := app.loyalty_redeem(ota_res, 500);
  reset role;
  perform test.ok('loyalty', 'points are not used on a booking site''s booking (L14)',
    v like 'Points are used on direct bookings only%', coalesce(v, 'used'));
  update reservations set status = 'checked_out' where id = ota_res;
  set local role pms_app;
  n := app.loyalty_earn(ota_res);
  reset role;
  perform test.ok('loyalty', 'a booking site''s stay earns on its extras, not the room (L10)', n = 20, n::text);

  -- ---------- one person, one balance (L3) --------------------------------------
  update guests set joined_into = g where id = twin;
  perform test.ok('loyalty', 'a record joined into a member''s shares their balance',
    app.loyalty_balance(twin) = app.loyalty_balance(g) and app.loyalty_member(twin) is not null);
  update guests set joined_into = null where id = twin;
  perform test.ok('loyalty', 'and an undo splits it back', app.loyalty_balance(twin) = 0 and app.loyalty_member(twin) is null);

  -- ---------- the ledger is append-only ----------------------------------------
  perform test.raises('loyalty', 'a points row is never changed',
    format('update loyalty_points set points = 1 where reservation_id = %L', res));

  -- ---------- leaving (L5) -------------------------------------------------------
  n := app.loyalty_balance(g);
  set local role pms_app;
  v := app.loyalty_leave(h, g);
  reset role;
  perform test.ok('loyalty', 'leaving lapses what is left, and the guest is no longer a member (L5)',
    v is null and app.loyalty_balance(g) = 0 and app.loyalty_member(g) is null
      and (select points from loyalty_points where kind = 'lapse' and hotel_id = h) = -n,
    coalesce(v, '') || ' balance ' || app.loyalty_balance(g));

  -- ---------- clean up ------------------------------------------------------------
  perform set_config('app.user_id', '', true);
  update group_settings set loyalty_name = old_name, loyalty_points_per_100 = old_rate where id = 1;
  alter table loyalty_points disable trigger loyalty_points_append_only;
  delete from loyalty_points where hotel_id = h;
  alter table loyalty_points enable trigger loyalty_points_append_only;
  delete from loyalty_members where hotel_id = h;
  alter table folio_postings disable trigger folio_postings_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table folio_postings enable trigger folio_postings_append_only;
  delete from booking_sources where id = ota;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (g, nophone, twin);
  alter table guests enable trigger guests_no_delete;
  delete from staff_hotels where staff_id in (clerk, gm);
  update staff set is_active = false where id in (clerk, gm);

  select count(*) into n from hotels where code = 'LOY';
  perform test.ok('loyalty', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
