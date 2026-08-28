-- =============================================================================
-- 010_roles.sql — separating who can change DATA from who can change SHAPE
-- =============================================================================
-- This implements "DDL is isolated to one login" properly.
--
-- The instinct is right, but the control that matters is NOT which port the
-- admin panel listens on. It is WHICH DATABASE ROLE THE CONNECTION USES.
--
--   A web app connecting as a role that holds CREATE and DROP is dangerous
--   whether or not its admin screen is public — one SQL injection, one leaked
--   connection string, one dependency compromise, and the schema is gone.
--
--   A web app connecting as a role that CANNOT run DDL is safe even if the
--   admin panel is wide open, because the privilege simply does not exist on
--   that connection. The database refuses, not the firewall.
--
-- Port isolation is a good second layer. Role separation is the first one, and
-- it is the one that holds when the second fails.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Three roles, three jobs.
-- -----------------------------------------------------------------------------
do $$
begin
  -- Owns the schema. Holds DDL. Used ONLY by the migration runner, never by
  -- anything that serves a web request. This is the "one login" — and it is a
  -- database login, not a screen.
  if not exists (select 1 from pg_roles where rolname = 'pms_migrate') then
    create role pms_migrate login password 'CHANGE_ME_migrate';
  end if;

  -- The application. Reads and writes rows. Cannot create, alter or drop
  -- anything. Subject to RLS like any other caller.
  if not exists (select 1 from pg_roles where rolname = 'pms_app') then
    create role pms_app login password 'CHANGE_ME_app';
  end if;

  -- Reporting and BI. Reads only. Hand this one out freely.
  if not exists (select 1 from pg_roles where rolname = 'pms_readonly') then
    create role pms_readonly login password 'CHANGE_ME_readonly';
  end if;
end
$$;

-- ⚠️ Replace all three passwords before this runs anywhere real:
--    alter role pms_app set password '...';


-- -----------------------------------------------------------------------------
-- Nobody creates anything in public except the migration role.
-- -----------------------------------------------------------------------------
-- Postgres 15+ already revokes this by default. Doing it explicitly means the
-- guarantee holds on older versions too, and states the intent for whoever
-- reads this next.
-- -----------------------------------------------------------------------------
revoke create on schema public from public;
grant  usage  on schema public to pms_app, pms_readonly;
grant  usage  on schema app    to pms_app, pms_readonly;
grant  all    on schema public to pms_migrate;


-- -----------------------------------------------------------------------------
-- pms_migrate must OWN the tables, not merely be allowed into the schema.
-- -----------------------------------------------------------------------------
-- Granting CREATE on the schema lets pms_migrate make NEW objects. It does not
-- let it ALTER or DROP the ones 001–009 created, because in Postgres those
-- rights belong to the owner and cannot be granted. Without this block the
-- "migration role" cannot run the next migration — which is the whole job.
--
-- ⚠ Consequence worth knowing: `force row level security` from 007 applies to
--    the owner too, so pms_migrate is ALSO filtered by the policies when it
--    reads rows. DDL is unaffected; a data migration that must see every
--    property has to set app.user_id to a group admin first.
-- -----------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select schemaname, tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table %I.%I owner to pms_migrate', t.schemaname, t.tablename);
  end loop;

  for t in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
  loop
    execute format('alter function %I.%I(%s) owner to pms_migrate',
                   t.nspname, t.proname, t.args);
  end loop;
end
$$;

-- SECURITY DEFINER functions now run as pms_migrate rather than the installing
-- superuser. That is the intent — they need to bypass RLS on staff_hotels, not
-- to hold superuser rights.


-- -----------------------------------------------------------------------------
-- What the app may do: rows, not shapes.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on all tables    in schema public to pms_app;
grant usage, select                  on all sequences in schema public to pms_app;
grant execute                        on all functions in schema app    to pms_app;

grant select on all tables in schema public to pms_readonly;

-- Future tables inherit the same grants, so a new module added in migration 011
-- does not silently end up unreadable by the app — or, worse, prompt someone to
-- "just grant everything" to make it work.
alter default privileges in schema public
  grant select, insert, update, delete on tables to pms_app;
alter default privileges in schema public
  grant usage, select on sequences to pms_app;
alter default privileges in schema public
  grant select on tables to pms_readonly;
alter default privileges in schema app
  grant execute on functions to pms_app;


-- -----------------------------------------------------------------------------
-- Provisioning stays with the group admin.
-- -----------------------------------------------------------------------------
-- app.provision_property() only INSERTs, so pms_app can run it — which means
-- any active staff member could create a property. Narrow that to group admins,
-- since onboarding is a group-level act.
--
-- Note this is still not DDL. Adding a property remains pure data; this is only
-- about WHO may add one.
-- -----------------------------------------------------------------------------
create or replace function app.require_group_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from staff
     where id = app.current_user_id()
       and is_active
       and is_group_admin
  ) then
    raise exception 'Only a group administrator may provision a property.'
      using hint = 'Set staff.is_group_admin, or run this as the migration role.';
  end if;
end
$$;

-- Wire it into provisioning. Everything else in 009 is unchanged.
create or replace function app.provision_property(
  p_code          text,
  p_name          text,
  p_city          text,
  p_state         text default null,
  p_gstin         text default null,
  p_template_set  text default 'standard',
  p_timezone      text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
as $$
declare
  v_hotel_id uuid;
  v_types    integer;
begin
  perform app.require_group_admin();

  insert into hotels (code, name, city, state, gstin, timezone)
  values (upper(p_code), p_name, p_city, p_state, p_gstin, p_timezone)
  returning id into v_hotel_id;

  insert into room_types (hotel_id, code, name, base_occupancy,
                          max_occupancy, base_rate, sort_order)
  select v_hotel_id, t.code, t.name, t.base_occupancy,
         t.max_occupancy, t.default_rate, t.sort_order
    from room_type_templates t
   where t.template_set = p_template_set;

  get diagnostics v_types = row_count;

  if v_types = 0 then
    raise exception 'No room type templates found for set "%"', p_template_set
      using hint = 'Check room_type_templates, or pass a different p_template_set.';
  end if;

  raise notice 'Provisioned % (%) with % room types.', p_name, upper(p_code), v_types;
  return v_hotel_id;
end
$$;


-- =============================================================================
-- HOW THIS IS USED
-- =============================================================================
--   Migration runner  →  postgresql://pms_migrate:...   (DDL, run by hand)
--   The React app     →  postgresql://pms_app:...       (rows only)
--   Metabase / BI     →  postgresql://pms_readonly:...  (select only)
--
-- Only the first connection string can change the schema, and it never lives in
-- an environment variable that a web process can read.
--
-- PROVE IT — connect as pms_app and try:
--
--   create table hack (id int);
--   --> ERROR: permission denied for schema public
--
--   drop table folio_postings;
--   --> ERROR: must be owner of table folio_postings
--
--   insert into reservations (...) values (...);
--   --> works, subject to RLS
--
-- That is the isolation you described, enforced by the database rather than by
-- keeping a port closed. Keep the port closed as well — but this is the layer
-- that still holds after someone leaves it open.
-- =============================================================================
