-- =============================================================================
-- 195 · Rooms, rates and tax in the Settings console (P3; D27-249 to D27-254,
--       the owner's answers D27-258) - "195 for now", the master renumbers
-- =============================================================================
-- Additive only: new columns, new tables. Nothing earlier changes its return
-- type (MEMORY 317), and nothing here prices anything by itself.
--
--   1  room types: base and maximum adults AND children, beds, view, size,
--      colour (base_occupancy stays the base ADULTS and max_occupancy the
--      total, as every reader already takes them)
--   2  rooms in the order the owner drags them
--   3  a room type's own photos (186's checks; ten a type, the API counts)
--   4  a room type's amenities, from P2's one catalogue (`amenities`, 194)
--   5  a rate plan ("Room type · Meal plan", D27-251) switched Off, and its
--      place in the tree - prices stay where they are (090, 162)
--   6  which booking sources sell a plan: no rows = every source (Q4)
--   7  meal plans by day: which days each meal is served (Q5)
--   8  tax rules with validity dates (Q7), and a SAC code per tax kind (Q6)
-- =============================================================================

-- 1 · room types ---------------------------------------------------------------
alter table room_types
  add column if not exists base_children smallint not null default 0,
  add column if not exists max_adults    smallint,
  add column if not exists max_children  smallint,
  add column if not exists beds          text,
  add column if not exists view_type     text,
  add column if not exists size_sqft     int,
  add column if not exists colour        text;

/* NULL max_adults / max_children: only the total limit applies (as before).
   Children stay below the total, SU's own rule (106). */
alter table room_types drop constraint if exists room_types_people_fit;
alter table room_types add constraint room_types_people_fit check (
  base_children >= 0
  and base_occupancy + base_children <= max_occupancy
  and (max_adults is null or max_adults between greatest(base_occupancy, 1) and max_occupancy)
  and (max_children is null or (max_children >= base_children and max_children < max_occupancy)));

alter table room_types drop constraint if exists room_types_words_fit;
alter table room_types add constraint room_types_words_fit check (
  (beds is null or char_length(beds) between 1 and 60)
  and (view_type is null or char_length(view_type) between 1 and 60)
  and (size_sqft is null or size_sqft between 1 and 100000)
  and (colour is null or colour ~ '^#[0-9a-f]{6}$'));

-- 2 · rooms in order ------------------------------------------------------------
alter table rooms add column if not exists position int not null default 0;

-- 3 · a room type's photos (186's rules, for a type) ---------------------------
create table if not exists room_type_photos (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete cascade,
  position      int  not null default 0,
  caption       text,
  photo         bytea not null,
  width         int  not null,
  height        int  not null,
  added_by      uuid references staff(id),
  added_at      timestamptz not null default now(),

  constraint room_type_photos_size    check (octet_length(photo) between 1 and 614400),
  constraint room_type_photos_side    check (width between 1 and 1600 and height between 1 and 1600),
  constraint room_type_photos_caption check (caption is null or char_length(caption) between 1 and 120)
);
create index if not exists room_type_photos_type on room_type_photos (room_type_id, position);

-- 4 · a room type's amenities ---------------------------------------------------
create table if not exists room_type_amenities (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete cascade,
  amenity_id    uuid not null,
  unique (room_type_id, amenity_id)
);
/* P2's catalogue (194) comes first on every replay; on a copy without it yet,
   the link waits for it. */
do $$
begin
  if to_regclass('public.amenities') is not null
     and not exists (select 1 from pg_constraint where conname = 'room_type_amenities_amenity') then
    alter table room_type_amenities add constraint room_type_amenities_amenity
      foreign key (amenity_id) references amenities(id) on delete cascade;
  end if;
end $$;

-- 5 · a rate plan Off, and its place --------------------------------------------
create table if not exists rate_plan_settings (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete cascade,
  meal_plan     text not null references meal_plans(code),
  is_active     boolean not null default true,
  position      int not null default 0,
  unique (room_type_id, meal_plan)
);
comment on table rate_plan_settings is
  'A rate plan is a room type on a meal plan, priced by 090/162 alone (D27-251). '
  'This keeps only whether it is offered for NEW bookings (Off: not offered; '
  'prices and bookings untouched, D27-258) and its place. No row = On.';

