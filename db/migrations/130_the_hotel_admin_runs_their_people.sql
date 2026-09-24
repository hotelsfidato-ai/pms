-- =============================================================================
-- 130 · A hotel's Admin runs that hotel's people, and may make an Admin there
-- =============================================================================
-- The owner's D23-2, 23 September (docs/briefs/decisions-2026-09-23.md): "a
-- hotel-level Admin manages staff at their own hotel, including giving Admin
-- there". Somebody whose role AT A HOTEL is `admin` (not a group
-- administrator) now does on People what a GM does since 128 - adds, edits,
-- rosters, removes, switches off and resets passwords for that hotel's people
-- - and may also hand out Admin there, as the hotel's owner may. Nowhere else.
--
-- ONE LINE CARRIES MOST OF IT: app.manages_hotel (084) counts `admin` beside
-- `owner` and `gm`. Every people rule reads it: require_hotel_admin,
-- grantable_roles, may_manage_person (so passwords and the first screen),
-- manages_person, may_switch_person and the staff_hotels policies.
--
-- ⚠ AND ONE RULE THAT READ IT IS NOT ABOUT PEOPLE: correcting a closed night
-- audit (100, D17-12: "needs the GM"). Nobody has decided that a hotel's Admin
-- corrects a closed day, so that trigger now names owner and GM itself.
--
-- ⚠ AND NOBODY RUNS SOMEBODY ABOVE THEM (the owner, 24 September): nobody
-- edits, removes, re-roles, switches off or resets the password of somebody
-- whose role at that hotel they could not give. The GM leaves the hotel's
-- Admin and Owner alone (D22-2 already said a GM makes neither - and a GM who
-- could reset an Admin's password could become one); a hotel's Admin leaves
-- its Owner alone. The last section of this file.
--
-- Re-runnable: every function keeps the signature and return type an earlier
-- migration gave it (root MEMORY 317).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Who runs this hotel's people: a group administrator, or owner, GM or Admin
-- AT THIS HOTEL (D23-2 added Admin). The hotel_id line is still the point.
-- -----------------------------------------------------------------------------
create or replace function app.manages_hotel(p_hotel uuid)
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
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'gm', 'admin')
  );
$$;

comment on function app.manages_hotel(uuid) is
  'Group administrator, or owner, GM or Admin AT THIS HOTEL (Admin: D23-2, '
  '23 September 2026). Runs that hotel''s people. Not app.is_manager(), which '
  'has no hotel in it. Correcting a closed day does NOT ask this (130).';


-- -----------------------------------------------------------------------------
-- Which roles this caller may hand out at that hotel - 128's, with Admin
-- beside owner as the roles that may make an Admin there (D23-2).
-- -----------------------------------------------------------------------------
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
           -- D22-2: an Admin is made by the owner or an admin - here, since
           -- D23-2, an Admin at this hotel too. The GM makes none.
           and (r <> 'admin' or exists (
                 select 1 from staff_hotels sh
                   join staff s on s.id = sh.staff_id
                  where sh.staff_id = app.current_user_id()
                    and sh.hotel_id = p_hotel
                    and s.is_active
                    and sh.role in ('owner', 'admin'))))
    else array[]::text[]
  end;
$$;

comment on function app.grantable_roles(uuid) is
  'The roles this caller may assign at this hotel. A group administrator: '
  'all. The owner or an Admin there: all but owner (D23-2). The GM there: all '
  'but owner and admin (D22-2). Anybody else: none.';


