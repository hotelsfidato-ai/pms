-- ════════════════════════════════════════════════════════════════════
-- 192 · PHASE 5 OF THE SETTINGS PLAN: THE FRONT DESK'S SETTINGS AND THE
--       LISTS (the owner's D27-249 to D27-254, answers D27-260)
--
-- Each default is what the code did, so nothing changes until a hotel
-- changes it.
--   hotel_lists      every small per-hotel list in one table: market
--                    segments (seeded with today's five) and the ready
--                    reasons for a block, a cancellation, a void and a bill
--                    correction (picked into the reason box; free text stays)
--   hotel_holidays   name, day, colour: shaded like a weekend, no price
--   vip_levels       ONE list for the group (a guest is one record across
--                    the group, D21-20); guests.vip_level_id, and "VIP" is
--                    any level
--   hotels           the front desk's settings (below)
-- ════════════════════════════════════════════════════════════════════

-- ── The lists ──────────────────────────────────────────────────────────
create table if not exists hotel_lists (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  kind       text not null,
  label      text not null,
  colour     text,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint hotel_lists_kind_valid check (kind in (
    'market_segment', 'reason_block', 'reason_cancel', 'reason_void', 'reason_correction')),
  constraint hotel_lists_label_sane check (length(trim(label)) between 1 and 80),
  constraint hotel_lists_colour_valid check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$')
);
create unique index if not exists hotel_lists_one_label
  on hotel_lists (hotel_id, kind, lower(trim(label)));

alter table hotel_lists enable row level security;
alter table hotel_lists force  row level security;
drop policy if exists hotel_lists_read on hotel_lists;
create policy hotel_lists_read on hotel_lists
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists hotel_lists_write on hotel_lists;
create policy hotel_lists_write on hotel_lists
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update, delete on hotel_lists to pms_app;

-- Today's five segments (reservations/data/booking.ts), for every hotel now
-- and every hotel added later.
create or replace function app.seed_hotel_lists(p_hotel uuid) returns void
language sql as $$
  insert into hotel_lists (hotel_id, kind, label, sort)
  select p_hotel, 'market_segment', s.label, s.n * 10
    from unnest(array['Corporate', 'Leisure', 'Group', 'Crew', 'Government'])
         with ordinality as s(label, n)
  on conflict do nothing;
$$;
select app.seed_hotel_lists(id) from hotels;

create or replace function app.hotel_lists_seed() returns trigger
language plpgsql as $$
begin
  perform app.seed_hotel_lists(new.id);
  return null;
end $$;
drop trigger if exists hotels_seed_lists on hotels;
create trigger hotels_seed_lists after insert on hotels
  for each row execute function app.hotel_lists_seed();

-- ── Holidays ───────────────────────────────────────────────────────────
create table if not exists hotel_holidays (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  day        date not null,
  name       text not null,
  colour     text,
  created_at timestamptz not null default now(),
  constraint hotel_holidays_name_sane check (length(trim(name)) between 1 and 80),
  constraint hotel_holidays_colour_valid check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$'),
  constraint hotel_holidays_one_a_day unique (hotel_id, day)
);
alter table hotel_holidays enable row level security;
alter table hotel_holidays force  row level security;
drop policy if exists hotel_holidays_read on hotel_holidays;
create policy hotel_holidays_read on hotel_holidays
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists hotel_holidays_write on hotel_holidays;
create policy hotel_holidays_write on hotel_holidays
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update, delete on hotel_holidays to pms_app;

-- ── VIP levels, one list for the group ─────────────────────────────────
create table if not exists vip_levels (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  colour     text,
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint vip_levels_label_sane check (length(trim(label)) between 1 and 40),
  constraint vip_levels_colour_valid check (colour is null or colour ~ '^#[0-9a-fA-F]{6}$')
);
create unique index if not exists vip_levels_one_label on vip_levels (lower(trim(label)));
alter table vip_levels enable row level security;
alter table vip_levels force  row level security;
drop policy if exists vip_levels_read on vip_levels;
create policy vip_levels_read on vip_levels for select using ( app.is_active_staff() );
drop policy if exists vip_levels_write on vip_levels;
create policy vip_levels_write on vip_levels
  for all using ( app.sets_group_settings() ) with check ( app.sets_group_settings() );
grant select, insert, update, delete on vip_levels to pms_app;

alter table guests add column if not exists vip_level_id uuid references vip_levels(id) on delete set null;

-- ── The front desk's settings, per hotel ───────────────────────────────
alter table hotels add column if not exists default_guarantee text not null default 'confirmed';
alter table hotels drop constraint if exists hotels_default_guarantee_valid;
alter table hotels add constraint hotels_default_guarantee_valid
  check (default_guarantee in ('confirmed', 'tentative'));

alter table hotels add column if not exists default_bill_to text not null default 'guest';
alter table hotels drop constraint if exists hotels_default_bill_to_valid;
alter table hotels add constraint hotels_default_bill_to_valid
  check (default_bill_to in ('guest', 'company'));

-- The desk's New booking only, never a channel's booking (D27-260 Q2).
alter table hotels add column if not exists required_booking_fields text[] not null default '{}';
alter table hotels drop constraint if exists hotels_required_booking_fields_valid;
alter table hotels add constraint hotels_required_booking_fields_valid
  check (required_booking_fields <@ array['phone', 'email', 'nationality', 'address',
         'expectedArrival', 'marketSegment', 'businessSource', 'salesPerson']);

alter table hotels add column if not exists hk_dirty_after_move boolean not null default true;
-- Off: a room back from a block returns as it was before it, so the block
-- remembers that.
alter table room_blocks add column if not exists was_status text;
alter table hotels add column if not exists hk_dirty_after_unblock boolean not null default true;
alter table hotels add column if not exists hk_stayover_dirty_at_audit boolean not null default false;

alter table hotels add column if not exists id_types_off text[] not null default '{}';
alter table hotels drop constraint if exists hotels_id_types_off_valid;
alter table hotels add constraint hotels_id_types_off_valid
  check (id_types_off <@ array['aadhaar', 'passport', 'driving_licence', 'voter', 'other']);

-- Colours of today's booking states on the Calendar (D27-260 Q6: colours only).
alter table hotels add column if not exists status_colours jsonb;

-- The restaurant bill's round-off (Q4): off / manual (today) / automatic, to ₹1.
alter table hotels add column if not exists pos_round_off text not null default 'manual';
alter table hotels drop constraint if exists hotels_pos_round_off_valid;
alter table hotels add constraint hotels_pos_round_off_valid
  check (pos_round_off in ('off', 'manual', 'automatic'));

-- How the figures count (Q5): today a day use is one room sold, and a
-- complimentary room is sold (as the owner's eZee reports).
alter table hotels add column if not exists kpi_day_use_half boolean not null default false;
alter table hotels add column if not exists kpi_comp_as_sold boolean not null default true;

-- ── A room left by a move is dirty - unless the hotel says not (Q3a) ───
create or replace function app.moved_out_room_is_dirty()
returns trigger
language plpgsql
as $$
begin
  if not (select h.hk_dirty_after_move from hotels h where h.id = new.hotel_id) then
    return new;
  end if;
  update rooms rm
     set housekeeping_status = 'dirty'
    from room_assignments ra
    join reservations r on r.id = ra.reservation_id
   where ra.reservation_id = new.reservation_id
     and ra.id <> new.id
     and ra.released_at is null
     and ra.to_date = new.from_date
     and new.from_date <= app.business_date(new.hotel_id)
     and r.status = 'checked_in'
     and rm.id = ra.room_id
     and rm.housekeeping_status in ('clean', 'inspected')
     and not exists (select 1 from app.in_house(new.hotel_id) i
                      where i.room_id = rm.id);
  return new;
end $$;

create or replace function app.future_move_room_is_dirty()
returns trigger
language plpgsql
as $$
begin
  -- A run already completed being corrected (100) is not the date moving.
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return null;
  end if;
  if not (select h.hk_dirty_after_move from hotels h where h.id = new.hotel_id) then
    return null;
  end if;

  update rooms rm
     set housekeeping_status = 'dirty'
    from room_assignments ra
    join reservations r on r.id = ra.reservation_id
   where ra.hotel_id = new.hotel_id
     and ra.released_at is null
     and ra.to_date = app.business_date(new.hotel_id)
     and exists (select 1 from room_assignments nx
                  where nx.reservation_id = ra.reservation_id
                    and nx.id <> ra.id
                    and nx.released_at is null
                    and nx.from_date = ra.to_date)
     and r.status = 'checked_in'
     and rm.id = ra.room_id
     and rm.housekeeping_status in ('clean', 'inspected')
     and not exists (select 1 from app.in_house(new.hotel_id) i
                      where i.room_id = rm.id);
  return null;                                    -- AFTER trigger; ignored
end $$;

-- ── The guest's online form leaves out the IDs the hotel does not take ─
-- (D27-260 Q8). Read through the guest's own unlocked door, as 121's are.
create or replace function app.guest_ids_off(p_token_hash text, p_unlock_hash text)
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select h.id_types_off
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join reservations r on r.id = v.reservation_id
    join hotels h on h.id = r.hotel_id;
$fn$;
grant execute on function app.guest_ids_off(text, text) to pms_app;
