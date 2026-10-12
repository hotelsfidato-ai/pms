-- =============================================================================
-- 208 · Numbered add-ons (the owner's D27-289, 9 October)
-- =============================================================================
-- A numbered list of Add-ons - number, name, price, a line on what it is -
-- that any dish can take: "Add-on 2 = Kebab, ₹120". On the order a waiter
-- taps Customise beside a dish, then 2, and the dish becomes ONE line, "Veg
-- Biryani with add-on Kebab", its price the dish's and the add-on's together.
--
-- NOT THE SIDES. 045's add-on groups (shown as "Sides" from now on) are
-- linked dish by dish and each side is its own child line - a separate row
-- on the bill, the docket and the kitchen screen. The owner wanted neither:
-- every dish, one line. So this is its own list and its own column, and 045
-- does not change.
--
-- THE NUMBER IS WHAT STAFF REMEMBER. Typed by whoever edits the menu, and
-- not given to a second add-on while the first is in use: unique per hotel
-- among the active ones. An add-on that goes is switched off (is_active
-- false), never renumbered; its number is then free again. "Off today" is
-- off_until, as for a dish.
--
-- NO DEFAULT PRICE (D27-120): a price is typed; 0 only when ticked Free.
--
-- THE LINE KEEPS WHAT WAS CHOSEN, AS IT WAS. `numbered_addons` on the dish's
-- line: the dish as named before its add-ons, its price before them, and each
-- add-on's id, number, name, price and how many - copied, like the line's own
-- name and price, so a price changed next month does not re-price a bill
-- printed today. The line's `name` and `unit_price` already include them,
-- which is what every total, discount, tax and report reads; the column is
-- what the bill's breakdown and the kitchen's "+ Kebab" are drawn from.
-- Taxed at the dish's own rate (the owner): it is part of the dish.
--
-- Re-runnable.
-- =============================================================================

create table if not exists pos_numbered_addons (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  number      int  not null,
  name        text not null,
  description text,
  price       numeric(10,2) not null,
  is_free     boolean not null default false,
  is_active   boolean not null default true,
  off_until   timestamptz,
  off_reason  text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  constraint pos_numbered_addons_number_sane check (number between 1 and 999),
  constraint pos_numbered_addons_name_given  check (length(btrim(name)) > 0),
  constraint pos_numbered_addons_price_sane  check (price >= 0),
  -- A 0 that nobody chose is the shipped price the project refuses (D27-120).
  constraint pos_numbered_addons_zero_is_free check (price > 0 or is_free)
);

comment on table pos_numbered_addons is
  'The numbered Add-ons any dish can take (D27-289): "2 = Kebab, ₹120". Not '
  'the Sides (045''s add-on groups, linked dish by dish). The number is what '
  'staff remember: unique among the active ones, never renumbered.';

-- One add-on per number while it is in use; a switched-off one frees it.
create unique index if not exists pos_numbered_addons_one_per_number
  on pos_numbered_addons (hotel_id, number) where is_active;

do $$
begin
  execute 'alter table pos_numbered_addons enable row level security';
  execute 'alter table pos_numbered_addons force  row level security';
  execute 'drop policy if exists hotel_isolation on pos_numbered_addons';
  execute $p$
    create policy hotel_isolation on pos_numbered_addons
      for all
      using      ( hotel_id in (select app.auth_hotel_ids()) )
      with check ( hotel_id in (select app.auth_hotel_ids()) )
  $p$;
  -- Their prices are prices: in the activity log, as the dishes' are (076).
  execute 'drop trigger if exists pos_numbered_addons_audit on pos_numbered_addons';
  execute 'create trigger pos_numbered_addons_audit
             after insert or update or delete on pos_numbered_addons
             for each row execute function app.write_audit()';
end $$;

-- Switched off, never deleted: a bill printed last month names it.
grant select, insert, update on pos_numbered_addons to pms_app;

-- -----------------------------------------------------------------------------
-- The dish's line keeps what was chosen
-- -----------------------------------------------------------------------------
alter table pos_order_lines
  add column if not exists numbered_addons jsonb;

comment on column pos_order_lines.numbered_addons is
  'The numbered add-ons on this dish (D27-289), as they were when chosen: '
  '{"dish": name before them, "base": price before them, "addons": [{id, '
  'number, name, price, qty}]}. Null when none. name and unit_price already '
  'include them.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_lines_numbered_addons_shape') then
    alter table pos_order_lines
      add constraint pos_order_lines_numbered_addons_shape check (
        numbered_addons is null
        or (    jsonb_typeof(numbered_addons) = 'object'
            and jsonb_typeof(numbered_addons -> 'addons') = 'array'
            and jsonb_array_length(numbered_addons -> 'addons') > 0
            -- On a dish, never on a side.
            and parent_line_id is null));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Only before the kitchen has it (the owner: add-ons before Send only)
-- -----------------------------------------------------------------------------
-- After Send the waiter adds a fresh line. Changing what a sent dish carries
-- would change food the kitchen is already cooking, with nothing on a docket
-- to say so. The API says it in a sentence; this holds against every role.
create or replace function app.numbered_addons_before_send()
returns trigger
language plpgsql
as $$
begin
  if new.numbered_addons is distinct from old.numbered_addons
     and old.kot_status <> 'pending' then
    raise exception 'The kitchen already has this dish - add a fresh line for its add-ons.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists pos_order_lines_numbered_addons_before_send on pos_order_lines;
create trigger pos_order_lines_numbered_addons_before_send
  before update of numbered_addons on pos_order_lines
  for each row execute function app.numbered_addons_before_send();
