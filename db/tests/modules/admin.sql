-- =============================================================================
-- ADMINISTRATION
-- =============================================================================
-- Refers to its migrations by what they do, never by number: the master
-- renumbers at merge.
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here; who is "signed in" is set the way the API sets it,
-- through `app.user_id`. WHO may read the audit log is the API's
-- (api/test/modules/admin/grants.test.ts); what is proved here is what the
-- database records and names.
-- =============================================================================


-- =============================================================================
-- THE AUDIT LOG NAMES THE PERSON (ADM-1, the owner's decision D17-14)
-- =============================================================================
do $$
declare
  h uuid; other uuid; rt uuid; g uuid; res uuid; fol uuid;
  clerk uuid; gm uuid; elsewhere uuid; owner uuid;
  p_left_out uuid; p_named uuid; p_nobody uuid;
  pid bigint; n int; v text;
begin
  h     := app.provision_property_unchecked('ADM','Admin Test','Nowhere');
  other := app.provision_property_unchecked('ADN','Admin Other','Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';
  select id into owner from staff where email = 'owner@fidato.in';

  insert into staff (email, full_name) values ('adm-clerk@fidato.in', 'Admin Test Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('adm-gm@fidato.in', 'Admin Test Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('adm-elsewhere@fidato.in', 'Admin Test Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, gm, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (gm, h, 'gm'), (elsewhere, other, 'gm');

  insert into guests (full_name, phone) values ('Admin Test Guest', '9000000099')
  returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, date '2027-02-01', date '2027-02-03', 3000, 'checked_in')
  returning id into res;
  insert into folios (hotel_id, reservation_id) values (h, res) returning id into fol;

  -- ---------- recorded: a posting that leaves the person out still names them ----------
  -- The desk's charge, reversal and payment statements never set posted_by.
  -- They now get the signed-in person from the column itself.
  perform set_config('app.user_id', clerk::text, true);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
  values (h, fol, '2027-02-01', 'misc', 'ADM left out', 100)
  returning id into pid;
  perform test.ok('audit log names the person',
    'a posting that does not say who records the signed-in person',
    (select posted_by from folio_postings where id = pid) = clerk,
    coalesce((select posted_by::text from folio_postings where id = pid), 'null'));

  -- ---------- a statement that names somebody keeps them ----------
  -- The till names its operator; the default must never overwrite that.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, posted_by)
  values (h, fol, '2027-02-01', 'misc', 'ADM named', 50, gm)
  returning id into pid;
  perform test.ok('audit log names the person',
    'a posting that names who made it keeps that person',
    (select posted_by from folio_postings where id = pid) = gm);

  -- ---------- nobody signed in: nothing invented ----------
  perform set_config('app.user_id', '', true);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
  values (h, fol, '2027-02-01', 'misc', 'ADM nobody', 25)
  returning id into pid;
  perform test.ok('audit log names the person',
    'with nobody signed in the posting records nobody — not a stand-in',
    (select posted_by from folio_postings where id = pid) is null);

  -- ---------- shown: by name, to somebody at the property ----------
  select id into pid from folio_postings where description = 'ADM left out' and hotel_id = h;

  perform set_config('app.user_id', gm::text, true);
  v := app.posted_by_name(pid);
  perform test.ok('audit log names the person',
    'the general manager there reads the clerk''s name', v = 'Admin Test Clerk', coalesce(v, 'null'));

  perform set_config('app.user_id', owner::text, true);
  v := app.posted_by_name(pid);
  perform test.ok('audit log names the person',
    'a group administrator reads it', v = 'Admin Test Clerk', coalesce(v, 'null'));

  -- ---------- somebody who has LEFT is still named ----------
  -- The point of an audit log. app.colleague_name would print nothing here.
  delete from staff_hotels where staff_id = clerk;
  update staff set is_active = false where id = clerk;
  perform set_config('app.user_id', gm::text, true);
  v := app.posted_by_name(pid);
  perform test.ok('audit log names the person',
    'a person whose access was removed is still named on what they did',
    v = 'Admin Test Clerk', coalesce(v, 'null'));
  perform test.ok('audit log names the person',
    'which is why this is not app.colleague_name — that answers nothing for them',
    app.colleague_name(clerk, h) is null);

  -- ---------- never across a property line ----------
  perform set_config('app.user_id', elsewhere::text, true);
  v := app.posted_by_name(pid);
  perform test.ok('audit log names the person',
    'a manager at another property gets nothing for this one', v is null, coalesce(v, 'null'));

  -- ---------- an entry nobody recorded reads as nobody ----------
  perform set_config('app.user_id', gm::text, true);
  select id into pid from folio_postings where description = 'ADM nobody' and hotel_id = h;
  perform test.ok('audit log names the person',
    'an entry with nobody recorded has no name — the screen prints a dash',
    app.posted_by_name(pid) is null);

  -- ---------- the application may call it, and nobody else ----------
  perform test.ok('audit log names the person', 'the application may ask for the name',
    has_function_privilege('pms_app', 'app.posted_by_name(bigint)', 'execute'));
  perform test.ok('audit log names the person', 'PUBLIC may not',
    not exists (select 1 from information_schema.routine_privileges
                 where routine_schema = 'app' and routine_name = 'posted_by_name'
                   and grantee = 'PUBLIC'));

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  alter table folio_postings disable trigger folio_postings_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table folio_postings enable trigger folio_postings_append_only;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = g;
  alter table guests enable trigger guests_no_delete;
  delete from staff_hotels where staff_id in (clerk, gm, elsewhere);
  update staff set is_active = false where id in (clerk, gm, elsewhere);

  select count(*) into n from hotels where code in ('ADM', 'ADN');
  perform test.ok('audit log names the person','the fixtures do not outlive the test',
    n = 0 and not exists (select 1 from guests where id = g), n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- THE GM RUNS THEIR OWN HOTEL'S PEOPLE, AND MAKES NO ADMIN (D22-2, D22-3)
-- =============================================================================
-- The owner, 22 September: "Only the owner or an admin makes an admin. A GM
-- gives every other role", and "People works for the GM, for their own hotel
-- only". The list a manager may hand out, and the ROW ITSELF - a GM who
-- reached staff_hotels by any door still writes no Admin (MEMORY 318: each
-- guard tested with the other standing, so the policy is asked directly).
-- =============================================================================
do $$
declare
  h uuid; other uuid; owner uuid;
  gm uuid; hotel_owner uuid; clerk uuid; two uuid; newbie uuid;
  roles text[]; failed boolean;
begin
  h     := app.provision_property_unchecked('ADP', 'People Test', 'Nowhere');
  other := app.provision_property_unchecked('ADQ', 'People Other', 'Nowhere');
  select id into owner from staff where email = 'owner@fidato.in';

  insert into staff (email, full_name) values ('d22-gm@fidato.in', 'D22 Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('d22-owner@fidato.in', 'D22 Hotel Owner')
  on conflict (email) do update set is_active = true returning id into hotel_owner;
  insert into staff (email, full_name) values ('d22-clerk@fidato.in', 'D22 Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('d22-both@fidato.in', 'D22 Two Hotels')
  on conflict (email) do update set is_active = true returning id into two;
  insert into staff (email, full_name) values ('d22-new@fidato.in', 'D22 Newcomer')
  on conflict (email) do update set is_active = true returning id into newbie;
  delete from staff_hotels where staff_id in (gm, hotel_owner, clerk, two, newbie);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (gm, h, 'gm'), (hotel_owner, h, 'owner'), (clerk, h, 'front_desk'),
    (two, h, 'housekeeping'), (two, other, 'housekeeping');

  -- ---------- as the GM ----------
  perform set_config('app.user_id', gm::text, true);
  roles := app.grantable_roles(h);
  perform test.ok('gm runs people', 'a GM may not make an Admin (D22-2)',
    not ('admin' = any (roles)), array_to_string(roles, ','));
  perform test.ok('gm runs people', 'nor an Owner, as before', not ('owner' = any (roles)));
  perform test.ok('gm runs people', 'and gives every other role',
    roles @> array['gm', 'hotel_manager', 'front_desk', 'housekeeping', 'finance', 'read_only']);
  perform test.ok('gm runs people', 'and nothing at a hotel they do not run',
    cardinality(app.grantable_roles(other)) = 0);

  perform test.ok('gm runs people', 'a GM edits somebody at their hotel (D22-3)',
    app.manages_person(clerk));
  perform test.ok('gm runs people', 'but not somebody who also works at another hotel - one account (every role, 28 September)',
    not app.manages_person(two) and not app.may_set_password(two));
  perform test.ok('gm runs people', 'never a group administrator',
    not app.manages_person(owner));
  perform test.ok('gm runs people', 'a GM switches off somebody who works only at their hotel',
    app.may_switch_person(clerk));
  perform test.ok('gm runs people', 'but not somebody who also works at another hotel - it would stop them there',
    not app.may_switch_person(two));
  perform test.ok('gm runs people', 'nor a group administrator, nor somebody rostered nowhere',
    not app.may_switch_person(owner) and not app.may_switch_person(newbie));

  -- ---------- the row itself, as the application ----------
  set local role pms_app;
  failed := false;
  begin
    insert into staff_hotels (staff_id, hotel_id, role) values (newbie, h, 'admin');
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('gm runs people', 'the database refuses a GM''s Admin row, whatever the route',
    failed and not exists (select 1 from staff_hotels where staff_id = newbie));

  set local role pms_app;
  failed := false;
  begin
    update staff_hotels set role = 'admin' where staff_id = clerk and hotel_id = h;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('gm runs people', 'nor by changing somebody''s role to Admin',
    failed and (select role from staff_hotels where staff_id = clerk and hotel_id = h) = 'front_desk');

  set local role pms_app;
  failed := false;
  begin
    insert into staff_hotels (staff_id, hotel_id, role) values (newbie, h, 'front_desk');
  exception when others then failed := true;
  end;
  reset role;
  perform test.ok('gm runs people', 'and still takes the GM''s Reception row',
    not failed and exists (select 1 from staff_hotels where staff_id = newbie and role = 'front_desk'));

  -- ---------- as the hotel's owner, who is not a group administrator ----------
  perform set_config('app.user_id', hotel_owner::text, true);
  roles := app.grantable_roles(h);
  perform test.ok('gm runs people', 'the owner there makes an Admin, and no Owner - as before',
    'admin' = any (roles) and not ('owner' = any (roles)), array_to_string(roles, ','));

  -- ---------- as the group administrator ----------
  perform set_config('app.user_id', owner::text, true);
  perform test.ok('gm runs people', 'a group administrator gives every role, Admin and Owner included',
    app.grantable_roles(h) @> array['owner', 'admin']);
  perform test.ok('gm runs people', 'and switches off anybody',
    app.may_switch_person(two) and app.manages_person(two));

  -- ---------- as a clerk ----------
  perform set_config('app.user_id', clerk::text, true);
  perform test.ok('gm runs people', 'a clerk edits nobody - not even themselves, which may_manage_person allows',
    not app.manages_person(clerk) and app.may_manage_person(clerk) and not app.manages_person(two));
  perform test.ok('gm runs people', 'and switches nobody off',
    not app.may_switch_person(two) and cardinality(app.grantable_roles(h)) = 0);

  perform test.ok('gm runs people', 'the application may ask both, and PUBLIC may not',
    has_function_privilege('pms_app', 'app.manages_person(uuid)', 'execute')
    and has_function_privilege('pms_app', 'app.may_switch_person(uuid)', 'execute')
    and not exists (select 1 from information_schema.routine_privileges
                     where routine_schema = 'app'
                       and routine_name in ('manages_person', 'may_switch_person')
                       and grantee = 'PUBLIC'));

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  delete from staff_hotels where staff_id in (gm, hotel_owner, clerk, two, newbie);
  update staff set is_active = false where id in (gm, hotel_owner, clerk, two, newbie);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  perform test.ok('gm runs people', 'the fixtures do not outlive the test',
    not exists (select 1 from hotels where code in ('ADP', 'ADQ')));
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- A HOTEL'S ADMIN RUNS THAT HOTEL'S PEOPLE (D23-2) - BUT MAKES NO ADMIN (D27-140)
-- =============================================================================
-- The owner, 23 September: "a hotel-level Admin manages staff at their own
-- hotel, including giving Admin there". What a GM may do since D22-3, plus
-- Admin, at their own hotel and nowhere else. Each guard is asked on its own
-- (MEMORY 318). And what it does NOT reach: a closed day is still the GM's.
-- 28 September (D27-140, 152): only the owner makes an Admin - the hotel's
-- Admin no longer does, and so no longer runs the hotel's other Admins.
-- =============================================================================
do $$
declare
  h uuid; other uuid; owner uuid;
  adm uuid; clerk uuid; two uuid; newbie uuid; adm2 uuid; hotelowner uuid;
  roles text[]; failed boolean;
begin
  h     := app.provision_property_unchecked('ADR', 'Hotel Admin Test', 'Nowhere');
  other := app.provision_property_unchecked('ADS', 'Hotel Admin Other', 'Nowhere');
  select id into owner from staff where email = 'owner@fidato.in';

  insert into staff (email, full_name) values ('d23-admin@fidato.in', 'D23 Hotel Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('d23-clerk@fidato.in', 'D23 Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('d23-both@fidato.in', 'D23 Two Hotels')
  on conflict (email) do update set is_active = true returning id into two;
  insert into staff (email, full_name) values ('d27-admin2@fidato.in', 'D27 Other Admin')
  on conflict (email) do update set is_active = true returning id into adm2;
  insert into staff (email, full_name) values ('d27-owner@fidato.in', 'D27 Hotel Owner')
  on conflict (email) do update set is_active = true returning id into hotelowner;
  delete from staff_hotels where staff_id in (adm, clerk, two, adm2, hotelowner);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (adm, h, 'admin'), (clerk, h, 'front_desk'),
    (adm2, h, 'admin'), (hotelowner, h, 'owner'),
    (two, h, 'housekeeping'), (two, other, 'housekeeping');

  -- ---------- as the hotel's Admin ----------
  perform set_config('app.user_id', adm::text, true);
  roles := app.grantable_roles(h);
  perform test.ok('hotel admin', 'an Admin at a hotel makes no Admin there (D27-140)',
    not ('admin' = any (roles)), array_to_string(roles, ','));
  perform test.ok('hotel admin', 'and so leaves the hotel''s other Admins alone (D27-140)',
    not app.manages_person(adm2) and not app.may_set_password(adm2)
    and not app.may_switch_person(adm2));
  perform test.ok('hotel admin', 'and gives every other role but Owner and Admin',
    not ('owner' = any (roles))
    and roles @> array['gm', 'hotel_manager', 'front_desk', 'housekeeping', 'finance', 'read_only']);
  perform test.ok('hotel admin', 'and nothing at a hotel where they are not Admin',
    cardinality(app.grantable_roles(other)) = 0);
  perform test.raises('hotel admin', 'rostering at that other hotel is refused',
    format($q$select app.require_hotel_admin(%L)$q$, other), '42501');

  perform test.ok('hotel admin', 'edits somebody at their hotel, never a group administrator',
    app.manages_person(clerk) and not app.manages_person(owner));
  perform test.ok('hotel admin', 'nor somebody who also works at another hotel (every role, 28 September)',
    not app.manages_person(two));
  perform test.ok('hotel admin', 'switches off somebody who works only at their hotel, not somebody who also works elsewhere',
    app.may_switch_person(clerk) and not app.may_switch_person(two));
  perform test.ok('hotel admin', 'sets their people''s passwords, never a group administrator''s',
    app.may_set_password(clerk) and not app.may_set_password(owner));

  -- ---------- the rows themselves, as the application ----------
  set local role pms_app;
  failed := false;
  begin
    insert into staff (email, full_name) values ('d23-new@fidato.in', 'D23 Newcomer');
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  select id into newbie from staff where email = 'd23-new@fidato.in';
  perform test.ok('hotel admin', 'the database takes the person a hotel''s Admin adds',
    not failed and newbie is not null);

  set local role pms_app;
  failed := false;
  begin
    insert into staff_hotels (staff_id, hotel_id, role) values (newbie, h, 'admin');
  exception when others then failed := true;
  end;
  reset role;
  perform test.ok('hotel admin', 'but refuses them an Admin row, whatever the route (D27-140)',
    failed and not exists (select 1 from staff_hotels
                            where staff_id = newbie and hotel_id = h and role = 'admin'));

  set local role pms_app;
  failed := false;
  begin
    insert into staff_hotels (staff_id, hotel_id, role) values (newbie, h, 'front_desk');
  exception when others then failed := true;
  end;
  reset role;
  perform test.ok('hotel admin', 'and takes their other rows at the hotel',
    not failed and exists (select 1 from staff_hotels
                            where staff_id = newbie and hotel_id = h and role = 'front_desk'));

  set local role pms_app;
  failed := false;
  begin
    insert into staff_hotels (staff_id, hotel_id, role) values (newbie, other, 'front_desk');
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('hotel admin', 'and refuses them a row at another hotel',
    failed and not exists (select 1 from staff_hotels where staff_id = newbie and hotel_id = other));

  -- ---------- what D23-2 does not reach: a closed day (D17-12) ----------
  insert into night_audit_runs (hotel_id, business_date, status, completed_at)
  values (h, date '2028-04-01', 'completed', now());
  perform test.raises('hotel admin', 'a hotel''s Admin still cannot correct a closed day - that stays the GM''s',
    format($q$update night_audit_runs set rooms_posted = 9
               where hotel_id = %L and business_date = date '2028-04-01'$q$, h), '42501');

  -- ---------- the hotel's owner still makes an Admin (D27-140) ----------
  perform set_config('app.user_id', hotelowner::text, true);
  roles := app.grantable_roles(h);
  perform test.ok('hotel admin', 'the owner at a hotel makes an Admin there, never an Owner (D27-140)',
    'admin' = any (roles) and not ('owner' = any (roles)), array_to_string(roles, ','));

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  delete from night_audit_runs where hotel_id = h;
  delete from staff_hotels where staff_id in (adm, clerk, two, newbie, adm2, hotelowner);
  update staff set is_active = false where id in (adm, clerk, two, newbie, adm2, hotelowner);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  perform test.ok('hotel admin', 'the fixtures do not outlive the test',
    not exists (select 1 from hotels where code in ('ADR', 'ADS')));
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- NOBODY RUNS SOMEBODY ABOVE THEM (the owner, 24 September)
-- =============================================================================
-- Nobody edits, removes, re-roles, switches off or resets the password of
-- somebody whose role at that hotel they could not give. A GM leaves the
-- hotel's Admin and Owner alone; a hotel's Admin leaves its Owner alone and
-- still runs the GM. The functions (what the routes ask) and the rows (what
-- the application may write) are two guards, each asked on its own (MEMORY
-- 318).
-- =============================================================================
do $$
declare
  h uuid; gm uuid; adm uuid; own uuid; n int;
begin
  h := app.provision_property_unchecked('ADU', 'Above Them Test', 'Nowhere');
  insert into staff (email, full_name) values ('d24-gm@fidato.in', 'D24 GM')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('d24-admin@fidato.in', 'D24 Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('d24-owner@fidato.in', 'D24 Owner')
  on conflict (email) do update set is_active = true returning id into own;
  delete from staff_hotels where staff_id in (gm, adm, own);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (gm, h, 'gm'), (adm, h, 'admin'), (own, h, 'owner');

  -- ---------- the GM, and the hotel's Admin above them ----------
  perform set_config('app.user_id', gm::text, true);
  perform test.ok('above them', 'a GM does not reset the hotel''s Admin''s password',
    not app.may_set_password(adm));
  perform test.ok('above them', 'a GM does not edit the hotel''s Admin', not app.manages_person(adm));
  perform test.ok('above them', 'a GM does not switch off the hotel''s Admin', not app.may_switch_person(adm));
  perform test.ok('above them', 'nor any of it to the hotel''s Owner',
    not app.may_set_password(own) and not app.manages_person(own) and not app.may_switch_person(own));

  set local role pms_app;
  delete from staff_hotels where staff_id = adm and hotel_id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('above them', 'the row: a GM cannot take the hotel''s Admin off it', n = 0, n || ' removed');

  set local role pms_app;
  update staff_hotels set role = 'front_desk' where staff_id = adm and hotel_id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('above them', 'the row: nor make the Admin something else', n = 0, n || ' changed');

  set local role pms_app;
  update staff set full_name = 'Renamed' where id = adm;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('above them', 'the row: nor rename them', n = 0, n || ' renamed');

  -- ---------- the hotel's Admin: the GM yes, the Owner no ----------
  perform set_config('app.user_id', adm::text, true);
  perform test.ok('above them', 'a hotel''s Admin still resets the GM''s password and may switch them off',
    app.may_set_password(gm) and app.may_switch_person(gm));
  perform test.ok('above them', 'a hotel''s Admin does not reset the hotel''s Owner''s password',
    not app.may_set_password(own));
  perform test.ok('above them', 'nor switch the Owner off', not app.may_switch_person(own));

  set local role pms_app;
  delete from staff_hotels where staff_id = own and hotel_id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('above them', 'the row: a hotel''s Admin cannot take the Owner off it', n = 0, n || ' removed');

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  delete from staff_hotels where staff_id in (gm, adm, own);
  update staff set is_active = false where id in (gm, adm, own);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- EVERY ROLE, NOT ANY (28 September, the release review)
-- =============================================================================
-- Somebody who is front desk at A and GM at B has one password. A's GM could
-- reset it, because ONE of their roles was one A's GM could give, and then
-- sign in as B's GM. Every function the routes ask, asked directly (MEMORY
-- 318), and the staff row the application may write.
-- =============================================================================
do $$
declare
  a uuid; b uuid; gm uuid; two uuid; one uuid; boss uuid; n int;
begin
  a := app.provision_property_unchecked('EVA', 'Every Role A', 'Nowhere');
  b := app.provision_property_unchecked('EVB', 'Every Role B', 'Nowhere');
  select id into boss from staff where email = 'owner@fidato.in';
  insert into staff (email, full_name) values ('d28-gm@fidato.in', 'D28 GM of A')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('d28-two@fidato.in', 'D28 Desk at A, GM at B')
  on conflict (email) do update set is_active = true returning id into two;
  insert into staff (email, full_name) values ('d28-one@fidato.in', 'D28 Desk at A')
  on conflict (email) do update set is_active = true returning id into one;
  delete from staff_hotels where staff_id in (gm, two, one);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (gm, a, 'gm'), (two, a, 'front_desk'), (two, b, 'gm'), (one, a, 'front_desk');

  perform set_config('app.user_id', gm::text, true);
  perform test.ok('every role', 'A''s GM does not reset the password of B''s GM who is also desk at A',
    not app.may_set_password(two));
  perform test.ok('every role', 'nor edit them, nor set their first screen',
    not app.manages_person(two) and not app.may_manage_person(two));
  perform test.ok('every role', 'nor re-invite their address (it would set the password)',
    not app.may_claim_address('d28-two@fidato.in'));
  perform test.ok('every role', 'A''s GM still runs somebody who works only at A',
    app.may_set_password(one) and app.manages_person(one)
    and app.may_claim_address('d28-one@fidato.in'));

  set local role pms_app;
  update staff set full_name = 'Renamed' where id = two;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('every role', 'the row: A''s GM cannot rename B''s GM', n = 0, n || ' renamed');

  perform set_config('app.user_id', boss::text, true);
  perform test.ok('every role', 'a group administrator still may',
    app.may_set_password(two) and app.manages_person(two));

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  delete from staff_hotels where staff_id in (gm, two, one);
  update staff set is_active = false where id in (gm, two, one);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (a, b);
  alter table hotels enable trigger hotels_no_delete;
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- A DEPLOY DOES NOT BRING THE PLACEHOLDER ADMINISTRATOR BACK (ADM-3, MEMORY 271)
-- =============================================================================
-- Every deploy replays 008_seed.sql. By now this database has real group
-- administrators (051 made the owner's row out of the placeholder), so a
-- replay must not insert `REPLACE@fidato.in` again. The seed file itself is
-- replayed, inside a transaction that is rolled back: its placeholder hotels
-- would otherwise come back too and change what later files count.
-- =============================================================================
begin;
\ir ../../migrations/008_seed.sql
select count(*) as adm3_placeholders from staff where email = 'REPLACE@fidato.in' \gset
rollback;
select test.ok('placeholder', 'a replay of the seed does not re-create the placeholder administrator (ADM-3)',
  :adm3_placeholders = 0, :adm3_placeholders || ' placeholder rows after a replay');


-- =============================================================================
-- GROUP SETTINGS: THE GROUP'S NAME AND LOGO (the owner's D27-53 and D27-65)
-- =============================================================================
-- The database's own guard, asked directly, with no route in front of it
-- (MEMORY 318): the owner, an administrator or a GM at any hotel, or a group
-- administrator, may change it; everybody else active reads it; somebody who
-- is not active staff of this group reads nothing. One copy is one group
-- (D21-1), so "another group" is nobody signed in here. The route's own
-- refusals are api/test/modules/admin/groupSettings.test.ts.
-- =============================================================================
do $$
declare
  h uuid; clerk uuid; gm uuid; adm uuid; gone uuid; owner uuid;
  failed boolean; n int;
begin
  h := app.provision_property_unchecked('ADL', 'Group Test', 'Nowhere');
  select id into owner from staff where email = 'owner@fidato.in';
  insert into staff (email, full_name) values ('adl-clerk@fidato.in', 'Group Test Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('adl-gm@fidato.in', 'Group Test Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('adl-admin@fidato.in', 'Group Test Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('adl-gone@fidato.in', 'Group Test Gone')
  on conflict (email) do update set is_active = true returning id into gone;
  delete from staff_hotels where staff_id in (clerk, gm, adm, gone);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (gm, h, 'gm'), (adm, h, 'admin'), (gone, h, 'gm');
  update staff set is_active = false where id = gone;
  delete from group_settings;

  -- ---------- who, asked of the function itself ----------
  perform set_config('app.user_id', gm::text, true);
  perform test.ok('group settings', 'a GM may change them', app.sets_group_settings());
  perform set_config('app.user_id', adm::text, true);
  perform test.ok('group settings', 'an administrator may change them', app.sets_group_settings());
  perform set_config('app.user_id', owner::text, true);
  perform test.ok('group settings', 'a group administrator may change them', app.sets_group_settings());
  perform set_config('app.user_id', clerk::text, true);
  perform test.ok('group settings', 'reception may not', not app.sets_group_settings());
  perform set_config('app.user_id', gone::text, true);
  perform test.ok('group settings', 'nor a GM who has been switched off', not app.sets_group_settings());

  -- ---------- the row, as the application ----------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  failed := false;
  begin
    insert into group_settings (name) values ('Reception''s Group');
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('group settings', 'the database refuses reception''s, whatever the route',
    failed and not exists (select 1 from group_settings));
  delete from group_settings;   -- so a broken policy fails the line above, not the next insert

  perform set_config('app.user_id', gm::text, true);
  set local role pms_app;
  insert into group_settings (name, logo_type, logo, changed_by)
  values ('Fidato Hotels', 'image/png', '\x89504e470d0a1a0a'::bytea, gm);
  reset role;
  perform test.ok('group settings', 'and takes the GM''s', exists (select 1 from group_settings where changed_by = gm));
  perform test.ok('group settings', 'and the audit log records who',
    exists (select 1 from audit_log where table_name = 'group_settings' and actor = gm and action = 'INSERT'));

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*) into n from group_settings;
  update group_settings set name = 'Somebody Else', logo_type = null, logo = null;
  delete from group_settings;
  reset role;
  perform test.ok('group settings', 'reception reads them - they print bills', n = 1, n || ' rows read');
  perform test.ok('group settings', 'and can neither change nor remove them',
    (select name = 'Fidato Hotels' and logo_type = 'image/png' from group_settings));

  perform set_config('app.user_id', gone::text, true);
  set local role pms_app;
  select count(*) into n from group_settings;
  reset role;
  perform test.ok('group settings', 'somebody switched off reads nothing', n = 0, n || ' rows read');
  perform set_config('app.user_id', '', true);
  set local role pms_app;
  select count(*) into n from group_settings;
  reset role;
  perform test.ok('group settings', 'nor does nobody signed in: no other group reads them', n = 0, n || ' rows read');

  -- ---------- what may be stored ----------
  perform test.raises('group settings', 'one setting for the group, never two',
    $q$insert into group_settings (id, name) values (2, 'Two')$q$, '23514');
  perform test.raises('group settings', 'a name of 80 characters at most',
    $q$update group_settings set name = repeat('x', 81)$q$, '23514');
  perform test.raises('group settings', 'and no blank or untrimmed name - none is null',
    $q$update group_settings set name = ' Fidato '$q$, '23514');
  perform test.raises('group settings', 'a logo is a PNG or an SVG, nothing else',
    $q$update group_settings set logo_type = 'text/html'$q$, '23514');
  perform test.raises('group settings', 'never a type without its file',
    $q$update group_settings set logo = null$q$, '23514');
  perform test.raises('group settings', 'and 200 KB at most',
    $q$update group_settings set logo = decode(repeat('00', 204801), 'hex')$q$, '23514');

  -- ---------- and the fixtures go ----------
  delete from group_settings;
  perform set_config('app.user_id', '', true);
  delete from staff_hotels where staff_id in (clerk, gm, adm, gone);
  update staff set is_active = false where id in (clerk, gm, adm, gone);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;

-- =============================================================================
-- TELEMETRY (D27-91, D27-92) - the telemetry migration, without the route in front of it
-- =============================================================================
-- The role gate refuses everybody but the owner and an administrator before
-- GET /system-health runs (api/test/modules/admin/systemHealth.test.ts). This
-- is the database's own guard behind it, tested alone (MEMORY 318), and the
-- one function that writes: a minute in, and anything past 180 days out.
-- =============================================================================
do $$
declare
  h uuid; clerk uuid; gm uuid; adm uuid; gone uuid; owner uuid;
  failed boolean; n int; got telemetry_requests;
begin
  h := app.provision_property_unchecked('TEL', 'Telemetry Test', 'Nowhere');
  select id into owner from staff where email = 'owner@fidato.in';
  insert into staff (email, full_name) values ('tel-clerk@fidato.in', 'Telemetry Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('tel-gm@fidato.in', 'Telemetry Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('tel-admin@fidato.in', 'Telemetry Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('tel-gone@fidato.in', 'Telemetry Gone')
  on conflict (email) do update set is_active = true returning id into gone;
  delete from staff_hotels where staff_id in (clerk, gm, adm, gone);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (gm, h, 'gm'), (adm, h, 'admin'), (gone, h, 'admin');
  update staff set is_active = false where id = gone;
  delete from telemetry_requests;
  delete from telemetry_events;

  -- ---------- who may read ----------
  perform set_config('app.user_id', adm::text, true);
  perform test.ok('telemetry', 'an administrator may read it', app.reads_system_health());
  perform set_config('app.user_id', owner::text, true);
  perform test.ok('telemetry', 'a group administrator may read it', app.reads_system_health());
  perform set_config('app.user_id', gm::text, true);
  perform test.ok('telemetry', 'a GM may not', not app.reads_system_health());
  perform set_config('app.user_id', clerk::text, true);
  perform test.ok('telemetry', 'nor reception', not app.reads_system_health());
  perform set_config('app.user_id', gone::text, true);
  perform test.ok('telemetry', 'nor an administrator who has been switched off', not app.reads_system_health());

  -- ---------- the 180 days, and a minute in ----------
  insert into telemetry_requests (minute, method, route, status, count, total_ms, max_ms, buckets) values
    (date_trunc('minute', now()) - interval '181 days', 'GET', '/old', 200, 1, 5, 5, '{1,0,0,0,0,0,0,0,0,0}'),
    (date_trunc('minute', now()) - interval '179 days', 'GET', '/kept', 200, 1, 5, 5, '{1,0,0,0,0,0,0,0,0,0}');
  insert into telemetry_events (minute, kind, place, what, count) values
    (date_trunc('minute', now()) - interval '181 days', 'error', 'GET /old', '22P02', 1);

  perform set_config('app.user_id', '', true);
  set local role pms_app;
  perform app.record_telemetry(
    jsonb_build_array(jsonb_build_object('minute', date_trunc('minute', now()), 'method', 'GET',
      'route', '/api/hotels/:code/stays/:id', 'status', 200, 'count', 2, 'total_ms', 300,
      'max_ms', 200, 'buckets', '[0,0,0,1,1,0,0,0,0,0]'::jsonb)),
    jsonb_build_array(jsonb_build_object('minute', date_trunc('minute', now()), 'kind', 'slow_query',
      'place', '', 'what', 'select ?', 'count', 1, 'max_ms', 1500)));
  -- the same minute again, as a retried flush sends it: it adds
  perform app.record_telemetry(
    jsonb_build_array(jsonb_build_object('minute', date_trunc('minute', now()), 'method', 'GET',
      'route', '/api/hotels/:code/stays/:id', 'status', 200, 'count', 1, 'total_ms', 900,
      'max_ms', 900, 'buckets', '[0,0,0,0,0,0,1,0,0,0]'::jsonb)),
    '[]'::jsonb);
  reset role;

  perform test.ok('telemetry', 'a row older than 180 days is deleted',
    not exists (select 1 from telemetry_requests where route = '/old')
    and not exists (select 1 from telemetry_events where place = 'GET /old'));
  perform test.ok('telemetry', 'a row of 179 days is kept',
    exists (select 1 from telemetry_requests where route = '/kept'));
  select * into got from telemetry_requests where route = '/api/hotels/:code/stays/:id';
  perform test.ok('telemetry', 'a minute written twice adds to itself',
    got.count = 3 and got.total_ms = 1200 and got.max_ms = 900
    and got.buckets = '{0,0,0,1,1,0,1,0,0,0}'::int[],
    format('%s %s %s %s', got.count, got.total_ms, got.max_ms, got.buckets));
  perform test.ok('telemetry', 'a slow query is kept by its name',
    exists (select 1 from telemetry_events where kind = 'slow_query' and what = 'select ?' and max_ms = 1500));

  -- ---------- the rows, as the application ----------
  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*) into n from telemetry_requests;
  reset role;
  perform test.ok('telemetry', 'reception reads nothing, whatever the route', n = 0, n || ' rows read');
  perform set_config('app.user_id', gm::text, true);
  set local role pms_app;
  select count(*) into n from telemetry_events;
  reset role;
  perform test.ok('telemetry', 'nor does a GM', n = 0, n || ' rows read');
  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  select count(*) into n from telemetry_requests;
  reset role;
  perform test.ok('telemetry', 'an administrator reads them', n = 2, n || ' rows read');

  set local role pms_app;
  failed := false;
  begin
    delete from telemetry_requests;
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('telemetry', 'and nobody through the application can delete the record',
    failed and (select count(*) from telemetry_requests) = 2);
  set local role pms_app;
  failed := false;
  begin
    insert into telemetry_events (minute, kind, place, what, count) values (now(), 'error', '', 'x', 1);
  exception when insufficient_privilege then failed := true;
  end;
  reset role;
  perform test.ok('telemetry', 'or write a row but through app.record_telemetry', failed);

  -- ---------- and the fixtures go ----------
  delete from telemetry_requests;
  delete from telemetry_events;
  perform set_config('app.user_id', '', true);
  delete from staff_hotels where staff_id in (clerk, gm, adm, gone);
  update staff set is_active = false where id in (clerk, gm, adm, gone);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- NEW BOOKING'S FOUR SECTIONS START ON, AND A HOTEL MAY TURN ONE OFF (D27-163)
-- =============================================================================
do $$
declare h uuid; other uuid;
begin
  h     := app.provision_property_unchecked('BKS','Sections Test','Nowhere');
  other := app.provision_property_unchecked('BKT','Sections Other','Nowhere');

  perform test.ok('admin', 'the four New booking sections are on at a property nobody has touched',
    app.module_enabled(h, 'booking_company') and app.module_enabled(h, 'booking_gst')
    and app.module_enabled(h, 'booking_extras') and app.module_enabled(h, 'booking_notes'));

  insert into hotel_modules (hotel_id, module, is_enabled) values (h, 'booking_notes', false);
  perform test.ok('admin', 'Notes switched off at one property is off there, and on at the other',
    not app.module_enabled(h, 'booking_notes') and app.module_enabled(other, 'booking_notes'));
  perform test.ok('admin', 'and every other module still starts off, the till still on',
    not app.module_enabled(h, 'laundry') and app.module_enabled(h, 'pos'));

  delete from hotel_modules where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
end $$;


-- =============================================================================
-- THE HOTEL'S OWN PROFILE, AND WHO MAY WRITE IT (168; D27-213, D27-214)
-- =============================================================================
-- The write policy on `hotels` asked app.is_manager(), which left the
-- hotel-level Admin out (a save wrote nothing) and let a GM of one hotel write
-- another where they held a lesser role. It asks app.manages_hotel(id) now.
-- =============================================================================
do $$
declare
  h uuid; other uuid; adm uuid; clerk uuid; two uuid; n int; m int;
begin
  h     := app.provision_property_unchecked('HPR', 'Hotel Profile Test', 'Nowhere');
  other := app.provision_property_unchecked('HPS', 'Hotel Profile Other', 'Nowhere');

  insert into staff (email, full_name) values ('d214-admin@fidato.in', 'D214 Hotel Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  insert into staff (email, full_name) values ('d214-clerk@fidato.in', 'D214 Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('d214-two@fidato.in', 'D214 GM There, Desk Here')
  on conflict (email) do update set is_active = true returning id into two;
  delete from staff_hotels where staff_id in (adm, clerk, two);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (adm, h, 'admin'), (clerk, h, 'front_desk'),
    (two, other, 'gm'), (two, h, 'front_desk');

  -- ---------- the hotel's Admin: the save really writes ----------
  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  update hotels set fssai_number = '12345678901234' where id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('hotel profile', 'a hotel''s Admin saving its details writes the row (it wrote nothing before 168)',
    n = 1 and (select fssai_number from hotels where id = h) = '12345678901234', n || ' rows');

  -- ---------- a GM elsewhere, reception here: not this hotel's ----------
  perform set_config('app.user_id', two::text, true);
  set local role pms_app;
  update hotels set fssai_number = null where id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('hotel profile', 'a GM of another hotel, at the desk here, does not write this hotel',
    n = 0, n || ' rows');

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  update hotels set fssai_number = null where id = h;
  get diagnostics n = row_count;
  reset role;
  perform test.ok('hotel profile', 'nor does reception', n = 0, n || ' rows');
  perform set_config('app.user_id', '', true);

  -- ---------- every change is recorded, with who ----------
  select count(*) into n from audit_log
   where table_name = 'hotels' and row_id = h::text and actor = adm
     and after->>'fssai_number' = '12345678901234';
  perform test.ok('hotel profile', 'the change is in the audit log under the Admin''s name',
    n = 1, n || ' entries');

  -- ---------- the new fields keep their shape ----------
  update hotels set pin = '413216', pan = 'AAGCF5655F', star_rating = 4,
         property_type = 'heritage_hotel', latitude = 17.524800, longitude = 76.205600
   where id = h;
  perform test.ok('hotel profile', 'a PIN, a PAN, a type, stars and a map point are kept as typed',
    (select pin = '413216' and pan = 'AAGCF5655F' and star_rating = 4
            and property_type = 'heritage_hotel' and latitude = 17.5248 from hotels where id = h));
  perform test.raises('hotel profile', 'a PIN is six digits',
    format($q$update hotels set pin = '41321' where id = %L$q$, h), '23514');
  perform test.raises('hotel profile', 'a PAN has its shape',
    format($q$update hotels set pan = 'AAGCF5655' where id = %L$q$, h), '23514');
  perform test.raises('hotel profile', 'a map point is two figures, never one',
    format($q$update hotels set longitude = null where id = %L$q$, h), '23514');
  perform test.raises('hotel profile', 'and lies on the globe',
    format($q$update hotels set latitude = 91 where id = %L$q$, h), '23514');
  perform test.raises('hotel profile', 'stars are one to five',
    format($q$update hotels set star_rating = 6 where id = %L$q$, h), '23514');
  perform test.raises('hotel profile', 'the type is one of the owner''s list',
    format($q$update hotels set property_type = 'motel' where id = %L$q$, h), '23514');

  -- ---------- a hotel's own logo ----------
  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  insert into hotel_logos (hotel_id, logo_type, logo) values (h, 'image/png', '\x89504e47'::bytea);
  get diagnostics n = row_count;
  reset role;
  perform test.ok('hotel profile', 'the hotel''s Admin keeps its logo', n = 1, n || ' rows');

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*) into n from hotel_logos where hotel_id = h;
  reset role;
  perform test.ok('hotel profile', 'reception reads it - they print the bills', n = 1, n || ' rows');
  perform test.raises('hotel profile', 'and does not change it',
    format($q$set local role pms_app; insert into hotel_logos (hotel_id, logo_type, logo)
              values (%L, 'image/png', '\x89504e47'::bytea)$q$, other), '42501');
  reset role;
  perform set_config('app.user_id', '', true);
  perform test.raises('hotel profile', 'a logo is a PNG or an SVG',
    format($q$update hotel_logos set logo_type = 'image/jpeg' where hotel_id = %L$q$, h), '23514');

  -- ---------- what the voucher prints (D27-215): the house policies ----------
  perform test.ok('voucher settings', 'a new hotel starts with the reference''s four house policies',
    (select cardinality(house_policies) = 4
            and house_policies[1] like 'Guests must present government photo identity%' from hotels where id = h));
  update hotels set house_policies = '{}' where id = h;
  perform test.ok('voucher settings', 'a hotel may have none, and keeps none',
    (select house_policies = '{}' from hotels where id = h));
  perform test.raises('voucher settings', 'at most eight',
    format($q$update hotels set house_policies = array_fill('A policy.'::text, array[9]) where id = %L$q$, h), '23514');
  perform test.raises('voucher settings', 'each of 200 characters at most',
    format($q$update hotels set house_policies = array[repeat('x', 201)] where id = %L$q$, h), '23514');
  perform test.raises('voucher settings', 'and never a blank one',
    format($q$update hotels set house_policies = array['  '] where id = %L$q$, h), '23514');

  -- ---------- the hotel's bank details: whoever manages THAT hotel ----------
  perform set_config('app.user_id', adm::text, true);
  set local role pms_app;
  insert into hotel_bank_details (hotel_id, account_name, account_number, bank_name, ifsc)
  values (h, 'Test Hotels Private Limited', '000011112222', 'Test Bank', 'TEST0001234');
  get diagnostics n = row_count;
  reset role;
  perform test.ok('voucher settings', 'the hotel''s Admin sets its bank details', n = 1, n || ' rows');
  perform test.ok('voucher settings', 'and the change is recorded under their name, for the owner''s bell',
    exists (select 1 from audit_log where table_name = 'hotel_bank_details'
             and hotel_id = h and actor = adm and action = 'INSERT'));

  perform set_config('app.user_id', clerk::text, true);
  set local role pms_app;
  select count(*) into n from hotel_bank_details where hotel_id = h;
  reset role;
  perform test.ok('voucher settings', 'reception does not read them', n = 0, n || ' rows');

  /* A GM of another hotel who works the desk here: not this hotel's to read or change. */
  perform set_config('app.user_id', two::text, true);
  set local role pms_app;
  select count(*) into n from hotel_bank_details where hotel_id = h;
  update hotel_bank_details set account_name = 'Somebody Else' where hotel_id = h;
  get diagnostics m = row_count;
  reset role;
  perform test.ok('voucher settings', 'a GM of another hotel, at the desk here, neither reads nor changes them',
    n = 0 and m = 0, n || ' read, ' || m || ' changed');
  perform set_config('app.user_id', '', true);

  /* Built from zero in one run, as a first deploy is: the voucher's definer
     (owned by pms_migrate) must be able to read the table the same run made. */
  perform test.ok('voucher settings', 'the voucher''s definer owns the bank details from the first run',
    (select pg_get_userbyid(relowner) from pg_class where relname = 'hotel_bank_details') = 'pms_migrate');
  perform test.ok('voucher settings', 'and the hotel''s logo (168)',
    (select pg_get_userbyid(relowner) from pg_class where relname = 'hotel_logos') = 'pms_migrate');

  perform test.raises('voucher settings', 'an account number is digits',
    format($q$update hotel_bank_details set account_number = '0000-1111-2222' where hotel_id = %L$q$, h), '23514');
  perform test.raises('voucher settings', 'an IFSC has its shape',
    format($q$update hotel_bank_details set ifsc = 'TEST1001234' where hotel_id = %L$q$, h), '23514');
  perform test.raises('voucher settings', 'a UPI ID is name@handle',
    format($q$update hotel_bank_details set upi_id = 'not a upi id' where hotel_id = %L$q$, h), '23514');

  -- ---------- and the fixtures go ----------
  delete from staff_hotels where staff_id in (adm, clerk, two);
  update staff set is_active = false where id in (adm, clerk, two);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- SET UP THIS HOTEL (the owner's D27-311): what a person chose on a step
-- =============================================================================
-- Whether a step is done is derived by the API, never stored. The table keeps
-- only a choice the data cannot show (completed by hand, later, remind on a
-- day), with who and when - read and written by whoever manages THAT hotel
-- (its owner, GM or Admin, or a group administrator) and by nobody else.
-- =============================================================================
do $$
declare
  v_h uuid; v_other uuid; v_gm uuid; v_clerk uuid; v_elsewhere uuid; v_owner uuid;
  v_n int; v_m int;
begin
  v_h     := app.provision_property_unchecked('ASW', 'Setup Wizard Test', 'Nowhere');
  v_other := app.provision_property_unchecked('ASX', 'Setup Wizard Other', 'Nowhere');
  select id into v_owner from staff where email = 'owner@fidato.in';

  insert into staff (email, full_name) values ('asw-gm@fidato.in', 'Setup Test GM')
  on conflict (email) do update set is_active = true returning id into v_gm;
  insert into staff (email, full_name) values ('asw-clerk@fidato.in', 'Setup Test Clerk')
  on conflict (email) do update set is_active = true returning id into v_clerk;
  insert into staff (email, full_name) values ('asw-elsewhere@fidato.in', 'Setup Test Elsewhere')
  on conflict (email) do update set is_active = true returning id into v_elsewhere;
  delete from staff_hotels where staff_id in (v_gm, v_clerk, v_elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (v_gm, v_h, 'gm'), (v_clerk, v_h, 'front_desk'), (v_elsewhere, v_other, 'gm');

  perform test.ok('setup steps', 'row security is forced on the table, as on every hotel table',
    (select relrowsecurity and relforcerowsecurity from pg_class where relname = 'hotel_setup_steps'));

  -- ---------- the hotel's GM chooses, and the database names them ----------
  perform set_config('app.user_id', v_gm::text, true);
  set local role pms_app;
  insert into hotel_setup_steps (hotel_id, step, choice) values (v_h, 'modules', 'later');
  insert into hotel_setup_steps (hotel_id, step, choice, remind_on) values (v_h, 'lists', 'remind', date '2027-01-05');
  get diagnostics v_n = row_count;
  reset role;
  perform test.ok('setup steps', 'the hotel''s GM puts a step off for later, and asks for a reminder', v_n = 1);
  perform test.ok('setup steps', 'the row names who chose it, without the route saying so',
    (select chosen_by from hotel_setup_steps where hotel_id = v_h and step = 'modules') = v_gm);
  perform test.ok('setup steps', 'and the change is in the audit log under their name',
    exists (select 1 from audit_log where table_name = 'hotel_setup_steps'
             and hotel_id = v_h and actor = v_gm and action = 'INSERT'));

  -- ---------- reception at the same hotel: neither reads nor writes ----------
  perform set_config('app.user_id', v_clerk::text, true);
  set local role pms_app;
  select count(*) into v_n from hotel_setup_steps where hotel_id = v_h;
  update hotel_setup_steps set choice = 'completed' where hotel_id = v_h;
  get diagnostics v_m = row_count;
  reset role;
  perform test.ok('setup steps', 'reception neither reads the choices nor changes them',
    v_n = 0 and v_m = 0, v_n || ' read, ' || v_m || ' changed');
  perform test.raises('setup steps', 'and cannot add one',
    format($q$set local role pms_app; insert into hotel_setup_steps (hotel_id, step, choice)
              values (%L, 'policies', 'completed')$q$, v_h), '42501');
  reset role;

  -- ---------- a GM of another hotel: not theirs ----------
  perform set_config('app.user_id', v_elsewhere::text, true);
  set local role pms_app;
  select count(*) into v_n from hotel_setup_steps where hotel_id = v_h;
  delete from hotel_setup_steps where hotel_id = v_h;
  get diagnostics v_m = row_count;
  reset role;
  perform test.ok('setup steps', 'a GM of another hotel neither reads nor clears them',
    v_n = 0 and v_m = 0, v_n || ' read, ' || v_m || ' cleared');
  perform test.raises('setup steps', 'nor adds one there',
    format($q$set local role pms_app; insert into hotel_setup_steps (hotel_id, step, choice)
              values (%L, 'policies', 'completed')$q$, v_h), '42501');
  reset role;

  -- ---------- a group administrator: every hotel ----------
  perform set_config('app.user_id', v_owner::text, true);
  set local role pms_app;
  update hotel_setup_steps set choice = 'completed', remind_on = null where hotel_id = v_h and step = 'lists';
  get diagnostics v_n = row_count;
  reset role;
  perform test.ok('setup steps', 'a group administrator changes a choice at any hotel', v_n = 1);
  perform set_config('app.user_id', '', true);

  -- ---------- the choices themselves ----------
  perform test.raises('setup steps', 'a reminder has its day',
    format($q$insert into hotel_setup_steps (hotel_id, step, choice) values (%L, 'branding', 'remind')$q$, v_h),
    '23514');
  perform test.raises('setup steps', 'and nothing else has one',
    format($q$insert into hotel_setup_steps (hotel_id, step, choice, remind_on)
              values (%L, 'branding', 'later', date '2027-01-05')$q$, v_h), '23514');
  perform test.raises('setup steps', 'a choice is completed, later or remind',
    format($q$insert into hotel_setup_steps (hotel_id, step, choice) values (%L, 'branding', 'skipped')$q$, v_h),
    '23514');
  perform test.raises('setup steps', 'one choice a step',
    format($q$insert into hotel_setup_steps (hotel_id, step, choice) values (%L, 'modules', 'completed')$q$, v_h),
    '23505');

  -- ---------- and the fixtures go, the choices with their hotel ----------
  delete from staff_hotels where staff_id in (v_gm, v_clerk, v_elsewhere);
  update staff set is_active = false where id in (v_gm, v_clerk, v_elsewhere);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (v_h, v_other);
  alter table hotels enable trigger hotels_no_delete;
  perform test.ok('setup steps', 'a hotel''s choices go with it',
    not exists (select 1 from hotel_setup_steps where hotel_id in (v_h, v_other)));
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);


-- =============================================================================
-- THE OWNER'S FULL RESET (D27-342, D27-365 (3))
-- =============================================================================
-- The database's half: a login that may count and clear and nothing else;
-- pms_app shut out; every guard lifted for the clear - a paid bill, a closed
-- day, an invoice, key cards, a struck KOT line, the Store - and put back; a
-- test hotel and a guest checked in refused; another hotel untouched; and the
-- dry run's count being what went; the ID photos whose file Drive still
-- holds listed for Drive, exactly this hotel's (D27-379). The API's half (one
-- e-mail, the typed code, the backup, all or nothing over the wire, Drive
-- asked only after the commit) is
-- api/test/modules/admin/ownerReset.test.ts. Everything here is undone.
-- =============================================================================
do $$
declare
  res jsonb := '[]';
  owner uuid; h uuid; other uuid; t uuid; t_code text; rt uuid; rt_o uuid; r101 uuid;
  g1 uuid; g2 uuid; g3 uuid; c1 uuid; c2 uuid; c3 uuid; outlet uuid; kitchen uuid; cat uuid; item uuid; loc uuid; si uuid;
  stay uuid; stay2 uuid; inhouse uuid; fol uuid; fol2 uuid; pid bigint; ord uuid; line bigint;
  fy text; bd date; dry jsonb; done jsonb; v text; n bigint; s record;
  rg_here uuid; rg_bill uuid; rg_led uuid;
begin
  begin
    select id into owner from staff where email = 'owner@fidato.in';
    perform set_config('app.user_id', owner::text, true);
    perform set_config('app.hotel_code', '', true);

    h     := app.provision_property_unchecked('ORS', 'Owner Reset Real', 'Nowhere');
    other := app.provision_property_unchecked('ORT', 'Owner Reset Other', 'Nowhere');
    select id into rt   from room_types where hotel_id = h     and code = 'STD';
    select id into rt_o from room_types where hotel_id = other and code = 'STD';
    insert into rooms (hotel_id, room_type_id, number) values (h, rt, '101') returning id into r101;
    insert into pos_outlets (hotel_id, code, name, staff_id, api_key_hash)
    values (h, 'REST', 'Restaurant', owner, repeat('b', 64)) returning id into outlet;
    select id into kitchen from pos_kot_kinds where hotel_id = h order by sort limit 1;
    insert into pos_menu_categories (hotel_id, name, kot_kind_id) values (h, 'Mains', kitchen) returning id into cat;
    insert into pos_menu_items (hotel_id, category_id, name, price) values (h, cat, 'Dal', 180) returning id into item;
    select id into loc from locations where hotel_id = h order by name limit 1;
    insert into stock_items (hotel_id, name, unit) values (h, 'Rice', 'kg') returning id into si;

    -- A guest who stayed only here; one who also has a stay at the other hotel.
    insert into guests (full_name, phone) values ('ORS Only Here', '9833300001') returning id into g1;
    insert into guests (full_name, phone) values ('ORS Both Places', '9833300002') returning id into g2;
    insert into guest_documents (guest_id, id_type, id_number) values (g2, 'passport', 'Y7654321');
    -- A companion on a stay here, and one on a stay at the other hotel, whose
    -- record has no booking of its own anywhere (D27-382).
    insert into guests (full_name, nationality) values ('ORS Companion Here', 'GB') returning id into c1;
    insert into guests (full_name, nationality) values ('ORS Companion There', 'GB') returning id into c2;
    insert into guest_documents (guest_id, id_type, id_number)
    values (c1, 'passport', 'C1111111'), (c2, 'passport', 'C2222222');
    -- And somebody who stayed here and is a companion at the other hotel.
    insert into guests (full_name, nationality) values ('ORS Here And Companion', 'GB') returning id into c3;
    insert into guest_documents (guest_id, id_type, id_number) values (c3, 'passport', 'C3333333');

    -- A few days of trade.
    bd := app.business_date(h);
    fy := app.current_fin_year(h);
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, app.next_reference(h), g1, rt, bd - 1, bd, 3000, 'checked_out') returning id into stay;
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, app.next_reference(h), g2, rt, bd - 5, bd - 4, 3000, 'checked_out');
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (other, app.next_reference(other), g2, rt_o, bd + 10, bd + 11, 3000, 'confirmed') returning id into stay2;
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, app.next_reference(h), c3, rt, bd - 3, bd - 2, 3000, 'checked_out');
    insert into stay_companions (hotel_id, reservation_id, guest_id)
    values (h, stay, c1), (other, stay2, c2), (other, stay2, c3);
    insert into form_iii_stays (hotel_id, reservation_id, guest_id, arrived_from)
    values (h, stay, c1, 'Delhi'), (other, stay2, c2, 'Delhi');
    -- Booking groups: one only here (goes); one with no bookings and its bill
    -- at the other hotel, and one the other hotel leads (both stay).
    insert into reservation_groups (name) values ('ORS here') returning id into rg_here;
    update reservations set group_id = rg_here where id = stay;
    insert into reservation_groups (name) values ('ORS bill elsewhere') returning id into rg_bill;
    insert into folios (hotel_id, group_id) values (other, rg_bill);
    insert into reservation_groups (name, lead_hotel_id) values ('ORT leads', other) returning id into rg_led;
    insert into folios (hotel_id, reservation_id) values (h, stay) returning id into fol;
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
    values (h, fol, bd - 1, 'room', 'Room 101 · 1 night', 3000, 12, 360);
    insert into night_audit_runs (hotel_id, business_date, status, completed_at)
    values (h, bd - 1, 'completed', now());
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
    values (h, fol, bd, 'payment', 'Cash', -3360) returning id into pid;
    insert into payments (hotel_id, posting_id, method, amount) values (h, pid, 'cash', 3360);
    insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
    values (h, fol, fy, app.next_invoice_number(h, fy), 'ORS Only Here', 3360, 360);
    insert into key_cards (hotel_id, reservation_id, room_id, act, cards, valid_until, why, outcome, driver)
    values (h, stay, r101, 'issue', 2, now() + interval '1 day', 'check_in', 'done', 'stand-in');
    insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
    values (h, outlet, app.pos_next_order_no(h, bd), bd, owner) returning id into ord;
    insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
    values (ord, h, item, 'Dal', 1, 180, 5, owner) returning id into line;
    insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by,
                                 voided, voided_by, voided_at)
    values (ord, h, item, 'Dal', 2, 180, 5, owner, true, owner, now());
    insert into pos_line_events (hotel_id, line_id, order_id, status, by_staff)
    values (h, line, ord, 'sent', owner);
    insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
    values (ord, h, 'cash', 189, owner);
    update pos_orders set status = 'settled', settled_by = owner, settled_at = now(), payment_method = 'cash'
     where id = ord;
    insert into stock_movements (hotel_id, item_id, business_date, kind, quantity, location_id, moved_by)
    values (h, si, bd, 'receipt', 25, loc, owner);
    -- ID photos (D27-379): two whose file Drive still holds (kept; removed
    -- with Drive's delete owed), one Drive already deleted, one that never
    -- reached it - and the other hotel's own.
    insert into guest_id_photos (hotel_id, hotel_code, reservation_id, guest_id, uploaded_by, sides, notice_version,
                                 status, stored_at, drive_file_id, cipher_sha256, cipher_bytes,
                                 removed_at, removed_reason, drive_delete_failed_at)
    values (h, 'ORS', stay, g1, owner, '{front}', 't', 'stored', now(), 'ors-1', repeat('a', 64), 10, null, null, null),
           (h, 'ORS', stay, g1, owner, '{front}', 't', 'removed', now(), 'ors-2', repeat('a', 64), 10, now(), 'deleted: t', now()),
           (h, 'ORS', stay, g1, owner, '{front}', 't', 'removed', now(), 'ors-3', repeat('a', 64), 10, now(), 'deleted: t', null),
           (h, 'ORS', stay, g1, owner, '{front}', 't', 'pending', null, null, null, null, null, null, null),
           (other, 'ORT', stay2, g2, owner, '{front}', 't', 'stored', now(), 'ort-1', repeat('a', 64), 10, null, null, null);
    update rooms set occupancy_status = 'occupied', housekeeping_status = 'dirty' where id = r101;
    update hotels set business_date = bd - 3 where id = h;
    -- The other hotel's own ledger, which must stay.
    insert into folios (hotel_id, reservation_id) values (other, stay2) returning id into fol2;
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
    values (other, fol2, app.business_date(other), 'misc', 'ORT charge', 100);
    -- And somebody in the house.
    insert into guests (full_name) values ('ORS In House') returning id into g3;
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, app.next_reference(h), g3, rt, bd - 3, bd + 1, 3000, 'checked_in') returning id into inhouse;
    -- The deferred checks of the rows above, now: a guard cannot be lifted on
    -- a table with checks still pending in the same transaction.
    set constraints all immediate;

    -- ---------- who may call it ----------
    set local role pms_app;
    v := null;
    begin perform owner_reset.counts('ORS'); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'the API''s own role cannot even count', 'ok', v = '42501', 'd', v);
    v := null;
    begin perform owner_reset.clear('ORS', true, owner, null); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'nor clear', 'ok', v = '42501', 'd', v);
    reset role;

    set local role pms_owner_reset;
    v := null;
    begin perform count(*) from reservations; exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'the reset login reads no table', 'ok', v = '42501', 'd', v);
    v := null;
    begin delete from folio_postings where hotel_id = h; exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'deletes nothing itself', 'ok', v = '42501', 'd', v);
    v := null;
    begin perform app.is_group_admin(); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'and calls nothing of the app''s', 'ok', v = '42501', 'd', v);
    v := null;
    begin perform owner_reset.steps(true); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'not even the clear''s own parts: it counts and clears, nothing else', 'ok', v = '42501', 'd', v);
    v := null;
    begin perform count(*) from owner_reset.id_photos_in_drive; exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'nor reads the list of ID photos still in Drive', 'ok', v = '42501', 'd', v);
    dry := owner_reset.counts('ORS');
    reset role;
    res := res || jsonb_build_object('n', 'it counts', 'ok', (dry -> 'tables' ->> 'reservations') = '4', 'd', dry::text);
    res := res || jsonb_build_object('n', 'and counts the ID photos Drive still holds: not one already deleted, not one that never reached it, not the other hotel''s',
      'ok', (dry ->> 'idPhotos')::int = 2, 'd', dry ->> 'idPhotos');

    -- ---------- refused: a guest checked in, a test hotel ----------
    res := res || jsonb_build_object('n', 'the dry run names the guest checked in',
      'ok', dry ->> 'refusal' = 'A guest is still checked in at Owner Reset Real: ORS In House. Check them out before the hotel is cleared.',
      'd', dry ->> 'refusal');
    v := null;
    set local role pms_owner_reset;
    begin perform owner_reset.clear('ORS', true, owner, 'x.dump'); exception when others then v := sqlstate || ': ' || sqlerrm; end;
    reset role;
    res := res || jsonb_build_object('n', 'and the clear refuses, saying who, with nothing gone and every guard on',
      'ok', v like '23514: A guest is still checked in at Owner Reset Real: ORS In House.%'
            and (select count(*) from reservations where hotel_id = h) = 4
            and not exists (select 1 from owner_reset.id_photos_in_drive where hotel_id = h)
            and (select count(*) from owner_reset.guards(true) g join pg_trigger tr on tr.tgname = g.trigger_name
                  where tr.tgenabled <> 'O') = 0,
      'd', v);

    t := app.create_test_hotel(h);
    t_code := (select code from hotels where id = t);
    v := null;
    set local role pms_owner_reset;
    begin perform owner_reset.clear(t_code, true, owner, 'x.dump'); exception when others then v := sqlstate || ': ' || sqlerrm; end;
    reset role;
    res := res || jsonb_build_object('n', 'a test hotel is refused: it keeps its own Reset',
      'ok', v = format('23514: %s is a test hotel. It keeps its own Reset, on ORS''s card on Properties.', t_code)
            and (owner_reset.counts(t_code) ->> 'refusal') = substr(v, 8),
      'd', v);

    -- ---------- the clear ----------
    update reservations set status = 'checked_out' where id = inhouse;
    dry := owner_reset.counts('ORS');
    set local role pms_owner_reset;
    done := owner_reset.clear('ORS', true, owner, 'fidato-20261028-101500.dump');
    reset role;

    res := res || jsonb_build_object('n', 'what went is what the dry run said would go - a paid bill, a closed day, an invoice, key cards, the Store among it',
      'ok', done -> 'tables' = dry -> 'tables' and done -> 'guests' = dry -> 'guests'
            and (dry -> 'tables') ?& array['folio_postings', 'invoices', 'pos_orders', 'pos_order_lines',
                                           'pos_order_tenders', 'stock_movements', 'night_audit_runs'],
      'd', done::text);
    v := null;
    for s in select * from owner_reset.steps(true) where where_sql = 'hotel_id = $1' loop
      execute format('select count(*) from public.%I where hotel_id = $1', s.table_name) into n using h;
      if n > 0 then v := concat_ws(', ', v, s.table_name || ' ' || n); end if;
    end loop;
    res := res || jsonb_build_object('n', 'nothing is left of the trade, the key cards and the kitchen''s timings with it',
      'ok', v is null and not exists (select 1 from key_cards where hotel_id = h)
            and not exists (select 1 from pos_line_events where hotel_id = h),
      'd', coalesce(v, '-'));
    res := res || jsonb_build_object('n', 'a guest who stayed only here goes; one with a stay elsewhere stays, papers and all',
      'ok', not exists (select 1 from guests where id in (g1, g3))
            and exists (select 1 from guests where id = g2)
            and exists (select 1 from guest_documents where guest_id = g2));
    res := res || jsonb_build_object('n', 'a companion on this hotel''s stay goes, papers and all; one on another hotel''s stay stays, though they have no booking of their own (D27-382)',
      'ok', not exists (select 1 from guests where id = c1)
            and not exists (select 1 from guest_documents where guest_id = c1)
            and exists (select 1 from guests where id = c2)
            and exists (select 1 from guest_documents where guest_id = c2)
            and exists (select 1 from stay_companions where guest_id = c2)
            and exists (select 1 from form_iii_stays where guest_id = c2));
    res := res || jsonb_build_object('n', 'a guest of this hotel who is a companion at another keeps their record and their papers',
      'ok', exists (select 1 from guests where id = c3)
            and exists (select 1 from guest_documents where guest_id = c3));
    res := res || jsonb_build_object('n', 'a booking group goes only when nothing at another hotel holds it: not its bill there, not that hotel leading it',
      'ok', not exists (select 1 from reservation_groups where id = rg_here)
            and exists (select 1 from reservation_groups where id = rg_bill)
            and exists (select 1 from reservation_groups where id = rg_led));
    res := res || jsonb_build_object('n', 'the other hotel is untouched',
      'ok', exists (select 1 from reservations where id = stay2)
            and exists (select 1 from folio_postings where hotel_id = other and description = 'ORT charge'));
    res := res || jsonb_build_object('n', 'the ID photos Drive still holds are listed for Drive, and handed back: exactly this hotel''s two; the other hotel''s photo kept, not listed',
      'ok', (select array_agg(drive_file_id order by drive_file_id) from owner_reset.id_photos_in_drive
              where hotel_id in (h, other)) = array['ors-1', 'ors-2']
            and (select jsonb_agg(x order by x ->> 'driveFileId') from jsonb_array_elements(done -> 'idPhotos') x)
                = '[{"hotelCode": "ORS", "driveFileId": "ors-1"}, {"hotelCode": "ORS", "driveFileId": "ors-2"}]'
            and not exists (select 1 from guest_id_photos where hotel_id = h)
            and exists (select 1 from guest_id_photos where hotel_id = other and drive_file_id = 'ort-1'),
      'd', done -> 'idPhotos');
    v := null;
    set local role pms_app;
    delete from owner_reset.id_photos_in_drive where drive_file_id = 'ors-1';
    begin perform owner_reset.counts('ORS'); exception when others then v := sqlstate; end;
    reset role;
    res := res || jsonb_build_object('n', 'the API''s own role strikes one off once Drive has deleted it - and still cannot count',
      'ok', v = '42501' and not exists (select 1 from owner_reset.id_photos_in_drive where drive_file_id = 'ors-1'),
      'd', v);
    res := res || jsonb_build_object('n', 'rooms vacant and clean, the business date today, the setup kept',
      'ok', not exists (select 1 from rooms where hotel_id = h and (occupancy_status <> 'vacant' or housekeeping_status <> 'clean'))
            and (select business_date from hotels where id = h) = (now() at time zone (select timezone from hotels where id = h))::date
            and exists (select 1 from pos_menu_items where id = item) and exists (select 1 from stock_items where id = si)
            and exists (select 1 from rooms where id = r101));
    res := res || jsonb_build_object('n', 'invoice numbers carry on, never reused',
      'ok', (select next_number from invoice_series where hotel_id = h and fin_year = fy) = 2
            and app.next_invoice_number(h, fy) like '%/00002');
    res := res || jsonb_build_object('n', 'one audit line: who, which hotel, how many rows, the backup, how many ID photos for Drive',
      'ok', (select count(*) from audit_log where hotel_id = h and action = 'OWNER_RESET') = 1
            and exists (select 1 from audit_log where hotel_id = h and action = 'OWNER_RESET' and actor = owner
                         and after ->> 'backup' = 'fidato-20261028-101500.dump'
                         and (after ->> 'idPhotos')::int = 2
                         and (after ->> 'removed')::bigint = (done ->> 'removed')::bigint));
    res := res || jsonb_build_object('n', 'every guard is back on after it',
      'ok', (select count(*) from owner_reset.guards(true) g join pg_trigger tr on tr.tgname = g.trigger_name
              where tr.tgenabled <> 'O') = 0);
    v := null;
    begin delete from folio_postings where hotel_id = other; exception when others then v := sqlerrm; end;
    res := res || jsonb_build_object('n', 'and still refuses the other hotel''s ledger', 'ok', v like '%append-only%', 'd', v);

    raise exception using errcode = 'OR001', message = 'undo';
  exception when sqlstate 'OR001' then
    null;
  end;

  insert into test.results (suite, name, passed, detail)
  select 'owner full reset', x ->> 'n', coalesce((x ->> 'ok')::boolean, false), x ->> 'd'
    from jsonb_array_elements(res) x;
