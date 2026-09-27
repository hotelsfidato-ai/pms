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
    app.manages_person(clerk) and app.manages_person(two));
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
-- A HOTEL'S ADMIN RUNS THAT HOTEL'S PEOPLE, AND MAY MAKE AN ADMIN THERE (D23-2)
-- =============================================================================
-- The owner, 23 September: "a hotel-level Admin manages staff at their own
-- hotel, including giving Admin there". What a GM may do since D22-3, plus
-- Admin, at their own hotel and nowhere else. Each guard is asked on its own
-- (MEMORY 318). And what it does NOT reach: a closed day is still the GM's.
-- =============================================================================
do $$
declare
  h uuid; other uuid; owner uuid;
  adm uuid; clerk uuid; two uuid; newbie uuid;
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
  delete from staff_hotels where staff_id in (adm, clerk, two);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (adm, h, 'admin'), (clerk, h, 'front_desk'),
    (two, h, 'housekeeping'), (two, other, 'housekeeping');

  -- ---------- as the hotel's Admin ----------
  perform set_config('app.user_id', adm::text, true);
  roles := app.grantable_roles(h);
  perform test.ok('hotel admin', 'an Admin at a hotel may make an Admin there (D23-2)',
    'admin' = any (roles), array_to_string(roles, ','));
  perform test.ok('hotel admin', 'and every other role but Owner',
    not ('owner' = any (roles))
    and roles @> array['gm', 'hotel_manager', 'front_desk', 'housekeeping', 'finance', 'read_only']);
  perform test.ok('hotel admin', 'and nothing at a hotel where they are not Admin',
    cardinality(app.grantable_roles(other)) = 0);
  perform test.raises('hotel admin', 'rostering at that other hotel is refused',
    format($q$select app.require_hotel_admin(%L)$q$, other), '42501');

  perform test.ok('hotel admin', 'edits somebody at their hotel, never a group administrator',
    app.manages_person(clerk) and app.manages_person(two) and not app.manages_person(owner));
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
  perform test.ok('hotel admin', 'and their Admin row at the hotel, whatever the route',
    not failed and exists (select 1 from staff_hotels
                            where staff_id = newbie and hotel_id = h and role = 'admin'));

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

  -- ---------- and the fixtures go ----------
  perform set_config('app.user_id', '', true);
  delete from night_audit_runs where hotel_id = h;
  delete from staff_hotels where staff_id in (adm, clerk, two, newbie);
  update staff set is_active = false where id in (adm, clerk, two, newbie);
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
-- TELEMETRY (D27-91, D27-92) - migration 149, without the route in front of it
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
