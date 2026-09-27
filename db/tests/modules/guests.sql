-- =============================================================================
-- GUESTS — the Form III register (app.form_iii, 147)
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

  select room_number into room from app.form_iii(h) where reservation_id = r0;
  perform test.ok('guests', 'a Form III stay with no room reads a plain "-" (GUE-2)',
    room = '-', 'got ' || coalesce(room, 'null'));

  -- ---------- the arrival clock -------------------------------------------------
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'GFC-CLOCK', g, t, current_date, current_date + 2, 2000, 'confirmed')
  returning id into r;
  update reservations set status = 'checked_in' where id = r;

  select * into f from app.form_iii(h) where reservation_id = r;
  perform test.ok('guests',
    'Form III: arrival is due 24 hours after the actual check-in, not the day after the date (17(5))',
    f.arrived_at = now() and f.arrival_due = now() + interval '24 hours',
    format('arrived %s, due %s', f.arrived_at, f.arrival_due));
  perform test.ok('guests', 'Form III: nothing is owed for departure while the guest is in house',
    f.departure_due is null and not f.departure_overdue,
    format('departure due %s', f.departure_due));

  -- ---------- the departure clock -----------------------------------------------
  update reservations set status = 'checked_out' where id = r;
  select * into f from app.form_iii(h) where reservation_id = r;
  perform test.ok('guests',
    'Form III: departure is due 24 hours after the actual check-out (17(6))',
    f.departed_at = now() and f.departure_due = now() + interval '24 hours',
    format('departed %s, due %s', f.departed_at, f.departure_due));

  -- ---------- overdue: both clocks run out -------------------------------------
  update audit_log set at = at - interval '25 hours'
   where table_name = 'reservations' and row_id = r::text;
  select * into f from app.form_iii(h) where reservation_id = r;
  perform test.ok('guests', 'Form III: 25 hours after arrival and departure, both are overdue',
    f.arrival_overdue and f.departure_overdue,
    format('arrival %s, departure %s', f.arrival_overdue, f.departure_overdue));

  -- ---------- filings: one number per person, each kind ------------------------
  insert into form_c_filings (hotel_id, reservation_id, guest_id, reference, kind)
  values (h, r, g, 'A-1', 'arrival'), (h, r, g, 'A-2', 'arrival'),
         (h, r, g, 'D-1', 'departure');
  select * into f from app.form_iii(h) where reservation_id = r;
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
  select * into f from app.form_iii(h) where reservation_id = r;
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
    not exists (select 1 from app.form_iii(h) where reservation_id = rin));

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
