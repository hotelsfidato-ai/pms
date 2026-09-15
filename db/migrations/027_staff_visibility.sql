-- =============================================================================
-- 027_staff_visibility.sql — the owner can see who works here
-- =============================================================================
-- Phase 1, item 6, found on the way. `staff` carried exactly ONE policy:
--
--     staff_self    (id = app.current_user_id())
--
-- So every caller saw exactly one row — their own — including the group owner.
-- The Users screen listed one person to everybody, and a group admin could not
-- administer users at all.
--
-- It went unnoticed because the frontend GENERATED that list from the
-- permission matrix instead of reading it: one invented person per role. The
-- moment it read the database the gap appeared.
--
-- WHAT THE OWNER ASKED FOR
--
--   "the owner sees all, and the individual property has its own view"
--
-- Which is two policies, not one:
--
--   · a group admin reads every staff row
--   · anyone reads the staff they SHARE A PROPERTY WITH
--
-- The second is what makes a property's own user list work. A front-desk clerk
-- at Akkalkot seeing the housekeeper at Akkalkot is ordinary; seeing the
-- finance manager at Agra is not, and this does not let them.
--
-- ⚠ WHAT THIS DOES NOT OPEN
--
--   `staff` holds names, emails and a group-admin flag. It does NOT hold
--   identity documents — those went to `guest_documents` in 013 for exactly
--   this reason, and nothing here touches them. Nor does it grant WRITE:
--   creating and removing staff stays a provisioning act, outside the app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Am I a group admin? — asked without asking `staff`
-- -----------------------------------------------------------------------------
-- ⚠ THE FIRST VERSION OF THE POLICY BELOW READ `staff` DIRECTLY:
--
--     using (exists (select 1 from staff me
--                     where me.id = app.current_user_id()
--                       and me.is_group_admin))
--
--   which is a policy ON staff that SELECTS FROM staff — so evaluating it
--   evaluates it again. Postgres stopped it at
--   "infinite recursion detected in policy for relation staff", and the
--   isolation suite failed on its very first query.
--
--   Exactly the cycle app.current_user_id() was made SECURITY DEFINER to
--   break in 017, and for the same reason: running as owner bypasses the
--   policy and ends the loop.
--
--   `app.require_group_admin()` already existed but RAISES rather than
--   returning, so it cannot sit in a predicate. This is its boolean twin.
-- -----------------------------------------------------------------------------
create or replace function app.is_group_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (
    select 1 from staff
     where id = app.current_user_id()
       and is_active
       and is_group_admin
  )
$fn$;

comment on function app.is_group_admin() is
  'Whether the caller administers the group. SECURITY DEFINER because a '
  'policy on `staff` that reads `staff` recurses forever — the same cycle '
  'app.current_user_id() exists to break.';

revoke all on function app.is_group_admin() from public;
grant execute on function app.is_group_admin() to public;


-- -----------------------------------------------------------------------------
-- A group admin sees everybody
-- -----------------------------------------------------------------------------
drop policy if exists staff_admin_read on staff;
create policy staff_admin_read on staff
  for select
  using (app.is_group_admin());

comment on policy staff_admin_read on staff is
  'A group admin administers users, which requires seeing them. Read only: '
  'creating and removing staff is provisioning, not something the running '
  'application does to itself.';


-- -----------------------------------------------------------------------------
-- Closing a cycle that was already there, dormant
-- -----------------------------------------------------------------------------
-- `staff_hotels_admin` (migration 020) reads `staff`:
--
--     exists (select 1 from staff s
--              where s.id = app.current_user_id()
--                and s.is_active and s.is_group_admin)
--
-- Harmless while nothing on `staff` read `staff_hotels`. The colleague policy
-- below reads it — and the loop closes:
--
--     staff  →  staff_hotels  →  staff  →  ...
--
-- Postgres caught it, which is the good case. It was a trap waiting for
-- whoever next wrote a policy in this direction, and rewriting 020's predicate
-- as the SECURITY DEFINER call removes it rather than routing around it.
-- -----------------------------------------------------------------------------
drop policy if exists staff_hotels_admin on staff_hotels;
create policy staff_hotels_admin on staff_hotels
  for select
  using (app.is_group_admin());

comment on policy staff_hotels_admin on staff_hotels is
  'A group admin reads every grant. Written as app.is_group_admin() rather '
  'than an inline read of `staff`, because the inline form made a cycle the '
  'moment anything on `staff` referenced this table.';


-- -----------------------------------------------------------------------------
-- Everyone else sees the people they work with
-- -----------------------------------------------------------------------------
-- Scoped through staff_hotels, so it says exactly "we are rostered at the same
-- property". A clerk at Akkalkot sees the Akkalkot housekeeper and not the
-- Agra finance manager.
--
-- Written as an EXISTS over the shared hotel rather than as a join, because a
-- policy that returned duplicate rows for a colleague rostered at two
-- properties would make the Users list show them twice.
-- -----------------------------------------------------------------------------
drop policy if exists staff_colleague_read on staff;
create policy staff_colleague_read on staff
  for select
  using (
    exists (
      select 1
        from staff_hotels mine
        join staff_hotels theirs on theirs.hotel_id = mine.hotel_id
       where mine.staff_id = app.current_user_id()
         and theirs.staff_id = staff.id
    )
  );

comment on policy staff_colleague_read on staff is
  'Staff rostered at a property you are also rostered at. A hotel is a place '
  'where people know who else is on shift; this is that, and no wider.';


-- -----------------------------------------------------------------------------
-- What did NOT change
-- -----------------------------------------------------------------------------
-- `staff_self` stays. A person always reads their own row, including a group
-- admin with no staff_hotels grants and a service account rostered nowhere —
-- both would otherwise vanish from a list that includes them.
--
-- Policies are OR-ed, so the three together read: yourself, your colleagues,
-- or everybody if you administer the group.
-- -----------------------------------------------------------------------------
