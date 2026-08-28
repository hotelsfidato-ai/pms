-- =============================================================================
-- 013_policies.sql — close the policy holes
-- =============================================================================
-- Addresses  C1  guest identity documents readable group-wide
--            D2  any clerk can clear a blacklist
--            D3  the audit log is deletable by the people it audits
--            D5  tables created after 007 have no RLS at all
--            D9  invoice numbering is tamperable
--
-- The theme: `for all` is a convenient default and a bad one. It grants
-- INSERT, UPDATE and DELETE alongside SELECT, and three of the five findings
-- below are that single word.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- C1 — guest identity documents move to their own table.
-- -----------------------------------------------------------------------------
-- Group-level STORAGE of guests was right: one person across seven properties,
-- or the blacklist is walkable and stay history is lost.
--
-- Group-level READ of their passport was not. `app.is_active_staff()` let a
-- clerk at any property read the passport number, visa number and address of a
-- guest who had only ever stayed somewhere else — roughly a hundred people,
-- with turnover, against data the DPDP Act treats as sensitive.
--
-- Splitting the columns out is cleaner than column-level tricks: the sensitive
-- data gets its own table and its own policy.
-- -----------------------------------------------------------------------------
create table if not exists guest_documents (
  guest_id        uuid primary key references guests(id) on delete cascade,
  id_type         text,
  id_number       text,
  passport_expiry date,
  visa_number     text,
  visa_expiry     date,
  address_line    text,
  city            text,
  country         text,
  updated_at      timestamptz not null default now(),

  constraint gd_id_type_valid check (
    id_type is null or id_type in
      ('aadhaar','passport','driving_licence','voter','other')
  )
);

-- Guarded: on a re-run the source columns are already gone, and an unguarded
-- SELECT naming them fails with "column does not exist" — taking the rest of
-- the file with it under ON_ERROR_STOP.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guests' and column_name = 'id_number'
  ) then
    execute $q$
      insert into guest_documents (guest_id, id_type, id_number, passport_expiry,
                                   visa_number, visa_expiry, address_line, city, country)
      select id, id_type, id_number, passport_expiry, visa_number, visa_expiry,
             address_line, city, country
        from guests
      on conflict (guest_id) do nothing
    $q$;
  end if;
end
$$;

-- city and country move WITH the address — leaving copies on `guests` would be
-- two sources of truth for one fact, and the one nobody updates is the one that
-- gets read.
alter table guests drop column if exists id_type;
alter table guests drop column if exists id_number;
alter table guests drop column if exists passport_expiry;
alter table guests drop column if exists visa_number;
alter table guests drop column if exists visa_expiry;
alter table guests drop column if exists address_line;
alter table guests drop column if exists city;
alter table guests drop column if exists country;

drop trigger if exists guest_documents_touch on guest_documents;
create trigger guest_documents_touch before update on guest_documents
  for each row execute function app.touch_updated_at();

-- Readable only where the caller's property actually holds a booking for that
-- guest. Recognising a returning guest still works — name, phone and the
-- blacklist stay on `guests`. Reading their passport does not.
alter table guest_documents enable row level security;
alter table guest_documents force row level security;

drop policy if exists gd_by_reservation on guest_documents;
create policy gd_by_reservation on guest_documents
  for select
  using (
    exists (
      select 1 from reservations r
       where r.guest_id = guest_documents.guest_id
         and r.hotel_id in (select app.auth_hotel_ids())
    )
  );

drop policy if exists gd_write_by_reservation on guest_documents;
create policy gd_write_by_reservation on guest_documents
  for insert
  with check (
    exists (
      select 1 from reservations r
       where r.guest_id = guest_documents.guest_id
         and r.hotel_id in (select app.auth_hotel_ids())
    )
  );

drop policy if exists gd_update_by_reservation on guest_documents;
create policy gd_update_by_reservation on guest_documents
  for update
  using (
    exists (
      select 1 from reservations r
       where r.guest_id = guest_documents.guest_id
         and r.hotel_id in (select app.auth_hotel_ids())
    )
  );


