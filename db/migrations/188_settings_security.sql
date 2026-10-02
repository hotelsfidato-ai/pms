-- =============================================================================
-- 188 · Signing in: a manager's longer password, and the sign-in history (D27-243 5.3, 5.4)
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


-- =============================================================================
-- The sign-in history (D27-243 5.4, D27-245 Q-B)
-- =============================================================================
-- One row per sign-in (Firebase's auth_time), written by the API the first
-- time it sees that sign-in's token (api/src/signIns.ts): when, the browser's
-- own description of the device, and the network address. Kept 90 days. The
-- time and device are shown to the owner (everybody) and an Admin (the people
-- at a hotel where they hold Admin); the address is kept for the record and
-- never shown. No policy lets the application read or write the table: the two
-- functions below are the only ways in.
-- =============================================================================

create table if not exists sign_ins (
  id         bigserial primary key,
  staff_id   uuid not null references staff(id),
  auth_time  timestamptz not null,
  at         timestamptz not null default now(),
  device     text check (device is null or char_length(device) <= 300),
  address    inet,
  unique (staff_id, auth_time)
);
create index if not exists sign_ins_at_idx on sign_ins (at);

alter table sign_ins enable row level security;
alter table sign_ins force row level security;
revoke all on sign_ins from pms_app;

comment on table sign_ins is
  'Each sign-in the API has seen, 90 days (D27-243 5.4). Read through '
  'app.sign_ins_of (time and device only); written by app.note_sign_in.';

create or replace function app.note_sign_in(
  p_uid text, p_auth_time timestamptz, p_device text, p_address text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_address inet;
begin
  begin
    v_address := nullif(btrim(p_address), '')::inet;
  exception when others then
    v_address := null;                  -- not an address: kept as nothing
  end;
  insert into sign_ins (staff_id, auth_time, device, address)
  select s.id, p_auth_time, left(nullif(btrim(p_device), ''), 300), v_address
    from staff s where s.firebase_uid = p_uid and s.is_active
  on conflict (staff_id, auth_time) do nothing;
  delete from sign_ins where at < now() - interval '90 days';
end
$$;

revoke all on function app.note_sign_in(text, timestamptz, text, text) from public;
grant execute on function app.note_sign_in(text, timestamptz, text, text) to pms_app;

-- The owner (a group administrator) reads anybody's; an owner or Admin at a
-- hotel reads the people rostered there. Time and device only.
create or replace function app.sign_ins_of(p_staff uuid)
returns table (signed_in timestamptz, device text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
       select 1 from staff me
        where me.id = app.current_user_id() and me.is_active
          and (me.is_group_admin or exists (
                 select 1 from staff_hotels mine
                   join staff_hotels theirs on theirs.hotel_id = mine.hotel_id
                  where mine.staff_id = me.id and mine.role in ('owner', 'admin')
                    and theirs.staff_id = p_staff))) then
    raise exception 'Sign-ins are for the owner, and an administrator for the people at their hotel.'
      using errcode = '42501';
  end if;
  return query
    select si.auth_time, si.device from sign_ins si
     where si.staff_id = p_staff and si.at >= now() - interval '90 days'
     order by si.auth_time desc;
end
$$;

revoke all on function app.sign_ins_of(uuid) from public;
grant execute on function app.sign_ins_of(uuid) to pms_app;
