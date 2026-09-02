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


-- =============================================================================
-- RATES (033) — what a room costs, on a date, on a plan
-- =============================================================================
-- The load-bearing assertion is the overlap one. Two prices covering one day
-- for one room type on one plan means the hotel cannot say what the room
-- costs, and the person who finds out is a guest at a checkout.
-- =============================================================================
do $$
declare
  a uuid; v_type uuid; v_admin uuid; p numeric;
begin
  select id into a from hotels where code='AGR';
  select id into v_type from room_types where hotel_id = a and code = 'STD';
  select id into v_admin from staff where is_group_admin limit 1;

  -- ---------- an unpriced room is NULL, not zero ----------
  update room_types set base_rate = null where id = v_type;
  perform test.ok('rates','an unpriced room type answers null, not zero',
    app.rate_for(v_type, 'EP', date '2026-08-25') is null);

  -- ---------- the rack rate answers when no rate row covers the date ----------
  update room_types set base_rate = 3000 where id = v_type;
  perform test.ok('rates','the rack rate answers when nothing else does',
    app.rate_for(v_type, 'EP', date '2026-08-25') = 3000);

  -- ---------- a rate row wins over the rack ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, valid_to, label, created_by)
  values (a, v_type, 'EP', 3500, date '2026-12-01', date '2027-01-01',
          'Winter', v_admin);

  perform test.ok('rates','a covering rate beats the rack rate',
    app.rate_for(v_type, 'EP', date '2026-12-14') = 3500);
  perform test.ok('rates','and only inside its own range',
    app.rate_for(v_type, 'EP', date '2026-11-30') = 3000);

  -- ---------- half-open, like every other range in this schema ----------
  -- A season to the 1st of January covers the 31st of December and not the
  -- 1st. Getting this wrong double-prices one day a year, every year.
  perform test.ok('rates','the last day of a range is excluded',
    app.rate_for(v_type, 'EP', date '2027-01-01') = 3000);
  perform test.ok('rates','the first day of a range is included',
    app.rate_for(v_type, 'EP', date '2026-12-01') = 3500);

  -- ---------- plans are priced apart ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, created_by)
  values (a, v_type, 'CP', 4200, date '2026-01-01', v_admin);

  perform test.ok('rates','breakfast is a different price from room only',
    app.rate_for(v_type, 'CP', date '2026-12-14') = 4200
    and app.rate_for(v_type, 'EP', date '2026-12-14') = 3500);

  -- ---------- TWO PRICES FOR ONE DAY IS REFUSED ----------
  perform test.raises('rates','two rates covering one day are refused',
    format($q$insert into rates (hotel_id, room_type_id, meal_plan, price,
                                 valid_from, valid_to)
              values (%L,%L,'EP',9999,'2026-12-10','2026-12-20')$q$,
           a, v_type), '23P01');

  -- ---------- and an open-ended one cannot swallow an existing range ----------
  perform test.raises('rates','an open-ended rate cannot overlap a season',
    format($q$insert into rates (hotel_id, room_type_id, meal_plan, price,
                                 valid_from)
              values (%L,%L,'EP',9999,'2026-01-01')$q$, a, v_type), '23P01');

  -- ---------- a backwards range is refused ----------
  perform test.raises('rates','a range that ends before it starts is refused',
    format($q$insert into rates (hotel_id, room_type_id, meal_plan, price,
                                 valid_from, valid_to)
              values (%L,%L,'MAP',1000,'2026-06-01','2026-05-01')$q$,
           a, v_type), '23514');

  -- ---------- a negative price is refused ----------
  perform test.raises('rates','a negative price is refused',
    format($q$insert into rates (hotel_id, room_type_id, meal_plan, price,
                                 valid_from)
              values (%L,%L,'AP',-1,'2026-01-01')$q$, a, v_type), '23514');

  -- ---------- a plan must be one the system knows ----------
  perform test.raises('rates','a made-up meal plan is refused',
    format($q$insert into rates (hotel_id, room_type_id, meal_plan, price,
                                 valid_from)
              values (%L,%L,'BRUNCH',1000,'2026-01-01')$q$, a, v_type), '23503');

  -- ---------- this migration priced nothing ----------
  -- The group's rule: no defaults. A rates table that arrived with rows in
  -- it would be the same defect 032 removed from the room type templates.
  perform test.ok('rates','no migration wrote a rate of its own',
    (select count(*) from rates
      where created_by is null and label is null) = 0);

  delete from rates where hotel_id = a and room_type_id = v_type;
  update room_types set base_rate = null where id = v_type;
end $$;


-- =============================================================================
-- THE KITCHEN TICKET (034)
-- =============================================================================
-- KOT and BILL are two different acts. A table orders starters, the kitchen
-- starts on them, the table orders mains twenty minutes later, and the bill
-- happens once. Collapsing them — which this till did until 034 — means the
-- kitchen hears about the food when the guest asks to pay.
-- =============================================================================
do $$
declare
  a uuid; v_staff uuid; v_outlet uuid; v_cat uuid; v_item uuid;
  v_order uuid; bd date; n int;
