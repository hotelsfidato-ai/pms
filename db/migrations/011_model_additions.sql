-- =============================================================================
-- 011_model_additions.sql — the tables the audits found missing
-- =============================================================================
-- Every table here is cheap to add now and expensive once a real guest has
-- stayed. room_assignments especially: arriving late means a data migration
-- across every existing booking.
--
-- Addresses:  CTO audit  — room moves, group bookings, meal plans, GST series
--             review H3  — audit log
--             review H6  — migration tracking
--             model D6   — payment instrument detail
-- =============================================================================


-- -----------------------------------------------------------------------------
-- schema_migrations — H6. What version is this environment on?
-- -----------------------------------------------------------------------------
-- Ten numbered files and no way to ask. The checksum also catches a migration
-- edited after it was applied somewhere, which is otherwise invisible until the
-- schemas quietly diverge.
-- -----------------------------------------------------------------------------
create table if not exists schema_migrations (
  version     text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text
);

-- Backfill the files that ran before this table existed. 011 itself is NOT
-- listed here — a version row written before the work is done would mark a
-- half-applied migration as complete. It is recorded at the end of this file.
insert into schema_migrations (version) values
  ('001_foundation'),('002_tenancy'),('003_rooms'),('004_guests'),
  ('005_reservations'),('006_folio'),('007_rls'),('008_seed'),
  ('009_provisioning'),('010_roles')
on conflict (version) do nothing;


-- -----------------------------------------------------------------------------
-- meal_plans — GROUP-LEVEL. How the rate is quoted in India.
-- -----------------------------------------------------------------------------
create table if not exists meal_plans (
  code      text primary key,
  name      text not null,
  includes  text not null
);

insert into meal_plans (code, name, includes) values
  ('EP',  'European Plan',   'Room only'),
  ('CP',  'Continental Plan','Room + breakfast'),
  ('MAP', 'Modified American Plan', 'Room + breakfast + one meal'),
  ('AP',  'American Plan',   'Room + all meals')
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- reservation_groups — GROUP-LEVEL, deliberately.
-- -----------------------------------------------------------------------------
-- A group booking is a COMMERCIAL entity, like `companies` — not an operational
-- one. Scoping it to a hotel would make a wedding that overflows from one
-- property into another impossible to represent, and that is routine.
--
-- The group is group-level; every reservation inside it stays hotel-scoped.
-- So a clerk at Agra sees the group exists and sees only its Agra rooms, which
-- is exactly the behaviour you want.
-- -----------------------------------------------------------------------------
create table if not exists reservation_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                       -- 'Sharma Wedding, Mar 2027'
  company_id  uuid references companies(id),
  block_code  text,
  -- The property that owns the relationship, where there is one. Nullable
  -- precisely because a group may span several.
  lead_hotel_id uuid references hotels(id),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists reservation_groups_touch on reservation_groups;
create trigger reservation_groups_touch before update on reservation_groups
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- room_assignments — THE most important fix in either audit.
-- -----------------------------------------------------------------------------
-- `reservations.room_id` was a single column, so a reservation could only ever
-- have occupied one room — and the exclusion constraint on it actively
-- PREVENTED recording a move, because the new room's dates overlapped the old
-- booking. Room moves are routine: a fault, an upgrade, a noise complaint.
--
-- ⚠ NEVER PARTITION THIS TABLE. Exclusion constraints do not work across
--   partitions, and partitioning it would silently remove double-booking
--   protection while leaving the constraint definition visibly in place.
-- -----------------------------------------------------------------------------
create table if not exists room_assignments (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  room_id        uuid not null references rooms(id),
  from_date      date not null,
  to_date        date not null,
  reason         text not null default 'arrival',
  -- ⚠ WITHOUT THIS COLUMN A CANCELLED BOOKING BLOCKS ITS ROOM FOREVER.
  --   The old constraint on `reservations` carried
  --     where status in ('confirmed','checked_in')
  --   so cancellations and no-shows released the room. room_assignments cannot
  --   see reservation status, so the release has to be explicit: set
  --   released_at when a booking is cancelled, a guest moves, or a stay ends
  --   early. The exclusion constraint below ignores released rows.
  released_at    timestamptz,
  created_by     uuid references staff(id),
  created_at     timestamptz not null default now(),

  constraint ra_dates_ordered check (to_date > from_date),
  constraint ra_reason_valid check (reason in
    ('arrival','move','upgrade','downgrade','fault','group_consolidation'))
);

