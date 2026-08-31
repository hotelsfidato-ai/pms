-- =============================================================================
-- 033_rates.sql — what a room costs, on a date, on a plan
-- =============================================================================
-- Until now a property had exactly one number per room type:
-- `room_types.base_rate`. That is a rack rate and nothing else. It cannot say
-- that a Deluxe on breakfast costs more than the same Deluxe room-only, and
-- it cannot say that December is not August.
--
-- The group's instruction was plain: prices are not fixed, the team updates
-- them, and nothing is standard across properties. So this is a table the
-- hotel writes, not a structure that arrives with opinions in it.
--
-- ONE SHAPE FOR THREE THINGS
--
-- A rate is (room type × meal plan × date range) → price. That single row
-- covers every case a hotel of this size actually has:
--
--   rack          one row, open-ended, EP
--   meal plans    a row per plan — CP costs more than EP
--   seasons       rows with date ranges — December is its own row
--
-- Inventing three tables for those would be inventing a distinction the
-- hotel does not make.
--
-- TWO PRICES FOR ONE DAY IS NOT A CONFIGURATION, IT IS A BUG
--
-- If a Deluxe on CP has two rows covering the 14th of December, nobody —
-- including the hotel — can say what it costs. The EXCLUDE constraint below
-- refuses it at write time rather than letting a clerk discover it at a
-- checkout. btree_gist is already installed (001) for exactly this shape.
--
-- WHAT THIS DOES NOT DO
--
-- No yield management, no occupancy-based pricing, no channel parity. Those
-- are decisions a seven-property group makes with a spreadsheet and a phone
-- call, and building them unasked would be building somebody else's hotel.
-- =============================================================================


create table if not exists rates (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id)      on delete cascade,
  room_type_id uuid not null references room_types(id)  on delete cascade,

  -- References the global list rather than a free string: `reservations`
  -- already points at it, so a rate and a booking cannot disagree about
  -- what "CP" means.
  meal_plan    text not null references meal_plans(code),

  price        numeric(12,2) not null,

  -- Half-open, like room_blocks and every other range in this schema: a
  -- season from the 1st to the 15th covers the 1st through the 14th.
  valid_from   date not null,
  -- NULL is open-ended, which is what a rack rate is.
  valid_to     date,

  -- A label the hotel reads on its own screen. "Winter", "Diwali week".
  label        text,

  created_by   uuid references staff(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint rates_price_sane check (price >= 0),
  constraint rates_range_sane check (valid_to is null or valid_to > valid_from),

  -- THE LINE THAT MAKES A PRICE ANSWERABLE.
  --
  -- Two rows covering one date for one room type on one plan means the
  -- hotel cannot say what the room costs. Refused here, at write time,
  -- where somebody can still fix it — rather than at a checkout, where
  -- they cannot.
  constraint rates_no_overlap exclude using gist (
    room_type_id with =,
    meal_plan    with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[)') with &&
  )
);

create index if not exists rates_lookup_idx
  on rates (hotel_id, room_type_id, meal_plan, valid_from);

comment on table rates is
  'What a room type costs on a plan over a date range. Written by the hotel; '
  'this schema ships none.';


-- -----------------------------------------------------------------------------
-- The one place anything asks what a room costs
-- -----------------------------------------------------------------------------
-- Precedence, and it is a lookup with two layers rather than two sources:
--
--   1. a rate row covering this date for this type and plan
--   2. the room type's rack rate, if there is no such row
--   3. NULL — the hotel has priced neither
--
-- NULL and not zero. Zero is a claim that the room is free, and 032 removed
-- the last place this schema made a claim about a price nobody had set.
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
  select coalesce(
    (select r.price
       from rates r
      where r.room_type_id = p_room_type
        and r.meal_plan    = p_meal_plan
        and p_date >= r.valid_from
        and (r.valid_to is null or p_date < r.valid_to)
      limit 1),
    (select rt.base_rate from room_types rt where rt.id = p_room_type)
  );
$$;

comment on function app.rate_for(uuid, text, date) is
  'The price of a room type on a plan on a date: a covering rate row, else '
  'the type''s rack rate, else NULL. Never zero — an unpriced room is not a '
  'free one.';


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- Same policy, same form as every other scoped table.
--
-- Note what is NOT here: no separate write policy. Setting a price is an
-- ordinary act for anybody who can reach the property, unlike creating one
-- — which 029 put behind a provisioning key because it manufactures a
-- tenant. A rate is a number the front office changes on a Tuesday.
-- -----------------------------------------------------------------------------
alter table rates enable row level security;
alter table rates force  row level security;
drop policy if exists hotel_isolation on rates;
create policy hotel_isolation on rates
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists rates_touch on rates;
create trigger rates_touch before update on rates
  for each row execute function app.touch_updated_at();

-- DELETE stays. A rate that was wrong should be removed, not carried
-- forever with a flag — it is a setting, not a ledger entry. What it
-- priced is already recorded on the reservations it priced, in
-- `agreed_rate`, which is the row that matters and is not touched by this.
