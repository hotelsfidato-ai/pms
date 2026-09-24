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


-- =============================================================================
-- CORRECTING A CLOSED DAY (D22-18; the owner's D24-1 to D24-3)
-- =============================================================================
-- A room charge that landed on a closed day wrong is put right ON THAT DAY, by
-- the owner, an administrator or the GM, with a reason; the old line stays and
-- the correction is never changed. What holds whoever writes:
--
--   1. a clerk cannot write a correction; no reason is refused; the GM and an
--      administrator can, and the row names who really did it;
--   2. a line on a closed day is still refused with no correction behind it,
--      and allowed with one;
--   3. naming a correction does not open the door to a clerk, to another day,
--      or to another property;
--   4. a correction cannot be changed or deleted.
--
-- Builds its own two properties and leaves them, like finance.sql: a closed
-- day's lines are append-only, and a scratch database is dropped after.
-- =============================================================================
do $$
declare
  h uuid; h2 uuid; rt uuid; g uuid; res uuid; fol uuid; fol2 uuid;
  clerk uuid; gm uuid; adm uuid; charge bigint; fixed bigint; c uuid; n int;
  d date := date '2028-05-01';
  cor text := $q$insert into closed_day_corrections
                   (hotel_id, business_date, posting_id, old_amount, new_amount, reason%s)
                 values (%L, %L, %s, 3000, 2500, %L%s)$q$;
  line text := $q$insert into folio_postings
                    (hotel_id, folio_id, business_date, category, description,
                     amount, tax_rate, tax_amount, source_type, source_id, reverses_id)
                  values (%L, %L, %L, 'room', 'Room 101 · 1 night', %s, 5, %s, %L, %L, %s)$q$;
begin
  h  := app.provision_property_unchecked('NAC', 'Correction Test', 'Nowhere');
  h2 := app.provision_property_unchecked('NAD', 'Correction Test Two', 'Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';

  insert into staff (email, full_name) values ('nac-clerk@fidato.in', 'Correction Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('nac-gm@fidato.in', 'Correction GM')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('nac-admin@fidato.in', 'Correction Admin')
  on conflict (email) do update set is_active = true returning id into adm;
  delete from staff_hotels where staff_id in (clerk, gm, adm);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'front_desk'), (gm, h, 'gm'), (adm, h, 'admin'), (gm, h2, 'gm');

  insert into guests (full_name, phone) values ('Correction Guest', '9000000130')
  returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, d, d + 2, 3000, 'checked_in')
  returning id into res;
  insert into folios (hotel_id, reservation_id, status) values (h, res, 'open')
  returning id into fol;

  -- The audit's charge lands while its run is open, then the day closes; the
  -- next day closes too, and one day at the second property.
  perform set_config('app.user_id', gm::text, true);
  insert into night_audit_runs (hotel_id, business_date, status) values (h, d, 'running');
  insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                              description, amount, tax_rate, tax_amount, source_type)
  values (h, fol, res, d, 'room', 'Room 101 · 1 night', 3000, 5, 150, 'night_audit')
  returning id into charge;
  update night_audit_runs set status = 'completed', completed_at = now()
   where hotel_id = h and business_date = d;
  insert into night_audit_runs (hotel_id, business_date, status, completed_at) values
    (h, d + 1, 'completed', now()), (h2, d, 'completed', now());

  select id into rt from room_types where hotel_id = h2 and code = 'STD';
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h2, app.next_reference(h2), g, rt, d, d + 2, 3000, 'checked_in')
  returning id into res;
  insert into folios (hotel_id, reservation_id, status) values (h2, res, 'open')
  returning id into fol2;

  -- ---------- 1 · who may ----------
  perform set_config('app.user_id', clerk::text, true);
  perform test.raises('closed day correction', 'a clerk cannot correct a closed day',
    format(cor, '', h, d, charge, 'the wrong rate', ''), '42501');
  perform test.raises('closed day correction', 'a line on a closed day with no correction is still refused',
    format(line, h, fol, d, 2500, 125, null, null, 'null'), 'P0001');

  perform set_config('app.user_id', gm::text, true);
  perform test.raises('closed day correction', 'a correction without a reason is refused',
    format(cor, '', h, d, charge, '   ', ''), '23514');
  perform test.allows('closed day correction', 'the GM can correct a closed day',
    format(cor, ', corrected_by', h, d, charge, 'the wrong rate', format(', %L', clerk)));
  select id into c from closed_day_corrections where posting_id = charge;
  perform test.ok('closed day correction', 'the row names the GM, whoever it said did it',
    (select corrected_by from closed_day_corrections where id = c) = gm);

  -- ---------- 2 · with a correction behind it ----------
  perform test.allows('closed day correction', 'the reversal lands on the closed day, naming the correction',
    format(line, h, fol, d, -3000, -150, 'correction', c, charge));
  perform test.allows('closed day correction', 'and so does the right charge',
    format(line, h, fol, d, 2500, 125, 'correction', c, 'null'));
  select id into fixed from folio_postings where source_id = c and reverses_id is null;
  select count(*) into n from folio_postings where id = charge and amount = 3000;
  perform test.ok('closed day correction', 'the old line is still on the bill as it was', n = 1);

  -- ---------- 3 · naming a correction is not a key ----------
  perform set_config('app.user_id', clerk::text, true);
  perform test.raises('closed day correction', 'a clerk cannot post to a closed day by naming the GM''s correction',
    format(line, h, fol, d, 100, 5, 'correction', c, 'null'), 'P0001');
  perform set_config('app.user_id', gm::text, true);
  perform test.raises('closed day correction', 'a correction of one day opens no other day',
    format(line, h, fol, d + 1, 100, 5, 'correction', c, 'null'), 'P0001');
  perform test.raises('closed day correction', 'nor another property''s day',
    format(line, h2, fol2, d, 100, 5, 'correction', c, 'null'), 'P0001');

  perform set_config('app.user_id', adm::text, true);
  perform test.allows('closed day correction', 'an administrator can correct a closed day',
    format(cor, '', h, d, fixed, 'still wrong', ''));

  -- ---------- 4 · kept as it was ----------
  perform test.raises('closed day correction', 'a correction cannot be changed',
    format($q$update closed_day_corrections set reason = 'x' where id = %L$q$, c), 'P0001');
  perform test.raises('closed day correction', 'a correction cannot be deleted',
    format($q$delete from closed_day_corrections where id = %L$q$, c), 'P0001');
end $$;
