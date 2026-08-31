-- =============================================================================
-- 034_kot.sql — the kitchen order ticket
-- =============================================================================
-- The till could take an order and settle a bill. Nothing in between: the
-- kitchen never saw anything. A waiter rang up a biryani and then walked to
-- the pass and said "biryani", which is what the paper system already did.
--
-- Every restaurant POS in this market — Petpooja, Posist, Gofrugal — treats
-- KOT and BILL as two different acts, because they happen at different times
-- to different people:
--
--   SAVE & KOT   the kitchen starts cooking. The guest is still eating and
--                may order more. Happens several times per table.
--   BILL         the guest is leaving. Happens once.
--
-- Collapsing them, which is what this system did, means either the kitchen
-- learns about the order when the guest asks for the bill, or the bill is
-- settled before the food is cooked. Neither is a restaurant.
--
-- WHY STATUS SITS ON THE LINE AND NOT THE ORDER
--
-- A table orders starters, then mains twenty minutes later. The starters are
-- served while the mains are still on the fire. An order-level status cannot
-- express that, and the pass needs to know which DISHES are ready, not which
-- tables.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- How the order is being taken
-- -----------------------------------------------------------------------------
-- Dine-in, takeaway and room service are priced and taxed the same here, but
-- they are not the same job: a takeaway has no table, room service has a room
-- and a folio, and a dine-in has both a table and a running bill. The kitchen
-- also plates them differently, so it goes on the ticket.
-- -----------------------------------------------------------------------------
alter table pos_orders
  add column if not exists order_type text not null default 'dine_in';

alter table pos_orders drop constraint if exists pos_orders_type_valid;
alter table pos_orders
  add constraint pos_orders_type_valid
  check (order_type in ('dine_in', 'takeaway', 'room_service', 'delivery'));

comment on column pos_orders.order_type is
  'Dine-in, takeaway, room service or delivery. Prints on the kitchen ticket '
  'because a kitchen plates them differently.';


-- -----------------------------------------------------------------------------
-- Where each dish has got to
-- -----------------------------------------------------------------------------
--   pending    rung up, kitchen has not been told
--   sent       on the kitchen screen
--   preparing  somebody is cooking it
--   ready      at the pass, waiting to be carried
--   served     on the table
--
-- Default `pending` and not `sent`: adding a line does not tell the kitchen.
-- The waiter does that, deliberately, when the table has finished ordering —
-- otherwise every hesitation over the menu fires a ticket.
-- -----------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists kot_status text not null default 'pending';
alter table pos_order_lines
  add column if not exists kot_sent_at timestamptz;

alter table pos_order_lines drop constraint if exists pos_lines_kot_valid;
alter table pos_order_lines
  add constraint pos_lines_kot_valid
  check (kot_status in ('pending', 'sent', 'preparing', 'ready', 'served'));

-- A line that has reached the kitchen says when. Without the timestamp the
-- pass cannot sort by what has been waiting longest, which is the one thing
-- a kitchen display is for.
alter table pos_order_lines drop constraint if exists pos_lines_kot_timed;
alter table pos_order_lines
  add constraint pos_lines_kot_timed
  check (kot_status = 'pending' or kot_sent_at is not null);

create index if not exists pos_lines_kot_idx
  on pos_order_lines (hotel_id, kot_status)
  where kot_status in ('sent', 'preparing', 'ready');


-- -----------------------------------------------------------------------------
-- A struck line the kitchen already has is a VOID, not a disappearance
-- -----------------------------------------------------------------------------
-- Cancelling a dish nobody has started is free. Cancelling one that is on the
-- fire costs food, and the kitchen has to be told rather than have the ticket
-- quietly vanish from their screen.
--
-- This does not block the strike — a guest changing their mind is allowed. It
-- records that the kitchen had it, so the pass can show it as cancelled and
-- the waste is attributable.
-- -----------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists was_sent_when_voided boolean not null default false;

create or replace function app.pos_line_void_notes_kot()
returns trigger language plpgsql as $$
begin
  if new.voided and not old.voided and old.kot_status <> 'pending' then
    new.was_sent_when_voided := true;
  end if;
  return new;
end $$;

drop trigger if exists pos_line_void_notes_kot on pos_order_lines;
create trigger pos_line_void_notes_kot
  before update on pos_order_lines
  for each row execute function app.pos_line_void_notes_kot();

comment on column pos_order_lines.was_sent_when_voided is
  'True when a struck line had already reached the kitchen. The difference '
  'between a guest changing their mind and food in the bin.';
