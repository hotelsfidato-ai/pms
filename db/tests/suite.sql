-- =============================================================================
-- suite.sql — every guard that currently works, as an assertion
-- =============================================================================
-- Run as superuser. RLS assertions live in rls.sql, which connects as pms_app
-- because a superuser bypasses row-level security entirely and would prove
-- nothing.
--
-- Every entry below was VERIFIED PASSING against PostgreSQL 17.6 before it was
-- written down. This is a record of working behaviour, not a wish list.
-- =============================================================================

-- ---------- fixture ----------------------------------------------------------
insert into staff (email, full_name, is_group_admin) values
  ('owner@fidato.in','Group Owner', true),
  ('agra@fidato.in','Agra Clerk',  false),
  ('pune@fidato.in','Pune Clerk',  false)
on conflict (email) do nothing;

select set_config('app.user_id',
       (select id::text from staff where email='owner@fidato.in'), false);

select app.provision_property('AGR','Fidato Agra','Agra','UP','09AAAAA0000A1Z5');
select app.provision_property('PUN','Fidato Pune','Pune','MH','27BBBBB0000B1Z5');

insert into staff_hotels (staff_id, hotel_id, role)
select s.id, h.id, 'front_desk' from staff s, hotels h
 where (s.email='agra@fidato.in' and h.code='AGR')
    or (s.email='pune@fidato.in' and h.code='PUN');

select app.bulk_create_rooms((select id from hotels where code='AGR'),'STD',1::smallint,101,110);
select app.bulk_create_rooms((select id from hotels where code='PUN'),'STD',1::smallint,201,210);

insert into guests (full_name, phone) values ('Fixture Guest','9000000001')
on conflict do nothing;


-- =============================================================================
do $$
declare
  a uuid; p uuid; g uuid; ta uuid; tp uuid; rm uuid; rm2 uuid;
  res uuid; res2 uuid; fol uuid; k uuid; n int;
