-- =============================================================================
-- 028_pos_till.sql — the POS built INTO the PMS
-- =============================================================================
-- 024 built a BRIDGE: an outside till (Sattva, in eZee today) presents a key
-- and posts a finished bill. That is still how an outside till will work.
--
-- This is the other half — the PMS's OWN till. A waiter opens an order, adds
-- to it over forty minutes, and settles it. The difference is not cosmetic:
--
--     024's pos_tickets carries
--         check (status = 'rejected' or posting_id is not null)
--
--     "anything not refused actually reached the ledger". An OPEN order has
--     not reached the ledger and must not — the charge does not exist until
--     somebody settles the bill.
--
-- So the till does not reuse pos_tickets as its working state, and the
-- constraint is not relaxed to let it. It gets its own tables, and on
-- settlement it posts THROUGH THE SAME DOOR an outside POS uses.
--
-- That is the point worth keeping: the in-house till gets no privileged path
-- to the ledger. It earns its folio posting the same way Sattva does, which
-- means the idempotency (unique (outlet_id, ticket_ref)), the refusal
-- handling, and the folio posting path are already built and already tested.
-- A second way into the ledger would be a second thing to get wrong.
--
--                      pos_orders            (open, being added to)
--                          |  settle to room
--                          v
--                      pos_tickets  ---->  folio_postings
--                        (024)               (append-only)
--
-- A CASH sale never touches a folio, so it never creates a pos_tickets row.
-- pos_tickets stays exactly what its comment says: bills that reached a guest
-- folio, refusals included. pos_orders is the complete sales record.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The menu
-- -----------------------------------------------------------------------------
-- Structure here, ITEMS NOWHERE. This migration creates no dish and no price:
-- inventing "Paneer Tikka ₹320" for a hotel whose menu nobody has seen would
-- put a number on a screen that looks like Fidato's and is mine. Sample items
-- live in the demo loader with the invented guest names, where they belong.
-- -----------------------------------------------------------------------------

create table if not exists pos_menu_categories (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,

  -- Scoped to the hotel, not the outlet: a kitchen usually serves the
  -- restaurant and room service from one card. An outlet that needs its own
  -- gets it by filtering items, not by duplicating the category.
  name       text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (hotel_id, name)
);

create table if not exists pos_menu_items (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  category_id uuid not null references pos_menu_categories(id) on delete restrict,

  -- What a waiter reads on the terminal and what prints on the bill.
  name        text not null,

  -- The SELLING price, tax inclusive or not per the outlet's convention.
  -- numeric, never float: 3 × 0.1 must be 0.3 on a bill somebody pays.
  price       numeric(12,2) not null,

  -- Carried per item, not per outlet. Indian restaurant GST is 5% on food
  -- but a packaged drink can differ, and a bill that mixes them needs both.
  tax_rate    numeric(5,2) not null default 5.00,

  -- A dish that is off today, without deleting the history of selling it.
  is_active   boolean not null default true,
  sort_order  int not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (hotel_id, category_id, name),

  constraint pos_menu_items_price_sane check (price >= 0),
  constraint pos_menu_items_tax_sane   check (tax_rate >= 0 and tax_rate <= 100)
);

comment on table pos_menu_items is
  'What an outlet can sell. Prices are the hotel''s and are entered by the '
  'hotel — this schema ships no dish and no price.';


-- -----------------------------------------------------------------------------
-- The order — the till's working state
-- -----------------------------------------------------------------------------

