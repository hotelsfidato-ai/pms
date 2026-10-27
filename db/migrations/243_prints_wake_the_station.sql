-- =============================================================================
-- 243 · A reprint, and a bill sent to the bill printer, wake the printing
--       computer at once (the owner, 27 October: "reprint on KOT is taking
--       long time to print")
-- =============================================================================
-- The printing computer re-reads its queue the moment it hears `pos_changed`
-- for its hotel (075), and every 30 seconds otherwise (KotStation.tsx). A new
-- KOT is heard at once: it changes pos_order_lines, which 075 announces. A
-- reprint (225, pos_kot_reprints) and a bill asked of the bill printer (211,
-- pos_bill_prints) changed only their own tables, which announced nothing - so
-- each waited for the 30-second read, up to half a minute at the printer.
--
-- Both tables now announce a new row, as pos_orders and pos_requests (237) do.
-- Only the asking: the station's claim (printed_at) wakes nobody.
--
-- Re-runnable.
-- =============================================================================

drop trigger if exists pos_kot_reprints_changed on pos_kot_reprints;
create trigger pos_kot_reprints_changed
  after insert on pos_kot_reprints
  for each row execute function app.pos_changed();

drop trigger if exists pos_bill_prints_changed on pos_bill_prints;
create trigger pos_bill_prints_changed
  after insert on pos_bill_prints
  for each row execute function app.pos_changed();