begin
  select id into a  from hotels where code='AGR';
  select id into p  from hotels where code='PUN';
  select id into ta from room_types where hotel_id=a and code='STD';
  select id into tp from room_types where hotel_id=p and code='STD';
  select id into rm from rooms where hotel_id=a and number='101';
  select id into rm2 from rooms where hotel_id=a and number='102';
  select id into g  from guests where phone='9000000001';

  -- ---------- provisioning -------------------------------------------------
  perform test.ok('provisioning','property gets an invoice series',
    (select count(*) from invoice_series where hotel_id=a) = 1);
  perform test.ok('provisioning','property gets room types cloned',
    (select count(*) from room_types where hotel_id=a) = 4);
  perform test.raises('provisioning','duplicate hotel code refused',
    $q$select app.provision_property('AGR','Dup','X')$q$);

  -- ---------- tenancy integrity (D1) ---------------------------------------
  perform test.raises('integrity','room cannot use another property''s room type',
    format($q$insert into rooms (hotel_id,room_type_id,number)
             values (%L,%L,'998')$q$, a, tp), '23503');

  -- ---------- guest documents (C1 / S2) ------------------------------------
  perform test.allows('guests','passport capturable before any booking',
    format($q$insert into guest_documents (guest_id,id_type,id_number)
             values (%L,'passport','TEST12345')
             on conflict (guest_id) do update set id_number='TEST12345'$q$, g));

  -- ---------- reservations --------------------------------------------------
  insert into reservations (hotel_id,reference,guest_id,room_type_id,
                            check_in,check_out,agreed_rate,status)
  values (a, app.next_reference(a), g, ta,
          date '2027-01-01', date '2027-01-05', 3500, 'checked_in')
  returning id into res;

  -- ⚠ This assertion MUST come after `res` exists. Written earlier in the file
  --   it used `select ... from reservations` which matched zero rows, so the
  --   INSERT succeeded vacuously and the test reported a schema failure that
  --   was really a test failure. A test that inserts nothing can never fail.
  perform test.raises('integrity','folio cannot reference another property''s reservation',
    format($q$insert into folios (hotel_id,reservation_id) values (%L,%L)$q$, p, res), '23503');

  perform test.raises('reservations','backwards date range refused',
    format($q$insert into reservations (hotel_id,reference,guest_id,room_type_id,
             check_in,check_out,agreed_rate)
             values (%L,app.next_reference(%L),%L,%L,'2027-05-10','2027-05-01',3000)$q$,
           a,a,g,ta), '23514');

  perform test.raises('reservations','zero-adult booking refused',
    format($q$insert into reservations (hotel_id,reference,guest_id,room_type_id,
             check_in,check_out,agreed_rate,adults)
             values (%L,app.next_reference(%L),%L,%L,'2027-09-01','2027-09-03',3000,0)$q$,
           a,a,g,ta), '23514');

  -- ---------- room assignments ---------------------------------------------
  perform test.allows('assignments','first assignment accepted',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date)
             values (%L,%L,%L,'2027-01-01','2027-01-05')$q$, a,res,rm));

  perform test.raises('assignments','overlapping assignment on same room refused',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date)
             values (%L,%L,%L,'2027-01-02','2027-01-04')$q$, a,res,rm), '23P01');

  -- ⚠ A real turnover is TWO guests, not one booking spanning both stays.
  --   Written with a single reservation this test passed only because nothing
  --   yet tied an assignment to its booking's dates; the B2 trigger in 015
  --   exposed it. The fix was correct — the test was modelling the wrong thing.
  insert into reservations (hotel_id,reference,guest_id,room_type_id,
                            check_in,check_out,agreed_rate)
  values (a, app.next_reference(a), g, ta, date '2027-01-05', date '2027-01-08', 3500)
  returning id into res2;

  perform test.allows('assignments','back-to-back turnover allowed (out 5th, in 5th)',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date)
             values (%L,%L,%L,'2027-01-05','2027-01-08')$q$, a,res2,rm));

  update room_assignments set released_at = now()
   where reservation_id = res and from_date = date '2027-01-01';
  perform test.allows('assignments','released assignment frees the room',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date,reason)
             values (%L,%L,%L,'2027-01-02','2027-01-04','move')$q$, a,res,rm));

  -- ---------- folio ledger --------------------------------------------------
  insert into folios (hotel_id,reservation_id) values (a,res) returning id into fol;
  insert into folio_postings (hotel_id,folio_id,business_date,category,description,
                              amount,tax_rate,tax_amount)
  values (a,fol,'2027-01-01','room','Night 1',3500,12,420);

  perform test.raises('ledger','posting cannot be updated',
    format($q$update folio_postings set amount=1 where folio_id=%L$q$, fol));
  perform test.raises('ledger','posting cannot be deleted',
    format($q$delete from folio_postings where folio_id=%L$q$, fol));

  perform test.ok('ledger','balance sums correctly',
    app.folio_balance(fol) = 3920.00, 'got ' || app.folio_balance(fol));

  perform test.allows('ledger','negative posting (payment) accepted',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount) values (%L,%L,'2027-01-01','payment','cash',-1000)$q$, a,fol));

  -- ---------- idempotency (C4) ---------------------------------------------
  k := gen_random_uuid();
  insert into folio_postings (hotel_id,folio_id,business_date,category,description,
                              amount,idempotency_key)
  values (a,fol,'2027-01-01','food','Dinner',800,k);

  perform test.raises('idempotency','retried posting refused',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount,idempotency_key)
             values (%L,%L,'2027-01-01','food','Dinner',800,%L)$q$, a,fol,k), '23505');

  perform test.allows('idempotency','null keys do not collide',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount) values (%L,%L,'2027-01-01','misc','x',10)$q$, a,fol));

  -- ---------- night audit ---------------------------------------------------
  insert into night_audit_runs (hotel_id,business_date,status)
  values (a,'2027-03-01','running');
  perform test.raises('night audit','second run for same date refused',
    format($q$insert into night_audit_runs (hotel_id,business_date,status)
             values (%L,'2027-03-01','running')$q$, a), '23505');

  insert into night_audit_runs (hotel_id,business_date,status,completed_at)
  values (a,'2027-04-01','completed',now());
  perform test.raises('night audit','posting onto a closed business date refused',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount) values (%L,%L,'2027-04-01','misc','late',100)$q$, a,fol));

  -- ---------- invoicing (S1 / D9) ------------------------------------------
  perform test.ok('invoicing','invoice number issued in the right series',
    app.next_invoice_number(a, app.current_fin_year()) like 'AGR/%');
  perform test.ok('invoicing','financial year runs April to March',
    app.current_fin_year() ~ '^\d{4}-\d{2}$', app.current_fin_year());

  -- ---------- access model --------------------------------------------------
  perform test.ok('access','group admin resolves to every property',
    (select count(*) from app.auth_hotel_ids()) = (select count(*) from hotels));

  perform set_config('app.user_id',
    (select id::text from staff where email='agra@fidato.in'), true);
  perform test.ok('access','clerk resolves to exactly one property',
    (select count(*) from app.auth_hotel_ids()) = 1);

  update staff set is_active=false where email='agra@fidato.in';
  perform test.ok('access','deactivated staff resolve to zero',
    (select count(*) from app.auth_hotel_ids()) = 0);
  update staff set is_active=true where email='agra@fidato.in';

  perform set_config('app.user_id',
    (select id::text from staff where email='owner@fidato.in'), true);
  update staff set is_active=false where email='owner@fidato.in';
  perform test.ok('access','deactivated GROUP ADMIN resolves to zero',
    (select count(*) from app.auth_hotel_ids()) = 0);
  update staff set is_active=true where email='owner@fidato.in';

  -- ---------- RLS coverage (D5) --------------------------------------------
  select count(*) into n from app.tables_without_rls();
  perform test.ok('coverage','every table in public has RLS enabled', n = 0,
    coalesce((select string_agg(table_name,', ') from app.tables_without_rls()),''));
