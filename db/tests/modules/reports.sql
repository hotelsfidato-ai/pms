-- =============================================================================
-- REPORTS - the database checks of its own tables and functions
-- =============================================================================
-- Refers to migrations by what they do, never by number.

-- =============================================================================
-- SCHEDULED REPORTS (the owner's D27-383 item 5) - who may set them, what is due
-- =============================================================================
-- Written by the hotel's owner, Administrator or GM only (the API asks too);
-- the sweep reads through app.report_schedules_due with nobody signed in.
do $$
declare
  h uuid; gm uuid; desk uuid; s uuid; n int; v text; refused boolean;
  d date := (now() at time zone 'Asia/Kolkata')::date - 1;
begin
  h := app.provision_property_unchecked('SRT', 'Schedules Test', 'Nowhere');
  insert into staff (email, full_name) values ('srt-gm@fidato.in', 'SRT Manager')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('srt-desk@fidato.in', 'SRT Desk')
  on conflict (email) do update set is_active = true returning id into desk;
  delete from staff_hotels where staff_id in (gm, desk);
  insert into staff_hotels (staff_id, hotel_id, role) values (gm, h, 'gm'), (desk, h, 'front_desk');

  -- ---------- the table: forced row security, the shared policy name ----------
  perform test.ok('scheduled reports', 'row security is forced',
    exists (select 1 from pg_class where relname = 'report_schedules' and relrowsecurity and relforcerowsecurity));
  perform test.ok('scheduled reports', 'under the shared policy name, and a delete for the managers only',
    (select string_agg(policyname, ',' order by policyname) from pg_policies where tablename = 'report_schedules')
      = 'hotel_isolation,report_schedules_removed_by_managers');
  perform test.ok('scheduled reports', 'a test hotel never copies them',
    exists (select 1 from app.test_hotel_classes() c where c.table_name = 'report_schedules' and c.class = 'never'));

  -- ---------- reception may not write one; the GM may ----------
  perform set_config('app.user_id', desk::text, true);
  refused := false;
  begin
    set local role pms_app;
    insert into report_schedules (hotel_id, report, period, frequency, weekday, file_type, addresses, changed_by)
    values (h, 'manager', 'last-week', 'weekly', 7, 'pdf', '{desk@example.com}', desk);
    reset role;
  exception when insufficient_privilege then reset role; refused := true;
  end;
  perform test.ok('scheduled reports', 'reception cannot add one', refused);

  perform set_config('app.user_id', gm::text, true);
  begin
    set local role pms_app;
    insert into report_schedules (hotel_id, report, period, frequency, weekday, file_type, addresses, changed_by, changed_at)
    values (h, 'manager', 'last-week', 'weekly', extract(isodow from d)::smallint, 'pdf',
            '{owner@example.com,gm@example.com}', gm, now() - interval '1 hour')
    returning id into s;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  perform test.ok('scheduled reports', 'the GM can', s is not null);

  perform set_config('app.user_id', desk::text, true);
  begin
    set local role pms_app;
    delete from report_schedules where hotel_id = h;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  select count(*) into n from report_schedules where hotel_id = h;
  perform test.ok('scheduled reports', 'and reception cannot take one off', n = 1, n || ' left');
  perform set_config('app.user_id', '', true);

  -- ---------- what a row may say ----------
  refused := false;
  begin
    insert into report_schedules (hotel_id, report, period, frequency, weekday, file_type, addresses)
    values (h, 'manager', 'yesterday', 'daily', 3, 'pdf', '{a@example.com}');
  exception when check_violation then refused := true;
  end;
  perform test.ok('scheduled reports', 'a day of the week only for a weekly one', refused);
  refused := false;
  begin
    insert into report_schedules (hotel_id, report, period, frequency, day_of_month, file_type, addresses)
    values (h, 'manager', 'last-month', 'monthly', 29, 'pdf', '{a@example.com}');
  exception when check_violation then refused := true;
  end;
  perform test.ok('scheduled reports', 'a date of the month from 1 to 28', refused);
  refused := false;
  begin
    insert into report_schedules (hotel_id, report, period, frequency, file_type, addresses)
    values (h, 'manager', 'yesterday', 'daily', 'pdf', '{}');
  exception when check_violation then refused := true;
  end;
  perform test.ok('scheduled reports', 'somebody to send it to', refused);

  -- ---------- what is due after the audit ----------
  insert into night_audit_runs (hotel_id, business_date, status, started_at, completed_at)
  values (h, d - 1, 'completed', now() - interval '2 hours', now() - interval '2 hours'),
         (h, d, 'completed', now(), now());
  perform set_config('app.user_id', '', true);
  begin
    set local role pms_app;
    select string_agg(o.business_date || ' ' || o.address || ' ' || (o.built_by = gm), ', ' order by o.address)
      into v from app.report_schedules_due(3, h) o;
    reset role;
  exception when insufficient_privilege then reset role;
  end;
  perform test.ok('scheduled reports',
    'after the audit of its day, with nobody signed in: each address, built as the GM - not the day before, not an audit before it was saved',
    v = format('%s gm@example.com true, %s owner@example.com true', d, d), coalesce(v, 'nothing'));

  insert into messages_sent (hotel_id, channel, kind, about_kind, about_id, status)
  values (h, 'email', 'report', 'report-schedule', s::text || '/' || d::text || '/owner@example.com', 'sent'),
         (h, 'email', 'report', 'report-schedule', s::text || '/' || d::text || '/gm@example.com', 'failed'),
         (h, 'email', 'report', 'report-schedule', s::text || '/' || d::text || '/gm@example.com', 'failed');
  select string_agg(o.address, ', ') into v from app.report_schedules_due(3, h) o;
  perform test.ok('scheduled reports', 'once per day and address; two failures, still due', v = 'gm@example.com', coalesce(v, 'nothing'));
  select count(*) into n from app.report_schedules_due(2, h);
  perform test.ok('scheduled reports', 'and not after the last try', n = 0, n || ' due');

  update report_schedules set is_paused = true where id = s;
  select count(*) into n from app.report_schedules_due(3, h);
  perform test.ok('scheduled reports', 'a paused one is due nothing', n = 0, n || ' due');
  update report_schedules set is_paused = false, last_date = d, last_status = 'refused' where id = s;
  select count(*) into n from app.report_schedules_due(3, h);
  perform test.ok('scheduled reports', 'nor a day already refused', n = 0, n || ' due');
  update report_schedules set last_status = 'sent', weekday = (extract(isodow from d)::int % 7) + 1 where id = s;
  select count(*) into n from app.report_schedules_due(3, h);
  perform test.ok('scheduled reports', 'nor a weekly one on another day', n = 0, n || ' due');
  update report_schedules set frequency = 'monthly', weekday = null, day_of_month = least(extract(day from d)::int, 28)
   where id = s;
  select count(*) into n from app.report_schedules_due(3, h);
  perform test.ok('scheduled reports', 'a monthly one on its date', n = case when extract(day from d) <= 28 then 1 else 0 end, n || ' due');

  perform test.ok('scheduled reports', 'the API role may ask what is due, the read-only role may not',
    has_function_privilege('pms_app', 'app.report_schedules_due(integer, uuid)', 'execute')
    and not has_function_privilege('pms_readonly', 'app.report_schedules_due(integer, uuid)', 'execute'));

  -- ---------- clean up ----------
  perform set_config('app.user_id', '', true);
  delete from messages_sent where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id in (gm, desk);
  update staff set is_active = false where id in (gm, desk);
  select count(*) into n from hotels where code = 'SRT';
  perform test.ok('scheduled reports', 'the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;
