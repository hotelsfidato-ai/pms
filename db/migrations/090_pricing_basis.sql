-- =============================================================================
-- 090 — one base price, and everything else a difference from it
-- =============================================================================
-- The owner, 16 September 2026: "a Deluxe room which is single occupancy and
-- with no breakfast — this is the cheapest room offered … create a [system]
-- where this room is the base price and other things are connected by a
-- difference to this, so that when a change happens it reflects all through
-- the system."
--
-- Until now every price stood alone. A Deluxe on EP in December and a Superior
-- on CP in December were two unrelated numbers in `rates`, and moving one
-- moved nothing. This makes one figure the base and lets the rest hang off it.
--
-- FOUR THINGS ARE TRUE OF EVERY LINE BELOW, and they are the owner's, not
-- mine:
--
--   1. THE BASE IS ONE PERSON. Counting starts at the first head: two adults
--      are the base plus one extra adult. `covers_persons` below is how that
--      arrives without repricing a single thing already sold.
--   2. THE BASE IS NOT THE DEFAULT. How many people a room is SOLD for stays
--      on the room type (`base_occupancy`). Nothing here changes it.
--   3. NOT EVERYTHING IS DERIVED. A typed price beats a derived one, always.
--   4. NOTHING SHIPS PRICED. No property has a basis until somebody sets one,
--      and no difference exists until somebody types it. Until then this file
--      changes the behaviour of precisely nothing.
--
-- WHAT IS DELIBERATELY NOT HERE: no percentages (the owner: differences are in
-- rupees), no occupancy-based yield, no automatic anything. A difference is a
-- number a person typed, with dates on it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A room type gains a category
-- -----------------------------------------------------------------------------
-- The owner, the same day: room CONFIGURATION and room PRICE are two different
-- things. In configuration there is a make and a sub-category — "Deluxe",
-- "Deluxe with a valley view", "Deluxe with an extra bed" — and each holds a
-- different number of people.
--
-- Each of those stays its own room type, because the room type is what this
-- whole system sells: rooms point at it, availability counts it, the tape
-- chart draws it and every booking names it. The category is a LABEL that
-- groups them, so the three Deluxes sit together on a screen and each still
-- carries its own capacity and its own difference from the base.
--
-- NULL is a type that belongs to no group, which is every type today.
-- -----------------------------------------------------------------------------
alter table room_types add column if not exists category text;

comment on column room_types.category is
  'Groups sellable types that are variations of one room — Deluxe, Deluxe '
  'valley view, Deluxe with an extra bed. A label for the screens; it sells '
  'nothing on its own. NULL means the type belongs to no group.';


-- -----------------------------------------------------------------------------
-- A price says how many people it covers
-- -----------------------------------------------------------------------------
-- THIS IS THE LINE THAT KEEPS TODAY'S PRICES MEANING WHAT THEY MEAN.
--
-- Every price in this database was typed to cover what the room type says it
-- covers — `base_occupancy`, which is 2 at 5 Elements. The new base covers
-- ONE person. If the counting simply changed under everything, every
-- two-adult booking would quietly gain an extra-adult charge: a price change
-- nobody asked for, discovered at a check-out.
--
-- So the price carries the answer. NULL means "whatever the room type says",
-- which is every row that exists — so nothing already written moves. The base
-- row the new screen writes will carry 1.
-- -----------------------------------------------------------------------------
alter table rates add column if not exists covers_persons smallint;

alter table rates drop constraint if exists rates_covers_sane;
alter table rates add constraint rates_covers_sane
  check (covers_persons is null or covers_persons >= 1);

comment on column rates.covers_persons is
  'How many people this price covers before the extra-person rates start. '
  'NULL means the room type''s own base_occupancy, which is what every row '
  'written before 16 September 2026 meant.';