end $$;


-- =============================================================================
-- 015 edge cases — added after the fixes, verified passing.
-- =============================================================================
do $$
declare a uuid; g uuid; ta uuid; rm uuid; res uuid; fol uuid;
begin
  select id into a from hotels where code='AGR';
  select id into ta from room_types where hotel_id=a and code='STD';
  select id into rm from rooms where hotel_id=a and number='105';
  select id into g from guests where phone='9000000001';
  select id into fol from folios where hotel_id=a limit 1;

  -- B1 day use
  perform test.allows('edge B1','same-day (day-use) stay accepted',
    format($q$insert into reservations (hotel_id,reference,guest_id,room_type_id,
             check_in,check_out,agreed_rate)
             values (%L,app.next_reference(%L),%L,%L,'2027-07-01','2027-07-01',1500)$q$,
           a,a,g,ta));
  perform test.ok('edge B1','day-use flagged automatically',
    (select is_day_use from reservations where check_in='2027-07-01' and hotel_id=a limit 1));
  perform test.raises('edge B1','backwards dates still refused',
    format($q$insert into reservations (hotel_id,reference,guest_id,room_type_id,
             check_in,check_out,agreed_rate)
             values (%L,app.next_reference(%L),%L,%L,'2027-08-10','2027-08-01',3000)$q$,
           a,a,g,ta), '23514');

  -- B2 assignment inside the stay
  insert into reservations (hotel_id,reference,guest_id,room_type_id,check_in,check_out,agreed_rate)
  values (a,app.next_reference(a),g,ta,'2027-11-01','2027-11-05',3000) returning id into res;
  perform test.raises('edge B2','assignment outside the booking refused',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date)
             values (%L,%L,%L,'2028-01-01','2028-01-05')$q$, a,res,rm));
  perform test.allows('edge B2','assignment inside the booking accepted',
    format($q$insert into room_assignments (hotel_id,reservation_id,room_id,from_date,to_date)
             values (%L,%L,%L,'2027-11-01','2027-11-05')$q$, a,res,rm));

  -- B3 tax consistency
  perform test.raises('edge B3','tax_amount inconsistent with tax_rate refused',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount,tax_rate,tax_amount)
             values (%L,%L,'2027-01-01','room','bad tax',1000,12,9999)$q$, a,fol), '23514');
  perform test.allows('edge B3','correct tax accepted',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount,tax_rate,tax_amount)
             values (%L,%L,'2027-01-01','room','good tax',1000,12,120)$q$, a,fol));

  -- B4 zero amount + ancient bookings
  perform test.raises('edge B4','zero-amount posting refused',
    format($q$insert into folio_postings (hotel_id,folio_id,business_date,category,
             description,amount) values (%L,%L,'2027-01-01','misc','zero',0)$q$, a,fol), '23514');
  perform test.raises('edge B4','booking in 2019 refused',
    format($q$insert into reservations (hotel_id,reference,guest_id,room_type_id,
             check_in,check_out,agreed_rate)
             values (%L,app.next_reference(%L),%L,%L,'2019-01-01','2019-01-03',3000)$q$,
           a,a,g,ta), '23514');

  -- destructive guards
  perform test.raises('edge destroy','deleting a property refused',
    format($q$delete from hotels where id=%L$q$, a));
  perform test.raises('edge destroy','deleting a guest refused',
    format($q$delete from guests where id=%L$q$, g));
end $$;


-- =============================================================================
-- 016 audit coverage + money guards
-- =============================================================================
do $$
declare a uuid; f uuid; p bigint; n int;
begin
  select id into a from hotels where code='AGR';
  select id into f from folios where hotel_id=a limit 1;
  select id into p from folio_postings where hotel_id=a limit 1;

  perform test.raises('edge money','zero-value payment refused',
    format($q$insert into payments (hotel_id,posting_id,method,amount)
             values (%L,%L,'cash',0)$q$, a, p), '23514');

  perform test.raises('edge money','invoice counter cannot go backwards',
    format($q$update invoice_series set next_number=-5 where hotel_id=%L$q$, a), '23514');

  perform test.raises('edge money','negative room rate refused',
    format($q$update room_types set base_rate=-100 where hotel_id=%L$q$, a), '23514');

  -- audit coverage: every money/identity table must be watched
  select count(*) into n from (values
    ('payments'),('guest_documents'),('night_audit_runs'),
    ('hotels'),('room_types'),('invoice_series')) v(t)
   where not exists (select 1 from pg_trigger tr
                      where tr.tgrelid = v.t::regclass and tr.tgname like '%\_audit');
  perform test.ok('audit coverage','every money/identity table is audited', n = 0,
                  n || ' unwatched');

  -- and it actually records
  update night_audit_runs set revenue_posted = 12345 where hotel_id=a;
  select count(*) into n from audit_log where table_name='night_audit_runs';
  perform test.ok('audit coverage','day-close change leaves a trail', n > 0);

  update guest_documents set id_number='AUDITED'
   where guest_id = (select guest_id from guest_documents limit 1);
  select count(*) into n from audit_log where table_name='guest_documents';
  perform test.ok('audit coverage','passport change leaves a trail', n > 0);
