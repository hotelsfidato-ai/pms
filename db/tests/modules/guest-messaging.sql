-- =============================================================================
-- GUEST MESSAGES — what the guest is owed, and their booking's own link
-- =============================================================================
-- Refers to its migration by what it does - "what the guest is owed" - never
-- by its number: the master settles the number at merge, in merge order.
--
-- Runs as the superuser like every file here; the two functions are ALSO
-- called as pms_app with nobody signed in, because that is how the sweep calls
-- them and it is the whole reason they are definers. Builds two properties of
-- its own and removes them.
--
-- WHY THE FUNCTIONS ARE TESTED HERE AND NOT ONLY THROUGH THE SWEEP (MEMORY
-- 318): jobs.ts asks `channelFor` before it mints a link and the route asks a
-- role before it reads the list. A guard behind a guard tests as one; these
-- knock on the inner door with the outer one out of the way.
-- =============================================================================
do $$
declare
  h uuid; other uuid; t uuid; t2 uuid;
  both_ uuid; nobody uuid;
  d date := (now() at time zone 'Asia/Kolkata')::date;
  r_old uuid; r_cancel uuid; r_tent uuid;
  n int; cnt int; v text; ok boolean; a1 boolean; a2 boolean; a3 boolean; a4 boolean;
begin
  -- ---------- two properties, three guests ----------------------------------
  h     := app.provision_property_unchecked('GMS', 'Messages Test', 'Nowhere');
  other := app.provision_property_unchecked('GMT', 'Messages Other', 'Nowhere');
  select id into t  from room_types where hotel_id = h     order by sort_order limit 1;
  select id into t2 from room_types where hotel_id = other order by sort_order limit 1;

  insert into guests (full_name, phone, email)
  values ('GMS Both', '+91 98765 00001', 'gms.both@example.com') returning id into both_;
  insert into guests (full_name) values ('GMS Nobody') returning id into nobody;

  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, whatsapp_agreed, created_at)
  values
    -- made a month ago, arriving in ten days: D21-33 says it is owed
    (h, both_,  t, 'GMS-A', d + 10, d + 12, 1, 'confirmed', 'direct', 1000, true,  now() - interval '30 days'),
    -- arrived yesterday on paper and still confirmed: in the past, owed nothing
    (h, both_,  t, 'GMS-B', d - 1,  d + 1,  1, 'confirmed', 'direct', 1000, false, now() - interval '30 days'),
    (h, both_,  t, 'GMS-C', d + 5,  d + 6,  1, 'tentative', 'direct', 1000, false, now()),
    (h, both_,  t, 'GMS-D', d + 5,  d + 6,  1, 'cancelled', 'direct', 1000, false, now()),
    -- arriving tomorrow: its confirmation went three days ago
    (h, both_,  t, 'GMS-E', d + 1,  d + 3,  1, 'confirmed', 'direct', 1000, false, now() - interval '5 days'),
    -- arriving tomorrow: its confirmation went two hours ago
    (h, both_,  t, 'GMS-F', d + 1,  d + 3,  1, 'confirmed', 'direct', 1000, false, now() - interval '3 hours'),
    -- arriving tomorrow: nothing sent yet
    (h, nobody, t, 'GMS-G', d + 1,  d + 2,  1, 'confirmed', 'direct', 1000, false, now() - interval '4 days'),
    -- three confirmations failed / two failed
    (h, both_,  t, 'GMS-H', d + 3,  d + 4,  1, 'confirmed', 'direct', 1000, false, now() - interval '5 days'),
    (h, both_,  t, 'GMS-I', d + 3,  d + 4,  1, 'confirmed', 'direct', 1000, false, now() - interval '5 days'),
    -- arriving tomorrow, confirmed and reminded already
    (h, both_,  t, 'GMS-J', d + 1,  d + 2,  1, 'confirmed', 'direct', 1000, false, now() - interval '5 days'),
    -- another property's
    (other, both_, t2, 'GMT-K', d + 2, d + 3, 1, 'confirmed', 'direct', 1000, false, now());

  select id into r_old    from reservations where reference = 'GMS-A';
  select id into r_cancel from reservations where reference = 'GMS-D';
  select id into r_tent   from reservations where reference = 'GMS-C';

  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status, sent_at)
  select h, 'whatsapp', s.kind, 'reservation', r.id::text, s.status, s.at
    from (values
      ('GMS-E', 'booking-confirmation', 'sent',   now() - interval '3 days'),
      ('GMS-F', 'booking-confirmation', 'sent',   now() - interval '2 hours'),
      ('GMS-H', 'booking-confirmation', 'failed', now() - interval '3 hours'),
      ('GMS-H', 'booking-confirmation', 'failed', now() - interval '2 hours'),
      ('GMS-H', 'booking-confirmation', 'failed', now() - interval '1 hour'),
      ('GMS-I', 'booking-confirmation', 'failed', now() - interval '2 hours'),
      ('GMS-I', 'booking-confirmation', 'failed', now() - interval '1 hour'),
      ('GMS-J', 'booking-confirmation', 'sent',   now() - interval '3 days'),
      ('GMS-J', 'arrival-reminder',     'sent',   now() - interval '1 hour')
    ) s(ref, kind, status, at)
    join reservations r on r.reference = s.ref and r.hotel_id = h;

  -- ---------- which bookings are owed, and in what order --------------------
  -- '00:00' opens the reminder's hour; the sweep passes the owner's.
  select string_agg(f.reference || ' ' || f.kind, ', ' order by f.ordinality) into v
    from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) with ordinality f;
  perform test.ok('guest-messaging',
    'owed, soonest arrival first: E''s reminder, G''s confirmation, I''s retry, A''s month-old booking',
    v = 'GMS-E arrival-reminder, GMS-G booking-confirmation, GMS-I booking-confirmation, GMS-A booking-confirmation',
    coalesce(v, 'nothing'));

  -- Each refusal on its own, so a broken one names itself.
  perform test.ok('guest-messaging', 'every future booking is owed, however long ago it was made (D21-33)',
    exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-A'));
  perform test.ok('guest-messaging', 'a window, when one is passed, still holds',
    not exists (select 1 from app.guest_messages_due(48, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-A'));
  perform test.ok('guest-messaging', 'a stay that began yesterday is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-B'));
  perform test.ok('guest-messaging', 'a tentative booking is not confirmed, so it is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-C'));
  perform test.ok('guest-messaging', 'a cancelled booking is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-D'));
  perform test.ok('guest-messaging', 'three failed attempts and it stops',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-H'));
  perform test.ok('guest-messaging', 'a confirmation already sent is not sent again',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                 where reference in ('GMS-E', 'GMS-J') and kind = 'booking-confirmation'));
  perform test.ok('guest-messaging', 'a reminder already sent is not sent again',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-J'));
  perform test.ok('guest-messaging', 'no reminder within a day of the confirmation that carried the same link',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where reference = 'GMS-F'));
  perform test.ok('guest-messaging', 'no reminder while the confirmation is still owed - one message, not two',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                 where reference = 'GMS-G' and kind = 'arrival-reminder'));
  -- '24:00' is later than any time of day, so this is the hour not yet come.
  perform test.ok('guest-messaging', 'the reminder waits for its hour on the property''s clock',
    not exists (select 1 from app.guest_messages_due(null, 3, '24:00', '00:00', '24:00', h) where kind = 'arrival-reminder')
    and exists (select 1 from app.guest_messages_due(null, 3, '24:00', '00:00', '24:00', h) where reference = 'GMS-G'));

  select count(*) into n from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) where hotel_id <> h;
  perform test.ok('guest-messaging', 'one property asked for, one property answered',
    n = 0 and exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', null) where reference = 'GMT-K'),
    n || ' rows from elsewhere');

  -- What the message needs, and the tick D21-72 turns on.
  select f.whatsapp_agreed and f.guest_phone = '+91 98765 00001'
         and f.guest_email = 'gms.both@example.com' and f.nights = 2
         and f.check_in = (d + 10)::text and f.hotel_code = 'GMS'
    into ok
    from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) f where f.reference = 'GMS-A';
  perform test.ok('guest-messaging', 'answers the WhatsApp tick, both addresses, the dates as text and the nights',
    coalesce(ok, false));
  perform test.ok('guest-messaging', 'an unticked booking answers false, never null',
    (select not whatsapp_agreed from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
      where reference = 'GMS-G' and kind = 'booking-confirmation'));

  -- ---------- the sweep's way in: nobody signed in, as pms_app --------------
  -- Answers are kept and asserted after `reset role`: the test schema is the
  -- superuser's, not the application's. A refused grant is caught, so it
  -- fails the assertions below by name instead of stopping every file after
  -- this one (MEMORY 289); the block's rollback undoes the role with it.
  perform set_config('app.user_id', '', true);
  begin
    set local role pms_app;
    select count(*) into n from reservations where hotel_id = h;
    select count(*) into cnt from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h);
    a1 := app.guest_booking_link_issue(r_old, repeat('a', 64));
    a2 := app.guest_booking_link_issue(r_old, 'the-token-itself');
    a3 := app.guest_booking_link_issue(r_cancel, repeat('b', 64));
    a4 := app.guest_booking_link_issue(r_tent, repeat('c', 64));
    reset role;
  exception when insufficient_privilege then
    reset role;
  end;

  perform test.ok('guest-messaging', 'with nobody signed in the API role reads no booking itself',
    n = 0, n || ' bookings visible');
  perform test.ok('guest-messaging', 'and still reads what is owed, through the definer',
    cnt = 4, cnt || ' rows');

  -- ---------- a booking's own link, minted the same way ---------------------
  perform test.ok('guest-messaging', 'a confirmed booking gets a link from a token''s hash', a1);
  perform test.ok('guest-messaging', 'a token that is not a hash is refused - never stored as one', not a2);
  perform test.ok('guest-messaging', 'no link for a cancelled booking', not a3);
  perform test.ok('guest-messaging', 'no link for a tentative one', not a4);

  select count(*) into n from guest_links where hotel_id = h;
  perform test.ok('guest-messaging', 'the refusals wrote nothing', n = 1, n || ' links');

  select l.origin = 'confirmation' and l.created_by is null and l.room_id is null
         and l.reservation_id = r_old
         and l.expires_at = app.hotel_moment(h, (d + 13)::text || 'T11:00')
    into ok
    from guest_links l where l.token_hash = repeat('a', 64);
  perform test.ok('guest-messaging',
    'the link is the booking''s, made by nobody, alive until 11:00 the morning after check-out',
    coalesce(ok, false));
  perform test.ok('guest-messaging', 'and never less than a day, for a stay already over',
    app.guest_link_expires(h, d - 5) = now() + interval '24 hours');

  -- ---------- who may call them ---------------------------------------------
  perform test.ok('guest-messaging', 'the API role may call both',
    has_function_privilege('pms_app', 'app.guest_messages_due(integer, integer, time, time, time, uuid)', 'execute')
    and has_function_privilege('pms_app', 'app.guest_booking_link_issue(uuid, text)', 'execute'));
  perform test.ok('guest-messaging', 'the read-only role may call neither - a guest''s contacts are not a report',
    not has_function_privilege('pms_readonly', 'app.guest_messages_due(integer, integer, time, time, time, uuid)', 'execute')
    and not has_function_privilege('pms_readonly', 'app.guest_booking_link_issue(uuid, text)', 'execute'));

  -- ---------- clean up ------------------------------------------------------
  perform set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true);
  delete from guest_links  where hotel_id in (h, other);
  delete from messages_sent where hotel_id in (h, other);
  delete from reservations where hotel_id in (h, other);
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (both_, nobody);
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('GMS', 'GMT');
  perform test.ok('guest-messaging', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);