create index if not exists ra_hotel_room_idx on room_assignments (hotel_id, room_id, from_date);
create index if not exists ra_reservation_idx on room_assignments (reservation_id);

-- The double-booking guard, now on the table that can actually express a move.
-- daterange '[)' is half-open: someone leaving on the 5th and someone arriving
-- on the 5th do NOT overlap.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ra_no_double_booking'
       and conrelid = 'room_assignments'::regclass
  ) then
    alter table room_assignments
      add constraint ra_no_double_booking
      exclude using gist (
        room_id with =,
        daterange(from_date, to_date, '[)') with &&
      )
      where (released_at is null);      -- released assignments free the room
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- Move room assignment OFF reservations.
-- -----------------------------------------------------------------------------
-- Two sources of truth for "which room" is how they drift. room_assignments is
-- authoritative; the column goes.
-- -----------------------------------------------------------------------------
alter table reservations drop constraint if exists reservations_no_double_booking;

-- Migrate existing assignments. Dead bookings come across already released, so
-- they keep their history without holding a room hostage.
/* THE BACKFILL ONLY EXISTS WHILE THE OLD COLUMN DOES. `drop column if exists`
   below is re-runnable; this SELECT above it was not, and on a redeploy it
   fails with `column "room_id" does not exist` — after the new table has been
   created, so the file aborts halfway with the schema in a state no migration
   produces.

   Wrapped in EXECUTE because the planner parses the whole statement even on
   the branch that never runs, and a reference to a dropped column fails at
   parse time no matter what the `if` says. */
do $backfill$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'reservations' and column_name = 'room_id'
  ) then
    execute $sql$
      insert into room_assignments (hotel_id, reservation_id, room_id,
                                    from_date, to_date, reason, released_at)
      select hotel_id, id, room_id, check_in, check_out, 'arrival',
             case when status in ('confirmed','checked_in') then null else now() end
        from reservations
       where room_id is not null
      on conflict do nothing
    $sql$;
  end if;
end $backfill$;

alter table reservations drop column if exists room_id;

-- New columns the CTO audit called for.
alter table reservations add column if not exists meal_plan text references meal_plans(code);
alter table reservations add column if not exists group_id  uuid references reservation_groups(id);
alter table reservations add column if not exists occupancy smallint not null default 2;

create index if not exists reservations_group_idx on reservations (group_id);


-- -----------------------------------------------------------------------------
-- invoice_series + invoices — GST numbering, which is statutory.
-- -----------------------------------------------------------------------------
-- Invoice numbers must be sequential per GSTIN per financial year.
-- next_reference() numbers BOOKINGS; this is a different sequence entirely.
-- -----------------------------------------------------------------------------
create table if not exists invoice_series (
  hotel_id     uuid not null references hotels(id) on delete cascade,
  fin_year     text not null,                      -- '2026-27'
  prefix       text not null,
  next_number  bigint not null default 1,
  primary key (hotel_id, fin_year)
);

create table if not exists invoices (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  folio_id    uuid not null references folios(id),
  fin_year    text not null,
  number      text not null,
  gstin       text,
  total       numeric(12,2) not null,
  tax_total   numeric(12,2) not null,
  issued_at   timestamptz not null default now(),
  issued_by   uuid references staff(id),

  unique (hotel_id, fin_year, number)
);

