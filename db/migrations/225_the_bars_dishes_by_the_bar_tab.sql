-- =============================================================================
-- 225 · The bar's dishes are the menu's Bar tab (the owner's D27-329 (1),
--       15 October)
-- =============================================================================
-- "A dish is the bar's by the menu's Bar tab (its section's tax heading, Bar
-- or Alcohol), not by which KOT printer it uses (they differ only when a
-- manager moves a section's KOT); its KOT still prints on the bar printer."
--
-- 223 said a dish was the bar's when it printed on the Bar KOT
-- (app.pos_kot_kind_for, 211). Now it is the dish's section's heading - the
-- same rule the order pad's Restaurant / Bar tabs use (isBarSection in
-- src/modules/pos/data/till.ts). This one function is the Bar role's only
-- definition: the till's menu for a Bar person and the till's refusal
-- (api/src/modules/pos/till.ts) and the trigger behind them (223) all ask it.
-- Where a KOT prints is unchanged: still app.pos_kot_kind_for.
--
-- Re-runnable: create or replace, signature unchanged (p_hotel keeps the dish
-- to this hotel's menu).
-- =============================================================================

create or replace function app.pos_dish_at_bar(p_hotel uuid, p_item uuid)
returns boolean
language sql stable
as $$
  select exists (select 1
                   from pos_menu_items i
                   join pos_menu_categories c on c.id = i.category_id
                  where i.id = p_item
                    and c.hotel_id = p_hotel
                    and c.tax_kind in ('bar', 'alcohol'));
$$;

comment on function app.pos_dish_at_bar(uuid, uuid) is
  'D27-329 (1): this dish is on the menu''s Bar tab - its section sells under '
  'Bar or Alcohol - whichever KOT it prints on. What a Bar person may order.';
