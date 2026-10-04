-- =============================================================================
-- 196 · Rivals' prices, for revenue management (the owner's D27-269, D27-270;
--       numbered for now)
-- =============================================================================
-- Refer to it by what it does - "rivals' prices" - never by its number.
--
--   1  market_rate_settings       each hotel's "Rivals' prices" switch. NO ROW:
--                                 OFF. The sweep's last run day is kept here.
--   2  market_rates               each nearby hotel's lowest public price for
--                                 one night, as Google Hotels showed it, kept
--                                 with when it was checked
--   3  app.market_rates_begin     the hotels due a check now, each marked as
--                                 checked today (once a day at most)
--   4  app.market_rates_record    one night's prices, kept
--
-- Nothing here is a price this system sells at. Revenue management only reads
-- it, beside its suggestions, and never changes a price (D18-15).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The switch (D27-270): off until the owner, an Admin or the GM turns it on
-- -----------------------------------------------------------------------------
create table if not exists market_rate_settings (
  hotel_id    uuid primary key references hotels(id) on delete cascade,
  is_on       boolean not null,
  -- The property's own date of the sweep's last check. The sweep marks it
  -- before it searches, so a failed search waits for the next check day.
  last_run_on date,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now()
);

comment on table market_rate_settings is
  'Rivals'' prices switched On or Off for one hotel (D27-270). No row: off. '
  'last_run_on is the sweep''s, the property''s own date of its last check.';

alter table market_rate_settings enable row level security;
alter table market_rate_settings force  row level security;
drop policy if exists market_rate_settings_read on market_rate_settings;
create policy market_rate_settings_read on market_rate_settings
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists market_rate_settings_write on market_rate_settings;
create policy market_rate_settings_write on market_rate_settings
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update on market_rate_settings to pms_app;

-- Audited when a person switches it, not each time the sweep marks its day.
drop trigger if exists market_rate_settings_audit on market_rate_settings;
create trigger market_rate_settings_audit
  after insert or delete or update of is_on on market_rate_settings
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 2 · What was seen: one row per nearby hotel, per night, per check
-- -----------------------------------------------------------------------------
-- Rupees, as Google showed them with currency=INR. Never a zero: a hotel with
-- no price is not kept at all. Nobody signed in writes here; only the sweep's
-- function (4) does, so there is no write policy and no write grant.
create table if not exists market_rates (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  stay_date    date not null,
  fetched_at   timestamptz not null default now(),
  competitor   text not null,
  lowest_price numeric(12,2) not null,
  -- The site behind the lowest price, when Google names one.
  source       text,

  constraint market_rates_competitor_named check (btrim(competitor) <> ''),
  constraint market_rates_price_positive check (lowest_price > 0)
);

create index if not exists market_rates_night_idx
  on market_rates (hotel_id, stay_date, fetched_at desc);

comment on table market_rates is
  'Each nearby hotel''s lowest public price for one night, as Google Hotels '
  'showed it when checked (D27-270). Read beside revenue management''s '
  'suggestions; never a price this system sells at.';

alter table market_rates enable row level security;
alter table market_rates force  row level security;
drop policy if exists market_rates_read on market_rates;
create policy market_rates_read on market_rates
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
grant select on market_rates to pms_app;


-- -----------------------------------------------------------------------------
-- 3 · Which hotels are due a check now, each marked as checked today
-- -----------------------------------------------------------------------------
-- Switched on, active, on one of p_days (ISO: 1 Monday .. 7 Sunday) on the
-- property's own clock, at or after p_from, and not checked yet that day. The
-- mark and the answer are one statement, so two servers cannot both take a
-- hotel. A definer, because the sweep has nobody signed in.
create or replace function app.market_rates_begin(
  p_days integer[],
  p_from time,
  p_now  timestamptz default now()
)
returns table (hotel_id uuid, code text, name text, city text, today date)
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  update market_rate_settings s
     set last_run_on = (p_now at time zone h.timezone)::date
    from hotels h
   where h.id = s.hotel_id
     and h.is_active
     and s.is_on
     and extract(isodow from p_now at time zone h.timezone)::integer = any (p_days)
     and (p_now at time zone h.timezone)::time >= p_from
     and s.last_run_on is distinct from (p_now at time zone h.timezone)::date
  returning h.id, h.code, h.name, h.city, s.last_run_on
$fn$;

comment on function app.market_rates_begin(integer[], time, timestamptz) is
  'The hotels due a rivals'' prices check now (D27-270), each marked as checked '
  'on its own date, so a hotel is checked once a day at most.';

revoke all on function app.market_rates_begin(integer[], time, timestamptz) from public;
grant execute on function app.market_rates_begin(integer[], time, timestamptz) to pms_app;


-- -----------------------------------------------------------------------------
-- 4 · One night's prices, kept
-- -----------------------------------------------------------------------------
-- p_prices: [{ "competitor": text, "price": number, "source": text|null }].
-- Kept only while the hotel's switch is on. Answers how many were kept.
create or replace function app.market_rates_record(
  p_hotel     uuid,
  p_stay_date date,
  p_prices    jsonb
)
returns integer
language sql
volatile
security definer
set search_path = pg_catalog, public
as $fn$
  with kept as (
    insert into market_rates (hotel_id, stay_date, competitor, lowest_price, source)
    select p_hotel, p_stay_date, btrim(x.competitor), x.price, nullif(btrim(x.source), '')
      from jsonb_to_recordset(p_prices) as x(competitor text, price numeric, source text)
     where exists (select 1 from market_rate_settings s where s.hotel_id = p_hotel and s.is_on)
    returning 1
  )
  select count(*)::integer from kept
$fn$;

comment on function app.market_rates_record(uuid, date, jsonb) is
  'Keeps one night''s nearby prices for a hotel whose rivals'' prices are on (D27-270).';

revoke all on function app.market_rates_record(uuid, date, jsonb) from public;
grant execute on function app.market_rates_record(uuid, date, jsonb) to pms_app;
