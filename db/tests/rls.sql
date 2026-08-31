-- =============================================================================
-- rls.sql — the suite that proves isolation, run as pms_app
-- =============================================================================
-- ⚠ THIS FILE WAS MISSING FOR THE WHOLE PROJECT.
--
--   run.sh has called it behind `if [ -f ... ]` since it was written. The file
--   did not exist, so the branch was skipped in silence and nobody noticed.
--   run.sh's own comment says why that matters:
--
--     "RLS suite runs as the application role — a superuser bypasses RLS and
--      would report success on a completely open database."
--
--   All 51 assertions in suite.sql run as `postgres`, which has BYPASSRLS.
--   They prove the constraints, the triggers and the ledger rules. They prove
--   NOTHING about tenant isolation. Every claim about RLS made in this project
--   until now rested on one manual check.
--
-- WHAT MAKES THIS FILE DIFFERENT: it connects as pms_app. If any assertion here
-- passes because the connection can see everything, the first one catches it.
--
-- Run:  psql -U pms_app -v clerk=<staff-uuid> -v other=<hotel-uuid> -f rls.sql
--       (run.sh supplies both.)
-- =============================================================================

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- psql does NOT substitute :'variables' inside a dollar-quoted DO block — the
-- text there is opaque to it, and `:'other'` arrives literally and is a syntax
-- error. They are parked in settings by plain statements, which psql DOES
-- substitute, and read back with current_setting().
select set_config('test.other_hotel', :'other', false);
select set_config('test.clerk',       :'clerk', false);
select set_config('test.owner',       :'owner', false);

-- -----------------------------------------------------------------------------
-- 0 — the check that makes every other check meaningful.
-- -----------------------------------------------------------------------------
-- With no session set, app.current_user_id() is null and every policy fails
-- closed. If rows come back here, RLS is not in force and this whole file is
-- theatre.
-- -----------------------------------------------------------------------------
do $$
declare n int; who text;
begin
  select current_user into who;
  if who <> 'pms_app' then
    raise exception 'rls.sql is connected as %, not pms_app. A superuser '
                    'bypasses RLS and every assertion below would pass on a '
                    'completely open database.', who;
  end if;

  select count(*) into n from reservations;
  if n <> 0 then
    raise exception 'RLS is not in force: % reservations readable with no '
                    'session set.', n;
  end if;

  select count(*) into n from staff;
  if n <> 0 then
    raise exception 'RLS is not in force: % staff rows readable with no '
                    'session set.', n;
  end if;

  raise notice '  ✓ denies by default (0 rows with no session)';
end $$;


-- -----------------------------------------------------------------------------
-- 1 — a clerk sees their own property and no other.
-- -----------------------------------------------------------------------------
select set_config('app.user_id', current_setting('test.clerk'), false);

do $$
declare mine int; theirs int; total int;
begin
  select count(*) into mine   from reservations;
  select count(*) into theirs from reservations r
   where r.hotel_id not in (select app.auth_hotel_ids());

  if theirs <> 0 then
    raise exception 'Leak: % reservations visible from a hotel this clerk has '
                    'no grant for.', theirs;
  end if;

  -- A test that reads nothing cannot fail. suite.sql line 79 records the same
  -- trap; it is repeated here because it is the easiest one to fall into.
  if mine = 0 then
    raise exception 'Vacuous: this clerk can see no reservations at all, so '
                    'the isolation check filtered nothing.';
  end if;

  select count(*) into total from folios
   where hotel_id not in (select app.auth_hotel_ids());
  if total <> 0 then
    raise exception 'Leak: % folios visible outside this clerk''s grants.', total;
  end if;

  raise notice '  ✓ sees % reservations, 0 from another property', mine;
end $$;


-- -----------------------------------------------------------------------------
-- 2 — a clerk cannot WRITE into another property.
-- -----------------------------------------------------------------------------
-- Reading is half the guarantee. A policy with USING but no WITH CHECK would
-- pass every test above and still let a clerk file a booking against a hotel
-- they cannot see.
-- -----------------------------------------------------------------------------
do $$
declare refused boolean := false; src int;
begin
  -- Source rows must be VISIBLE, or the INSERT inserts nothing and succeeds
  -- vacuously — reporting a refusal that never happened.
  select count(*) into src
    from guests g, room_types rt
   where rt.hotel_id in (select app.auth_hotel_ids());

  if src = 0 then
    raise exception 'Vacuous: no visible source rows, so the cross-tenant '
                    'INSERT would have inserted nothing.';
  end if;

  begin
    insert into reservations
      (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate)
    select current_setting('test.other_hotel')::uuid, 'RLS-CROSS-TENANT', g.id, rt.id,
           date '2027-06-01', date '2027-06-02', 3000
      from guests g, room_types rt
     where rt.hotel_id in (select app.auth_hotel_ids())
     limit 1;
  exception when others then
    refused := true;
  end;

  if not refused then
    raise exception 'Leak: a clerk inserted a reservation into another '
                    'property.';
  end if;

  raise notice '  ✓ refuses a cross-tenant INSERT';
