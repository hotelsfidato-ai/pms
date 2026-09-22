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
    from app.guest_messages_due(null, 3, '00:00', h) with ordinality f;
  perform test.ok('guest-messaging',
    'owed, soonest arrival first: E''s reminder, G''s confirmation, I''s retry, A''s month-old booking',
    v = 'GMS-E arrival-reminder, GMS-G booking-confirmation, GMS-I booking-confirmation, GMS-A booking-confirmation',
    coalesce(v, 'nothing'));

  -- Each refusal on its own, so a broken one names itself.
  perform test.ok('guest-messaging', 'every future booking is owed, however long ago it was made (D21-33)',
    exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-A'));
  perform test.ok('guest-messaging', 'a window, when one is passed, still holds',
    not exists (select 1 from app.guest_messages_due(48, 3, '00:00', h) where reference = 'GMS-A'));
  perform test.ok('guest-messaging', 'a stay that began yesterday is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-B'));
  perform test.ok('guest-messaging', 'a tentative booking is not confirmed, so it is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-C'));
  perform test.ok('guest-messaging', 'a cancelled booking is owed nothing',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-D'));
  perform test.ok('guest-messaging', 'three failed attempts and it stops',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-H'));
  perform test.ok('guest-messaging', 'a confirmation already sent is not sent again',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h)
                 where reference in ('GMS-E', 'GMS-J') and kind = 'booking-confirmation'));
  perform test.ok('guest-messaging', 'a reminder already sent is not sent again',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-J'));
  perform test.ok('guest-messaging', 'no reminder within a day of the confirmation that carried the same link',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h) where reference = 'GMS-F'));
  perform test.ok('guest-messaging', 'no reminder while the confirmation is still owed - one message, not two',
    not exists (select 1 from app.guest_messages_due(null, 3, '00:00', h)
                 where reference = 'GMS-G' and kind = 'arrival-reminder'));
  -- '24:00' is later than any time of day, so this is the hour not yet come.
  perform test.ok('guest-messaging', 'the reminder waits for its hour on the property''s clock',
    not exists (select 1 from app.guest_messages_due(null, 3, '24:00', h) where kind = 'arrival-reminder')
    and exists (select 1 from app.guest_messages_due(null, 3, '24:00', h) where reference = 'GMS-G'));

  select count(*) into n from app.guest_messages_due(null, 3, '00:00', h) where hotel_id <> h;
  perform test.ok('guest-messaging', 'one property asked for, one property answered',
    n = 0 and exists (select 1 from app.guest_messages_due(null, 3, '00:00', null) where reference = 'GMT-K'),
    n || ' rows from elsewhere');

  -- What the message needs, and the tick D21-72 turns on.
  select f.whatsapp_agreed and f.guest_phone = '+91 98765 00001'
         and f.guest_email = 'gms.both@example.com' and f.nights = 2
         and f.check_in = (d + 10)::text and f.hotel_code = 'GMS'
    into ok
    from app.guest_messages_due(null, 3, '00:00', h) f where f.reference = 'GMS-A';
  perform test.ok('guest-messaging', 'answers the WhatsApp tick, both addresses, the dates as text and the nights',
    coalesce(ok, false));
  perform test.ok('guest-messaging', 'an unticked booking answers false, never null',
    (select not whatsapp_agreed from app.guest_messages_due(null, 3, '00:00', h)
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
    select count(*) into cnt from app.guest_messages_due(null, 3, '00:00', h);
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
    has_function_privilege('pms_app', 'app.guest_messages_due(integer, integer, time, uuid)', 'execute')
    and has_function_privilege('pms_app', 'app.guest_booking_link_issue(uuid, text)', 'execute'));
  perform test.ok('guest-messaging', 'the read-only role may call neither - a guest''s contacts are not a report',
    not has_function_privilege('pms_readonly', 'app.guest_messages_due(integer, integer, time, uuid)', 'execute')
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