create table if not exists pos_orders (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  outlet_id    uuid not null references pos_outlets(id),

  -- Human-facing, per hotel per day. What a waiter shouts across a kitchen.
  order_no     text not null,

  -- Where the order is being served. Free text because a real restaurant
  -- says "Table 4", "Poolside", "Room 203" and a constraint that insists on
  -- one of those is a constraint somebody works around.
  table_ref    text,

  -- The hotel's operating day, never now(). A 00:40 order belongs to the
  -- evening that is still being served, not to tomorrow.
  business_date date not null,

  -- open      being added to
  -- settled   paid; a room charge additionally has a pos_tickets row
  -- abandoned closed without payment, with a reason (a walkout, a duplicate)
  status       text not null default 'open',

  -- How it was paid. Null while open.
  settled_by   uuid references staff(id),
  settled_at   timestamptz,
  payment_method text,

  -- Set only for a room charge, and it is the LINK to the bridge: the
  -- ticket that carries the folio posting. A settled room order without one
  -- is a bill somebody thinks is on a folio and is not.
  ticket_id    uuid references pos_tickets(id),

  abandoned_reason text,

  opened_by    uuid not null references staff(id),
  opened_at    timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Same shape as the bridge's idempotency guarantee, for the same reason.
  unique (hotel_id, order_no),

  constraint pos_orders_status_valid check (status in
    ('open', 'settled', 'abandoned')),

  -- A settled order says who settled it and how. "Paid" with nobody's name
  -- on it is the row you cannot investigate later.
  constraint pos_orders_settled_complete check (
    status <> 'settled'
    or (settled_by is not null and settled_at is not null
        and payment_method is not null)),

  -- Settled to a room means there is a ticket carrying the folio posting.
  constraint pos_orders_room_has_ticket check (
    status <> 'settled' or payment_method <> 'room' or ticket_id is not null),

  -- An abandoned order says why. Same reason a refused bill does.
  constraint pos_orders_abandoned_has_reason check (
    status <> 'abandoned' or abandoned_reason is not null),

  constraint pos_orders_payment_valid check (
    payment_method is null or payment_method in
      ('room', 'cash', 'card', 'upi'))
);

create index if not exists pos_orders_open_idx
  on pos_orders (hotel_id, outlet_id) where status = 'open';
create index if not exists pos_orders_date_idx
  on pos_orders (hotel_id, business_date);


-- -----------------------------------------------------------------------------
-- The lines
-- -----------------------------------------------------------------------------
-- Price and tax are COPIED onto the line, not read through to pos_menu_items.
-- A menu price rises next month; a bill printed today must not change. The
-- same reason folio_postings carries its own amount.
-- -----------------------------------------------------------------------------

create table if not exists pos_order_lines (
  id         bigserial primary key,
  order_id   uuid not null references pos_orders(id) on delete cascade,
  hotel_id   uuid not null references hotels(id) on delete cascade,

  -- Kept for reporting ("how much paneer did we sell"), nullable because an
  -- item can be retired and the line it sold must survive it.
  item_id    uuid references pos_menu_items(id),

  -- The name AS SOLD. An item renamed later does not rewrite old bills.
  name       text not null,
  qty        numeric(8,3) not null,
  unit_price numeric(12,2) not null,
  tax_rate   numeric(5,2)  not null,

  -- "no chilli", "well done". Prints on the kitchen copy.
  note       text,

  -- A line struck before settlement. Kept rather than deleted: a waiter
  -- adding and removing the same dish four times is something a manager
  -- investigating a dispute wants to see.
  voided     boolean not null default false,
  voided_by  uuid references staff(id),
  voided_at  timestamptz,

  added_by   uuid not null references staff(id),
  added_at   timestamptz not null default now(),

  constraint pos_order_lines_qty_sane   check (qty > 0),
  constraint pos_order_lines_price_sane check (unit_price >= 0),
  constraint pos_order_lines_void_named check (
    not voided or (voided_by is not null and voided_at is not null))
);

create index if not exists pos_order_lines_order_idx
  on pos_order_lines (order_id);


-- -----------------------------------------------------------------------------
-- A settled order is history
-- -----------------------------------------------------------------------------
-- Nothing may be added to, removed from, or re-priced on an order that has
-- been paid. Without this the till is a way to change a bill after the guest
-- has left — and, for a room charge, to disagree with a folio posting that
-- is itself append-only.
--
-- Enforced in the DATABASE, against every role including the superuser, for
-- the same reason folio_postings is: a rule that lives only in the API is a
-- rule that holds until something else writes a row.
-- -----------------------------------------------------------------------------

create or replace function app.pos_order_lines_frozen()
returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from pos_orders
   where id = coalesce(new.order_id, old.order_id);

  if st is distinct from 'open' then
    raise exception
      'Order % is %, so its lines cannot change. Settle corrections with a '
      'credit on the folio, not by editing a paid bill.',
      coalesce(new.order_id, old.order_id), st
      using errcode = 'integrity_constraint_violation';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists pos_order_lines_frozen on pos_order_lines;
