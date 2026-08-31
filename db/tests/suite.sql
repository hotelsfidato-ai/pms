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

select app.provision_property_unchecked('AGR','Fidato Agra','Agra','UP','09AAAAA0000A1Z5');
select app.provision_property_unchecked('PUN','Fidato Pune','Pune','MH','27BBBBB0000B1Z5');

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
    $q$select app.provision_property_unchecked('AGR','Dup','X')$q$);

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


-- =============================================================================
-- STAFF VISIBILITY (027) is asserted in db/tests/rls.sql, not here.
--
-- This suite runs as the SUPERUSER, which bypasses Row Level Security
-- completely. Assertions about who can see whom pass or fail for reasons
-- that have nothing to do with the policies — the first version of them
-- reported "a clerk cannot see another property's staff: 1 leaked" against
-- policies that were correct, because the superuser sees everything.
--
-- rls.sql exists for exactly this and connects as pms_app. Its own header
-- says so: "a superuser bypasses RLS and would report success on a
-- completely open database."
-- =============================================================================


-- =============================================================================
-- IDENTITY CAPTURE (026) — a document that can actually be recorded
--
-- guest_documents existed from 013 with a SELECT and an INSERT policy and
-- nothing that ever wrote to it. What is asserted: a document can be
-- corrected, a type with no number is refused, and the evidence cannot be
-- deleted.
-- =============================================================================
do $$
declare a uuid; g uuid; n int;
begin
  select id into a from hotels where code='AGR';
  select r.guest_id into g from reservations r where r.hotel_id = a limit 1;

  -- A type with no number is a tick in a box, not a captured document.
  perform test.raises('identity','a document type with no number is refused',
    format($q$insert into guest_documents (guest_id, id_type, id_number)
             values (%L,'passport','   ')
             on conflict (guest_id) do update
                set id_type='passport', id_number='   '$q$, g), '23514');

  -- Captured once...
  insert into guest_documents (guest_id, id_type, id_number, country)
  values (g, 'passport', 'P1234567', 'GB')
  on conflict (guest_id) do update
     set id_type = excluded.id_type, id_number = excluded.id_number,
         country = excluded.country;

  -- ...and correctable. 013 had no UPDATE policy, so a returning guest with a
  -- renewed visa could not be recorded at all — the insert conflicted on the
  -- primary key and there was no other way in.
  update guest_documents set visa_number = 'V999', visa_expiry = '2030-01-01'
   where guest_id = g;
  select count(*) into n from guest_documents
   where guest_id = g and visa_number = 'V999';
  perform test.ok('identity','a renewed visa can be recorded', n = 1);

  perform test.ok('identity','pms_app may update a document',
    has_table_privilege('pms_app','guest_documents','update'));

  -- Evidence is not erased. Correct it; do not remove it.
  perform test.ok('identity','pms_app may NOT delete a document',
    not has_table_privilege('pms_app','guest_documents','delete'));

  -- And the property can see who still owes one.
  select count(*) into n from app.identity_missing(a);
  perform test.ok('identity','the property can list who owes a document',
    n >= 0, n || ' outstanding');

  delete from guest_documents where guest_id = g;
end $$;


