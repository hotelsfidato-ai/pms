-- =============================================================================
-- 075 · The kitchen hears about a change from the DATABASE, not the caller
-- =============================================================================
-- The kitchen screen polled every ten seconds. A waiter adds a dish and the
-- pass does not see it for up to ten; in a background tab the browser throttles
-- the timer to about a minute. The requirement is that a change made in the POS
-- appears on the kitchen terminal, and ten seconds is not that.
--
-- WHY THE NOTIFICATION IS RAISED HERE AND NOT IN THE API.
--
-- There are more than a dozen endpoints in api/src/routes/till.ts that change
-- an order: add a line, change a quantity, void a line, send a KOT, settle,
-- abandon, discount, move a kitchen status, clear a table. Publishing from each
-- of them means the day somebody writes the fourteenth, the kitchen silently
-- stops updating for that one action -- and nobody finds out until a service.
--
-- This project has recorded that exact shape nine times: a rule written at the
-- call sites instead of at the fact. The fact is "a row changed". So the
-- trigger is on the row.
--
-- WHAT TRAVELS: the hotel id, and nothing else.
--
-- Deliberately. The client is told only that something in its own property
-- moved, and then re-reads through the ordinary authenticated endpoint, which
-- applies row level security exactly as it always did. No order, no guest, no
-- price crosses this channel -- so a mistake in the fan-out cannot leak one
-- property's orders to another's screen. It can only cause a needless refetch.
--
-- pg_notify's payload limit is 8000 bytes; a uuid is 36.
-- =============================================================================

create or replace function app.pos_changed()
returns trigger
language plpgsql
as $$
declare v_hotel uuid;
begin
  v_hotel := coalesce(new.hotel_id, old.hotel_id);
  if v_hotel is not null then
    -- Sent on COMMIT, not now: a listener woken by an uncommitted change would
    -- re-read the old rows and then never hear again. Postgres queues NOTIFY
    -- until the transaction commits, which is the behaviour wanted here.
    perform pg_notify('pos_changed', v_hotel::text);
  end if;
  return null;                                    -- AFTER trigger; ignored
end $$;

comment on function app.pos_changed() is
  'Tells listeners that something in this hotel''s orders moved. Carries the '
  'hotel id and nothing else -- the client re-reads through the normal '
  'endpoint, so RLS still decides what it may see.';

-- ── The two tables a kitchen screen reads ───────────────────────────────────
-- STATEMENT level, not row. A ten-line order posted in one statement should
-- wake the kitchen once, not ten times. The payload carries no row, so there
-- is nothing lost by collapsing them -- but `hotel_id` is not available to a
-- statement trigger, so these stay FOR EACH ROW and the API coalesces instead.
-- Said out loud because the alternative looks obviously better and is not.

drop trigger if exists pos_orders_changed on pos_orders;
create trigger pos_orders_changed
  after insert or update or delete on pos_orders
  for each row execute function app.pos_changed();

drop trigger if exists pos_order_lines_changed on pos_order_lines;
create trigger pos_order_lines_changed
  after insert or update or delete on pos_order_lines
  for each row execute function app.pos_changed();