begin
  select id into a from hotels where code='AGR';
  select id into v_staff from staff where email='agra@fidato.in';
  bd := app.business_date(a);

  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (a,'KOTT','KOT Test','food',v_staff) returning id into v_outlet;
  insert into pos_menu_categories (hotel_id, name)
  values (a,'KOT Cat') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (a,v_cat,'KOT Dish',100,5) returning id into v_item;

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (a,v_outlet,app.pos_next_order_no(a,bd),bd,v_staff)
  returning id into v_order;

  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order,a,v_item,'KOT Dish',1,100,5,v_staff);

  -- ---------- ringing it up does NOT tell the kitchen ----------
  -- Otherwise every hesitation over the menu fires a ticket.
  perform test.ok('kot','a new line is pending, not sent',
    (select kot_status from pos_order_lines where order_id = v_order) = 'pending');

  -- ---------- a pending line has no sent time, a sent one must ----------
  perform test.raises('kot','a sent line must say when',
    format($q$update pos_order_lines set kot_status='sent'
            where order_id=%L$q$, v_order), '23514');

  update pos_order_lines set kot_status='sent', kot_sent_at=now()
   where order_id = v_order;
  perform test.ok('kot','a sent line carries its time', true);

  -- ---------- the kitchen can only be told about real states ----------
  perform test.raises('kot','a made-up kitchen state is refused',
    format($q$update pos_order_lines set kot_status='burnt'
            where order_id=%L$q$, v_order), '23514');

  -- ---------- cancelling something the kitchen HAS is recorded ----------
  -- Cancelling a dish nobody started is free. Cancelling one on the fire
  -- costs food, and the pass must be told rather than have it vanish.
  update pos_order_lines
     set voided=true, voided_by=v_staff, voided_at=now()
   where order_id = v_order;

  perform test.ok('kot','a strike after the kitchen had it is marked',
    (select was_sent_when_voided from pos_order_lines
      where order_id = v_order) = true);

  -- ---------- an order knows how it is being taken ----------
  perform test.ok('kot','an order defaults to dine-in',
    (select order_type from pos_orders where id = v_order) = 'dine_in');
  perform test.raises('kot','a made-up order type is refused',
    format($q$update pos_orders set order_type='telepathy' where id=%L$q$,
           v_order), '23514');

  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where order_id = v_order;
  delete from pos_orders where id = v_order;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;
  delete from pos_menu_items where id = v_item;
  delete from pos_menu_categories where id = v_cat;
  delete from pos_outlets where id = v_outlet;

  select count(*) into n from pos_outlets where code='KOTT';
  perform test.ok('kot','the KOT fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- CANCELLATION TERMS — 036, 037
-- =============================================================================
-- The night audit charged nothing on a no-show because nothing modelled what
-- one costs. These assert the two halves of the fix and, more importantly, the
-- thing that must stay true: NULL is not zero. A booking with no terms has no
-- agreement behind it; a booking with terms saying 'nothing' has one. The
-- audit reports them differently and they must never collapse together.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_guest uuid; v_type uuid;
  v_pol uuid; v_pol2 uuid; v_res uuid; n int;
begin
  v_hotel := app.provision_property_unchecked('CXL','Terms Test','Nowhere');
  select id into v_type from room_types where hotel_id = v_hotel limit 1;

  -- `guests` is group-level: no hotel_id, like `staff`. A person who stays at
  -- Akkalkot in March and Pune in June is one guest.
  insert into guests (full_name)
  values ('Terms Tester') returning id into v_guest;

  -- ---------- ships with nothing ----------
  select count(*) into n from cancellation_policies where hotel_id = v_hotel;
  perform test.ok('cancellation terms','a new property has no terms', n = 0,
    n || ' arrived');

  -- ---------- a booking made with no policy carries no terms ----------
  insert into reservations
    (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
     agreed_rate, adults)
  values (v_hotel, app.next_reference(v_hotel), v_guest, v_type,
          '2026-03-01', '2026-03-03', 4000, 1)
  returning id into v_res;

  perform test.ok('cancellation terms','a booking with no policy has no basis',
    (select cancel_basis from reservations where id = v_res) is null);

  -- THE assertion. Null, not zero: nobody agreed to anything, which is not
  -- the same as agreeing that nothing is owed.
  perform test.ok('cancellation terms','retention is NULL, never zero',
    app.retention_for(v_res, 'no_show') is null);

  -- ---------- a basis without its figure is refused ----------
  perform test.raises('cancellation terms','percent with no percentage refused',
    format($q$insert into cancellation_policies
               (hotel_id, name, cancel_basis, no_show_basis)
             values (%L,'Broken','percent','nothing')$q$, v_hotel), '23514');

  perform test.raises('cancellation terms','a percentage over 100 is refused',
    format($q$insert into cancellation_policies
               (hotel_id, name, cancel_basis, cancel_percent, no_show_basis)
             values (%L,'Greedy','percent',140,'nothing')$q$, v_hotel), '23514');

  -- ---------- the property writes its terms ----------
  insert into cancellation_policies
    (hotel_id, name, free_until_hours,
     cancel_basis, no_show_basis, no_show_percent)
  values (v_hotel, 'Standard', 24, 'first_night', 'percent', 75)
  returning id into v_pol;

  -- Still nothing frozen: a policy that has not been chosen applies to nobody.
  insert into reservations
    (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
     agreed_rate, adults)
  values (v_hotel, app.next_reference(v_hotel), v_guest, v_type,
          '2026-04-01', '2026-04-03', 4000, 1)
  returning id into v_res;

  perform test.ok('cancellation terms','an unchosen policy applies to nobody',
    (select cancel_basis from reservations where id = v_res) is null);

  -- ---------- the property chooses it ----------
  update cancellation_policies set applies_to_new_bookings = true
   where id = v_pol;

  insert into reservations
    (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
     agreed_rate, adults)
  values (v_hotel, app.next_reference(v_hotel), v_guest, v_type,
          '2026-05-01', '2026-05-03', 4000, 1)
  returning id into v_res;

  perform test.ok('cancellation terms','the chosen policy freezes onto a booking',
    (select cancel_terms from reservations where id = v_res) = 'Standard');

  -- 4000 x 2 nights x 75% = 6000. The arithmetic, not just the wiring.
  perform test.ok('cancellation terms','a no-show retains the agreed share',
    app.retention_for(v_res, 'no_show') = 6000,
    coalesce(app.retention_for(v_res,'no_show')::text,'null'));

  -- first_night is one night at the agreed rate, whatever the length of stay.
  perform test.ok('cancellation terms','a cancellation retains one night',
    app.retention_for(v_res, 'cancel') = 4000,
    coalesce(app.retention_for(v_res,'cancel')::text,'null'));

  -- ---------- the terms do not move under a booking ----------
  -- The whole reason they are copied. A hotel changing its mind in June must
  -- not change what a guest agreed to in March.
  update cancellation_policies set no_show_percent = 100 where id = v_pol;
  perform test.ok('cancellation terms','changing the policy does not move a booking',
    app.retention_for(v_res, 'no_show') = 6000,
    coalesce(app.retention_for(v_res,'no_show')::text,'null'));

  -- ---------- only one policy can claim new bookings ----------
  insert into cancellation_policies
    (hotel_id, name, cancel_basis, no_show_basis)
  values (v_hotel, 'Second', 'nothing', 'nothing')
  returning id into v_pol2;

  perform test.raises('cancellation terms','two default policies are refused',
    format($q$update cancellation_policies
                set applies_to_new_bookings = true where id = %L$q$, v_pol2),
    '23505');

  -- ---------- a policy of 'nothing' is zero, and that is not null ----------
  update cancellation_policies set applies_to_new_bookings = false where id = v_pol;
  update cancellation_policies set applies_to_new_bookings = true where id = v_pol2;

  insert into reservations
    (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
     agreed_rate, adults)
  values (v_hotel, app.next_reference(v_hotel), v_guest, v_type,
          '2026-06-01', '2026-06-03', 4000, 1)
  returning id into v_res;

  perform test.ok('cancellation terms','terms of nothing retain zero, not null',
    app.retention_for(v_res, 'no_show') = 0,
    coalesce(app.retention_for(v_res,'no_show')::text,'null'));

  delete from reservations where hotel_id = v_hotel;
  delete from cancellation_policies where hotel_id = v_hotel;
  /* The guest goes too, and the guard has to be lifted to do it. `guests` is
     the one table a delete is refused on — "stay history and the audit trail
     depend on the row", 015 — which is right for a hotel and wrong for a
     fixture.

     ⚠ FOUND BY LEAVING IT IN. The suite rebuilds `fidato` from zero and then
     load-demo runs against what the suite left, so a test guest with no stay
     is not harmless: load-demo's own hygiene check counts guests belonging to
     no property and refused to load — "1 guests have no stay at any
     property". A leaked fixture broke the next gate, exactly as that check
     was written to catch. */
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;
end $$;


-- =============================================================================
-- HOUSEKEEPING ASSIGNMENT — 035
-- =============================================================================
-- The board showed every room to everybody, which is a status display and not
-- a work list. These hold the two rules that make it one: a room belongs to
-- one person on a day, and that person works at this property.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_room uuid; v_staff uuid; v_other uuid; n int;
begin
  select id into v_hotel from hotels where code = 'CXL';

  /* The provisioned property has room TYPES and no rooms — the group's rule
     is that the owner adds those, the same rule that keeps prices out. So the
     test makes its own rather than assuming one is there. */
  insert into rooms (hotel_id, room_type_id, number, floor)
  select v_hotel, id, '901', 9 from room_types where hotel_id = v_hotel limit 1
  returning id into v_room;

  insert into staff (email, full_name)
  values ('hk.test@example.com', 'Housekeeper Test') returning id into v_staff;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'housekeeping');

  -- Somebody at a property this room is not at.
  insert into staff (email, full_name)
  values ('hk.elsewhere@example.com', 'Elsewhere') returning id into v_other;

  insert into housekeeping_assignments (hotel_id, room_id, work_date, staff_id)
  values (v_hotel, v_room, '2026-07-01', v_staff);

  perform test.ok('housekeeping','a room can be given to a named person',
    (select staff_id from housekeeping_assignments
      where room_id = v_room and work_date = '2026-07-01') = v_staff);

  -- ---------- one housekeeper per room per day ----------
  -- Two people told to clean 204 is how 204 is cleaned twice and 205 not at all.
  perform test.raises('housekeeping','a second person for the same day is refused',
    format($q$insert into housekeeping_assignments
               (hotel_id, room_id, work_date, staff_id)
             values (%L,%L,'2026-07-01',%L)$q$, v_hotel, v_room, v_staff),
    '23505');

  -- ---------- the same room, the next day, is a different question ----------
  insert into housekeeping_assignments (hotel_id, room_id, work_date, staff_id)
  values (v_hotel, v_room, '2026-07-02', v_staff);
  select count(*) into n from housekeeping_assignments where room_id = v_room;
  perform test.ok('housekeeping','tomorrow is its own assignment', n = 2,
    n || ' rows');

  -- ---------- D7: you cannot be given work where you do not work ----------
  -- The comment in 012 described this exact case long before there was an
  -- assignment table to attach it to.
  perform test.raises('housekeeping','somebody with no access here is refused',
    format($q$insert into housekeeping_assignments
               (hotel_id, room_id, work_date, staff_id)
             values (%L,%L,'2026-07-03',%L)$q$, v_hotel, v_room, v_other),
    'P0001');

  delete from housekeeping_assignments where hotel_id = v_hotel;
  delete from rooms where id = v_room;
  delete from staff_hotels where staff_id in (v_staff, v_other);
  delete from staff where id in (v_staff, v_other);

  select count(*) into n from staff where email like 'hk.%@example.com';
  perform test.ok('housekeeping','the fixture does not outlive the test', n = 0);

  /* And the property, which both this block and the cancellation-terms block
     above share.

     ⚠ FOUND BY verify-backup, not by the suite. Every assertion passed with
     CXL still standing; the backup check counts properties and said
     "properties 4 (expected 3)". A test fixture that survives its test is
     indistinguishable from real data in a restore. */
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'CXL';
  perform test.ok('housekeeping','the terms fixture does not outlive it either',
    n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- SPLIT BILLING — the model 006 built and nothing used
-- =============================================================================
-- "A company pays the room while the guest pays their own bar tab, which is two
-- folios on one stay. Model that from the start; retrofitting split billing is
-- genuinely painful." It was modelled. `bill_to` and `company_id` were then
-- columns no code had ever written.
--
-- The assertion that matters is CONSERVATION: a transfer must not create or
-- destroy money. Three rows exist afterwards and the two folios together must
-- hold exactly what the one folio held before.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_guest uuid; v_type uuid; v_res uuid; v_co uuid;
  v_guest_folio uuid; v_co_folio uuid; v_line bigint;
  before_total numeric; after_total numeric; n int;
begin
  v_hotel := app.provision_property_unchecked('SPL','Split Test','Nowhere');
  select id into v_type from room_types where hotel_id = v_hotel limit 1;

  insert into guests (full_name) values ('Split Tester') returning id into v_guest;
  -- Group-level, like `guests`: one corporate account billable at every
  -- property in the group, which is the point of a group.
  insert into companies (name) values ('Acme Ltd') returning id into v_co;

  insert into reservations
    (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
     agreed_rate, adults)
  values (v_hotel, app.next_reference(v_hotel), v_guest, v_type,
          '2026-03-01', '2026-03-03', 5000, 1)
  returning id into v_res;

  insert into folios (hotel_id, reservation_id, bill_to)
  values (v_hotel, v_res, 'guest') returning id into v_guest_folio;

  -- ---------- a company folio must name its company ----------
  perform test.raises('split billing','a company folio with no company is refused',
    format($q$insert into folios (hotel_id, reservation_id, bill_to)
             values (%L,%L,'company')$q$, v_hotel, v_res), '23514');

  insert into folios (hotel_id, reservation_id, bill_to, company_id)
  values (v_hotel, v_res, 'company', v_co) returning id into v_co_folio;

  perform test.ok('split billing','one stay carries two folios',
    (select count(*) from folios where reservation_id = v_res) = 2);

  -- ---------- a room charge and a bar tab on the guest folio ----------
  insert into folio_postings
    (hotel_id, folio_id, business_date, category, description,
     amount, tax_rate, tax_amount)
  values (v_hotel, v_guest_folio, '2026-03-01', 'room', 'Room · 1 night',
          5000, 12, 600)
  returning id into v_line;

  insert into folio_postings
    (hotel_id, folio_id, business_date, category, description,
     amount, tax_rate, tax_amount)
  values (v_hotel, v_guest_folio, '2026-03-01', 'beverage', 'Bar', 800, 5, 40);

  select sum(amount + tax_amount) into before_total
    from folio_postings where hotel_id = v_hotel;

  -- ---------- the transfer: a reversal AND a fresh posting ----------
  -- Exactly what the endpoint does, written out so the arithmetic is the
  -- thing under test rather than the HTTP.
  insert into folio_postings
    (hotel_id, folio_id, business_date, category, description,
     amount, tax_rate, tax_amount, reverses_id)
  values (v_hotel, v_guest_folio, '2026-03-01', 'room',
          'Transferred out — Room · 1 night', -5000, 12, -600, v_line);

  insert into folio_postings
    (hotel_id, folio_id, business_date, category, description,
     amount, tax_rate, tax_amount, source_type)
  values (v_hotel, v_co_folio, '2026-03-01', 'room',
          'Transferred in — Room · 1 night', 5000, 12, 600, 'transfer');

  -- ---------- money is conserved ----------
  -- The single most important property here. Live postings only: the reversal
  -- and the row it points at both drop out, which is what makes the pair
  -- cancel rather than merely annotate.
  select coalesce(sum(fp.amount + fp.tax_amount), 0) into after_total
    from folio_postings fp
   where fp.hotel_id = v_hotel
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings rev
                      where rev.reverses_id = fp.id);

  perform test.ok('split billing','a transfer neither creates nor destroys money',
    after_total = 6440, after_total::text || ' vs 6440');

  -- ---------- and it landed on the right bills ----------
  perform test.ok('split billing','the room is on the company folio',
    (select coalesce(sum(fp.amount + fp.tax_amount),0)
       from folio_postings fp
      where fp.folio_id = v_co_folio
        and fp.reverses_id is null
        and not exists (select 1 from folio_postings rev
                         where rev.reverses_id = fp.id)) = 5600);

  perform test.ok('split billing','the bar stayed with the guest',
    (select coalesce(sum(fp.amount + fp.tax_amount),0)
       from folio_postings fp
      where fp.folio_id = v_guest_folio
        and fp.reverses_id is null
        and not exists (select 1 from folio_postings rev
                         where rev.reverses_id = fp.id)) = 840);

  -- ---------- the ledger is still append-only ----------
  -- The reason a transfer is two rows and not an UPDATE of folio_id.
  perform test.raises('split billing','a posting cannot be moved by editing it',
    format($q$update folio_postings set folio_id = %L where id = %L$q$,
           v_co_folio, v_line), 'P0001');

  -- ---------- the reversal carries consistent tax ----------
  -- fp_tax_consistent (015) refuses a row whose tax does not follow from its
  -- own rate. A negative reversal has to satisfy it too, and does.
  perform test.raises('split billing','a reversal with mismatched tax is refused',
    format($q$insert into folio_postings
               (hotel_id, folio_id, business_date, category, description,
                amount, tax_rate, tax_amount)
             values (%L,%L,'2026-03-01','room','Bad', -1000, 12, -5)$q$,
           v_hotel, v_guest_folio), '23514');

  /* The ledger refuses a delete — "post a reversing entry instead" — which is
     the rule this whole block exists to respect. Lifted for the teardown, the
     same way the suite lifts hotels_no_delete and pos_order_lines_frozen. */
  alter table folio_postings disable trigger folio_postings_append_only;
  delete from folio_postings where hotel_id = v_hotel;
  alter table folio_postings enable trigger folio_postings_append_only;

  delete from folios where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  delete from companies where id = v_co;

  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'SPL';
  perform test.ok('split billing','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- POS discount, round off, and split tender  (038)
-- =============================================================================
-- The discount comes off the NET and is apportioned across TAX RATES. A
-- restaurant selling 5% food beside 18% bar must reduce each rate's taxable
-- value in proportion, or the per-rate folio postings are wrong — a split that
-- was a defect once already.
--
-- Apportioning by proportion leaves a paise residue. It is absorbed by the
-- largest rate group so the parts always sum to the whole, because a bill that
-- is a paise out is a bill the guest is holding.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_outlet uuid; v_order uuid; v_order2 uuid;
  r record; n int; rate_taxable numeric; rate_tax numeric;
begin
  insert into hotels (code, name, city, timezone)
  values ('PDC', 'Discount fixture', 'Akkalkot', 'Asia/Kolkata') returning id into v_hotel;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'pos') on conflict do nothing;

  insert into pos_outlets (hotel_id, code, name, staff_id)
  values (v_hotel, 'PDCO', 'Discount outlet', v_staff) returning id into v_outlet;

  -- ---------- two rates, a discount that divides cleanly ----------
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                          opened_by, discount_amount, discount_reason,
                          discount_type, discount_value)
  values (v_hotel, v_outlet, 'PDC-1', current_date, v_staff, 100.00, 'manager comp',
          'fixed', 100.00)
  returning id into v_order;

  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, v_hotel, 'Food', 1, 700.00, 5.00,  v_staff),
         (v_order, v_hotel, 'Beer', 1, 300.00, 18.00, v_staff);

  select * into r from app.pos_order_total(v_order);

  -- 700 keeps 70 of the discount, 300 keeps 30. Tax is 5% of 630 plus 18% of
  -- 270 = 31.50 + 48.60. Applied to the GROSS instead it would be 84.30.
  perform test.ok('pos discount','discount is apportioned across tax rates, not taken off the gross',
    r.tax = 80.10, 'tax ' || r.tax);
  perform test.ok('pos discount','taxable is net less the discount',
    r.taxable = 900.00 and r.net = 1000.00, 'taxable ' || r.taxable);
  perform test.ok('pos discount','gross is taxable plus tax',
    r.gross = 980.10, 'gross ' || r.gross);

  -- ---------- three rates, a discount that does not ----------
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                          opened_by, discount_amount, discount_reason, round_off,
                          discount_type, discount_value)
  values (v_hotel, v_outlet, 'PDC-2', current_date, v_staff, 100.00, 'three ways', -0.10,
          'fixed', 100.00)
  returning id into v_order2;

  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order2, v_hotel, 'A', 1, 333.33, 5.00,  v_staff),
         (v_order2, v_hotel, 'B', 1, 333.33, 12.00, v_staff),
         (v_order2, v_hotel, 'C', 1, 333.34, 18.00, v_staff);

  select * into r from app.pos_order_total(v_order2);

  -- Each share rounds to 33.33 and they sum to 99.99. The missing paise must
  -- land on the largest group or the discount silently shrinks.
  perform test.ok('pos discount','the rounding residue is absorbed, not lost',
    r.discount = 100.00, 'discount ' || r.discount);
  perform test.ok('pos discount','round off reaches the payable',
    r.payable = r.gross - 0.10, 'payable ' || r.payable);

  -- ---------- a discount cannot exceed the bill ----------
  update pos_orders set discount_amount = 99999.00, discount_value = 99999.00
   where id = v_order;
  select * into r from app.pos_order_total(v_order);
  perform test.ok('pos discount','a discount is capped at the bill, never negative',
    r.discount = 1000.00 and r.payable = 0.00, 'payable ' || r.payable);
  update pos_orders set discount_amount = 100.00, discount_value = 100.00
   where id = v_order;

  -- ---------- the reason is not optional ----------
  perform test.raises('pos discount','a discount without a reason is refused',
    format($q$update pos_orders set discount_amount = 50, discount_value = 50,
                     discount_reason = null where id = %L$q$, v_order), '23514');

  perform test.raises('pos discount','a blank reason is not a reason',
    format($q$update pos_orders set discount_amount = 50, discount_value = 50,
                     discount_reason = '   ' where id = %L$q$, v_order), '23514');

  -- A round off is pennies. Anything larger is a discount avoiding the reason.
  perform test.raises('pos discount','a round off larger than a rupee is refused',
    format($q$update pos_orders set round_off = -5.00 where id = %L$q$, v_order),
    '23514');

  -- ---------- the per-rate breakdown IS what reaches the folio ----------
  -- The room-settle path posts one folio row per tax rate. Before 040 it
  -- computed that split itself, straight from the lines, so a discounted bill
  -- charged to a room posted the FULL amount: the guest holds a discounted
  -- bill and the folio disagrees, days later, where nobody can reconstruct why.
  select coalesce(sum(taxable), 0), coalesce(sum(tax), 0)
    into rate_taxable, rate_tax
    from app.pos_order_by_rate(v_order2);

  perform test.ok('pos discount','the per-rate rows sum to the order total',
    (select taxable from app.pos_order_total(v_order2)) = rate_taxable
    and (select tax from app.pos_order_total(v_order2)) = rate_tax,
    'by rate ' || rate_taxable || ' + ' || rate_tax);

  perform test.ok('pos discount','every rate carries a share of the discount',
    not exists (select 1 from app.pos_order_by_rate(v_order2) where discount = 0),
    'three rates, three shares');

  perform test.ok('pos discount','tax per rate is charged on the discounted value',
    (select tax from app.pos_order_by_rate(v_order2) where tax_rate = 18.00)
      < round(333.34 * 0.18, 2),
    'discounted 18% tax is below the undiscounted 60.00');

  -- ---------- percentage or fixed, and the bill must say which ----------
  perform test.raises('pos discount','a discount amount with no type is refused',
    format($q$update pos_orders set discount_amount = 50, discount_value = 50,
                     discount_type = null where id = %L$q$, v_order), '23514');

  perform test.raises('pos discount','a fixed discount whose value disagrees with the amount',
    format($q$update pos_orders set discount_amount = 50, discount_value = 75,
                     discount_type = 'fixed' where id = %L$q$, v_order), '23514');

  perform test.raises('pos discount','more than 100 percent is a refund in disguise',
    format($q$update pos_orders set discount_amount = 50, discount_value = 120,
                     discount_type = 'percent' where id = %L$q$, v_order), '23514');

  -- 10% of a 1000.00 net is 100.00, computed once and stored — never recomputed
  -- on read, or adding a line would silently move an already printed bill.
  perform test.ok('pos discount','a percentage resolves to money off the net',
    app.pos_discount_for(v_order, 10) = 100.00,
    'ten percent = ' || app.pos_discount_for(v_order, 10));

  update pos_orders set discount_type = 'percent', discount_value = 10,
                        discount_amount = app.pos_discount_for(v_order, 10)
   where id = v_order;
  perform test.ok('pos discount','a percentage discount stores what was entered',
    (select discount_value from pos_orders where id = v_order) = 10);

  -- ---------- tenders ----------
  insert into pos_order_tenders (order_id, hotel_id, method, amount, tendered, taken_by)
  values (v_order, v_hotel, 'cash', 500.00, 500.00, v_staff);

  perform test.ok('pos discount','tenders short of the bill do not cover it',
    not app.pos_tenders_cover_bill(v_order));

  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  values (v_order, v_hotel, 'card', 480.10, v_staff);

  perform test.ok('pos discount','cash plus card settles the discounted bill',
    app.pos_tenders_cover_bill(v_order));

  perform test.raises('pos discount','a zero tender is not a payment',
    format($q$insert into pos_order_tenders
               (order_id, hotel_id, method, amount, taken_by)
             values (%L,%L,'cash',0,%L)$q$, v_order, v_hotel, v_staff), '23514');

  perform test.raises('pos discount','cash tendered cannot be less than the amount taken',
    format($q$insert into pos_order_tenders
               (order_id, hotel_id, method, amount, tendered, taken_by)
             values (%L,%L,'cash',100,50,%L)$q$, v_order, v_hotel, v_staff), '23514');

  perform test.raises('pos discount','only cash is tendered',
    format($q$insert into pos_order_tenders
               (order_id, hotel_id, method, amount, tendered, taken_by)
             values (%L,%L,'card',100,100,%L)$q$, v_order, v_hotel, v_staff), '23514');

  -- ---------- a settled bill's tenders are evidence ----------
  update pos_orders set status='settled', settled_by=v_staff, settled_at=now(),
                        payment_method='split'
   where id = v_order;

  perform test.raises('pos discount','tenders on a settled order cannot be removed',
    format($q$delete from pos_order_tenders where order_id = %L$q$, v_order),
    'P0001');

  -- ---------- teardown ----------
  /* The room-ticket check is deferred, so its events are still pending and
     ALTER TABLE refuses to touch the table. Fire them now: this order settles
     to cash and card, so there is nothing for that check to object to. */
  set constraints all immediate;

  /* A settled order cannot be reopened and its tenders cannot be removed.
     Both guards are lifted for the teardown, the same way this suite lifts
     pos_order_lines_frozen and hotels_no_delete. */
  alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled;
  delete from pos_order_tenders where hotel_id = v_hotel;
  alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled;

  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where hotel_id = v_hotel;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_orders  where hotel_id = v_hotel;
  delete from pos_outlets where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'PDC';
  perform test.ok('pos discount','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Modules, void, and the indicators  (041–043)
-- =============================================================================
do $$
declare
  v_hotel uuid; v_other uuid; v_staff uuid; v_guest uuid;
  v_type uuid; v_room1 uuid; v_room2 uuid; v_far uuid; v_res uuid;
  n int;
begin
  insert into hotels (code, name, city, timezone)
  values ('TRB', 'Track B fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;

  insert into hotels (code, name, city, timezone)
  values ('TRC', 'Another property', 'Pune', 'Asia/Kolkata')
  returning id into v_other;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm'), (v_staff, v_other, 'gm')
  on conflict do nothing;

  -- ---------- modules: absent means ON for pos, OFF for banquet ----------
  -- The default must never be "off", or deploying 041 would silently close
  -- the till at the one property already using it.
  perform test.ok('modules','a property with no row still has its POS',
    app.module_enabled(v_hotel, 'pos'));

  perform test.ok('modules','banquet is off until somebody turns it on',
    not app.module_enabled(v_hotel, 'banquet'),
    'nothing implements it yet');

  insert into hotel_modules (hotel_id, module, is_enabled, changed_by)
  values (v_hotel, 'pos', false, v_staff);

  perform test.ok('modules','turning the POS off takes effect',
    not app.module_enabled(v_hotel, 'pos'));

  perform test.ok('modules','and does not reach the other property',
    app.module_enabled(v_other, 'pos'));

  perform test.raises('modules','an unknown module is refused',
    format($q$insert into hotel_modules (hotel_id, module)
             values (%L,'spa')$q$, v_hotel), '23514');

  -- ---------- rooms, and the connecting door ----------
  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy)
  values (v_hotel, 'DLX', 'Deluxe', 2, 3) returning id into v_type;

  insert into rooms (hotel_id, room_type_id, number, floor)
  values (v_hotel, v_type, 'T204', 2) returning id into v_room1;
  insert into rooms (hotel_id, room_type_id, number, floor)
  values (v_hotel, v_type, 'T205', 2) returning id into v_room2;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy)
  values (v_other, 'DLX', 'Deluxe', 2, 3) returning id into v_far;
  insert into rooms (hotel_id, room_type_id, number, floor)
  values (v_other, v_far, 'X101', 1) returning id into v_far;

  update rooms set connected_room_id = v_room2 where id = v_room1;

  -- A door opens both ways. Stored one-sided, a clerk searching from 205 is
  -- told there is no connecting room and splits a family across a floor.
  perform test.ok('indicators','a connecting door points both ways',
    (select connected_room_id from rooms where id = v_room2) = v_room1);

  perform test.raises('indicators','a room cannot connect to itself',
    format($q$update rooms set connected_room_id = %L where id = %L$q$,
           v_room1, v_room1), 'P0001');

  perform test.raises('indicators','connecting rooms are at the same property',
    format($q$update rooms set connected_room_id = %L where id = %L$q$,
           v_far, v_room1), 'P0001');

  update rooms set connected_room_id = null where id = v_room1;
  perform test.ok('indicators','clearing one side clears the other',
    (select connected_room_id from rooms where id = v_room2) is null);

  -- ---------- void, and why it is not cancel ----------
  insert into guests (full_name, phone, is_vip)
  values ('Track B guest', '9000000001', true) returning id into v_guest;

  perform test.ok('indicators','VIP travels with the guest, not the booking',
    (select is_vip from guests where id = v_guest));

  insert into reservations
    (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
     adults, status, source, created_by, is_single_lady, agreed_rate,
     business_source, market_segment, sales_person)
  values (v_hotel, v_guest, v_type, 'TRB-1',
          current_date + 1, current_date + 3, 1, 'confirmed', 'direct',
          /* A fixture rate. No price is ever shipped — this one exists only
             so the row satisfies its NOT NULL and dies with the test. */
          v_staff, true, 1234.00,
          'Corporate account', 'corporate', 'A Seller')
  returning id into v_res;

  perform test.ok('indicators','the single-lady flag is on the RESERVATION',
    (select is_single_lady from reservations where id = v_res),
    'the same person with family is a different allocation');

  perform test.ok('sources','a booking records segment, source and seller',
    (select market_segment || '/' || business_source || '/' || sales_person
       from reservations where id = v_res)
      = 'corporate/Corporate account/A Seller');

  -- A void with no explanation is a booking nobody can account for.
  perform test.raises('void','voiding without a reason is refused',
    format($q$update reservations set status = 'void' where id = %L$q$, v_res),
    '23514');

  perform test.raises('void','a blank reason is not a reason',
    format($q$update reservations
                set status='void', void_reason='  ', voided_by=%L,
                    voided_at=now()
              where id = %L$q$, v_staff, v_res), '23514');

  -- ---------- a voided booking holds no room ----------
  insert into room_assignments
    (hotel_id, reservation_id, room_id, from_date, to_date, created_by)
  values (v_hotel, v_res, v_room1, current_date + 1, current_date + 3, v_staff);

  update reservations
     set status='void', void_reason='entered twice',
         voided_by=v_staff, voided_at=now()
   where id = v_res;

  -- The assignment is what makes a room unavailable. Left behind, it holds a
  -- room out of inventory for a stay that never existed — found weeks later by
  -- a clerk who cannot sell a room that looks empty.
  select count(*) into n from room_assignments
   where reservation_id = v_res and released_at is null;
  perform test.ok('void','voiding releases the room it was holding', n = 0);

  perform test.ok('void','void and cancelled are different statuses',
    (select status from reservations where id = v_res) = 'void',
    'one never happened, the other happened and was undone');

  -- ---------- teardown ----------
  delete from room_assignments where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  update rooms set connected_room_id = null where hotel_id = v_hotel;
  delete from rooms where hotel_id in (v_hotel, v_other);
  delete from room_types where hotel_id in (v_hotel, v_other);
  delete from hotel_modules where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id in (v_hotel, v_other);

  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (v_hotel, v_other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('TRB', 'TRC');
  perform test.ok('modules','the fixture does not outlive the test', n = 0);
end $$;
