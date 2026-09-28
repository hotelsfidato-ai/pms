-- =============================================================================
-- 149 · Who works here, by name and role (the owner, 28 September)
-- =============================================================================
-- Found on the Housekeeping board: a Hotel Manager could give rooms to nobody
-- but themselves, and saw every room as Unassigned even when it was somebody's.
-- A housekeeper likewise saw only themselves. The owner, an admin and the GM
-- saw everyone.
--
-- WHY. 027 wrote "anyone reads the staff they SHARE A PROPERTY WITH" as a
-- policy on `staff` that looks the colleague up in `staff_hotels` - and
-- `staff_hotels` shows each person only their own line unless they run the
-- hotel (018, 084, 133). The lookup ran under that table's row security, so it
-- found nobody, and the colleague rule never let anybody through. The lesson of
-- 068 (a helper inside a policy must bypass row security), missed here.
--
-- WHAT THE OWNER ASKED FOR (28 September): "Everyone sees their hotel's
-- staff" - names and roles, at their own hotel, never another hotel's.
--
-- ⚠ NOT BY OPENING THE TABLES. Letting everybody read `staff_hotels` would
-- bring 027's colleague rule to life for every column of `staff` - email,
-- phone, sign-in id - through any route that lists people. The owner said
-- names and roles. So this is one function that answers exactly that, for a
-- hotel the caller works at (or every hotel, for a group administrator), and
-- nothing else changes.
-- =============================================================================

create or replace function app.hotel_people(p_hotel uuid)
returns table (id uuid, full_name text, role text, is_active boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.full_name, sh.role, s.is_active
    from staff_hotels sh
    join staff s on s.id = sh.staff_id
   where sh.hotel_id = p_hotel
     and p_hotel in (select app.auth_hotel_ids())
$$;

comment on function app.hotel_people(uuid) is
  'The people rostered at a hotel the caller works at: id, name, role, active. '
  'SECURITY DEFINER because staff_hotels shows each person only their own line '
  '(149). Names and roles only - the owner, 28 September.';

revoke all on function app.hotel_people(uuid) from public;
grant execute on function app.hotel_people(uuid) to pms_app;
