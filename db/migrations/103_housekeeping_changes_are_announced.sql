-- =============================================================================
-- A room that changes says so — the housekeeping board's half of HK-1
-- =============================================================================
-- The owner, 17 September (D17-39): the housekeeping board refreshes itself
-- when a room changes, the way Tables and the Kitchen already do. Until now a
-- housekeeper marked 204 clean on a landing and the supervisor's board did not
-- change until somebody reloaded it (defect 218, HK-1).
--
-- Refer to this file by what it does — "housekeeping changes are announced" —
-- never by its number (docs/STOCK-AND-EQUIPMENT-PLAN.md § 7).
--
-- THE SAME SHAPE AS THE KITCHEN'S LIVE ORDERS, AND FOR THE SAME REASON.
-- The notification is raised by a trigger on the row, not by the API: a room
-- turns dirty from a check-out (070's trigger), a room move, a block, a put
-- back, a housekeeper's tap, a supervisor's assignment. Publishing from each
-- route means the day somebody writes the next one, the board silently stops
-- updating for that one action. The fact is "a row changed", so the trigger is
-- on the row.
--
-- WHAT TRAVELS: the hotel id and the word "housekeeping". Nothing else. The
-- board re-reads through its ordinary endpoints, so row level security still
-- decides what anybody sees.
--
-- ON THE EXISTING CHANNEL, WITH A TOPIC. `pos_changed` (the live orders) is
-- the one channel the API listens on, over one connection. Today its listener
-- (api/src/realtime.ts, the core's) looks a watcher up by the WHOLE payload,
-- which for the kitchen is a bare hotel id — so "<hotel id>:housekeeping"
-- reaches no watcher at all, and this file changes nothing anybody sees until
-- the listener learns to read a topic. That change is the master's: the
-- request is in src/modules/housekeeping/MODULE.md. Deliberately NOT the bare
-- hotel id, which would work today and wake every till and kitchen in the
-- hotel each time a room is marked clean.
--
-- Postgres delivers one notification per identical payload per transaction,
-- so a statement that touches eighteen rooms wakes the board once.
-- =============================================================================

create or replace function app.housekeeping_changed()
returns trigger
language plpgsql
as $$
declare v_hotel uuid;
begin
  v_hotel := coalesce(new.hotel_id, old.hotel_id);
  if v_hotel is not null then
    -- Sent on COMMIT: a board woken by an uncommitted change would re-read
    -- the old rows and then never hear again (075's note, the same fact).
    perform pg_notify('pos_changed', v_hotel::text || ':housekeeping');
  end if;
  return null;                                    -- AFTER trigger; ignored
end $$;

comment on function app.housekeeping_changed() is
  'Tells listeners that something on this hotel''s housekeeping board moved. '
  'Carries "<hotel id>:housekeeping" and nothing else -- the board re-reads '
  'through its normal endpoints, so RLS still decides what it may see.';

-- ── What the board shows ─────────────────────────────────────────────────────
-- A room's cleaning state and whether somebody is in it: a tap, a check-in, a
-- check-out (070 dirties the room), a move, a block starting today, a put back.
drop trigger if exists rooms_housekeeping_changed on rooms;
create trigger rooms_housekeeping_changed
  after insert or delete or update of housekeeping_status, occupancy_status on rooms
  for each row execute function app.housekeeping_changed();

-- A block for a later date changes no room today, but the board shows it.
drop trigger if exists room_blocks_housekeeping_changed on room_blocks;
create trigger room_blocks_housekeeping_changed
  after insert or update or delete on room_blocks
  for each row execute function app.housekeeping_changed();

-- Whose rooms are whose.
drop trigger if exists housekeeping_assignments_changed on housekeeping_assignments;
create trigger housekeeping_assignments_changed
  after insert or update or delete on housekeeping_assignments
  for each row execute function app.housekeeping_changed();

-- Work orders, and an equipment item's repairs, read the same way.
drop trigger if exists work_orders_housekeeping_changed on work_orders;
create trigger work_orders_housekeeping_changed
  after insert or update on work_orders
  for each row execute function app.housekeeping_changed();
