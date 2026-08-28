-- =============================================================================
-- 017_production_readiness.sql — what breaks when real users and real data arrive
-- =============================================================================
-- Everything before this file was verified against a LOCAL Postgres with a
-- session variable standing in for a signed-in user. Three things break the
-- moment a Firebase user and a real property arrive, and all three were
-- demonstrated against the live database rather than reasoned about.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- P1 — a Firebase user cannot be mapped to a staff row.
-- -----------------------------------------------------------------------------
-- Firebase uids are 28-character strings. staff.id is a uuid, and nothing
-- connected them. Without this column a real user simply cannot sign in.
-- -----------------------------------------------------------------------------
alter table staff add column if not exists firebase_uid text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_firebase_uid_key') then
    alter table staff add constraint staff_firebase_uid_key unique (firebase_uid);
  end if;
end $$;

create index if not exists staff_firebase_idx on staff (firebase_uid)
  where firebase_uid is not null;


-- -----------------------------------------------------------------------------
-- P2 — the session helper assumed a Supabase-shaped token.
-- -----------------------------------------------------------------------------
-- The old body cast the JWT `sub` claim straight to uuid:
--
--   BREAK: invalid input syntax for type uuid: "kJ8mN2pQ4rS6tU8vW0xY1zA3bC5d"
--
-- That works on Supabase, where `sub` IS a uuid. On Firebase it raises on the
-- first authenticated request. This version accepts either shape.
--
-- ⚠ MUST BE SECURITY DEFINER, and this is not optional.
--   The `staff` policy is `id = app.current_user_id()`. If this function reads
--   `staff` as the invoker, that read triggers the policy, which calls this
--   function, which reads `staff` again — infinite recursion on every request.
--   Running as owner bypasses the policy and breaks the cycle.
-- -----------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_raw text; v_id uuid;
begin
  -- app.user_id first: the API sets it deliberately after verifying the token
  -- and resolving the staff row, which is the path that should normally run.
  v_raw := coalesce(
    nullif(current_setting('app.user_id', true), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );

  if v_raw is null then
    return null;                                    -- deny by default
  end if;

  begin
    return v_raw::uuid;                             -- already a staff id
  exception when invalid_text_representation then
    select id into v_id from staff
     where firebase_uid = v_raw and is_active;      -- a Firebase uid
    return v_id;
  end;
end $$;


-- -----------------------------------------------------------------------------
-- P3 — the placeholder seed would ship seven junk properties.
-- -----------------------------------------------------------------------------
-- 008_seed.sql inserts FH01..FH07 named 'REPLACE — property N name'. Running
-- the migration set unchanged on a fresh production database creates all seven,
-- and they are indistinguishable from real properties to every screen.
--
-- The no-delete trigger from 015 blocks the cleanup, which is the guard working
-- exactly as intended — so it is disabled for the length of this statement and
-- immediately restored.
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from hotels where name like 'REPLACE%';
  if n > 0 then
    alter table hotels disable trigger hotels_no_delete;
    -- Delete only the parent and let the FK cascades unwind rooms, room_types
    -- and invoice_series in dependency order. Deleting the children by hand
    -- fails: 008 seeds rooms too, and room_types cannot go while a room still
    -- references it.
    delete from hotels where name like 'REPLACE%';
    alter table hotels enable trigger hotels_no_delete;
    raise notice 'Removed % placeholder properties from the seed.', n;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- P4 — business_date must follow the PROPERTY's timezone, not the server's.
-- -----------------------------------------------------------------------------
-- The local cluster happened to run Asia/Calcutta, which masked this. An Oracle
-- instance defaults to UTC, and between 00:00 and 05:30 IST a UTC server still
-- reports YESTERDAY. Night audit, day-close and every `current_date` default
-- would be a day out for the first five and a half hours of every day.
--
-- Nothing should ever call current_date directly for a business date again.
-- -----------------------------------------------------------------------------
create or replace function app.business_date(p_hotel_id uuid)
returns date
language sql
stable
as $$
  select (now() at time zone coalesce(
            (select timezone from hotels where id = p_hotel_id),
            'Asia/Kolkata'))::date
$$;

comment on function app.business_date(uuid) is
  'The property''s current business date. Use this, never current_date — the '
  'server runs UTC in production and IST properties are 5.5 hours ahead, so '
  'current_date is wrong until 05:30 local every day.';

-- The financial year has the same problem for the same reason.
--
-- ⚠ The zero-argument version from 014 must be DROPPED, not left alongside this
--   one. Adding an overload whose only parameter has a default makes a bare
--   `app.current_fin_year()` ambiguous, and Postgres refuses it:
--     ERROR: function app.current_fin_year() is not unique
--   provision_property() calls it that way, so every provision fails.
drop function if exists app.current_fin_year();

create or replace function app.current_fin_year(p_hotel_id uuid default null)
returns text
language sql
stable
as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::text || '-' ||
         lpad(((extract(year from d) + 1)::int % 100)::text, 2, '0')
    else (extract(year from d) - 1)::text || '-' ||
         lpad((extract(year from d)::int % 100)::text, 2, '0')
  end
  from (select (now() at time zone coalesce(
                 (select timezone from hotels where id = p_hotel_id),
                 'Asia/Kolkata'))::date as d) t
$$;


-- -----------------------------------------------------------------------------
-- P5 — the shipped passwords are placeholders.
-- -----------------------------------------------------------------------------
-- 010 creates the three roles with literal 'CHANGE_ME_*' passwords so the
-- migration set is runnable. They must not survive contact with a real network.
-- This raises a warning on every run until they are changed.
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_shadow
   where usename in ('pms_app','pms_migrate','pms_readonly')
     and passwd is not null
     and passwd = md5('CHANGE_ME_app' || 'pms_app');   -- md5 auth form
  if n > 0 then
    raise warning
      'DEFAULT PASSWORDS ARE STILL SET. Run: alter role pms_app password ''...'';';
  end if;
end $$;


insert into schema_migrations (version) values ('017_production_readiness')
on conflict (version) do nothing;


-- =============================================================================
-- BEFORE THE FIRST REAL USER — a checklist this file cannot enforce
-- =============================================================================
--  1. alter role pms_app       password '<strong>';
--     alter role pms_migrate   password '<strong>';
--     alter role pms_readonly  password '<strong>';
--
--  2. On the Oracle instance, the three extensions need contrib:
--       sudo apt install postgresql-17 postgresql-contrib-17
--     pgcrypto, citext and btree_gist all come from there. 001 fails without it.
--
--  3. initdb with an explicit locale. The local cluster used --locale=C, which
--     sorts differently from en_IN.UTF-8. Choose deliberately; changing it later
--     means rebuilding every text index.
--
--  4. Provision the seven REAL properties with app.provision_property(). Do not
--     re-run 008 — P3 above exists because it seeds placeholders.
--
--  5. Set the API to call SET LOCAL app.user_id after verifying the Firebase
--     token, having looked up staff.firebase_uid. The JWT-claim path in P2 is a
--     fallback, not the intended route.
-- =============================================================================
