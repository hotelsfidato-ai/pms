-- =============================================================================
-- 233 · A restaurant bill given free: NC, no charge (the owner's D27-351,
--       21 October)
-- =============================================================================
-- An open bill may now be closed as NC - no charge - by the owner, an
-- administrator or the GM, with a reason. Their name on it is the approval:
--
--   * from an open bill only, never one on a function's bill (the host
--     pays that one there);
--   * NC for good: who, when and why stay as written, as a void's do (222);
--   * it prints the dishes and their quantities with no prices, marked NC,
--     the reason and who gave it (heading 'nc');
--   * no value anywhere (the owner): every report that counts restaurant
--     sales reads `status = 'settled'`, so an NC bill leaves them, and its
--     tax, by itself. Valuing the food given at MRP in the stores is a later
--     piece, the GM's to set up.
--
-- Its lines are frozen with it: app.pos_order_lines_frozen (212) refuses a
-- change to any bill that is not open. Re-runnable (db/tests/rerun.sh):
-- guarded, or create or replace with the same signature.
-- =============================================================================

alter table pos_orders add column if not exists nc_by uuid references staff(id);
alter table pos_orders add column if not exists nc_at timestamptz;
alter table pos_orders add column if not exists nc_reason text;

comment on column pos_orders.nc_reason is
  'Why a bill was given free, NC (D27-351): the owner, an administrator or the '
  'GM. Required on an NC bill, and printed on it.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_status_valid'
                    and pg_get_constraintdef(oid) like '%no_charge%') then
    alter table pos_orders drop constraint if exists pos_orders_status_valid;
    alter table pos_orders add constraint pos_orders_status_valid check (
      status in ('open', 'settled', 'abandoned', 'void', 'no_charge'));
  end if;

  -- NC says who, when and why. Who and when are the database's (below).
  if not exists (select 1 from pg_constraint where conname = 'pos_orders_nc_complete') then
    alter table pos_orders add constraint pos_orders_nc_complete check (
      status <> 'no_charge'
      or (nc_by is not null and nc_at is not null
          and length(btrim(coalesce(nc_reason, ''))) > 0));
  end if;

  -- An NC bill prints NC · NO CHARGE, first time and every time.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_bill_prints_heading_check'
                    and pg_get_constraintdef(oid) like '%''nc''%') then
    alter table pos_bill_prints drop constraint if exists pos_bill_prints_heading_check;
    alter table pos_bill_prints add constraint pos_bill_prints_heading_check check (
      heading in ('interim', 'bill', 'duplicate', 'void', 'nc'));
  end if;
end $$;


-- ── Who may give a bill free ─────────────────────────────────────────────
-- Written out, not borrowed from 222's: this one is the owner's D27-351 and
-- changes only with them.
create or replace function app.gives_pos_no_charge(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm'));
$$;

comment on function app.gives_pos_no_charge(uuid) is
  'D27-351: the owner, an administrator or the GM at this hotel, or a group '
  'administrator, may close a restaurant bill as NC (no charge).';

revoke all on function app.gives_pos_no_charge(uuid) from public;
grant execute on function app.gives_pos_no_charge(uuid) to pms_app;


-- ── NC, as the database holds it ─────────────────────────────────────────
-- The route refuses first, each with a sentence; this is the guarantee
-- behind it. A session with no person (a migration, the superuser's own
-- repair) is not asked who it is.
create or replace function app.pos_order_nc_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'no_charge' then
    if new.status is distinct from 'no_charge'
       or (new.nc_by, new.nc_at, new.nc_reason)
          is distinct from (old.nc_by, old.nc_at, old.nc_reason) then
      raise exception 'Bill % is NC and stays as it was given.', old.order_no using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is distinct from 'no_charge' then
    return new;
  end if;

  if app.current_user_id() is not null and not app.gives_pos_no_charge(new.hotel_id) then
    raise exception 'NC is for the owner, an administrator or the general manager.'
      using errcode = '42501';
  end if;
  if old.status <> 'open' then
    raise exception 'Only an open bill is given NC; bill % is %.', old.order_no, old.status
      using errcode = '23514';
  end if;
  if new.event_id is not null then
    raise exception 'Bill % is on a function''s bill: the host pays it there.', old.order_no
      using errcode = '23514';
  end if;

  -- Who and when are the database's, not the caller's.
  new.nc_by := coalesce(app.current_user_id(), new.nc_by);
  new.nc_at := now();
  return new;
end $$;

drop trigger if exists pos_orders_nc_guard on pos_orders;
create trigger pos_orders_nc_guard
  before update on pos_orders
  for each row execute function app.pos_order_nc_guard();
