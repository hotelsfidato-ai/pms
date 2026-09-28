-- =============================================================================
-- 152 · Only the owner makes an Admin (D27-140, correcting D27-121)
-- =============================================================================
-- The owner, 28 September (QA RO-6, Q-9): a hotel's Admin may NOT make other
-- people Admin - only the owner (and a group administrator). The GM still
-- makes none (D22-2 stands). 133 had let an Admin at a hotel hand out Admin
-- there (D23-2); this takes that one thing back.
--
-- ONE LINE CHANGES: the roles that may give `admin` at a hotel are `owner`
-- there, no longer `owner` or `admin`. Everything else is 133's, word for
-- word, so a hotel's Admin still runs that hotel's people in every other role.
--
-- ⚠ AND THEREFORE: 133's "nobody runs somebody above them" reads this list, so
-- a hotel's Admin now also leaves the hotel's OTHER Admins alone - no edit,
-- re-role, removal, switch-off or password reset of a person they could not
-- have made. The owner or a group administrator does that.
--
-- Same signature and return type as 084, 128 and 133 (root MEMORY 317).
-- Asked directly in db/tests/modules/admin.sql (root MEMORY 318).
-- =============================================================================

create or replace function app.grantable_roles(p_hotel uuid)
returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when app.is_group_admin()
      then app.assignable_roles()
    when app.manages_hotel(p_hotel)
      then array(
        select r from unnest(app.assignable_roles()) r
         where r <> 'owner'
           -- D27-140: an Admin is made by the owner only - not by an Admin
           -- at this hotel (D23-2 is taken back), not by the GM (D22-2).
           and (r <> 'admin' or exists (
                 select 1 from staff_hotels sh
                   join staff s on s.id = sh.staff_id
                  where sh.staff_id = app.current_user_id()
                    and sh.hotel_id = p_hotel
                    and s.is_active
                    and sh.role = 'owner')))
    else array[]::text[]
  end;
$$;

comment on function app.grantable_roles(uuid) is
  'The roles this caller may assign at this hotel. A group administrator: '
  'all. The owner there: all but owner. An Admin or the GM there: all but '
  'owner and admin (D22-2; D27-140 took Admin back from the hotel''s Admin, '
  '28 September 2026). Anybody else: none.';
