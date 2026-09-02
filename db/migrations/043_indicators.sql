-- =============================================================================
-- 043 — the marks a front desk actually acts on
-- =============================================================================
-- A legend of nineteen icons, of which four change what a clerk DOES rather
-- than what they know. Those four get a column; the rest are derived or are
-- decoration.
--
--   VIP            the guest is greeted differently, and the room is checked
--                  before they reach it
--   single lady    a safety practice in Indian hotels: the room is allocated
--                  away from stairwells and service corridors, and it is not
--                  read out at the desk. It belongs to the RESERVATION, not
--                  the guest — the same person travelling with family is not
--                  the same allocation problem
--   smoking        a room attribute, and putting the wrong guest in one is a
--                  complaint and a deep clean
--   connected      two rooms with a door between them. A family of five needs
--                  them; two strangers must never be given them
--
-- DUE OUT IS NOT HERE and never will be. It is `check_out = business date` —
-- a stored flag would need updating every night by something that can fail,
-- and a stale one sends housekeeping to a room a guest is still in.
-- =============================================================================

alter table guests
  add column if not exists is_vip boolean not null default false;

comment on column guests.is_vip is
  'Travels with the GUEST, not the booking — somebody who is a VIP this visit '
  'was one last visit.';

alter table reservations
  add column if not exists is_single_lady boolean not null default false;

comment on column reservations.is_single_lady is
  'On the reservation, not the guest: the same person travelling with family '
  'is a different allocation. Drives room placement away from stairwells and '
  'service corridors, and is not announced at the desk.';

alter table rooms
  add column if not exists smoking boolean not null default false,
  add column if not exists connected_room_id uuid references rooms(id);

comment on column rooms.connected_room_id is
  'The room this one has a connecting door to. Symmetric in meaning but stored '
  'once per side, so both rows point at each other — the trigger below keeps '
  'them honest.';

create index if not exists guests_vip_idx on guests (id) where is_vip;
create index if not exists rooms_connected_idx
  on rooms (connected_room_id) where connected_room_id is not null;


-- -----------------------------------------------------------------------------
-- A connecting door opens both ways
-- -----------------------------------------------------------------------------
-- 204 connects to 205, so 205 connects to 204. Stored one-sided, half the
-- lookups miss: a clerk searching from 205 is told there is no connecting room
-- and splits a family across a floor.
--
-- Also refuses a room connecting to itself, and to a room at another property —
-- neither is a mistake anybody makes deliberately, and both are silent.
-- -----------------------------------------------------------------------------
create or replace function app.connected_rooms_are_mutual()
returns trigger language plpgsql as $$
declare
  v_other_hotel uuid;
begin
  if new.connected_room_id is null then
    -- Cleared. The other side no longer points back.
    update rooms set connected_room_id = null
     where connected_room_id = new.id and id is distinct from new.id;
    return new;
  end if;

  if new.connected_room_id = new.id then
    raise exception 'a room cannot connect to itself'
      using hint = 'Name the room on the other side of the door.';
  end if;

  select hotel_id into v_other_hotel from rooms where id = new.connected_room_id;
  if v_other_hotel is distinct from new.hotel_id then
    raise exception 'connecting rooms must be at the same property'
      using hint = 'There is no door between two hotels.';
  end if;

  -- Point the other side back, unless it already does.
  update rooms
     set connected_room_id = new.id
   where id = new.connected_room_id
     and connected_room_id is distinct from new.id;

  return new;
end $$;

drop trigger if exists rooms_connected_mutual on rooms;
create trigger rooms_connected_mutual
  after insert or update of connected_room_id on rooms
  for each row execute function app.connected_rooms_are_mutual();
