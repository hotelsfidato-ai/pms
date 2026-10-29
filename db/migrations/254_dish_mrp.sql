-- =============================================================================
-- 254 · A dish's MRP, so a bill given free (NC) is valued in the stock
--       (the owner's D27-351 and D27-373: "the stock will show it at MRP,
--       which the GM sets up"; "the MRP typed by the GM per dish in the Menu
--       (empty is a dash; never in sales or tax)")
-- =============================================================================
-- An NC bill still has no value in sales, tax, the Day book or the day's
-- reports (233). Its dishes are valued at quantity x MRP in the stock
-- reports only (stock-consumption's "Given free (NC), at MRP").
--
--   * pos_menu_items.mrp       the dish's, typed on the Menu beside its price
--   * pos_item_variations.mrp  a first-type choice's (Half, Full): it carries
--                              the dish's price, so it carries the MRP. A later
--                              type only adds to the price and has none.
--
-- Optional: NULL is "nobody has typed one" - a dash, never a zero, and never
-- filled in from the price. A typed one is above zero. Who may type it is the
-- menu's own rule (`menu: edit`, api/src/roleGate.ts). Both columns are copied
-- to a test hotel with the rest of the menu (212's copy reads the columns).
--
-- Re-runnable: columns added if absent, the constraints added once, guarded.
-- =============================================================================

alter table pos_menu_items      add column if not exists mrp numeric(12,2);
alter table pos_item_variations add column if not exists mrp numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_menu_items_mrp_sane') then
    alter table pos_menu_items add constraint pos_menu_items_mrp_sane check (mrp > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pos_item_variations_mrp_sane') then
    alter table pos_item_variations add constraint pos_item_variations_mrp_sane check (mrp > 0);
  end if;
end $$;

comment on column pos_menu_items.mrp is
  'D27-351, D27-373: the dish''s MRP, typed by the GM on the Menu. Values a bill given '
  'free (NC) in the stock reports only - never a sale or tax. Null: none typed, a dash.';
comment on column pos_item_variations.mrp is
  'D27-373: a first-type choice''s MRP (it carries the dish''s price). Null: none typed, '
  'a dash - never the dish''s MRP filled in. Later types have none.';
