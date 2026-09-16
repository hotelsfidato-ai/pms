-- =============================================================================
-- 094 — suppliers and locations: the two things stock, equipment and buying share
-- =============================================================================
-- Phase 0 of docs/STOCK-AND-EQUIPMENT-PLAN.md, approved by the owner on
-- 16 September. Three services are about to be built alongside each other —
-- the Store, Equipment and Purchasing — and all three need to say WHO a thing
-- came from and WHERE it is. Built once, here, before any of them starts, so
-- that no service invents its own list and no two lists disagree.
--
-- WHAT THIS DOES NOT DO
--
--   * It seeds nothing. The owner chose a main store, a kitchen store and a bar
--     store to start (S3), but not every property has a bar, and a location
--     that exists only because a migration assumed it is the invented data this
--     project refuses. The Store's own screen offers those three when a property
--     sets its store up (plan, phase 1A).
--   * It does not duplicate rooms. A room is already a row in `rooms`; equipment
--     in a room, or a repair in one, points at the room. `locations` is for every
--     other place: stores, the kitchen, the bar, the restaurant, the lobby.
--   * It changes no existing table. `stock_movements.supplier` stays free text
--     for the history it already holds; the Store links a delivery to a supplier
--     record in its own phase.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Suppliers
-- -----------------------------------------------------------------------------
-- Per property, like every other table here, so row-level security scopes a
-- supplier exactly as it scopes a booking. A supplier seven properties buy from
-- is entered at each — the price of keeping one isolation rule for everything.
-- -----------------------------------------------------------------------------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,

  name        text not null,
  contact     text,           -- the person to ring
  phone       text,
  email       text,
  gstin       text,           -- on a tax invoice; checked for shape, not invented
  address     text,
  note        text,

  is_active   boolean not null default true,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (hotel_id, name),
  constraint suppliers_name_present check (length(btrim(name)) > 0),
  -- The shape of an Indian GSTIN: 15 characters, state code first. A malformed
  -- one on a purchase record is found at the audit, not at the delivery.
  constraint suppliers_gstin_shape check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'
  )
);

comment on table suppliers is
  'Who the property buys from. Shared by the Store (deliveries), Equipment '
  '(where an item came from, its warranty) and Purchasing (orders). Entered by '
  'the hotel; this schema ships none.';

drop trigger if exists suppliers_touch on suppliers;
create trigger suppliers_touch before update on suppliers
  for each row execute function app.touch_updated_at();

alter table suppliers enable row level security;
alter table suppliers force  row level security;
drop policy if exists hotel_isolation on suppliers;
create policy hotel_isolation on suppliers
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on suppliers to pms_app;
-- NO DELETE. A supplier that has delivered is part of the record of every
-- delivery it made; one that is no longer used is switched off.
--
-- ⚠ Granting less is not enough: migration 010 set DEFAULT PRIVILEGES, so every
-- new table in this schema hands pms_app DELETE by itself. The first version
-- of this file only left DELETE out of the grant, and the check in
-- db/tests/modules/shared.sql found two delete grants anyway. It has to be
-- REVOKED, the way 014, 024 and 025 do it.
revoke delete on suppliers from pms_app;


-- -----------------------------------------------------------------------------
-- Locations
-- -----------------------------------------------------------------------------
-- Every place that is not a room. Stock sits in one; equipment stands in one; a
-- repair happens in one.
-- -----------------------------------------------------------------------------
create table if not exists locations (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,

  name        text not null,          -- "Main store", "Kitchen store", "Lobby"
  kind        text not null,

  is_active   boolean not null default true,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (hotel_id, name),
  constraint locations_name_present check (length(btrim(name)) > 0),
  constraint locations_kind_valid check (kind in (
    'store',        -- where stock is KEPT: main store, kitchen store, bar store
    'kitchen',
    'bar',
    'restaurant',
    'public_area',  -- lobby, corridors, the pool
    'office',
    'other'
  ))
);

comment on table locations is
  'Every place at a property that is not a room: the stores, the kitchen, the '
  'bar, the restaurant, public areas. A room is already in `rooms` and is '
  'pointed at directly. Entered by the hotel; this schema ships none.';

comment on column locations.kind is
  'What the place is for. Only a `store` holds stock; the others are where '
  'stock is issued to, where equipment stands, and where a repair happens.';

drop trigger if exists locations_touch on locations;
create trigger locations_touch before update on locations
  for each row execute function app.touch_updated_at();

alter table locations enable row level security;
alter table locations force  row level security;
drop policy if exists hotel_isolation on locations;
create policy hotel_isolation on locations
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on locations to pms_app;
-- No delete, for the same reason: stock has moved through it and equipment has
-- stood in it. A place no longer used is switched off. Revoked, not merely left
-- out — see suppliers above.
revoke delete on locations from pms_app;
