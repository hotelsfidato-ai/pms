-- =============================================================================
-- 188 · Signing in: a manager's longer password (D27-243 5.3, D27-245)
-- =============================================================================
-- The owner, 2 October: the owner, an Admin and a GM have at least 10
-- characters; everybody else 8 (the length itself is asked by the API,
-- api/src/identity.ts). And somebody GIVEN one of those roles while holding a
-- shorter password sets a 10-character one at their next sign-in.
--
-- The password itself is Firebase's and never comes here. What is kept is
-- one fact about it, written when it is set: long enough for a manager, or
-- not. NULL is "set before this was kept", and counts as not.
-- Re-runnable; staff gains two columns, staff_hotels and staff one trigger
-- each; nothing earlier is rewritten (MEMORY 317).
-- =============================================================================

alter table staff add column if not exists long_password boolean;
alter table staff add column if not exists must_change_password boolean not null default false;

comment on column staff.long_password is
  'Whether the password last set is long enough for the owner, an Admin or a '
  'GM (10 characters, D27-243). NULL: set before this was kept.';
comment on column staff.must_change_password is
  'Given a manager''s role with a shorter password: they set a 10-character '
  'one at their next sign-in (D27-245).';

-- Given owner, admin or gm at a hotel, or made a group administrator, without
-- a password known to be long enough: due at the next sign-in. A definer,
-- because whoever gives the role may not be able to update the person's row.
create or replace function app.manager_needs_long_password()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'staff_hotels' then
    if new.role in ('owner', 'admin', 'gm') then
      update staff set must_change_password = true
       where id = new.staff_id and long_password is not true and not must_change_password;
    end if;
  elsif new.is_group_admin and not old.is_group_admin and new.long_password is not true then
    new.must_change_password := true;
  end if;
  return new;
end
$$;

drop trigger if exists staff_hotels_manager_password on staff_hotels;
create trigger staff_hotels_manager_password
  after insert or update of role on staff_hotels
  for each row execute function app.manager_needs_long_password();

drop trigger if exists staff_group_admin_password on staff;
create trigger staff_group_admin_password
  before update of is_group_admin on staff
  for each row execute function app.manager_needs_long_password();

-- The one writer after a password is set: whether it is long, and nothing due
-- once it is. Asks the same question as setting it (084).
create or replace function app.note_password_set(p_staff uuid, p_long boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.may_set_password(p_staff) then
    raise exception 'You may not set this person''s password.' using errcode = '42501';
  end if;
  update staff
     set long_password = p_long,
         must_change_password = must_change_password and not p_long
   where id = p_staff;
end
$$;

revoke all on function app.note_password_set(uuid, boolean) from public;
grant execute on function app.note_password_set(uuid, boolean) to pms_app;
