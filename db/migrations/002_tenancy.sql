-- =============================================================================
-- 002_tenancy.sql — the three objects the whole system hangs off
-- =============================================================================
-- This is the most important file in the project. Everything else is detail.
--
-- THE RULE:
--   Tables in this file are GROUP-LEVEL. They have no hotel_id, because they
--   describe the company, not a property. Everything in later files is
--   HOTEL-SCOPED and carries `hotel_id not null`.
--
--   Getting a table on the wrong side of that line is the one mistake here
--   that is genuinely painful to undo later.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- hotels — the tenant registry. Seven rows today.
-- -----------------------------------------------------------------------------
-- Onboarding hotel #8 is one INSERT into this table. No migration, no deploy,
-- no new infrastructure. That is the entire point of the shared-schema design.
-- -----------------------------------------------------------------------------
create table if not exists hotels (
  id          uuid primary key default gen_random_uuid(),
  code        text        not null unique,           -- 'FH01' — appears in URLs
  name        text        not null,
  city        text        not null,
  state       text,
  gstin       text,                                  -- GST registration, per property
  timezone    text        not null default 'Asia/Kolkata',
  currency    char(3)     not null default 'INR',
  -- check_in_time/check_out_time drive the tape chart and auto no-show handling
  check_in_time   time    not null default '14:00',
  check_out_time  time    not null default '11:00',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint hotels_code_format check (code ~ '^[A-Z0-9]{2,10}$')
);

drop trigger if exists hotels_touch on hotels;
create trigger hotels_touch before update on hotels
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- staff — people who can sign in.
-- -----------------------------------------------------------------------------
-- On Supabase this mirrors auth.users (id matches). Self-hosted, this IS your
-- user table and you add a password_hash column or point GoTrue at it.
-- Kept separate from auth so the rest of the schema never depends on the
-- auth provider you happen to be using this month.
-- -----------------------------------------------------------------------------
create table if not exists staff (
  id          uuid primary key default gen_random_uuid(),
  email       citext      not null unique,
  full_name   text        not null,
  phone       text,
  -- is_group_admin sees every property without needing 7 staff_hotels rows.
  -- Use sparingly: owner and group GM only.
  is_group_admin boolean  not null default false,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists staff_touch on staff;
create trigger staff_touch before update on staff
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- staff_hotels — who may see which property, and as what.
-- -----------------------------------------------------------------------------
-- One row per person per hotel. A front desk clerk at Agra gets one row.
-- A cluster manager over three properties gets three. This table IS the
-- access model; the RLS policies in 007 read nothing else.
-- -----------------------------------------------------------------------------
create table if not exists staff_hotels (
  staff_id  uuid not null references staff(id)  on delete cascade,
  hotel_id  uuid not null references hotels(id) on delete cascade,
  role      text not null,
  created_at timestamptz not null default now(),

  primary key (staff_id, hotel_id),

  constraint staff_hotels_role_valid check (role in (
    'owner', 'gm', 'front_desk', 'housekeeping',
    'pos', 'stores', 'finance', 'read_only'
  ))
);

-- The lookup RLS does on every single query. Index it.
create index if not exists staff_hotels_staff_idx on staff_hotels (staff_id);


-- -----------------------------------------------------------------------------
-- app.auth_hotel_ids() — THE GATE
-- -----------------------------------------------------------------------------
-- Returns the set of hotel ids the caller may see. Every RLS policy in 007 is
-- some variation of `hotel_id in (select app.auth_hotel_ids())`.
--
-- WHY `security definer`:
--   staff_hotels has RLS enabled and no policy of its own, so nothing reachable
--   from a browser can read it — otherwise a user could grant themselves a
--   hotel. A plain subquery inside a policy would hit that RLS and always come
--   back empty. Running as the owner is what makes an allowlist check possible
--   at all. (Same idiom as docs/supabase/register-security.md in the CRS.)
--
-- WHY `set search_path`:
--   A security definer function without a pinned search_path can be hijacked by
--   a caller who creates a same-named table in a schema they control. This is a
--   real, documented Postgres privilege-escalation route — never omit it.
-- -----------------------------------------------------------------------------
create or replace function app.auth_hotel_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id
    from hotels h
   where exists (
     select 1 from staff s
      where s.id = app.current_user_id()
        and s.is_active
        and s.is_group_admin
   )
  union
  select sh.hotel_id
    from staff_hotels sh
    join staff s on s.id = sh.staff_id
   where sh.staff_id = app.current_user_id()
     and s.is_active
$$;

revoke all on function app.auth_hotel_ids() from public;
grant execute on function app.auth_hotel_ids() to public;