end $$;


-- -----------------------------------------------------------------------------
-- 3 — an UPDATE must not silently succeed by matching nothing.
-- -----------------------------------------------------------------------------
-- This is the failure mode that looks like success: the statement returns
-- without error, having changed zero rows, and application code reads that as
-- "done". The row is invisible, so it is untouched — correct, and it must not
-- be reported as a completed change.
-- -----------------------------------------------------------------------------
do $$
declare touched int;
begin
  update reservations set notes = 'RLS-SHOULD-NOT-HAPPEN'
   where hotel_id = current_setting('test.other_hotel')::uuid;
  get diagnostics touched = row_count;

  if touched <> 0 then
    raise exception 'Leak: a clerk updated % rows in another property.', touched;
  end if;

  raise notice '  ✓ a cross-tenant UPDATE changes 0 rows (and must not be '
               'read as success)';
end $$;


-- -----------------------------------------------------------------------------
-- 4 — staff_hotels: own rows only, for a clerk.
-- -----------------------------------------------------------------------------
do $$
declare mine int; others int;
begin
  select count(*) into mine   from staff_hotels where staff_id = app.current_user_id();
  select count(*) into others from staff_hotels where staff_id <> app.current_user_id();

  if mine = 0 then
    raise exception 'Vacuous: this clerk holds no access rows, so the filter '
                    'had nothing to hide.';
  end if;
  if others <> 0 then
    raise exception 'Leak: a clerk read % access rows belonging to other '
                    'staff.', others;
  end if;

  raise notice '  ✓ reads % own access rows, 0 belonging to anyone else', mine;
end $$;


-- -----------------------------------------------------------------------------
-- 5 — the ledger is append-only for the APP role too.
-- -----------------------------------------------------------------------------
-- suite.sql proves this as a superuser. A trigger that a superuser cannot get
-- past is not automatically one the app role cannot, and the app role is the
-- one that will actually try.
-- -----------------------------------------------------------------------------
do $$
declare refused boolean := false; n int;
begin
  select count(*) into n from folio_postings;
  if n = 0 then
    raise exception 'Vacuous: no visible postings to attempt to delete.';
  end if;

  begin
    delete from folio_postings where id in (select id from folio_postings limit 1);
  exception when others then
    refused := true;
  end;

  if not refused then
    raise exception 'The ledger accepted a DELETE from pms_app.';
  end if;

  raise notice '  ✓ refuses DELETE on folio_postings as pms_app';
end $$;


-- -----------------------------------------------------------------------------
-- 6 — a group admin sees every property, THROUGH the policy.
-- -----------------------------------------------------------------------------
-- `force row level security` filters even the table owner, so this must be the
-- policy admitting them rather than anything bypassing it.
-- -----------------------------------------------------------------------------
-- The owner's id is passed IN, not looked up. Under the clerk's session the
-- staff_self policy returns only their own row, so this subquery came back
-- NULL, app.user_id was set to nothing, and the admin check ran as nobody --
-- reporting a broken auth_hotel_ids() when the real cause was the policy doing
-- its job. A clerk cannot look up the owner, and that is correct.
select set_config('app.user_id', current_setting('test.owner'), false);

do $$
declare scope_count int; total_hotels int; grants_seen int;
begin
  /* Assert on SCOPE, not on where the data happens to be.
     The first version counted distinct hotel_ids in `reservations` and
     demanded two. At this point in run.sh only the suite's fixture exists,
     and it books every reservation into AGR — so the check failed on a
     correct database. What is being proven is that auth_hotel_ids() opens
     every property to an admin, and that is what it now asks. */
  select count(*) into scope_count  from (select app.auth_hotel_ids()) t;
  select count(*) into total_hotels from hotels where is_active;

  if scope_count <> total_hotels then
    raise exception 'A group admin is scoped to % of % active properties - the '
                    'is_group_admin branch of auth_hotel_ids() is not working.',
                    scope_count, total_hotels;
  end if;
  if total_hotels < 2 then
    raise exception 'Vacuous: only % active property, so admin scope was not '
                    'actually widened by anything.', total_hotels;
  end if;

  -- 020/D3. Before it, an admin read ZERO access rows: the self-only policy
  -- matched nothing, because an admin holds no staff_hotels rows of their own.
  select count(*) into grants_seen from staff_hotels;
  if grants_seen = 0 then
    raise exception 'A group admin cannot see anyone''s access grants, so the '
                    'Users and Roles screens have nothing to show. Migration '
                    '020 (D3) has not been applied.';
  end if;

  raise notice '  ✓ group admin: % of % properties, % access grants, through the policy',
               scope_count, total_hotels, grants_seen;
