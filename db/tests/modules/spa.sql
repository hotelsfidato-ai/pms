-- =============================================================================
-- SPA — treatments, the day diary, and what was agreed
-- =============================================================================
-- The spa service's own database checks. Builds its own properties and leaves
-- them, like shared.sql and stores.sql.
--
-- WHAT IS BEING GUARDED, in the order it matters:
--
--   1 · one therapist is not in two places at once, and the refusal NAMES the
--       appointment in the way;
--   2 · a time belongs to the PROPERTY, not to whatever zone the session
--       happens to be in (113, root MEMORY 297) — this file sets the session
--       to UTC on purpose, so a bare timestamp written anywhere in this
--       service fails HERE rather than in Akkalkot;
--   3 · nothing invents a price: an unpriced treatment makes an unpriced
--       appointment, and an unpriced appointment is a dash, never a zero.
-- =============================================================================

do $$
declare
  h uuid; other uuid; rt uuid; g uuid; res uuid;
  clerk uuid;
  massage uuid; facial uuid; unpriced uuid; retired uuid;
  priya uuid; sunita uuid; gone uuid; theirs uuid;
  a1 uuid; a2 uuid; a3 uuid;
  v_ends timestamptz; v_amount numeric; n int; v text;
begin
  h     := app.provision_property_unchecked('SPA', 'Spa Test', 'Nowhere');
  other := app.provision_property_unchecked('SPB', 'Spa Other', 'Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';

  insert into staff (email, full_name) values ('spa-clerk@fidato.in', 'Spa Test Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk');

  insert into guests (full_name, phone) values ('Spa Test Guest', '9000000077')
  returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, date '2027-03-01', date '2027-03-04', 3000, 'checked_in')
  returning id into res;

  -- The list. `unpriced` is the shipped state and the point of half this file.
  insert into spa_treatments (hotel_id, name, minutes, price)
  values (h, 'Swedish massage', 60, 2500) returning id into massage;
  insert into spa_treatments (hotel_id, name, minutes, price)
  values (h, 'Facial', 30, 1200) returning id into facial;
  insert into spa_treatments (hotel_id, name, minutes)
  values (h, 'Aromatherapy', 90) returning id into unpriced;
  insert into spa_treatments (hotel_id, name, minutes, price, is_active)
  values (h, 'Old rub', 60, 900, false) returning id into retired;

  insert into spa_therapists (hotel_id, name) values (h, 'Priya') returning id into priya;
  insert into spa_therapists (hotel_id, name) values (h, 'Sunita') returning id into sunita;
  insert into spa_therapists (hotel_id, name, is_active)
  values (h, 'Left the hotel', false) returning id into gone;
  insert into spa_therapists (hotel_id, name) values (other, 'Somebody else''s') returning id into theirs;


  -- ===========================================================================
  -- A TIME BELONGS TO THE PROPERTY (113, root MEMORY 297)
  -- ===========================================================================
  -- ⚠ THE SESSION IS PUT IN UTC FIRST, AND THAT IS THE WHOLE TEST.
  -- This laptop runs Asia/Calcutta, so a bare `'2027-03-01T11:00'::timestamptz`
  -- would mean the hotel's own clock BY ACCIDENT and every assertion below
  -- would pass with the bug in place. The hotel's server runs in GMT, where the
  -- same line means half past four in the afternoon. Written in UTC, only a
  -- conversion through `app.hotel_moment` can still land on eleven o'clock.
  perform set_config('timezone', 'UTC', true);

  a1 := app.book_spa_appointment(h, res, massage, priya, '2027-03-01T11:00', clerk);

  perform test.ok('spa clock', 'a time typed at the property is read on the property''s clock, not the session''s (MEMORY 297)',
    app.hotel_clock(h, (select starts_at from spa_appointments where id = a1)) = '2027-03-01T11:00',
    coalesce(app.hotel_clock(h, (select starts_at from spa_appointments where id = a1)), 'null'));

  -- And the stored moment itself, in the zone the session is actually in.
  -- 11:00 at Asia/Kolkata is 05:30 UTC. A bare timestamp would have stored
  -- 11:00 UTC and this is the line that says so.
  perform test.ok('spa clock', 'eleven at the hotel is half past five in the morning UTC — the moment, not the wall clock',
    to_char((select starts_at from spa_appointments where id = a1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') = '2027-03-01T05:30',
    to_char((select starts_at from spa_appointments where id = a1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI'));

  -- ===========================================================================
  -- THE LENGTH COMES FROM THE TREATMENT
  -- ===========================================================================
  -- The caller says when it starts; the list says how long it runs. A caller
  -- that could also say when it ends could book ninety minutes into a
  -- thirty-minute slot.
  select ends_at into v_ends from spa_appointments where id = a1;
  perform test.ok('spa diary', 'a sixty-minute treatment ends sixty minutes later, from the list and not the caller',
    app.hotel_clock(h, v_ends) = '2027-03-01T12:00',
    coalesce(app.hotel_clock(h, v_ends), 'null'));

  -- ===========================================================================
  -- ONE THERAPIST IS NOT IN TWO PLACES AT ONCE
  -- ===========================================================================
  perform test.raises('spa diary', 'the same therapist at the same hour is refused',
    format($q$select app.book_spa_appointment(%L, %L, %L, %L, '2027-03-01T11:30', %L)$q$,
           h, res, facial, priya, clerk),
    'P0001');

  -- AND THE REFUSAL NAMES WHAT IS IN THE WAY. "conflicting key value violates
  -- exclusion constraint" is true and useless to a receptionist on a telephone.
  begin
    perform app.book_spa_appointment(h, res, facial, priya, '2027-03-01T11:30', clerk);
    perform test.ok('spa diary', 'the refusal names the appointment in the way', false, 'it did not refuse at all');
  exception when others then
    v := SQLERRM;
    perform test.ok('spa diary', 'the refusal names the therapist, the guest and the treatment standing in the way',
      v like '%Priya%' and v like '%Spa Test Guest%' and v like '%Swedish massage%', v);
  end;

  -- HALF-OPEN. Eleven-to-twelve and twelve-to-one sit beside each other.
  a2 := app.book_spa_appointment(h, res, facial, priya, '2027-03-01T12:00', clerk);
  perform test.ok('spa diary', 'a treatment starting as the last one ends is not an overlap',
    a2 is not null);

  -- ANOTHER THERAPIST AT THE SAME HOUR IS FINE. The rule is about a person,
  -- not about the clock.
  a3 := app.book_spa_appointment(h, res, massage, sunita, '2027-03-01T11:00', clerk);
  perform test.ok('spa diary', 'a second therapist takes the same hour',
    a3 is not null);

  -- A CANCELLATION RELEASES THE SLOT. A COMPLETED TREATMENT DOES NOT.
  update spa_appointments
     set status = 'cancelled', cancelled_by = clerk, cancelled_at = now(),
         cancel_reason = 'Guest went out'
   where id = a3;
  perform test.ok('spa diary', 'a cancelled appointment gives the hour back',
    app.book_spa_appointment(h, res, facial, sunita, '2027-03-01T11:00', clerk) is not null);

  perform test.raises('spa diary', 'a treatment already given still holds the hour it took',
    format($q$select app.book_spa_appointment(%L, %L, %L, %L, '2027-03-01T11:00', %L)$q$,
           h, res, facial, priya, clerk),
    'P0001');

  -- ===========================================================================
  -- NOTHING INVENTS A PRICE
  -- ===========================================================================
  perform test.ok('spa money', 'a priced treatment snapshots what the list says',
    (select agreed_amount from spa_appointments where id = a1) = 2500,
    coalesce((select agreed_amount::text from spa_appointments where id = a1), 'null'));

  select app.book_spa_appointment(h, res, unpriced, sunita, '2027-03-02T09:00', clerk) into a3;
  select agreed_amount into v_amount from spa_appointments where id = a3;
  perform test.ok('spa money', 'an unpriced treatment makes an UNPRICED appointment — null, never zero',
    v_amount is null, coalesce(v_amount::text, 'null'));

  -- The list moving does not reprice a treatment already booked.
  update spa_treatments set price = 3000 where id = massage;
  perform test.ok('spa money', 'repricing the list does not reprice an appointment already taken',
    (select agreed_amount from spa_appointments where id = a1) = 2500,
    coalesce((select agreed_amount::text from spa_appointments where id = a1), 'null'));

  -- ===========================================================================
  -- CLOSED MEANS SETTLED, AND A CANCELLATION SAYS WHY
  -- ===========================================================================
  perform test.raises('spa money', 'a treatment marked given with no settlement is refused',
    format($q$update spa_appointments set status = 'completed' where id = %L$q$, a2),
    '23514');

  perform test.raises('spa money', 'a settlement with nobody''s hand on it is refused',
    format($q$update spa_appointments
                set status = 'completed', settlement = 'room' where id = %L$q$, a2),
    '23514');

  perform test.raises('spa diary', 'a cancellation with no reason is refused',
    format($q$update spa_appointments set status = 'cancelled', cancelled_by = %L,
                cancelled_at = now() where id = %L$q$, clerk, a2),
    '23514');

  -- ===========================================================================
  -- WHAT IS NOT ON THE LIST CANNOT BE BOOKED
  -- ===========================================================================
  perform test.raises('spa list', 'a treatment taken off the list cannot be booked',
    format($q$select app.book_spa_appointment(%L, %L, %L, %L, '2027-03-03T10:00', %L)$q$,
           h, res, retired, sunita, clerk),
    'P0001');

  perform test.raises('spa list', 'a therapist who has left cannot be booked',
    format($q$select app.book_spa_appointment(%L, %L, %L, %L, '2027-03-03T10:00', %L)$q$,
           h, res, massage, gone, clerk),
    'P0001');

  perform test.raises('spa list', 'another property''s therapist is not this property''s to book',
    format($q$select app.book_spa_appointment(%L, %L, %L, %L, '2027-03-03T10:00', %L)$q$,
           h, res, massage, theirs, clerk),
    'P0001');

  perform test.raises('spa list', 'two treatments of one name at one property are refused',
    format($q$insert into spa_treatments (hotel_id, name, minutes) values (%L, 'Facial', 30)$q$, h),
    '23505');

  perform test.raises('spa list', 'a treatment with no length is refused',
    format($q$insert into spa_treatments (hotel_id, name, minutes) values (%L, 'No length', 0)$q$, h),
    '23514');

  perform test.raises('spa list', 'a price below nothing is refused',
    format($q$insert into spa_treatments (hotel_id, name, minutes, price) values (%L, 'Negative', 30, -1)$q$, h),
    '23514');

  -- ===========================================================================
  -- THE SPA BILLS UNDER ITS OWN GST RULE (the owner, 18 September)
  -- ===========================================================================
  -- Nothing is shipped, so a property that has not set the rate CANNOT bill a
  -- treatment. `app.gst_rate` raises rather than falling back -- the
  -- no-default-prices rule, applied to tax. This is the assertion that would
  -- catch somebody "helpfully" adding a default.
  -- 23514: `app.gst_rate` raises with errcode `check_violation`, deliberately
  -- (067) — a missing rate is a rule nobody has set, not a program fault.
  perform test.raises('spa money', 'a property that has not set a spa rate cannot bill a treatment',
    format($q$select app.gst_rate(%L, 'spa', 2500)$q$, h),
    '23514');

  insert into tax_rules (hotel_id, kind, over_amount, rate) values (h, 'spa', 0, 18);
  perform test.ok('spa money', 'the spa bills under its own rate, not the room''s and not "other"',
    app.gst_rate(h, 'spa', 2500) = 18, app.gst_rate(h, 'spa', 2500)::text);

  perform test.raises('spa money', 'a kind nobody sells under is still refused',
    format($q$insert into tax_rules (hotel_id, kind, over_amount, rate)
              values (%L, 'observatory', 0, 18)$q$, h),
    '23514');

  -- ===========================================================================
  -- THE DIARY
  -- ===========================================================================
  -- A therapist with nothing booked comes back EMPTY rather than missing:
  -- "who is free" is the question somebody is asking.
  select count(*) into n from app.spa_diary(h, date '2027-03-03', date '2027-03-03');
  perform test.ok('spa diary', 'a therapist with an empty day is still in the diary',
    n = (select count(*) from spa_therapists where hotel_id = h and is_active),
    n::text);

  -- A therapist who has left is not offered a day at all.
  perform test.ok('spa diary', 'a therapist who has left is not in the diary',
    not exists (select 1 from app.spa_diary(h, date '2027-03-01', date '2027-03-04')
                 where therapist_id = gone));

  -- The day is the PROPERTY's day. Still in UTC here: an eleven o'clock
  -- treatment belongs to 1 March at the hotel, and the diary says so.
  perform test.ok('spa diary', 'an appointment falls on the property''s own day',
    exists (select 1 from app.spa_diary(h, date '2027-03-01', date '2027-03-01')
             where appointment_id = a1));

  -- The guest and the room come through, and the room through app.room_for
  -- rather than a sixth spelling of that query.
  perform test.ok('spa diary', 'the diary names the guest the treatment is for',
    (select guest_name from app.spa_diary(h, date '2027-03-01', date '2027-03-01')
      where appointment_id = a1) = 'Spa Test Guest');

  -- A cancelled appointment is off the diary; the therapist's day is not.
  perform test.ok('spa diary', 'a cancelled appointment is not in the diary',
    not exists (select 1 from app.spa_diary(h, date '2027-03-01', date '2027-03-04')
                 where appointment_id is not null and status = 'cancelled'));

  -- ===========================================================================
  -- THE LEDGER IS NOT DELETED FROM
  -- ===========================================================================
  perform test.ok('spa list', 'nothing here may be deleted — a treatment goes inactive, an appointment is cancelled',
    not has_table_privilege('pms_app', 'spa_appointments', 'DELETE')
    and not has_table_privilege('pms_app', 'spa_treatments', 'DELETE')
    and not has_table_privilege('pms_app', 'spa_therapists', 'DELETE'));
end $$;
