-- =============================================================================
-- 067_tax_rules.sql
--   GST stops being a constant and becomes a rule — one set, for both the
--   front desk and the till.
-- =============================================================================
-- WHAT WAS THERE. `hotels.cgst_rate` and `hotels.sgst_rate`: one flat pair per
-- property, 2.5 + 2.5, read in six places across five API files, plus a third
-- source of truth in `pos_menu_items.tax_rate default 5.00`. Three copies of
-- one rule, which is the shape a wrong number arrives in.
--
-- WHY A CONSTANT CANNOT WORK. Indian hotel GST turns on the value of the
-- supply. The owner's own rules for 5 Elements Akkalkot:
--
--     a room at or under ₹7,500      5%
--     a room above ₹7,500           18%
--     the restaurant                 5%
--     the bar                        a rate the owner sets. Not assumed.
--
-- No column holds that. A slab is a function of what is sold and what it is
-- worth, and there is no honest way to write it as a number beside the hotel's
-- phone number.
--
-- THE SHAPE. Rows of (kind, over_amount, rate), and `app.gst_rate()` picks the
-- one that applies. `over_amount` is the value the rate applies ABOVE, so
-- 5EL's room rules are (0 → 5%) and (7500 → 18%): exactly ₹7,500 is 5%, and
-- ₹7,500.01 is 18%. That is what "above 7,500" means, and getting the boundary
-- wrong by a rupee is the kind of thing an assertion should hold still.
--
-- WHAT IT DOES WHEN THERE IS NO RULE. It RAISES. It does not return zero.
--
--   This is the project's oldest rule applied to tax: an unpriced thing shows
--   a dash, never a zero, because a zero is a claim and a dash is an
--   admission. A missing tax rate that silently becomes 0% does not look like
--   a bug — it looks like a bill. The bar has no rule until the owner sets
--   one, so a bar item cannot be sold until then, and the till says why.
--
-- WHAT IS NOT RECOMPUTED. Nothing already posted. `folio_postings.tax_rate`
-- and `pos_order_lines.tax_rate` are snapshots taken when the charge was
-- made, and 019 already says they must never be recalculated. Changing a rule
-- today does not reach a bill printed last month, and must not.
-- =============================================================================

create table if not exists tax_rules (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- What is being sold. Deliberately not an outlet id: the front desk has no
  -- outlet, and 'room' has to be sayable.
  kind          text not null,

  -- The rate applies to a value ABOVE this. The base row is 0, and it is the
  -- one that must exist for anything to be sellable at all.
  over_amount   numeric(12,2) not null default 0,

  rate          numeric(5,2)  not null,

  -- Why this slab exists, in the owner's words. It ends up on the settings
  -- screen, so the next person does not have to ask.
  note          text,

  set_by        uuid references staff(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One rate per boundary. Two rows claiming different rates above ₹7,500
  -- would make the answer depend on row order.
  unique (hotel_id, kind, over_amount),

  constraint tax_rules_kind_known check (
    kind in ('room', 'restaurant', 'bar', 'banquet', 'other')),
  constraint tax_rules_rate_sane check (rate >= 0 and rate <= 100),
  constraint tax_rules_over_sane check (over_amount >= 0)
);

comment on table tax_rules is
  'GST slabs per property and per kind of supply. The single source for both '
  'the PMS and the POS. A kind with no rows cannot be sold — see '
  'app.gst_rate(), which raises rather than assuming zero.';

comment on column tax_rules.over_amount is
  'The rate applies to a value strictly above this. 0 is the base row. A '
  'room slab of (0, 5) and (7500, 18) taxes exactly 7500 at 5%.';

create index if not exists tax_rules_lookup
  on tax_rules (hotel_id, kind, over_amount desc);

alter table tax_rules enable row level security;
alter table tax_rules force  row level security;
drop policy if exists tax_rules_isolation on tax_rules;
create policy tax_rules_isolation on tax_rules
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists tax_rules_touch on tax_rules;
create trigger tax_rules_touch before update on tax_rules
  for each row execute function app.touch_updated_at();

grant select, insert, update, delete on tax_rules to pms_app;


-- -----------------------------------------------------------------------------
-- The one definition, with two faces
-- -----------------------------------------------------------------------------
-- `_or_null` is the lookup. `gst_rate` is the lookup plus a refusal. Two
-- functions rather than one because the two callers want opposite things and
-- neither should reimplement the slab:
--
--   a posting  wants the raise. Writing a charge with no rate is not
--              something to recover from — it is a bill that would be wrong.
--   a screen   wants the null. The till has to say "the bar has no GST rate
--              set" in a sentence a waiter can act on, and an exception
--              surfacing as a 500 is not that sentence.
--
-- The slab itself is written once, here.
create or replace function app.gst_rate_or_null(
  p_hotel uuid,
  p_kind  text,
  p_value numeric
) returns numeric
language sql
stable
as $$
  select rate
    from tax_rules
   where hotel_id = p_hotel
     and kind = p_kind
     -- The base row (0) always applies; a higher slab applies only when the
     -- value is strictly above it. Written this way rather than `>= 0` so a
     -- zero-value line still resolves to the base rate instead of nothing.
     and (over_amount = 0 or coalesce(p_value, 0) > over_amount)
   order by over_amount desc
   limit 1
$$;

comment on function app.gst_rate_or_null(uuid, text, numeric) is
  'The GST rate for one supply, or null when no rule covers it. The slab '
  'arithmetic lives here and nowhere else.';

create or replace function app.gst_rate(
  p_hotel uuid,
  p_kind  text,
  p_value numeric
) returns numeric
language plpgsql
stable
as $$
declare
  v_rate numeric(5,2);
begin
  v_rate := app.gst_rate_or_null(p_hotel, p_kind, p_value);

  if v_rate is null then
    raise exception 'No GST rule for % at this property.', p_kind
      using hint = 'Settings → Tax. A missing rate is not zero — nothing '
                   'can be billed under this heading until it is set.',
            errcode = 'check_violation';
  end if;

  return v_rate;
end $$;

comment on function app.gst_rate(uuid, text, numeric) is
  'The GST rate for one supply. Raises when no rule exists — a missing rate '
  'is never zero. The only place this arithmetic lives.';


-- -----------------------------------------------------------------------------
-- The till learns which rule it belongs to
-- -----------------------------------------------------------------------------
-- An outlet already had `category`, which drives the kitchen and the menu.
-- Tax is a different question — a coffee shop and a restaurant are both 'food'
-- and are taxed alike, while a bar sitting in the same building is not.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'pos_outlets' and column_name = 'tax_kind') then
    execute 'alter table pos_outlets add column tax_kind text';
  end if;
