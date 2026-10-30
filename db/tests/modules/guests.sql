-- =============================================================================
-- GUESTS — the Form III register (app.form_iii_people)
-- =============================================================================
-- Rule 17 of the Immigration and Foreigners Rules 2025 (D27-25): Form III to
-- the portal within 24 hours of ARRIVAL (17(5)) and the departure within 24
-- hours of DEPARTURE (17(6)), both measured from what happened - the instants
-- the audit log holds - not from a booking's dates.
-- GUE-2 (D27-1): a stay with no room reads a plain "-", never the long dash.
-- Builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; t uuid; g uuid; gin uuid; r0 uuid; r uuid; rin uuid;
  f record; room text;
begin
  h := app.provision_property_unchecked('GFC','Form III Test','Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 101);
  select id into t from room_types where hotel_id = h and code = 'STD';
  insert into guests (full_name, nationality) values ('Form III fixture guest', 'GB')
  returning id into g;
  insert into guests (full_name, nationality) values ('Form III Indian guest', 'IN')
  returning id into gin;

  -- ---------- GUE-2 -----------------------------------------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'GFC-NOROOM', g, t, date '2026-08-25', date '2026-08-26', 2000, 'checked_out')
  returning id into r0;

  select room_number into room from app.form_iii_people(h) where reservation_id = r0;
  perform test.ok('guests', 'a Form III stay with no room reads a plain "-" (GUE-2)',
    room = '-', 'got ' || coalesce(room, 'null'));

  -- ---------- the arrival clock -------------------------------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'GFC-CLOCK', g, t, current_date, current_date + 2, 2000, 'confirmed')
  returning id into r;
  update reservations set status = 'checked_in' where id = r;

  select * into f from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests',
    'Form III: arrival is due 24 hours after the actual check-in, not the day after the date (17(5))',
    f.arrived_at = now() and f.arrival_due = now() + interval '24 hours',
    format('arrived %s, due %s', f.arrived_at, f.arrival_due));
  perform test.ok('guests', 'Form III: nothing is owed for departure while the guest is in house',
    f.departure_due is null and not f.departure_overdue,
    format('departure due %s', f.departure_due));

  -- ---------- the departure clock -----------------------------------------------
  update reservations set status = 'checked_out' where id = r;
  select * into f from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests',
    'Form III: departure is due 24 hours after the actual check-out (17(6))',
    f.departed_at = now() and f.departure_due = now() + interval '24 hours',
    format('departed %s, due %s', f.departed_at, f.departure_due));

  -- ---------- overdue: both clocks run out -------------------------------------
  update audit_log set at = at - interval '25 hours'
   where table_name = 'reservations' and row_id = r::text;
  select * into f from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests', 'Form III: 25 hours after arrival and departure, both are overdue',
    f.arrival_overdue and f.departure_overdue,
    format('arrival %s, departure %s', f.arrival_overdue, f.departure_overdue));

  -- ---------- filings: one number per person, each kind ------------------------
  insert into form_c_filings (hotel_id, reservation_id, guest_id, reference, kind)
  values (h, r, g, 'A-1', 'arrival'), (h, r, g, 'A-2', 'arrival'),
         (h, r, g, 'D-1', 'departure');
  select * into f from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests',
    'Form III: two people in the room, two arrival numbers; filed is no longer overdue',
    f.arrival_numbers = array['A-1','A-2'] and f.departure_numbers = array['D-1']
      and not f.arrival_overdue and not f.departure_overdue,
    format('%s / %s', f.arrival_numbers, f.departure_numbers));

  perform test.raises('guests', 'Form III: the same number twice on one stay is refused',
    format($q$insert into form_c_filings (hotel_id, reservation_id, guest_id, reference, kind)
              values (%L, %L, %L, 'A-1', 'arrival')$q$, h, r, g), '23505');
  perform test.raises('guests', 'Form III: a filing is an arrival or a departure',
    format($q$insert into form_c_filings (hotel_id, reservation_id, guest_id, reference, kind)
              values (%L, %L, %L, 'V-1', 'visit')$q$, h, r, g), '23514');

  -- ---------- the particulars reach the register --------------------------------
  insert into form_iii_stays (hotel_id, reservation_id, arrived_from, purpose, next_destination,
                              mobile_abroad)
  values (h, r, 'Delhi', 'tourism', 'Jaipur', '+44 7700 000146');
  insert into guest_documents (guest_id, id_type, id_number, gender, visa_type)
  values (g, 'passport', 'P0000146', 'female', 'e-Tourist');
  select * into f from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests', 'Form III: the visit''s and the person''s particulars reach the register',
    f.arrived_from = 'Delhi' and f.purpose = 'tourism' and f.next_destination = 'Jaipur'
      and f.gender = 'female' and f.visa_type = 'e-Tourist' and f.passport = 'P0000146'
      and f.mobile_abroad = '+44 7700 000146',
    format('%s %s %s %s %s', f.arrived_from, f.purpose, f.next_destination, f.gender, f.visa_type));

  perform test.raises('guests', 'Form III: the purpose is one of the form''s seven',
    format($q$update form_iii_stays set purpose = 'holiday' where reservation_id = %L$q$, r),
    '23514');
  perform test.raises('guests', 'Form III: gender is one of the portal''s three',
    format($q$update guest_documents set gender = 'unknown' where guest_id = %L$q$, g),
    '23514');
  perform test.ok('guests', 'Form III: the app cannot delete a visit''s record (kept a year, 17(1))',
    not has_table_privilege('pms_app', 'form_iii_stays', 'delete'));

  -- ---------- an Indian guest owes nothing --------------------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'GFC-IN', gin, t, current_date, current_date + 1, 2000, 'checked_in')
  returning id into rin;
  perform test.ok('guests', 'Form III: an Indian guest is not on the register',
    not exists (select 1 from app.form_iii_people(h) where reservation_id = rin));

  -- ---------- clean up ------------------------------------------------------
  delete from form_c_filings where hotel_id = h;
  delete from form_iii_stays where hotel_id = h;
  delete from reservations where hotel_id = h;
  delete from guest_documents where guest_id in (g, gin);
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (g, gin);
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id = h;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;


