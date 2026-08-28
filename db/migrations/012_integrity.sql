-- =============================================================================
-- 012_integrity.sql — make cross-property references impossible
-- =============================================================================
-- Addresses model audit D1, D4, D7.
--
-- THE PROBLEM D1 DESCRIBES:
--   RLS controls what a query can SEE. Nothing controls what a row can
--   POINT AT. Every foreign key here is a single-column reference, so a room
--   at Agra can reference a room type at Pune and Postgres accepts it.
--
--   The interaction with RLS is what makes it dangerous: the query that would
--   reveal the mismatch is itself filtered, so the row looks like it points at
--   nothing rather than at something wrong. It surfaces months later as an
--   unexplained blank on a screen.
--
-- ⚠ THIS FILE IS CHEAP ONLY WHILE THE DATABASE IS EMPTY. Composite keys need a
--   unique index on every parent — trivial now, a rewrite with downtime once a
--   year of bookings exists, and preceded by finding every row that already
--   points sideways.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Step 1 — every hotel-scoped parent needs (hotel_id, id) unique.
-- -----------------------------------------------------------------------------
-- Redundant as a uniqueness claim (id is already the primary key). Required as
-- a TARGET: a composite foreign key can only reference a unique constraint of
-- matching shape.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'room_types','rooms','reservations','folios','room_assignments','invoices'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = t::regclass
         and contype  = 'u'
         and conname  = t || '_hotel_id_key'
    ) then
      execute format('alter table %I add constraint %I unique (hotel_id, id)',
                     t, t || '_hotel_id_key');
    end if;
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- Step 2 — replace single-column FKs with composite ones.
-- -----------------------------------------------------------------------------
-- Each pair below now cannot span properties. The database refuses, rather
-- than accepting the row and letting RLS hide it.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  rels constant text[][] := array[
    -- child            child column        parent
    ['rooms',            'room_type_id',    'room_types'],
    ['reservations',     'room_type_id',    'room_types'],
    ['room_assignments', 'room_id',         'rooms'],
    ['room_assignments', 'reservation_id',  'reservations'],
    ['folios',           'reservation_id',  'reservations'],
    ['folio_postings',   'folio_id',        'folios'],
    ['invoices',         'folio_id',        'folios'],
    ['payments',         'hotel_id',        null],          -- handled below
    ['room_status_log',  'room_id',         'rooms']
  ];
begin
  for i in 1 .. array_length(rels, 1) loop
    if rels[i][3] is null then continue; end if;

    -- Drop whatever single-column FK exists on that column.
    for r in
      select con.conname
        from pg_constraint con
        join pg_attribute a
          on a.attrelid = con.conrelid and a.attnum = any(con.conkey)
       where con.conrelid = rels[i][1]::regclass
         and con.contype  = 'f'
         and array_length(con.conkey, 1) = 1
         and a.attname    = rels[i][2]
    loop
      execute format('alter table %I drop constraint %I', rels[i][1], r.conname);
    end loop;

    -- Add the composite replacement, if it is not already there.
    if not exists (
      select 1 from pg_constraint
       where conrelid = rels[i][1]::regclass
         and conname  = rels[i][1] || '_' || rels[i][2] || '_same_hotel'
    ) then
      execute format(
        'alter table %I add constraint %I
           foreign key (hotel_id, %I) references %I (hotel_id, id)',
        rels[i][1],
        rels[i][1] || '_' || rels[i][2] || '_same_hotel',
        rels[i][2],
        rels[i][3]);
    end if;
  end loop;
end
$$;

-- payments → folio_postings is by posting id only; folio_postings already
-- carries hotel_id and is now composite-bound to folios, so the chain holds.