-- -----------------------------------------------------------------------------
-- D2 — a blacklist any clerk can clear is not a blacklist.
-- -----------------------------------------------------------------------------
-- The old policy was `for all using (app.is_active_staff())`. FOR ALL includes
-- UPDATE, so anyone at any property could set is_blacklisted = false — and the
-- entire point of a group-level blacklist is that it cannot be walked around.
-- -----------------------------------------------------------------------------
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
       and sh.role in ('owner','gm')
  )
$$;

drop policy if exists staff_access on guests;

create policy guests_read on guests
  for select using ( app.is_active_staff() );

create policy guests_insert on guests
  for insert with check ( app.is_active_staff() );

-- Anyone may correct a name or a phone number. Only a manager may change the
-- blacklist — enforced by the trigger below, because a policy cannot see which
-- COLUMN changed.
create policy guests_update on guests
  for update using ( app.is_active_staff() );

create or replace function app.guard_blacklist()
returns trigger
language plpgsql
as $$
begin
  if (new.is_blacklisted is distinct from old.is_blacklisted
      or new.blacklist_reason is distinct from old.blacklist_reason)
     and not app.is_manager() then
    raise exception 'Only an owner or general manager may change a guest blacklist.'
      using hint = 'Ask a manager at your property.';
  end if;
  return new;
end
$$;

drop trigger if exists guests_blacklist_guard on guests;
create trigger guests_blacklist_guard before update on guests
  for each row execute function app.guard_blacklist();

-- No delete policy at all. Guests are never deleted.


-- -----------------------------------------------------------------------------
-- D3 — an audit log the audited can delete is theatre.
-- -----------------------------------------------------------------------------
-- SELECT only. Rows arrive exclusively through app.write_audit(), which is
-- security definer and therefore bypasses RLS to insert — leaving nobody a
-- path to remove what it wrote.
-- -----------------------------------------------------------------------------
-- ⚠ ENABLE, but deliberately NOT FORCE.
--   FORCE makes the table OWNER subject to the policies too. app.write_audit()
--   is `security definer` and runs as that owner — so with FORCE, the only
--   thing allowed to write this table would be filtered by a policy set that
--   permits no writes, and every audited operation would fail.
--   Without FORCE the owner bypasses RLS (which is what the definer function
--   needs) while pms_app — not the owner — stays fully subject to it.
alter table audit_log enable row level security;

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log
  for select
  using ( hotel_id is null or hotel_id in (select app.auth_hotel_ids()) );

-- Same treatment for the other two append-only histories.
alter table room_status_log enable row level security;
alter table room_status_log force row level security;
drop policy if exists hotel_isolation on room_status_log;
drop policy if exists rsl_read on room_status_log;
create policy rsl_read on room_status_log
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
create policy rsl_insert on room_status_log
  for insert with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- D9 — invoice numbers may be consumed, never set.
-- -----------------------------------------------------------------------------
-- Resetting or skipping a GST invoice number is a statutory offence, not a
-- data-quality problem. app.next_invoice_number() is security definer and does
-- the increment; nothing else may write the counter.
-- -----------------------------------------------------------------------------
-- ENABLE without FORCE, for the same reason as audit_log above:
-- app.next_invoice_number() is the only permitted writer and it is
-- `security definer`. FORCE would block it along with everyone else.
alter table invoice_series enable row level security;

drop policy if exists inv_series_read on invoice_series;
create policy inv_series_read on invoice_series
  for select using ( hotel_id in (select app.auth_hotel_ids()) );

-- No insert, update or delete policy. The function is the only writer.

alter table invoices enable row level security;
alter table invoices force row level security;
drop policy if exists invoices_scope on invoices;
create policy invoices_scope on invoices
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
create policy invoices_issue on invoices
  for insert with check ( hotel_id in (select app.auth_hotel_ids()) );
-- Deliberately no update or delete. An issued invoice is issued.


