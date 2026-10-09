-- =============================================================================
-- 212 · Test hotels inside the live system (D27-296, the owner, 10 October)
-- =============================================================================
-- The owner: "a testing mode in this system: the same system, and when I add
-- people to an account a test toggle for them, so the team can use the exact
-- system and I can reset or delete all the test data". Twelve answers, the
-- ones this file carries:
--
--   (1)  a TEST HOTEL inside the live system, one per real hotel (12),
--        "Hotel Amrapali · TEST": `hotels.test_of` names the real hotel it
--        copies, null for a real one. It never changes, a test hotel has no
--        test hotel of its own, and it carries no GSTIN, PAN or FSSAI number
--        (8: its documents are not valid ones).
--   (2)  only people switched on use it: `staff.test_only` - a person added at
--        a test hotel works ONLY in test hotels. A real person may be given a
--        test hotel as a second place. Only the owner or a group administrator
--        gives anybody a test hotel or takes it away (10).
--   (3)  RESET (typed RESET at the screen): every bit of test activity goes -
--        bookings, bills, invoices, orders, guests, companies, cash, stock,
--        night audits - and the setup and the testers stay. RE-COPY: the reset,
--        then the real hotel's setup again. The append-only guards let these
--        deletes through ONLY for a test hotel during its own reset (a
--        transaction-local setting, checked with app.is_test_hotel), with every
--        foreign key still enforced. Never a table-wide trigger switch, never
--        session_replication_role. One audit entry per reset, naming who.
--   (4)  nothing leaves a test hotel: SU, the CRS, rivals' prices and the daily
--        report emails cannot be set up there, loyalty and the channel manager
--        cannot be switched on there (the API refuses every send).
--   (5)  only its own test guests: guests, companies, booking groups and the
--        offer answers carry `test_hotel_id`. A row is read on its own side
--        only, decided by the hotel in the address (`app.hotel_code`, which the
--        API sets on every transaction from /api/hotels/:code): a test hotel in
--        view shows its own test rows to the people who have it; anything else
--        shows real rows to people with a real hotel (or a group admin). So a
--        test-only person can never read a real guest, company or ID document,
--        and a real screen never shows a test guest. A trigger on every table
--        that has a hotel and points at a guest, a company or a booking group
--        refuses a row whose guest is on the other side - so a test bill never
--        counts on a real company's credit.
--   (7)  a test hotel starts as a copy of the real hotel's whole setup: every
--        hotel-scoped table is classed setup (copied), trading (cleared by the
--        reset) or never (kept apart: SU and CRS mappings, outside keys, the
--        series, the audit, ...) in app.test_hotel_classes(); a table in no
--        class fails db/tests/modules/test-hotels.sql.
--
-- Re-runnable: every object is created if missing or replaced.
-- =============================================================================


-- =============================================================================
-- 1 · THE MARK
-- =============================================================================
alter table hotels add column if not exists test_of uuid references hotels(id);

comment on column hotels.test_of is
  'The real hotel this test hotel copies (D27-296); null for a real hotel. '
  'Set once, by app.create_test_hotel, and never changed.';

alter table hotels drop constraint if exists hotels_test_of_not_itself;
alter table hotels add constraint hotels_test_of_not_itself
  check (test_of is distinct from id);

-- (8) a test hotel's documents are not valid ones: no tax identity to print.
alter table hotels drop constraint if exists hotels_test_has_no_tax_ids;
alter table hotels add constraint hotels_test_has_no_tax_ids
  check (test_of is null or (gstin is null and pan is null and fssai_number is null));

-- (12) one per real hotel.
create unique index if not exists hotels_one_test_each on hotels (test_of)
  where test_of is not null;

create or replace function app.is_test_hotel(p_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from hotels where id = p_hotel and test_of is not null)
$$;

comment on function app.is_test_hotel(uuid) is
  'D27-296: the ONE check every part of the system asks - is this a test hotel?';

-- The same question by code, for a door with no session to read hotels with
-- (a guest's link, the API's "nothing leaves" gate).
create or replace function app.is_test_hotel_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from hotels where code = upper(p_code) and test_of is not null)
$$;

-- The code of the real hotel a test hotel copies (GET /api/hotels' testOf):
-- its testers cannot read the real hotel's row, and need only its code.
create or replace function app.real_hotel_code(p_hotel uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.code from hotels t join hotels r on r.id = t.test_of where t.id = p_hotel
$$;

create or replace function app.hotel_test_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.test_of is distinct from old.test_of then
      raise exception 'Whether a property is a test hotel, and of which hotel, never changes.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.test_of is not null
     and exists (select 1 from hotels where id = new.test_of and test_of is not null) then
    raise exception 'A test hotel has no test hotel of its own.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists hotels_test_rules on hotels;
create trigger hotels_test_rules
  before insert or update of test_of on hotels
  for each row execute function app.hotel_test_rules();


-- =============================================================================
-- 2 · THE SIDE IN VIEW
-- =============================================================================
-- `app.hotel_code` is set by the API (db.ts, withUser) to the hotel in the
-- address, transaction-local, as `app.user_id` is. A test hotel in view is
-- "the test side"; anything else - a real hotel, or no hotel at all (the
-- administration routes, the jobs) - is the real side.
-- -----------------------------------------------------------------------------
create or replace function app.view_side()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.id from hotels h
   where h.code = upper(nullif(current_setting('app.hotel_code', true), ''))
     and h.test_of is not null
$$;

comment on function app.view_side() is
  'D27-296: the test hotel in the address, or null - the real side.';

-- Somebody with a real hotel to work at, or a group administrator.
create or replace function app.has_real_hotel()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff s
     where s.id = app.current_user_id() and s.is_active and s.is_group_admin
  ) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
      join hotels h on h.id = sh.hotel_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and h.test_of is null
  )
$$;

-- May the person read the side in view? The test side: only who has that test
-- hotel. The real side: only who has a real hotel, or a group administrator.
create or replace function app.sees_view_side()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when app.view_side() is null then app.has_real_hotel()
    else app.view_side() in (select app.auth_hotel_ids())
  end
$$;

-- For the definer functions, which bypass row security: is this row's side the
-- one in view, and may the caller read it?
create or replace function app.on_my_side(p_test_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_test_hotel is not distinct from app.view_side() and app.sees_view_side()
$$;


-- =============================================================================
-- 3 · TEST-ONLY PEOPLE (2, 6, 10)
-- =============================================================================
alter table staff add column if not exists test_only boolean not null default false;

comment on column staff.test_only is
  'D27-296 (6): added with Test on - works only in test hotels, never a real one.';

alter table staff drop constraint if exists staff_test_only_not_group_admin;
alter table staff add constraint staff_test_only_not_group_admin
  check (not (test_only and is_group_admin));

create or replace function app.staff_hotels_test_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hotel uuid := case when tg_op = 'DELETE' then old.hotel_id else new.hotel_id end;
  v_staff uuid := case when tg_op = 'DELETE' then old.staff_id else new.staff_id end;
  v_test  boolean := app.is_test_hotel(v_hotel);
  v_name  text;
begin
  -- (10) the owner and the group administrators add people to a test hotel.
  -- Nobody signed in is a migration or a script, as everywhere in this schema.
  if v_test and app.current_user_id() is not null and not app.is_group_admin() then
    raise exception 'Only the owner or a group administrator gives somebody a test hotel, or takes it away.'
      using errcode = 'insufficient_privilege';
  end if;

  -- (6) a person added with Test on never works at a real hotel.
  if tg_op <> 'DELETE' and not v_test then
    select full_name into v_name from staff where id = v_staff and test_only;
    if found then
      raise exception '% was added for testing, and works only in test hotels.', v_name
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists staff_hotels_test_rules on staff_hotels;
create trigger staff_hotels_test_rules
  before insert or update or delete on staff_hotels
  for each row execute function app.staff_hotels_test_rules();

-- Whether somebody is test-only is the owner's or a group administrator's call.
create or replace function app.staff_test_only_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.test_only is distinct from old.test_only
     and app.current_user_id() is not null and not app.is_group_admin() then
    raise exception 'Only the owner or a group administrator changes whether somebody is a tester.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.test_only and not old.test_only and exists (
       select 1 from staff_hotels sh join hotels h on h.id = sh.hotel_id
        where sh.staff_id = new.id and h.test_of is null) then
    raise exception '% works at a real hotel, so cannot be made test-only.', new.full_name
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists staff_test_only_rules on staff;
create trigger staff_test_only_rules
  before update of test_only on staff
  for each row execute function app.staff_test_only_rules();


-- =============================================================================
-- 4 · THE GROUP'S GUEST DATA, IN TWO SIDES (5)
-- =============================================================================
-- Guests, companies, booking groups and the offer answers have no hotel: they
-- are the group's. A row made in a test hotel carries it in `test_hotel_id`,
-- filled by default from the hotel in view, so every way of making one - a
-- booking, a walk-in, a company typed at the desk - marks it without being
-- told. It never changes after.
-- -----------------------------------------------------------------------------
alter table guests              add column if not exists test_hotel_id uuid references hotels(id);
alter table companies           add column if not exists test_hotel_id uuid references hotels(id);
alter table reservation_groups  add column if not exists test_hotel_id uuid references hotels(id);
alter table offer_opt_ins       add column if not exists test_hotel_id uuid references hotels(id);
alter table offer_opt_outs      add column if not exists test_hotel_id uuid references hotels(id);

-- The default is set apart from the column so existing rows are not rewritten.
alter table guests              alter column test_hotel_id set default app.view_side();
alter table companies           alter column test_hotel_id set default app.view_side();
alter table reservation_groups  alter column test_hotel_id set default app.view_side();
alter table offer_opt_ins       alter column test_hotel_id set default app.view_side();
alter table offer_opt_outs      alter column test_hotel_id set default app.view_side();

