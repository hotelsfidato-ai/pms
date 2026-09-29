-- =============================================================================
-- ROOM SYSTEMS — the key-card record (D27-178)
-- =============================================================================
-- Refers to its migration by what it does, "the key-card record", never by its
-- number: the master renumbers whichever lane merges second.
--
-- The record answers "who cut a card for room 101, and when", so the database
-- holds it, and each rule is checked by trying to break it:
--   * nobody edits or deletes a row, the application least of all
--   * the person on a row is whoever is signed in, whatever the insert says
--   * an issue carries its cards and validity; a cancel carries neither
--   * one property cannot read another's
-- =============================================================================
do $$
declare
  h uuid; other uuid; clerk uuid; elsewhere uuid; owner uuid;
  guest uuid; stay uuid; room uuid; k bigint;
  n int; who uuid; failed boolean;
begin
  h     := app.provision_property_unchecked('RSY','Room Systems Test','Nowhere');
  other := app.provision_property_unchecked('RSZ','Room Systems Other','Nowhere');
  perform app.bulk_create_rooms(h, 'STD', 1::smallint, 101, 101);
  select id into room from rooms where hotel_id = h and number = '101';

  insert into staff (email, full_name) values ('rsy-clerk@fidato.in', 'Keys Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('rsy-else@fidato.in', 'Keys Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (elsewhere, other, 'gm');
  select id into owner from staff where email = 'owner@fidato.in';

  perform set_config('app.user_id', clerk::text, true);
  insert into guests (full_name) values ('Keys Guest') returning id into guest;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), guest,
          (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 1, 2000, 'checked_in')
  returning id into stay;

  -- ---------- the application records an issue, as whoever is signed in ------
  set local role pms_app;
  insert into key_cards (hotel_id, reservation_id, room_id, act, cards, valid_until,
                         why, outcome, answer, driver, by_staff)
  values (h, stay, room, 'issue', 2, now() + interval '1 day',
          'check_in', 'done', 'Stand-in: 2 cards for room 101.', 'stand-in', owner)
  returning id, by_staff into k, who;
  reset role;
  perform test.ok('room-systems','a row names whoever is signed in, not whoever the insert named',
    who = clerk, coalesce(who::text, 'null'));

  -- ---------- an issue carries cards and validity; a cancel's why fits it -----
  failed := false;
  begin
    insert into key_cards (hotel_id, reservation_id, room_id, act, why, outcome, driver)
    values (h, stay, room, 'issue', 'check_in', 'done', 'stand-in');
  exception when check_violation then failed := true;
  end;
  perform test.ok('room-systems','an issue without its cards and validity is refused',
    failed, 'an issue with no cards was recorded');

  failed := false;
  begin
    insert into key_cards (hotel_id, reservation_id, room_id, act, why, outcome, driver)
    values (h, stay, room, 'cancel', 'check_in', 'done', 'stand-in');
  exception when check_violation then failed := true;
  end;
  perform test.ok('room-systems','a cancel "at check-in" is refused',
    failed, 'a cancel with an issue''s reason was recorded');

  -- ---------- nobody edits or deletes the record ----------------------------
  failed := false;
  begin
    update key_cards set cards = 9 where id = k;
  exception when raise_exception then failed := true;
  end;
  perform test.ok('room-systems','a recorded card is never edited, even by the owner of the database',
    failed, 'a key_cards row was updated');

  set local role pms_app;
  failed := false;
  begin
    delete from key_cards where id = k;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('room-systems','the application cannot delete a recorded card',
    failed, 'a key_cards row was deleted by pms_app');

  -- ---------- one property cannot read another's ----------------------------
  perform set_config('app.user_id', elsewhere::text, true);
  set local role pms_app;
  select count(*) into n from key_cards where hotel_id = h;
  reset role;
  perform test.ok('room-systems','a property''s key cards are invisible at another property',
    n = 0, n || ' rows were readable from RSZ');

  -- ---------- clean up ------------------------------------------------------
  perform set_config('app.user_id', clerk::text, true);
  alter table key_cards disable trigger key_cards_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table key_cards enable trigger key_cards_append_only;
  delete from staff_hotels where staff_id in (clerk, elsewhere);
  update staff set is_active = false where id in (clerk, elsewhere);

  select count(*) into n from hotels where code in ('RSY', 'RSZ');
  perform test.ok('room-systems','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
