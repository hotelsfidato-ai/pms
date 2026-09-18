-- =============================================================================
-- 078 · The roles, in one place — and three that the screen offered and the
--       database refused
-- =============================================================================
-- ⚠ THIS FIXES A LIVE DEFECT, not a naming preference.
--
-- The admin screen offered seven roles. The database allowed a DIFFERENT
-- seven. Three of the ones on the screen — Admin, Manager and Viewer — do not
-- exist in the check constraint at all, so assigning any of them returned
--
--     500  "Something went wrong. Nothing was changed."
--
-- Measured, by trying all seven through the API:
--
--     owner        works        admin    500 REFUSED
--     front_desk   works        manager  500 REFUSED
--     housekeeping works        viewer   500 REFUSED
--     finance      works
--
-- Nobody had noticed because Akkalkot has one staff row with a role, and it
-- is front_desk. The screen has been offering three roles that cannot be
-- assigned since the admin console was written.
--
-- This is the same shape as nine other defects in MEMORY.md: the same rule
-- written in two places, correct in one of them. `src/lib/permissions.ts` had
-- one list, `staff_hotels_role_valid` had another, and neither knew.
--
-- THE FIX IS NOT "MAKE THE LISTS MATCH". They matched once, presumably. The
-- fix is that there is only one list and everything asks it:
-- `app.assignable_roles()` below is the authority, the API validates against
-- it, and a test asserts the interface's copy is identical — so a role added
-- to one and not the other FAILS A GATE instead of failing a clerk.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE STORED NAMES DO NOT CHANGE
--
-- The owner asked for nine roles in their own words — GM, Reception, Chef,
-- Store Manager, Accountant — and left the decision to me. My first answer was
-- to rename the stored values to match. That was wrong, and this is the
-- correction: `gm`, `pos` and `front_desk` are written into about twenty
-- places — `pos-outlet.ts`, the test suite, the API — and renaming them buys
-- churn and risk for something no member of staff will ever see.
--
-- A STORED VALUE IS AN IDENTIFIER. A LABEL IS WHAT A PERSON READS. The two
-- were already separate (`ROLE_LABELS`), and the words the owner asked for
-- belong in the label. So: nothing renamed, four roles added, and every label
-- set to what an Indian hotel actually calls that job.
--
--     owner            Owner              (their "Super Admin")
--     admin            Admin              NEW to the database
--     gm               General Manager
--     hotel_manager    Hotel Manager      NEW
--     front_desk       Reception
--     housekeeping     Housekeeping
--     kitchen_manager  Kitchen Manager    NEW
--     chef             Chef               NEW
--     pos              Till Operator
--     stores           Store Manager
--     finance          Accountant
--     read_only        Viewer
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The list, and the one place it lives
-- -----------------------------------------------------------------------------
-- A function rather than a table: these are not data a property configures,
-- they are the vocabulary the permission matrix is written against, and a
-- role nobody has coded a matrix entry for is a role that grants nothing.
-- Adding one is a code change in both places, and the test makes sure it is
-- both.
create or replace function app.assignable_roles()
returns text[]
language sql
immutable
as $fn$
  select array[
    'owner',            -- unrestricted; sole authority over roles and settings
    'admin',            -- runs the platform day to day, including accounts
    'gm',               -- the whole book at their properties; approves
    'hotel_manager',    -- one property, below the GM
    'front_desk',       -- shown as Reception
    'housekeeping',
    'kitchen_manager',
    'chef',
    'pos',              -- a till identity, shown as Till Operator
    'stores',           -- shown as Store Manager
    'finance',          -- shown as Accountant
    'read_only'         -- shown as Viewer
  ]
$fn$;

comment on function app.assignable_roles() is
  'THE list of roles. The check constraint, the API and the interface all '
  'read this one -- three of them once had their own and the screen offered '
  'roles the database refused with a 500.';


-- -----------------------------------------------------------------------------
-- The constraint, derived from it
-- -----------------------------------------------------------------------------
-- ⚠ "RE-RUNNING THIS FILE IS SAFE" WAS TRUE FOR FIFTEEN MIGRATIONS AND THEN
-- STOPPED BEING. This said: dropped and re-added, the old list is a subset, no
-- existing row can fail. Then 093 added `revenue_manager` to
-- app.assignable_roles(). Every deploy replays from 001, so THIS file runs
-- again with its own narrower function in force, re-adds the constraint, and
-- Postgres validates it against the rows that exist - and the first person
-- given the Revenue Manager role makes every later deploy fail here and roll
-- back. Found by the purchasing chat on 18 September, reproduced clean: all
-- migrations, one revenue_manager row, replay, exit 3 at this line.
--
-- Production held only the owner role that day, which is the only reason it
-- had not bitten. The third of its family (MEMORY 284, 293): a constraint is
-- rewritten only when it is not already the one this file wants, so a later,
-- wider world is left alone.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'staff_hotels'::regclass
       and conname  = 'staff_hotels_role_valid'
       and pg_get_constraintdef(oid) like '%assignable_roles%'
  ) then
    alter table staff_hotels drop constraint if exists staff_hotels_role_valid;
    alter table staff_hotels add constraint staff_hotels_role_valid
      check (role = any (app.assignable_roles()));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Deactivating a property
-- -----------------------------------------------------------------------------
-- §2 asks for it and there was no column. Distinct from DELETING one, which
-- 066 already handles and which refuses once a property has traded: a hotel
-- that has taken a booking must never disappear, but a hotel that is closed
-- for the season must stop appearing in pickers.
alter table hotels add column if not exists is_active boolean not null default true;

comment on column hotels.is_active is
  'A closed property still owns its history. This hides it from pickers and '
  'group totals; app.delete_property removes one that never traded.';