create index if not exists invoices_hotel_idx on invoices (hotel_id, issued_at desc);

-- Numbers are CONSUMED through this function and never set directly — the
-- write policy in 013 refuses direct updates to invoice_series.
create or replace function app.next_invoice_number(p_hotel_id uuid, p_fin_year text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_prefix text; v_num bigint;
begin
  update invoice_series
     set next_number = next_number + 1
   where hotel_id = p_hotel_id and fin_year = p_fin_year
  returning prefix, next_number - 1 into v_prefix, v_num;

  if v_num is null then
    raise exception 'No invoice series for hotel % in %', p_hotel_id, p_fin_year
      using hint = 'Create the invoice_series row when the property is provisioned.';
  end if;

  return v_prefix || '/' || p_fin_year || '/' || lpad(v_num::text, 5, '0');
end
$$;


-- -----------------------------------------------------------------------------
-- payments — D6. The ledger says how much; this says how.
-- -----------------------------------------------------------------------------
-- Payments stay negative folio_postings — that keeps the balance a single
-- sum(). But a posting has nowhere to record the card's last four, the UPI
-- reference or the gateway transaction id, so nothing reconciles against a
-- bank statement at month end.
-- -----------------------------------------------------------------------------
create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  posting_id   bigint not null references folio_postings(id),
  method       text not null,
  amount       numeric(12,2) not null,
  card_last4   char(4),
  reference    text,                                -- UPI ref / cheque no / txn id
  gateway_txn  text,
  settled_at   timestamptz,
  created_at   timestamptz not null default now(),

  constraint payments_method_valid check (method in
    ('cash','card','upi','netbanking','wallet','cheque','bank_transfer','city_ledger')),
  unique (posting_id)
);

create index if not exists payments_hotel_idx on payments (hotel_id, created_at desc);
create index if not exists payments_unsettled_idx on payments (hotel_id) where settled_at is null;


-- -----------------------------------------------------------------------------
-- audit_log — H3. Who changed what.
-- -----------------------------------------------------------------------------
-- Written ONLY by trigger (below), and 013 gives it a select-only policy so
-- nobody can delete their own trail. The folio ledger is already append-only;
-- everything else was silently mutable.
-- -----------------------------------------------------------------------------
create table if not exists audit_log (
  id          bigserial primary key,
  hotel_id    uuid,
  actor       uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,
  before      jsonb,
  after       jsonb,
  at          timestamptz not null default now()
);

create index if not exists audit_log_hotel_idx on audit_log (hotel_id, at desc);
create index if not exists audit_log_row_idx   on audit_log (table_name, row_id);

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

  insert into audit_log (hotel_id, actor, table_name, row_id, action, before, after)
  values (v_hotel, app.current_user_id(), tg_table_name, v_row, tg_op, v_before, v_after);

  -- AFTER trigger: the return value is ignored, but it must not reference an
  -- unassigned record.
  if tg_op = 'DELETE' then return old; else return new; end if;
end
$$;

-- Attach to the tables where "who changed this" is a question somebody will ask.
do $$
declare t text;
begin
  foreach t in array array[
    'reservations','room_assignments','folios','rooms',
    'staff','staff_hotels','guests','companies','invoices'
  ] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function app.write_audit()', t, t);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- C4 — idempotency keys. Offline tolerance guarantees retries.
-- -----------------------------------------------------------------------------
-- A POS terminal on dropping wifi WILL resend. Without a key the second write
-- succeeds and a real guest is charged twice — and because the ledger is
-- append-only, correcting it needs a human to notice first.
-- -----------------------------------------------------------------------------
alter table folio_postings add column if not exists idempotency_key uuid;

create unique index if not exists folio_postings_idem_idx
  on folio_postings (hotel_id, idempotency_key)
  where idempotency_key is not null;

insert into schema_migrations (version) values ('011_model_additions')
on conflict (version) do nothing;
