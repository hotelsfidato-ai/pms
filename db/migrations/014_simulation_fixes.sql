-- =============================================================================
-- 014_simulation_fixes.sql — what a traced data flow found
-- =============================================================================
-- Found by walking a full operating sequence through the schema step by step:
--   provision → onboard staff → capture a guest → book → assign a room →
--   check in → post charges → move rooms → night audit → invoice → settle
--
-- Each of these passes every static check and fails on real data.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- S1 — the first invoice at every property fails.
-- -----------------------------------------------------------------------------
-- 011 created invoice_series and app.next_invoice_number(), which does
--   update invoice_series ... returning
-- and raises when no row comes back. Nothing ever CREATES that row.
--
-- provision_property() clones room types and stops. So the seventh property
-- opens, takes bookings all week, and the first guest to ask for a bill gets
-- "No invoice series for hotel …" at the desk.
-- -----------------------------------------------------------------------------

-- Backfill every property that already exists.
insert into invoice_series (hotel_id, fin_year, prefix, next_number)
select h.id,
       case when extract(month from now()) >= 4
            then extract(year from now())::text || '-' ||
                 lpad(((extract(year from now()) + 1)::int % 100)::text, 2, '0')
            else (extract(year from now()) - 1)::text || '-' ||
                 lpad((extract(year from now())::int % 100)::text, 2, '0')
       end,
       h.code,
       1
  from hotels h
on conflict (hotel_id, fin_year) do nothing;

-- Indian financial year runs April to March, so the series rolls on 1 April,
-- not 1 January. Getting this wrong means a numbering sequence that restarts
-- three months late, which is a GST problem rather than a bug report.
create or replace function app.current_fin_year()
returns text
language sql stable
as $$
  select case when extract(month from current_date) >= 4
    then extract(year from current_date)::text || '-' ||
         lpad(((extract(year from current_date) + 1)::int % 100)::text, 2, '0')
    else (extract(year from current_date) - 1)::text || '-' ||
         lpad((extract(year from current_date)::int % 100)::text, 2, '0')
  end
$$;

-- And make provisioning create it, so property #8 does not hit the same wall.
create or replace function app.provision_property(
  p_code          text,
  p_name          text,
  p_city          text,
  p_state         text default null,
  p_gstin         text default null,
  p_template_set  text default 'standard',
  p_timezone      text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
as $$
declare
  v_hotel_id uuid;
  v_types    integer;
begin
  perform app.require_group_admin();

  insert into hotels (code, name, city, state, gstin, timezone)
  values (upper(p_code), p_name, p_city, p_state, p_gstin, p_timezone)
  returning id into v_hotel_id;

  insert into room_types (hotel_id, code, name, base_occupancy,
                          max_occupancy, base_rate, sort_order)
  select v_hotel_id, t.code, t.name, t.base_occupancy,
         t.max_occupancy, t.default_rate, t.sort_order
    from room_type_templates t
   where t.template_set = p_template_set;

  get diagnostics v_types = row_count;

  if v_types = 0 then
    raise exception 'No room type templates found for set "%"', p_template_set
      using hint = 'Check room_type_templates, or pass a different p_template_set.';
  end if;

  -- S1: without this the property cannot issue its first invoice.
  insert into invoice_series (hotel_id, fin_year, prefix, next_number)
  values (v_hotel_id, app.current_fin_year(), upper(p_code), 1)
  on conflict (hotel_id, fin_year) do nothing;

  raise notice 'Provisioned % (%) with % room types and an invoice series.',
               p_name, upper(p_code), v_types;
  return v_hotel_id;
end
$$;


-- -----------------------------------------------------------------------------
-- S2 — a passport cannot be stored before the booking exists.
-- -----------------------------------------------------------------------------
-- 013 scoped guest_documents by reservation, for both reading AND writing. But
-- the real desk sequence is: guest hands over ID → clerk captures it → booking
-- is made. At the moment of capture there is no reservation, so the insert is
-- refused and the clerk cannot proceed.
--
-- The C1 concern was never about writing — it was that any clerk anywhere could
-- READ any guest's passport. So: writing is permitted to active staff (you are
-- holding the document), reading stays scoped to a property with a booking.
-- -----------------------------------------------------------------------------
drop policy if exists gd_write_by_reservation on guest_documents;

