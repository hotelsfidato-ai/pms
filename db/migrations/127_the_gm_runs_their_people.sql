-- =============================================================================
-- 127 · The GM runs their own hotel's people, and makes no administrator
-- =============================================================================
-- The owner's answers of 22 September (docs/briefs/decisions-2026-09-22.md):
--
--   D22-2  "Only the owner or an admin makes an admin. A GM gives every other
--          role." Until now a GM could hand out everything but `owner` — Admin
--          included, and an Admin sets the module switches (D17-36), so a GM
--          could make somebody who holds more than they do.
--   D22-3  "People works for the GM, for their own hotel only." Adding,
--          editing, switching off and back on were a group administrator's
--          alone on the server, so People refused a GM with
--          "Only a group administrator may provision a property."
--
-- Re-runnable: every function keeps the signature and the return type an
-- earlier migration gave it, or is new here (root MEMORY 317).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Which roles may this caller hand out at that hotel? — D22-2
-- -----------------------------------------------------------------------------
-- A group administrator: every role. Somebody who is `owner` AT THIS HOTEL:
-- everything but `owner`, Admin included, as before. A GM here: everything but
-- `owner` and `admin`. Anybody else: nothing.
--
-- ⚠ ONLY THE CASE CHANGES, NOT THE SHAPE. 084 made this function; same name,
-- same argument, same text[].
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
           -- ⚠ D22-2: an Admin is made by the owner or an admin. A manager
           -- here who is not `owner` here (the GM) does not make one.
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
  'all. The owner there: all but owner. The GM there: all but owner and '
  'admin (D22-2, 22 September 2026). Anybody else: none.';


-- ⚠ AND THE ROW ITSELF, because a list the routes ask is a sentence, not a
-- rule (084's own argument). A manager's grant must be one of the roles they
-- may hand out, so a GM who reached `staff_hotels` by any door still makes no
-- Admin. A group administrator writes through 030's policies as before.
drop policy if exists staff_hotels_manager_write on staff_hotels;
create policy staff_hotels_manager_write on staff_hotels
  for insert with check (
    app.manages_hotel(hotel_id) and role = any (app.grantable_roles(hotel_id)));

drop policy if exists staff_hotels_manager_update on staff_hotels;
create policy staff_hotels_manager_update on staff_hotels
  for update using ( app.manages_hotel(hotel_id) )
             with check (
    app.manages_hotel(hotel_id) and role = any (app.grantable_roles(hotel_id)));

comment on policy staff_hotels_manager_write on staff_hotels is
  'A manager rosters their own hotel, with a role they may hand out '
  '(app.grantable_roles): a GM gives no owner and no admin (D22-2). The '
  'hotel_id in the predicate is what stops them rostering anybody else''s.';


-- -----------------------------------------------------------------------------
-- May this caller change this person's name and phone? — D22-3
-- -----------------------------------------------------------------------------
-- A group administrator, anybody. A manager, anybody rostered at a hotel they
-- run — never a group administrator. That is app.may_manage_person (084)
-- without its first line, "anybody may change their own details": the edit
-- route has only ever let a group administrator in, and a clerk renaming
-- themselves is not what D22-3 opened.
-- -----------------------------------------------------------------------------
create or replace function app.manages_person(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or (
        not exists (select 1 from staff t where t.id = p_staff and t.is_group_admin)
    and exists (select 1 from staff_hotels sh
                 where sh.staff_id = p_staff and app.manages_hotel(sh.hotel_id)));
$$;

comment on function app.manages_person(uuid) is
  'A group administrator: anybody. A property manager: anybody rostered at a '
  'hotel they run, never a group administrator. app.may_manage_person without '
  'the "yourself" line. Asked by PATCH /admin/staff/:id (D22-3).';

revoke all on function app.manages_person(uuid) from public;
grant execute on function app.manages_person(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- May this caller switch this person off, or back on? — D22-3
-- -----------------------------------------------------------------------------
-- `staff.is_active` is the whole person, at every hotel at once. So a GM
-- switches off only somebody who works nowhere else: every hotel they are
-- rostered at must be one the GM runs. Somebody who also works at another
-- hotel is taken off the GM's own (Remove), and switched off by a group
-- administrator — "never at another hotel".
--
-- ⚠ SECURITY DEFINER IS THE POINT. Under the GM's own row policies the other
-- hotel's staff_hotels rows are invisible, so the same question asked in a
-- route would find nothing there and say yes.
-- -----------------------------------------------------------------------------
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
                      where sh.staff_id = p_staff and not app.manages_hotel(sh.hotel_id))
  end;
$$;

comment on function app.may_switch_person(uuid) is
  'A group administrator: anybody. A property manager: somebody rostered only '
  'at hotels they run, never a group administrator — switching a person off '
  'stops them at every hotel (D22-3). Asked by deactivate and reactivate.';

revoke all on function app.may_switch_person(uuid) from public;
grant execute on function app.may_switch_person(uuid) to pms_app;