-- =============================================================================
-- ONE PER GROUP (D22-41), AND THE CATCH-UP HOURS (D22-42)
-- =============================================================================
-- A property of its own, so the counts above are not disturbed. The windows
-- are passed as the sweep passes its own: '00:00' to '24:00' is every hour of
-- the day, '24:00' to '24:00' is none - so no assertion depends on the time
-- the suite happens to run.
do $$
declare
  h uuid; t uuid;
  booker uuid; other uuid;
  d date := (now() at time zone 'Asia/Kolkata')::date;
  grp uuid; grp2 uuid; grp3 uuid;
  lead uuid; lead2 uuid; second uuid;
  kept timestamptz;
  n int; v text; ok boolean; refused boolean;
begin
  -- Whatever the switch-on record held before this file, it is put back after.
  select began_at into kept from guest_messaging_began;
  delete from guest_messaging_began;

  h := app.provision_property_unchecked('GMU', 'Messages Groups', 'Nowhere');
  select id into t from room_types where hotel_id = h order by sort_order limit 1;

  insert into guests (full_name, phone, email)
  values ('GMU Booker', '+91 98765 00011', 'gmu.booker@example.com') returning id into booker;
  insert into guests (full_name, phone) values ('GMU Rooming', '+91 98765 00012') returning id into other;

  insert into reservation_groups (name, lead_hotel_id) values ('GMU Wedding', h)   returning id into grp;
  insert into reservation_groups (name, lead_hotel_id) values ('GMU Lead gone', h) returning id into grp2;
  insert into reservation_groups (name, lead_hotel_id) values ('GMU Tomorrow', h)  returning id into grp3;

  -- Three rooms booked together, in this order; the second and third have a
  -- different guest on them, as a rooming list would give them. The lead's
  -- tick is on, the others' off - the message follows the LEAD.
  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, whatsapp_agreed, group_id, created_at)
  values
    (h, booker, t, 'GMU-W1', d + 8, d + 10, 1, 'confirmed', 'direct', 1000, true,  grp,  now() - interval '30 days'),
    (h, other,  t, 'GMU-W2', d + 8, d + 10, 1, 'confirmed', 'direct', 1000, false, grp,  now() - interval '29 days'),
    (h, other,  t, 'GMU-W3', d + 8, d + 10, 1, 'confirmed', 'direct', 1000, false, grp,  now() - interval '28 days'),
    -- a group whose first room was cancelled before anything was sent
    (h, booker, t, 'GMU-L1', d + 9, d + 10, 1, 'cancelled', 'direct', 1000, true,  grp2, now() - interval '30 days'),
    (h, booker, t, 'GMU-L2', d + 9, d + 10, 1, 'confirmed', 'direct', 1000, true,  grp2, now() - interval '29 days'),
    (h, booker, t, 'GMU-L3', d + 9, d + 10, 1, 'confirmed', 'direct', 1000, true,  grp2, now() - interval '28 days'),
    -- a group arriving tomorrow whose confirmation went three days ago
    (h, booker, t, 'GMU-T1', d + 1, d + 2,  1, 'confirmed', 'direct', 1000, true,  grp3, now() - interval '10 days'),
    (h, booker, t, 'GMU-T2', d + 1, d + 2,  1, 'confirmed', 'direct', 1000, true,  grp3, now() - interval '10 days' + interval '1 second'),
    -- one room on its own, made after switch-on (set below)
    (h, booker, t, 'GMU-N',  d + 12, d + 13, 1, 'confirmed', 'direct', 1000, true, null, now() - interval '1 hour');

  select id into lead   from reservations where reference = 'GMU-W1';
  select id into second from reservations where reference = 'GMU-W2';
  select id into lead2  from reservations where reference = 'GMU-L2';

  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status, sent_at)
  select h, 'whatsapp', 'booking-confirmation', 'reservation', r.id::text, 'sent', now() - interval '3 days'
    from reservations r where r.reference = 'GMU-T1';

  -- ---------- one per group ------------------------------------------------
  select string_agg(f.reference || ' ' || f.kind, ', ' order by f.ordinality) into v
    from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) with ordinality f;
  perform test.ok('guest-messaging',
    'one message per group, about its lead booking; a room on its own is its own (D22-41)',
    v = 'GMU-T1 arrival-reminder, GMU-W1 booking-confirmation, GMU-L2 booking-confirmation, GMU-N booking-confirmation',
    coalesce(v, 'nothing'));

  select f.guest_name = 'GMU Booker' and f.whatsapp_agreed and f.guest_phone = '+91 98765 00011'
    into ok
    from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) f where f.reference = 'GMU-W1';
  perform test.ok('guest-messaging', 'to the lead guest, by the lead booking''s WhatsApp tick',
    coalesce(ok, false));

  perform test.ok('guest-messaging', 'the lead is the room booked first that still stands',
    exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
             where reference = 'GMU-L2')
    and not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                     where reference in ('GMU-L1', 'GMU-L3')));

  perform test.ok('guest-messaging', 'the reminder too goes once for the group, about its lead',
    (select count(*) from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
      where reference in ('GMU-T1', 'GMU-T2')) = 1);

  -- ---------- a group's lead, decided once (D22-52) -------------------------
  -- app.group_lead is asked directly, not only through the list (MEMORY 318).
  perform test.ok('guest-messaging', 'app.group_lead: by default the room booked first that still stands',
    app.group_lead(grp) = lead and app.group_lead(grp2) = lead2);

  update reservation_groups set lead_reservation_id = second where id = grp;
  perform test.ok('guest-messaging', 'app.group_lead: the room the desk assigned leads',
    app.group_lead(grp) = second);
  select string_agg(f.reference || ' ' || f.guest_name, ', ') into v
    from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h) f
   where f.reference like 'GMU-W%';
  perform test.ok('guest-messaging', 'and the group''s one confirmation goes to it, to its guest',
    v = 'GMU-W2 GMU Rooming', coalesce(v, 'nothing'));

  update reservations set status = 'cancelled' where id = second;
  perform test.ok('guest-messaging', 'app.group_lead: an assigned lead that no longer stands gives way to the default',
    app.group_lead(grp) = lead);
  update reservations set status = 'confirmed' where id = second;

  update reservation_groups set lead_reservation_id = lead2 where id = grp;
  perform test.ok('guest-messaging', 'app.group_lead: a room of another group cannot lead this one',
    app.group_lead(grp) = lead);
  update reservation_groups set lead_reservation_id = null where id = grp;

  perform test.ok('guest-messaging', 'app.group_lead: no group, no lead',
    app.group_lead(null) is null);
  perform test.ok('guest-messaging', 'app.group_lead: the API role may ask it, nobody else',
    has_function_privilege('pms_app', 'app.group_lead(uuid)', 'execute')
    and not has_function_privilege('pms_readonly', 'app.group_lead(uuid)', 'execute'));

  -- Two failures on one room and one on another are three for the group.
  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status, sent_at)
  values (h, 'whatsapp', 'booking-confirmation', 'reservation', lead::text,   'failed', now() - interval '2 hours'),
         (h, 'whatsapp', 'booking-confirmation', 'reservation', lead::text,   'failed', now() - interval '1 hour'),
         (h, 'whatsapp', 'booking-confirmation', 'reservation', second::text, 'failed', now() - interval '30 minutes');
  perform test.ok('guest-messaging', 'the attempts are counted for the group, not per room',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                 where reference like 'GMU-W%'));
  delete from messages_sent where hotel_id = h and status = 'failed';

  -- Sent about the lead: every room of the group is covered.
  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status, sent_at)
  values (h, 'whatsapp', 'booking-confirmation', 'reservation', lead::text, 'sent', now() - interval '1 hour');
  perform test.ok('guest-messaging', 'a group''s other rooms are covered by the lead''s confirmation',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                 where reference like 'GMU-W%'));

  -- And stay covered when the lead is cancelled after it went.
  update reservations set status = 'cancelled' where id = lead;
  perform test.ok('guest-messaging', 'and stay covered when the lead is cancelled afterwards',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
                 where reference like 'GMU-W%'));

  -- ---------- the catch-up hours (D22-42) -----------------------------------
  -- Nothing recorded: sending has never been on, so everything is a catch-up.
  perform test.ok('guest-messaging', 'before switch-on is recorded, every booking is a catch-up',
    (select bool_and(held) from app.guest_messages_due(null, 3, '00:00', '24:00', '24:00', h)
      where kind = 'booking-confirmation'));

  -- Switched on ten days ago: GMU-L2 (made 29 days ago) is a catch-up, GMU-N
  -- (an hour ago) is new.
  insert into guest_messaging_began (began_at) values (now() - interval '10 days');
  perform test.ok('guest-messaging', 'a catch-up confirmation is held outside its hours',
    (select held from app.guest_messages_due(null, 3, '00:00', '24:00', '24:00', h)
      where reference = 'GMU-L2'));
  perform test.ok('guest-messaging', 'and not held inside them',
    not (select held from app.guest_messages_due(null, 3, '00:00', '00:00', '24:00', h)
          where reference = 'GMU-L2'));
  perform test.ok('guest-messaging', 'a booking made after switch-on is confirmed at any hour',
    not (select held from app.guest_messages_due(null, 3, '00:00', '24:00', '24:00', h)
          where reference = 'GMU-N'));
  perform test.ok('guest-messaging', 'a held confirmation is still owed - the desk''s list does not change with the clock',
    exists (select 1 from app.guest_messages_due(null, 3, '00:00', '24:00', '24:00', h)
             where reference = 'GMU-L2'));
  perform test.ok('guest-messaging', 'a reminder is never held',
    not (select held from app.guest_messages_due(null, 3, '00:00', '24:00', '24:00', h)
          where reference = 'GMU-T1'));

  -- ---------- the switch-on moment is recorded once -------------------------
  ok := app.guest_messages_begin() = now() - interval '10 days';
  perform test.ok('guest-messaging', 'beginning again answers the moment first recorded',
    ok and (select count(*) from guest_messaging_began) = 1
    and (select began_at from guest_messaging_began) = now() - interval '10 days');
  delete from guest_messaging_began;
  -- Called first and kept: an uncorrelated count beside the call may be
  -- planned to run before it.
  ok := app.guest_messages_begin() = now();
  perform test.ok('guest-messaging', 'the first begin records now',
    ok and (select count(*) from guest_messaging_began) = 1);

  refused := false;
  begin
    insert into guest_messaging_began (only_one, began_at) values (false, now());
  exception when check_violation then refused := true;
  end;
  -- Cleans up after itself, so a broken guard fails here by name rather than
  -- stopping every assertion after it (MEMORY 289).
  delete from guest_messaging_began where not only_one;
  perform test.ok('guest-messaging', 'there is only ever one switch-on row', refused);

  -- Not by the application's role, directly: it could otherwise move the
  -- moment and turn old bookings into new ones.
  refused := false;
  begin
    set local role pms_app;
    update guest_messaging_began set began_at = now() - interval '100 days';
    reset role;
  exception when insufficient_privilege then
    reset role;
    refused := true;
  end;
  perform test.ok('guest-messaging', 'the API role cannot move the switch-on moment', refused);
  refused := false;
  begin
    set local role pms_app;
    delete from guest_messaging_began;
    reset role;
  exception when insufficient_privilege then
    reset role;
    refused := true;
  end;
  perform test.ok('guest-messaging', 'nor take it away', refused);
  perform test.ok('guest-messaging', 'the API role may record it through the function, the read-only role may not',
    has_function_privilege('pms_app', 'app.guest_messages_begin()', 'execute')
    and not has_function_privilege('pms_readonly', 'app.guest_messages_begin()', 'execute'));

  -- ---------- clean up ------------------------------------------------------
  delete from guest_messaging_began;
  if kept is not null then
    insert into guest_messaging_began (began_at) values (kept);
  end if;
  delete from messages_sent where hotel_id = h;
  delete from reservations where hotel_id = h;
  delete from reservation_groups where id in (grp, grp2, grp3);
  alter table guests disable trigger guests_no_delete;
  delete from guests where id in (booker, other);
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'GMU';
  perform test.ok('guest-messaging', 'the group fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- DAILY REPORT EMAILS (the owner's D27-280) - who may set them, what is owed
