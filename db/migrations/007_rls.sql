-- =============================================================================
-- 007_rls.sql — Row Level Security. Where the seven hotels actually separate.
-- =============================================================================
-- Until this file runs, every table is wide open to anyone who can connect.
-- Run it BEFORE the first real user signs in, not after.
--
-- WHAT RLS ACTUALLY DOES:
--   Postgres silently rewrites every query against a protected table to add
--   your policy's WHERE clause. `select * from reservations` becomes
--   `select * from reservations where hotel_id in (select app.auth_hotel_ids())`.
--
--   That matters because it is not something application code can forget. A new
--   screen, a raw query in a script, a REST endpoint you add next month — all of
--   them are filtered. Compare this with hiding a field in the UI, which is not
--   security at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Hotel-scoped tables — filtered by the gate from 002.
-- -----------------------------------------------------------------------------
-- Written as a loop rather than forty near-identical policies. Hand-writing
-- them guarantees that one table eventually gets missed, and a missed table is
-- a silent cross-property data leak that no test will notice.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  scoped_tables text[] := array[
    'room_types',
    'rooms',
    'room_status_log',
    'reservations',
    'folios',
    'folio_postings',
    'night_audit_runs'
  ];
begin
  foreach t in array scoped_tables loop
    execute format('alter table %I enable row level security', t);
    -- FORCE also applies the policy to the table owner. Without it, the role
    -- that owns the table bypasses RLS entirely — which is usually the exact
    -- role your API connects as.
    execute format('alter table %I force row level security', t);

    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Group-level tables — visible to any active staff member.
-- -----------------------------------------------------------------------------
-- guests and companies are shared across all properties on purpose (see 004).
-- The check is "are you a real, active member of staff", not "which hotel".
-- -----------------------------------------------------------------------------
create or replace function app.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff
     where id = app.current_user_id()
       and is_active
  )
$$;

do $$
declare
  t text;
begin
  foreach t in array array['guests', 'companies', 'hotels'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists staff_access on %I', t);
    execute format($p$
      create policy staff_access on %I
        for all
        using      ( app.is_active_staff() )
        with check ( app.is_active_staff() )
    $p$, t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- 3. staff_hotels — locked with NO policy at all. Deliberate.
-- -----------------------------------------------------------------------------
-- RLS on, zero policies, means nothing reachable from a browser can read or
-- write this table. If a user could write here they would simply grant
-- themselves the other six hotels.
--
-- app.auth_hotel_ids() still reads it, because SECURITY DEFINER runs as the
-- owner and bypasses RLS. That is precisely why the function has to be
-- SECURITY DEFINER — a plain subquery in a policy would hit this lock and
-- always return the empty set, and every user would see nothing.
--
-- Role assignment happens server-side (a trusted connection or an admin
-- endpoint), never from the client.
-- -----------------------------------------------------------------------------
alter table staff_hotels enable row level security;
alter table staff_hotels force row level security;

-- staff: you may read your own row, and nothing else.
alter table staff enable row level security;
alter table staff force row level security;

drop policy if exists staff_self on staff;
create policy staff_self on staff
  for select
  using ( id = app.current_user_id() );


-- =============================================================================
-- VERIFYING IT WORKS — run this after seeding (008).
-- =============================================================================
-- RLS is the kind of thing that is either right or catastrophically wrong, and
-- it looks identical from the outside. Test it deliberately:
--
--   -- Sign in as a front desk clerk who has ONE hotel:
--   set local app.user_id = '<their-staff-uuid>';
--   select count(*), count(distinct hotel_id) from reservations;
--   --> distinct hotel_id must be exactly 1
--
--   -- Try to read another property directly. Must return zero rows,
--   -- NOT an error — RLS filters, it does not reject:
--   select * from reservations where hotel_id = '<some-other-hotel>';
--
--   -- Try to write into another property. Must RAISE:
--   insert into folios (hotel_id, bill_to) values ('<other-hotel>', 'guest');
--   --> new row violates row-level security policy
--
--   -- Try to grant yourself a hotel. Must affect zero rows:
--   insert into staff_hotels (staff_id, hotel_id, role)
--   values (app.current_user_id(), '<other-hotel>', 'gm');
--
-- Write these as real automated tests. The CRS has 101 rules tests for exactly
-- this reason, and they are the reason nobody there is afraid to touch access
-- control.
-- =============================================================================
