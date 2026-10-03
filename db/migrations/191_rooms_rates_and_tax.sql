-- =============================================================================
-- 191 · Rooms, rates and tax in the Settings console (P3; D27-249 to D27-254,
--       the owner's answers D27-258) - "191 for now", the master renumbers
-- =============================================================================
-- Additive only: new columns, new tables. Nothing earlier changes its return
-- type (MEMORY 317), and nothing here prices anything by itself.
--
--   1  room types: base and maximum adults AND children, beds, view, size,
--      colour (base_occupancy stays the base ADULTS and max_occupancy the
--      total, as every reader already takes them)
--   2  rooms in the order the owner drags them
--   3  a room type's own photos (186's checks; ten a type, the API counts)
--   4  a room type's amenities, from P2's one catalogue (`amenities`, 190)
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
/* P2's catalogue (190) comes first on every replay; on a copy without it yet,
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
  constraint tax_sac_kind check (kind in ('room', 'restaurant', 'bar', 'banquet', 'other')),
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
