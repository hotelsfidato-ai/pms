-- =============================================================================
-- 045 — an item is not one price
-- =============================================================================
-- `pos_menu_items` is name, price, tax_rate. One row, one price. The real menu
-- it has to hold is not shaped like that:
--
--   Bhaaji Pau        VARIATION   Oil ₹300  ·  Butter ₹400
--                     ADD-ONS     Sides: Onions ₹25, Coriander Chutney ₹25,
--                                        Curd ₹25, Pudina Chutney ₹25
--
-- and the kitchen docket prints the add-ons INDENTED UNDER the dish, with the
-- note beneath them:
--
--   Bhaaji Pau (Butter)                      1
--     Sides: Onions - 1,
--     Sides: Coriander Chutney - 1
--     [Note] Less Spicy
--
-- THIS IS THE LINE MODEL CHANGING, which is why it comes first. A line stops
-- being "an item at a price" and becomes either a DISH — optionally naming a
-- variation — or an ADD-ON hanging off one. Every bill, kitchen ticket and
-- folio posting already written reads that model. Against empty tables it is a
-- migration; against a live menu it is a data migration of open orders.
--
-- WHAT DOES NOT CHANGE, deliberately: an add-on is a LINE. It carries its own
-- name, price, quantity and tax rate, so app.pos_order_by_rate and
-- app.pos_order_total already total it correctly, the discount already
-- apportions across it, and the folio posting already splits it by rate. A
-- separate "add-ons" money column would have needed all four of those taught
-- about it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Variations — the same dish at a different price
-- -----------------------------------------------------------------------------
create table if not exists pos_item_variations (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  item_id    uuid not null references pos_menu_items(id) on delete cascade,

  -- "Oil", "Butter", "Medium", "Large". Printed in brackets after the dish.
  label      text not null,
  price      numeric(12,2) not null,

  is_active  boolean not null default true,
  sort_order int not null default 0,

  created_at timestamptz not null default now(),

  unique (item_id, label),
  constraint pos_item_variations_price_sane check (price >= 0)
);

comment on table pos_item_variations is
  'One dish at several prices. An item with variations has NO sellable price of '
  'its own — the variation carries it, and a line that names no variation for '
  'such an item is refused.';

create index if not exists pos_item_variations_item_idx
  on pos_item_variations (item_id) where is_active;


-- -----------------------------------------------------------------------------
-- Add-on groups, and the add-ons in them
-- -----------------------------------------------------------------------------
-- A GROUP belongs to the hotel, not to a dish. "Sides" is one list that a dozen
-- dishes offer, and giving each dish its own copy means the price of onions is
-- stored a dozen times and changes in eleven of them.
-- -----------------------------------------------------------------------------
create table if not exists pos_addon_groups (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,

  label      text not null,          -- "Sides", "Extra toppings"

  -- How many of this group a guest may take. min 1 makes it a required
  -- choice; max null means as many as they like.
  min_select smallint not null default 0,
  max_select smallint,

  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  unique (hotel_id, label),
  constraint pos_addon_groups_select_sane check (
    min_select >= 0 and (max_select is null or max_select >= min_select))
);

create table if not exists pos_addons (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  group_id   uuid not null references pos_addon_groups(id) on delete cascade,

  label      text not null,
  price      numeric(12,2) not null,

  -- Same mechanism as an item: "we are out of pudina chutney" until a time,
  -- never a flag somebody has to remember to clear.
  off_until  timestamptz,

  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),

  unique (group_id, label),
  constraint pos_addons_price_sane check (price >= 0)
);

comment on column pos_addons.off_until is
  'Out of stock until this moment. A timestamp rather than a boolean, because a '
  'flag somebody must remember to unset is an add-on missing for a week.';

-- Which dishes offer which groups.
create table if not exists pos_item_addon_groups (
  item_id    uuid not null references pos_menu_items(id) on delete cascade,
  group_id   uuid not null references pos_addon_groups(id) on delete cascade,
  sort_order int not null default 0,
  primary key (item_id, group_id)
);


-- -----------------------------------------------------------------------------
-- The menu, as a biller uses it
-- -----------------------------------------------------------------------------
alter table pos_menu_items
  add column if not exists short_code  text,
  add column if not exists is_veg      boolean,
  add column if not exists is_favourite boolean not null default false,
  add column if not exists off_until   timestamptz,
  add column if not exists off_reason  text;

comment on column pos_menu_items.short_code is
  'What a fast biller actually types. Unique per hotel so it can be typed '
  'blind, and nullable because most items never get one.';

comment on column pos_menu_items.is_veg is
  'NULL means not stated. Three states on purpose: veg, non-veg, and nobody '
  'has said — and the third must not render as the green mark.';

comment on column pos_menu_items.off_until is
  '"We are out of paneer", until a time. The most-used menu action in a live '
  'kitchen.';

create unique index if not exists pos_menu_items_short_code_idx
  on pos_menu_items (hotel_id, upper(short_code))
  where short_code is not null;


-- -----------------------------------------------------------------------------
-- The line: a dish, or an add-on hanging off one
-- -----------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists variation_id   uuid references pos_item_variations(id),
  add column if not exists addon_id       uuid references pos_addons(id),
  add column if not exists parent_line_id bigint references pos_order_lines(id) on delete cascade;