create index if not exists guests_test_hotel_idx on guests (test_hotel_id)
  where test_hotel_id is not null;
create index if not exists companies_test_hotel_idx on companies (test_hotel_id)
  where test_hotel_id is not null;
create index if not exists reservation_groups_test_hotel_idx on reservation_groups (test_hotel_id)
  where test_hotel_id is not null;

create or replace function app.guest_on_my_side(p_guest uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from guests g where g.id = p_guest
                    and g.test_hotel_id is not distinct from app.view_side())
     and app.sees_view_side()
$$;

-- A "no offers" said in a test hotel is not the real guest's answer: one per
-- address on EACH side (a null side is one side, not many).
alter table offer_opt_outs drop constraint if exists offer_opt_outs_once;
drop index if exists offer_opt_outs_once_a_side;
create unique index offer_opt_outs_once_a_side
  on offer_opt_outs (kind, value, test_hotel_id) nulls not distinct;
alter table offer_opt_ins drop constraint if exists offer_opt_ins_once;
drop index if exists offer_opt_ins_once_a_side;
create unique index offer_opt_ins_once_a_side
  on offer_opt_ins (kind, value, test_hotel_id) nulls not distinct;

create or replace function app.test_side_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_other uuid;
begin
  if tg_op = 'UPDATE' and new.test_hotel_id is distinct from old.test_hotel_id then
    raise exception 'A record made in a test hotel stays there, and a real one never moves into one.'
      using errcode = 'check_violation';
  end if;
  if new.test_hotel_id is not null and not app.is_test_hotel(new.test_hotel_id) then
    raise exception 'Only a test hotel''s own records are marked with it.'
      using errcode = 'check_violation';
  end if;

  -- What a record points at is on its own side too. Read through jsonb:
  -- PL/pgSQL resolves every field it names when it plans an expression, and
  -- each of these columns is on one table only.
  if tg_table_name = 'guests' and v_row ->> 'joined_into' is not null then
    select test_hotel_id into v_other from guests where id = (v_row ->> 'joined_into')::uuid;
    if v_other is distinct from new.test_hotel_id then
      raise exception 'A guest is joined only to a guest on the same side - test with test, real with real.'
        using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'reservation_groups' then
    if v_row ->> 'company_id' is not null then
      select test_hotel_id into v_other from companies where id = (v_row ->> 'company_id')::uuid;
      if v_other is distinct from new.test_hotel_id then
        raise exception 'A test hotel works only with the guests and companies made in it.'
          using errcode = 'check_violation';
      end if;
    end if;
    if v_row ->> 'lead_hotel_id' is not null
       and (case when app.is_test_hotel((v_row ->> 'lead_hotel_id')::uuid)
                 then (v_row ->> 'lead_hotel_id')::uuid end)
           is distinct from new.test_hotel_id then
      raise exception 'A group made in a test hotel books only there.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guests_test_side on guests;
create trigger guests_test_side before insert or update on guests
  for each row execute function app.test_side_rules();
drop trigger if exists companies_test_side on companies;
create trigger companies_test_side before insert or update on companies
  for each row execute function app.test_side_rules();
drop trigger if exists reservation_groups_test_side on reservation_groups;
create trigger reservation_groups_test_side before insert or update on reservation_groups
  for each row execute function app.test_side_rules();
drop trigger if exists offer_opt_ins_test_side on offer_opt_ins;
create trigger offer_opt_ins_test_side before insert or update on offer_opt_ins
  for each row execute function app.test_side_rules();
drop trigger if exists offer_opt_outs_test_side on offer_opt_outs;
create trigger offer_opt_outs_test_side before insert or update on offer_opt_outs
  for each row execute function app.test_side_rules();

-- Two guests said to be one person, or not, are on one side.
create or replace function app.guest_pair_one_side()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_a uuid; v_b uuid; v_sa uuid; v_sb uuid;
begin
  if tg_table_name = 'guest_joins' then v_a := new.kept_id; v_b := new.joined_id;
  else v_a := new.a; v_b := new.b; end if;
  select test_hotel_id into v_sa from guests where id = v_a;
  select test_hotel_id into v_sb from guests where id = v_b;
  if v_sa is distinct from v_sb then
    raise exception 'A guest made in a test hotel is never matched with a real one.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists guest_joins_one_side on guest_joins;
create trigger guest_joins_one_side before insert or update of kept_id, joined_id on guest_joins
  for each row execute function app.guest_pair_one_side();
drop trigger if exists guest_not_same_one_side on guest_not_same;
create trigger guest_not_same_one_side before insert or update of a, b on guest_not_same
  for each row execute function app.guest_pair_one_side();


-- -----------------------------------------------------------------------------
-- The row policies, rebuilt. Every one that read "any active member of staff"
-- now reads "on the side in view, for somebody who may read that side". The
-- side functions are in sub-selects so they run once a statement, not a row.
-- -----------------------------------------------------------------------------
drop policy if exists guests_read   on guests;
drop policy if exists guests_insert on guests;
drop policy if exists guests_update on guests;
create policy guests_read on guests for select
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy guests_insert on guests for insert
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy guests_update on guests for update
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()))
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));

drop policy if exists companies_read   on companies;
drop policy if exists companies_write  on companies;
drop policy if exists companies_update on companies;
create policy companies_read on companies for select
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy companies_write on companies for insert
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy companies_update on companies for update
  using (app.keeps_companies()
         and test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()))
  with check (app.keeps_companies()
         and test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));

drop policy if exists staff_access on reservation_groups;
drop policy if exists rg_write     on reservation_groups;
drop policy if exists rg_update    on reservation_groups;
create policy staff_access on reservation_groups for select
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy rg_write on reservation_groups for insert
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy rg_update on reservation_groups for update
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()))
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));

drop policy if exists offer_opt_outs_read   on offer_opt_outs;
drop policy if exists offer_opt_outs_record on offer_opt_outs;
drop policy if exists offer_opt_outs_clear  on offer_opt_outs;
create policy offer_opt_outs_read on offer_opt_outs for select
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy offer_opt_outs_record on offer_opt_outs for insert
  with check (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy offer_opt_outs_clear on offer_opt_outs for delete
  using (app.is_crm_manager()
         and test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));

drop policy if exists offer_opt_ins_read  on offer_opt_ins;
drop policy if exists offer_opt_ins_clear on offer_opt_ins;
create policy offer_opt_ins_read on offer_opt_ins for select
  using (test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));
create policy offer_opt_ins_clear on offer_opt_ins for delete
  using (app.is_crm_manager()
         and test_hotel_id is not distinct from (select app.view_side()) and (select app.sees_view_side()));

-- An ID document follows its guest: the guest's own policy decides, asked
-- through the guests table inside these policies.
drop policy if exists gd_by_reservation        on guest_documents;
drop policy if exists gd_capture               on guest_documents;
drop policy if exists gd_update_by_reservation on guest_documents;
create policy gd_by_reservation on guest_documents for select
  using (exists (select 1 from reservations r
                  where r.guest_id = guest_documents.guest_id
                    and r.hotel_id in (select app.auth_hotel_ids()))
         and exists (select 1 from guests g where g.id = guest_documents.guest_id));
create policy gd_capture on guest_documents for insert
  with check (app.is_active_staff()
              and exists (select 1 from guests g where g.id = guest_documents.guest_id));
create policy gd_update_by_reservation on guest_documents for update
  using (exists (select 1 from reservations r
                  where r.guest_id = guest_documents.guest_id
                    and r.hotel_id in (select app.auth_hotel_ids()))
         and exists (select 1 from guests g where g.id = guest_documents.guest_id))
  with check (exists (select 1 from reservations r
                  where r.guest_id = guest_documents.guest_id
                    and r.hotel_id in (select app.auth_hotel_ids()))
         and exists (select 1 from guests g where g.id = guest_documents.guest_id));

drop policy if exists guest_joins_managers on guest_joins;
create policy guest_joins_managers on guest_joins for select
  using (app.is_crm_manager() and exists (select 1 from guests g where g.id = guest_joins.kept_id));
drop policy if exists guest_not_same_managers on guest_not_same;
create policy guest_not_same_managers on guest_not_same for select
  using (app.is_crm_manager() and exists (select 1 from guests g where g.id = guest_not_same.a));

-- Loyalty is read group-wide, for whoever reads the guest.
drop policy if exists loyalty_members_read on loyalty_members;
create policy loyalty_members_read on loyalty_members for select
  using (exists (select 1 from guests g where g.id = loyalty_members.guest_id));
drop policy if exists loyalty_points_read on loyalty_points;
create policy loyalty_points_read on loyalty_points for select
  using (exists (select 1 from loyalty_members m where m.id = loyalty_points.member_id));

-- The audit of the group's tables (no hotel) carries guests' details: the
-- real side's rows are read by the real side only. A test hotel's own rows
-- (write_audit, below, files them under it) are read by who has it.
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select
  using ((hotel_id is null and (select app.view_side()) is null and (select app.has_real_hotel()))
         or hotel_id in (select app.auth_hotel_ids()));

