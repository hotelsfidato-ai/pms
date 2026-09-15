-- =============================================================================
-- 061 — feeding the function, or not
-- =============================================================================
-- Asked whether a banquet booking includes food, the group's answer was that
-- it depends:
--
--   "this need to check as this is situation to situation basis so can be
--    served can not be but need to keep the option open for both"
--
-- So food is OPTIONAL ENTIRELY — a hall let for a meeting with nothing served
-- is a complete, correct booking and nothing in this file makes it look
-- unfinished — and BOTH SOURCES stay open:
--
--   A PACKAGE      a per-head rate agreed for the function. The usual case
--                  for a wedding: two hundred plates at a price.
--   THE POS MENU   à la carte from an outlet, charged to the event's folio
--                  like any other bill. The usual case for a meeting that
--                  orders tea in the afternoon.
--
-- They are not alternatives and an event may have both, which is why this is
-- two mechanisms and not one field with a mode.
--
-- NO DEFAULT PRICE, again. A package's `rate_per_head` is NULL until somebody
-- types one, and the rate CHARGED is snapshotted onto the event when it is
-- attached — the same rule as `reservations.agreed_rate` and
-- `banquet_events.agreed_amount`. Repricing a package in March must not
-- reprice a wedding sold in January.
--
-- AND AN UNPRICED LINE POISONS THE TOTAL RATHER THAN ADDING ZERO. `app.
-- tariff_for` set that precedent for extra persons: if any component is
-- unpriced the total is NULL and the caller is told WHICH, so a screen can say
-- "no price for the dinner package" instead of quietly quoting for the hall
-- alone. A quotation that is short by two hundred plates is worse than no
-- quotation.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The packages a property offers
-- -----------------------------------------------------------------------------
-- NO PACKAGE IS SHIPPED. Every hotel caters differently and a "Silver / Gold /
-- Platinum" set invented here would be three menus nobody at the property has
-- ever agreed to cook.
-- -----------------------------------------------------------------------------
create table if not exists banquet_packages (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  name          text not null,
  description   text,

  -- NULL until somebody types one. A package with no rate is still useful —
  -- it names what is served, and the price is agreed per function, which is
  -- exactly how the group described banquet pricing.
  rate_per_head numeric(10,2),

  -- Veg / non-veg / jain, and so on. Free text on purpose: a fixed list here
  -- would be a decision about somebody else's kitchen.
  meal_type     text,

  is_active     boolean not null default true,
  sort_order    int not null default 0,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint bp_name_present check (length(trim(name)) > 0),
  constraint bp_rate_sane    check (rate_per_head is null or rate_per_head >= 0),
  constraint bp_name_unique  unique (hotel_id, name)
);

comment on table banquet_packages is
  'Catering packages a property offers. None is shipped, and rate_per_head is '
  'NULL until somebody types one -- a package with no rate still names what is '
  'served, which is how banquet food is usually sold here.';


