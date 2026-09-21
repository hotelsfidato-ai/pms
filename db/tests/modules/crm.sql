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
-- =============================================================================
do $$
declare
  h uuid; t uuid;
  clerk uuid; adm uuid;
  g uuid; ok_count int; n int; failed boolean; v text;
  grp uuid;
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

  -- ---------- clean up ------------------------------------------------------
  delete from offer_opt_outs where value in ('7000012345', 'crm.test@example.com');
  delete from reservations where hotel_id = h;
  delete from reservation_groups where id = grp;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (clerk, adm);
  update staff set is_active = false where id in (clerk, adm);

  select count(*) into n from hotels where code = 'CRM';
  perform test.ok('crm', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
