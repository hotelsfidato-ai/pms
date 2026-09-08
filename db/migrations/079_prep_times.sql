-- =============================================================================
-- 079 · How long a dish takes — the column three stages have been waiting on
-- =============================================================================
-- Timing capture, course sequencing and a kitchen view grouped by table all
-- want the same fact and none of them can start without it: HOW LONG DOES THIS
-- DISH TAKE.
--
-- Two places carry it, because a menu of two hundred dishes cannot be timed one
-- row at a time:
--
--     pos_menu_categories.prep_minutes   the default for everything in it
--     pos_menu_items.prep_minutes        this dish, when it differs
--
-- ⚠ NULL IS NOT ZERO, AND THIS IS THE WHOLE RULE.
--
-- Both columns are nullable with no default, and `app.prep_minutes` returns
-- null rather than a number when nobody has said. This is the same rule the
-- prices follow, for the same reason: **a screen must show a dash, never a
-- figure the property did not choose.**
--
-- Zero would be worse than absent. "0 minutes" tells a kitchen display the dish
-- is instant, so it sorts to the front of the pass and a chef starts it last.
-- Absent says "nobody has timed this", which is true and which somebody can
-- act on. `app.gst_rate` makes the same argument about tax — *"a missing rate
-- is never zero"* — and this is that argument applied to minutes.
--
-- DERIVED, NEVER STORED. The effective time is a function of the item and its
-- category, resolved at read. Copying the category's number onto every item
-- would mean changing a category default silently fails to move the dishes it
-- was meant to move — and would leave two copies to disagree.
--
-- No strict/raising variant, and that is deliberate. `app.gst_rate` raises
-- because a posting with no tax rate is a bill that is WRONG. A docket with no
-- estimate is merely a docket with no estimate: the food still cooks. So there
-- is one function here, it returns null, and every caller is expected to render
-- that as a dash.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The columns
-- -----------------------------------------------------------------------------
alter table pos_menu_categories add column if not exists prep_minutes integer;
alter table pos_menu_items      add column if not exists prep_minutes integer;

-- A range, not just "positive". 480 minutes is eight hours, which covers a
-- slow-cooked biryani or a marinade started in the morning; anything past it is
-- a typo — somebody typing seconds, or a stray zero. The upper bound is here to
-- catch that at the moment it is entered rather than on a kitchen screen at
-- eight in the evening.
--
-- Zero is refused rather than accepted-and-ignored. A dish that genuinely needs
-- no preparation still takes a minute to plate, and if it truly does not, the
-- honest entry is to leave it unset.
alter table pos_menu_categories drop constraint if exists pos_menu_categories_prep_sane;
alter table pos_menu_categories
  add constraint pos_menu_categories_prep_sane
  check (prep_minutes is null or (prep_minutes >= 1 and prep_minutes <= 480));

alter table pos_menu_items drop constraint if exists pos_menu_items_prep_sane;
alter table pos_menu_items
  add constraint pos_menu_items_prep_sane
  check (prep_minutes is null or (prep_minutes >= 1 and prep_minutes <= 480));

comment on column pos_menu_categories.prep_minutes is
  'Default preparation time in minutes for every dish in this category. NULL '
  'means nobody has said — which is not zero, and must render as a dash.';

comment on column pos_menu_items.prep_minutes is
  'Preparation time in minutes for this dish, overriding its category. NULL '
  'means fall back to the category, which may also be NULL.';


-- -----------------------------------------------------------------------------
-- The one definition
-- -----------------------------------------------------------------------------
-- The fallback is written HERE and nowhere else. A rule written in N places is
-- wrong in one of them, and this project has found that shape more often than
-- any other — the pad's running total needed a test pinning it to the server
-- for exactly this reason.
create or replace function app.prep_minutes(p_item uuid)
returns integer
language sql
stable
as $$
  select coalesce(i.prep_minutes, c.prep_minutes)
    from pos_menu_items i
    join pos_menu_categories c on c.id = i.category_id
   where i.id = p_item
$$;

comment on function app.prep_minutes(uuid) is
  'How long this dish takes: its own time, else its category default, else '
  'NULL. NULL means nobody has timed it — never zero, and every caller must '
  'show a dash rather than invent a number.';

grant execute on function app.prep_minutes(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- How long a whole round takes
-- -----------------------------------------------------------------------------
-- The SLOWEST dish, not the sum. A kitchen with more than one chef starts a
-- round together, so six dishes of five minutes each is five minutes of
-- waiting, not thirty. This is the number a waiter would say out loud at the
-- table.
--
-- ⚠ IT REFUSES TO GUESS. If ANY live dish on the order has no time, the answer
-- is null — because "the longest of the ones we happen to know" is a number
-- that reads as an estimate and is not one. A round of six where five are
-- timed and one is not is a round nobody can promise.
create or replace function app.pos_order_prep_minutes(p_order uuid)
returns integer
language sql
stable
as $$
  select case
           when count(*) = 0 then null
           when bool_or(app.prep_minutes(l.item_id) is null) then null
           else max(app.prep_minutes(l.item_id))
         end
    from pos_order_lines l
   where l.order_id = p_order
     and not l.voided
     -- An add-on rides with its parent dish and is not cooked separately.
     -- It is a CHILD LINE — `parent_line_id` — and carries `addon_id`
     -- instead of `item_id`, so it has no dish to look a time up from.
     and l.parent_line_id is null
     and l.item_id is not null
$$;

comment on function app.pos_order_prep_minutes(uuid) is
  'The longest preparation time on an order — what the table actually waits. '
  'NULL when any live dish is untimed: a partial estimate reads as a promise '
  'and is not one.';

grant execute on function app.pos_order_prep_minutes(uuid) to pms_app;
