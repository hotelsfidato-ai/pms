-- =============================================================================
-- 030_admin_writes.sql — a group admin may actually administer
-- =============================================================================
-- Every policy on `staff` and `staff_hotels` is a SELECT policy:
--
--     staff         staff_self, staff_admin_read, staff_colleague_read
--     staff_hotels  staff_hotels_self, staff_hotels_admin
--
-- So the answer to "can the owner add a member of staff" was no, from the
-- database, regardless of what any screen offered. The admin section was
-- read-only in the interface and read-only underneath it, and only the first
-- of those was noticed.
--
-- WHY A POLICY HERE AND A FUNCTION FOR PROPERTIES
--
-- 029 gave provisioning its own BYPASSRLS role rather than an INSERT policy,
-- because 013 withholds INSERT on `hotels` deliberately: a property must
-- arrive with its room types and its invoice series or not at all, and a bare
-- INSERT would let somebody make half of one.
--
-- Staff has no such invariant. A staff row is a name, an email and a flag;
-- there is no second half to forget. So the ordinary mechanism is the right
-- one, and inventing a function for it would be ceremony.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- staff
-- -----------------------------------------------------------------------------
-- `app.is_group_admin()` and not an inline lookup, for the reason migration
-- 027 records: a policy on `staff` that reads `staff` recurses forever. The
-- function is SECURITY DEFINER and exists precisely to break that cycle.
-- -----------------------------------------------------------------------------

drop policy if exists staff_admin_write on staff;
create policy staff_admin_write on staff
  for insert
  with check ( app.is_group_admin() );

drop policy if exists staff_admin_update on staff;
create policy staff_admin_update on staff
  for update
  using      ( app.is_group_admin() )
  with check ( app.is_group_admin() );

-- A person may correct their OWN name. Not their email, which is how they
-- sign in, and not their admin flag — that check is below.
drop policy if exists staff_self_update on staff;
create policy staff_self_update on staff
  for update
  using      ( id = app.current_user_id() )
  with check ( id = app.current_user_id() );


-- -----------------------------------------------------------------------------
-- Nobody promotes themselves
-- -----------------------------------------------------------------------------
-- `staff_self_update` lets a person edit their own row, which is right for a
-- name and catastrophic for `is_group_admin`. Policies are OR-ed: the self
-- policy would happily permit a clerk to set their own flag and reach every
-- property in the group.
--
-- A trigger rather than a narrower policy, because a WITH CHECK expression
-- cannot see the OLD row and therefore cannot tell "was already an admin"
-- from "just became one".
-- -----------------------------------------------------------------------------
create or replace function app.forbid_self_promotion()
returns trigger language plpgsql as $$
begin
  if new.is_group_admin is distinct from old.is_group_admin
     and old.id = app.current_user_id() then
    raise exception
      'You cannot change your own administrator access. Somebody else with '
      'administrator access has to do it.'
      using errcode = 'insufficient_privilege';
  end if;

  -- And only an admin may change anyone else's.
  if new.is_group_admin is distinct from old.is_group_admin
     and not app.is_group_admin() then
    raise exception
      'Only a group administrator may grant or remove administrator access.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists staff_no_self_promotion on staff;
create trigger staff_no_self_promotion
  before update on staff
  for each row execute function app.forbid_self_promotion();


-- -----------------------------------------------------------------------------
-- staff_hotels — the row that IS the isolation
-- -----------------------------------------------------------------------------
-- `app.auth_hotel_ids()` reads this table, and every RLS policy on every
-- scoped table is built on it. Writing here is what actually decides which
-- property's data a person can see; the navigation and the route guard are
-- the courtesy layer above it.
--
-- Group admins only. A manager cannot widen their own reach, and a clerk
-- cannot add themselves to a property they were not rostered at.
-- -----------------------------------------------------------------------------

drop policy if exists staff_hotels_admin_write on staff_hotels;
create policy staff_hotels_admin_write on staff_hotels
  for insert
  with check ( app.is_group_admin() );

drop policy if exists staff_hotels_admin_update on staff_hotels;
create policy staff_hotels_admin_update on staff_hotels
  for update
  using      ( app.is_group_admin() )
  with check ( app.is_group_admin() );

drop policy if exists staff_hotels_admin_delete on staff_hotels;
create policy staff_hotels_admin_delete on staff_hotels
  for delete
  using ( app.is_group_admin() );


-- -----------------------------------------------------------------------------
-- The last administrator
-- -----------------------------------------------------------------------------
-- Removing the only active group admin locks everybody out of administration
-- permanently, with no route back through the interface. The API refuses to
-- let somebody deactivate themselves; this refuses the other shape, where two
-- admins each remove the other and the second one succeeds.
-- -----------------------------------------------------------------------------
create or replace function app.keep_one_admin()
returns trigger language plpgsql as $$
declare remaining int;
begin
  select count(*) into remaining
    from staff
   where is_active and is_group_admin and id <> old.id;

  if remaining = 0 then
    raise exception
      'This is the only active administrator. Give somebody else '
      'administrator access first, or the group has none.'
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;

drop trigger if exists staff_keep_one_admin on staff;
create trigger staff_keep_one_admin
  before update on staff
  for each row
  when (old.is_active and old.is_group_admin
        and (not new.is_active or not new.is_group_admin))
  execute function app.keep_one_admin();