-- -----------------------------------------------------------------------------
-- Creating a person: a manager ANYWHERE, as 084 had it, or now somebody who
-- runs people at some hotel (a hotel's Admin). A staff row on its own grants
-- nothing; the grant is staff_hotels, and that stays scoped to one hotel.
-- ⚠ Not an inline read of `staff`: a policy on staff that reads staff
-- recurses (027). app.manages_hotel is SECURITY DEFINER and checks is_active.
-- -----------------------------------------------------------------------------
drop policy if exists staff_manager_write on staff;
create policy staff_manager_write on staff
  for insert with check (
    not is_group_admin
    and (app.is_manager()
         or exists (select 1 from staff_hotels sh
                     where sh.staff_id = app.current_user_id()
                       and app.manages_hotel(sh.hotel_id))));


-- -----------------------------------------------------------------------------
-- A closed day's record is still the GM's to correct (D17-12) - 100's trigger,
-- word for word, with manages_hotel's old meaning written out: a group
-- administrator, or owner or GM at this hotel. Not a hotel's Admin.
-- -----------------------------------------------------------------------------
create or replace function app.closed_day_record_needs_gm()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'completed' then
    return new;
  end if;

  if (new.hotel_id, new.business_date, new.status, new.rooms_posted,
      new.revenue_posted, new.no_shows, new.started_at, new.completed_at,
      new.error_message)
     is not distinct from
     (old.hotel_id, old.business_date, old.status, old.rooms_posted,
      old.revenue_posted, old.no_shows, old.started_at, old.completed_at,
      old.error_message)
     and (old.run_by is null or new.run_by is not distinct from old.run_by) then
    return new;                          -- nothing corrected
  end if;

  if app.is_group_admin() or exists (
       select 1 from staff_hotels sh
         join staff s on s.id = sh.staff_id
        where sh.staff_id = app.current_user_id()
          and sh.hotel_id = old.hotel_id
          and s.is_active
          and sh.role in ('owner', 'gm')) then
    return new;
  end if;

  raise exception 'The night audit for % is closed. Only the GM can correct its record.',
    to_char(old.business_date, 'FMDD FMMonth YYYY')
    using errcode = '42501';
end $$;


-- =============================================================================
-- NOBODY RUNS SOMEBODY ABOVE THEM (the owner, 24 September)
-- =============================================================================
-- "Somebody at a hotel I run" becomes "somebody whose role at a hotel I run is
-- one I may give": `sh.role = any (app.grantable_roles(sh.hotel_id))`, which
-- is empty at a hotel the caller does not run, so it carries manages_hotel in
-- it. 084's and 128's functions, word for word apart from that line.
-- -----------------------------------------------------------------------------
create or replace function app.may_manage_person(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when p_staff = app.current_user_id() then true
    when exists (select 1 from staff s
                  where s.id = app.current_user_id()
                    and s.is_active and s.is_group_admin) then true
    when exists (select 1 from staff t where t.id = p_staff
                   and t.is_group_admin) then false
    else exists (
      select 1 from staff_hotels sh
       where sh.staff_id = p_staff
         and sh.role = any (app.grantable_roles(sh.hotel_id))
    )
  end;
$$;

comment on function app.may_manage_person(uuid) is
  'Yourself, always. A group administrator, anybody. A property manager, '
  'somebody at a hotel they run whose role there they could give (the owner, '
  '24 September 2026) - never a group administrator. The row policies on '
  '`staff` ask it and so does app.may_set_password.';

create or replace function app.manages_person(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or (
        not exists (select 1 from staff t where t.id = p_staff and t.is_group_admin)
    and exists (select 1 from staff_hotels sh
                 where sh.staff_id = p_staff
                   and sh.role = any (app.grantable_roles(sh.hotel_id))));
$$;

comment on function app.manages_person(uuid) is
  'A group administrator: anybody. A property manager: somebody at a hotel '
  'they run whose role there they could give, never a group administrator. '
  'Asked by PATCH /admin/staff/:id (D22-3).';

create or replace function app.may_switch_person(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when app.is_group_admin() then true
    when exists (select 1 from staff t where t.id = p_staff and t.is_group_admin) then false
    else exists (select 1 from staff_hotels sh where sh.staff_id = p_staff)
     and not exists (select 1 from staff_hotels sh
                      where sh.staff_id = p_staff
                        and not sh.role = any (app.grantable_roles(sh.hotel_id)))
  end;
$$;

comment on function app.may_switch_person(uuid) is
  'A group administrator: anybody. A property manager: somebody rostered only '
  'at hotels they run, in roles they could give there - never a group '
  'administrator. Switching a person off stops them at every hotel (D22-3).';

-- The rows: re-roling or removing somebody asks the same of the row as it
-- stands (USING); the row it becomes still asks 128's WITH CHECK.
drop policy if exists staff_hotels_manager_update on staff_hotels;
create policy staff_hotels_manager_update on staff_hotels
  for update using ( role = any (app.grantable_roles(hotel_id)) )
             with check (
    app.manages_hotel(hotel_id) and role = any (app.grantable_roles(hotel_id)));

drop policy if exists staff_hotels_manager_delete on staff_hotels;
create policy staff_hotels_manager_delete on staff_hotels
  for delete using ( role = any (app.grantable_roles(hotel_id)) );