-- The group's reference lists: a test-only person reads them and never writes
-- them. Restrictive, so they narrow every write policy these tables have.
do $$
declare t text;
begin
  foreach t in array array['booking_sources', 'sales_people', 'vip_levels', 'meal_plans',
                           'amenities', 'group_settings', 'room_type_templates'] loop
    execute format('drop policy if exists %I on public.%I', t || '_real_people_add', t);
    execute format('drop policy if exists %I on public.%I', t || '_real_people_change', t);
    execute format('drop policy if exists %I on public.%I', t || '_real_people_remove', t);
    execute format('create policy %I on public.%I as restrictive for insert with check (app.has_real_hotel())',
                   t || '_real_people_add', t);
    execute format('create policy %I on public.%I as restrictive for update using (app.has_real_hotel()) with check (app.has_real_hotel())',
                   t || '_real_people_change', t);
    execute format('create policy %I on public.%I as restrictive for delete using (app.has_real_hotel())',
                   t || '_real_people_remove', t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- The mixing guard: a row at a hotel points only at guests, companies and
-- booking groups of its own side. Attached from the catalog to EVERY table
-- that has hotel_id and a foreign key to one of the three - and
-- db/tests/modules/test-hotels.sql fails when a later table has the key and
-- not this trigger.
-- -----------------------------------------------------------------------------
create or replace function app.keep_sides()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_side uuid;
  v_ref  uuid;
  v_ref_side uuid;
  i int := 0;
begin
  select case when h.test_of is not null then h.id end into v_side
    from hotels h where h.id = nullif(v_row ->> 'hotel_id', '')::uuid;

  while i + 1 < tg_nargs loop
    v_ref := nullif(v_row ->> tg_argv[i], '')::uuid;
    if v_ref is not null then
      execute format('select test_hotel_id from public.%I where id = $1', tg_argv[i + 1])
         into v_ref_side using v_ref;
      -- A row that does not exist is the foreign key's to refuse.
      if found and v_ref_side is distinct from v_side then
        if v_side is null then
          raise exception 'A real hotel works only with real guests and companies, never with ones made in a test hotel.'
            using errcode = 'check_violation';
        else
          raise exception 'A test hotel works only with the guests and companies made in it.'
            using errcode = 'check_violation';
        end if;
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;

do $$
declare r record;
begin
  for r in
    select c.relname as tbl,
           array_agg(a.attname::text order by a.attname) as cols,
           array_agg(f.relname::text order by a.attname) as refs
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_class f on f.oid = k.confrelid
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
     where k.contype = 'f'
       and array_length(k.conkey, 1) = 1
       and f.relname in ('guests', 'companies', 'reservation_groups')
       and c.relnamespace = 'public'::regnamespace
       and exists (select 1 from pg_attribute h
                    where h.attrelid = c.oid and h.attname = 'hotel_id' and not h.attisdropped)
     group by c.relname
  loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_keeps_sides', r.tbl);
    execute format(
      'create trigger %I before insert or update of hotel_id, %s on public.%I '
      'for each row execute function app.keep_sides(%s)',
      r.tbl || '_keeps_sides',
      (select string_agg(quote_ident(x), ', ') from unnest(r.cols) x),
      r.tbl,
      (select string_agg(quote_literal(x) || ', ' || quote_literal(y), ', ')
         from unnest(r.cols, r.refs) as u(x, y)));
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- The functions that read the group's guests past row security: each now
-- answers only on the side in view.
-- -----------------------------------------------------------------------------
create or replace function app.guest_search(p_q text)
returns table (id uuid, full_name text, phone text, email text, visits integer, is_blacklisted boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id, g.full_name, g.phone, g.email::text, app.guest_visits(g.id), g.is_blacklisted
    from guests g
   where g.joined_into is null
     and app.is_crm_manager()
     and g.test_hotel_id is not distinct from (select app.view_side())
     and (select app.sees_view_side())
     and length(btrim(coalesce(p_q, ''))) >= 2
     and (   g.full_name ilike '%' || btrim(p_q) || '%'
          or app.phone_key(g.phone) = app.phone_key(p_q)
          or app.email_key(g.email::text) = app.email_key(p_q))
   order by g.full_name, g.id
   limit 50
$$;

create or replace function app.guest_cards(p_ids uuid[])
returns table (id uuid, full_name text, phone text, email text, visits integer, has_id boolean,
               is_vip boolean, is_blacklisted boolean, blacklist_reason text, last_stay text,
               joined_into uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id, g.full_name, g.phone, g.email::text, app.guest_visits(g.id),
         exists (select 1 from guest_documents d where d.guest_id = g.id),
         g.is_vip, g.is_blacklisted, g.blacklist_reason,
         (select max(r.check_out)::text from reservations r
           where r.guest_id = g.id and r.status in ('checked_in', 'checked_out')),
         g.joined_into
    from guests g
   where g.id = any (p_ids)
     and app.is_crm_manager()
     and g.test_hotel_id is not distinct from (select app.view_side())
     and (select app.sees_view_side())
$$;

create or replace function app.guest_suggestions(p_phone text, p_email text)
returns table (guest_id uuid, full_name text, visits integer, is_blacklisted boolean,
               blacklist_reason text, suggested boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive
  typed as (
    select app.phone_key(p_phone) as phone, app.email_key(p_email) as email
  ),
  hit as (
    select distinct app.guest_standing(g.id) as person
      from guests g, typed t
     where ((t.phone is not null and app.phone_key(g.phone) = t.phone)
         or (t.email is not null and app.email_key(g.email::text) = t.email))
       and g.test_hotel_id is not distinct from (select app.view_side())
       and (select app.sees_view_side())
  ),
  family(person, id) as (
    select person, person from hit
    union
    select f.person, g.id from family f join guests g on g.joined_into = f.id
  ),
  known as (
    select f.person,
           bool_or(app.phone_key(g.phone) is not null)                         as has_phone,
           bool_or(app.phone_key(g.phone) = t.phone)                           as phone_on_file,
           bool_or(app.email_key(g.email::text) is not null)                   as has_email,
           bool_or(app.email_key(g.email::text) = t.email)                     as email_on_file
      from family f
      join guests g on g.id = f.id
     cross join typed t
     group by f.person
  )
  select p.id, p.full_name, app.guest_visits(p.id), p.is_blacklisted, p.blacklist_reason,
         not (   (t.phone is not null and k.has_phone and not coalesce(k.phone_on_file, false))
              or (t.email is not null and k.has_email and not coalesce(k.email_on_file, false)))
    from known k
    join guests p on p.id = k.person
   cross join typed t
$$;

create or replace function app.same_person_pairs()
returns table (a uuid, b uuid, same_phone boolean, same_email boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with keyed as (
    select id, app.phone_key(phone) as p, app.email_key(email::text) as e
      from guests
     where joined_into is null
       and test_hotel_id is not distinct from (select app.view_side())
       and (select app.sees_view_side())
  ),
  pairs as (
    select x.id as a, y.id as b from keyed x join keyed y on y.p = x.p and x.id < y.id
    union
    select x.id, y.id from keyed x join keyed y on y.e = x.e and x.id < y.id
  ),
  answered as (
    select least(s.a, s.b) as a, greatest(s.a, s.b) as b
      from (select app.guest_standing(n.a) as a, app.guest_standing(n.b) as b
              from guest_not_same n
             where n.undone_at is null) s
  )
  select pr.a, pr.b,
         coalesce(x.p = y.p, false), coalesce(x.e = y.e, false)
    from pairs pr
    join keyed x on x.id = pr.a
    join keyed y on y.id = pr.b
   where app.is_crm_manager()
     and not exists (select 1 from answered d where d.a = pr.a and d.b = pr.b)
$$;

create or replace function app.guest_360(p_guest uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive
  person as (
    select g.* from guests g
     where g.id = app.guest_standing(p_guest)
       and app.is_crm_manager()
       and g.test_hotel_id is not distinct from (select app.view_side())
       and (select app.sees_view_side())
  ),
  family(id) as (
    select id from person
    union
    select g.id from family f join guests g on g.joined_into = f.id
  ),
  phones as (
    select distinct app.phone_key(g.phone) as k
      from family f join guests g on g.id = f.id
     where app.phone_key(g.phone) is not null
  ),
  emails as (
    select distinct app.email_key(g.email::text) as k
      from family f join guests g on g.id = f.id
     where app.email_key(g.email::text) is not null
  ),
  stays as (
    select r.id, r.check_in, r.check_out, r.status, r.group_id,
           h.code as hotel_code, h.name as hotel_name, r.reference,
           rt.name as room_type,
           app.booking_source_label(bs.name, co.name, r.source) as source,
           co.name as company,
           app.stay_charged(r.id) as charged
      from person p
      join reservations r on r.guest_id = p.id
      join hotels h on h.id = r.hotel_id
      left join room_types rt on rt.id = r.room_type_id
      left join booking_sources bs on bs.id = r.booking_source_id
      left join companies co on co.id = r.company_id
  ),
  sent as (
    select m.sent_at, m.channel, m.kind, m.status, h.name as hotel_name
      from messages_sent m
      join hotels h on h.id = m.hotel_id
     where ((m.about_kind = 'reservation' and m.about_id in (select id::text from stays))
        or app.phone_key(m.to_phone) in (select k from phones)
        or app.email_key(m.to_email) in (select k from emails))
       -- the same phone at a hotel on the other side is another person's
       and (case when h.test_of is null then null else h.id end)
           is not distinct from (select app.view_side())
  )
  select jsonb_build_object(
    'id', p.id,
    'name', p.full_name,
    'phone', p.phone,
    'email', p.email::text,
    'nationality', p.nationality,
    'isVip', p.is_vip,
    'isBlacklisted', p.is_blacklisted,
    'blacklistReason', p.blacklist_reason,
    'hasId', exists (select 1 from guest_documents d where d.guest_id in (select id from family)),
    'companies', coalesce((select jsonb_agg(distinct s.company) from stays s where s.company is not null), '[]'),
    'visits', app.guest_visits(p.id),
    'nights', coalesce((select sum(greatest(s.check_out - s.check_in, 0))::int from stays s
                         where s.status in ('checked_in', 'checked_out')), 0),
    'charged', coalesce((select sum(s.charged) from stays s), 0),
    'firstStay', (select min(s.check_in)::text from stays s where s.status in ('checked_in', 'checked_out')),
    'lastStay', (select max(s.check_out)::text from stays s where s.status in ('checked_in', 'checked_out')),
    'stays', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'hotelCode', s.hotel_code, 'hotelName', s.hotel_name,
               'reference', s.reference, 'checkIn', s.check_in::text,
               'checkOut', s.check_out::text, 'status', s.status,
               'roomType', s.room_type, 'source', s.source, 'charged', s.charged)
             order by s.check_in desc, s.reference)
        from stays s), '[]'),
    'sent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'at', m.sent_at, 'channel', m.channel, 'kind', m.kind,
               'status', m.status, 'hotelName', m.hotel_name)
             order by m.sent_at desc)
        from sent m), '[]'),
    'noOffers', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'value', o.value,
                                          'at', o.recorded_at) order by o.recorded_at)
        from offer_opt_outs o
       where ((o.kind = 'phone' and o.value in (select k from phones))
          or (o.kind = 'email' and o.value in (select k from emails)))
         and o.test_hotel_id is not distinct from (select app.view_side())), '[]'),
    'joined', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'guestId', j.joined_id,
                                          'name', g.full_name, 'at', j.joined_at)
             order by j.joined_at desc)
        from guest_joins j join guests g on g.id = j.joined_id
       where j.kept_id = p.id and j.undone_at is null), '[]')
  )
  from person p