create trigger pos_order_lines_frozen
  before insert or update or delete on pos_order_lines
  for each row execute function app.pos_order_lines_frozen();


-- A settled order cannot go back to open. Reopening a paid bill is how a
-- charge disappears from a shift that has already been counted.
create or replace function app.pos_orders_no_reopen()
returns trigger language plpgsql as $$
begin
  if old.status in ('settled', 'abandoned') and new.status = 'open' then
    raise exception
      'Order % is % and cannot be reopened. Open a new order.',
      old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_no_reopen on pos_orders;
create trigger pos_orders_no_reopen
  before update on pos_orders
  for each row execute function app.pos_orders_no_reopen();


-- updated_at, the same way every other table does it.
do $t$
declare t text;
begin
  foreach t in array array['pos_menu_categories', 'pos_menu_items', 'pos_orders']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end
$t$;


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- Every one of these carries hotel_id, so every one takes the same policy in
-- the same form as 007 and 024. FORCE included: without it the table owner —
-- which is the role the API connects as — bypasses the policy and the table
-- looks protected while being open.
-- -----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array[
    'pos_menu_categories', 'pos_menu_items', 'pos_orders', 'pos_order_lines'
  ] loop
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
end
$rls$;

-- ASSERT THE PRIVILEGE, NEVER THE DDL.
--
-- 010_roles.sql runs `alter default privileges ... grant select, insert,
-- update, delete on tables to pms_app`, so every table above arrived with
-- DELETE already granted. Listing three privileges here would withhold
-- nothing and only make this file look like it had. Revoking is the only
-- thing that takes it away.
--
-- A sold line is evidence even after it is struck, which is why voiding sets
-- a flag rather than removing the row. An ORDER may be abandoned but never
-- deleted, for the same reason a refused bill is kept.
revoke delete on pos_menu_items, pos_orders, pos_order_lines from pms_app;

-- Categories keep DELETE: an empty category created by a typo should be
-- removable, and `on delete restrict` from pos_menu_items already refuses to
-- let one go while anything references it.


-- -----------------------------------------------------------------------------
-- The next order number
-- -----------------------------------------------------------------------------
-- Per hotel per business date, so a waiter reads "12" and not a uuid.
--
-- Takes the same advisory lock the invoice series takes, and for the same
-- reason: two waiters opening an order in the same second would otherwise
-- both read max()+1 and both get 12. A unique constraint would catch it, but
-- catching it means one of them sees an error while holding a table's order.
-- -----------------------------------------------------------------------------
create or replace function app.pos_next_order_no(p_hotel uuid, p_date date)
returns text language plpgsql as $$
declare n int;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_hotel::text || ':' || p_date::text, 0));

  select coalesce(max(split_part(order_no, '-', 2)::int), 0) + 1
    into n
    from pos_orders
   where hotel_id = p_hotel and business_date = p_date
     and order_no ~ '^[0-9]{8}-[0-9]+$';

  return to_char(p_date, 'YYYYMMDD') || '-' || n::text;
end $$;

comment on function app.pos_next_order_no(uuid, date) is
  'The next order number for a hotel''s operating day. Holds an advisory lock '
  'so two waiters opening at once do not both read the same max().';


-- -----------------------------------------------------------------------------
-- What an order is worth
-- -----------------------------------------------------------------------------
-- One definition, used by the till, the bill and the settlement, so the three
-- cannot disagree. Voided lines are excluded here rather than at each caller —
-- a caller that forgets is a bill that charges for a struck dish.
--
-- Rounded per line, then summed. Rounding the sum instead moves paise on a
-- bill somebody is holding.
-- -----------------------------------------------------------------------------
create or replace function app.pos_order_total(p_order uuid)
returns table (net numeric, tax numeric, gross numeric)
language sql stable as $$
  select
    coalesce(sum(round(qty * unit_price, 2)), 0)                        as net,
    coalesce(sum(round(qty * unit_price * tax_rate / 100.0, 2)), 0)     as tax,
    coalesce(sum(round(qty * unit_price, 2)
            + round(qty * unit_price * tax_rate / 100.0, 2)), 0)        as gross
  from pos_order_lines
 where order_id = p_order and not voided;
$$;