-- -----------------------------------------------------------------------------
-- Which price is the base — a pointer, not a number
-- -----------------------------------------------------------------------------
-- The base is not a new figure kept somewhere else. It is a POINTER at a room
-- type and a meal plan; the figure itself stays in `rates`, where it already
-- has seasons, the constraint that refuses two prices for one day, an audit
-- trail and a screen.
--
-- That is what makes the owner's sentence true without a feature to build:
-- change the base figure, and every derived price moves, because each one
-- reads it on the date in question.
--
-- One row per property. A hotel has one cheapest room, not a list of them.
-- -----------------------------------------------------------------------------
create table if not exists pricing_basis (
  hotel_id     uuid primary key references hotels(id) on delete cascade,
  room_type_id uuid not null references room_types(id) on delete restrict,
  meal_plan    text not null references meal_plans(code),
  set_by       uuid references staff(id),
  set_at       timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table pricing_basis is
  'The room type and meal plan whose price is this property''s base — Deluxe '
  'on room-only, for one person. No property has one until somebody sets it, '
  'and nothing derives a price without it.';

drop trigger if exists pricing_basis_touch on pricing_basis;
create trigger pricing_basis_touch before update on pricing_basis
  for each row execute function app.touch_updated_at();

alter table pricing_basis enable row level security;
alter table pricing_basis force  row level security;
drop policy if exists hotel_isolation on pricing_basis;
create policy hotel_isolation on pricing_basis
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update, delete on pricing_basis to pms_app;


-- -----------------------------------------------------------------------------
-- A difference — in rupees, with dates on it
-- -----------------------------------------------------------------------------
-- Two kinds, because the hotel names two:
--
--   room_type   a Superior is ₹___ more than the base room     per ROOM
--   meal_plan   breakfast is ₹___ more than room only          per PERSON
--
-- The owner decided both: differences are in rupees and never percentages,
-- and meal plans are priced per person.
--
-- NEGATIVE IS ALLOWED. The base is the cheapest thing sold today, so every
-- difference should be positive — but a hotel that one day sells something
-- below it should not have to fight the schema, and the screen can say so
-- where it happens.
--
-- TWO DIFFERENCES FOR ONE DAY IS THE SAME UNANSWERABLE STATE TWO PRICES ARE,
-- and is refused here at write time, exactly as `rates` refuses it — where
-- somebody can still fix it, rather than at a checkout.
-- -----------------------------------------------------------------------------
create table if not exists rate_offsets (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,

  kind         text not null,                       -- 'room_type' | 'meal_plan'
  room_type_id uuid references room_types(id) on delete cascade,
  meal_plan    text references meal_plans(code),

  amount       numeric(12,2) not null,              -- RUPEES. May be negative.

  /* Half-open, like `rates` and every other range here: a difference from the
     1st to the 15th covers the 1st through the 14th. NULL is open-ended. */
  valid_from   date not null,
  valid_to     date,

  label        text,                                -- "Diwali", the hotel's word
  created_by   uuid references staff(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint rate_offsets_kind_valid
    check (kind in ('room_type', 'meal_plan')),

  /* A row names exactly the thing its kind is about. Without this a
     'meal_plan' row could carry a room type nothing would ever read. */
  constraint rate_offsets_names_its_subject check (
    (kind = 'room_type' and room_type_id is not null and meal_plan is null)
    or
    (kind = 'meal_plan' and meal_plan is not null and room_type_id is null)
  ),

  constraint rate_offsets_range_sane
    check (valid_to is null or valid_to > valid_from),

  constraint rate_offsets_no_overlap exclude using gist (
    hotel_id with =,
    kind     with =,
    coalesce(room_type_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(meal_plan, '') with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  )
);

create index if not exists rate_offsets_lookup
  on rate_offsets (hotel_id, kind, valid_from);

comment on table rate_offsets is
  'What a room type or a meal plan costs ABOVE this property''s base, in '
  'rupees, over a date range. A room-type difference is per room; a meal-plan '
  'difference is per person. Written by the hotel; this schema ships none.';

drop trigger if exists rate_offsets_touch on rate_offsets;
create trigger rate_offsets_touch before update on rate_offsets
  for each row execute function app.touch_updated_at();

alter table rate_offsets enable row level security;
alter table rate_offsets force  row level security;
drop policy if exists hotel_isolation on rate_offsets;
create policy hotel_isolation on rate_offsets
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update, delete on rate_offsets to pms_app;


-- -----------------------------------------------------------------------------
-- The difference that applies on a date
-- -----------------------------------------------------------------------------
-- ZERO WHEN NOTHING COVERS THE DATE, and that is the owner's own rule, not an
-- invented figure: "a difference may be set for a period; where nothing is set
-- for a date, the base applies". A Superior with no difference set sells at
-- the base, which is what they asked for and what the screen will say in
-- words.
--
-- This is the ONE place in this schema where a missing number means zero, and
-- it means zero because the sentence it implements says so. A missing BASE is
-- still NULL — see below.
-- -----------------------------------------------------------------------------
create or replace function app.offset_for(
  p_hotel uuid, p_kind text, p_room_type uuid, p_meal_plan text, p_date date
)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select o.amount
       from rate_offsets o
      where o.hotel_id = p_hotel
        and o.kind     = p_kind
        and (p_kind <> 'room_type' or o.room_type_id = p_room_type)
        and (p_kind <> 'meal_plan' or o.meal_plan    = p_meal_plan)
        and p_date >= o.valid_from
        and (o.valid_to is null or p_date < o.valid_to)
      limit 1),
    0);
$$;

comment on function app.offset_for(uuid, text, uuid, text, date) is
  'The difference in rupees that applies on a date, or zero where none is set '
  '— the owner''s rule: where nothing is set for a date, the base applies.';


-- -----------------------------------------------------------------------------
-- A price, and what it covers
-- -----------------------------------------------------------------------------
-- Three layers, in this order, and the order is the whole design:
--
--   typed    a rates row covering this date for this type and plan. It wins
--            outright — the owner sets some prices directly and a derived
--            number must never quietly overrule one they typed.
--   derived  the base figure on that date + the room type's difference + the
--            meal plan's difference. Covers ONE person, because the base does.
--   rack     the room type's own `base_rate`, the fallback that predates all
--            of this.
--   NULL     nobody has priced it. A dash on the screen. NEVER a zero.
--
-- THE BASE IS NOT TAKEN FROM A RACK RATE. A rack rate was typed to cover the
-- room type's base occupancy, and reading it as a one-person figure would
-- reinterpret a number somebody else wrote. So the base comes only from a
-- `rates` row on the basis pair; where there is none, nothing derives.
-- -----------------------------------------------------------------------------
drop function if exists app.price_for(uuid, text, date);

create function app.price_for(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date
)
returns table (
  price  numeric,
  covers int,     -- how many people that price covers
  source text     -- 'typed' | 'derived' | 'rack' | NULL
)
language plpgsql
stable
as $$
declare
  v_hotel      uuid;
  v_base_occ   int;
  v_basis      record;
  v_base_price numeric;
begin
  select rt.hotel_id, rt.base_occupancy into v_hotel, v_base_occ
    from room_types rt where rt.id = p_room_type;

  /* 1 · typed */
  select r.price, coalesce(r.covers_persons, v_base_occ, 2), 'typed'
    into price, covers, source
    from rates r
   where r.room_type_id = p_room_type
     and r.meal_plan    = p_meal_plan
     and p_date >= r.valid_from
     and (r.valid_to is null or p_date < r.valid_to)
   limit 1;
  if price is not null then
    return next;
    return;
  end if;

  /* 2 · derived */
  select b.room_type_id, b.meal_plan into v_basis
    from pricing_basis b where b.hotel_id = v_hotel;

  if v_basis.room_type_id is not null then
    select r.price into v_base_price
      from rates r
     where r.room_type_id = v_basis.room_type_id
       and r.meal_plan    = v_basis.meal_plan
       and p_date >= r.valid_from
       and (r.valid_to is null or p_date < r.valid_to)
     limit 1;

    if v_base_price is not null then
      /* THE BASE HAS NO DIFFERENCE FROM ITSELF. A room-type difference on the
         basis type is not a smaller or larger version of the base — there is
         nothing for it to differ from, and applying it would make the base
         room cost more on breakfast than the arithmetic anybody expects.
         Found by db/tests/modules/inventory.sql, which asserted the opposite
         and was wrong.

         A SEASON ON THE BASE IS A TYPED BASE ROW for those dates — Diwali is
         a price on the basis pair, through app.set_rate, and every derived
         price follows it because they all read the base on the date. */
      price  := v_base_price
              + case when p_room_type = v_basis.room_type_id then 0
                     else app.offset_for(v_hotel, 'room_type',
                                         p_room_type, null, p_date) end
              + app.offset_for(v_hotel, 'meal_plan', null, p_meal_plan, p_date);
      /* The base is one person, so a derived price is one person's. */
      covers := 1;
      source := 'derived';
      return next;
      return;
    end if;
  end if;

  /* 3 · rack */
  select rt.base_rate, coalesce(v_base_occ, 2), 'rack'
    into price, covers, source
    from room_types rt where rt.id = p_room_type;
  if price is not null then
    return next;
    return;
  end if;

  /* 4 · nobody has priced it. */
  price := null; covers := coalesce(v_base_occ, 2); source := null;
  return next;
end $$;

comment on function app.price_for(uuid, text, date) is
  'What a room type costs on a plan on a date, AND how many people that price '
  'covers: a typed rate row, else a price derived from the property''s base, '
  'else the type''s rack rate, else NULL. Never zero.';

grant execute on function app.offset_for(uuid, text, uuid, text, date) to pms_app;
grant execute on function app.price_for(uuid, text, date) to pms_app;


-- -----------------------------------------------------------------------------
-- app.rate_for keeps its name, its signature and its meaning
-- -----------------------------------------------------------------------------
-- Everything that asks what a room costs goes through this — the rate grid
-- (052), the tariff (057) and the database suite, and nothing else. It still
-- answers "the price of a room type on a plan on a date", and still answers
-- NULL rather than zero; it has simply gained the derived layer in the middle.
-- -----------------------------------------------------------------------------
create or replace function app.rate_for(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date
)
returns numeric
language sql
stable
as $$
  select p.price from app.price_for(p_room_type, p_meal_plan, p_date) p;
$$;

comment on function app.rate_for(uuid, text, date) is
  'The price of a room type on a plan on a date: a typed rate row, else a '
  'price derived from the property''s base, else the type''s rack rate, else '
  'NULL. Never zero — an unpriced room is not a free one. What that price '
  'covers is in app.price_for.';


-- -----------------------------------------------------------------------------
-- The night, for a party — counted from what the price actually covers
-- -----------------------------------------------------------------------------
-- The only change: `base_occupancy` gives way to what the covering price
-- covers. For every row in this database that is the same number, because
-- `covers_persons` is NULL everywhere until the new screen writes a base. For
-- a derived price it is one, which is the owner's decision: two adults are the
-- base plus one extra adult.
--
-- Everything else stands, and it is the part that matters: a total is NULL,
-- with `unpriced` naming what is missing, whenever any part has no price. An
-- unpriced extra person is not a free one.
-- -----------------------------------------------------------------------------
create or replace function app.tariff_for(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date,
  p_adults    int,
  p_children  int
)
returns table (
  base            numeric,
  extra_adults    int,
  adult_rate      numeric,
  extra_children  int,
  child_rate      numeric,
  total           numeric,   -- NULL when anything needed has no price
  unpriced        text       -- what is missing, in words
)
language plpgsql stable as $$
declare
  v_covers  int;
  v_missing text[] := '{}';
begin
  select p.price, p.covers into base, v_covers
    from app.price_for(p_room_type, p_meal_plan, p_date) p;

  /* Adults first, then children into whatever covered slots are left. A
     child takes a covered slot when one is free: charging a couple's toddler
     while an identical room with two adults pays nothing is the kind of
     arithmetic a guest notices at the desk. */
  extra_adults   := greatest(p_adults - coalesce(v_covers, 2), 0);
  extra_children := greatest(
    p_children - greatest(coalesce(v_covers, 2) - p_adults, 0), 0);

  select a.adult, a.child into adult_rate, child_rate
    from app.extra_person_rates(p_room_type, p_meal_plan, p_date) a;

  /* array_append, not `||`. Against an untyped literal the operator is
     ambiguous and Postgres tries to read 'the room' AS an array. */
  if base is null then
    v_missing := array_append(v_missing, 'the room');
  end if;
  if extra_adults > 0 and adult_rate is null then
    v_missing := array_append(v_missing, case when extra_adults = 1
      then 'the extra adult' else extra_adults || ' extra adults' end);
  end if;
  if extra_children > 0 and child_rate is null then
    v_missing := array_append(v_missing, case when extra_children = 1
      then 'the extra child' else extra_children || ' extra children' end);
  end if;

  if array_length(v_missing, 1) is null then
    total := base
           + extra_adults   * coalesce(adult_rate, 0)
           + extra_children * coalesce(child_rate, 0);
    unpriced := null;
  else
    /* NOT a partial total. A number that silently omits the third person is
       the one nobody checks, and it is discovered at check-out. */
    total := null;
    unpriced := array_to_string(v_missing, ' and ');
  end if;

  return next;
end $$;

comment on function app.tariff_for(uuid, text, date, int, int) is
  'One night for a given party: the room, the extra persons beyond what the '
  'price covers, and the total — which is NULL, with `unpriced` naming what '
  'is missing, whenever any part of it has no price. An unpriced extra person '
  'is not a free one.';

grant execute on function app.tariff_for(uuid, text, date, int, int) to pms_app;


-- -----------------------------------------------------------------------------
-- Setting a difference over a range — the same splitting `rates` needs
-- -----------------------------------------------------------------------------
-- A property has a standing difference for a room type and then wants a
-- different one for Diwali. Two rows covering one day are refused, correctly —
-- so somebody has to trim the standing one, write the fortnight, and put the
-- tail back. That is exactly what app.set_rate does for prices (053), and the
-- one case it warns about is the tail: forget it and the property silently
-- loses its pricing after the season ends.
--
-- FOUND BY THE GATE. db/tests/modules/inventory.sql wrote a seasonal
-- difference on top of a standing one and the exclusion constraint refused it,
-- which is the moment this function was missing.
--
-- A NULL amount CLEARS the range rather than writing a zero — the same
-- distinction as a cleared price. Nothing set means the base applies; that is
-- the owner's rule and it does not need a row saying so.
-- -----------------------------------------------------------------------------
create or replace function app.set_offset(
  p_hotel     uuid,
  p_kind      text,               -- 'room_type' | 'meal_plan'
  p_room_type uuid,               -- for 'room_type'; NULL otherwise
  p_meal_plan text,               -- for 'meal_plan'; NULL otherwise
  p_from      date,
  p_to        date,               -- exclusive; NULL is open-ended
  p_amount    numeric,            -- NULL clears the range instead of setting it
  p_label     text,
  p_by        uuid
)
returns int                       -- rows for this subject afterwards
language plpgsql
as $$
declare
  v_end date := coalesce(p_to, 'infinity'::date);
  r     record;
  n     int;
begin
  if p_kind not in ('room_type', 'meal_plan') then
    raise exception 'a difference is about a room type or a meal plan';
  end if;

  if p_to is not null and p_to <= p_from then
    raise exception 'a difference range ends after it starts'
      using hint = 'The last day is not included, so a difference through the '
                   '31st ends on the 1st of the next month.';
  end if;

  /* ---- make room: shrink before growing, as 053 does ---- */
  for r in
    select id, valid_from, valid_to, amount, label
      from rate_offsets
     where hotel_id = p_hotel
       and kind = p_kind
       and (p_kind <> 'room_type' or room_type_id = p_room_type)
       and (p_kind <> 'meal_plan' or meal_plan    = p_meal_plan)
       and valid_from < v_end
       and coalesce(valid_to, 'infinity'::date) > p_from
     order by valid_from
  loop
    if r.valid_from >= p_from
       and coalesce(r.valid_to, 'infinity'::date) <= v_end then
      delete from rate_offsets where id = r.id;

    elsif r.valid_from < p_from
          and coalesce(r.valid_to, 'infinity'::date) > v_end then
      /* Straddles both ends: keep the head, put the tail back after the new
         range. The forgotten tail is how a property loses its standing
         difference the day a season ends. */
      update rate_offsets set valid_to = p_from where id = r.id;
      insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                                amount, valid_from, valid_to, label, created_by)
      values (p_hotel, p_kind, p_room_type, p_meal_plan,
              r.amount, v_end, r.valid_to, r.label, p_by);

    elsif r.valid_from < p_from then
      update rate_offsets set valid_to = p_from where id = r.id;

    else
      update rate_offsets set valid_from = v_end where id = r.id;
    end if;
  end loop;

  if p_amount is not null then
    insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                              amount, valid_from, valid_to, label, created_by)
    values (p_hotel, p_kind, p_room_type, p_meal_plan, p_amount,
            p_from, p_to, nullif(trim(coalesce(p_label, '')), ''), p_by);
  end if;

  select count(*)::int into n
    from rate_offsets
   where hotel_id = p_hotel
     and kind = p_kind
     and (p_kind <> 'room_type' or room_type_id = p_room_type)
     and (p_kind <> 'meal_plan' or meal_plan    = p_meal_plan);
  return n;
end $$;

comment on function app.set_offset(uuid, text, uuid, text, date, date, numeric, text, uuid) is
  'Sets a difference over a half-open date range, splitting and trimming '
  'whatever already covers it. A NULL amount clears the range rather than '
  'writing a zero: nothing set means the base applies.';

revoke all on function app.set_offset(uuid, text, uuid, text, date, date, numeric, text, uuid)
  from public;
grant execute on function app.set_offset(uuid, text, uuid, text, date, date, numeric, text, uuid)
  to pms_app;