-- -----------------------------------------------------------------------------
-- What this function is actually being fed
-- -----------------------------------------------------------------------------
create table if not exists banquet_event_packages (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  event_id    uuid not null references banquet_events(id) on delete cascade,
  package_id  uuid references banquet_packages(id),

  -- Named here as well as on the package, because a function often gets
  -- something off-menu: "Dinner, as discussed". A row with no package_id and
  -- a name is a perfectly good line.
  name        text not null,

  -- How many plates. Required — a per-head rate with no head count is not a
  -- price, and this is the number the whole line multiplies by.
  pax         int not null,

  -- THE RATE AGREED FOR THIS FUNCTION, snapshotted. NULL means the kitchen is
  -- confirmed and the price is not, which is a real state on the day a
  -- wedding is pencilled in.
  rate_per_head numeric(10,2),

  notes       text,
  added_by    uuid not null references staff(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint bep_name_present check (length(trim(name)) > 0),
  constraint bep_pax_sane     check (pax > 0),
  constraint bep_rate_sane    check (rate_per_head is null or rate_per_head >= 0)
);

comment on table banquet_event_packages is
  'The catering on one function. Zero rows is a complete booking -- a hall let '
  'for a meeting feeds nobody. rate_per_head is snapshotted, so repricing the '
  'package in March cannot reprice a wedding sold in January.';

comment on column banquet_event_packages.rate_per_head is
  'What was agreed for THIS function. NULL means the menu is settled and the '
  'price is not, which is a real state -- and it makes the event total NULL '
  'rather than quietly quoting for the hall alone.';

create index if not exists bep_event_idx on banquet_event_packages (event_id);


-- -----------------------------------------------------------------------------
-- The other source: the POS menu
-- -----------------------------------------------------------------------------
-- A meeting that orders tea does not need a package; it needs the till, and
-- the bill to reach the function's folio instead of a room. `pos_orders`
-- already knows how to settle to a folio, so this is one nullable column and
-- not a second billing path.
-- -----------------------------------------------------------------------------
alter table pos_orders add column if not exists event_id uuid references banquet_events(id);

create index if not exists pos_orders_event_idx
  on pos_orders (event_id) where event_id is not null;

comment on column pos_orders.event_id is
  'Set when a POS bill is charged to a banquet function rather than a room. '
  'The order is otherwise an ordinary order -- same till, same kitchen '
  'docket, same day end.';


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table banquet_packages enable row level security;
alter table banquet_packages force  row level security;
drop policy if exists banquet_packages_isolation on banquet_packages;
create policy banquet_packages_isolation on banquet_packages
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table banquet_event_packages enable row level security;
alter table banquet_event_packages force  row level security;
drop policy if exists banquet_event_packages_isolation on banquet_event_packages;
create policy banquet_event_packages_isolation on banquet_event_packages
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists banquet_packages_touch on banquet_packages;
create trigger banquet_packages_touch before update on banquet_packages
  for each row execute function app.touch_updated_at();

drop trigger if exists banquet_event_packages_touch on banquet_event_packages;
create trigger banquet_event_packages_touch before update on banquet_event_packages
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- The catering line belongs to the same property as the event
-- -----------------------------------------------------------------------------
create or replace function app.banquet_package_is_here()
returns trigger language plpgsql as $$
declare v_hotel uuid;
begin
  select hotel_id into v_hotel from banquet_events where id = new.event_id;
  if v_hotel is null then
    raise exception 'no such function';
  end if;
  if v_hotel <> new.hotel_id then
    raise exception 'that function belongs to another property';
  end if;

  if new.package_id is not null then
    select hotel_id into v_hotel from banquet_packages where id = new.package_id;
    if v_hotel <> new.hotel_id then
      raise exception 'that package belongs to another property';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bep_same_property on banquet_event_packages;
create trigger bep_same_property
  before insert or update on banquet_event_packages
  for each row execute function app.banquet_package_is_here();


-- -----------------------------------------------------------------------------
-- What the function comes to
-- -----------------------------------------------------------------------------
-- ONE DEFINITION of the arithmetic, for the reason 040 gives: the quotation
-- screen, the event panel and the folio must not each add this up their own
-- way. And it follows `app.tariff_for` exactly — an unpriced component makes
-- the total NULL and NAMES itself, rather than contributing a zero.
--
-- `unpriced` is a sentence a screen can show. A GM reading "no price for the
-- hall, no price for Dinner" can fix it; a GM reading a total that is short
-- by two hundred plates cannot tell there is anything to fix.
-- -----------------------------------------------------------------------------
drop function if exists app.banquet_event_total(uuid);
create function app.banquet_event_total(p_event uuid)
returns table (
  venue_amount   numeric,
  food_amount    numeric,
  pos_amount     numeric,
  total          numeric,   -- NULL when anything above is unpriced
  unpriced       text       -- NULL when everything has a price
)
language plpgsql stable as $$
declare
  v_venue   numeric;
  v_food    numeric;
  v_pos     numeric;
  v_missing text[] := '{}';
  v_title   text;
  r         record;
begin
  select agreed_amount, title into v_venue, v_title
    from banquet_events where id = p_event;
  if v_title is null then
    raise exception 'no such function';
  end if;

  if v_venue is null then
    v_missing := array_append(v_missing, 'the hall');
  end if;

  /* Every catering line, priced or not. Summing only the priced ones is the
     trap: it produces a plausible number that is quietly wrong. */
  v_food := 0;
  for r in
    select name, pax, rate_per_head from banquet_event_packages
     where event_id = p_event order by created_at
  loop
    if r.rate_per_head is null then
      v_missing := array_append(v_missing, r.name);
    else
      v_food := v_food + (r.pax * r.rate_per_head);
    end if;
  end loop;

  /* Settled POS bills charged to this function. Open orders are deliberately
     excluded: a bill still being added to is not yet an amount, and including
     it would make the total move while somebody watched it. */
  select coalesce(sum(pt.payable), 0) into v_pos
    from pos_orders o
    cross join lateral app.pos_order_total(o.id) pt
   where o.event_id = p_event and o.status = 'settled';

  return query select
    v_venue,
    v_food,
    v_pos,
    case when array_length(v_missing, 1) is null
         then coalesce(v_venue, 0) + v_food + v_pos
         else null end,
    case when array_length(v_missing, 1) is null then null
         when array_length(v_missing, 1) = 1
           then 'No price yet for ' || v_missing[1] || '.'
         else 'No price yet for ' ||
              array_to_string(v_missing[1:array_length(v_missing,1)-1], ', ') ||
              ' or ' || v_missing[array_length(v_missing,1)] || '.'
    end;
end $$;

comment on function app.banquet_event_total(uuid) is
  'Hall plus catering plus settled POS bills. The total is NULL if ANY '
  'component is unpriced, and `unpriced` names which -- a quotation short by '
  'two hundred plates is worse than no quotation. Follows app.tariff_for.';


grant select, insert, update on banquet_packages to pms_app;
grant select, insert, update, delete on banquet_event_packages to pms_app;
grant execute on function app.banquet_event_total(uuid) to pms_app;