-- -----------------------------------------------------------------------------
-- Policies for everything 011 added.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['room_assignments','payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;

  -- Group-level tables: visible to active staff.
  foreach t in array array['reservation_groups','meal_plans','room_type_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists staff_access on %I', t);
    execute format($p$
      create policy staff_access on %I for select using ( app.is_active_staff() )
    $p$, t);
  end loop;

  -- Groups are created and edited by staff; the templates are not.
  execute 'drop policy if exists rg_write on reservation_groups';
  execute 'create policy rg_write on reservation_groups for insert
             with check ( app.is_active_staff() )';
  execute 'drop policy if exists rg_update on reservation_groups';
  execute 'create policy rg_update on reservation_groups for update
             using ( app.is_active_staff() )';
end
$$;

-- schema_migrations is infrastructure. Readable, never writable from the app.
-- No FORCE — the migration runner owns this table and must write it.
alter table schema_migrations enable row level security;
drop policy if exists sm_read on schema_migrations;
create policy sm_read on schema_migrations for select using ( true );


-- -----------------------------------------------------------------------------
-- `hotels` was left `for all` by 007 — any clerk could create a property.
-- -----------------------------------------------------------------------------
-- Provisioning is gated behind app.require_group_admin(), but that gate is
-- worthless if a plain INSERT into `hotels` is permitted alongside it. Same for
-- `companies`: credit limits are commercial terms, not front-desk data.
-- -----------------------------------------------------------------------------
drop policy if exists staff_access on hotels;
create policy hotels_read on hotels
  for select using ( app.is_active_staff() );
create policy hotels_manage on hotels
  for update using ( app.is_manager() ) with check ( app.is_manager() );
-- No insert policy: properties arrive only through app.provision_property().
-- No delete policy: a property is deactivated, never removed.

drop policy if exists staff_access on companies;
create policy companies_read on companies
  for select using ( app.is_active_staff() );
create policy companies_write on companies
  for insert with check ( app.is_active_staff() );
create policy companies_update on companies
  for update using ( app.is_manager() ) with check ( app.is_manager() );


-- -----------------------------------------------------------------------------
-- D5 — stop this happening again.
-- -----------------------------------------------------------------------------
-- 007 enabled RLS by iterating a HARD-CODED list. room_type_templates was
-- created in 009, after that list ran, and so had no row-level security at all
-- until the block above. Every future table inherits the same trap.
--
-- This function makes it a build failure instead of a memory test. Call it
-- from the test suite; anything unprotected fails the run.
-- -----------------------------------------------------------------------------
create or replace function app.tables_without_rls()
returns table (table_name text)
language sql stable
as $$
  select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
   order by 1
$$;

do $$
declare v text;
begin
  select string_agg(table_name, ', ') into v from app.tables_without_rls();
  if v is not null then
    raise warning 'Tables with NO row level security: %', v;
  else
    raise notice 'RLS coverage: every table in public is protected.';
  end if;
end
$$;


insert into schema_migrations (version) values ('013_policies')
on conflict (version) do nothing;


-- =============================================================================
-- VERIFY — as pms_app, with app.user_id set to a front-desk clerk.
-- =============================================================================
--   -- 1. RLS coverage — must return zero rows
--   select * from app.tables_without_rls();
--
--   -- 2. C1 — a guest who has never stayed at your property
--   select * from guest_documents where guest_id = '<other-property-guest>';
--   --> 0 rows
--
--   -- 3. D2 — clearing a blacklist as a clerk
--   update guests set is_blacklisted = false where id = '<some-guest>';
--   --> ERROR: Only an owner or general manager may change a guest blacklist.
--
--   -- 4. D3 — covering your tracks
--   delete from audit_log;
--   --> 0 rows deleted (no delete policy)
--
--   -- 5. D9 — resetting the invoice sequence
--   update invoice_series set next_number = 1;
--   --> 0 rows updated (no update policy)
--
-- Items 3 to 5 failing silently rather than loudly is correct for RLS: a
-- policy FILTERS, it does not reject. Zero rows affected IS the refusal.
-- =============================================================================