-- 6 · which sources sell a plan --------------------------------------------------
create table if not exists rate_plan_sources (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references hotels(id) on delete cascade,
  room_type_id       uuid not null references room_types(id) on delete cascade,
  meal_plan          text not null references meal_plans(code),
  booking_source_id  uuid not null references booking_sources(id) on delete cascade,
  unique (room_type_id, meal_plan, booking_source_id)
);
comment on table rate_plan_sources is
  'The booking sources that sell a plan. No row for a plan = every source does '
  '(nothing changes until somebody chooses). SU''s own mapping (106) is apart.';

-- 7 · meal plans by day ----------------------------------------------------------
create table if not exists hotel_meal_days (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  meal_plan  text not null references meal_plans(code),
  breakfast  text[] not null default '{}',
  lunch      text[] not null default '{}',
  dinner     text[] not null default '{}',
  unique (hotel_id, meal_plan),
  constraint hotel_meal_days_known check (
    breakfast <@ array['arrival', 'stay', 'departure']
    and lunch <@ array['arrival', 'stay', 'departure']
    and dinner <@ array['arrival', 'stay', 'departure'])
);
comment on table hotel_meal_days is
  'On which days of a stay each meal of a plan is served: arrival (the check-in '
  'day), stay (a stay-over day), departure (the check-out day). Shown on the '
  'plan''s summary and the guest''s voucher (D27-258). No row = not said.';

-- 8 · tax: validity, and a SAC per kind ------------------------------------------
alter table tax_rules
  add column if not exists valid_from date,
  add column if not exists valid_to   date;
alter table tax_rules drop constraint if exists tax_rules_valid_range;
alter table tax_rules add constraint tax_rules_valid_range
  check (valid_to is null or valid_from is null or valid_to > valid_from);
comment on column tax_rules.valid_from is
  'With valid_to, half-open by the business date (D27-258 Q7). NULL from: since always; NULL to: current.';

create table if not exists tax_sac (
  id        uuid primary key default gen_random_uuid(),
  hotel_id  uuid not null references hotels(id) on delete cascade,
  kind      text not null,
  sac_code  text not null,
  unique (hotel_id, kind),
  constraint tax_sac_code check (sac_code ~ '^[0-9]{6}$')
);
comment on table tax_sac is
  'The SAC printed on an invoice line of this kind (D27-258 Q6). No row for '
  'rooms = 996311 as before; for the others a dash - codes are never guessed.';