-- =============================================================================
-- POS BRIDGE (024) — the boundary a point of sale posts across
--
-- The POS is built elsewhere. What is asserted here is what the PMS promises
-- it: that a retry cannot double charge, that a bill must reach the ledger or
-- say why it did not, and that a void reverses rather than deletes.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_folio uuid; n int;
begin
  select id into a from hotels where code='AGR';
  select id into v_staff from staff where email='agra@fidato.in';

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'SATTVA', 'Sattva Restaurant', 'food', v_staff)
  returning id into v_outlet;

  select f.id into v_folio from folios f where f.hotel_id = a limit 1;

  -- ---------- idempotency: the guarantee the whole bridge rests on ----------
  insert into pos_tickets (hotel_id, outlet_id, ticket_ref, folio_id,
                           business_date, amount, status, posting_id)
  select a, v_outlet, 'BILL-001', v_folio, app.business_date(a), 450,
         'posted', fp.id
    from folio_postings fp where fp.folio_id = v_folio limit 1;

  perform test.raises('pos','the same bill number twice is refused',
    format($q$insert into pos_tickets (hotel_id, outlet_id, ticket_ref,
                                       business_date, amount, status,
                                       reject_reason)
             values (%L,%L,'BILL-001',current_date,450,'rejected','dup')$q$,
           a, v_outlet), '23505');

  -- ---------- a bill either lands on the ledger, or says why not ----------
  perform test.raises('pos','a posted ticket with no posting is refused',
    format($q$insert into pos_tickets (hotel_id, outlet_id, ticket_ref,
                                       business_date, amount, status)
             values (%L,%L,'BILL-002',current_date,100,'posted')$q$,
           a, v_outlet));

  perform test.raises('pos','a rejection without a reason is refused',
    format($q$insert into pos_tickets (hotel_id, outlet_id, ticket_ref,
                                       business_date, amount, status)
             values (%L,%L,'BILL-003',current_date,100,'rejected')$q$,
           a, v_outlet));

  perform test.raises('pos','a void with no reversing posting is refused',
    format($q$insert into pos_tickets (hotel_id, outlet_id, ticket_ref,
                                       business_date, amount, status,
                                       posting_id)
             values (%L,%L,'BILL-004',current_date,100,'voided',
                     (select id from folio_postings limit 1))$q$,
           a, v_outlet));

  -- ---------- the outlet's revenue category is constrained ----------
  perform test.raises('pos','an outlet cannot invent a revenue category',
    format($q$insert into pos_outlets (hotel_id, code, name, category, staff_id)
             values (%L,'BAD','x','souvenirs',%L)$q$, a, v_staff), '23514');

  -- ---------- a bill that was sent cannot be erased ----------
  perform test.ok('pos','pms_app has no DELETE on pos_tickets',
    not has_table_privilege('pms_app','pos_tickets','delete'));

  -- ---------- chargeable rooms: checked in, folio open ----------
  select count(*) into n from app.pos_chargeable_rooms(a);
  perform test.ok('pos','chargeable rooms are all checked in with open folios',
    n = (select count(*) from reservations r
           join folios f on f.reservation_id = r.id
           join room_assignments ra on ra.reservation_id = r.id
                                   and ra.released_at is null
          where r.hotel_id = a and r.status='checked_in' and f.status='open'),
    n || ' rooms');

  delete from pos_tickets where outlet_id = v_outlet;
  delete from pos_outlets where id = v_outlet;
end $$;


-- =============================================================================
-- THE TILL (028) — the POS built into the PMS
-- =============================================================================
-- 024 proves the BRIDGE: an outside till posts a finished bill. These prove
-- the till's own rules, and the one that matters most is that a paid bill
-- stops being editable. Everything else on this screen is convenience; that
-- one is the difference between a record and a draft.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_cat uuid; v_item uuid;
  v_order uuid; v_open uuid; bd date; n int; g numeric; t numeric;
