-- =============================================================================
-- 198 · An Administrator counts as a manager (the owner's D27-275 part 2,
--       4 October)
-- =============================================================================
-- app.is_manager() (013) answered for a group administrator, the owner and
-- the GM, and refused the Administrator (the `admin` role, 078), who is a
-- manager everywhere else (keeps_companies 177, manages_hotel 133). Where it
-- is still read, live:
--
--   booking_sources   insert and update policies (082): the Administrator
--                     could not add or change a booking source. THE CHANGE.
--   staff             insert policy (133): already let a hotel's Admin in
--                     through manages_hotel. No change.
--   is_crm_manager()  (122): already adds the Administrator. No change.
--
-- (hotels and companies read it once and now ask manages_hotel and
-- keeps_companies; the blacklist trigger asks is_crm_manager.)
--
-- Same signature, return type and security as 013, so a replay is a plain
-- replace and the grants stand (MEMORY 317). Re-runnable.
-- =============================================================================

create or replace function app.is_manager()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff s
     where s.id = app.current_user_id() and s.is_active and s.is_group_admin
  ) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm')
  )
$$;

comment on function app.is_manager() is
  'A group administrator, or the owner, an Administrator or the GM at any '
  'hotel (Administrator: D27-275). No hotel in it: for a hotel''s own '
  'question ask app.manages_hotel(hotel).';
