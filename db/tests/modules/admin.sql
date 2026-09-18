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