-- Access: read by everybody who works there; the API's roleGate guards writes,
-- as it does for tax_rules (067) and the rates.
do $$
declare t text;
begin
  foreach t in array array['room_type_photos', 'room_type_amenities', 'rate_plan_settings',
                           'rate_plan_sources', 'hotel_meal_days', 'tax_sac'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_isolation', t);
    execute format('create policy %I on %I for all
                      using ( hotel_id in (select app.auth_hotel_ids()) )
                      with check ( hotel_id in (select app.auth_hotel_ids()) )', t || '_isolation', t);
    execute format('grant select, insert, update, delete on %I to pms_app', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I
                      for each row execute function app.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- 9 · a new hotel starts empty (D27-263) ---------------------------------------
-- The owner, 3 October: no automatic STD/DLX/EXE/STE. The mechanism keeps its
-- templates for the migrations, the demo loader and the tests' fixtures, which
-- name one; the set 'none' copies nothing. The door (Add a hotel) always asks
-- for 'none' - its p_template_set stays only so its signature does not move
-- (MEMORY 317). Room types are then added by hand, on Settings → Rooms.
create or replace function app.provision_property_unchecked(
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
  v_types    integer := 0;
begin
  perform app.require_group_admin();

  insert into hotels (code, name, city, state, gstin, timezone)
  values (upper(p_code), p_name, p_city, p_state, p_gstin, p_timezone)
  returning id into v_hotel_id;

  if p_template_set is distinct from 'none' then
    /* base_rate is deliberately absent from this column list. The room types
       arrive named and sized; the hotel prices them. */
    insert into room_types (hotel_id, code, name, base_occupancy,
                            max_occupancy, sort_order)
    select v_hotel_id, t.code, t.name, t.base_occupancy,
           t.max_occupancy, t.sort_order
      from room_type_templates t
     where t.template_set = p_template_set;

    get diagnostics v_types = row_count;

    if v_types = 0 then
      raise exception 'No room type templates found for set "%"', p_template_set
        using hint = 'Check room_type_templates, or pass a different p_template_set.';
    end if;
  end if;

  -- S1: without this the property cannot issue its first invoice.
  -- `on conflict` because 025 opens one from a trigger on hotels as well.
  insert into invoice_series (hotel_id, fin_year, prefix, next_number)
  values (v_hotel_id, app.current_fin_year(), upper(p_code), 1)
  on conflict (hotel_id, fin_year) do nothing;

  raise notice 'Provisioned % (%) with % room types and no prices.',
               p_name, upper(p_code), v_types;
  return v_hotel_id;
end
$$;

create or replace function app.provision_property(
  p_code          text,
  p_name          text,
  p_city          text,
  p_key_hash      text,
  p_state         text default null,
  p_gstin         text default null,
  p_template_set  text default 'standard',
  p_timezone      text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app.require_group_admin();
  perform app.require_provisioning_key(p_key_hash);

  /* D27-263: a new hotel starts with no room types, whatever was asked. */
  return app.provision_property_unchecked(
    p_code         => p_code,
    p_name         => p_name,
    p_city         => p_city,
    p_state        => p_state,
    p_gstin        => p_gstin,
    p_template_set => 'none',
    p_timezone     => p_timezone
  );
end $$;

-- 10 · tax rules by the business date (D27-258 Q7) ---------------------------
-- A slab may now have periods: the same kind and threshold, one rate until a
-- date and another from it (a GST change). One row per slab per start date;
-- the lookup takes the rows valid on the hotel's business date. A rule with no
-- dates is valid always, as every rule before this was. gst_rate_or_null keeps
-- its signature and stays the one place the slab is written (067).
alter table tax_rules drop constraint if exists tax_rules_hotel_id_kind_over_amount_key;
create unique index if not exists tax_rules_one_slab_a_period
  on tax_rules (hotel_id, kind, over_amount, coalesce(valid_from, '-infinity'::date));

create or replace function app.gst_rate_or_null(
  p_hotel uuid,
  p_kind  text,
  p_value numeric
) returns numeric
language sql
stable
as $$
  select rate
    from tax_rules
   where hotel_id = p_hotel
     and kind = p_kind
     and (valid_from is null or valid_from <= app.business_date(p_hotel))
     and (valid_to is null or app.business_date(p_hotel) < valid_to)
     -- The base row (0) always applies; a higher slab applies only when the
     -- value is strictly above it (067).
     and (over_amount = 0 or coalesce(p_value, 0) > over_amount)
   order by over_amount desc, valid_from desc nulls last
   limit 1
$$;

-- 11 · meal days on the voucher (D27-258 Q5) ----------------------------------
-- The voucher is drawn by the sweep with nobody signed in, so its meal days
-- come through a definer, as app.guest_voucher's facts do: the hotel's meal
-- days for the booking's hotel, and nothing else.
create or replace function app.voucher_meal_days(p_reservation uuid)
returns table (meal_plan text, breakfast text[], lunch text[], dinner text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.meal_plan, d.breakfast, d.lunch, d.dinner
    from hotel_meal_days d
    join reservations r on r.hotel_id = d.hotel_id
   where r.id = p_reservation
$$;
revoke all on function app.voucher_meal_days(uuid) from public;
grant execute on function app.voucher_meal_days(uuid) to pms_app;