-- =============================================================================
-- Refers to its migration by what it does - "daily report emails". The table
-- is written by the hotel's owner, Administrator or GM only (the API asks
-- too); the sweep reads through app.daily_reports_due with nobody signed in.
do $$
declare
  h uuid; gm uuid; desk uuid; n int; v text; refused boolean;
  d date := (now() at time zone 'Asia/Kolkata')::date;
begin
  h := app.provision_property_unchecked('GMR', 'Reports Test', 'Nowhere');
  insert into staff (email, full_name) values ('gmr-gm@fidato.in', 'GMR Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('gmr-desk@fidato.in', 'GMR Desk')
  on conflict (email) do update set is_active = true returning id into desk;
  delete from staff_hotels where staff_id in (gm, desk);
  insert into staff_hotels (staff_id, hotel_id, role) values (gm, h, 'gm'), (desk, h, 'front_desk');

  -- ---------- the table: forced row security, the shared policy name ----------
  perform test.ok('daily report emails', 'row security is forced',
    exists (select 1 from pg_class where relname = 'daily_report_emails'
             and relrowsecurity and relforcerowsecurity));
  perform test.ok('daily report emails', 'under the shared policy name',
    (select string_agg(policyname, ',') from pg_policies where tablename = 'daily_report_emails') = 'hotel_isolation');

  -- ---------- reception may not write it; the GM may ----------
  perform set_config('app.user_id', desk::text, true);
  refused := false;
  begin
    set local role pms_app;
    insert into daily_report_emails (hotel_id, report, is_on, addresses, changed_by)
    values (h, 'manager', true, '{desk@example.com}', desk);
    reset role;
  exception when insufficient_privilege then reset role; refused := true;
  end;
  perform test.ok('daily report emails', 'reception cannot switch a report on', refused);

  perform set_config('app.user_id', gm::text, true);
  begin
    set local role pms_app;
    insert into daily_report_emails (hotel_id, report, is_on, addresses, changed_by, changed_at)
    values (h, 'night-audit', true, '{owner@example.com,gm@example.com}', gm, now() - interval '1 hour'),
           (h, 'manager', false, '{owner@example.com}', gm, now() - interval '1 hour');
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  select count(*) into n from daily_report_emails where hotel_id = h;
  perform test.ok('daily report emails', 'the GM can', n = 2, n || ' rows');

  perform set_config('app.user_id', desk::text, true);
  refused := false;
  begin
    set local role pms_app;
    update daily_report_emails set addresses = '{desk@example.com}' where hotel_id = h;
    reset role;
  exception when insufficient_privilege then reset role; refused := true;
  end;
  perform test.ok('daily report emails', 'nor change the addresses', refused);
  refused := false;
  begin
    set local role pms_app;
    delete from daily_report_emails where hotel_id = h;
    reset role;
  exception when insufficient_privilege then reset role; refused := true;
  end;
  perform test.ok('daily report emails', 'and nobody deletes one: off is a switch, not a gap', refused);

  refused := false;
  begin
    insert into daily_report_emails (hotel_id, report, is_on) values (h, 'lodging-tax', true);
  exception when check_violation then refused := true;
  end;
  perform test.ok('daily report emails', 'only the four reports', refused);

  -- ---------- what is owed after the audit ----------
  insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
  values (h, d - 2, 'completed', now() - interval '2 hours', now() - interval '2 hours'),
         (h, d - 1, 'completed', now(), now());
  perform set_config('app.user_id', '', true);
  begin
    set local role pms_app;
    select string_agg(o.business_date || ' ' || o.report || ' ' || o.address || ' ' || (o.built_by = gm), ', '
                      order by o.address)
      into v from app.daily_reports_due(3, h) o;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  perform test.ok('daily report emails',
    'after the audit, with nobody signed in: each address of each report on, built as the GM - not the one off, not an audit before the choice',
    v = format('%s night-audit gm@example.com true, %s night-audit owner@example.com true', d - 1, d - 1),
    coalesce(v, 'nothing'));

  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status)
  values (h, 'email', 'daily-report', 'night-audit', (d - 1)::text || '/night-audit/owner@example.com', 'sent'),
         (h, 'email', 'daily-report', 'night-audit', (d - 1)::text || '/night-audit/gm@example.com', 'failed'),
         (h, 'email', 'daily-report', 'night-audit', (d - 1)::text || '/night-audit/gm@example.com', 'failed');
  select string_agg(o.address, ', ') into v from app.daily_reports_due(3, h) o;
  perform test.ok('daily report emails', 'once per business date and address; two failures, still owed',
    v = 'gm@example.com', coalesce(v, 'nothing'));
  select count(*) into n from app.daily_reports_due(2, h);
  perform test.ok('daily report emails', 'and not after the last try', n = 0, n || ' owed');

  update staff set is_active = false where id = gm;
  select count(*) into n from app.daily_reports_due(3, h) o where o.built_by is not null and o.built_by <> gm;
  perform test.ok('daily report emails', 'the GM who saved it leaves: whoever runs the hotel now builds it', n = 1, n || ' owed');
  update staff set is_active = true where id = gm;

  update daily_report_emails set addresses = '{}' where hotel_id = h and report = 'night-audit';
  update daily_report_emails set changed_at = now() - interval '1 hour' where hotel_id = h;
  select count(*) into n from app.daily_reports_due(3, h);
  perform test.ok('daily report emails', 'no address, nothing owed', n = 0, n || ' owed');

  perform test.ok('daily report emails', 'the API role may ask what is owed, the read-only role may not',
    has_function_privilege('pms_app', 'app.daily_reports_due(integer, uuid)', 'execute')
    and not has_function_privilege('pms_readonly', 'app.daily_reports_due(integer, uuid)', 'execute'));

  -- ---------- clean up ----------
  perform set_config('app.user_id', '', true);
  delete from messages_sent where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (gm, desk);
  update staff set is_active = false where id in (gm, desk);
  select count(*) into n from hotels where code = 'GMR';
  perform test.ok('daily report emails', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- THE TAX INVOICE GOES BY ITSELF ONLY WHEN IT IS MADE OUT TO THE GUEST
-- (the owner's D27-313 (2), 13 October; D27-284 before it)
-- =============================================================================
-- The day check's 5EL/2026-27/00001: a guest's bill on a stay booked through
-- Expedia is made out to Expedia (finance's recipient rule, RECIPIENT_COMPANY:
-- a guest's bill carries the booking's company while the stay has no company
-- bill of its own), and app.guest_invoices_owed asked only the bill's bill_to,
-- so the invoice went to the guest by itself. Each invoice below is recorded
-- with the recipient that rule prints on it.
-- =============================================================================
do $$
declare
  h uuid; t uuid; g uuid; ota uuid; fy text; d date := (now() at time zone 'Asia/Kolkata')::date;
  r_own uuid; r_ota uuid; r_split uuid; f uuid; i_ota uuid; v text; n int;
begin
  h := app.provision_property_unchecked('GMI', 'Invoice Owed Test', 'Nowhere');
  select id into t from room_types where hotel_id = h order by sort_order limit 1;
  insert into guests (full_name, email) values ('GMI Guest', 'gmi.guest@example.com') returning id into g;
  insert into companies (name) values ('GMI Expedia') returning id into ota;
  insert into guest_message_settings (hotel_id, kind, is_on, switched_on_at)
  values (h, 'invoice', true, now() - interval '1 hour');
  fy := app.current_fin_year(h);

  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, company_id)
  values (h, g, t, 'GMI-OWN', d - 1, d, 1, 'confirmed', 'direct', 1000, null) returning id into r_own;
  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, company_id)
  values (h, g, t, 'GMI-OTA', d - 1, d, 1, 'confirmed', 'direct', 1000, ota) returning id into r_ota;
  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, company_id)
  values (h, g, t, 'GMI-SPLIT', d - 1, d, 1, 'confirmed', 'direct', 1000, ota) returning id into r_split;

  -- No company: the guest's own.
  insert into folios (hotel_id, reservation_id) values (h, r_own) returning id into f;
  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, f, fy, 'GMI-1', 'GMI Guest', 1050, 50);
  -- Booked through the site, one bill, the guest's: made out to the site.
  insert into folios (hotel_id, reservation_id) values (h, r_ota) returning id into f;
  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, f, fy, 'GMI-2', 'GMI Expedia', 1050, 50) returning id into i_ota;
  -- Split: the guest's bill to the guest, the company bill to the site.
  insert into folios (hotel_id, reservation_id) values (h, r_split) returning id into f;
  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, f, fy, 'GMI-3', 'GMI Guest', 1050, 50);
  insert into folios (hotel_id, reservation_id, bill_to, company_id) values (h, r_split, 'company', ota) returning id into f;
  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, f, fy, 'GMI-4', 'GMI Expedia', 1050, 50);

  select string_agg(o.number || ' ' || o.channel, ', ' order by o.number) into v
    from app.guest_invoices_owed(3, h, null) o;
  perform test.ok('invoice made out to the guest',
    'by itself: the guest''s own and a split stay''s guest bill - not one made out to the booking site though its bill is the guest''s, nor the company bill',
    v = 'GMI-1 email, GMI-3 email', coalesce(v, 'nothing'));
  select count(*) into n from app.guest_invoices_owed(3, h, i_ota) o where o.channel = 'email';
  perform test.ok('invoice made out to the guest', 'the desk''s Send invoice still sends the booking site''s',
    n = 1, n || ' rows');

  -- ---------- clean up: an issued invoice is never deleted, but for this ----------
  alter table invoices disable trigger invoices_immutable;
  alter table hotels disable trigger hotels_no_delete;
  delete from invoices where hotel_id = h;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  alter table invoices enable trigger invoices_immutable;
  delete from companies where id = ota;
  select count(*) into n from hotels where code = 'GMI';
  perform test.ok('invoice made out to the guest', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;
