-- =============================================================================
-- GUESTS — the Form C register
-- =============================================================================
-- GUE-2 (D27-1): a foreign guest's stay with no room read "—" on the register,
-- from app.form_c_due's placeholder. The long dash is banned in what a person
-- reads (D17-48); the placeholder is a plain "-".
-- Builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; t uuid; g uuid; r uuid; room text;
begin
  h := app.provision_property_unchecked('GFC','Form C Test','Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 101);
  select id into t from room_types where hotel_id = h and code = 'STD';
  insert into guests (full_name, nationality) values ('Form C fixture guest', 'GB')
  returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, 'GFC-NOROOM', g, t, date '2026-08-25', date '2026-08-26', 2000, 'checked_out')
  returning id into r;

  select room_number into room from app.form_c_due(h) where reservation_id = r;
  perform test.ok('guests', 'a Form C stay with no room reads a plain "-" (GUE-2)',
    room = '-', 'got ' || coalesce(room, 'null'));

  -- ---------- clean up ------------------------------------------------------
  delete from reservations where hotel_id = h;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id = h;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;
