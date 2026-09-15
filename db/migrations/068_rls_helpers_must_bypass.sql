-- =============================================================================
-- 068_rls_helpers_must_bypass.sql
--   The functions that DECIDE row-level security cannot themselves be subject
--   to it.
-- =============================================================================
-- WHAT HAPPENED. Signing in stopped working. Any read of `staff` — including
-- the one that turns a Firebase account into a person — died with:
--
--     ERROR: stack depth limit exceeded
--     CONTEXT: SQL function "is_group_admin" during startup   (× hundreds)
--
-- THE CYCLE. `staff_admin_read` is a policy ON staff whose predicate is
-- `app.is_group_admin()`, and that function reads staff. Evaluating the policy
-- calls the function, which reads the table, which evaluates the policy.
--
-- 027 knew about this cycle. Its comment says so, at length, and its answer was
-- SECURITY DEFINER: "running as owner bypasses the policy and ends the loop."
--
-- THAT SENTENCE WAS TRUE WHEN IT WAS WRITTEN AND STOPPED BEING TRUE LATER.
-- A table owner bypasses its own policies only until somebody says
-- `force row level security` — which this project says on every hotel-scoped
-- table, deliberately, so that a mistake in the app role cannot be covered by
-- owning the table. `staff` is FORCE. The owner is `pms_migrate`, which is not
-- a superuser. So the definer had no escape, and the loop never ended.
--
-- WHY NOTHING CAUGHT IT. `db/tests/run.sh` applies the migrations as
-- `postgres`, so in the scratch database every function is owned by a
-- SUPERUSER — and a superuser bypasses RLS whatever FORCE says. The live
-- database was migrated by `pms_migrate`. **The suite has been proving
-- isolation on a database whose ownership does not match the real one**, and
-- this bug is invisible there by construction. 419 assertions, nine of them
-- about isolation, all green, while sign-in was broken.
--
-- That is the finding worth keeping: a test environment that differs from
-- production in a privilege still reports on privileges with total confidence.
--
-- THE FIX. Make 027's assumption true. The three functions that RLS policies
-- call — current_user_id, auth_hotel_ids, is_group_admin — are the foundation
-- the policies are built on; they must be able to read the tables the policies
-- guard, or the foundation rests on itself.
--
-- The grant goes to the role that OWNS them, and to nothing else. `pms_app`,
-- the role the API connects as, must never have it: that role is the one RLS
-- exists to constrain. The owner could already drop FORCE on any table it
-- owns, so this adds no reach it did not have — it only stops the foundation
-- recursing.
-- =============================================================================

do $$
declare
  v_owner text;
  v_super boolean;
begin
  select pg_get_userbyid(proowner) into v_owner
    from pg_proc where proname = 'is_group_admin'
     and pronamespace = 'app'::regnamespace
   limit 1;

  if v_owner is null then
    raise exception 'app.is_group_admin() does not exist — 027 has not been applied.';
  end if;

  select rolsuper into v_super from pg_roles where rolname = v_owner;

  -- A superuser already bypasses RLS; granting is unnecessary and would fail
  -- to be meaningful. This is the case in the scratch database the gate
  -- builds, which is exactly why the gate could not see the bug.
  if v_super then
    raise notice
      '% is a superuser — RLS is already bypassed. Note that this database '
      'does NOT match a production one migrated by a non-superuser.', v_owner;
    return;
  end if;

  if not (select rolbypassrls from pg_roles where rolname = v_owner) then
    -- ALTER ROLE ... BYPASSRLS is superuser-only. If this cannot be done, say
    -- so loudly rather than leaving a database whose sign-in does not work.
    begin
      execute format('alter role %I bypassrls', v_owner);
      raise notice 'granted bypassrls to %, which owns the RLS helpers', v_owner;
    exception when insufficient_privilege then
      raise exception
        'Cannot grant BYPASSRLS to %, and without it every read of `staff` '
        'recurses until the stack is exhausted.', v_owner
        using hint = 'Run this migration as a superuser, or once by hand: '
                     'ALTER ROLE ' || v_owner || ' BYPASSRLS;';
    end;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- And prove it, here, every time the migrations run
-- ------------------------------------------------------
    -----------------------awd ok tmnmwntois ios thea  
-- The suite cannot see this in its scratch database. The migration can — it
-- runs where the ownership is real. A call that recurses raises long before
-- this returns, so reaching the next statement IS the assertion.
do $$
declare
  v boolean;
begin
  select app.is_group_admin() into v;
  -- The value is irrelevant; nobody is signed in while migrations run. That
  -- it ANSWERS is the whole point.
  if v is null then
    raise exception 'app.is_group_admin() returned null — expected true or false.';
  end if;
end $$;

comment on function app.is_group_admin() is
  'Whether the caller administers the group. SECURITY DEFINER, and its owner '
  'must hold BYPASSRLS — see 068. Owning the table is NOT enough once the '
  'table is FORCE row level security, which was the state 027 assumed and '
  'later migrations changed underneath it.';
