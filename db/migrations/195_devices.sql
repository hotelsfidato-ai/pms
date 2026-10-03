-- =============================================================================
-- 195 · Sign out one device (settings phase 7, D27-255)
-- =============================================================================
-- Each row of sign_ins (188) is one sign-in on one device: Firebase's auth_time
-- stays the same on every token that sign-in refreshes. Firebase can only
-- revoke ALL of a person's sessions, so one device is signed out HERE: the row
-- is marked, and the API refuses that sign-in's tokens (api/src/signIns.ts,
-- read once per process through app.signed_out_sign_ins). The password still
-- works; signing in again is a new sign-in.
--
-- Who may: the owner anybody's, an owner or Admin the people at their hotel -
-- the same people who read the history (D27-245 Q-B, D27-255 Q2).
-- Re-runnable. sign_ins gains two columns. ⚠ app.sign_ins_of (188) is NOT
-- re-made: migrations replay from 001 on every deploy, and 188's
-- `create or replace` cannot change a return type back - the replay failed
-- "cannot change return type of existing function". The list with its status
-- is a new function, app.devices_of.
-- =============================================================================

alter table sign_ins add column if not exists signed_out_at timestamptz;
alter table sign_ins add column if not exists signed_out_by uuid references staff(id);

-- Who may read or sign out this person's sign-ins. One question, asked by both.
create or replace function app.may_see_sign_ins(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff me
     where me.id = app.current_user_id() and me.is_active
       and (me.is_group_admin or exists (
              select 1 from staff_hotels mine
                join staff_hotels theirs on theirs.hotel_id = mine.hotel_id
               where mine.staff_id = me.id and mine.role in ('owner', 'admin')
                 and theirs.staff_id = p_staff)))
$$;
revoke all on function app.may_see_sign_ins(uuid) from public;
grant execute on function app.may_see_sign_ins(uuid) to pms_app;

create or replace function app.devices_of(p_staff uuid)
returns table (id bigint, signed_in timestamptz, device text,
               signed_out_at timestamptz, signed_out_by text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.may_see_sign_ins(p_staff) then
    raise exception 'Sign-ins are for the owner, and an administrator for the people at their hotel.'
      using errcode = '42501';
  end if;
  return query
    select si.id, si.auth_time, si.device, si.signed_out_at, s.full_name
      from sign_ins si left join staff s on s.id = si.signed_out_by
     where si.staff_id = p_staff and si.at >= now() - interval '90 days'
     order by si.auth_time desc;
end
$$;
revoke all on function app.devices_of(uuid) from public;
grant execute on function app.devices_of(uuid) to pms_app;

-- Sign out the device of one sign-in. A second time changes nothing.
create or replace function app.sign_out_device(p_sign_in bigint)
returns table (firebase_uid text, auth_time timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff uuid;
begin
  select si.staff_id into v_staff from sign_ins si where si.id = p_sign_in;
  if v_staff is null or not app.may_see_sign_ins(v_staff) then
    raise exception 'Signing a device out is for the owner, and an administrator for the people at their hotel.'
      using errcode = '42501';
  end if;
  update sign_ins set signed_out_at = now(), signed_out_by = app.current_user_id()
   where id = p_sign_in and signed_out_at is null;
  return query
    select s.firebase_uid, si.auth_time
      from sign_ins si join staff s on s.id = si.staff_id where si.id = p_sign_in;
end
$$;
revoke all on function app.sign_out_device(bigint) from public;
grant execute on function app.sign_out_device(bigint) to pms_app;

-- What the API refuses, read once when it starts: every signed-out sign-in.
create or replace function app.signed_out_sign_ins()
returns table (firebase_uid text, auth_time timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.firebase_uid, si.auth_time
    from sign_ins si join staff s on s.id = si.staff_id
   where si.signed_out_at is not null and s.firebase_uid is not null
$$;
revoke all on function app.signed_out_sign_ins() from public;
grant execute on function app.signed_out_sign_ins() to pms_app;

-- ⚠ A SIGNED-OUT ROW IS NEVER PURGED. Firebase's refresh token does not expire,
-- so a device signed out and then forgotten after 90 days would be let back in.
-- The 90-day purge (188) now leaves signed-out rows; their address is cleared.
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
    v_address := null;
  end;
  insert into sign_ins (staff_id, auth_time, device, address)
  select s.id, p_auth_time, left(nullif(btrim(p_device), ''), 300), v_address
    from staff s where s.firebase_uid = p_uid and s.is_active
  on conflict (staff_id, auth_time) do nothing;
  delete from sign_ins where at < now() - interval '90 days' and signed_out_at is null;
  update sign_ins set address = null
   where at < now() - interval '90 days' and address is not null;
end
$$;
