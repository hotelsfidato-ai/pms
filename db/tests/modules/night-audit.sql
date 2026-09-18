-- =============================================================================
-- NIGHT AUDIT — the module's own assertions
-- =============================================================================
-- One file per service (docs/SERVICE-FOLDERS-PLAN.md); run after suite.sql, in
-- the same session. Everything here builds its own property and removes it,
-- so it depends on nothing the suite left behind and leaves nothing for what
-- runs next.
-- =============================================================================


-- =============================================================================
-- A CLOSED DAY'S RECORD IS CORRECTED ONLY BY THE GM (D17-12)
-- =============================================================================
-- The owner, 17 September: a day already closed is not run again, and "any
-- correction to a closed day's record needs the GM". The run never rewrites a
-- completed record (it waits on an advisory lock and answers with the record
-- instead — the API tests prove that). This is the part that holds whoever
-- writes: the database refuses a change to a completed run from anyone who
-- does not manage the property.
--
--   1. the audit completing its OWN run is not a correction;
--   2. a record that names nobody may be given its runner, once;
--   3. a clerk may not change the figures, reopen the day, move its date, or
--      change who ran it — and the record is left exactly as it was;
--   4. the GM may correct it;
--   5. a run that never completed has closed nothing, and is not guarded.
-- =============================================================================
do $$
declare
  h uuid; clerk uuid; gm uuid; n int;
  one text := $q$update night_audit_runs set %s
                   where hotel_id = %L and business_date = date '2028-03-01'$q$;
begin
  h := app.provision_property_unchecked('NAX', 'Closed Day Test', 'Nowhere');

  insert into staff (email, full_name) values ('na-clerk@fidato.in', 'Night Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('na-gm@fidato.in', 'Night GM')
  on conflict (email) do update set is_active = true returning id into gm;
  delete from staff_hotels where staff_id in (clerk, gm);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (gm, h, 'gm');

  perform set_config('app.user_id', clerk::text, true);

  -- ---------- 1 · the audit closes its own day ----------
  insert into night_audit_runs (hotel_id, business_date, status)
  values (h, date '2028-03-01', 'running');
  perform test.allows('closed day record', 'the audit completes its own run',
    format(one, $s$status = 'completed', completed_at = now(),
                   rooms_posted = 4, revenue_posted = 12000, no_shows = 1$s$, h));

  -- ---------- 2 · a record that names nobody ----------
  perform test.allows('closed day record',
    'a closed day that names nobody may be given who ran it',
    format(one, format('run_by = %L', clerk), h));

  -- ---------- 3 · a clerk cannot correct it ----------
  perform test.raises('closed day record', 'a clerk cannot change a closed day''s figures',
    format(one, 'rooms_posted = 5', h), '42501');
  perform test.raises('closed day record', 'a clerk cannot reopen a closed day',
    format(one, $s$status = 'running'$s$, h), '42501');
  perform test.raises('closed day record', 'a clerk cannot move a closed day to another date',
    format(one, $s$business_date = date '2028-03-02'$s$, h), '42501');
  perform test.raises('closed day record', 'a clerk cannot change who ran a closed day',
    format(one, format('run_by = %L', gm), h), '42501');

  select count(*) into n from night_audit_runs
   where hotel_id = h and business_date = date '2028-03-01' and status = 'completed'
     and rooms_posted = 4 and revenue_posted = 12000 and no_shows = 1 and run_by = clerk;
  perform test.ok('closed day record', 'the refused corrections left the record as it was',
    n = 1, n || ' matching');

  -- ---------- 4 · the GM can ----------
  perform set_config('app.user_id', gm::text, true);
  perform test.allows('closed day record', 'the GM can correct a closed day''s record',
    format(one, 'revenue_posted = 11500', h));
  select count(*) into n from night_audit_runs
   where hotel_id = h and business_date = date '2028-03-01' and revenue_posted = 11500;
  perform test.ok('closed day record', 'the GM''s correction stands', n = 1, n || ' matching');

  -- ---------- 5 · a run that never completed ----------
  perform set_config('app.user_id', clerk::text, true);
  insert into night_audit_runs (hotel_id, business_date, status)
  values (h, date '2028-03-09', 'running');
  perform test.allows('closed day record', 'a run still running is not a closed day',
    format($q$update night_audit_runs set rooms_posted = 2
               where hotel_id = %L and business_date = date '2028-03-09'$q$, h));

  -- ---------- and the fixture goes ----------
  delete from night_audit_runs where hotel_id = h;
  delete from staff_hotels where staff_id in (clerk, gm);
  update staff set is_active = false where id in (clerk, gm);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'NAX';
  perform test.ok('closed day record', 'the fixture does not outlive the test',
    n = 0, n || ' left behind');
end $$;
