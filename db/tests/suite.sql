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

  /* A docket number goes with the send. The constraint says a sent line
     has one and a pending line does not — either alone is a line the
     kitchen holds with no ticket, or a ticket for nothing. */
  update pos_order_lines set kot_status='sent', kot_sent_at=now(), kot_no=1
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


-- =============================================================================
-- Restrictions, and the inventory grid  (044)
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; v_room uuid;
  v_guest uuid; v_res uuid; n int; m int; d date;
begin
  d := date '2026-06-10';

  insert into hotels (code, name, city, timezone)
  values ('TRD', 'Track C fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy)
  values (v_hotel, 'STD', 'Standard', 2, 3) returning id into v_type;

  insert into rooms (hotel_id, room_type_id, number, floor)
  values (v_hotel, v_type, 'C101', 1) returning id into v_room;
  insert into rooms (hotel_id, room_type_id, number, floor)
  values (v_hotel, v_type, 'C102', 1);

  -- ---------- the grid, before anything happens ----------
  select sellable into n from app.inventory_grid(v_hotel, d, d);
  perform test.ok('inventory','two rooms, two sellable', n = 2);

  -- ---------- a block's LAST DAY is still blocked ----------
  -- The first version of 044 used `date < to_date` where 022 uses `<=`, and
  -- lost a night off every block. It showed up as 432 sellable room-nights
  -- against a figure that has been 431 since the demo was calibrated.
  insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, created_by)
  values (v_hotel, v_room, d, d, 'out_of_order', v_staff);

  select sellable into n from app.inventory_grid(v_hotel, d, d);
  perform test.ok('inventory','a one-day block covers that day', n = 1,
    'to_date is inclusive, as app.sellable_rooms has always had it');

  select sellable into n from app.inventory_grid(v_hotel, d + 1, d + 1);
  perform test.ok('inventory','and does not cover the next', n = 2);

  delete from room_blocks where hotel_id = v_hotel;

  -- ---------- occupied and sold are different, and both are right ----------
  insert into guests (full_name, phone)
  values ('Track C guest', '9000000003') returning id into v_guest;

  insert into reservations
    (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
     adults, status, source, created_by, agreed_rate, is_complimentary)
  values (v_hotel, v_guest, v_type, 'TRD-1', d, d + 1, 1, 'confirmed',
          'direct', v_staff, 0, true)
  returning id into v_res;

  select occupied, sold into n, m from app.inventory_grid(v_hotel, d, d);
  perform test.ok('inventory','a complimentary room is OCCUPIED', n = 1,
    'it cannot be sold to anybody else');
  perform test.ok('inventory','but it is not SOLD', m = 0,
    'a free room would drag ADR to nothing');

  select available into n from app.inventory_grid(v_hotel, d, d);
  perform test.ok('inventory','availability subtracts the comp, not the sale',
    n = 1);

  -- A voided booking holds nothing at all.
  update reservations
     set status='void', void_reason='never happened',
         voided_by=v_staff, voided_at=now()
   where id = v_res;

  select occupied into n from app.inventory_grid(v_hotel, d, d);
  perform test.ok('inventory','a voided booking holds no room', n = 0);

  -- ---------- restrictions ----------
  insert into rate_restrictions
    (hotel_id, room_type_id, for_date, stop_sell, set_by)
  values (v_hotel, v_type, d, true, v_staff);

  select count(*) into n from rate_restrictions where hotel_id = v_hotel;
  perform test.ok('restrictions','a stop sell is stored', n = 1);

  -- A minimum above the maximum accepts nothing at all, and reads on the grid
  -- as two innocent numbers.
  perform test.raises('restrictions','a minimum above the maximum is refused',
    format($q$update rate_restrictions set min_nights = 5, max_nights = 2
              where hotel_id = %L$q$, v_hotel), '23514');

  perform test.raises('restrictions','zero nights is not a minimum',
    format($q$update rate_restrictions set min_nights = 0
              where hotel_id = %L$q$, v_hotel), '23514');

  -- ---------- a row that says nothing should not exist ----------
  -- Two representations of "unrestricted" is how a grid shows a mark where
  -- there is none, and how a count of restricted dates comes back wrong.
  update rate_restrictions
     set stop_sell = false, closed_arrival = false, closed_departure = false,
         min_nights = null, max_nights = null
   where hotel_id = v_hotel;

  select count(*) into n from rate_restrictions where hotel_id = v_hotel;
  perform test.ok('restrictions','clearing every rule removes the row', n = 0,
    'absent already means unrestricted');

  -- ---------- teardown ----------
  delete from rate_restrictions where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  delete from rooms where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'TRD';
  perform test.ok('inventory','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Variations and add-ons  (045)
-- =============================================================================
-- The dish from the screenshots, built for real: Bhaaji Pau at Oil 300 or
-- Butter 400, with Sides at 25 each, and the rules that stop a bill going
-- wrong quietly.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_outlet uuid; v_cat uuid;
  v_dish uuid; v_plain uuid; v_oil uuid; v_butter uuid;
  v_group uuid; v_onion uuid; v_chutney uuid;
  v_order uuid; v_line bigint; v_addon bigint; n int; g numeric;
begin
  insert into hotels (code, name, city, timezone)
  values ('TRE', 'Variation fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'pos') on conflict do nothing;

  insert into pos_outlets (hotel_id, code, name, staff_id)
  values (v_hotel, 'TREO', 'Variation outlet', v_staff) returning id into v_outlet;

  insert into pos_menu_categories (hotel_id, name)
  values (v_hotel, 'Indian') returning id into v_cat;

  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate, short_code, is_veg)
  values (v_hotel, v_cat, 'Bhaaji Pau', 300.00, 5.00, 'BP', true)
  returning id into v_dish;

  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (v_hotel, v_cat, 'Papad', 90.00, 5.00) returning id into v_plain;

  -- ---------- a short code is typed blind, so it must be unique ----------
  perform test.raises('variations','a short code cannot be shared',
    format($q$insert into pos_menu_items
               (hotel_id, category_id, name, price, tax_rate, short_code)
             values (%L,%L,'Bhaaji Pau Special',350,5,'bp')$q$, v_hotel, v_cat),
    '23505');

  -- ---------- variations ----------
  insert into pos_item_variations (hotel_id, item_id, label, price)
  values (v_hotel, v_dish, 'Oil', 300.00) returning id into v_oil;
  insert into pos_item_variations (hotel_id, item_id, label, price)
  values (v_hotel, v_dish, 'Butter', 400.00) returning id into v_butter;

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (v_hotel, v_outlet, 'TRE-1', current_date, v_staff) returning id into v_order;

  -- THE DANGEROUS CASE, and it is silent. A dish gains variations, and a till
  -- that still rings the ITEM charges pos_menu_items.price — a number nobody
  -- has looked at since. The guest pays a price that is on no menu.
  perform test.raises('variations','a dish sold by variation refuses a line without one',
    format($q$insert into pos_order_lines
               (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
             values (%L,%L,%L,'Bhaaji Pau',1,300,5,%L)$q$,
           v_order, v_hotel, v_dish, v_staff), 'P0001');

  perform test.raises('variations','and refuses one belonging to another dish',
    format($q$insert into pos_order_lines
               (order_id, hotel_id, item_id, variation_id, name, qty,
                unit_price, tax_rate, added_by)
             values (%L,%L,%L,%L,'Papad (Butter)',1,400,5,%L)$q$,
           v_order, v_hotel, v_plain, v_butter, v_staff), 'P0001');

  -- A dish with NO variations is unaffected: most of a menu is like this.
  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, v_hotel, v_plain, 'Papad', 1, 90.00, 5.00, v_staff);
  perform test.ok('variations','a dish with no variations needs none',
    (select count(*) from pos_order_lines where order_id = v_order) = 1);

  insert into pos_order_lines
    (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, v_hotel, v_dish, v_butter, 'Bhaaji Pau (Butter)', 1, 400.00, 5.00, v_staff)
  returning id into v_line;

  -- ---------- add-ons ----------
  insert into pos_addon_groups (hotel_id, label, min_select, max_select)
  values (v_hotel, 'Sides', 0, 4) returning id into v_group;
  insert into pos_addons (hotel_id, group_id, label, price)
  values (v_hotel, v_group, 'Onions', 25.00) returning id into v_onion;
  insert into pos_addons (hotel_id, group_id, label, price)
  values (v_hotel, v_group, 'Coriander Chutney', 25.00) returning id into v_chutney;
  insert into pos_item_addon_groups (item_id, group_id) values (v_dish, v_group);

  insert into pos_order_lines
    (order_id, hotel_id, addon_id, parent_line_id, name, qty, unit_price,
     tax_rate, added_by)
  values (v_order, v_hotel, v_onion, v_line, 'Sides: Onions', 1, 25.00, 5.00, v_staff)
  returning id into v_addon;

  insert into pos_order_lines
    (order_id, hotel_id, addon_id, parent_line_id, name, qty, unit_price,
     tax_rate, added_by)
  values (v_order, v_hotel, v_chutney, v_line, 'Sides: Coriander Chutney', 1,
          25.00, 5.00, v_staff);

  -- An add-on is a LINE, so the totals already count it. That is the whole
  -- reason it is modelled this way rather than as a money column somebody
  -- would have had to teach four other functions about.
  select gross into g from app.pos_order_total(v_order);
  perform test.ok('variations','an add-on is a line, so the total already has it',
    g = round((90 + 400 + 25 + 25) * 1.05, 2),
    'gross ' || g);

  -- ---------- one level, and no deeper ----------
  -- The check constraint says a child is an add-on. It does NOT say the parent
  -- is a dish — both rows being add-ons satisfies it.
  perform test.raises('variations','an add-on cannot hang off another add-on',
    format($q$insert into pos_order_lines
               (order_id, hotel_id, addon_id, parent_line_id, name, qty,
                unit_price, tax_rate, added_by)
             values (%L,%L,%L,%L,'Sides: Onions',1,25,5,%L)$q$,
           v_order, v_hotel, v_onion, v_addon, v_staff), 'P0001');

  -- ---------- striking the dish strikes what was added to it ----------
  -- Otherwise the onions survive the Bhaaji Pau: 25 rupees for a side to a
  -- dish that was struck, appearing on the bill under nothing.
  update pos_order_lines
     set voided = true, voided_by = v_staff, voided_at = now()
   where id = v_line;

  select count(*) into n from pos_order_lines
   where parent_line_id = v_line and not voided;
  perform test.ok('variations','striking a dish strikes its add-ons', n = 0);

  select gross into g from app.pos_order_total(v_order);
  perform test.ok('variations','and the bill falls by the dish AND the sides',
    g = round(90 * 1.05, 2), 'gross ' || g);

  -- ---------- teardown ----------
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where hotel_id = v_hotel;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_orders where hotel_id = v_hotel;
  delete from pos_item_addon_groups where group_id = v_group;
  delete from pos_addons where hotel_id = v_hotel;
  delete from pos_addon_groups where hotel_id = v_hotel;
  delete from pos_item_variations where hotel_id = v_hotel;
  delete from pos_menu_items where hotel_id = v_hotel;
  delete from pos_menu_categories where hotel_id = v_hotel;
  delete from pos_outlets where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'TRE';
  perform test.ok('variations','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- The floor  (047)
-- =============================================================================
-- The five colours are DERIVED. These walk one table through every one of
-- them, because a stored status is the thing that will be wrong on the night
-- a manager is watching the floor and a derived one cannot be.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_outlet uuid; v_cat uuid; v_item uuid;
  v_section uuid; v_t1 uuid; v_t2 uuid;
  v_order uuid; v_line bigint; n int; st text; mins int; pay numeric;
begin
  insert into hotels (code, name, city, timezone)
  values ('TRF', 'Floor fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'pos') on conflict do nothing;

  insert into pos_outlets (hotel_id, code, name, staff_id)
  values (v_hotel, 'TRFO', 'Floor outlet', v_staff) returning id into v_outlet;

  insert into pos_menu_categories (hotel_id, name)
  values (v_hotel, 'Food') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (v_hotel, v_cat, 'Thali', 200.00, 5.00) returning id into v_item;

  insert into pos_sections (hotel_id, outlet_id, name, sort_order)
  values (v_hotel, v_outlet, 'A/C', 1) returning id into v_section;

  insert into pos_tables (hotel_id, section_id, label, seats, row_no, col_no)
  values (v_hotel, v_section, 'AC4', 4, 1, 1) returning id into v_t1;
  insert into pos_tables (hotel_id, section_id, label, seats, row_no, col_no)
  values (v_hotel, v_section, 'AC5', 2, 1, 2) returning id into v_t2;

  -- ---------- blank ----------
  select count(*) into n from app.pos_floor(v_outlet);
  perform test.ok('floor','every table appears, empty or not', n = 2);

  select state into st from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','a table with nothing on it is blank', st = 'blank');

  -- ---------- running ----------
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                          opened_by, table_id, opened_at)
  values (v_hotel, v_outlet, 'TRF-1', current_date, v_staff, v_t1,
          now() - interval '20 minutes')
  returning id into v_order;

  select state, minutes into st, mins
    from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','an order with nothing rung is running', st = 'running');
  -- The tile shows how long the table has been sitting, which is the number a
  -- manager scans the room for.
  perform test.ok('floor','and the tile knows how long it has been sitting',
    mins between 19 and 21, 'minutes ' || mins);

  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, v_hotel, v_item, 'Thali', 2, 200.00, 5.00, v_staff)
  returning id into v_line;

  select state, payable into st, pay
    from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','still running until the kitchen has it', st = 'running');
  perform test.ok('floor','the tile carries the running total',
    pay = 420.00, 'payable ' || pay);

  -- ---------- kot ----------
  update pos_order_lines set kot_status = 'sent', kot_sent_at = now(),
                             kot_no = 1
   where id = v_line;
  select state into st from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','food in the kitchen shows as KOT', st = 'kot');

  -- ---------- printed ----------
  update pos_orders set printed_at = now() where id = v_order;
  select state into st from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','a printed bill outranks the KOT colour', st = 'printed',
    'the guest is paying, which is what the waiter needs to see');

  -- ---------- paid ----------
  update pos_orders
     set status = 'settled', settled_by = v_staff, settled_at = now(),
         payment_method = 'cash'
   where id = v_order;
  select state into st from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','settled but not reset is PAID, not blank', st = 'paid',
    'the table still needs clearing');

  -- ---------- and back to blank ----------
  update pos_orders set cleared_at = now() where id = v_order;
  select state into st from app.pos_floor(v_outlet) where label = 'AC4';
  perform test.ok('floor','clearing the table frees it', st = 'blank');

  perform test.raises('floor','a cleared table cannot be un-cleared',
    format($q$update pos_orders set cleared_at = null where id = %L$q$, v_order),
    'P0001');

  -- ---------- one live order per table ----------
  -- Two open orders on one table is two bills nobody can tell apart, and the
  -- floor would show whichever the database returned first.
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                          opened_by, table_id)
  values (v_hotel, v_outlet, 'TRF-2', current_date, v_staff, v_t2);

  perform test.raises('floor','a table takes one live order, not two',
    format($q$insert into pos_orders
               (hotel_id, outlet_id, order_no, business_date, opened_by, table_id)
             values (%L,%L,'TRF-3',current_date,%L,%L)$q$,
           v_hotel, v_outlet, v_staff, v_t2), '23505');

  -- ---------- sections keep their tables ----------
  select count(*) into n from app.pos_floor(v_outlet) where section = 'A/C';
  perform test.ok('floor','tables come back under their section', n = 2);

  -- ---------- teardown ----------
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where hotel_id = v_hotel;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_orders   where hotel_id = v_hotel;
  delete from pos_tables   where hotel_id = v_hotel;
  delete from pos_sections where hotel_id = v_hotel;
  delete from pos_menu_items where hotel_id = v_hotel;
  delete from pos_menu_categories where hotel_id = v_hotel;
  delete from pos_outlets  where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'TRF';
  perform test.ok('floor','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- The order header  (048)
-- =============================================================================
do $$
declare
  v_hotel uuid; v_other uuid; v_staff uuid; v_stranger uuid;
  v_outlet uuid; v_cat uuid; v_item uuid; v_order uuid;
  n int; per numeric;
begin
  insert into hotels (code, name, city, timezone)
  values ('TRG', 'Cover fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into hotels (code, name, city, timezone)
  values ('TRH', 'Another property', 'Pune', 'Asia/Kolkata')
  returning id into v_other;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'pos') on conflict do nothing;

  -- Somebody who works only at the OTHER property.
  insert into staff (full_name, email, is_active)
  values ('Stranger Waiter', 'stranger@trh.test', true)
  returning id into v_stranger;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_stranger, v_other, 'pos');

  insert into pos_outlets (hotel_id, code, name, staff_id)
  values (v_hotel, 'TRGO', 'Cover outlet', v_staff) returning id into v_outlet;
  insert into pos_menu_categories (hotel_id, name)
  values (v_hotel, 'Food') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (v_hotel, v_cat, 'Thali', 500.00, 5.00) returning id into v_item;

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (v_hotel, v_outlet, 'TRG-1', current_date, v_staff)
  returning id into v_order;

  -- ---------- covers ----------
  perform test.raises('covers','zero covers is not an order',
    format($q$update pos_orders set covers = 0 where id = %L$q$, v_order),
    '23514');

  update pos_orders set covers = 4 where id = v_order;
  perform test.ok('covers','a table of four is recorded',
    (select covers from pos_orders where id = v_order) = 4);

  -- ---------- the waiter works here ----------
  -- Same rule 012 states for housekeeping, for the same reason: per-waiter
  -- figures for somebody who was never in the building still add up.
  perform test.raises('covers','a waiter from another property is refused',
    format($q$update pos_orders set waiter_id = %L where id = %L$q$,
           v_stranger, v_order), 'P0001');

  update pos_orders set waiter_id = v_staff where id = v_order;
  perform test.ok('covers','and one who works here is not',
    (select waiter_id from pos_orders where id = v_order) = v_staff);

  -- ---------- you cannot deliver to nobody ----------
  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_order, v_hotel, v_item, 'Thali', 4, 500.00, 5.00, v_staff);

  update pos_orders set order_type = 'delivery' where id = v_order;
  perform test.ok('covers','switching to delivery is allowed while open',
    (select order_type from pos_orders where id = v_order) = 'delivery',
    'the constraint must not fire the moment somebody taps the tab');

  -- A delivery with no number reaches the kitchen, gets cooked, and cannot
  -- leave the building.
  perform test.raises('covers','a delivery cannot be settled with no phone number',
    format($q$update pos_orders
                set status='settled', settled_by=%L, settled_at=now(),
                    payment_method='cash'
              where id = %L$q$, v_staff, v_order), '23514');

  update pos_orders set customer_phone = '9000000004',
                        customer_name = 'A Guest'
   where id = v_order;
  update pos_orders
     set status='settled', settled_by=v_staff, settled_at=now(),
         payment_method='cash'
   where id = v_order;
  perform test.ok('covers','with a number it settles',
    (select status from pos_orders where id = v_order) = 'settled');

  -- ---------- average per cover ----------
  select per_cover into per
    from app.pos_average_cover(v_hotel, current_date, current_date);
  -- 4 thalis at 500 plus 5% is 2100, over 4 covers.
  perform test.ok('covers','revenue per person, not per table',
    per = 525.00, 'per cover ' || per);

  -- An order with no covers is EXCLUDED, not counted as one. Counting it as
  -- one drags the average down by exactly the amount of the carelessness.
  insert into pos_orders
    (hotel_id, outlet_id, order_no, business_date, opened_by,
     status, settled_by, settled_at, payment_method)
  values (v_hotel, v_outlet, 'TRG-2', current_date, v_staff,
          'settled', v_staff, now(), 'cash');

  select per_cover into per
    from app.pos_average_cover(v_hotel, current_date, current_date);
  perform test.ok('covers','an order with no covers does not drag the average',
    per = 525.00, 'still ' || per);

  select orders into n
    from app.pos_average_cover(v_hotel, current_date, current_date);
  perform test.ok('covers','and is not counted as an order either', n = 1);

  -- ---------- teardown ----------
  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where hotel_id = v_hotel;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_orders where hotel_id = v_hotel;
  delete from pos_menu_items where hotel_id = v_hotel;
  delete from pos_menu_categories where hotel_id = v_hotel;
  delete from pos_outlets where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id in (v_hotel, v_other);
  delete from staff where id = v_stranger;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (v_hotel, v_other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('TRG', 'TRH');
  perform test.ok('covers','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Day end  (050)
-- =============================================================================
-- The arithmetic somebody argues about at the end of a shift, and the two
-- questions a close will not answer for them.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_outlet uuid; v_cat uuid; v_item uuid;
  v_section uuid; v_table uuid;
  v_cash uuid; v_card uuid; v_open uuid; v_day uuid;
  d date; n int; expected numeric; settled numeric; blockers int;
begin
  d := date '2026-07-15';

  insert into hotels (code, name, city, timezone)
  values ('TRJ', 'Day end fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;

  select id into v_staff from staff limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'pos') on conflict do nothing;

  insert into pos_outlets (hotel_id, code, name, staff_id)
  values (v_hotel, 'TRJO', 'Day end outlet', v_staff) returning id into v_outlet;
  insert into pos_menu_categories (hotel_id, name)
  values (v_hotel, 'Food') returning id into v_cat;
  insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
  values (v_hotel, v_cat, 'Thali', 1000.00, 0.00) returning id into v_item;

  insert into pos_sections (hotel_id, outlet_id, name)
  values (v_hotel, v_outlet, 'Main') returning id into v_section;
  insert into pos_tables (hotel_id, section_id, label)
  values (v_hotel, v_section, 'T1') returning id into v_table;

  -- ---------- a cash bill, and a card bill ----------
  /* Opened, rung, THEN settled — the order a till does it in. Created as
     settled first, `pos_order_lines_frozen` refuses the lines, and it is
     right to: a paid bill takes no edits. */
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (v_hotel, v_outlet, 'TRJ-1', d, v_staff) returning id into v_cash;
  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_cash, v_hotel, v_item, 'Thali', 2, 1000.00, 0.00, v_staff);
  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  values (v_cash, v_hotel, 'cash', 2000.00, v_staff);
  update pos_orders set status='settled', settled_by=v_staff,
                        settled_at=now(), payment_method='cash'
   where id = v_cash;

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (v_hotel, v_outlet, 'TRJ-2', d, v_staff) returning id into v_card;
  insert into pos_order_lines
    (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
  values (v_card, v_hotel, v_item, 'Thali', 3, 1000.00, 0.00, v_staff);
  insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
  values (v_card, v_hotel, 'card', 3000.00, v_staff);
  update pos_orders set status='settled', settled_by=v_staff,
                        settled_at=now(), payment_method='card'
   where id = v_card;

  -- ---------- the drawer ----------
  insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash)
  values (v_hotel, v_outlet, d, 2000.00) returning id into v_day;

  -- CASH ONLY. A card settlement never touched the tin, and counting it
  -- would leave the drawer permanently short by the amount of business done
  -- properly.
  expected := app.pos_expected_cash(v_outlet, d);
  perform test.ok('day end','the card sale is not expected in the drawer',
    expected = 4000.00, 'opening 2000 + cash 2000, not + card 3000 = ' || expected);

  insert into pos_cash_movements
    (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by)
  values (v_hotel, v_outlet, d, 'expense', 300.00, 'vegetables', v_staff),
         (v_hotel, v_outlet, d, 'top_up', 500.00, 'change from the safe', v_staff),
         (v_hotel, v_outlet, d, 'withdrawal', 1000.00, 'to the safe', v_staff);

  expected := app.pos_expected_cash(v_outlet, d);
  perform test.ok('day end','money in and out of the tin moves the expectation',
    expected = 3200.00, '4000 + 500 - 300 - 1000 = ' || expected);

  perform test.raises('day end','a movement without a reason is refused',
    format($q$insert into pos_cash_movements
               (hotel_id, outlet_id, business_date, kind, amount, reason,
                recorded_by)
             values (%L,%L,%L,'expense',100,'  ',%L)$q$,
           v_hotel, v_outlet, d, v_staff), '23514');

  perform test.raises('day end','and neither is one of an unknown kind',
    format($q$insert into pos_cash_movements
               (hotel_id, outlet_id, business_date, kind, amount, reason,
                recorded_by)
             values (%L,%L,%L,'borrowed',100,'a friend',%L)$q$,
           v_hotel, v_outlet, d, v_staff), '23514');

  -- ---------- the overview ----------
  select settled_orders, settled_value into n, settled
    from app.pos_day_summary(v_outlet, d);
  perform test.ok('day end','the overview counts what was settled',
    n = 2 and settled = 5000.00, n || ' orders, ' || settled);

  perform test.ok('day end','and how the money arrived',
    (select by_method from app.pos_day_summary(v_outlet, d))
      = '{"cash": 2000.00, "card": 3000.00}'::jsonb,
    (select by_method::text from app.pos_day_summary(v_outlet, d)));

  -- ---------- what stops a close ----------
  select count(*) into blockers from app.pos_day_end_blockers(v_outlet, d);
  perform test.ok('day end','nothing stops a clean day', blockers = 0);

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                          opened_by, table_id)
  values (v_hotel, v_outlet, 'TRJ-3', d, v_staff, v_table)
  returning id into v_open;

  select count(*) into blockers from app.pos_day_end_blockers(v_outlet, d);
  -- The night audit's rule, in a restaurant: only what a PERSON must decide.
  perform test.ok('day end','an open bill stops it', blockers = 1);

  perform test.ok('day end','and the refusal names the bill',
    (select detail from app.pos_day_end_blockers(v_outlet, d)
      where id = 'open_orders') = 'TRJ-3');

  update pos_orders
     set status='settled', settled_by=v_staff, settled_at=now(),
         payment_method='cash'
   where id = v_open;

  select count(*) into blockers from app.pos_day_end_blockers(v_outlet, d);
  perform test.ok('day end','a settled bill on an uncleared table also stops it',
    blockers = 1, 'so tomorrow starts with an empty floor');

  update pos_orders set cleared_at = now() where id = v_open;
  select count(*) into blockers from app.pos_day_end_blockers(v_outlet, d);
  perform test.ok('day end','and clearing it lets the day close', blockers = 0);

  -- ---------- the count ----------
  insert into pos_denominations (day_end_id, value, count)
  values (v_day, 500, 6), (v_day, 100, 2), (v_day, 50, 4);

  perform test.ok('day end','the notes add up to what was counted',
    (select sum(value * count) from pos_denominations where day_end_id = v_day)
      = 3400.00);

  perform test.raises('day end','a negative count is not a count',
    format($q$update pos_denominations set count = -1
              where day_end_id = %L and value = 500$q$, v_day), '23514');

  -- ---------- closing ----------
  perform test.raises('day end','closing without counting is refused',
    format($q$update pos_day_ends
                set closed_at = now(), closed_by = %L where id = %L$q$,
           v_staff, v_day), '23514');

  update pos_day_ends
     set counted_cash = 3400.00,
         variance_reason = 'two hundred over, not found',
         closed_by = v_staff, closed_at = now()
   where id = v_day;

  -- A count that does not match is RECORDED, not refused. The money is
  -- already whatever it is, and a shift that cannot close is worse.
  perform test.ok('day end','a difference closes with a reason, not a refusal',
    (select closed_at is not null from pos_day_ends where id = v_day));

  perform test.raises('day end','a closed day stays closed',
    format($q$update pos_day_ends set counted_cash = 9999 where id = %L$q$,
           v_day), 'P0001');

  -- ---------- teardown ----------
  delete from pos_denominations where day_end_id = v_day;
  delete from pos_day_ends where hotel_id = v_hotel;
  delete from pos_cash_movements where hotel_id = v_hotel;

  /* The room-ticket check is deferred, so its events are still pending
     and ALTER TABLE refuses to touch the table. Fire them now: every bill
     here settled to cash or card, so there is nothing for it to object to. */
  set constraints all immediate;

  /* Tenders on a settled bill are evidence, and 038 refuses to remove
     them. Lifted for the teardown rather than weakened, the same way this
     suite lifts pos_order_lines_frozen. */
  alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled;
  delete from pos_order_tenders where hotel_id = v_hotel;
  alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled;

  alter table pos_order_lines disable trigger pos_order_lines_frozen;
  delete from pos_order_lines where hotel_id = v_hotel;
  alter table pos_order_lines enable trigger pos_order_lines_frozen;

  delete from pos_orders where hotel_id = v_hotel;
  delete from pos_tables where hotel_id = v_hotel;
  delete from pos_sections where hotel_id = v_hotel;
  delete from pos_menu_items where hotel_id = v_hotel;
  delete from pos_menu_categories where hotel_id = v_hotel;
  delete from pos_outlets where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'TRJ';
  perform test.ok('day end','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Rate grid  (052)
-- =============================================================================
-- Two bugs the API's own copy of the rule had, and the reason there is now one
-- copy instead of four.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; n int; p numeric; s text;
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('RGT', 'Rate grid fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  -- No base_rate: this type has been created and never priced, which is the
  -- state every property starts in because no price ever ships.
  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1)
  returning id into v_type;

  -- ---------- an unpriced property still has a grid ----------
  select count(*) into n
    from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-05');
  -- 1 type × 5 meal plans × 5 days. Five, not the four seeded by 011: 020
  -- added Room Only afterwards, which is exactly why this is counted from
  -- meal_plans rather than written as a number.
  perform test.ok('rate grid','an unpriced property still has every cell',
    n = 5 * (select count(*) from meal_plans),
    '1 type x ' || (select count(*) from meal_plans) || ' plans x 5 days, got ' || n);

  select price into p from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-01')
   where meal_plan = 'EP';
  perform test.ok('rate grid','and an unpriced cell is NULL, not zero',
    p is null, 'an unpriced room is not a free room');

  -- ---------- the rack rate, which has no end ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, valid_to, label, created_by)
  values (v_hotel, v_type, 'EP', 2500, date '2026-08-01', null, 'Rack', v_staff);

  select count(*) into n
    from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-20')
   where meal_plan = 'EP' and price = 2500;
  -- The API's own version filtered on `valid_to >= from`, which against NULL
  -- is NULL — so the commonest rate a hotel has produced NO cells at all, and
  -- the screen read as "nothing has been priced".
  perform test.ok('rate grid','an open-ended rack rate covers every day',
    n = 20, 'valid_to is null must not filter the row out; got ' || n);
  -- 20 here is 20 DAYS on one plan, not a plan count — unaffected by 020.

  -- ---------- a season is half-open ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, valid_to, label, created_by)
  values (v_hotel, v_type, 'CP', 3200, date '2026-08-01', date '2026-08-15',
          'Season', v_staff);

  select count(*) into n
    from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-20')
   where meal_plan = 'CP' and season = 'Season';
  -- 1st to 15th covers the 1st through the 14th, like every other range in
  -- this schema. Including valid_to made two contiguous seasons both claim the
  -- boundary, and the grid showed the outgoing price on the incoming day.
  perform test.ok('rate grid','a season from the 1st to the 15th covers 14 days',
    n = 14, 'half-open, like room_blocks and reservations; got ' || n);

  select season into s from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'CP';
  perform test.ok('rate grid','and the 15th belongs to whatever comes next',
    s is null, 'got season = ' || coalesce(s, 'null'));

  -- ---------- two seasons meeting ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, valid_to, label, created_by)
  values (v_hotel, v_type, 'CP', 4100, date '2026-08-15', date '2026-08-25',
          'Peak', v_staff);

  select count(*) into n
    from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-20')
   where meal_plan = 'CP';
  perform test.ok('rate grid','contiguous seasons produce one cell per day',
    n = 20, 'not 21 with the boundary counted twice; got ' || n);

  select price into p from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'CP';
  perform test.ok('rate grid','and the boundary day takes the NEW price',
    p = 4100, 'got ' || coalesce(p::text, 'null'));

  select price into p from app.rate_grid(v_hotel, date '2026-08-14', date '2026-08-14')
   where meal_plan = 'CP';
  perform test.ok('rate grid','while the day before takes the old one',
    p = 3200, 'got ' || coalesce(p::text, 'null'));

  -- ---------- a plan nobody priced stays empty ----------
  select price into p from app.rate_grid(v_hotel, date '2026-08-01', date '2026-08-01')
   where meal_plan = 'AP';
  perform test.ok('rate grid','a meal plan with no rate is still a dash',
    p is null, 'AP was never priced and must not inherit EP');

  -- ---------- teardown ----------
  delete from rates where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'RGT';
  perform test.ok('rate grid','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Setting a price  (053)
-- =============================================================================
-- The rack-rate split is the case that loses a property its pricing, so it is
-- asserted from both ends rather than by counting rows.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; p numeric; n int;
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('SRT', 'Set rate fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1)
  returning id into v_type;

  -- ---------- the first price on an empty property ----------
  perform app.set_rate(v_hotel, v_type, 'EP', date '2026-08-01', null,
                       2500, 'Rack', v_staff);
  select price into p from app.rate_grid(v_hotel, date '2026-12-25', date '2026-12-25')
   where meal_plan = 'EP';
  perform test.ok('set rate','an open-ended rate reaches December',
    p = 2500, 'got ' || coalesce(p::text, 'null'));

  -- ---------- a weekend inside it: THE SPLIT ----------
  perform app.set_rate(v_hotel, v_type, 'EP', date '2026-08-14',
                       date '2026-08-17', 4200, 'Wedding', v_staff);

  select price into p from app.rate_grid(v_hotel, date '2026-08-14', date '2026-08-14')
   where meal_plan = 'EP';
  perform test.ok('set rate','the weekend takes the new price',
    p = 4200, 'got ' || coalesce(p::text, 'null'));

  select price into p from app.rate_grid(v_hotel, date '2026-08-16', date '2026-08-16')
   where meal_plan = 'EP';
  perform test.ok('set rate','through its last covered day',
    p = 4200, '14th to 17th covers the 16th; got ' || coalesce(p::text, 'null'));

  select price into p from app.rate_grid(v_hotel, date '2026-08-13', date '2026-08-13')
   where meal_plan = 'EP';
  perform test.ok('set rate','the day before is still the rack rate',
    p = 2500, 'got ' || coalesce(p::text, 'null'));

  -- The half that gets forgotten. Trimming the rack rate and never
  -- re-creating its tail leaves the property with NO price from the 17th on,
  -- and nothing on the screen says so — the cells just go quiet.
  select price into p from app.rate_grid(v_hotel, date '2026-08-17', date '2026-08-17')
   where meal_plan = 'EP';
  perform test.ok('set rate','and the rack rate RESUMES after it',
    p = 2500, 'the tail of a split range must survive; got '
              || coalesce(p::text, 'null'));

  select price into p from app.rate_grid(v_hotel, date '2027-06-01', date '2027-06-01')
   where meal_plan = 'EP';
  perform test.ok('set rate','still open ended, a year later',
    p = 2500, 'got ' || coalesce(p::text, 'null'));

  -- ---------- overwriting a range whole ----------
  perform app.set_rate(v_hotel, v_type, 'EP', date '2026-08-14',
                       date '2026-08-17', 4800, 'Wedding', v_staff);
  select count(*) into n from rates
   where hotel_id = v_hotel and meal_plan = 'EP' and price = 4200;
  perform test.ok('set rate','re-pricing the same range replaces it',
    n = 0, 'the old row must not survive beside the new one');

  select price into p from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'EP';
  perform test.ok('set rate','and the new price is what shows',
    p = 4800, 'got ' || coalesce(p::text, 'null'));

  -- ---------- clearing ----------
  perform app.set_rate(v_hotel, v_type, 'EP', date '2026-08-14',
                       date '2026-08-17', null, null, v_staff);
  select price into p from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'EP';
  -- Cleared, so what shows is whatever covers it otherwise. Here that is
  -- nothing: the rack rate was split around this range and never re-joined.
  perform test.ok('set rate','clearing a range writes no price at all',
    p is null, 'a cleared cell is a dash, never a zero; got '
               || coalesce(p::text, 'null'));

  select count(*) into n from rates
   where hotel_id = v_hotel and meal_plan = 'EP' and price = 0;
  perform test.ok('set rate','and never a zero row',
    n = 0, 'an unpriced room is not a free room');

  -- ---------- refusals ----------
  perform test.raises('set rate','a range that ends before it starts is refused',
    format($q$select app.set_rate(%L,%L,'CP',date '2026-09-10',
                                  date '2026-09-01',1000,null,%L)$q$,
           v_hotel, v_type, v_staff), 'P0001');

  perform test.raises('set rate','and so is a negative price',
    format($q$select app.set_rate(%L,%L,'CP',date '2026-09-01',
                                  date '2026-09-10',-1,null,%L)$q$,
           v_hotel, v_type, v_staff), 'P0001');

  -- ---------- one plan does not touch another ----------
  perform app.set_rate(v_hotel, v_type, 'CP', date '2026-08-01', null,
                       3100, 'Rack CP', v_staff);
  select price into p from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'CP';
  perform test.ok('set rate','pricing CP leaves EP alone', p = 3100);
  select price into p from app.rate_grid(v_hotel, date '2026-08-15', date '2026-08-15')
   where meal_plan = 'EP';
  perform test.ok('set rate','and EP stays cleared', p is null);

  -- ---------- teardown ----------
  delete from rates where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'SRT';
  perform test.ok('set rate','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Room move  (054)
-- =============================================================================
-- The split has to free the old room from the move date and not one night
-- earlier or later, because both mistakes are invisible until somebody cannot
-- book a room that is empty — or walks into one that is not.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid;
  v_203 uuid; v_305 uuid; v_401 uuid;
  v_guest uuid; v_res uuid; v_other uuid;
  n int; before_n int; after_n int; v_left text; d date;
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('MVT', 'Move fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1) returning id into v_type;

  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '203', 2, true) returning id into v_203;
  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '305', 3, true) returning id into v_305;
  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '401', 4, true) returning id into v_401;

  -- Guests are GROUP level, not hotel scoped: a returning guest does not
  -- re-present their passport at another property.
  insert into guests (full_name) values ('Mover fixture')
  returning id into v_guest;

  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status)
  values (v_hotel, v_guest, v_type, 'MVT-1',
          date '2026-08-01', date '2026-08-06', 3000, 'checked_in')
  returning id into v_res;

  insert into room_assignments (hotel_id, reservation_id, room_id,
                                from_date, to_date, reason)
  values (v_hotel, v_res, v_203, date '2026-08-01', date '2026-08-06', 'arrival');

  -- ---------- the move ----------
  select m.left_room, m.nights_before, m.nights_after
    into v_left, before_n, after_n
    from app.move_room(v_hotel, v_res, v_305, date '2026-08-03', 'move', v_staff) m;

  perform test.ok('room move','it says which room was left', v_left = '203');
  perform test.ok('room move','two nights stay with the old room',
    before_n = 2, '1st and 2nd; got ' || before_n);
  perform test.ok('room move','three nights go to the new one',
    after_n = 3, '3rd, 4th and 5th; got ' || after_n);

  select count(*) into n from room_assignments
   where reservation_id = v_res and released_at is null;
  perform test.ok('room move','the stay has two live assignments', n = 2);

  select to_date into d from room_assignments
   where reservation_id = v_res and room_id = v_203 and released_at is null;
  perform test.ok('room move','the old room is given up ON the move date',
    d = date '2026-08-03', 'got ' || d);

  -- ---------- the freed room is genuinely free ----------
  -- The half-open range means somebody may check into 203 on the 3rd. Off by
  -- one in either direction and either a room sits empty and unbookable, or
  -- two guests are sent to the same door.
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status)
  values (v_hotel, v_guest, v_type, 'MVT-2',
          date '2026-08-03', date '2026-08-05', 3000, 'confirmed')
  returning id into v_other;

  insert into room_assignments (hotel_id, reservation_id, room_id,
                                from_date, to_date, reason)
  values (v_hotel, v_other, v_203, date '2026-08-03', date '2026-08-05', 'arrival');
  perform test.ok('room move','and can be sold from that date',
    true, 'the exclusion constraint accepted it');

  -- And NOT from the night before, because the mover is still in it then.
  -- This needs its own booking that legitimately covers the 2nd: an
  -- assignment outside its reservation's dates is refused by a different
  -- guard first, which is what the earlier version of this assertion
  -- accidentally proved.
  declare v_early uuid;
  begin
    insert into reservations (hotel_id, guest_id, room_type_id, reference,
                              check_in, check_out, agreed_rate, status)
    values (v_hotel, v_guest, v_type, 'MVT-EARLY',
            date '2026-08-02', date '2026-08-04', 3000, 'confirmed')
    returning id into v_early;

    perform test.raises('room move','but not from the night before',
      format($q$insert into room_assignments (hotel_id, reservation_id, room_id,
                                              from_date, to_date, reason)
                values (%L,%L,%L,date '2026-08-02',date '2026-08-04','arrival')$q$,
             v_hotel, v_early, v_203), '23P01');
  end;

  -- ---------- money is untouched ----------
  perform test.ok('room move','the agreed rate is not touched',
    (select agreed_rate from reservations where id = v_res) = 3000,
    'the audit posts agreed_rate, and a move is not a repricing');

  -- ---------- refusals ----------
  perform test.raises('room move','moving into the same room is refused',
    format($q$select app.move_room(%L,%L,%L,date '2026-08-04','move',%L)$q$,
           v_hotel, v_res, v_305, v_staff), 'P0001');

  perform test.raises('room move','and a date outside the stay',
    format($q$select app.move_room(%L,%L,%L,date '2026-08-20','move',%L)$q$,
           v_hotel, v_res, v_401, v_staff), 'P0001');

  -- ---------- moving on the first night ----------
  -- Nobody slept in the room, so it is released whole rather than left as a
  -- zero-length row that ra_dates_ordered would refuse anyway.
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status)
  values (v_hotel, v_guest, v_type, 'MVT-3',
          date '2026-09-01', date '2026-09-04', 3000, 'confirmed')
  returning id into v_other;
  insert into room_assignments (hotel_id, reservation_id, room_id,
                                from_date, to_date, reason)
  values (v_hotel, v_other, v_203, date '2026-09-01', date '2026-09-04', 'arrival');

  select m.nights_before into before_n
    from app.move_room(v_hotel, v_other, v_401, date '2026-09-01', 'fault', v_staff) m;
  perform test.ok('room move','moving on the first night keeps no nights',
    before_n = 0, 'got ' || before_n);

  select count(*) into n from room_assignments
   where reservation_id = v_other and released_at is null;
  perform test.ok('room move','and leaves one live assignment, not two', n = 1);

  -- ---------- unassign ----------
  select app.unassign_room(v_hotel, v_other) into v_left;
  perform test.ok('room move','unassign says which room', v_left = '401');

  select count(*) into n from room_assignments
   where reservation_id = v_other and released_at is null;
  perform test.ok('room move','and leaves nothing live', n = 0);

  select count(*) into n from room_assignments where reservation_id = v_other;
  -- Releasing is not deleting: "who was in 401 last Tuesday" keeps an answer.
  perform test.ok('room move','while the history stays', n = 2);

  perform test.raises('room move','unassigning twice is refused',
    format($q$select app.unassign_room(%L,%L)$q$, v_hotel, v_other), 'P0001');

  -- ---------- teardown ----------
  delete from room_assignments where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  /* 015 forbids deleting a guest — stay history depends on the row. A fixture
     is the one exception, and it says so rather than leaving a stranger in
     the guest list. */
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;
  delete from rooms where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'MVT';
  perform test.ok('room move','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Amending a stay  (055)
-- =============================================================================
-- The room hold moving WITH the booking is the assertion that matters. A
-- booking that says six nights while the room is held for four is invisible on
-- every screen until the sixth night's guest opens an occupied door.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; v_small uuid;
  v_101 uuid; v_102 uuid; v_guest uuid; v_res uuid; v_other uuid; v_folio uuid;
  n int; before_n int; after_n int; v_room text; d date;
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('AMD', 'Amend fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1) returning id into v_type;
  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'SGL', 'Single', 1, 1, null, 2) returning id into v_small;

  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '101', 1, true) returning id into v_101;
  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '102', 1, true) returning id into v_102;

  insert into guests (full_name) values ('Amend fixture guest')
  returning id into v_guest;

  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, adults, children,
                            agreed_rate, status)
  values (v_hotel, v_guest, v_type, 'AMD-1',
          date '2026-08-10', date '2026-08-14', 2, 0, 3000, 'confirmed')
  returning id into v_res;

  insert into room_assignments (hotel_id, reservation_id, room_id,
                                from_date, to_date, reason)
  values (v_hotel, v_res, v_101, date '2026-08-10', date '2026-08-14', 'arrival');

  -- ---------- extending ----------
  select m.nights_before, m.nights_after, m.room_held
    into before_n, after_n, v_room
    from app.amend_stay(v_hotel, v_res, date '2026-08-10', date '2026-08-16',
                        2::smallint, 0::smallint, v_staff) m;

  perform test.ok('amend stay','four nights become six',
    before_n = 4 and after_n = 6, before_n || ' -> ' || after_n);
  perform test.ok('amend stay','and it says which room was held', v_room = '101');

  select to_date into d from room_assignments
   where reservation_id = v_res and released_at is null;
  -- THE ONE THAT MATTERS. A booking saying six nights while the room is held
  -- for four is invisible until somebody opens an occupied door.
  perform test.ok('amend stay','the room hold moves with the booking',
    d = date '2026-08-16', 'got ' || d);

  -- ---------- the room being taken refuses the extension ----------
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status)
  values (v_hotel, v_guest, v_type, 'AMD-2',
          date '2026-08-20', date '2026-08-24', 3000, 'confirmed')
  returning id into v_other;
  insert into room_assignments (hotel_id, reservation_id, room_id,
                                from_date, to_date, reason)
  values (v_hotel, v_other, v_101, date '2026-08-20', date '2026-08-24', 'arrival');

  perform test.raises('amend stay','extending into a taken room is refused',
    format($q$select app.amend_stay(%L,%L,date '2026-08-10',date '2026-08-22',
                                    2::smallint,0::smallint,%L)$q$,
           v_hotel, v_res, v_staff), '23P01');

  -- And the booking is unchanged, because the whole thing rolled back.
  select check_out into d from reservations where id = v_res;
  perform test.ok('amend stay','and the booking is left alone when it is',
    d = date '2026-08-16', 'got ' || d);

  -- ---------- shortening below a charged night ----------
  insert into folios (hotel_id, reservation_id) values (v_hotel, v_res)
  returning id into v_folio;
  insert into folio_postings (hotel_id, folio_id, business_date, category,
                              description, amount, tax_rate, tax_amount,
                              source_type, posted_by)
  values (v_hotel, v_folio, date '2026-08-12', 'room', 'Room charge',
          3000, 12, 360, 'night_audit', v_staff);

  perform test.raises('amend stay','leaving before a charged night is refused',
    format($q$select app.amend_stay(%L,%L,date '2026-08-10',date '2026-08-12',
                                    2::smallint,0::smallint,%L)$q$,
           v_hotel, v_res, v_staff), 'P0001');

  -- Departing on the 13th still covers the night of the 12th, so it is fine.
  select m.nights_after into after_n
    from app.amend_stay(v_hotel, v_res, date '2026-08-10', date '2026-08-13',
                        2::smallint, 0::smallint, v_staff) m;
  perform test.ok('amend stay','but leaving the morning after it is fine',
    after_n = 3, 'a charge dated the 12th pays for the night of the 12th');

  -- ---------- a reversed charge stops blocking ----------
  insert into folio_postings (hotel_id, folio_id, business_date, category,
                              description, amount, tax_rate, tax_amount,
                              source_type, posted_by, reverses_id)
  select v_hotel, v_folio, date '2026-08-12', 'room', 'Reversal',
         -3000, 12, -360, 'night_audit', v_staff, fp.id
    from folio_postings fp
   where fp.folio_id = v_folio and fp.reverses_id is null;

  select m.nights_after into after_n
    from app.amend_stay(v_hotel, v_res, date '2026-08-10', date '2026-08-12',
                        2::smallint, 0::smallint, v_staff) m;
  -- There is no `reversed` flag; a reversal is its own row. Reading the
  -- original as still live would keep refusing a perfectly good amendment.
  perform test.ok('amend stay','a reversed charge no longer blocks it',
    after_n = 2, 'got ' || after_n);

  -- ---------- arrival is a fact once it has happened ----------
  update reservations set status = 'checked_in' where id = v_res;
  perform test.raises('amend stay','a checked-in arrival cannot move',
    format($q$select app.amend_stay(%L,%L,date '2026-08-11',date '2026-08-14',
                                    2::smallint,0::smallint,%L)$q$,
           v_hotel, v_res, v_staff), 'P0001');

  -- ---------- occupancy ----------
  perform test.raises('amend stay','more people than the room sleeps is refused',
    format($q$select app.amend_stay(%L,%L,date '2026-08-10',date '2026-08-14',
                                    3::smallint,2::smallint,%L)$q$,
           v_hotel, v_res, v_staff), 'P0001');

  perform test.raises('amend stay','and a stay with no adults',
    format($q$select app.amend_stay(%L,%L,date '2026-08-10',date '2026-08-14',
                                    0::smallint,1::smallint,%L)$q$,
           v_hotel, v_res, v_staff), 'P0001');

  perform test.raises('amend stay','and a departure before the arrival',
    format($q$select app.amend_stay(%L,%L,date '2026-08-14',date '2026-08-10',
                                    2::smallint,0::smallint,%L)$q$,
           v_hotel, v_res, v_staff), 'P0001');

  -- ---------- a booking that is over ----------
  update reservations set status = 'checked_out' where id = v_other;
  perform test.raises('amend stay','a departed booking is history',
    format($q$select app.amend_stay(%L,%L,date '2026-08-20',date '2026-08-26',
                                    2::smallint,0::smallint,%L)$q$,
           v_hotel, v_other, v_staff), 'P0001');

  -- ---------- teardown ----------
  /* The ledger is append-only and says so with a trigger. A fixture is the
     one exception, and it names the exception rather than working around it. */
  alter table folio_postings disable trigger folio_postings_append_only;
  delete from folio_postings where hotel_id = v_hotel;
  alter table folio_postings enable trigger folio_postings_append_only;
  delete from folios where hotel_id = v_hotel;
  delete from room_assignments where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;
  delete from rooms where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'AMD';
  perform test.ok('amend stay','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Group billing  (056)
-- =============================================================================
-- The assertion that matters is the one about the night audit's idempotency
-- check. Per FOLIO it is correct while every stay has its own; point three
-- rooms at one master and it charges the first and skips the rest, every
-- night, while the run's summary reports what it posted and looks fine.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; v_guest uuid;
  v_group uuid; v_master uuid;
  v_a uuid; v_b uuid; v_c uuid; v_fa uuid; v_fb uuid; v_fc uuid;
  n int; bal numeric; f uuid; d date;
begin
  select id into v_staff from staff limit 1;
  d := date '2026-08-10';

  insert into hotels (code, name, city, timezone)
  values ('GRP', 'Group fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1) returning id into v_type;

  insert into guests (full_name) values ('Group fixture guest')
  returning id into v_guest;

  insert into reservation_groups (name, lead_hotel_id)
  values ('Sharma Wedding fixture', v_hotel) returning id into v_group;

  -- three rooms in the group
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status, group_id,
                            route_room_to_group)
  values (v_hotel, v_guest, v_type, 'GRP-A', d, d + 3, 3000, 'checked_in',
          v_group, true) returning id into v_a;
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status, group_id,
                            route_room_to_group)
  values (v_hotel, v_guest, v_type, 'GRP-B', d, d + 3, 3000, 'checked_in',
          v_group, true) returning id into v_b;
  -- the couple's own room, settled by them
  insert into reservations (hotel_id, guest_id, room_type_id, reference,
                            check_in, check_out, agreed_rate, status, group_id,
                            route_room_to_group)
  values (v_hotel, v_guest, v_type, 'GRP-C', d, d + 3, 3000, 'checked_in',
          v_group, false) returning id into v_c;

  insert into folios (hotel_id, reservation_id) values (v_hotel, v_a) returning id into v_fa;
  insert into folios (hotel_id, reservation_id) values (v_hotel, v_b) returning id into v_fb;
  insert into folios (hotel_id, reservation_id) values (v_hotel, v_c) returning id into v_fc;
  insert into folios (hotel_id, group_id) values (v_hotel, v_group) returning id into v_master;

  -- ---------- a folio belongs to exactly one thing ----------
  perform test.raises('group billing','a folio attached to neither is refused',
    format($q$insert into folios (hotel_id) values (%L)$q$, v_hotel), '23514');

  perform test.raises('group billing','and one attached to both',
    format($q$insert into folios (hotel_id, reservation_id, group_id)
              values (%L,%L,%L)$q$, v_hotel, v_a, v_group), '23514');

  perform test.raises('group billing','a group has one open master, not two',
    format($q$insert into folios (hotel_id, group_id) values (%L,%L)$q$,
           v_hotel, v_group), '23505');

  -- ---------- where a room charge goes ----------
  perform test.ok('group billing','a routed stay charges the master',
    app.folio_for_room_charge(v_a) = v_master);
  perform test.ok('group billing','an unrouted one charges its own folio',
    app.folio_for_room_charge(v_c) = v_fc);

  update reservations set group_id = null, route_room_to_group = false where id = v_b;
  perform test.ok('group billing','and a stay in no group charges its own',
    app.folio_for_room_charge(v_b) = v_fb);
  update reservations set group_id = v_group, route_room_to_group = true where id = v_b;

  -- A charge must always land somewhere. Closing the master must not make
  -- the charge vanish — silently posting nothing is worse than posting to
  -- the wrong account, because nobody ever sees it.
  update folios set status = 'closed' where id = v_master;
  perform test.ok('group billing','a closed master falls back, never to null',
    app.folio_for_room_charge(v_a) = v_fa);
  update folios set status = 'open' where id = v_master;

  -- ---------- THE TRAP ----------
  -- Two routed rooms, one master, one night. The old check asked whether the
  -- FOLIO held a room charge tonight, so the second room was skipped.
  insert into folio_postings (hotel_id, folio_id, reservation_id, business_date,
                              category, description, amount, tax_rate,
                              tax_amount, source_type, posted_by)
  values (v_hotel, v_master, v_a, d, 'room', 'Room 101 · 1 night',
          3000, 12, 360, 'night_audit', v_staff);

  select count(*) into n
    from folio_postings fp
   where fp.folio_id = v_master and fp.category = 'room' and fp.business_date = d;
  perform test.ok('group billing','the master holds room A''s charge', n = 1);

  -- Per FOLIO this says "already charged" and skips room B for ever.
  select count(*) into n
    from folio_postings fp
   where fp.reservation_id = v_b and fp.category = 'room' and fp.business_date = d;
  perform test.ok('group billing','but room B has NOT been charged tonight',
    n = 0, 'per stay, not per folio — otherwise eleven of twelve rooms are free');

  insert into folio_postings (hotel_id, folio_id, reservation_id, business_date,
                              category, description, amount, tax_rate,
                              tax_amount, source_type, posted_by)
  values (v_hotel, v_master, v_b, d, 'room', 'Room 102 · 1 night',
          3000, 12, 360, 'night_audit', v_staff);

  select sum(amount + tax_amount) into bal
    from folio_postings where folio_id = v_master;
  perform test.ok('group billing','so the master carries both rooms',
    bal = 6720.00, 'two rooms at 3000 + 12%; got ' || bal);

  -- ---------- extras stay with the guest ----------
  -- A bar tab follows whoever signed for it. Routing is room charges only.
  insert into folio_postings (hotel_id, folio_id, reservation_id, business_date,
                              category, description, amount, tax_rate,
                              tax_amount, source_type, posted_by)
  values (v_hotel, v_fa, v_a, d, 'beverage', 'Bar', 800, 18, 144, 'pos', v_staff);

  select sum(amount + tax_amount) into bal
    from folio_postings where folio_id = v_master;
  perform test.ok('group billing','and the master is untouched by a bar tab',
    bal = 6720.00, 'got ' || bal);

  -- ---------- the panel ----------
  select count(*) into n from app.group_rooms(v_hotel, v_group);
  perform test.ok('group billing','the panel lists every room in the group', n = 3);

  select balance into bal from app.group_rooms(v_hotel, v_group)
   where reference = 'GRP-A';
  -- The stay's OWN balance: the bar tab only. Its room charge is the host's.
  perform test.ok('group billing','a routed room owes only its extras',
    bal = 944.00, 'the room charge is on the master; got ' || bal);

  select count(*) into n from app.group_rooms(v_hotel, v_group) where routed;
  perform test.ok('group billing','and the panel says which rooms are routed',
    n = 2);

  update reservations set status = 'void', void_reason = 'fixture',
         voided_by = v_staff, voided_at = now() where id = v_c;
  select count(*) into n from app.group_rooms(v_hotel, v_group);
  perform test.ok('group billing','a void booking is not one of the rooms',
    n = 2, 'it never happened');

  -- ---------- teardown ----------
  alter table folio_postings disable trigger folio_postings_append_only;
  delete from folio_postings where hotel_id = v_hotel;
  alter table folio_postings enable trigger folio_postings_append_only;
  delete from folios where hotel_id = v_hotel;
  delete from room_assignments where hotel_id = v_hotel;
  delete from reservations where hotel_id = v_hotel;
  delete from reservation_groups where id = v_group;
  alter table guests disable trigger guests_no_delete;
  delete from guests where id = v_guest;
  alter table guests enable trigger guests_no_delete;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'GRP';
  perform test.ok('group billing','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Extra persons  (057)
-- =============================================================================
-- Who counts as extra, and what happens when nobody has priced them. The
-- second is the one that matters: a total that silently omits the third
-- person is discovered at check-out, by a guest.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_staff uuid; v_type uuid; n int;
  t record; d date := date '2026-08-10';
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('EXP', 'Extra person fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  -- Sleeps two, takes four. Nothing priced at all, as every property starts.
  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 4, null, 1) returning id into v_type;

  -- ---------- who is extra ----------
  select * into t from app.tariff_for(v_type, 'EP', d, 3, 0);
  perform test.ok('extra persons','a third adult is one extra adult',
    t.extra_adults = 1 and t.extra_children = 0);

  select * into t from app.tariff_for(v_type, 'EP', d, 2, 1);
  perform test.ok('extra persons','a child beside two adults is one extra child',
    t.extra_adults = 0 and t.extra_children = 1);

  select * into t from app.tariff_for(v_type, 'EP', d, 1, 1);
  -- A child takes a free base slot. Charging a couple's toddler while an
  -- identical room with two adults pays nothing is arithmetic a guest notices.
  perform test.ok('extra persons','one adult and one child are nobody extra',
    t.extra_adults = 0 and t.extra_children = 0);

  select * into t from app.tariff_for(v_type, 'EP', d, 1, 2);
  perform test.ok('extra persons','one adult and two children is one extra child',
    t.extra_adults = 0 and t.extra_children = 1);

  select * into t from app.tariff_for(v_type, 'EP', d, 2, 0);
  perform test.ok('extra persons','and a couple is nobody extra',
    t.extra_adults = 0 and t.extra_children = 0);

  -- ---------- unpriced is not free ----------
  perform test.ok('extra persons','an unpriced room has no total',
    t.total is null and t.unpriced = 'the room');

  update room_types set base_rate = 3000 where id = v_type;
  select * into t from app.tariff_for(v_type, 'EP', d, 2, 0);
  perform test.ok('extra persons','pricing the room prices a couple',
    t.total = 3000);

  select * into t from app.tariff_for(v_type, 'EP', d, 3, 0);
  -- THE ONE THAT MATTERS. Adding zero here quotes 3000 for three people, and
  -- nobody finds out until check-out.
  perform test.ok('extra persons','but a third adult with no rate has NO total',
    t.total is null, 'an unpriced extra person is not a free one');
  perform test.ok('extra persons','and the screen is told which',
    t.unpriced = 'the extra adult', 'got ' || coalesce(t.unpriced, 'null'));

  update room_types set extra_adult_rate = 800 where id = v_type;
  select * into t from app.tariff_for(v_type, 'EP', d, 3, 0);
  perform test.ok('extra persons','the room type''s own rate is the fallback',
    t.total = 3800 and t.unpriced is null, 'got ' || coalesce(t.total::text,'null'));

  -- ---------- the season wins ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price, valid_from,
                     valid_to, label, extra_adult, created_by)
  values (v_hotel, v_type, 'EP', 5000, d, d + 5, 'Diwali', 1500, v_staff);

  select * into t from app.tariff_for(v_type, 'EP', d, 3, 0);
  -- An extra bed costs more in Diwali week, which is why the price lives
  -- beside the season's and not on a settings page.
  perform test.ok('extra persons','a season prices its own extra bed',
    t.total = 6500, '5000 + 1500; got ' || coalesce(t.total::text,'null'));

  select * into t from app.tariff_for(v_type, 'EP', d + 9, 3, 0);
  perform test.ok('extra persons','and outside it the fallback returns',
    t.total = 3800, 'got ' || coalesce(t.total::text,'null'));

  -- ---------- children, separately ----------
  select * into t from app.tariff_for(v_type, 'EP', d, 2, 1);
  perform test.ok('extra persons','an unpriced child has no total either',
    t.total is null and t.unpriced = 'the extra child');

  update room_types set extra_child_rate = 500 where id = v_type;
  select * into t from app.tariff_for(v_type, 'EP', d, 3, 1);
  perform test.ok('extra persons','and both are counted once priced',
    t.total = 7000, '5000 + 1500 + 500; got ' || coalesce(t.total::text,'null'));

  select * into t from app.tariff_for(v_type, 'EP', d + 9, 3, 1);
  perform test.ok('extra persons','both missing names both',
    t.total = 4300, 'fallback 3000 + 800 + 500; got '
                    || coalesce(t.total::text,'null'));

  -- ---------- refusals ----------
  perform test.raises('extra persons','a negative extra rate is refused',
    format($q$update room_types set extra_adult_rate = -1 where id = %L$q$,
           v_type), '23514');

  -- ---------- teardown ----------
  delete from rates where hotel_id = v_hotel;
  delete from room_types where hotel_id = v_hotel;
  delete from staff_hotels where hotel_id = v_hotel;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = v_hotel;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'EXP';
  perform test.ok('extra persons','the fixture does not outlive the test', n = 0);