$$;

create or replace function app.guest_join(p_kept uuid, p_joined uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_kept   guests;
  v_joined guests;
  v_ids    uuid[];
  v_before jsonb;
  v_after  jsonb;
  v_join   uuid;
begin
  if not app.is_crm_manager() then
    raise exception 'Joining two guests is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;
  if p_kept is null or p_joined is null or p_kept = p_joined then
    raise exception 'Choose two different guests to join.';
  end if;
  -- D27-296: only guests on the side in view are anybody's here to join.
  if not (app.guest_on_my_side(p_kept) and app.guest_on_my_side(p_joined)) then
    raise exception 'One of those guests does not exist.';
  end if;

  -- Both rows locked, in a fixed order, so two managers joining the same pair
  -- at once cannot each move half of it.
  perform 1 from guests where id in (p_kept, p_joined) order by id for update;
  select * into v_kept   from guests where id = p_kept;
  select * into v_joined from guests where id = p_joined;
  if v_kept.id is null or v_joined.id is null then
    raise exception 'One of those guests does not exist.';
  end if;
  if v_kept.joined_into is not null or v_joined.joined_into is not null then
    raise exception 'One of those records was already joined to another guest. Start from the one that stands.';
  end if;

  if exists (select 1 from guest_documents where guest_id = p_joined)
     and not exists (select 1 from guest_documents where guest_id = p_kept) then
    raise exception 'Only % has an ID on file. Keep that record, so the ID stays with the guest.',
      v_joined.full_name;
  end if;

  select coalesce(array_agg(id order by id), '{}') into v_ids
    from reservations where guest_id = p_joined;

  update reservations set guest_id = p_kept where guest_id = p_joined;

  v_before := jsonb_build_object(
    'is_vip', v_kept.is_vip,
    'is_blacklisted', v_kept.is_blacklisted,
    'blacklist_reason', v_kept.blacklist_reason);
  v_after := jsonb_build_object(
    'is_vip', v_kept.is_vip or v_joined.is_vip,
    'is_blacklisted', v_kept.is_blacklisted or v_joined.is_blacklisted,
    'blacklist_reason', case when v_kept.is_blacklisted   then v_kept.blacklist_reason
                             when v_joined.is_blacklisted then v_joined.blacklist_reason
                             else v_kept.blacklist_reason end);

  if v_after is distinct from v_before then
    update guests
       set is_vip           = (v_after ->> 'is_vip')::boolean,
           is_blacklisted   = (v_after ->> 'is_blacklisted')::boolean,
           blacklist_reason = v_after ->> 'blacklist_reason'
     where id = p_kept;
  end if;

  update guests set joined_into = p_kept where id = p_joined;

  insert into guest_joins (kept_id, joined_id, reservation_ids, kept_before, kept_after, joined_by)
  values (p_kept, p_joined, v_ids, v_before, v_after, app.current_user_id())
  returning id into v_join;

  return v_join;
end
$$;

create or replace function app.guest_join_undo(p_join uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_join guest_joins;
  v_kept guests;
begin
  if not app.is_crm_manager() then
    raise exception 'Undoing a join is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;

  select * into v_join from guest_joins where id = p_join for update;
  -- D27-296: a join on the other side is not one there is.
  if v_join.id is null or not app.guest_on_my_side(v_join.kept_id) then
    raise exception 'There is no such join.';
  end if;
  if v_join.undone_at is not null then
    raise exception 'That join was already undone.';
  end if;

  select * into v_kept from guests where id = v_join.kept_id for update;
  if v_kept.joined_into is not null then
    raise exception '% was joined into another guest after this. Undo that join first.',
      v_kept.full_name;
  end if;

  update reservations set guest_id = v_join.joined_id
   where id = any (v_join.reservation_ids) and guest_id = v_join.kept_id;

  update guests set joined_into = null where id = v_join.joined_id;

  -- Put the marks back only where they are still what the join left them.
  update guests
     set is_vip = (v_join.kept_before ->> 'is_vip')::boolean
   where id = v_join.kept_id
     and is_vip = (v_join.kept_after ->> 'is_vip')::boolean
     and is_vip is distinct from (v_join.kept_before ->> 'is_vip')::boolean;
  update guests
     set is_blacklisted   = (v_join.kept_before ->> 'is_blacklisted')::boolean,
         blacklist_reason = v_join.kept_before ->> 'blacklist_reason'
   where id = v_join.kept_id
     and is_blacklisted = (v_join.kept_after ->> 'is_blacklisted')::boolean
     and blacklist_reason is not distinct from v_join.kept_after ->> 'blacklist_reason'
     and (is_blacklisted, blacklist_reason) is distinct from
         ((v_join.kept_before ->> 'is_blacklisted')::boolean, v_join.kept_before ->> 'blacklist_reason');

  update guest_joins
     set undone_by = app.current_user_id(), undone_at = now()
   where id = p_join;
end
$$;

create or replace function app.guest_not_same(p_a uuid, p_b uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_standing int;
begin
  if not app.is_crm_manager() then
    raise exception 'Saying two guests are not the same person is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;
  if p_a is null or p_b is null or p_a = p_b then
    raise exception 'Choose two different guests.';
  end if;
  -- D27-296: both on the side in view.
  if not (app.guest_on_my_side(p_a) and app.guest_on_my_side(p_b)) then
    raise exception 'One of those records is not a guest that stands. Start from the list as it is now.';
  end if;

  select count(*) into v_standing
    from guests where id in (p_a, p_b) and joined_into is null;
  if v_standing < 2 then
    raise exception 'One of those records is not a guest that stands. Start from the list as it is now.';
  end if;

  insert into guest_not_same (a, b, said_by)
  values (least(p_a, p_b), greatest(p_a, p_b), app.current_user_id())
  on conflict (a, b) where undone_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from guest_not_same
     where a = least(p_a, p_b) and b = greatest(p_a, p_b) and undone_at is null;
  end if;
  return v_id;
end
$$;

create or replace function app.guest_not_same_undo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row guest_not_same;
begin
  if not app.is_crm_manager() then
    raise exception 'Undoing that is for the owner, an administrator or a general manager.'
      using errcode = '42501';
  end if;

  select * into v_row from guest_not_same where id = p_id for update;
  if v_row.id is null or not app.guest_on_my_side(v_row.a) then
    raise exception 'There is no such answer.';
  end if;
  if v_row.undone_at is not null then
    raise exception 'That was already undone.';
  end if;

  update guest_not_same
     set undone_by = app.current_user_id(), undone_at = now()
   where id = p_id;
end
$$;

-- The offer answers: each side keeps its own; a yes said in a test hotel never
-- clears a real guest's no.
create or replace function app.record_no_offers(p_phone text, p_email text)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  v_rows int;
begin
  if app.phone_key(p_phone) is not null then
    delete from offer_opt_ins where kind = 'phone' and value = app.phone_key(p_phone)
       and test_hotel_id is not distinct from app.view_side();
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('phone', app.phone_key(p_phone), app.current_user_id())
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  if app.email_key(p_email) is not null then
    delete from offer_opt_ins where kind = 'email' and value = app.email_key(p_email)
       and test_hotel_id is not distinct from app.view_side();
    insert into offer_opt_outs (kind, value, recorded_by)
    values ('email', app.email_key(p_email), app.current_user_id())
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end if;
  return v_n;
end
$$;

create or replace function app.record_offers_yes(p_phone text, p_email text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n int := 0;
  v_rows int;
  v_key record;
begin
  for v_key in
    select 'phone' as kind, app.phone_key(p_phone) as value
    union all
    select 'email', app.email_key(p_email)
  loop
    continue when v_key.value is null;
    delete from offer_opt_outs where kind = v_key.kind and value = v_key.value
       and test_hotel_id is not distinct from app.view_side();
    insert into offer_opt_ins (kind, value, recorded_by, test_hotel_id)
    values (v_key.kind, v_key.value, app.current_user_id(), app.view_side())
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
  end loop;
  return v_n;
end
$$;

-- Loyalty: not used in a test hotel at all (4, 11), and a guest's card is read
-- only on the guest's side.
create or replace function app.loyalty_card(p_guest uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'member', (select jsonb_build_object('since', m.joined_at, 'hotelName', h.name)
                 from loyalty_members m join hotels h on h.id = m.hotel_id
                where m.id = app.loyalty_member(p_guest)),
    'points', app.loyalty_balance(p_guest),
    'statement', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', lp.id, 'kind', lp.kind, 'points', lp.points, 'reason', lp.reason,
               'at', lp.recorded_at, 'hotelName', h.name, 'reference', r.reference,
               'undone', lp.kind = 'redeem' and exists (
                 select 1 from folio_postings rev where rev.reverses_id = lp.folio_posting_id))
             order by lp.recorded_at desc, lp.id desc)
        from loyalty_points lp
        join loyalty_members m on m.id = lp.member_id
        join hotels h on h.id = lp.hotel_id
        left join reservations r on r.id = lp.reservation_id
       where app.guest_standing(m.guest_id) = app.guest_standing(p_guest)), '[]'))
   where app.is_crm_manager()
     and app.guest_on_my_side(p_guest)