end $$;

alter table pos_outlets drop constraint if exists pos_outlets_tax_kind_known;
alter table pos_outlets
  add constraint pos_outlets_tax_kind_known
  check (tax_kind is null or tax_kind in ('restaurant', 'bar', 'banquet', 'other'));

-- Existing outlets are restaurants; that is what every one of them is today.
-- A bar gets created as a bar and never has to be corrected.
update pos_outlets set tax_kind = 'restaurant' where tax_kind is null;

comment on column pos_outlets.tax_kind is
  'Which tax_rules.kind this outlet sells under. Null is unset and refuses '
  'to sell rather than guessing.';


-- -----------------------------------------------------------------------------
-- ...and so does the menu category, which is where it actually decides things
-- -----------------------------------------------------------------------------
-- The outlet was the obvious place and turned out to be the wrong one. Menu
-- categories carry no outlet_id — the card is per property, not per counter —
-- so an outlet's kind cannot reach an item.
--
-- The category is the better home anyway. A bar is not a separate building; it
-- is a section of the same card, and "Spirits" and "Main course" are exactly
-- the line a rate changes on. It also means the owner sets this while writing
-- the menu, in the place they are already looking, rather than in a screen
-- about outlets they will visit once.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'pos_menu_categories'
                    and column_name = 'tax_kind') then
    execute 'alter table pos_menu_categories add column tax_kind text';
  end if;
end $$;

alter table pos_menu_categories drop constraint if exists pos_menu_categories_tax_kind_known;
alter table pos_menu_categories
  add constraint pos_menu_categories_tax_kind_known
  check (tax_kind is null or tax_kind in ('restaurant', 'bar', 'banquet', 'other'));

-- Everything that exists today is food. A category created for the bar is
-- created as one and never has to be corrected.
update pos_menu_categories set tax_kind = 'restaurant' where tax_kind is null;

comment on column pos_menu_categories.tax_kind is
  'Which tax_rules.kind the items in this category are taxed under. This is '
  'how a bar section on the same menu carries a different rate from the food.';


-- -----------------------------------------------------------------------------
-- A menu item may follow the rule instead of carrying its own rate
-- -----------------------------------------------------------------------------
-- `tax_rate numeric not null default 5.00` was a third source of truth AND a
-- silent default in a project whose central rule is that nothing ships a
-- price. Every item created through the interface got 5% whether or not
-- anybody had thought about it, and a bar built on this schema would have
-- billed its whisky at the restaurant's rate without a word.
--
-- Null now means FOLLOW THE OUTLET'S RULE, which is what almost every item
-- wants. An explicit rate stays available for the genuine exception — bottled
-- water on a restaurant bill is the standard one — and is resolved in exactly
-- one place, where the order line is written.
alter table pos_menu_items alter column tax_rate drop not null;
alter table pos_menu_items alter column tax_rate drop default;

comment on column pos_menu_items.tax_rate is
  'Null follows the outlet''s tax_rules entry, which is what most items want. '
  'Set it only for a genuine exception, such as packaged water on a food '
  'bill. Was `not null default 5.00`, which taxed a bar like a restaurant.';


-- -----------------------------------------------------------------------------
-- The columns this replaces
-- -----------------------------------------------------------------------------
-- Left in place rather than dropped: the invoice header still reads them while
-- the API moves over, and a column dropped in the same migration that adds its
-- replacement gives you nowhere to stand if the replacement is wrong. They are
-- no longer the source of any posted rate.
comment on column hotels.cgst_rate is
  'SUPERSEDED by tax_rules (067). No posting reads this. Kept only until the '
  'settings screen stops displaying it.';
comment on column hotels.sgst_rate is
  'SUPERSEDED by tax_rules (067). See hotels.cgst_rate.';