end $$;



-- =============================================================================
-- TWO-STEP SIGN-IN (D27-396)
-- =============================================================================
-- The keys and the codes typed are closed to the API's own role; a key is on
-- from its first right code, and passes only the sign-in it was typed for;
-- five wrong codes stop the sixth try; a recovery code is taken once; only the
-- owner or the hotel's Admin switches somebody's off, with a reason; the GM may
-- not require it, nor an Admin before their own is on; when on, a GM without
-- it must set it up and reception is not asked. All of it undone at the end.
do $$
declare
  h uuid; gm uuid; clerk uuid; adm uuid; t record; v text;
  res jsonb := '[]';
  ts timestamptz;
begin
  begin
    h := app.provision_property_unchecked('TSS', 'Two Step Test', 'Nowhere');
    insert into staff (email, full_name) values ('tss-gm@fidato.in', 'TSS GM') returning id into gm;
    insert into staff (email, full_name) values ('tss-clerk@fidato.in', 'TSS Clerk') returning id into clerk;
    insert into staff (email, full_name) values ('tss-admin@fidato.in', 'TSS Admin') returning id into adm;
    insert into staff_hotels (staff_id, hotel_id, role) values (gm, h, 'gm'), (clerk, h, 'front_desk'), (adm, h, 'admin');

    set local role pms_app;
    v := null;
    begin perform count(*) from staff_two_step; exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'the API''s own role cannot read the keys', 'ok', v = '42501', 'd', v);
    v := null;
    begin perform count(*) from two_step_log; exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'nor the codes typed', 'ok', v = '42501', 'd', v);
    reset role;

    perform set_config('app.user_id', gm::text, true);
    res := res || jsonb_build_object('n', 'nothing is asked of somebody without it',
      'ok', app.two_step_state(to_timestamp(1)) = 'off');
    perform app.two_step_begin('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    res := res || jsonb_build_object('n', 'nor while it is being set up',
      'ok', app.two_step_state(to_timestamp(1)) = 'off');
    select * into t from app.two_step_try(to_timestamp(1));
    perform app.two_step_passed(t.attempt, 100, null, array['h1', 'h2']);
    res := res || jsonb_build_object('n', 'on from the first right code, which passes that sign-in and no other',
      'ok', app.two_step_state(to_timestamp(1)) = 'passed' and app.two_step_state(to_timestamp(2)) = 'code',
      'd', app.two_step_state(to_timestamp(2)));
    v := null;
    begin perform app.two_step_begin('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXQ'); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'a key already on is not replaced', 'ok', v = '23514', 'd', v);

    for i in 1..5 loop perform app.two_step_try(to_timestamp(2)); end loop;
    v := null;
    begin perform app.two_step_try(to_timestamp(2)); exception when others then v := sqlstate || ': ' || sqlerrm; end;
    res := res || jsonb_build_object('n', 'five wrong codes in a quarter of an hour stop the sixth try, and are kept',
      'ok', v like '54000: Five wrong codes in a quarter of an hour.%'
            and (select count(*) from two_step_log where staff_id = gm and not ok) = 5,
      'd', v);

    delete from two_step_log where staff_id = gm and not ok;
    select * into t from app.two_step_try(to_timestamp(3));
    perform app.two_step_passed(t.attempt, null, 'h1', null);
    select * into t from app.two_step_try(to_timestamp(4));
    v := null;
    begin perform app.two_step_passed(t.attempt, null, 'h1', null); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'a recovery code is taken once',
      'ok', v = '23514' and app.two_step_state(to_timestamp(3)) = 'passed'
            and app.two_step_state(to_timestamp(4)) = 'code'
            and (select recovery from staff_two_step where staff_id = gm) = array['h2'],
      'd', v);

    perform set_config('app.user_id', clerk::text, true);
    v := null;
    begin perform app.two_step_off(gm, 'Lost phone'); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'reception may not switch somebody''s off', 'ok', v = '42501', 'd', v);
    perform set_config('app.user_id', adm::text, true);
    v := null;
    begin perform app.two_step_off(gm, '  '); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'nor anybody without a reason', 'ok', v = '23514', 'd', v);
    perform app.two_step_off(gm, 'Lost phone');
    res := res || jsonb_build_object('n', 'the hotel''s Admin switches it off, and the audit log says why',
      'ok', not exists (select 1 from staff_two_step where staff_id = gm)
            and exists (select 1 from audit_log where action = 'TWO_STEP_OFF' and row_id = gm::text
                         and actor = adm and after ->> 'reason' = 'Lost phone'));

    perform set_config('app.user_id', gm::text, true);
    v := null;
    begin perform app.set_two_step_required(true); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'the GM may not require it of the group', 'ok', v = '42501', 'd', v);
    perform set_config('app.user_id', adm::text, true);
    v := null;
    begin perform app.set_two_step_required(true); exception when others then v := sqlstate; end;
    res := res || jsonb_build_object('n', 'nor an Admin before their own is on', 'ok', v = '23514', 'd', v);
    perform app.two_step_begin('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
    select * into t from app.two_step_try(to_timestamp(5));
    perform app.two_step_passed(t.attempt, 100, null, array['x']);
    perform app.set_two_step_required(true);
    perform set_config('app.user_id', gm::text, true);
    ts := to_timestamp(6);
    res := res || jsonb_build_object('n', 'when it is required, a GM without it sets it up',
      'ok', app.two_step_state(ts) = 'setup' and (select two_step_required from group_settings) is true,
      'd', app.two_step_state(ts));
    perform set_config('app.user_id', clerk::text, true);
    res := res || jsonb_build_object('n', 'and reception is not asked', 'ok', app.two_step_state(ts) = 'off');

    raise exception using errcode = 'TS001', message = 'undo';
  exception when sqlstate 'TS001' then
    null;
  end;

  insert into test.results (suite, name, passed, detail)
  select 'two-step sign-in', x ->> 'n', coalesce((x ->> 'ok')::boolean, false), x ->> 'd'
    from jsonb_array_elements(res) x;
end $$;


-- =============================================================================
-- SHIMLA AND AMRAPALI ARE NEVER RESET (D27-381)
-- =============================================================================
-- A hotel locked against the full reset is refused by the dry run and by the
-- clear - the button and reset-property.ts both ask those two - with nothing
-- gone, and the lock cannot be lifted. SHI and AMR are locked wherever they
-- are. Undone at the end.
do $$
declare
  h uuid; rt uuid; g uuid; v text;
  res jsonb := '[]';
begin
  begin
    h := app.provision_property_unchecked('ORL', 'Owner Reset Locked', 'Nowhere');
    select id into rt from room_types where hotel_id = h and code = 'STD';
    insert into guests (full_name) values ('ORL Guest') returning id into g;
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
    values (h, app.next_reference(h), g, rt, date '2027-03-01', date '2027-03-02', 3000, 'confirmed');
    update hotels set reset_locked = true where id = h;
    set constraints all immediate;

    res := res || jsonb_build_object('n', 'the dry run says the hotel can never be reset',
      'ok', owner_reset.counts('ORL') ->> 'refusal'
            = 'Owner Reset Locked (ORL) can never be reset: the owner locked it (D27-381).',
      'd', owner_reset.counts('ORL') ->> 'refusal');
    v := null;
    set local role pms_owner_reset;
    begin perform owner_reset.clear('ORL', true, null, 'x.dump'); exception when others then v := sqlstate || ': ' || sqlerrm; end;
    reset role;
    res := res || jsonb_build_object('n', 'and the clear refuses, saying why, with nothing gone',
      'ok', v = '23514: Owner Reset Locked (ORL) can never be reset: the owner locked it (D27-381).'
            and (select count(*) from reservations where hotel_id = h) = 1
            and exists (select 1 from guests where id = g),
      'd', v);
    v := null;
    begin update hotels set reset_locked = false where id = h; exception when others then v := sqlstate || ': ' || sqlerrm; end;
    res := res || jsonb_build_object('n', 'the lock is never lifted, whoever asks',
      'ok', v = '23514: ORL can never be reset, and that lock is not lifted (D27-381).', 'd', v);
    res := res || jsonb_build_object('n', 'SHI and AMR are locked wherever they are',
      'ok', not exists (select 1 from hotels where code in ('SHI', 'AMR') and not reset_locked));

    raise exception using errcode = 'OR002', message = 'undo';
  exception when sqlstate 'OR002' then
    null;
  end;

  insert into test.results (suite, name, passed, detail)
  select 'reset lock', x ->> 'n', coalesce((x ->> 'ok')::boolean, false), x ->> 'd'
    from jsonb_array_elements(res) x;
end $$;


-- =============================================================================
-- BACKFILL DATA (the owner's D27-398; migration "backfill data")
-- =============================================================================
-- Only days before the hotel's first live day, one room a night, a reason for
-- every correction, a removed record kept and frozen, nobody but the owner,
-- an Admin and the GM writing, and the Accountant reading. Built and undone.
-- =============================================================================
do $$
declare
  res jsonb := '[]';
  h uuid; other uuid; rt uuid; ort uuid; r101 uuid; r102 uuid; elsewhere uuid;
  gm uuid; clerk uuid; acct uuid; owner uuid; g uuid; foreign_g uuid;
  first_day date; today date; s1 uuid; s2 uuid; v text; n int;
begin
  begin
    select id into owner from staff where email = 'owner@fidato.in';
    perform set_config('app.user_id', owner::text, true);
    h     := app.provision_property_unchecked('BFL', 'Backfill Test', 'Nowhere');
    other := app.provision_property_unchecked('BFM', 'Backfill Other', 'Nowhere');
    select id into rt from room_types where hotel_id = h and code = 'STD';
    select id into ort from room_types where hotel_id = other and code = 'STD';
    insert into rooms (hotel_id, room_type_id, number) values (h, rt, '101') returning id into r101;
    insert into rooms (hotel_id, room_type_id, number) values (h, rt, '102') returning id into r102;
    insert into rooms (hotel_id, room_type_id, number) values (other, ort, '101') returning id into elsewhere;
    today := (select (now() at time zone timezone)::date from hotels where id = h);
    first_day := today - 10;
    update hotels set business_date = first_day where id = h;
    insert into staff (email, full_name) values ('bfl-gm@fidato.in', 'Backfill GM') returning id into gm;
    insert into staff (email, full_name) values ('bfl-clerk@fidato.in', 'Backfill Clerk') returning id into clerk;
    insert into staff (email, full_name) values ('bfl-acct@fidato.in', 'Backfill Accountant') returning id into acct;
    insert into staff_hotels (staff_id, hotel_id, role)
    values (gm, h, 'gm'), (clerk, h, 'front_desk'), (acct, h, 'finance');
    insert into guests (full_name, phone) values ('Backfill Guest', '9000000398') returning id into g;
    insert into guests (full_name, nationality) values ('Backfill Visitor', 'GB') returning id into foreign_g;
    perform set_config('app.hotel_code', 'BFL', true);

    -- ---------- the first day: one rule ----------
    res := res || jsonb_build_object('n', 'the first day is the day the hotel was put on',
      'ok', app.backfill_first_day(h) = first_day, 'd', app.backfill_first_day(h)::text);
    insert into night_audit_runs (hotel_id, business_date, status) values (h, first_day - 3, 'failed');
    res := res || jsonb_build_object('n', 'or an earlier night audit''s day, whatever became of the run',
      'ok', app.backfill_first_day(h) = first_day - 3, 'd', app.backfill_first_day(h)::text);
    delete from night_audit_runs where hotel_id = h;

    -- ---------- the date rule, in words ----------
    res := res || jsonb_build_object('n', 'a stay that left by the first day is allowed',
      'ok', app.backfill_refusal(h, first_day - 2, first_day) is null,
      'd', app.backfill_refusal(h, first_day - 2, first_day));
    res := res || jsonb_build_object('n', 'a day on or after the first day is a live day',
      'ok', app.backfill_refusal(h, first_day, first_day) like 'Only days before the hotel''s first day, %',
      'd', app.backfill_refusal(h, first_day, first_day));
    res := res || jsonb_build_object('n', 'a stay still in on the first day is refused',
      'ok', app.backfill_refusal(h, first_day - 1, first_day + 1) like 'A backfilled stay ends by the hotel''s first day,%',
      'd', app.backfill_refusal(h, first_day - 1, first_day + 1));
    update hotels set business_date = today + 5 where id = h;
    res := res || jsonb_build_object('n', 'never a future date, even before a first day still to come',
      'ok', app.backfill_refusal(h, today + 1, today + 2) = 'A date in the future is never backfilled.',
      'd', app.backfill_refusal(h, today + 1, today + 2));
    update hotels set business_date = first_day where id = h;

    -- ---------- the GM writes, as the application ----------
    perform set_config('app.user_id', gm::text, true);
    set local role pms_app;
    insert into backfill_stays (hotel_id, guest_id, guest_name, id_type, id_number, room_id,
                                arrival, departure, rate)
    values (h, g, 'Backfill Guest', 'driving_licence', 'DL0420110012345', r101,
            first_day - 4, first_day - 2, 3000)
    returning id into s1;
    reset role;
    res := res || jsonb_build_object('n', 'the GM adds a stay, and the database names who',
      'ok', (select entered_by from backfill_stays where id = s1) = gm);
    res := res || jsonb_build_object('n', 'a figure not typed stays empty, never a zero',
      'ok', (select room_charges is null and gst is null and paid is null from backfill_stays where id = s1));

    v := null;
    set local role pms_app;
    begin
      insert into backfill_stays (hotel_id, guest_id, guest_name, id_type, id_number, room_id, arrival, departure)
      values (h, g, 'Backfill Guest', 'driving_licence', 'DL0420110012345', r101, first_day - 3, first_day - 1);
    exception when others then v := sqlstate;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'two stays in one room on one night are refused',
      'ok', v = '23P01', 'd', v);

    v := null;
    set local role pms_app;
    begin
      insert into backfill_stays (hotel_id, guest_id, guest_name, id_type, id_number, room_id, arrival, departure)
      values (h, g, 'Backfill Guest', 'driving_licence', 'DL0420110012345', r102, first_day - 1, first_day + 1);
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'the table asks the date rule itself',
      'ok', v like '23514: A backfilled stay ends by the hotel''s first day,%', 'd', v);

    v := null;
    set local role pms_app;
    begin
      insert into backfill_stays (hotel_id, guest_id, guest_name, id_type, id_number, room_id, arrival, departure)
      values (h, g, 'Backfill Guest', 'driving_licence', 'DL0420110012345', elsewhere, first_day - 4, first_day - 2);
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'a room of another hotel is refused',
      'ok', v = '23514: That room is not one of this hotel''s.', 'd', v);

    v := null;
    set local role pms_app;
    begin
      insert into backfill_stays (hotel_id, guest_id, guest_name, nationality, id_type, id_number, room_id,
                                  arrival, departure)
      values (h, foreign_g, 'Backfill Visitor', 'GB', 'passport', 'K1234567', r102, first_day - 4, first_day - 2);
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'a foreign guest needs a visa or OCI number (Form III)',
      'ok', v like '23514:%backfill_stays_foreign_papers%', 'd', v);

    -- ---------- a correction needs its reason; nothing is deleted ----------
    v := null;
    set local role pms_app;
    begin
      update backfill_stays set rate = 3200 where id = s1;
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'a correction without a reason is refused',
      'ok', v = '23514: A correction needs its reason.', 'd', v);

    set local role pms_app;
    update backfill_stays set rate = 3200, change_reason = 'The rate on the paper bill' where id = s1;
    reset role;
    res := res || jsonb_build_object('n', 'with one it is made, and the audit log has it',
      'ok', (select rate = 3200 and changed_by = gm from backfill_stays where id = s1)
            and exists (select 1 from audit_log where table_name = 'backfill_stays' and row_id = s1::text
                          and action = 'UPDATE' and after ->> 'change_reason' = 'The rate on the paper bill'));

    v := null;
    set local role pms_app;
    begin
      delete from backfill_stays where id = s1;
    exception when others then v := sqlstate;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'a record is never deleted',
      'ok', v = '42501' and exists (select 1 from backfill_stays where id = s1), 'd', v);

    -- ---------- the front desk, and the Accountant ----------
    perform set_config('app.user_id', clerk::text, true);
    set local role pms_app;
    select count(*) into n from backfill_stays;
    v := null;
    begin
      insert into backfill_cash (hotel_id, cash_date, direction, amount, purpose, person)
      values (h, first_day - 1, 'in', 500, 'Advance', 'A guest');
    exception when others then v := sqlstate;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'reception neither reads nor writes the register',
      'ok', n = 0 and v = '42501', 'd', n || ' ' || coalesce(v, '-'));

    perform set_config('app.user_id', acct::text, true);
    set local role pms_app;
    select count(*) into n from backfill_stays;
    v := null;
    begin
      update backfill_stays set rate = 1, change_reason = 'x' where id = s1;
    exception when others then v := sqlstate;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'the Accountant reads and changes nothing',
      'ok', n = 1 and (select rate from backfill_stays where id = s1) = 3200, 'd', n || ' ' || coalesce(v, '-'));

    -- ---------- removed: kept, frozen, and the room free again ----------
    perform set_config('app.user_id', gm::text, true);
    set local role pms_app;
    update backfill_stays set removed_at = now(), removed_reason = 'Entered twice', rate = 1 where id = s1;
    insert into backfill_stays (hotel_id, guest_id, guest_name, id_type, id_number, room_id, arrival, departure)
    values (h, g, 'Backfill Guest', 'driving_licence', 'DL0420110012345', r101, first_day - 4, first_day - 2)
    returning id into s2;
    v := null;
    begin
      update backfill_stays set removed_at = null, removed_reason = null, change_reason = 'Back' where id = s1;
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'a removed stay is kept, with who and why, unchanged, and frees its room',
      'ok', (select removed_by = gm and removed_reason = 'Entered twice' and rate = 3200 from backfill_stays where id = s1)
            and s2 is not null);
    res := res || jsonb_build_object('n', 'and is never changed again',
      'ok', v like '23514: A removed record stays on the record%', 'd', v);

    -- ---------- the cash line and its day ----------
    set local role pms_app;
    v := null;
    begin
      insert into backfill_cash (hotel_id, cash_date, direction, amount, purpose, person)
      values (h, first_day, 'out', 500, 'Plumber', 'Ramesh');
    exception when others then v := sqlstate || ': ' || sqlerrm;
    end;
    reset role;
    res := res || jsonb_build_object('n', 'cash on the first day is a live day''s',
      'ok', v like '23514: Only days before the hotel''s first day,%', 'd', v);

    -- ---------- a test hotel's trade; the reset keeps the guest ----------
    res := res || jsonb_build_object('n', 'the three are a test hotel''s trade',
      'ok', (select count(*) from app.test_hotel_classes() c
              where c.table_name in ('backfill_stays', 'backfill_restaurant_bills', 'backfill_cash')
                and c.class = 'trading') = 3);
    res := res || jsonb_build_object('n', 'the full reset keeps a guest with a backfilled stay',
      'ok', not (g = any (coalesce(owner_reset.orphans(other), '{}'))));

    -- ---------- Guest 360 ----------
    res := res || jsonb_build_object('n', 'the desk counts the backfilled stay as a visit, not the removed one',
      'ok', app.guest_visits(g) = 1, 'd', app.guest_visits(g)::text);
    perform set_config('app.user_id', owner::text, true);
    res := res || jsonb_build_object('n', 'Guest 360 lists the backfilled stay, not the removed one, with no zero',
      'ok', (select count(*) from jsonb_array_elements(app.guest_360(g) -> 'stays') x
              where x ->> 'status' = 'backfilled') = 1
            and (app.guest_360(g) -> 'stays' -> 0 -> 'charged') = 'null'::jsonb,
      'd', (app.guest_360(g) -> 'stays')::text);

    raise exception using errcode = 'BF001', message = 'undo';
  exception when sqlstate 'BF001' then
    null;
  end;

  insert into test.results (suite, name, passed, detail)
  select 'backfill data', x ->> 'n', coalesce((x ->> 'ok')::boolean, false), x ->> 'd'
    from jsonb_array_elements(res) x;
end $$;
