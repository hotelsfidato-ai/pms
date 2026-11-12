-- =============================================================================
-- 267 · Allotments: rooms of a type held for a company or an agent (D27-383)
-- =============================================================================
-- The audit's Step 2, item 8, built under D27-396. A block of rooms of one type
-- held under a company's or an agent's contract for a run of nights, at that
-- contract's rate, with a release: N days before each night, the rooms of that
-- night nobody has booked go back on sale at the night audit, and the release
-- is recorded (allotment_releases).
--
--   held      a night's rooms less the bookings made against the allotment
--             (reservations.allotment_id), until that night is released
--   picked    a booking made from the allotment, counted on every night it
--             covers; it holds its room as any booking does (044's occupied),
--             and the allotment holds one room fewer, so availability moves
--             once, not twice
--
-- AVAILABILITY READS HELD ROOMS AS HELD, NEVER AS SOLD: app.inventory_grid keeps
-- its columns (044 makes it again on every deploy, so its answer cannot change
-- shape - MEMORY 256's family) and its `available` is now less what is held;
-- `occupied` and `sold`, the Manager report's figures, do not count a held room.
-- What is held is app.allotment_held, for the screens that show it.
--
-- AN ALLOTMENT NEVER OVERBOOKS THE HOTEL: the route (contracts/allotments.ts)
-- holds no more than is free on every night, under one lock per hotel.
--
-- THE RELEASE IS IDEMPOTENT: one row per allotment and night, written with
-- ON CONFLICT DO NOTHING, so an audit run twice releases nothing twice; a
-- released night stays released (an undone audit does not take rooms back
-- off sale, decided under D27-396: they may have been sold since).
--
-- Re-runnable.
-- =============================================================================

create table if not exists allotments (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  contract_id   uuid not null,
  room_type_id  uuid not null,
  first_night   date not null,
  last_night    date not null,
  rooms         int  not null,
  release_days  int  not null,
  notes         text,
  is_active     boolean not null default true,
  created_by    uuid references staff(id),
  updated_by    uuid references staff(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (hotel_id, id),
  foreign key (hotel_id, contract_id)  references contracts  (hotel_id, id),
  foreign key (hotel_id, room_type_id) references room_types (hotel_id, id),
  constraint allotments_nights  check (last_night >= first_night and last_night - first_night <= 365),
  constraint allotments_rooms   check (rooms between 1 and 500),
  constraint allotments_release check (release_days between 0 and 365),
  constraint allotments_notes   check (notes is null or length(notes) <= 500)
);

comment on table allotments is
  'Rooms of one type held for a company or agent under its contract, for the '
  'nights first_night..last_night (both included), released release_days '
  'before each night at the night audit (D27-383, 267).';

create table if not exists allotment_releases (
  allotment_id  uuid not null,
  hotel_id      uuid not null,
  night         date not null,
  rooms         int  not null,
  business_date date not null,
  released_by   uuid references staff(id),
  released_at   timestamptz not null default now(),

  primary key (allotment_id, night),
  foreign key (hotel_id, allotment_id) references allotments (hotel_id, id) on delete cascade,
  constraint allotment_releases_rooms check (rooms >= 0)
);

comment on table allotment_releases is
  'One night of an allotment back on sale: how many rooms nobody had booked '
  'went back (0 when all were), and the day whose night audit released it.';

alter table reservations add column if not exists allotment_id uuid;
alter table reservations drop constraint if exists reservations_allotment_fk;
alter table reservations add constraint reservations_allotment_fk
  foreign key (hotel_id, allotment_id) references allotments (hotel_id, id);
create index if not exists reservations_allotment_idx
  on reservations (allotment_id) where allotment_id is not null;

comment on column reservations.allotment_id is
  'The allotment this booking was taken from (267). NULL: an ordinary booking.';

-- Who keeps them: as a contract (177, C-6) - the owner, an administrator or
-- a GM. Releases are written by whoever closes the day, so only the hotel
-- decides there.
alter table allotments enable row level security;
alter table allotments force  row level security;
drop policy if exists hotel_isolation on allotments;
create policy hotel_isolation on allotments for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists kept_by_managers on allotments;
create policy kept_by_managers on allotments as restrictive
  for insert with check ( app.keeps_companies() );
drop policy if exists changed_by_managers on allotments;
create policy changed_by_managers on allotments as restrictive
  for update using ( app.keeps_companies() );
grant select, insert, update on allotments to pms_app;

alter table allotment_releases enable row level security;
alter table allotment_releases force  row level security;
drop policy if exists hotel_isolation on allotment_releases;
create policy hotel_isolation on allotment_releases for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, insert on allotment_releases to pms_app;

drop trigger if exists allotments_audit on allotments;
create trigger allotments_audit after insert or update or delete on allotments
  for each row execute function app.write_audit();
drop trigger if exists allotments_touch on allotments;
create trigger allotments_touch before update on allotments
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- What an allotment holds, night by night
-- -----------------------------------------------------------------------------
create or replace function app.allotment_held(p_hotel uuid, p_from date, p_to date)
returns table (
  allotment_id uuid, room_type_id uuid, night date,
  rooms int, picked int, held int, released boolean
)
language sql stable as $$
  select a.id, a.room_type_id, d.night, a.rooms, p.n,
         case when rel.night is null then greatest(a.rooms - p.n, 0) else 0 end,
         rel.night is not null
    from allotments a
   cross join lateral (
     select n::date as night
       from generate_series(greatest(a.first_night, p_from),
                            least(a.last_night, p_to), interval '1 day') n) d
    left join allotment_releases rel
           on rel.allotment_id = a.id and rel.night = d.night
   cross join lateral (
     select count(*)::int as n
       from reservations r
      where r.allotment_id = a.id
        and r.status not in ('cancelled', 'no_show', 'void')
        and d.night >= r.check_in and d.night < r.check_out) p
   where a.hotel_id = p_hotel and a.is_active
     and a.first_night <= p_to and a.last_night >= p_from
$$;

comment on function app.allotment_held(uuid, date, date) is
  'Each active allotment''s nights in the window: its rooms, the bookings made '
  'from it, and what it still holds - nothing once the night is released (267).';

grant execute on function app.allotment_held(uuid, date, date) to pms_app;


-- -----------------------------------------------------------------------------
-- The inventory grid, less what is held (044's columns, unchanged)
-- -----------------------------------------------------------------------------
create or replace function app.inventory_grid(
  p_hotel uuid, p_from date, p_to date
)
returns table (
  room_type_id uuid,
  room_type    text,
  for_date     date,
  sellable     int,
  occupied     int,
  sold         int,
  available    int
)
language sql stable as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  types as (
    select id, name from room_types where hotel_id = p_hotel
  ),
  taken as (
    select r.room_type_id, d.d,
           count(*)::int as occupied,
           count(*) filter (
             where r.status in ('confirmed', 'checked_in', 'checked_out')
               and not r.is_complimentary
           )::int as sold
      from reservations r
      join days d on d.d >= r.check_in and d.d < r.check_out
     where r.hotel_id = p_hotel
       and r.status not in ('cancelled', 'no_show', 'void')
     group by r.room_type_id, d.d
  ),
  held as (
    select h.room_type_id, h.night as d, sum(h.held)::int as held
      from app.allotment_held(p_hotel, p_from, p_to) h
     group by h.room_type_id, h.night
  )
  select
    t.id, t.name, d.d,
    app.sellable_rooms(p_hotel, d.d, t.id),
    coalesce(k.occupied, 0),
    coalesce(k.sold, 0),
    greatest(app.sellable_rooms(p_hotel, d.d, t.id)
             - coalesce(k.occupied, 0) - coalesce(hd.held, 0), 0)
  from types t
  cross join days d
  left join taken k on k.room_type_id = t.id and k.d = d.d
  left join held hd on hd.room_type_id = t.id and hd.d = d.d
  order by t.name, d.d;
$$;

comment on function app.inventory_grid(uuid, date, date) is
  'Sellable, occupied, sold and available per room type per date. `occupied` '
  'includes complimentary and tentative because they hold a room; `sold` is '
  'the statistics definition and excludes them. `available` is also less '
  'the rooms an allotment holds (267), which are neither occupied nor sold.';

grant execute on function app.inventory_grid(uuid, date, date) to pms_app;


-- -----------------------------------------------------------------------------
-- The night audit's release
-- -----------------------------------------------------------------------------
-- Closing day D releases every night n of an active allotment with
-- n - release_days <= D: held through the release date, back on sale from the
-- next business day. A night already released is skipped, so a second run
-- writes nothing. Answers how many rooms went back on sale.
create or replace function app.release_allotments(p_hotel uuid, p_closing date)
returns int
language sql volatile as $$
  with due as (
    select a.id, n::date as night, a.rooms
      from allotments a
     cross join lateral generate_series(
             a.first_night, least(a.last_night, p_closing + a.release_days),
             interval '1 day') n
     where a.hotel_id = p_hotel and a.is_active
       and a.first_night <= p_closing + a.release_days
  ),
  written as (
    insert into allotment_releases (allotment_id, hotel_id, night, rooms, business_date, released_by)
    select due.id, p_hotel, due.night,
           greatest(due.rooms - (
             select count(*) from reservations r
              where r.allotment_id = due.id
                and r.status not in ('cancelled', 'no_show', 'void')
                and due.night >= r.check_in and due.night < r.check_out), 0),
           p_closing, app.current_user_id()
      from due
    on conflict (allotment_id, night) do nothing
    returning rooms
  )
  select coalesce(sum(rooms), 0)::int from written
$$;

comment on function app.release_allotments(uuid, date) is
  'The night audit closing p_closing: every allotment night within its release '
  'days goes back on sale, recorded once (267). Answers the rooms released.';

grant execute on function app.release_allotments(uuid, date) to pms_app;
