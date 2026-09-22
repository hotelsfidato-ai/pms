-- =============================================================================
-- THE CENTRAL CRM, PHASE 1 — one guest, one record (docs/briefs/crm.md)
-- =============================================================================
-- Refers to its migration by what it does - "one guest, one record" - never
-- by its number: the master settles the number at merge, in merge order.
--
-- Runs as the superuser like every file here; what the APPLICATION may do is
-- checked as pms_app. Builds one property of its own and removes it. The
-- routes are proved in api/test/modules/guests/oneGuestOneRecord.test.ts;
-- what is here is what only the database can promise:
--   * the phone key, over the SAME samples as contactKeys.test.ts
--   * "stayed N times": checked-in visits, several rooms once
--   * the blacklist is the owner's, an administrator's or a GM's - the admin
--     role was refused by 013's trigger until this migration
--   * a join is made only through its function, by a manager
--   * "no offers" is stored as its key, recorded by anybody, cleared by a manager
--   * "not the same person" (CRM-2): a manager's, only through its function;
--     the pair leaves the list, follows a join, comes back on undo
--   * a booking site's guest on a blacklisted number (CRM-3): warned of, a
--     desk booking not, and nothing told to another hotel's clerk
-- =============================================================================
do $$
declare
  h uuid; t uuid;
  clerk uuid; adm uuid;
  g uuid; ok_count int; n int; failed boolean; v text;
  grp uuid;
  w uuid; hb uuid; th uuid; ans uuid; jn uuid;
  ota uuid; dsrc uuid; og uuid; dg uuid; h2 uuid; other uuid; pair_reason text;