begin
  select id into a from hotels where code='AGR';
  select id into v_staff from staff where email='agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a, 'TILL', 'Till Test Outlet', 'food', v_staff)
  returning id into v_outlet;

  insert into pos_menu_categories (hotel_id, name)
  values (a, 'Test Category') returning id into v_cat;

  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a, v_cat, 'Test Dish', 100.00, 5.00) returning id into v_item;

  -- ---------- order numbers run per hotel per operating day ----------
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a, v_outlet, app.pos_next_order_no(a, bd), bd, v_staff)
  returning id into v_open;

  perform test.ok('pos till','order number carries the business date',
    (select order_no from pos_orders where id = v_open)
      like to_char(bd,'YYYYMMDD') || '-%',
    (select order_no from pos_orders where id = v_open));

  -- ---------- the total excludes struck lines ----------
  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_open, a, v_item, 'Test Dish', 2, 100.00, 5.00, v_staff);

  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by,
     voided, voided_by, voided_at)
  values (v_open, a, v_item, 'Test Dish', 5, 100.00, 5.00, v_staff,
          true, v_staff, now());

  select gross, tax into g, t from app.pos_order_total(v_open);

  -- 2 x 100 = 200 net, 5% = 10 tax, 210 gross. The struck 5 must not appear:
  -- if voided lines counted this would be 910.
  perform test.ok('pos till','a struck line is not charged for',
    g = 210.00 and t = 10.00, 'gross ' || g || ' tax ' || t);

  -- ---------- a paid bill cannot be edited ----------
  update pos_orders
     set status='settled', settled_by=v_staff, settled_at=now(),
         payment_method='cash'
   where id = v_open;

  perform test.raises('pos till','a settled order takes no new line',
    format($q$insert into pos_order_lines
               (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
             values (%L,%L,'Sneaked in',1,50,5,%L)$q$, v_open, a, v_staff),
    '23000');

  perform test.raises('pos till','a settled order''s line cannot be re-priced',
    format($q$update pos_order_lines set unit_price = 1
              where order_id = %L$q$, v_open), '23000');

  perform test.raises('pos till','a settled order''s line cannot be deleted',
    format($q$delete from pos_order_lines where order_id = %L$q$, v_open),
    '23000');

  -- ---------- and cannot be reopened to get around that ----------
  perform test.raises('pos till','a settled order cannot be reopened',
    format($q$update pos_orders set status='open' where id = %L$q$, v_open),
    '23000');

  -- ---------- settled means somebody settled it ----------
  perform test.raises('pos till','"paid" with nobody''s name on it is refused',
    format($q$insert into pos_orders
               (hotel_id, outlet_id, order_no, business_date, opened_by, status)
             values (%L,%L,'X-1',%L,%L,'settled')$q$, a, v_outlet, bd, v_staff),
    '23514');

  -- ---------- a room charge must carry its ticket ----------
  -- Without this an order reads as paid to a room while no folio posting
  -- exists -- the bill everybody believes is on the folio and is not.
  perform test.raises('pos till','a room settlement without a ticket is refused',
    format($q$insert into pos_orders
               (hotel_id, outlet_id, order_no, business_date, opened_by,
                status, settled_by, settled_at, payment_method)
             values (%L,%L,'X-2',%L,%L,'settled',%L,now(),'room')$q$,
           a, v_outlet, bd, v_staff, v_staff),
    '23514');

  -- ---------- an abandoned order says why ----------
  perform test.raises('pos till','an abandoned order names its reason',
    format($q$insert into pos_orders
               (hotel_id, outlet_id, order_no, business_date, opened_by, status)
             values (%L,%L,'X-3',%L,%L,'abandoned')$q$, a, v_outlet, bd, v_staff),
    '23514');

  -- ---------- a sold line is evidence ----------
  perform test.ok('pos till','pms_app has no DELETE on pos_order_lines',
    not has_table_privilege('pms_app','pos_order_lines','delete'));
  perform test.ok('pos till','pms_app has no DELETE on pos_orders',
    not has_table_privilege('pms_app','pos_orders','delete'));

  -- ---------- the menu ships empty ----------
  -- Prices are the hotel's. A migration that seeded a dish would put a number
  -- on a screen that looks like Fidato's and is invented.
  select count(*) into n from pos_menu_items
   where hotel_id = a and id <> v_item;
  perform test.ok('pos till','no migration invented a menu item',
    n = 0, n || ' unexplained items');

  -- ---------- and it cannot be deleted to get around THAT ----------
  -- Found by trying to tear this test down. `on delete cascade` from
  -- pos_orders fires the same BEFORE DELETE trigger on every line, so a
  -- settled order cannot be removed at all -- not by the API, which has no
  -- DELETE, and not by the superuser, which does.
  --
  -- That is the correct answer for a financial record, and it is why there
  -- is no teardown below. The suite rebuilds the database from zero on every
  -- run; a paid bill outliving the test is the point, not a leak.
  perform test.raises('pos till','a settled order cannot be deleted at all',
    format($q$delete from pos_orders where id = %L$q$, v_open), '23000');

  -- ---------- and then take the fixture back out ----------
  -- The assertion above is true and the trigger is right, but leaving the
  -- row behind put "Till Test Outlet" and a ₹100 "Test Dish" into Fidato
  -- Agra, where the POS screen listed them as real. A fixture visible in the
  -- application is the leak the demo loader had with 249 orphaned guests.
  --
  -- LIFTING the trigger to clean up is the established answer here, not a
  -- workaround: api/scripts/load-demo.ts lifts folio_postings_append_only
  -- for exactly the same reason. The rule holds for everything that is not
  -- deliberately dismantling its own fixture, which is the only thing that
  -- ever should.
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where order_id = v_open;
  delete from pos_orders where id = v_open;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_menu_items where id = v_item;
  delete from pos_menu_categories where id = v_cat;
  delete from pos_outlets where id = v_outlet;

  -- Assert the teardown rather than trusting it: a cleanup nobody measures
  -- is a cleanup nobody knows failed.
  select count(*) into n from pos_outlets where code = 'TILL';
  perform test.ok('pos till','the test fixture does not outlive the test',
    n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- THE PROVISIONING KEY (029) — no structural change without it
-- =============================================================================
-- Two guards, and they answer different questions. require_group_admin() asks
-- WHO. require_provisioning_key() asks whether this DEPLOYMENT permits the act
-- at all. A stolen admin session passes the first and must not pass the second.
--
-- The most valuable assertion here is the last one: a database with no key
-- configured provisions nothing, for anybody.
-- =============================================================================
do $$
declare
  v_admin uuid; v_clerk uuid; good text; bad text; n int;
begin
  select id into v_admin from staff where email = current_setting('test.owner_email', true);
  if v_admin is null then
    select id into v_admin from staff where is_group_admin limit 1;
  end if;
  select id into v_clerk from staff where not is_group_admin limit 1;

  good := encode(digest('test-provisioning-key', 'sha256'), 'hex');
  bad  := encode(digest('not-the-key', 'sha256'), 'hex');

  insert into provisioning_keys (label, key_hash, created_by)
  values ('suite', good, v_admin);

  -- ---------- the key is never stored ----------
  -- The row holds a digest. Somebody holding this table, or a backup of it,
  -- provisions nothing.
  select count(*) into n from provisioning_keys
   where key_hash = 'test-provisioning-key';
  perform test.ok('provisioning key','the key itself is not in the table',
    n = 0);

  -- ---------- a valid digest passes ----------
  perform app.require_provisioning_key(good);
  perform test.ok('provisioning key','an active key is accepted', true);

  -- ---------- a wrong one does not ----------
  perform test.raises('provisioning key','a wrong key is refused',
    format($q$select app.require_provisioning_key(%L)$q$, bad), '42501');

  -- ---------- and neither does none ----------
  perform test.raises('provisioning key','a missing key is refused',
    $q$select app.require_provisioning_key(null)$q$, '42501');

  -- ---------- a revoked key stops working ----------
  update provisioning_keys
     set is_active = false, revoked_at = now(), revoked_by = v_admin
   where key_hash = good;

  perform test.raises('provisioning key','a revoked key is refused',
    format($q$select app.require_provisioning_key(%L)$q$, good), '42501');

  update provisioning_keys
     set is_active = true, revoked_at = null, revoked_by = null
   where key_hash = good;

  -- ---------- revoking means revoking ----------
  -- A row that is active and revoked is a key somebody believes is dead.
  perform test.raises('provisioning key','a key cannot be revoked and active',
    format($q$update provisioning_keys set revoked_at = now(),
             revoked_by = %L where key_hash = %L$q$, v_admin, good), '23514');

  -- ---------- the application cannot read the hashes ----------
  -- Handing pms_app the digests is handing an attacker something to grind
  -- offline. The SECURITY DEFINER function is the only way in.
  perform test.ok('provisioning key','pms_app cannot read the key table',
    not has_table_privilege('pms_app','provisioning_keys','select'));

  perform test.ok('provisioning key','pms_app can still check a key',
    has_function_privilege('pms_app',
      'app.require_provisioning_key(text)', 'execute'));

  -- ---------- the door refuses; the mechanism still works ----------
  -- provision_property() now needs a key. The renamed mechanism does not,
  -- because migrations and the demo loader run as the owner with no session.
  perform test.raises('provisioning key','provisioning without a key is refused',
    $q$select app.provision_property('ZZZ','Nowhere','Nowhere', null)$q$,
    '42501');

  select count(*) into n from hotels where code = 'ZZZ';
  perform test.ok('provisioning key','a refused provision created nothing',
    n = 0, n || ' hotels named ZZZ');

  delete from provisioning_keys where key_hash = good;

  -- ---------- WITH NO KEY CONFIGURED, NOTHING PROVISIONS ----------
  -- The state that matters most. A production box where nobody has minted a
  -- key cannot have a property created on it by anyone at all.
  perform test.raises('provisioning key','with no key configured, nobody provisions',
    format($q$select app.provision_property('ZZZ','Nowhere','Nowhere', %L)$q$, good),
    '42501');
end $$;


-- =============================================================================
-- NO SHIPPED PRICES (032)
-- =============================================================================
-- A property created through the admin console used to arrive priced from a
-- template — ₹3,500 Standard, ₹4,800 Deluxe — numbers invented when the
-- templates were written and chosen by nobody at the hotel. They would have
-- shown on the tape chart, defaulted a walk-in's tariff, and reached a folio.
--
-- The group's rule is that prices are not fixed, are updated by the team, and
-- are standard nowhere. The POS menu already worked this way; this is the same
-- rule applied to the thing that was breaking it.
-- =============================================================================
do $$
declare v_hotel uuid; n int; priced int;
begin
  -- ---------- the template carries no price at all ----------
  select count(*) into n
    from information_schema.columns
   where table_name = 'room_type_templates' and column_name = 'default_rate';
  perform test.ok('no shipped prices','the room template has no rate column',
    n = 0);

  -- ---------- a new property arrives unpriced ----------
  v_hotel := app.provision_property_unchecked('PRC','Price Test','Nowhere');

  select count(*) into n      from room_types where hotel_id = v_hotel;
  select count(*) into priced from room_types
   where hotel_id = v_hotel and base_rate is not null;

  perform test.ok('no shipped prices','a new property gets its room types',
    n > 0, n || ' types');
  perform test.ok('no shipped prices','and not one of them has a price',
    priced = 0, priced || ' arrived priced');

  -- ---------- an unpriced type is NULL, never zero ----------
  -- Zero is a claim: the room is free. It would post a zero room charge at
  -- the night audit and halve the day's ADR with nothing looking wrong.
  select count(*) into n
    from room_types where hotel_id = v_hotel and base_rate = 0;
  perform test.ok('no shipped prices','an unset rate is null, not zero',
    n = 0, n || ' priced at zero');

  -- ---------- a rate can still be set, and refuses nonsense ----------
  update room_types set base_rate = 2500
   where hotel_id = v_hotel and code = 'STD';
  perform test.ok('no shipped prices','a rate can be set once the hotel has one',
    (select base_rate from room_types
      where hotel_id = v_hotel and code = 'STD') = 2500);

  perform test.raises('no shipped prices','a negative rate is refused',
    format($q$update room_types set base_rate = -1 where hotel_id = %L$q$,
           v_hotel), '23514');

  -- ---------- and the fixture goes ----------
  -- `hotels_no_delete` refuses a plain delete — "A property is deactivated,
  -- never deleted" — which is correct and caught this teardown. Lifting it
  -- for one statement is what load-demo.ts does for the same trigger; the
  -- cascade takes the room types and the invoice series with it.
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'PRC';
  perform test.ok('no shipped prices','the price fixture does not outlive the test',
    n = 0, n || ' left behind');
end $$;
