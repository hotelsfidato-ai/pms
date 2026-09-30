-- =============================================================================
-- 164 — a dish has several variation types (D27-189, D27-192, D27-195)
-- =============================================================================
-- 045 gave a dish ONE required choice: Bhaaji Pau is Oil ₹300 or Butter ₹400.
-- The owner's menu needs more than one:
--
--   Pizza   Size   Small ₹200 · Large ₹400          the first type: full price
--           Crust  Cheese burst +₹80 · Thin Free   each further type: adds
--
-- A choice row says which type it is in (type_no), what kind of type that is
-- (Size, Quantity or Option) and, for an Option, the heading the manager typed
-- ("Spice level", "Crust"). Repeated on each choice of the type, because the
-- Menu screen writes a dish's whole set at once and nothing else writes a
-- kind or a heading.
--
-- CARRIED OVER BY THE DEFAULTS: every variation made before this is type 1
-- with no kind, and so is every row the menu import and the demo loader write.
-- The waiter's pop-up calls those "Variation" until the manager picks a kind.
--
-- The same name may be in two types of one dish ("Regular" size and "Regular"
-- crust, D27-195), so a name is unique within its type, not its dish.
-- =============================================================================

alter table pos_item_variations
  add column if not exists type_no smallint not null default 1,
  add column if not exists kind    text,
  add column if not exists heading text;

comment on column pos_item_variations.type_no is
  'Which of the dish''s types this choice is in. Type 1 carries the dish''s '
  'full price; a choice in type 2 or later ADDS its price to it (D27-192).';
comment on column pos_item_variations.kind is
  'size, quantity or option. NULL: not picked yet (made before 164, or imported).';
comment on column pos_item_variations.heading is
  'An Option''s heading, typed by the manager ("Spice level"). NULL for Size '
  'and Quantity, which are headed by their kind.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_item_variations_type_sane') then
    alter table pos_item_variations add constraint pos_item_variations_type_sane
      check (type_no >= 1
             and (kind is null or kind in ('size', 'quantity', 'option'))
             and (case when kind = 'option' then btrim(coalesce(heading, '')) <> ''
                       else heading is null end));
  end if;

  if exists (select 1 from pg_constraint
              where conname = 'pos_item_variations_item_id_label_key') then
    alter table pos_item_variations
      drop constraint pos_item_variations_item_id_label_key;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_item_variations_type_label_key') then
    alter table pos_item_variations add constraint pos_item_variations_type_label_key
      unique (item_id, type_no, label);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- The line: its first-type choice stays variation_id; the rest are here
-- -----------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists extra_choice_ids uuid[] not null default '{}';

comment on column pos_order_lines.extra_choice_ids is
  'The chosen choice of each type after the first, in type order. The line''s '
  'name and price already include them; this is what makes two lines the same '
  'dish (D27-189).';


-- -----------------------------------------------------------------------------
-- 045's rule, for every type: one choice of each, all of this dish
-- -----------------------------------------------------------------------------
create or replace function app.pos_line_names_its_variation()
returns trigger language plpgsql as $$
declare
  v_missing text;
begin
  -- Add-on lines name no item, and are not the subject of this rule.
  if new.addon_id is not null or new.item_id is null then
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

drop trigger if exists pos_order_lines_variation_named on pos_order_lines;
create trigger pos_order_lines_variation_named
  before insert or update of item_id, variation_id, extra_choice_ids on pos_order_lines
  for each row execute function app.pos_line_names_its_variation();