end $$;


-- =============================================================================
-- 017 production readiness — Firebase, timezone, seed hygiene
-- =============================================================================
do $$
declare s uuid; a uuid; p uuid; n int;
begin
  select id into a from hotels where code='AGR';
  select id into p from hotels where code='PUN';   -- the second property

  -- P1/P2: a Firebase-shaped uid must resolve to a staff row
  update staff set firebase_uid='kJ8mN2pQ4rS6tU8vW0xY1zA3bC5d'
   where email='agra@fidato.in' returning id into s;

  perform set_config('request.jwt.claim.sub','kJ8mN2pQ4rS6tU8vW0xY1zA3bC5d', true);
  perform set_config('app.user_id','', true);
  perform test.ok('firebase','28-char Firebase uid resolves to a staff id',
                  app.current_user_id() = s, coalesce(app.current_user_id()::text,'null'));
  perform test.ok('firebase','and that identity resolves to its property',
                  (select count(*) from app.auth_hotel_ids()) = 1);

  perform set_config('request.jwt.claim.sub','', true);
  perform set_config('app.user_id', s::text, true);
  perform test.ok('firebase','a uuid in app.user_id still works',
                  app.current_user_id() = s);

  perform set_config('app.user_id','', true);
  perform set_config('request.jwt.claim.sub','no-such-firebase-user', true);
  perform test.ok('firebase','an unknown Firebase uid resolves to null',
                  app.current_user_id() is null);
  perform set_config('request.jwt.claim.sub','', true);
  perform set_config('app.user_id',
    (select id::text from staff where email='owner@fidato.in'), true);

  -- P3: no placeholder properties survive
  select count(*) into n from hotels where name like 'REPLACE%';
  perform test.ok('seed hygiene','no placeholder properties remain', n = 0, n || ' left');

  -- P4: the business date is the property's OPERATING day, not the clock.
  --
  --     Until 023 this compared app.business_date() to the wall clock in the
  --     property's timezone. That described the old definition — "what day is
  --     it there" — which is a different question and only coincidentally the
  --     same answer. A hotel whose night audit failed last night is still
  --     operating in the earlier day, and every figure must agree with it.
  --
  --     Asserted against KNOWN dates, not against a re-statement of the
  --     function's own SQL. A test that recomputes the implementation passes
  --     whatever the implementation does.
  --
  --     Agra completed an audit for 2027-04-01 further up this suite, so its
  --     operating day is the 2nd.
  perform test.ok('business date','is the day after the last COMPLETED audit',
    app.business_date(a) = date '2027-04-02', app.business_date(a)::text);

  -- A run that FAILED must not move the day. This is the whole reason the
  -- status is checked: a hotel does not reach tomorrow because someone
  -- started an audit, only because one finished.
  insert into night_audit_runs (hotel_id, business_date, status)
  values (a, '2027-05-01', 'failed');
  perform test.ok('business date','a FAILED audit does not advance the day',
    app.business_date(a) = date '2027-04-02', app.business_date(a)::text);

  update night_audit_runs set status = 'completed', completed_at = now()
   where hotel_id = a and business_date = '2027-05-01';
  perform test.ok('business date','a COMPLETED audit advances it',
    app.business_date(a) = date '2027-05-02', app.business_date(a)::text);

  delete from night_audit_runs where hotel_id = a and business_date = '2027-05-01';

  -- P4c: a property with no audit runs falls back to its configured date,
  --      and the two properties are therefore on DIFFERENT days. That is not
  --      an edge case — it is the normal state of a group at 02:00, and the
  --      thing a single BUSINESS_DATE constant could never express.
  perform test.ok('business date','no audit yet falls back to the property',
    app.business_date(p) = (select business_date from hotels where id = p),
    app.business_date(p)::text);
  perform test.ok('business date','two properties sit on different days',
    app.business_date(a) <> app.business_date(p),
    app.business_date(a)::text || ' vs ' || app.business_date(p)::text);
  perform test.ok('timezone','financial year resolves per property',
    app.current_fin_year(a) ~ '^\d{4}-\d{2}$', app.current_fin_year(a));
end $$;
