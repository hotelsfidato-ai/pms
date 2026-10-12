-- =============================================================================
-- 209 · Three guards the audit of 9 October found short (POS-34, D27-289)
-- =============================================================================
-- (1) A STRUCK COPY IS WHAT THE DISH WAS (POS-34). One fewer of a sent dish
--     writes a struck copy of the line. 164's trigger checks every line it
--     inserts against TODAY's menu: a dish that has gained a further type
--     since it was rung (a Crust added to the Pizza) would refuse the copy,
--     and the manager would get "Something went wrong". A struck line sells
--     nothing; it records what was taken off. So the check stands aside for
--     a line that is struck when it is written, and holds for everything sold.
--     The function is 164's, unchanged but for that one early return.
--
-- (2) FREE IS 0. An add-on ticked Free carries no price - the tile says Free,
--     so the bill must not charge one. The API now writes 0; this holds it.
--
-- (3) THE KEPT ADD-ONS HAVE THEIR LIST. 208's shape check let a value with no
--     "addons" key through: jsonb_typeof(NULL) = 'array' is NULL, and a CHECK
--     passes on NULL. Now it must be an array, or the value is refused.
--
-- Re-runnable.
-- =============================================================================

-- (1) ------------------------------------------------------------------------
create or replace function app.pos_line_names_its_variation()
returns trigger language plpgsql as $$
declare
  v_missing text;
begin
  -- Add-on lines name no item, and are not the subject of this rule.
  if new.addon_id is not null or new.item_id is null then
    return new;
  end if;

  -- A line struck as it is written is a record of what came off (POS-34,
  -- 209): it sells nothing, and it is what the dish WAS, not today's menu.
  if tg_op = 'INSERT' and new.voided then
    return new;
  end if;

  if new.variation_id is null and exists (
       select 1 from pos_item_variations
        where item_id = new.item_id and is_active and type_no = 1) then
    raise exception
      'this dish is sold by variation, and none was chosen'
      using hint = 'Ring the Oil or the Butter, not the dish itself.';
  end if;

  if new.variation_id is not null and not exists (
       select 1 from pos_item_variations
        where id = new.variation_id and item_id = new.item_id and type_no = 1) then
    raise exception 'that variation belongs to a different dish';
  end if;

  -- Each further type: exactly one of its choices on the line.
  select string_agg(distinct coalesce(t.heading, t.kind, 'variation'), ', ')
    into v_missing
    from pos_item_variations t
   where t.item_id = new.item_id and t.is_active and t.type_no > 1
     and (select count(*) from pos_item_variations c
           where c.id = any(new.extra_choice_ids)
             and c.item_id = new.item_id and c.type_no = t.type_no) <> 1;
  if v_missing is not null then
    raise exception 'this dish needs one choice of each type: %', v_missing;
  end if;

  if exists (select 1 from unnest(new.extra_choice_ids) x
              where not exists (select 1 from pos_item_variations c
                                 where c.id = x and c.item_id = new.item_id
                                   and c.type_no > 1)) then
    raise exception 'that choice belongs to a different dish';
  end if;

  return new;
end $$;

-- (2) ------------------------------------------------------------------------
update pos_numbered_addons set price = 0 where is_free and price <> 0;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_numbered_addons_free_is_zero') then
    alter table pos_numbered_addons
      add constraint pos_numbered_addons_free_is_zero check (not is_free or price = 0);
  end if;
end $$;

-- (3) ------------------------------------------------------------------------
alter table pos_order_lines drop constraint if exists pos_order_lines_numbered_addons_shape;
alter table pos_order_lines
  add constraint pos_order_lines_numbered_addons_shape check (
    numbered_addons is null
    or coalesce(
         jsonb_typeof(numbered_addons) = 'object'
         and jsonb_typeof(numbered_addons -> 'addons') = 'array'
         and jsonb_array_length(numbered_addons -> 'addons') > 0
         -- On a dish, never on a side.
         and parent_line_id is null,
       false));
