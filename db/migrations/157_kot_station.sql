-- =============================================================================
-- 157 · One KOT printer per outlet (D27-159, D27-161)
-- =============================================================================
-- The owner, 29 September: one device per outlet prints every new kitchen
-- docket, through its browser (Chrome started with --kiosk-printing), and no
-- other device prints one. The kitchen manager, the owner, an administrator or
-- the GM switches "This device prints KOTs" on in the Kitchen screen's KOT
-- printer panel; switching it on elsewhere MOVES it.
--
-- THE DEVICE is a random id the browser keeps for itself (localStorage). It is
-- not a person: whoever is signed in on the kitchen PC, the PC prints.
--
-- WHAT HAS PRINTED is a row per docket in pos_kot_prints, written BEFORE the
-- paper (the insert is the claim: two tabs on the station cannot both print
-- one). A missed docket - the station asleep or off the line - has no row, and
-- prints when the station is back, oldest first. Switching on or moving the
-- station prints from that moment only (`kot_station_since`).
-- =============================================================================

alter table pos_outlets
  add column if not exists kot_station_device  text,
  add column if not exists kot_station_name    text,
  add column if not exists kot_station_since   timestamptz,
  add column if not exists kot_station_seen_at timestamptz;

comment on column pos_outlets.kot_station_device is
  'The id of the one device that prints this outlet''s KOTs; null when none '
  '(D27-159). Made by the browser, kept on the device.';
comment on column pos_outlets.kot_station_name is
  'What staff called that device, typed when it was switched on: "Kitchen PC".';
comment on column pos_outlets.kot_station_since is
  'When it was switched on here: KOTs sent before it are not its to print.';
comment on column pos_outlets.kot_station_seen_at is
  'When the station last asked for KOTs. Online means within 90 seconds.';

-- A station is a device, its name and its start, together; and a name is typed.
alter table pos_outlets drop constraint if exists pos_outlets_kot_station_whole;
alter table pos_outlets add constraint pos_outlets_kot_station_whole check (
  (kot_station_device is null) = (kot_station_name is null)
  and (kot_station_device is null) = (kot_station_since is null)
  and (kot_station_name is null or length(trim(kot_station_name)) > 0));


create table if not exists pos_kot_prints (
  hotel_id   uuid not null references hotels(id) on delete cascade,
  order_id   uuid not null references pos_orders(id) on delete cascade,
  kot_no     int  not null,
  printed_at timestamptz not null default now(),
  primary key (order_id, kot_no)
);

comment on table pos_kot_prints is
  'One row per kitchen docket the KOT station printed (D27-159). Written '
  'before the paper, as the claim; a reprint writes nothing.';

alter table pos_kot_prints enable row level security;
alter table pos_kot_prints force row level security;
drop policy if exists hotel_isolation on pos_kot_prints;
create policy hotel_isolation on pos_kot_prints
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

-- Printed is printed. 010's default privileges would give update and delete.
grant select, insert on pos_kot_prints to pms_app;
revoke update, delete on pos_kot_prints from pms_app;
