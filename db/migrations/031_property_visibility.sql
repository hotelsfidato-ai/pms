-- =============================================================================
-- 031_property_visibility.sql — a clerk sees the properties they work at
-- =============================================================================
-- `hotels_read` was:
--
--     using ( app.is_active_staff() )
--
-- Anyone who can sign in could list every property in the group: its code, its
-- name, its city, its GSTIN and its current operating day. Not its rooms, not
-- its guests, not a rupee of its money — every OTHER table is scoped by
-- `app.auth_hotel_ids()` and RLS held on all of them. Only the roster of
-- properties itself was open.
--
-- The comment above the query in api/src/routes/hotels.ts said:
--
--     "No hotel filter. RLS applies hotels_read, so an Agra clerk and the
--      group owner run the same SQL and get different rows."
--
-- They ran the same SQL and got the SAME rows. The comment described the
-- intent and the policy did something else, which is the worst possible pair
-- because the comment is what anyone reads.
--
-- It went unnoticed while the group had three properties that all belonged to
-- one owner and a demo nobody signed into twice. It stops being cosmetic the
-- moment an administrator can create properties from a screen, which is what
-- 029 and 030 just made possible.
--
-- FOUND BY USE, NOT BY TEST. A clerk was created through the new admin API,
-- rostered at exactly one property, and asked the API what it could see. It
-- named all four.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A POLICY ON `hotels` MUST NOT READ `hotels`
-- -----------------------------------------------------------------------------
-- The obvious form is the one every other scoped table uses:
--
--     using ( id in (select app.auth_hotel_ids()) )
--
-- and it recurses until the server gives up:
--
--     ERROR: stack depth limit exceeded
--
-- `app.auth_hotel_ids()` reads `hotels` to answer "all of them" for a group
-- admin. It is SECURITY DEFINER, which does NOT disable row security — it
-- runs as the owner, and `hotels` carries FORCE row level security, so the
-- owner is subject to the policy too. The policy calls the function, the
-- function reads the table, the read fires the policy.
--
-- The same cycle migration 027 hit, and the same shape as defect 46. There
-- the answer was SECURITY DEFINER; here that is not enough, because the
-- recursion is through the TABLE rather than through a privilege.
--
-- So this policy answers the question directly and reads only staff_hotels
-- and (through a definer function) staff. Neither reads `hotels`.
-- -----------------------------------------------------------------------------

drop policy if exists hotels_read on hotels;

create policy hotels_read on hotels
  for select
  using (
    app.is_group_admin()
    or exists (
      select 1 from staff_hotels sh
       where sh.hotel_id = hotels.id
         and sh.staff_id = app.current_user_id()
    )
  );

-- `app.is_group_admin()` is SECURITY DEFINER and reads `staff` only — 027
-- made it so precisely to break a policy cycle. Reading `staff_hotels` from
-- here is safe: its own policies (staff_hotels_self, staff_hotels_admin)
-- check the caller and the same function, and neither touches `hotels`.

comment on policy hotels_read on hotels is
  'A person sees the properties they are rostered at. Group admins are '
  'rostered at all of them by app.auth_hotel_ids(), so they see all.';