-- =============================================================================
-- GUE-6 (the owner's D27-382): every adult in a room. A companion is a guest
-- record tied to the stay: their own row on the register, their own numbers,
-- their ID under the lead guest's protection, and taken off only unfiled.
-- =============================================================================
do $$
declare
  h uuid; there uuid; t uuid; clerk uuid; far uuid;
  lead uuid; bo uuid; ind uuid; gone uuid; r uuid; n bigint; v text; f record; ok boolean;
begin
  h     := app.provision_property_unchecked('GCM', 'Companions Test', 'Nowhere');
  there := app.provision_property_unchecked('GCX', 'Companions Elsewhere', 'Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 101);
  select id into t from room_types where hotel_id = h and code = 'STD';
  insert into staff (email, full_name) values ('gcm-clerk@fidato.in', 'GCM Clerk') returning id into clerk;
  insert into staff (email, full_name) values ('gcx-clerk@fidato.in', 'GCX Clerk') returning id into far;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk'), (far, there, 'front_desk');

  insert into guests (full_name, nationality) values ('GCM Lead', 'GB') returning id into lead;
  insert into guests (full_name, nationality) values ('GCM Bo', 'BR') returning id into bo;
  insert into guests (full_name, nationality) values ('GCM Indian', 'IN') returning id into ind;
  insert into guests (full_name, nationality) values ('GCM Gone', 'FR') returning id into gone;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            adults, agreed_rate, status)
  values (h, 'GCM-1', lead, t, current_date, current_date + 1, 3, 2000, 'checked_in') returning id into r;

  perform test.ok('guests', 'a companion''s table is row-secured, FORCE',
    (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'stay_companions'::regclass));
  perform test.ok('guests', 'the app adds a companion and neither changes nor deletes the link',
    has_table_privilege('pms_app', 'stay_companions', 'insert')
      and not has_table_privilege('pms_app', 'stay_companions', 'update')
      and not has_table_privilege('pms_app', 'stay_companions', 'delete'));

  insert into stay_companions (hotel_id, reservation_id, guest_id)
  values (h, r, bo), (h, r, ind), (h, r, gone);
  perform test.raises('guests', 'a person is on a stay once',
    format('insert into stay_companions (hotel_id, reservation_id, guest_id) values (%L, %L, %L)', h, r, bo),
    '23505');

  -- ---------- recorded ----------------------------------------------------------
  insert into guest_documents (guest_id, gender) values (gone, 'female');
  perform test.ok('guests', 'the lead counts; a companion with no number on record does not, whatever else is',
    app.stay_recorded(r) = 1, 'recorded ' || app.stay_recorded(r));
  insert into guest_documents (guest_id, id_type, id_number)
  values (bo, 'passport', 'B1234567'), (ind, 'aadhaar', '999941057058');
  perform test.ok('guests', 'each companion with a document number is recorded',
    app.stay_recorded(r) = 3, 'recorded ' || app.stay_recorded(r));

  -- ---------- the register --------------------------------------------------------
  insert into form_iii_stays (hotel_id, reservation_id, arrived_from) values (h, r, 'Delhi');
  insert into form_iii_stays (hotel_id, reservation_id, guest_id, arrived_from) values (h, r, bo, 'Goa');
  perform test.raises('guests', 'one visit''s answers per person: a second for the lead is refused',
    format('insert into form_iii_stays (hotel_id, reservation_id) values (%L, %L)', h, r), '23505');
  perform test.raises('guests', 'and a second for a companion',
    format('insert into form_iii_stays (hotel_id, reservation_id, guest_id) values (%L, %L, %L)', h, r, bo), '23505');

  select count(*) into n from app.form_iii_people(h) where reservation_id = r;
  perform test.ok('guests', 'every foreigner has a row; an Indian companion none',
    n = 3 and not exists (select 1 from app.form_iii_people(h) where guest_id = ind), n || ' rows');
  select * into f from app.form_iii_people(h) where guest_id = bo;
  perform test.ok('guests', 'a companion''s row is their own: name, passport, answers, the stay''s clock and count',
    f.guest_name = 'GCM Bo' and f.companion and f.passport = 'B1234567' and f.arrived_from = 'Goa'
      and f.adults = 3 and f.recorded = 3 and f.arrival_numbers = '{}',
    format('%s %s %s %s', f.guest_name, f.passport, f.arrived_from, f.recorded));
  select * into f from app.form_iii_people(h) where guest_id = lead;
  perform test.ok('guests', 'the lead''s row keeps the lead''s answers',
    not f.companion and f.arrived_from = 'Delhi', f.arrived_from);

  insert into form_c_filings (hotel_id, reservation_id, guest_id, reference, kind)
  values (h, r, lead, 'L-1', 'arrival'), (h, r, bo, 'B-1', 'arrival');
  perform test.ok('guests', 'each person''s numbers are their own',
    (select arrival_numbers from app.form_iii_people(h) where guest_id = lead) = array['L-1']
      and (select arrival_numbers from app.form_iii_people(h) where guest_id = bo) = array['B-1']);
  perform test.ok('guests', 'a filing is owed per person: the companion unfiled is still due',
    (select cardinality(arrival_numbers) = 0 from app.form_iii_people(h) where guest_id = gone));

  -- ---------- a companion's ID, as a lead guest's --------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*) into n from guest_documents where guest_id = bo;
  reset role;
  perform test.ok('guests', 'the hotel of the stay reads a companion''s document', n = 1, n::text);
  perform set_config('app.user_id', far::text, true);
  set local role pms_app;
  select count(*) into n from guest_documents where guest_id = bo;
  reset role;
  perform test.ok('guests', 'another hotel does not', n = 0, n::text);

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  update guest_documents set visa_number = 'V-CLERK' where guest_id = bo;
  reset role;
  perform test.ok('guests', 'the hotel of the stay corrects it',
    (select visa_number from guest_documents where guest_id = bo) = 'V-CLERK');

  -- ---------- taking a person off --------------------------------------------------
  perform set_config('app.user_id', far::text, true);
  set local role pms_app;
  ok := false;
  begin perform app.remove_companion(h, r, gone); exception when insufficient_privilege then ok := true; end;
  reset role;
  perform test.ok('guests', 'another hotel''s clerk cannot take anybody off', ok);

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  v := null;
  begin perform app.remove_companion(h, r, bo); exception when raise_exception then v := sqlerrm; end;
  reset role;
  perform test.ok('guests', 'a person with a filed Form III stays on the stay',
    v like '%kept for a year%' and exists (select 1 from stay_companions where guest_id = bo), coalesce(v, '-'));

  update guest_documents set id_type = 'passport', id_number = 'G1234567' where guest_id = gone;
  insert into form_iii_stays (hotel_id, reservation_id, guest_id, arrived_from) values (h, r, gone, 'Pune');
  set local role pms_app;
  ok := app.remove_companion(h, r, gone);
  reset role;
  perform test.ok('guests', 'taken off unfiled: the link, their answers and their ID go; the guest''s row stays',
    ok and not exists (select 1 from stay_companions where guest_id = gone)
       and not exists (select 1 from form_iii_stays where guest_id = gone)
       and not exists (select 1 from guest_documents where guest_id = gone)
       and exists (select 1 from guests where id = gone));
  set local role pms_app;
  ok := app.remove_companion(h, r, gone);
  reset role;
  perform test.ok('guests', 'nobody by that id on the stay: false, nothing happens', not ok);

  -- ---------- clean up ------------------------------------------------------
  perform set_config('app.user_id', '', true);
  delete from form_c_filings where hotel_id = h;
  delete from form_iii_stays where hotel_id = h;
  delete from stay_companions where hotel_id = h;
  delete from reservations where hotel_id = h;
  delete from guest_documents where guest_id in (lead, bo, ind, gone);
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (lead, bo, ind, gone);
  alter table guests enable trigger guests_no_delete;
  delete from staff_hotels where staff_id in (clerk, far);
  delete from staff where id in (clerk, far);
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id in (h, there);
  delete from hotels where id in (h, there);
  alter table hotels enable trigger hotels_no_delete;