$$;

create or replace function app.loyalty_by_hotel(p_month date)
returns table (hotel_code text, hotel_name text, earned bigint, used bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.code, h.name,
         coalesce(sum(lp.points) filter (where lp.kind = 'earn'), 0),
         coalesce(-sum(lp.points) filter (where lp.kind = 'redeem' and not exists (
           select 1 from folio_postings rev where rev.reverses_id = lp.folio_posting_id)), 0)
    from loyalty_points lp
    join hotels h on h.id = lp.hotel_id
   where app.is_crm_manager()
     and h.test_of is null
     and date_trunc('month', app.hotel_day(lp.hotel_id, lp.recorded_at)) = date_trunc('month', p_month)
   group by h.code, h.name
   order by h.code
$$;

create or replace function app.loyalty_adjust(p_hotel uuid, p_guest uuid, p_points integer, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m uuid; bal int;
begin
  if p_hotel is null or p_hotel not in (select app.auth_hotel_ids()) then return 'No such property.'; end if;
  if app.is_test_hotel(p_hotel) then return 'This is a test hotel: loyalty is not used here.'; end if;
  if not app.guest_on_my_side(p_guest) then return 'This guest is not a member.'; end if;
  if not app.is_crm_manager() then
    return 'Points are added or taken by the owner, an administrator or the general manager.';
  end if;
  m := app.loyalty_member(p_guest);
  if m is null then return 'This guest is not a member.'; end if;
  if p_points is null or p_points = 0 then return 'How many points?'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then return 'Say why. The reason stays on the statement.'; end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || app.guest_standing(p_guest)));
  bal := app.loyalty_balance(p_guest);
  if bal + p_points < 0 then return format('The guest has %s points; a balance cannot go below 0.', bal); end if;
  insert into loyalty_points (member_id, hotel_id, kind, points, reason, recorded_by)
  values (m, p_hotel, 'adjust', p_points, btrim(p_reason), app.current_user_id());
  return null;
end
$$;

create or replace function app.loyalty_leave(p_hotel uuid, p_guest uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m uuid; bal int;
begin
  if p_hotel is null or p_hotel not in (select app.auth_hotel_ids()) then return 'No such property.'; end if;
  if app.is_test_hotel(p_hotel) then return 'This is a test hotel: loyalty is not used here.'; end if;
  if not app.guest_on_my_side(p_guest) then return 'This guest is not a member.'; end if;
  m := app.loyalty_member(p_guest);
  if m is null then return 'This guest is not a member.'; end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || app.guest_standing(p_guest)));
  bal := app.loyalty_balance(p_guest);
  if bal > 0 then
    insert into loyalty_points (member_id, hotel_id, kind, points, reason, recorded_by)
    values (m, p_hotel, 'lapse', -bal, 'Left the programme', app.current_user_id());
  end if;
  update loyalty_members set left_at = now(), left_by = app.current_user_id(), left_hotel_id = p_hotel
   where left_at is null and app.guest_standing(guest_id) = app.guest_standing(p_guest);
  return null;
end
$$;