drop policy if exists gd_capture on guest_documents;
create policy gd_capture on guest_documents
  for insert
  with check ( app.is_active_staff() );

-- Updating still requires a booking at your property — correcting someone
-- else's guest record is not a front-desk operation.
-- (gd_update_by_reservation from 013 is unchanged.)


-- -----------------------------------------------------------------------------
-- S3 — night audit can reject its own postings.
-- -----------------------------------------------------------------------------
-- The closed-date trigger refuses any posting whose business_date has a
-- COMPLETED night_audit_runs row. That is correct — and it means the audit must
-- insert its run row as 'running', post everything, and only then mark it
-- 'completed'.
--
-- Write it the other way round and the audit's own room charges are rejected by
-- the guard the audit itself just armed. Nothing in the schema prevents that
-- ordering, so this constraint makes the requirement explicit and self-
-- documenting rather than tribal knowledge.
-- -----------------------------------------------------------------------------
alter table night_audit_runs drop constraint if exists nar_completed_needs_finish;
alter table night_audit_runs
  add constraint nar_completed_needs_finish
  check (status <> 'completed' or completed_at is not null);

comment on table night_audit_runs is
  'Night audit MUST insert with status=''running'', post all charges, then '
  'update to status=''completed'' with completed_at set. Marking it complete '
  'first arms app.reject_closed_business_date() against the audit''s own '
  'postings.';


-- -----------------------------------------------------------------------------
-- S4 — ownership drifted after 010.
-- -----------------------------------------------------------------------------
-- 010 transferred every table and function to pms_migrate. Migrations 011–013
-- then created fourteen more objects, owned by whoever ran them.
--
-- That matters because the security-definer functions run as THEIR owner, and
-- whether they bypass RLS depends on whether that owner also owns the table.
-- Mixed ownership makes the behaviour depend on who ran which file — which is
-- exactly the kind of thing that works in development and fails in staging.
-- -----------------------------------------------------------------------------
-- ⚠ FOUND BY RUNNING THIS, NOT BY READING IT.
--   010 granted USAGE on schema `app` to pms_app and pms_readonly — and never
--   to pms_migrate. Transferring the functions to pms_migrate below therefore
--   makes every SECURITY DEFINER function run as a role that cannot see its
--   own schema, and the failure is total:
--     ERROR: permission denied for schema app
--   ...raised from inside app.write_audit(), so the FIRST insert into any
--   audited table dies. Nothing works. Grant it before the transfer.
alter schema app owner to pms_migrate;
grant usage, create on schema app to pms_migrate;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I owner to pms_migrate', t.tablename);
  end loop;

  for t in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
  loop
    execute format('alter function app.%I(%s) owner to pms_migrate', t.proname, t.args);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- S6 — FORCE RLS on the access model locks out the access model.
-- -----------------------------------------------------------------------------
-- ⚠ FOUND BY RUNNING THIS, and it is the worst of the lot.
--
--   007 set FORCE ROW LEVEL SECURITY on `staff_hotels` (zero policies, so
--   nothing from a browser can read it) and on `staff`. That was correct while
--   the definer functions ran as the installing SUPERUSER, who bypasses RLS
--   regardless.
--
--   The ownership transfer above changes who they run as. FORCE applies to the
--   OWNER — so app.auth_hotel_ids(), running as pms_migrate, can no longer read
--   the allowlist it exists to read. It returns the empty set, and EVERY USER
--   SEES NOTHING. The system fails closed, silently, with no error anywhere.
--
--   app.assert_staff_has_hotel() has the same problem from the other side: it
--   looks up a DIFFERENT person in `staff`, which the policy `id =
--   current_user_id()` hides from it, so it would reject every assignment.
--
--   ENABLE without FORCE is the correct setting for both: the owner bypasses
--   (which the definer functions need), while pms_app — not the owner — is
--   still subject to the policies, which is the whole point.
-- -----------------------------------------------------------------------------
alter table staff_hotels no force row level security;
alter table staff        no force row level security;