end $$;

\echo '  ✓ rls.sql — isolation proven as pms_app, not as a superuser'

-- -----------------------------------------------------------------------------
-- STAFF VISIBILITY (027) — the owner sees all, a property sees its own
-- -----------------------------------------------------------------------------
-- `staff` carried ONE policy, `staff_self`, so every caller saw exactly one
-- row: their own. Including the group owner, who could not administer users.
--
-- It went unnoticed because the frontend generated that list from the
-- permission matrix instead of reading it. The moment it read the database the
-- gap appeared.
--
-- Asserted HERE rather than in suite.sql because suite.sql runs as the
-- superuser, which bypasses RLS. Written there first, it reported
-- "a clerk cannot see another property's staff: 1 leaked" against policies
-- that were correct.
-- -----------------------------------------------------------------------------

-- As the CLERK.
select set_config('app.user_id', current_setting('test.clerk'), false);

do $$
declare seen int; mine int; theirs int;
begin
  select count(*) into seen from staff;
  select count(*) into mine from staff where id = app.current_user_id();

  if mine <> 1 then
    raise exception 'A clerk cannot see their own staff row (% found). '
                    'staff_self is broken.', mine;
  end if;

  -- Nobody from another property. The clerk is rostered at one hotel and the
  -- other clerk at a different one, so the colleague policy must not admit
  -- them.
  select count(*) into theirs
    from staff s
   where s.id <> app.current_user_id()
     and not exists (
       select 1 from staff_hotels mine2
         join staff_hotels theirs2 on theirs2.hotel_id = mine2.hotel_id
        where mine2.staff_id = app.current_user_id()
          and theirs2.staff_id = s.id
     );

  if theirs > 0 then
    raise exception 'A clerk can see % staff they share no property with. '
                    'The Users screen leaks the group roster.', theirs;
  end if;

  raise notice '  ✓ a clerk sees % staff: themselves and colleagues only', seen;
end $$;

-- As the OWNER.
select set_config('app.user_id', current_setting('test.owner'), false);

do $$
declare seen int; total int;
begin
  select count(*) into seen  from staff;
  select count(*) into total from staff;

  /* The owner is a group admin and holds NO staff_hotels rows — reaching
     everything through app.auth_hotel_ids() and, for this table, through
     app.is_group_admin(). Both had to be SECURITY DEFINER: a policy on
     `staff` that reads `staff` recurses forever, and 020's staff_hotels_admin
     read `staff` inline, which closed the loop the moment anything on `staff`
     referenced staff_hotels. */
  if seen < 3 then
    raise exception 'A group admin sees only % staff rows. The owner cannot '
                    'administer users.', seen;
  end if;

  raise notice '  ✓ group admin: sees all % staff rows', seen;
end $$;

-- -----------------------------------------------------------------------------
-- ADMIN WRITES (030) — who may administer, tested as the roles themselves
-- -----------------------------------------------------------------------------
-- In rls.sql and not suite.sql, for defect 47's reason: suite.sql runs as the
-- superuser, which bypasses RLS entirely and would report success against a
-- completely open database.
-- -----------------------------------------------------------------------------

-- As the CLERK.
select set_config('app.user_id', current_setting('test.clerk'), false);