comment on column pos_order_lines.parent_line_id is
  'Set on an ADD-ON line, naming the dish it belongs to. An add-on is a line '
  'like any other so the totals, the discount apportionment and the per-rate '
  'folio posting all handle it without being taught anything new.';

create index if not exists pos_order_lines_parent_idx
  on pos_order_lines (parent_line_id) where parent_line_id is not null;

do $$
begin
  -- A line with a parent IS an add-on. The reverse is not asserted: an add-on
  -- with no parent is a line somebody has not attached yet, and the till
  -- attaches it in the next statement.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_lines_child_is_addon') then
    alter table pos_order_lines add constraint pos_order_lines_child_is_addon
      check (parent_line_id is null or addon_id is not null);
  end if;

  -- A line cannot be its own parent. Cheap, and the alternative is a query
  -- that never returns.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_lines_not_self_parent') then
    alter table pos_order_lines add constraint pos_order_lines_not_self_parent
      check (parent_line_id is null or parent_line_id <> id);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- One level, and no deeper
-- -----------------------------------------------------------------------------
-- The check constraint above says a child is an add-on. It does NOT say the
-- PARENT is a dish — an add-on could name another add-on and the constraint
-- would be satisfied, because both rows are add-ons.
--
-- An add-on on an add-on is not something a kitchen can plate, and the docket
-- would need recursion to print it. A constraint cannot see another row, so
-- this is a trigger.
-- -----------------------------------------------------------------------------
create or replace function app.pos_addons_are_one_level()
returns trigger language plpgsql as $$
declare
  v_parent_of_parent bigint;
begin
  if new.parent_line_id is null then
    return new;
  end if;

  select parent_line_id into v_parent_of_parent
    from pos_order_lines where id = new.parent_line_id;

  if v_parent_of_parent is not null then
    raise exception 'an add-on cannot hang off another add-on'
      using hint = 'Attach it to the dish.';
  end if;
  return new;
end $$;

drop trigger if exists pos_order_lines_one_level on pos_order_lines;
create trigger pos_order_lines_one_level
  before insert or update of parent_line_id on pos_order_lines
  for each row execute function app.pos_addons_are_one_level();


-- -----------------------------------------------------------------------------
-- An item with variations has no price of its own
-- -----------------------------------------------------------------------------
-- The dangerous case is silent: Bhaaji Pau gains an Oil and a Butter variation,
-- and a till that still rings the ITEM charges whatever `pos_menu_items.price`
-- happens to hold — a number nobody has looked at since the variations were
-- added. The guest is charged a price that is on no menu.
-- -----------------------------------------------------------------------------
create or replace function app.pos_line_names_its_variation()
returns trigger language plpgsql as $$
declare
  v_has_variations boolean;
begin
  -- Add-on lines name no item, and are not the subject of this rule.
  if new.addon_id is not null or new.item_id is null then
    return new;
  end if;

  select exists (select 1 from pos_item_variations
                  where item_id = new.item_id and is_active)
    into v_has_variations;

  if v_has_variations and new.variation_id is null then
    raise exception
      'this dish is sold by variation, and none was chosen'
      using hint = 'Ring the Oil or the Butter, not the dish itself.';
  end if;

  if new.variation_id is not null and not exists (
       select 1 from pos_item_variations
        where id = new.variation_id and item_id = new.item_id) then
    raise exception 'that variation belongs to a different dish';
  end if;

  return new;
end $$;

drop trigger if exists pos_order_lines_variation_named on pos_order_lines;
create trigger pos_order_lines_variation_named
  before insert or update of item_id, variation_id on pos_order_lines
  for each row execute function app.pos_line_names_its_variation();


-- -----------------------------------------------------------------------------
-- Striking a dish strikes what was added to it
-- -----------------------------------------------------------------------------
-- Otherwise the onions survive the Bhaaji Pau: the guest is charged ₹25 for a
-- side to a dish that was struck, and it appears on the bill under nothing.
-- -----------------------------------------------------------------------------
create or replace function app.pos_void_cascades_to_addons()
returns trigger language plpgsql as $$
begin
  if new.voided and not old.voided then
    update pos_order_lines
       set voided = true, voided_by = new.voided_by, voided_at = new.voided_at
     where parent_line_id = new.id and not voided;
  end if;
  return new;
end $$;

drop trigger if exists pos_order_lines_void_cascade on pos_order_lines;
create trigger pos_order_lines_void_cascade
  after update of voided on pos_order_lines
  for each row execute function app.pos_void_cascades_to_addons();


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pos_item_variations', 'pos_addon_groups', 'pos_addons']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;
end $$;

-- pos_item_addon_groups has no hotel_id of its own: it is a join between two
-- tables that are each already isolated, and adding one would be a third place
-- for the same fact to be wrong.
alter table pos_item_addon_groups enable row level security;
alter table pos_item_addon_groups force  row level security;
drop policy if exists item_addon_groups_isolation on pos_item_addon_groups;
create policy item_addon_groups_isolation on pos_item_addon_groups
  for all
  using ( item_id in (select id from pos_menu_items) )
  with check ( item_id in (select id from pos_menu_items) );

grant select, insert, update, delete on pos_item_variations   to pms_app;
grant select, insert, update, delete on pos_addon_groups       to pms_app;
grant select, insert, update, delete on pos_addons             to pms_app;
grant select, insert, update, delete on pos_item_addon_groups  to pms_app;
