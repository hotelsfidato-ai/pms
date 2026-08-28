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