end $$;


-- =============================================================================
-- WHO MAY ADD AND CHANGE A BOOKING SOURCE (082; D27-275 part 2)
-- =============================================================================
-- booking_sources' insert and update policies ask app.is_manager(), which
-- answered for a group administrator, the owner and the GM and refused the
-- Administrator. D27-275: an Administrator counts as a manager, as everywhere
-- else. Reception still does not.
-- =============================================================================
do $$
declare
  h uuid; adm uuid; desk uuid; src uuid; n int;
begin
  h := app.provision_property_unchecked('GBS', 'Booking Source Test', 'Nowhere');
  insert into staff (email, full_name) values ('d275-admin@fidato.in', 'D275 Administrator')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('d275-desk@fidato.in', 'D275 Reception')
  on conflict (email) do update set is_active = true returning id into desk;
  delete from staff_hotels where staff_id in (adm, desk);
  insert into staff_hotels (staff_id, hotel_id, role) values (adm, h, 'admin'), (desk, h, 'front_desk');

  -- ---------- the Administrator adds one and changes it ----------
  perform set_config('app.user_id', adm::text, true);
  perform test.ok('guests', 'an Administrator is a manager (D27-275)', app.is_manager());
  begin
    set local role pms_app;
    insert into booking_sources (name, kind) values ('D275 Admin Agent', 'other') returning id into src;
    update booking_sources set channel_code = 'D275' where id = src;
    get diagnostics n = row_count;
    reset role;
  exception when others then
    reset role;
    src := null; n := 0;
  end;
  perform test.ok('guests', 'an Administrator adds a booking source (D27-275)', src is not null);
  perform test.ok('guests', 'and changes it', n = 1, n || ' rows');

  -- ---------- reception does neither ----------
  perform set_config('app.user_id', desk::text, true);
  perform test.ok('guests', 'reception is not a manager', not app.is_manager());
  perform test.raises('guests', 'reception does not add a booking source',
    $q$set local role pms_app; insert into booking_sources (name, kind) values ('D275 Desk Agent', 'other')$q$,
    '42501');
  if src is not null then
    set local role pms_app;
    update booking_sources set channel_code = 'DESK' where id = src;
    get diagnostics n = row_count;
    reset role;
    perform test.ok('guests', 'nor change one', n = 0, n || ' rows');
  end if;
  perform set_config('app.user_id', '', true);

  -- ---------- clean up ----------
  delete from booking_sources where name in ('D275 Admin Agent', 'D275 Desk Agent');
  delete from staff_hotels where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;