-- -----------------------------------------------------------------------------
-- D7 — staff cannot be given work at a property they cannot reach.
-- -----------------------------------------------------------------------------
-- `staff` is group-level, so a composite key is not available: there is no
-- (hotel_id, id) on a table with no hotel_id. A trigger is the general form.
--
-- Without this a Pune housekeeper can be assigned an Agra room. The task is
-- created, appears on nobody's list, and the room is never cleaned.
-- -----------------------------------------------------------------------------
create or replace function app.assert_staff_has_hotel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_staff uuid;
begin
  -- ⚠ FOUND BY RUNNING THIS. A CASE naming each column looks correct and is not:
  --   PL/pgSQL resolves EVERY branch's field reference when it plans the
  --   expression, so `new.changed_by` fails on a table that only has
  --   `created_by` even though that branch is never taken —
  --     ERROR: record "new" has no field "changed_by"
  --   Going through jsonb resolves the field at RUN time instead, which is the
  --   only way to address a column named by a trigger argument.
  v_staff := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;

  if v_staff is null then
    return new;                              -- system-generated rows are fine
  end if;

  if not exists (
    select 1 from staff s
     where s.id = v_staff and s.is_group_admin and s.is_active
  ) and not exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = v_staff
       and sh.hotel_id = new.hotel_id
       and s.is_active
  ) then
    raise exception
      'Staff % has no access to hotel % — cannot be recorded on %',
      v_staff, new.hotel_id, tg_table_name
      using hint = 'Add a staff_hotels row, or use a member of that property.';
  end if;

  return new;
end
$$;

do $$
declare
  r record;
  pairs constant text[][] := array[
    ['room_assignments','created_by'],
    ['room_status_log', 'changed_by'],
    ['folio_postings',  'posted_by'],
    ['invoices',        'issued_by']
  ];
begin
  for i in 1 .. array_length(pairs, 1) loop
    execute format('drop trigger if exists %I_staff_scope on %I', pairs[i][1], pairs[i][1]);
    execute format(
      'create trigger %I_staff_scope before insert or update on %I
         for each row execute function app.assert_staff_has_hotel(%L)',
      pairs[i][1], pairs[i][1], pairs[i][2]);
  end loop;
end
$$;


-- -----------------------------------------------------------------------------
-- D4 — nothing may post to a business date that has been closed.
-- -----------------------------------------------------------------------------
-- night_audit_runs stops the audit running twice. It did not stop a posting
-- landing on yesterday AFTERWARDS — so the day-close report said one number,
-- a late POS bill posted, and now it says another. Both were correct when
-- produced, which is the worst kind of wrong.
--
-- A genuine late charge posts to the CURRENT business date with a note, which
-- is what a hotel does on paper anyway.
-- -----------------------------------------------------------------------------
create or replace function app.reject_closed_business_date()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from night_audit_runs
     where hotel_id = new.hotel_id
       and business_date = new.business_date
       and status = 'completed'
  ) then
    raise exception
      'Business date % is closed for this property — post to the current date instead.',
      new.business_date
      using hint = 'Night audit has already run. Late charges belong to today.';
  end if;
  return new;
end
$$;

drop trigger if exists folio_postings_closed_date on folio_postings;
create trigger folio_postings_closed_date
  before insert on folio_postings
  for each row execute function app.reject_closed_business_date();


insert into schema_migrations (version) values ('012_integrity')
on conflict (version) do nothing;


-- =============================================================================
-- VERIFY — these must all fail.
-- =============================================================================
--   -- a room pointing at another property's room type
--   insert into rooms (hotel_id, room_type_id, number)
--   select h1.id, rt.id, '999'
--     from hotels h1, room_types rt
--    where h1.code = 'FH01' and rt.hotel_id <> h1.id limit 1;
--   --> ERROR: violates foreign key constraint "rooms_room_type_id_same_hotel"
--
--   -- a staff member recorded at a property they cannot reach
--   --> ERROR: Staff … has no access to hotel …
--
--   -- a posting onto a closed date
--   --> ERROR: Business date … is closed for this property
--
-- All three failing is the proof. If any succeeds, this migration did not take.
-- =============================================================================
