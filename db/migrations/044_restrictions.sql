-- =============================================================================
-- 044 — the four rules a revenue manager sets beside a rate
-- =============================================================================
-- `rates` answers "what does this cost on this date". It does not answer
-- "may it be sold at all", and those are different questions asked by different
-- people at different moments:
--
--   stop sell    do not sell this room type on this date, at any price.
--                A sold-out night, a maintenance block, a wedding that has
--                taken the property.
--
--   closed on    it may be sold, but a stay may not BEGIN here. Used to stop
--   arrival      a one-night booking eating the Friday of a three-night
--                weekend.
--
--   closed on    a stay may not END here, for the mirror reason.
--   departure
--
--   min / max    the length of stay this date will accept.
--   nights
--
-- ONE ROW PER ROOM TYPE PER DATE, not per rate plan. A room that is not for
-- sale is not for sale on any plan, and duplicating the rule per plan is how
-- one of them ends up disagreeing with the others on the night it matters.
--
-- Absent means unrestricted. The grid renders a blank cell, and blank is the
-- normal state — a table that had to hold a row for every open date would be
-- 365 rows per room type saying "nothing to say".
-- =============================================================================

create table if not exists rate_restrictions (
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id) on delete cascade,
  for_date      date not null,

  stop_sell     boolean not null default false,
  closed_arrival   boolean not null default false,
  closed_departure boolean not null default false,

  min_nights    smallint,
  max_nights    smallint,

  set_by        uuid references staff(id),
  set_at        timestamptz not null default now(),

  primary key (hotel_id, room_type_id, for_date),

  -- A minimum above the maximum accepts nothing at all, and reads on the grid
  -- as two innocent numbers. Refused rather than discovered by a guest who
  -- cannot book.
  constraint rate_restrictions_nights_sane check (
    min_nights is null or max_nights is null or min_nights <= max_nights),
  constraint rate_restrictions_min_positive check (
    min_nights is null or min_nights >= 1),
  constraint rate_restrictions_max_positive check (
    max_nights is null or max_nights >= 1)
);

comment on table rate_restrictions is
  'Whether a room type may be sold on a date, and for how long. Absent means '
  'unrestricted — the normal state, so nothing is written for an open date.';

comment on column rate_restrictions.closed_arrival is
  'A stay may not BEGIN on this date. Stops a one-night booking taking the '
  'Friday out of a three-night weekend.';

alter table rate_restrictions enable row level security;
alter table rate_restrictions force  row level security;

drop policy if exists rate_restrictions_isolation on rate_restrictions;
create policy rate_restrictions_isolation on rate_restrictions
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- A row that says nothing should not exist
-- -----------------------------------------------------------------------------
-- Clearing every restriction on a date leaves a row meaning "unrestricted",
-- which is what absence already means. Two representations of one state is how
-- a grid ends up showing a mark where there is none, and how a count of
-- "restricted dates" comes back wrong.
-- -----------------------------------------------------------------------------
create or replace function app.drop_empty_restriction()
returns trigger language plpgsql as $$
begin
  if not new.stop_sell and not new.closed_arrival and not new.closed_departure
     and new.min_nights is null and new.max_nights is null then
    delete from rate_restrictions
     where hotel_id = new.hotel_id
       and room_type_id = new.room_type_id
       and for_date = new.for_date;
    return null;
  end if;
  return new;
end $$;

drop trigger if exists rate_restrictions_tidy on rate_restrictions;
create trigger rate_restrictions_tidy
  after insert or update on rate_restrictions
  for each row execute function app.drop_empty_restriction();


-- -----------------------------------------------------------------------------
-- Sellable rooms, now answerable per ROOM TYPE
-- -----------------------------------------------------------------------------
-- 022 defines this for a whole property and its comment says the rule plainly:
-- "Never count rooms directly for this — a room held out of service is
-- inventory that cannot be sold, and the two differ."
--
-- The grid needs the same answer per room type. Writing a second copy is how
-- the two drift, and the first attempt at this migration did exactly that —
-- it used `p_date < b.to_date` where 022 uses `<=`, and lost a night off every
-- block. So the rule lives in the three-argument form and the property-wide one
-- delegates to it.
-- -----------------------------------------------------------------------------
create or replace function app.sellable_rooms(
  p_hotel_id uuid, p_date date, p_room_type uuid
)
returns integer language sql stable as $$
  select count(*)::int
    from rooms r
   where r.hotel_id = p_hotel_id
     and r.is_active
     and (p_room_type is null or r.room_type_id = p_room_type)
     and not exists (
       select 1 from room_blocks b
        where b.room_id = r.id
          and p_date >= b.from_date
          and (b.to_date is null or p_date <= b.to_date)
     )
$$;

create or replace function app.sellable_rooms(p_hotel_id uuid, p_date date)
returns integer language sql stable as $$
  select app.sellable_rooms(p_hotel_id, p_date, null::uuid)
$$;

comment on function app.sellable_rooms(uuid, date, uuid) is
  'Rooms of this type that could be sold on this date; null type means the '
  'whole property. The denominator of every occupancy figure in the product.';


-- -----------------------------------------------------------------------------
-- The inventory grid
-- -----------------------------------------------------------------------------
-- Derived, never stored: the moment inventory is a table it can disagree with
-- the reservations that produced it, and reconciling the two becomes somebody's
-- morning.
--
-- OCCUPIED AND SOLD ARE DIFFERENT NUMBERS and both are correct.
--
--   occupied  every booking holding a room, complimentary and tentative
--             included. This is what a revenue manager must subtract, because
--             a comped room cannot be sold to anybody else.
--
--   sold      the statistics definition, matching SOLD_NIGHTS in
--             api/src/routes/statistics.ts: confirmed, checked in or checked
--             out, and NOT complimentary. It is the numerator of occupancy and
--             the denominator of ADR, where a free room would drag the average
--             to nothing.
--
-- Showing only one of them is how a grid ends up disagreeing with the Manager
-- Report while both are right.
--
-- A room-NIGHT spans [check_in, check_out): the night of departure belongs to
-- nobody. Void is excluded from both — a booking that never happened holds no
-- room.
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
  )
  select
    t.id, t.name, d.d,
    app.sellable_rooms(p_hotel, d.d, t.id),
    coalesce(k.occupied, 0),
    coalesce(k.sold, 0),
    greatest(app.sellable_rooms(p_hotel, d.d, t.id)
             - coalesce(k.occupied, 0), 0)
  from types t
  cross join days d
  left join taken k on k.room_type_id = t.id and k.d = d.d
  order by t.name, d.d;
$$;

comment on function app.inventory_grid(uuid, date, date) is
  'Sellable, occupied, sold and available per room type per date. `occupied` '
  'includes complimentary and tentative because they hold a room; `sold` is '
  'the statistics definition and excludes them. Both are right, and a grid '
  'showing only one disagrees with the Manager Report.';

grant select, insert, update, delete on rate_restrictions to pms_app;
grant execute on function app.sellable_rooms(uuid, date, uuid) to pms_app;
grant execute on function app.inventory_grid(uuid, date, date) to pms_app;