end $$;


-- =============================================================================
-- Work orders  (058)
-- =============================================================================
-- The distinction this table exists for: a work order is not a room block.
-- Most orders take no room out at all, and conflating them means a dripping
-- tap costs a night's revenue.
-- =============================================================================
do $$
declare
  v_hotel uuid; v_other uuid; v_staff uuid; v_type uuid;
  v_room uuid; v_far uuid; v_block uuid; v_order uuid;
  n int; t text;
begin
  select id into v_staff from staff limit 1;

  insert into hotels (code, name, city, timezone)
  values ('WOT', 'Work order fixture', 'Akkalkot', 'Asia/Kolkata')
  returning id into v_hotel;
  insert into hotels (code, name, city, timezone)
  values ('WOX', 'Other property', 'Pune', 'Asia/Kolkata')
  returning id into v_other;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_staff, v_hotel, 'gm') on conflict do nothing;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_hotel, 'STD', 'Standard', 2, 3, null, 1) returning id into v_type;
  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_hotel, v_type, '204', 2, true) returning id into v_room;

  insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy,
                          base_rate, sort_order)
  values (v_other, 'STD', 'Standard', 2, 3, null, 1) returning id into v_type;
  insert into rooms (hotel_id, room_type_id, number, floor, is_active)
  values (v_other, v_type, '999', 9, true) returning id into v_far;

  -- ---------- the dripping tap ----------
  insert into work_orders (hotel_id, room_id, title, category, priority,
                           raised_by)
  values (v_hotel, v_room, 'Dripping tap in the bathroom', 'plumbing',
          'normal', v_staff)
  returning id into v_order;

  select count(*) into n from app.work_orders_open(v_hotel);
  perform test.ok('work orders','an open order is outstanding', n = 1);

  select blocks_room into t from app.work_orders_open(v_hotel) limit 1;
  -- THE DISTINCTION. A dripping tap does not take the room out, and a system
  -- that can only express "out of service" costs a night's revenue for one.
  perform test.ok('work orders','and it takes no room out of service',
    (select not blocks_room from app.work_orders_open(v_hotel) limit 1));

  -- ---------- the broken air conditioner in July ----------
  insert into room_blocks (hotel_id, room_id, from_date, to_date, reason,
                           note, created_by)
  values (v_hotel, v_room, current_date, current_date + 2, 'out_of_order',
          'AC compressor', v_staff)
  returning id into v_block;

  insert into work_orders (hotel_id, room_id, block_id, title, category,
                           priority, raised_by)
  values (v_hotel, v_room, v_block, 'Air conditioner not cooling',
          'electrical', 'urgent', v_staff);

  perform test.ok('work orders','one that DID take the room out says so',
    (select bool_or(blocks_room) from app.work_orders_open(v_hotel)));

  -- ---------- urgent first ----------
  select title into t from app.work_orders_open(v_hotel) limit 1;
  perform test.ok('work orders','urgent work is at the top',
    t = 'Air conditioner not cooling', 'got ' || t);

  -- ---------- not every order is about a room ----------
  insert into work_orders (hotel_id, title, category, priority, raised_by)
  values (v_hotel, 'Lift making a noise', 'maintenance', 'high', v_staff);
  perform test.ok('work orders','a lift needs no room',
    (select count(*) from app.work_orders_open(v_hotel) where room is null) = 1);

  -- ---------- closing ----------
  perform test.raises('work orders','closing without saying what was done is refused',
    format($q$update work_orders set status='done', closed_at=now(),
                                     closed_by=%L where id=%L$q$,
           v_staff, v_order), '23514');

  update work_orders
     set status = 'done', closed_at = now(), closed_by = v_staff,
         resolution = 'Washer replaced'
   where id = v_order;

  select count(*) into n from app.work_orders_open(v_hotel);
  perform test.ok('work orders','a closed order leaves the list', n = 2);

  select count(*) into n from work_orders where hotel_id = v_hotel;
  -- "How many times have we fixed this room this year" is the question a
  -- manager actually asks, and a table holding only open work cannot answer it.
  perform test.ok('work orders','but stays on the record', n = 3);

  -- ---------- refusals ----------
  perform test.raises('work orders','a room at another property is refused',
    format($q$insert into work_orders (hotel_id, room_id, title, raised_by)
              values (%L,%L,'Wrong property',%L)$q$,
           v_hotel, v_far, v_staff), 'P0001');

  perform test.raises('work orders','and an order with no title',
    format($q$insert into work_orders (hotel_id, title, raised_by)
              values (%L,'   ',%L)$q$, v_hotel, v_staff), '23514');

  perform test.raises('work orders','and an unknown priority',
    format($q$insert into work_orders (hotel_id, title, priority, raised_by)
              values (%L,'Something','whenever',%L)$q$, v_hotel, v_staff),
    '23514');

  -- ---------- teardown ----------
  delete from work_orders where hotel_id = v_hotel;
  delete from room_blocks where hotel_id = v_hotel;
  delete from rooms where hotel_id in (v_hotel, v_other);
  delete from room_types where hotel_id in (v_hotel, v_other);
  delete from staff_hotels where hotel_id = v_hotel;

  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (v_hotel, v_other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('WOT','WOX');
  perform test.ok('work orders','the fixture does not outlive the test', n = 0);
end $$;