begin
  -- ---------- the phone key: the same samples as contactKeys.test.ts --------
  select count(*) into ok_count
    from (values ('+91 98765 43210', '9876543210'), ('098765 43210', '9876543210'),
                 ('9876543210', '9876543210'), ('91 98765 43210', '9876543210'),
                 ('98765-43210 ext', '9876543210'), ('+44 20 7946 0958', '442079460958'),
                 ('12345', null), ('0000000000', null), ('+91 00000 00000', null),
                 ('', null), (null, null)) s(typed, key)
   where app.phone_key(s.typed) is not distinct from s.key;
  perform test.ok('crm', 'a phone is compared on its key, the owner''s rule',
    ok_count = 11, ok_count || ' of 11 samples read as the TypeScript copy reads them');
  perform test.ok('crm', 'an email is compared trimmed and in lower case',
    app.email_key('  Rohit@Example.COM ') = 'rohit@example.com' and app.email_key('  ') is null);

  -- ---------- a property, a clerk and an administrator -----------------------
  h := app.provision_property_unchecked('CRM', 'CRM Test', 'Nowhere');
  -- A second property, for CRM-3's "another hotel's clerk" (provisioned here,
  -- while the session is still the group administrator's).
  h2 := app.provision_property_unchecked('CRN', 'CRM Test Two', 'Elsewhere');
  select id into t from room_types where hotel_id = h order by sort_order limit 1;

  insert into staff (email, full_name) values ('crm-clerk@fidato.in', 'CRM Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('crm-admin@fidato.in', 'CRM Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  delete from staff_hotels where staff_id in (clerk, adm);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (adm, h, 'admin');

  insert into guests (full_name, phone) values ('CRM Test Guest', '+91 70000 12345')
  returning id into g;

  -- ---------- "stayed N times": checked-in visits, several rooms once --------
  insert into reservation_groups (name, lead_hotel_id) values ('CRM Test Group', h)
  returning id into grp;
  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, group_id)
  values (h, g, t, 'CRM-T-1', '2026-01-01', '2026-01-03', 1, 'checked_out', 'direct', 1000, grp),
         (h, g, t, 'CRM-T-2', '2026-01-01', '2026-01-03', 1, 'checked_out', 'direct', 1000, grp),
         (h, g, t, 'CRM-T-3', '2026-02-01', '2026-02-02', 1, 'checked_in',  'direct', 1000, null),
         (h, g, t, 'CRM-T-4', '2026-03-01', '2026-03-02', 1, 'cancelled',   'direct', 1000, null),
         (h, g, t, 'CRM-T-5', '2027-03-01', '2027-03-02', 1, 'confirmed',   'direct', 1000, null);
  n := app.guest_visits(g);
  perform test.ok('crm', 'two rooms booked together are one visit; cancelled and future ones none',
    n = 2, n || ' visits counted, expected 2');
  n := app.guest_visits(g, (select id from reservations where reference = 'CRM-T-2'));
  perform test.ok('crm', 'the stay being looked at is left out of "stayed before"',
    n = 1, n || ' visits before, expected 1');

  -- ---------- the blacklist: owner, admin or GM ------------------------------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    update guests set is_blacklisted = true, blacklist_reason = 'x' where id = g;
  exception when raise_exception then failed := true;
  end;
  reset role;
  perform test.ok('crm', 'a clerk cannot blacklist a guest', failed, 'the clerk''s update went through');

  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  failed := false;
  begin
    update guests set is_blacklisted = true, blacklist_reason = 'Unpaid' where id = g;
  exception when others then failed := true;
  end;
  reset role;
  select blacklist_reason into v from guests where id = g;
  perform test.ok('crm', 'an administrator may blacklist (D21-21) - 013''s trigger refused one',
    not failed and v = 'Unpaid', coalesce(v, 'nothing') || ' recorded');

  -- ---------- a join, only through its function, only by a manager ----------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    perform app.guest_join(g, g);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('crm', 'a clerk cannot join two guests', failed);

  set local role pms_app;
  failed := false;
  begin
    insert into guest_joins (kept_id, joined_id, reservation_ids, kept_before, kept_after, joined_by)
    values (g, g, '{}', '{}', '{}', clerk);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('crm', 'the application cannot write a join except through app.guest_join', failed);

  perform test.ok('crm', 'the functions that read past row security are the application''s alone',
    has_function_privilege('pms_app', 'app.guest_360(uuid)', 'execute')
    and has_function_privilege('pms_app', 'app.guest_suggestions(text, text)', 'execute')
    and not has_function_privilege('pms_provisioner', 'app.guest_360(uuid)', 'execute')
    and not has_function_privilege('pms_provisioner', 'app.same_person_pairs()', 'execute'));

  -- ---------- "no offers": a key, recorded by anybody, cleared by a manager --
  perform test.raises('crm', 'an opt-out is stored as its key, never as typed',
    $q$insert into offer_opt_outs (kind, value) values ('phone', '+91 70000 12345')$q$, '23514');

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  n := app.record_no_offers('+91 70000 12345', 'CRM.Test@Example.com');
  delete from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  reset role;
  select count(*) into ok_count from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  perform test.ok('crm', 'the desk records "no offers" and cannot clear it',
    n = 2 and ok_count = 2, n || ' recorded, ' || ok_count || ' left after the clerk''s delete');

  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  delete from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  reset role;
  select count(*) into ok_count from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  perform test.ok('crm', 'an administrator clears it', ok_count = 0, ok_count || ' left');

  -- ---------- the WhatsApp tick is unticked unless somebody ticks it ---------
  perform test.ok('crm', 'a booking nobody ticked has not agreed to WhatsApp',
    not (select whatsapp_agreed from reservations where reference = 'CRM-T-5'));

  -- ---------- "not the same person" (CRM-2, D22-8) -------------------------
  -- Three records on one mobile: a wife, her husband, and a second record of
  -- the husband. Every two of them is a pair until somebody answers.
  insert into guests (full_name, phone) values ('CRM Test Wife', '+91 70000 22222') returning id into w;
  insert into guests (full_name, phone) values ('CRM Test Husband', '7000022222') returning id into hb;
  insert into guests (full_name, phone) values ('CRM Test Husband Again', '07000022222') returning id into th;

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    perform app.guest_not_same(w, hb);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('crm', 'a clerk cannot say two guests are not the same person', failed);

  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  failed := false;
  begin
    insert into guest_not_same (a, b, said_by) values (least(w, hb), greatest(w, hb), adm);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('crm', 'the application cannot write that answer except through app.guest_not_same', failed);

  set local role pms_app;
  ans := app.guest_not_same(hb, w);
  select count(*) into n from app.same_person_pairs() p
   where (p.a, p.b) = (least(w, hb), greatest(w, hb));
  select count(*) into ok_count from app.same_person_pairs() p
   where (p.a, p.b) = (least(w, th), greatest(w, th));
  reset role;
  perform test.ok('crm', 'an answered pair leaves the list, and only that pair',
    n = 0 and ok_count = 1, n || ' answered pairs listed, ' || ok_count || ' of the other pair');
  perform test.ok('crm', 'the answer keeps who gave it',
    (select said_by from guest_not_same where id = ans) = adm);

  -- The husband's first record is joined into his second (`hb` into `th`).
  -- The wife is still not him, now that `th` stands for him.
  set local role pms_app;
  jn := app.guest_join(th, hb);
  select count(*) into n from app.same_person_pairs() p
   where (p.a, p.b) = (least(w, th), greatest(w, th));
  perform app.guest_join_undo(jn);
  perform app.guest_not_same_undo(ans);
  select count(*) into ok_count from app.same_person_pairs() p
   where (p.a, p.b) = (least(w, hb), greatest(w, hb));
  reset role;
  perform test.ok('crm', 'an answer follows a record joined into another, and an undo lists the pair again',
    n = 0 and ok_count = 1, n || ' listed after the join, ' || ok_count || ' after the undo');

  -- ---------- a booking site's guest who is blacklisted (CRM-3, D22-8) ------
  -- `g` is blacklisted ('Unpaid', above). His number arrives on a booking
  -- from a booking site and on one taken at the desk; only the first warns.
  select id into ota from booking_sources where kind = 'ota' order by name limit 1;
  select id into dsrc from booking_sources where kind = 'direct' order by name limit 1;
  insert into guests (full_name, phone) values ('CRM Test Site Guest', '7000012345') returning id into og;
  insert into guests (full_name, phone) values ('CRM Test Desk Guest', '07000012345') returning id into dg;
  insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                            adults, status, source, agreed_rate, booking_source_id)
  values (h, og, t, 'CRM-T-6', '2027-05-01', '2027-05-02', 1, 'confirmed', 'ota', 1000, ota),
         (h, dg, t, 'CRM-T-7', '2027-05-01', '2027-05-02', 1, 'confirmed', 'direct', 1000, dsrc);

  insert into staff (email, full_name) values ('crm-other@fidato.in', 'CRM Other Clerk')
  on conflict (email) do update set is_active = true returning id into other;
  delete from staff_hotels where staff_id = other;
  insert into staff_hotels (staff_id, hotel_id, role) values (other, h2, 'front_desk');

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*), max(b.reference), max(b.blacklist_reason) into n, v, pair_reason
    from app.booking_site_blacklist(h, '2027-05-01', '2027-05-01') b;
  select count(*) into ok_count from app.booking_site_blacklist(h, '2027-05-02', '2027-06-01');
  reset role;
  perform test.ok('crm', 'a booking site''s guest on a blacklisted number is warned of, with the reason; a desk booking is not',
    n = 1 and v = 'CRM-T-6' and pair_reason = 'Unpaid',
    n || ' warnings, ' || coalesce(v, 'none') || ', ' || coalesce(pair_reason, 'no reason'));
  perform test.ok('crm', 'the warning keeps to the arrival dates asked', ok_count = 0, ok_count || ' outside the dates');

  perform set_config('app.user_id', other::text, true);
  set local role pms_app;
  select count(*) into n from app.booking_site_blacklist(h, '2027-05-01', '2027-05-01');
  reset role;
  perform test.ok('crm', 'another hotel''s clerk is told nothing of this hotel''s bookings', n = 0, n || ' rows');

  -- ---------- clean up ------------------------------------------------------
  delete from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  delete from guest_not_same where a in (w, hb, th) or b in (w, hb, th);
  delete from guest_joins where kept_id in (w, hb, th) or joined_id in (w, hb, th);
  delete from reservations where hotel_id = h;
  delete from reservation_groups where id = grp;
  alter table guests disable trigger guests_no_delete;
  update guests set joined_into = null where id in (w, hb, th);
  delete from guests where id in (g, w, hb, th, og, dg);
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from staff_hotels where hotel_id in (h, h2);
  delete from hotels where id in (h, h2);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (clerk, adm, other);
  update staff set is_active = false where id in (clerk, adm, other);

  select count(*) into n from hotels where code in ('CRM', 'CRN');
  perform test.ok('crm', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