-- =============================================================================
-- 5 · NOTHING LEAVES A TEST HOTEL (4)
-- =============================================================================
-- One refusal for everything that would reach outside, or into the group's
-- real programmes, from a test hotel. Loyalty and the channel manager are off
-- unless switched on, so refusing the switch keeps them off (and the copy
-- leaves the real hotel's switch for them behind).
create or replace function app.refuse_in_test_hotel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'hotel_modules' then
    if new.is_enabled and new.module in ('loyalty', 'channel_manager')
       and app.is_test_hotel(new.hotel_id) then
      raise exception 'This is a test hotel: % cannot be switched on here.',
        case new.module when 'loyalty' then 'loyalty' else 'the channel manager' end
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Through jsonb: PL/pgSQL resolves every field it names when it plans the
  -- expression, and only loyalty_members has left_hotel_id.
  if app.is_test_hotel(new.hotel_id)
     or app.is_test_hotel(nullif(to_jsonb(new) ->> 'left_hotel_id', '')::uuid) then
    raise exception '%', case
      when tg_table_name in ('loyalty_members', 'loyalty_points')
        then 'This is a test hotel: loyalty is not used here.'
      else 'This is a test hotel: nothing is sent from it.' end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  -- SU and the CRS (their connections), rivals' prices, the daily report
  -- emails, and loyalty's two tables.
  foreach t in array array['channel_hotels', 'crs_hotels', 'market_rate_settings',
                           'daily_report_emails', 'loyalty_members', 'loyalty_points',
                           'hotel_modules'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_not_in_test_hotels', t);
    execute format('create trigger %I before insert or update on public.%I '
                   'for each row execute function app.refuse_in_test_hotel()',
                   t || '_not_in_test_hotels', t);
  end loop;
end $$;

-- Is this guest's link a test hotel's? For the guest's door, which knows only
-- the link (DigiLocker reaches outside).
create or replace function app.guest_link_is_test(p_token_hash text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from guest_links l join hotels h on h.id = l.hotel_id
                  where l.token_hash = p_token_hash and h.test_of is not null)
$$;

-- Is this booking at a test hotel? For the voucher, drawn with nobody signed in.
create or replace function app.reservation_is_test(p_reservation uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from reservations r join hotels h on h.id = r.hotel_id
                  where r.id = p_reservation and h.test_of is not null)
$$;


-- =============================================================================
-- 6 · THE RESET'S WAY PAST THE GUARDS (3)
-- =============================================================================
-- A guard refuses a delete because a real hotel's record is evidence. A test
-- hotel's is not, during its own reset or re-copy and then only: the setting
-- below is transaction-local, set by the reset functions, and every guard asks
-- app.is_test_hotel too - a real hotel's row is never let through, whoever
-- sets what.
-- -----------------------------------------------------------------------------
create or replace function app.test_reset_allows(p_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_hotel is not null
     and coalesce(current_setting('app.test_reset', true), '') = p_hotel::text
     and exists (select 1 from hotels where id = p_hotel and test_of is not null)
$$;

create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  -- D27-296: a test hotel's own ledger, during its reset.
  if tg_op = 'DELETE'
     and app.test_reset_allows(nullif(to_jsonb(old) ->> 'hotel_id', '')::uuid) then
    return old;
  end if;
  raise exception
    '% is append-only. Post a reversing entry instead of % on row %.',
    tg_table_name, tg_op, coalesce(old.id::text, '?')
    using hint = 'Insert a negative/reversing posting that references the original.';
end
$$;

create or replace function app.reject_invoice_change()
returns trigger
language plpgsql
as $$
begin
  -- D27-296: a test hotel's own documents (marked TEST · NOT VALID), during its reset.
  if tg_op = 'DELETE' and app.test_reset_allows(old.hotel_id) then
    return old;
  end if;
  raise exception
    'Invoice % cannot be % - an issued tax invoice is immutable.',
    coalesce(old.number, '?'),
    -- The whole word. `lower(tg_op)` gave "cannot be update", and a
    -- clever '%d' that appended the letter was worse: correct by
    -- accident and unreadable to whoever edits it next.
    case tg_op when 'UPDATE' then 'changed' else 'deleted' end
    using hint = 'Issue a credit note instead. It carries its own number.';
  return null;
end
$$;

create or replace function app.forbid_guest_delete()
returns trigger
language plpgsql
as $$
begin
  -- D27-296: a guest made in a test hotel goes with its reset.
  if app.test_reset_allows(old.test_hotel_id) then
    return old;
  end if;
  raise exception 'A guest is never deleted - stay history and the audit trail depend on the row.'
    using hint = 'Anonymise the identity documents instead, per the retention policy.';
end $$;

create or replace function app.pos_order_lines_frozen()
returns trigger
language plpgsql
as $$
declare st text;
begin
  -- D27-296: a test hotel's orders, paid or not, during its reset.
  if tg_op = 'DELETE' and app.test_reset_allows(old.hotel_id) then
    return old;
  end if;

  select status into st from pos_orders
   where id = coalesce(new.order_id, old.order_id);

  if st is distinct from 'open' then
    if tg_op = 'UPDATE'
       and to_jsonb(new) - 'kot_status' = to_jsonb(old) - 'kot_status' then
      return new;
    end if;
    raise exception
      'Order % is %, so its lines cannot change. Settle corrections with a '
      'credit on the folio, not by editing a paid bill.',
      coalesce(new.order_id, old.order_id), st
      using errcode = 'integrity_constraint_violation';
  end if;

  return coalesce(new, old);
end $$;

create or replace function app.pos_tender_settled_immutable()
returns trigger
language plpgsql
as $$
begin
  -- D27-296: a test hotel's settled bills, during its reset.
  if app.test_reset_allows(old.hotel_id) then
    return old;
  end if;
  if exists (select 1 from pos_orders
              where id = old.order_id and status = 'settled') then
    raise exception 'tenders on a settled order cannot be removed'
      using hint = 'Reverse the bill instead. How money was taken is evidence.';
  end if;
  return old;
end $$;

create or replace function app.pos_line_events_append_only()
returns trigger
language plpgsql
as $$
begin
  /* ⚠ A TIMING MAY GO WITH THE DISH IT DESCRIBES, AND ONLY THEN.
     By the time a cascade reaches here the parent line is already gone,
     which is how this tells "the dish was removed" from "somebody is
     erasing evidence of a slow pass".

     Written this way rather than blocking outright after the first
     version did: `delete from pos_orders` cascades to its lines and on
     to here, so every teardown in the suite and in api/test failed —
     and the fix of lifting a trigger in five places is five places to
     forget. The rule that survives is the narrower one, because it is
     the one that is actually true.

     Deleting the line itself is guarded separately, by
     `pos_order_lines_frozen`. */
  if tg_op = 'DELETE'
     and (not exists (select 1 from pos_order_lines where id = old.line_id)
          -- D27-296: a test hotel's kitchen timings, during its reset.
          or app.test_reset_allows(old.hotel_id))
  then
    return old;
  end if;

  raise exception 'A kitchen timing cannot be % - it is a record of what '
                  'happened.', lower(tg_op)
    using hint = 'Move the dish again. The new move is a new row, and both '
                 'stay visible.',
          errcode = 'restrict_violation';
end $$;

create or replace function app.payment_method_keeps_default()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_default text;
begin
  -- D27-296: a test hotel's setup is replaced whole by a re-copy.
  if tg_op = 'DELETE' and app.test_reset_allows(old.hotel_id) then
    return old;
  end if;
  select default_payment_method into v_default from hotels where id = old.hotel_id;
  if old.label is distinct from v_default then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' or not new.is_active then
    raise exception 'This is the default way of paying. Make another one the default first.'
      using errcode = 'check_violation';
  end if;
  if tg_when = 'AFTER' and new.label <> old.label then
    update hotels set default_payment_method = new.label where id = old.hotel_id;
  end if;
  return new;
end $$;

-- The audit: a test hotel's group rows (its guests, companies, ...) are filed
-- under it, so its testers read them and the real side does not; and a reset
-- writes ONE entry naming who, not one per row it clears.
create or replace function app.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hotel  uuid;
  v_row    text;
  v_before jsonb;
  v_after  jsonb;
begin
  -- ⚠ NEW is unassigned on DELETE and OLD is unassigned on INSERT. Touching
  --   the wrong one raises "record ... is not assigned yet" at runtime, so
  --   branch on TG_OP rather than relying on coalesce() to skip it.
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
  else                                            -- DELETE
    v_before := to_jsonb(old);
  end if;

  v_row   := coalesce(v_after ->> 'id', v_before ->> 'id');
  -- Group-level tables have no hotel_id; ->> simply yields null there, which
  -- is why this reads the jsonb rather than the record.
  v_hotel := nullif(coalesce(v_after ->> 'hotel_id', v_before ->> 'hotel_id'), '')::uuid;
  -- D27-296: a group row made in a test hotel belongs to it.
  if v_hotel is null then
    v_hotel := nullif(coalesce(v_after ->> 'test_hotel_id', v_before ->> 'test_hotel_id'), '')::uuid;
  end if;
  if v_hotel is null and tg_table_name = 'guest_documents' then
    select test_hotel_id into v_hotel from guests
     where id = nullif(coalesce(v_after ->> 'guest_id', v_before ->> 'guest_id'), '')::uuid;
  end if;
  if v_hotel is not null and app.test_reset_allows(v_hotel) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (v_hotel, app.current_user_id(), tg_table_name, v_row, tg_op, v_before, v_after);

  -- AFTER trigger: the return value is ignored, but it must not reference an
  -- unassigned record.
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$$;


-- =============================================================================
-- 7 · WHAT A TEST HOTEL COPIES, CLEARS AND NEVER TOUCHES (3, 7)
-- =============================================================================
-- EVERY table in the schema is in exactly one class - db/tests/modules/
-- test-hotels.sql fails on one that is not, so a table added later is decided
-- by whoever adds it:
--
--   setup    copied from the real hotel, with new ids and every key remapped
--   trading  test activity: cleared by a reset (children of a trading table
--            with no hotel_id of their own go with it by cascade)
--   never    hotel-scoped and neither: SU and CRS mappings and traffic, the
--            invoice and VAT series (the test hotel has its own), outside
--            devices, report email addresses, bank details, rivals' prices,
--            what was sent, the audit, who works there
--   group    the group's own tables, with no hotel: guests and companies are
--            split by test_hotel_id (section 4), the rest are shared lists or
--            the system's own
-- -----------------------------------------------------------------------------
create or replace function app.test_hotel_classes()
returns table (table_name text, class text)
language sql
immutable
as $$
  values
  -- setup ------------------------------------------------------------------
  ('room_types', 'setup'), ('rooms', 'setup'), ('room_type_amenities', 'setup'),
  ('room_type_photos', 'setup'), ('rates', 'setup'), ('rate_offsets', 'setup'),
  ('rate_plan_settings', 'setup'), ('rate_plan_sources', 'setup'),
  ('rate_restrictions', 'setup'), ('pricing_basis', 'setup'),
  ('booking_source_rates', 'setup'), ('room_promotions', 'setup'),
  ('cancellation_policies', 'setup'), ('inclusions', 'setup'),
  ('hotel_meal_days', 'setup'), ('hotel_holidays', 'setup'), ('tax_rules', 'setup'),
  ('tax_sac', 'setup'), ('payment_methods', 'setup'), ('hotel_lists', 'setup'),
  ('hotel_modules', 'setup'), ('hotel_texts', 'setup'), ('hotel_amenities', 'setup'),
  ('hotel_logos', 'setup'), ('hotel_photos', 'setup'), ('guest_message_settings', 'setup'),
  ('pos_outlets', 'setup'), ('pos_sections', 'setup'), ('pos_tables', 'setup'),
  ('pos_menu_categories', 'setup'), ('pos_menu_items', 'setup'),
  ('pos_item_variations', 'setup'), ('pos_addon_groups', 'setup'), ('pos_addons', 'setup'),
  ('pos_item_addon_groups', 'setup'), ('pos_numbered_addons', 'setup'),
  ('pos_kot_kinds', 'setup'), ('pos_promotions', 'setup'), ('locations', 'setup'),
  ('stock_items', 'setup'), ('stock_levels', 'setup'), ('suppliers', 'setup'),
  ('equipment_categories', 'setup'), ('laundry_price_items', 'setup'),
  ('spa_therapists', 'setup'), ('spa_treatments', 'setup'), ('banquet_venues', 'setup'),
  ('banquet_packages', 'setup'), ('approval_rules', 'setup'),
  ('purchase_requesters', 'setup'), ('review_links', 'setup'),
  -- trading ----------------------------------------------------------------
  ('reservations', 'trading'), ('reservation_inclusions', 'trading'),
  ('room_assignments', 'trading'), ('room_blocks', 'trading'),
  ('room_status_log', 'trading'), ('housekeeping_assignments', 'trading'),
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'),
  ('invoices', 'trading'), ('vat_bills', 'trading'), ('closed_day_corrections', 'trading'),
  ('night_audit_runs', 'trading'), ('form_c_filings', 'trading'),
  ('form_iii_stays', 'trading'), ('guest_links', 'trading'), ('guest_link_codes', 'trading'),
  ('guest_unlocks', 'trading'), ('guest_desk_replies', 'trading'),
  ('guest_detail_submissions', 'trading'), ('guest_digilocker_attempts', 'trading'),
  ('guest_food_orders', 'trading'), ('guest_id_photos', 'trading'),
  ('guest_id_photo_views', 'trading'), ('guest_requests', 'trading'),
  ('key_cards', 'trading'), ('wake_up_calls', 'trading'), ('lost_items', 'trading'),
  ('work_orders', 'trading'), ('work_order_costs', 'trading'), ('attachments', 'trading'),
  ('approvals', 'trading'), ('pos_orders', 'trading'), ('pos_order_lines', 'trading'),
  ('pos_order_tenders', 'trading'), ('pos_line_events', 'trading'),
  ('pos_tickets', 'trading'), ('pos_kot_prints', 'trading'), ('pos_bill_prints', 'trading'),
  ('pos_cash_movements', 'trading'), ('pos_day_ends', 'trading'),
  ('pos_denominations', 'trading'), ('cashier_shifts', 'trading'),
  ('cashier_movements', 'trading'), ('cashier_denominations', 'trading'),
  ('cashier_float_claims', 'trading'), ('cash_deposits', 'trading'),
  ('cash_deposit_notes', 'trading'), ('company_payments', 'trading'),
  ('credit_limit_allowances', 'trading'), ('contracts', 'trading'),
  ('contract_rates', 'trading'), ('banquet_events', 'trading'),
  ('banquet_event_packages', 'trading'), ('table_bookings', 'trading'),
  ('spa_appointments', 'trading'), ('laundry_dockets', 'trading'),
  ('laundry_docket_lines', 'trading'), ('loyalty_members', 'trading'),
  ('loyalty_points', 'trading'), ('stock_movements', 'trading'),
  ('stock_count_lines', 'trading'), ('purchase_requests', 'trading'),
  ('purchase_request_lines', 'trading'), ('equipment_items', 'trading'),
  ('equipment_history', 'trading'), ('equipment_moves', 'trading'),
  -- never ------------------------------------------------------------------
  ('staff_hotels', 'never'), ('channel_hotels', 'never'), ('channel_room_types', 'never'),
  ('channel_rate_plans', 'never'), ('channel_ari_sent', 'never'),
  ('channel_ari_pushes', 'never'), ('channel_bookings', 'never'), ('crs_hotels', 'never'),
  ('crs_room_types', 'never'), ('crs_bookings', 'never'), ('market_rate_settings', 'never'),
  ('market_rates', 'never'), ('daily_report_emails', 'never'), ('invoice_series', 'never'),
  ('vat_bill_series', 'never'), ('audit_log', 'never'), ('messages_sent', 'never'),
  ('hotel_bank_details', 'never'), ('pos_kot_stations', 'never'),
  -- group ------------------------------------------------------------------
  ('hotels', 'group'), ('staff', 'group'), ('guests', 'group'), ('companies', 'group'),
  ('reservation_groups', 'group'), ('guest_documents', 'group'), ('guest_joins', 'group'),
  ('guest_not_same', 'group'), ('offer_opt_ins', 'group'), ('offer_opt_outs', 'group'),
  ('guest_messaging_began', 'group'), ('meal_plans', 'group'), ('booking_sources', 'group'),
  ('sales_people', 'group'), ('vip_levels', 'group'), ('amenities', 'group'),
  ('group_settings', 'group'), ('room_type_templates', 'group'),
  ('provisioning_keys', 'group'), ('sign_ins', 'group'), ('telemetry_events', 'group'),
  ('telemetry_requests', 'group'), ('schema_migrations', 'group')
$$;

-- The property's own row: which of its columns a test hotel takes from the real
-- one. Its identity, its tax numbers and its date are its own.
create or replace function app.test_hotel_hotels_columns()
returns table (column_name text, copied boolean)
language sql
immutable
as $$
  values
  ('city', true), ('state', true), ('timezone', true), ('currency', true),
  ('check_in_time', true), ('check_out_time', true), ('address_line', true),
  ('phone', true), ('email', true), ('cgst_rate', true), ('sgst_rate', true),
  ('early_checkin_charge', true), ('late_checkout_charge', true),
  ('address_line_2', true), ('pin', true), ('website', true),
  ('reservations_phone', true), ('property_type', true), ('star_rating', true),
  ('latitude', true), ('longitude', true), ('reservations_contact', true),
  ('house_policies', true), ('food_cost_basis', true), ('default_payment_method', true),
  ('desk_may_overbook', true), ('advance_before_check_in', true), ('weekend_days', true),
  ('default_id_type', true), ('default_nationality', true), ('default_title', true),
  ('default_guarantee', true), ('default_bill_to', true), ('required_booking_fields', true),
  ('hk_dirty_after_move', true), ('hk_dirty_after_unblock', true),
  ('hk_stayover_dirty_at_audit', true), ('id_types_off', true), ('status_colours', true),
  ('pos_round_off', true), ('kpi_day_use_half', true), ('kpi_comp_as_sold', true),
  ('child_free_age', true), ('child_max_age', true),
  ('id', false), ('code', false), ('name', false), ('gstin', false), ('pan', false),
  ('fssai_number', false), ('extra_registrations', false), ('is_active', false),
  ('created_at', false), ('updated_at', false), ('business_date', false),
  ('test_of', false)
$$;


-- -----------------------------------------------------------------------------
-- Clearing one class of a test hotel's tables, children before parents, worked
-- out from the foreign keys each time (a teardown is a migration run
-- backwards, MEMORY 115), with every key still enforced.
-- -----------------------------------------------------------------------------
create or replace function app.test_hotel_clear(p_hotel uuid, p_class text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_left  text[];
  v_pick  text[];
  v_t     text;
  v_n     bigint;
  v_total bigint := 0;
begin
  if not app.test_reset_allows(p_hotel) then
    raise exception 'Only a reset or a re-copy of a test hotel clears it.'
      using errcode = 'insufficient_privilege';
  end if;

  select array_agg(c.table_name) into v_left
    from app.test_hotel_classes() c
   where c.class = p_class
     and exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.' || c.table_name)
                    and a.attname = 'hotel_id' and not a.attisdropped);

  while coalesce(array_length(v_left, 1), 0) > 0 loop
    select array_agg(t order by t) into v_pick
      from unnest(v_left) t
     where not exists (
       select 1 from pg_constraint k
         join pg_class ch on ch.oid = k.conrelid
         join pg_class pa on pa.oid = k.confrelid
        where k.contype = 'f'
          and pa.relname = t and ch.relname <> t
          and ch.relname = any (v_left)
          and ch.relnamespace = 'public'::regnamespace
          and pa.relnamespace = 'public'::regnamespace);
    if v_pick is null then
      raise exception 'The % tables of a test hotel point at each other in a circle: %',
        p_class, array_to_string(v_left, ', ');
    end if;
    foreach v_t in array v_pick loop
      execute format('delete from public.%I where hotel_id = $1', v_t) using p_hotel;
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    end loop;
    v_left := array(select t from unnest(v_left) t where t <> all (v_pick));
  end loop;
  return v_total;
end $$;

-- -----------------------------------------------------------------------------
-- Copying the real hotel's setup into its test hotel: every setup table,
-- parents first, every row with a new id, every key remapped - to the copied
-- parent, to the test hotel, or (a device, a key, a person) to nothing.
-- -----------------------------------------------------------------------------
create or replace function app.copy_hotel_setup(p_from uuid, p_to uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_classes jsonb;
  v_left    text[];
  v_pick    text[];
  v_t       text;
  v_rel     regclass;
  v_map     jsonb := '{}';
  v_tmap    jsonb;
  v_scope   text;
  v_cols    text;
  v_vals    text;
  v_self    text[];
  v_s       text;
  v_expr    text;
  v_has_id  boolean;
  v_has_hotel boolean;
  v_n       bigint;
  v_total   bigint := 0;
  v_col     record;
  v_fk      record;
begin
  if not app.test_reset_allows(p_to)
     or not exists (select 1 from hotels where id = p_to and test_of = p_from) then
    raise exception 'A setup is copied only from a real hotel into its own test hotel, by its reset or re-copy.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_object_agg(c.table_name, c.class) into v_classes from app.test_hotel_classes() c;
  select array_agg(c.table_name) into v_left from app.test_hotel_classes() c where c.class = 'setup';

  while coalesce(array_length(v_left, 1), 0) > 0 loop
    -- Parents first: a table is ready when none of its parents still waits.
    select array_agg(t order by t) into v_pick
      from unnest(v_left) t
     where not exists (
       select 1 from pg_constraint k
         join pg_class ch on ch.oid = k.conrelid
         join pg_class pa on pa.oid = k.confrelid
        where k.contype = 'f'
          and ch.relname = t and pa.relname <> t
          and pa.relname = any (v_left)
          and ch.relnamespace = 'public'::regnamespace
          and pa.relnamespace = 'public'::regnamespace);
    if v_pick is null then
      raise exception 'The setup tables point at each other in a circle: %', array_to_string(v_left, ', ');
    end if;

    foreach v_t in array v_pick loop
      v_rel := to_regclass('public.' || v_t);
      v_has_hotel := exists (select 1 from pg_attribute
                              where attrelid = v_rel and attname = 'hotel_id' and not attisdropped);
      v_has_id := exists (select 1 from pg_index i join pg_attribute x
                            on x.attrelid = i.indrelid and x.attnum = any (i.indkey)
                           where i.indrelid = v_rel and i.indisprimary
                             and x.attname = 'id' and x.atttypid = 'uuid'::regtype
                             and array_length(i.indkey::int2[], 1) = 1);

      -- Which rows: the real hotel's, or (a table with no hotel of its own)
      -- those whose setup parent is the real hotel's.
      if v_has_hotel then
        v_scope := 'src.hotel_id = $1';
      else
        select format('src.%I in (select id from public.%I where hotel_id = $1)',
                      ca.attname, pa.relname)
          into v_scope
          from pg_constraint k
          join pg_class pa on pa.oid = k.confrelid
          join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[1]
         where k.conrelid = v_rel and k.contype = 'f'
           and v_classes ->> pa.relname = 'setup'
           and exists (select 1 from pg_attribute h where h.attrelid = pa.oid
                          and h.attname = 'hotel_id' and not h.attisdropped)
         order by ca.attname
         limit 1;
        if v_scope is null then
          raise exception 'The setup table % has no hotel to copy it by.', v_t;
        end if;
      end if;
      -- Loyalty and the channel manager are never on in a test hotel.
      if v_t = 'hotel_modules' then
        v_scope := v_scope || ' and src.module not in (''loyalty'', ''channel_manager'')';
      end if;

      if v_has_id then
        execute format('select coalesce(jsonb_object_agg(src.id::text, gen_random_uuid()), ''{}''::jsonb) '
                       'from public.%I src where %s', v_t, v_scope)
           into v_tmap using p_from;
        v_map := v_map || jsonb_build_object(v_t, v_tmap);
      end if;

      v_cols := ''; v_vals := ''; v_self := '{}';
      for v_col in
        select x.attnum, x.attname::text as attname, x.attnotnull
          from pg_attribute x
         where x.attrelid = v_rel and x.attnum > 0 and not x.attisdropped
           and x.attgenerated = ''
         order by x.attnum
      loop
        -- The key this column is part of, if any; a column in two (hotel_id
        -- in a composite key) is decided below by its name first.
        select pa.relname::text as parent,
               (select y.attname::text from pg_attribute y
                 where y.attrelid = k2.confrelid
                   and y.attnum = k2.confkey[array_position(k2.conkey, v_col.attnum)]) as parent_col
          into v_fk
          from pg_constraint k2
          join pg_class pa on pa.oid = k2.confrelid
         where k2.conrelid = v_rel and k2.contype = 'f' and v_col.attnum = any (k2.conkey)
         order by (pa.relname = 'hotels'), pa.relname
         limit 1;

        if v_col.attname = 'id' and v_has_id then
          v_expr := format('($3 -> %L ->> src.id::text)::uuid', v_t);
        elsif v_col.attname = 'hotel_id' then
          v_expr := '$2';
        elsif (v_t = 'pos_outlets' and v_col.attname in ('api_key_hash', 'kot_station_device',
              'kot_station_name', 'kot_station_since', 'kot_station_seen_at'))
           or (v_t = 'pos_kot_kinds' and v_col.attname = 'station_since') then
          -- an outside till's key and a KOT computer are the real hotel's
          -- devices (a kind's computer, pos_kot_stations, is never copied)
          v_expr := 'null';
        elsif v_fk.parent is null then
          v_expr := format('src.%I', v_col.attname);
        elsif v_fk.parent = 'staff' then
          -- who set it up is the real hotel's person; the copy is by whoever copies
          v_expr := case when v_col.attnotnull then 'app.current_user_id()' else 'null' end;
        elsif v_fk.parent = 'hotels' then
          v_expr := case when v_col.attnotnull then '$2' else 'null' end;
        elsif v_fk.parent = v_t then
          -- points at a row of its own table: filled in once every row is there
          v_expr := 'null';
          v_self := v_self || v_col.attname;
        elsif v_classes ->> v_fk.parent = 'setup' then
          if v_fk.parent_col <> 'id' then
            raise exception 'Cannot copy %.%: it points at %.%, not an id.', v_t, v_col.attname, v_fk.parent, v_fk.parent_col;
          end if;
          v_expr := format('($3 -> %L ->> src.%I::text)::uuid', v_fk.parent, v_col.attname);
        elsif v_classes ->> v_fk.parent in ('trading', 'never') then
          if v_col.attnotnull then
            raise exception 'Cannot copy %.%: it must point at %, which a test hotel does not copy.', v_t, v_col.attname, v_fk.parent;
          end if;
          v_expr := 'null';
        else
          -- the group's own lists (meal plans, booking sources, amenities)
          v_expr := format('src.%I', v_col.attname);
        end if;

        v_cols := v_cols || case when v_cols = '' then '' else ', ' end || quote_ident(v_col.attname);
        v_vals := v_vals || case when v_vals = '' then '' else ', ' end || v_expr;
      end loop;

      execute format('insert into public.%I (%s) select %s from public.%I src where %s',
                     v_t, v_cols, v_vals, v_t, v_scope)
         using p_from, p_to, v_map;
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;

      foreach v_s in array v_self loop
        execute format(
          'update public.%I d set %I = ($3 -> %L ->> s.%I::text)::uuid '
          '  from public.%I s '
          ' where s.hotel_id = $1 and s.%I is not null '
          '   and d.id = ($3 -> %L ->> s.id::text)::uuid',
          v_t, v_s, v_t, v_s, v_t, v_s, v_t)
          using p_from, p_to, v_map;
      end loop;
    end loop;

    v_left := array(select t from unnest(v_left) t where t <> all (v_pick));
  end loop;

  -- Every room starts empty and clean, whatever the real one is doing tonight.
  update rooms set occupancy_status = 'vacant', housekeeping_status = 'clean'
   where hotel_id = p_to;
  return v_total;
end $$;

-- The property's own settings, from the real hotel.
create or replace function app.copy_hotel_row(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_set text;
begin
  if not app.test_reset_allows(p_to)
     or not exists (select 1 from hotels where id = p_to and test_of = p_from) then
    raise exception 'A setup is copied only from a real hotel into its own test hotel, by its reset or re-copy.'
      using errcode = 'insufficient_privilege';
  end if;
  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ')
    into v_set
    from app.test_hotel_hotels_columns() c
   where c.copied;
  execute format('update hotels t set %s from hotels r where r.id = $1 and t.id = $2', v_set)
    using p_from, p_to;
end $$;


-- -----------------------------------------------------------------------------
-- The three acts: make, reset, re-copy. The owner or a group administrator
-- only (10); a real hotel is refused (3); one audit entry each, naming who.
-- -----------------------------------------------------------------------------
create or replace function app.require_test_hotel_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_group_admin() then
    raise exception 'Only the owner or a group administrator makes, resets or re-copies a test hotel.'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

create or replace function app.reset_test_hotel_unlogged(p_hotel uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_removed bigint;
  v_n bigint;
begin
  perform app.require_test_hotel_admin();
  if not app.is_test_hotel(p_hotel) then
    raise exception 'This is a real hotel. Only a test hotel is reset.'
      using errcode = 'check_violation';
  end if;
  perform set_config('app.test_reset', p_hotel::text, true);

  v_removed := app.test_hotel_clear(p_hotel, 'trading');

  -- The test hotel's own guests, companies and groups, and what hangs off them.
  delete from guest_joins j
   where j.kept_id in (select id from guests where test_hotel_id = p_hotel)
      or j.joined_id in (select id from guests where test_hotel_id = p_hotel);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from guest_not_same n
   where n.a in (select id from guests where test_hotel_id = p_hotel)
      or n.b in (select id from guests where test_hotel_id = p_hotel);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from offer_opt_ins where test_hotel_id = p_hotel;
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from offer_opt_outs where test_hotel_id = p_hotel;
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from reservation_groups where test_hotel_id = p_hotel;
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  -- Their ID documents go by cascade: a TEST guest's only, never a real one's.
  delete from guest_documents where guest_id in (select id from guests where test_hotel_id = p_hotel);
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from guests where test_hotel_id = p_hotel;
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;
  delete from companies where test_hotel_id = p_hotel;
  get diagnostics v_n = row_count; v_removed := v_removed + v_n;

  -- Empty, clean, on today, numbering from the start.
  update rooms set occupancy_status = 'vacant', housekeeping_status = 'clean'
   where hotel_id = p_hotel;
  update hotels set business_date = (now() at time zone timezone)::date where id = p_hotel;
  update invoice_series  set next_number = 1 where hotel_id = p_hotel;
  update vat_bill_series set next_number = 1 where hotel_id = p_hotel;

  perform set_config('app.test_reset', '', true);
  return v_removed;
end $$;

create or replace function app.reset_test_hotel(p_hotel uuid)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_removed bigint;
begin
  v_removed := app.reset_test_hotel_unlogged(p_hotel);
  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (p_hotel, app.current_user_id(), 'hotels', p_hotel::text, 'TEST_RESET', null,
          jsonb_build_object('removed', v_removed,
                             'by', (select full_name from staff where id = app.current_user_id())));
  return v_removed;
end $$;

create or replace function app.recopy_test_hotel(p_hotel uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_real    uuid;
  v_removed bigint;
  v_copied  bigint;
begin
  v_removed := app.reset_test_hotel_unlogged(p_hotel);
  select test_of into v_real from hotels where id = p_hotel;

  perform set_config('app.test_reset', p_hotel::text, true);
  v_removed := v_removed + app.test_hotel_clear(p_hotel, 'setup');
  v_copied := app.copy_hotel_setup(v_real, p_hotel);
  perform app.copy_hotel_row(v_real, p_hotel);
  perform set_config('app.test_reset', '', true);

  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (p_hotel, app.current_user_id(), 'hotels', p_hotel::text, 'TEST_RECOPY', null,
          jsonb_build_object('removed', v_removed, 'copied', v_copied,
                             'by', (select full_name from staff where id = app.current_user_id())));
  return jsonb_build_object('removed', v_removed, 'copied', v_copied);
end $$;

create or replace function app.create_test_hotel(p_real uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r       hotels;
  v_code  text;
  v_n     int;
  v_id    uuid;
  v_copied bigint;
begin
  perform app.require_test_hotel_admin();
  select * into r from hotels where id = p_real;
  if r.id is null then
    raise exception 'No such property.' using errcode = 'no_data_found';
  end if;
  -- A test hotel of a test hotel is hotels_test_rules' to refuse.
  if exists (select 1 from hotels where test_of = p_real) then
    raise exception '% already has a test hotel: %.', r.name,
      (select code from hotels where test_of = p_real)
      using errcode = 'unique_violation';
  end if;

  -- (12) "<CODE>T", or the first free variant that fits the code's shape.
  v_code := left(r.code, 9) || 'T';
  v_n := 1;
  while exists (select 1 from hotels where code = v_code) loop
    v_n := v_n + 1;
    if v_n > 99 then
      raise exception 'No free code is left for a test hotel of %.', r.name;
    end if;
    v_code := left(r.code, 9 - length(v_n::text)) || 'T' || v_n;
  end loop;

  insert into hotels (code, name, city, state, timezone, test_of)
  values (v_code, r.name || ' · TEST', r.city, r.state, r.timezone, p_real)
  returning id into v_id;

  -- What a new hotel is seeded with (payment methods, lists, stores, KOT
  -- kinds, approval rules) is replaced by the real hotel's own.
  perform set_config('app.test_reset', v_id::text, true);
  perform app.test_hotel_clear(v_id, 'setup');
  v_copied := app.copy_hotel_setup(p_real, v_id);
  perform app.copy_hotel_row(p_real, v_id);
  perform set_config('app.test_reset', '', true);

  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (v_id, app.current_user_id(), 'hotels', v_id::text, 'TEST_CREATE', null,
          jsonb_build_object('copiedFrom', r.code, 'copied', v_copied,
                             'by', (select full_name from staff where id = app.current_user_id())));
  return v_id;
end $$;

comment on function app.create_test_hotel(uuid) is
  'D27-296: a test hotel for a real one, "<name> · TEST", its whole setup copied. Group admins only.';
comment on function app.reset_test_hotel(uuid) is
  'D27-296: every bit of test activity gone, setup and testers kept. Group admins only; a real hotel refused.';
comment on function app.recopy_test_hotel(uuid) is
  'D27-296: a reset, then the real hotel''s setup copied again. Testers stay.';
