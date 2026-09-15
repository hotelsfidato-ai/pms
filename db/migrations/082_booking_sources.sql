-- =============================================================================
-- 082 · Where the booking came from, as a list rather than as typing
-- =============================================================================
-- 042 added `source` and wrote down why it was free text:
--
--     "Free text, not lookup tables. A fixed list acquires one entry meaning
--      'Other' and everybody picks it; a per-hotel list can come later, once
--      there is real data to build it from."
--
-- That was right then and is wrong now. There is real data — go-MMT, Agoda,
-- Booking.com, Expedia, walk-ins — and the thing 042 could not know is that a
-- channel manager is coming. A channel manager does not send text. It sends an
-- identifier, and something on this side has to already know what that
-- identifier means. That is the whole reason this table exists today rather
-- than in the release that connects one.
--
-- ⚠ THE LIST IS THE GROUP'S. THE COMMISSION IS THE PROPERTY'S.
--
-- Booking.com is Booking.com at Akkalkot and at every hotel after it — one
-- name, one channel code, so a group-wide source-mix report can add them up
-- without matching strings. The rate is not: it is negotiated per hotel, and
-- two properties on one contract is an assumption nobody made.
--
-- ⚠ AND THE RATE IS STAMPED ONTO THE BOOKING, NOT LOOKED UP LATER.
--
-- Renegotiate 18% down to 15% and every past month's commission would silently
-- restate itself. `reservations.commission_pct` holds the rate that was in
-- force when the booking was taken, exactly as 067 holds the tax rate that
-- applied rather than the one that applies. A report about March must not
-- change because of something agreed in April.
--
-- ⚠ NULL COMMISSION IS "NOT AGREED", AND IT IS NOT ZERO.
--
-- A source with no rate against this property stamps NULL, and every screen
-- renders a dash. Zero would say "this booking cost us nothing in commission",
-- which is a claim about money that nobody has made. The same rule as every
-- unpriced thing in this system.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The list
-- -----------------------------------------------------------------------------
create table if not exists booking_sources (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,

  -- ⚠ `kind` IS NOT A DUPLICATE OF `name`. An owner asks two different
  -- questions: "how much came through Agoda" (the name) and "how much came
  -- through OTAs at all" (the kind). One list answers both only if both are
  -- recorded; deriving the kind from the name is guesswork the day somebody
  -- adds an agent whose name contains "booking".
  kind         text not null,

  -- What a channel manager will send. Nullable because a walk-in has none and
  -- inventing one would be inventing a fact.
  channel_code text,

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table booking_sources drop constraint if exists booking_sources_kind_valid;
alter table booking_sources add constraint booking_sources_kind_valid
  check (kind in ('ota', 'direct', 'corporate', 'travel_agent', 'walk_in', 'other'));

-- One "Agoda", however it was capitalised on the day.
create unique index if not exists booking_sources_name_unique
  on booking_sources (lower(trim(name)));

-- A channel manager mapping two sources to one code is a mapping that cannot
-- be resolved. Partial, because NULL is the ordinary case.
create unique index if not exists booking_sources_channel_code_unique
  on booking_sources (lower(trim(channel_code))) where channel_code is not null;

comment on table booking_sources is
  'Every channel a booking can arrive through, for the whole group. The name '
  'and the channel code are the same at every property; the commission is '
  'not — see booking_source_rates.';
comment on column booking_sources.kind is
  'ota | direct | corporate | travel_agent | walk_in | other. Answers "how '
  'much came through OTAs at all", which the name cannot.';
comment on column booking_sources.channel_code is
  'The identifier a channel manager will send for this source. NULL until '
  'there is one — a walk-in has no code and never will.';

drop trigger if exists booking_sources_touch on booking_sources;
create trigger booking_sources_touch before update on booking_sources
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- What this property pays that source
-- -----------------------------------------------------------------------------
-- No effective dates, and that is a decision rather than an omission: the rate
-- in force is stamped onto each booking as it is taken, so history lives on
-- the bookings and this table only ever has to answer "what is it today".
-- Effective dating here would be a second copy of the same history, and the
-- two would disagree.
-- -----------------------------------------------------------------------------
create table if not exists booking_source_rates (
  hotel_id          uuid not null references hotels(id) on delete cascade,
  booking_source_id uuid not null references booking_sources(id) on delete cascade,
  commission_pct    numeric(5,2),
  updated_at        timestamptz not null default now(),
  primary key (hotel_id, booking_source_id)
);

alter table booking_source_rates drop constraint if exists booking_source_rates_sane;
alter table booking_source_rates add constraint booking_source_rates_sane
  check (commission_pct is null
         or (commission_pct >= 0 and commission_pct <= 100));

comment on table booking_source_rates is
  'This property''s commission with this source. A missing row and a NULL '
  'commission mean the same thing — nobody has agreed a rate — and both '
  'render as a dash, never as zero.';

drop trigger if exists booking_source_rates_touch on booking_source_rates;
create trigger booking_source_rates_touch before update on booking_source_rates
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- On the booking
-- -----------------------------------------------------------------------------
alter table reservations
  add column if not exists booking_source_id uuid references booking_sources(id),
  add column if not exists commission_pct    numeric(5,2);

alter table reservations drop constraint if exists reservations_commission_sane;
alter table reservations add constraint reservations_commission_sane
  check (commission_pct is null
         or (commission_pct >= 0 and commission_pct <= 100));

comment on column reservations.booking_source_id is
  'The channel this booking arrived through. Required on anything taken from '
  'today — enforced by the API, not by a CHECK here, because a constraint '
  'would fire on every UPDATE of the bookings taken before this column '
  'existed, and a check-in would start failing over a field it never touches.';
comment on column reservations.commission_pct is
  'The rate in force when this booking was taken, copied here so it cannot '
  'be restated by a later negotiation. NULL means no rate was agreed — not '
  'zero commission.';

create index if not exists reservations_booking_source_idx
  on reservations (hotel_id, booking_source_id)
  where booking_source_id is not null;


-- -----------------------------------------------------------------------------
-- ⚠ THE LABEL, WRITTEN ONCE
-- -----------------------------------------------------------------------------
-- "What do we call where this booking came from" was written in FIVE places:
-- billing.ts, reports.ts twice, directory.ts as a SQL string, and stays.ts as
-- a TypeScript object — and the five already disagreed. The four SQL copies
-- fall back to `initcap(source)`; the TypeScript one falls back to the string
-- "Walk-in", so a booking whose source is unrecognised reads as a walk-in on
-- the stay list and as itself everywhere else.
--
-- That is this project's most expensive shape: a rule written in N places is
-- wrong in one of them, and nobody finds out which.
--
-- ⚠ THE COMPANY STILL WINS. It is tempting to put the new channel first now
-- that there is one, and it would quietly change what every existing report
-- says: a corporate booking that came in through the direct channel would
-- stop reading "Tata Motors" and start reading "Fidato Hotels". The company
-- is the more specific answer and stays in front. The channel fills the gap
-- it never filled — OTA bookings, which have no company.
-- -----------------------------------------------------------------------------
create or replace function app.booking_source_label(
  source_name  text,
  company_name text,
  legacy       text
) returns text language sql immutable as $$
  select coalesce(
    company_name,
    source_name,
    case legacy
      when 'walk_in' then 'Walk-in'
      when 'direct'  then 'Fidato Hotels'
      else nullif(initcap(legacy), '')
    end
  );
$$;

comment on function app.booking_source_label(text, text, text) is
  'What to call where a booking came from. The company if there is one, then '
  'the channel, then the free text 042 left behind. The ONE definition — five '
  'copies of this rule disagreed before it existed.';

grant execute on function app.booking_source_label(text, text, text) to pms_app;


-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
-- The list is group-level, so it takes the shape `companies` takes: everybody
-- on staff can read it, because a clerk taking a booking has to pick from it;
-- only a manager can change commercial terms.
alter table booking_sources enable row level security;
alter table booking_sources force row level security;

drop policy if exists booking_sources_read on booking_sources;
create policy booking_sources_read on booking_sources
  for select using ( app.is_active_staff() );
drop policy if exists booking_sources_write on booking_sources;
create policy booking_sources_write on booking_sources
  for insert with check ( app.is_manager() );
drop policy if exists booking_sources_update on booking_sources;
create policy booking_sources_update on booking_sources
  for update using ( app.is_manager() ) with check ( app.is_manager() );
-- No delete policy: a source is deactivated, never removed — bookings point
-- at it, and a booking whose origin vanished is one nobody can explain.

-- The rate IS per property, so it takes the ordinary hotel shape: the same
-- `app.auth_hotel_ids()` every other per-property table asks, under the same
-- policy name. Spelling that predicate by hand cost nine API tests in 080.
alter table booking_source_rates enable row level security;
alter table booking_source_rates force row level security;

drop policy if exists hotel_isolation on booking_source_rates;
create policy hotel_isolation on booking_source_rates
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

grant select, insert, update on booking_sources to pms_app;
grant select, insert, update, delete on booking_source_rates to pms_app;


-- -----------------------------------------------------------------------------
-- The sources this group already books through
-- -----------------------------------------------------------------------------
-- Taken from the bookings that exist, not invented: these are the exact names
-- already sitting in `reservations.source` and in the demo data. No commission
-- against any of them — nobody has told this system what Agoda charges, and a
-- number here would be a number nobody agreed.
-- -----------------------------------------------------------------------------
insert into booking_sources (name, kind, channel_code) values
  ('Fidato Hotels', 'direct',  null),
  ('Walk-in',       'walk_in', null),
  ('Booking.com',   'ota',     'BDC'),
  ('go-MMT',        'ota',     'GOMMT'),
  ('Agoda',         'ota',     'AGODA'),
  ('Expedia',       'ota',     'EXPEDIA')
on conflict do nothing;