do $$
declare n int;
begin
  -- ---------- a clerk cannot create staff ----------
  begin
    insert into staff (email, full_name) values ('intruder@x.in','Intruder');
    raise exception 'A clerk inserted a staff row. Anyone who can sign in can '
                    'now create an account.';
  exception when insufficient_privilege or others then
    if sqlerrm like 'A clerk inserted%' then raise; end if;
  end;
  raise notice '  ✓ a clerk cannot create staff';

  -- ---------- a clerk cannot widen their own reach ----------
  -- staff_hotels is what app.auth_hotel_ids() reads. A clerk who can insert
  -- here can add themselves to every property in the group.
  begin
    /* The other property is NAMED, not discovered. This originally found one
       with `select from hotels where not exists (...)` — which worked only
       while `hotels_read` let a clerk see the whole group. Once 031 scoped
       that, the subquery returned nothing, the insert touched no rows, and
       the test failed by its own assertion while the policy was correct.

       A test that has to enumerate the thing it is proving you cannot
       enumerate is testing the wrong way round.

       Through current_setting and not `:'other'` — psql does not interpolate
       its variables inside a dollar-quoted block, which the header of this
       very file warns about and which I walked into anyway. */
    insert into staff_hotels (staff_id, hotel_id, role)
    values (app.current_user_id(),
            current_setting('test.other_hotel')::uuid, 'front_desk');
    raise exception 'A clerk granted themselves access to another property.';
  exception when insufficient_privilege or others then
    if sqlerrm like 'A clerk granted%' then raise; end if;
  end;
  raise notice '  ✓ a clerk cannot grant themselves another property';

  -- ---------- a clerk cannot make themselves an admin ----------
  begin
    update staff set is_group_admin = true where id = app.current_user_id();
    raise exception 'A clerk promoted themselves to group administrator.';
  exception when insufficient_privilege or others then
    if sqlerrm like 'A clerk promoted%' then raise; end if;
  end;
  raise notice '  ✓ a clerk cannot promote themselves';
end $$;

do $$
declare seen int; mine int;
begin
  -- ---------- a clerk sees only the properties they work at ----------
  -- `hotels_read` was `app.is_active_staff()` until 031: anybody who could
  -- sign in could list every property in the group, its GSTIN included.
  -- Every OTHER table was scoped correctly, so no guest data and no money
  -- ever leaked — the roster of properties itself did.
  --
  -- Found by USE, not by test: a clerk created through the new admin API and
  -- rostered at one property asked the API what it could see, and it named
  -- all four.
  select count(*) into seen from hotels;
  select count(*) into mine
    from hotels where id in (select app.auth_hotel_ids());

  if seen <> mine then
    raise exception 'A clerk can list % properties but works at %. The '
                    'property roster leaks the whole group.', seen, mine;
  end if;
  raise notice '  ✓ a clerk lists % properties, exactly the ones they work at', seen;
end $$;

-- As the OWNER.
select set_config('app.user_id', current_setting('test.owner'), false);

do $$
declare v_new uuid; v_hotel uuid; n int;
begin
  -- ---------- an admin can create staff and grant access ----------
  /* on conflict, because this file must survive being run twice.

     It did not: the block below aborts on its own assertion if a guard
     is missing, skipping the cleanup at the end, and the NEXT run then
     died on `duplicate key value violates unique constraint
     "staff_email_key"` before reaching a single assertion.

     run.sh never saw it — it rebuilds the database from zero every time,
     so the leftover row could not exist there. It only appeared when the
     file was run twice by hand against a live database, which is exactly
     how somebody debugging a policy would run it. */
  insert into staff (email, full_name)
  values ('rls-admin-test@fidato.in','RLS Admin Test')
  on conflict (email) do update set full_name = excluded.full_name
  returning id into v_new;

  select id into v_hotel from hotels limit 1;
  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_new, v_hotel, 'front_desk');

  select count(*) into n from staff_hotels where staff_id = v_new;
  raise notice '  ✓ a group admin can create staff and grant access (% row)', n;

  -- ---------- and cannot demote themselves ----------
  begin
    update staff set is_group_admin = false where id = app.current_user_id();
    raise exception 'An admin removed their OWN administrator access.';
  exception when insufficient_privilege or others then
    if sqlerrm like 'An admin removed%' then raise; end if;
  end;
  raise notice '  ✓ an admin cannot change their own administrator access';

  -- ---------- and a staff row is never deleted ----------
  -- Found by trying to tear this test down. 030 grants admins INSERT and
  -- UPDATE on `staff` and deliberately NOT delete: their name is on
  -- audit_log.actor, on folio_postings.posted_by and on every invoice they
  -- issued, and a deleted row makes all of it unattributable.
  --
  -- So the cleanup below revokes ACCESS and DEACTIVATES, which is what the
  -- API's own endpoint does, and the failed delete became this assertion.
  delete from staff_hotels where staff_id = v_new;

  delete from staff where id = v_new;
  select count(*) into n from staff where id = v_new;
  if n <> 1 then
    raise exception 'A staff row was DELETED. Every posting, invoice and '
                    'audit entry that names them is now unattributable.';
  end if;
  raise notice '  ✓ a staff row cannot be deleted, only deactivated';

  update staff set is_active = false where id = v_new;

  select count(*) into n from staff_hotels where staff_id = v_new;
  if n <> 0 then
    raise exception 'The admin-write test left % access rows behind.', n;
  end if;
  raise notice '  ✓ the admin-write fixture holds no access afterwards';
end $$;