-- Re-apply grants, since new tables from 011 carried none.
grant select, insert, update, delete on all tables    in schema public to pms_app;
grant usage, select                  on all sequences in schema public to pms_app;
grant execute                        on all functions in schema app    to pms_app;
grant select on all tables in schema public to pms_readonly;

-- The append-only tables get their write path narrowed again, since the blanket
-- grant above just widened it.
revoke update, delete on folio_postings, audit_log, room_status_log from pms_app;
revoke insert, update, delete on invoice_series from pms_app;
revoke insert, update, delete on schema_migrations from pms_app;


-- -----------------------------------------------------------------------------
-- S5 — a payment could reference another property's posting.
-- -----------------------------------------------------------------------------
-- 012 skipped this pair. payments.posting_id is a bare reference to
-- folio_postings(id), so nothing stops a payment at Agra settling a charge at
-- Pune — and RLS then hides the mismatch, exactly as D1 described.
-- -----------------------------------------------------------------------------
/* ORDER. Both foreign keys below reference `folio_postings (hotel_id, id)`,
   so they DEPEND on the unique constraint that names those columns. On a
   first run neither exists yet and any order works; on a redeploy both exist,
   and dropping the unique constraint first fails with

     cannot drop constraint folio_postings_hotel_id_key ... because other
     objects depend on it

   halfway through the file. Dependents come off first, the key is replaced,
   and they go back on — a migration run backwards, then forwards. The same
   ordering rule defect 115 records for teardowns. */
alter table payments        drop constraint if exists payments_posting_id_fkey;
alter table payments        drop constraint if exists payments_posting_same_hotel;
alter table folio_postings  drop constraint if exists folio_postings_reverses_id_fkey;
alter table folio_postings  drop constraint if exists folio_postings_reverses_same_hotel;

alter table folio_postings drop constraint if exists folio_postings_hotel_id_key;
alter table folio_postings add constraint folio_postings_hotel_id_key unique (hotel_id, id);

alter table payments
  add constraint payments_posting_same_hotel
  foreign key (hotel_id, posting_id) references folio_postings (hotel_id, id);

-- Same for the ledger's self-reference: a reversal must reverse a posting at
-- the same property.
alter table folio_postings
  add constraint folio_postings_reverses_same_hotel
  foreign key (hotel_id, reverses_id) references folio_postings (hotel_id, id);


insert into schema_migrations (version) values ('014_simulation_fixes')
on conflict (version) do nothing;


-- =============================================================================
-- THE TRACE THAT FOUND THESE — run it as the smoke test.
-- =============================================================================
--   set local app.user_id = '<a group admin staff id>';
--
--   1. select app.provision_property('FH99','Trace Hotel','Pune');
--      --> must now also create an invoice_series row
--      select * from invoice_series where hotel_id = '<new>';   -- 1 row
--
--   2. insert a guest, then guest_documents BEFORE any reservation
--      --> must succeed (S2). Before this migration it was refused.
--
--   3. create a reservation, then room_assignments
--      --> exclusion constraint holds; a second overlapping row is refused
--
--   4. cancel the reservation, set released_at on the assignment
--      --> the same room can now be re-let for those dates
--
--   5. night audit: insert run as 'running', post charges, THEN complete
--      --> postings succeed. Reverse the order and step 5 fails (S3)
--
--   6. select app.next_invoice_number('<hotel>', app.current_fin_year());
--      --> 'FH99/2026-27/00001'
--
--   7. as pms_app, try to settle a Pune posting from an Agra payment
--      --> ERROR: violates foreign key "payments_posting_same_hotel"  (S5)
--
-- Steps 5 and 7 failing where described is the proof the guards are armed.
-- =============================================================================
