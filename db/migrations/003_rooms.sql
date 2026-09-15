-- =============================================================================
-- 003_rooms.sql — physical inventory. HOTEL-SCOPED from here on.
-- =============================================================================
-- Every table below carries `hotel_id not null`. Every index leads with it.
--
-- WHY hotel_id MUST LEAD THE INDEX:
--   RLS rewrites your query to add `where hotel_id in (...)`. If the index
--   starts with any other column, Postgres cannot use it for that filter and
--   falls back to a sequential scan. On a table holding a year of data across
--   seven properties, that is the difference between 2ms and 2 seconds.
-- =============================================================================


create table if not exists room_types (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  code        text not null,                       -- 'DLX', 'STE'
  name        text not null,                       -- 'Deluxe King'
  base_occupancy  smallint not null default 2,
  max_occupancy   smallint not null default 3,
  -- Default rate. Real pricing comes from rate plans and seasons later;
  -- this is the fallback so the system is usable from day one.
  base_rate   numeric(12,2) not null,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (hotel_id, code),
  constraint room_types_occupancy_sane check (max_occupancy >= base_occupancy),
  constraint room_types_rate_positive  check (base_rate >= 0)
);

drop trigger if exists room_types_touch on room_types;
create trigger room_types_touch before update on room_types
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- rooms — the actual doors.
-- -----------------------------------------------------------------------------
-- occupancy_status and housekeeping_status are deliberately INDEPENDENT.
-- A room can be VACANT + DIRTY (guest just left) or OCCUPIED + CLEAN (serviced
-- during a stay). Collapsing them into one field is a classic PMS modelling
-- mistake, and you discover it the day housekeeping asks for a "vacant dirty"
-- list and the query cannot express it.
--
-- Current state lives here; the HISTORY of changes is a separate log below.
-- Current state and audit trail are different problems — do not share a table.
-- -----------------------------------------------------------------------------
create table if not exists rooms (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null references room_types(id),
  number        text not null,                      -- '101', '2A'
  floor         smallint,

  occupancy_status    text not null default 'vacant',
  housekeeping_status text not null default 'clean',

  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (hotel_id, number),

  constraint rooms_occupancy_valid check (occupancy_status in (
    'vacant', 'occupied'
  )),
  constraint rooms_hk_valid check (housekeeping_status in (
    'clean',          -- ready to sell
    'dirty',          -- needs service
    'inspected',      -- cleaned and checked by a supervisor
    'out_of_order',   -- broken; does NOT count against sellable inventory
    'out_of_service'  -- deliberately held back; still counts as inventory
  ))
);

-- hotel_id leads. See the note at the top of this file.
create index if not exists rooms_hotel_idx    on rooms (hotel_id, number);
create index if not exists rooms_hotel_hk_idx on rooms (hotel_id, housekeeping_status);

drop trigger if exists rooms_touch on rooms;
create trigger rooms_touch before update on rooms
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- room_status_log — who changed what, when.
-- -----------------------------------------------------------------------------
-- Housekeeping disputes are routine. Without a log you cannot settle them,
-- and attendant productivity cannot be measured at all.
-- -----------------------------------------------------------------------------
create table if not exists room_status_log (
  id          bigserial primary key,
  hotel_id    uuid not null references hotels(id) on delete cascade,
  room_id     uuid not null references rooms(id)  on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references staff(id),
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists room_status_log_hotel_idx
  on room_status_log (hotel_id, created_at desc);
