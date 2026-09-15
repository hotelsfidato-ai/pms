-- =============================================================================
-- 069_stores.sql — what the hotel keeps, and where it went
-- =============================================================================
-- A hotel buys rice, gas, linen and soap, issues it to a kitchen or a floor,
-- throws some of it away, and at the end of the month wants to know what it
-- has and what it spent. That is the whole module.
--
-- IT IS A LEDGER, and it is built like the folio because it is the same shape.
--
--   ON HAND IS DERIVED, never stored. A `quantity_in_stock` column is a lie
--   waiting to happen: two people receive at once, one update overwrites the
--   other, and the number is wrong with nothing to compare it against. The
--   sum of the movements IS the stock, and it cannot disagree with itself.
--
--   MOVEMENTS ARE APPEND-ONLY. A receipt entered for the wrong item is
--   REVERSED with its own row, never edited. Somebody has to be able to ask
--   "why does the rice say forty kilos" and get an answer that goes back to a
--   delivery note.
--
--   QUANTITY IS SIGNED. One column, one definition. A receipt is positive, an
--   issue is negative, and stock is `sum(quantity)` — rather than two columns
--   whose difference somebody has to remember to take, in the right order, in
--   every query that ever touches them.
--
-- WHAT IS DELIBERATELY ABSENT
--
--   No `unit_price` on the item. An item does not have a price; a DELIVERY
--   has a price, and the same rice costs differently in June and October. The
--   cost lives on the receipt that brought it in, and an item nobody has
--   received yet is worth a dash rather than zero — the rule this whole
--   system is built on.
--
--   No supplier table yet. A name on the receipt is enough to answer "who
--   sold us this", and a table of suppliers with addresses and terms is a
--   different feature that can wait until somebody needs it. Building it now
--   would be furniture.
-- =============================================================================

create table if not exists stock_items (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  name          text not null,
  -- What it is counted in. Free text on purpose: a hotel counts eggs in
  -- pieces, rice in kilos, oil in litres and gas in cylinders, and an
  -- enumeration would be wrong within a week.
  unit          text not null,
  -- Kitchen, Housekeeping, Bar, Maintenance. Groups the list; nothing
  -- depends on it.
  category      text,

  -- NULL means nobody has asked to be warned about this one. Not zero:
  -- zero would mean "warn me when it runs out", which is a different and
  -- much later warning.
  reorder_level numeric(12,3),

  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (hotel_id, name),
  constraint stock_items_unit_present check (length(trim(unit)) > 0),
  constraint stock_items_reorder_sane check (reorder_level is null or reorder_level >= 0)
);

comment on table stock_items is
  'What the property keeps. Has no price — a delivery has a price, and the '
  'same rice costs differently in June and October.';

-- Redundant as a uniqueness claim; required as a TARGET. A composite foreign
-- key can only reference a unique constraint of matching shape, and the one
-- below is what stops a movement at one property counting toward another
-- property's item. 012 does exactly this for rooms and reservations.
-- ADDED ONLY IF ABSENT, never dropped and re-added. `rerun.sh` caught this on
-- the second pass: the composite foreign key below DEPENDS on this
-- constraint, so dropping it fails with "other objects depend on it" and the
-- whole deploy stops here. Every migration in this project has to survive
-- being applied to a database that already has it.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'stock_items_hotel_id_key'
                    and conrelid = 'stock_items'::regclass) then
    alter table stock_items add constraint stock_items_hotel_id_key
      unique (hotel_id, id);
  end if;
end $$;

create index if not exists stock_items_hotel on stock_items (hotel_id, name);


create table if not exists stock_movements (
  id            bigint generated always as identity primary key,
  hotel_id      uuid not null references hotels(id) on delete cascade,
  item_id       uuid not null,

  -- The hotel's operating day, never now(). Same rule as every other ledger
  -- here: a delivery signed for at 00:30 belongs to the day the desk is
  -- still working, not to the calendar.
  business_date date not null,

  kind          text not null,

  -- SIGNED. Positive brought it in, negative took it out. One column, one
  -- definition, and `sum(quantity)` is the stock.
  quantity      numeric(12,3) not null,

  -- Only a receipt has one. An issue to the kitchen does not "cost"
  -- anything — the money left when it was bought.
  unit_cost     numeric(12,2),

  supplier      text,
  -- The delivery note or bill number. What somebody holds in their hand
  -- when they ask why the rice says forty kilos.
  reference     text,
  note          text,

  -- Where an issue went. Null for a receipt, and null for an issue to
  -- somewhere that is not a till outlet — housekeeping has no outlet.
  to_outlet     uuid references pos_outlets(id),

  -- APPEND-ONLY, the same shape as folio_postings. A wrong movement is
  -- reversed by a row that points at it.
  reverses_id   bigint references stock_movements(id),

  moved_by      uuid references staff(id),
  moved_at      timestamptz not null default now(),

  constraint stock_movements_kind_known check (
    kind in ('receipt', 'issue', 'wastage', 'adjustment', 'return')),

  -- A movement of nothing is not a movement. It is somebody pressing the
  -- button twice and it clutters the history the ledger exists to be.
  constraint stock_movements_quantity_nonzero check (quantity <> 0),

  -- The SIGN follows the kind, and the database holds it so no screen can
  -- book a receipt that removes stock. `adjustment` is the exception and is
  -- the only kind that may go either way — that is what it is for.
  constraint stock_movements_sign_matches_kind check (
    case kind
      when 'receipt'    then quantity > 0
      when 'return'     then quantity < 0
      when 'issue'      then quantity < 0
      when 'wastage'    then quantity < 0
      else true
    end),

  constraint stock_movements_cost_sane check (unit_cost is null or unit_cost >= 0),

  -- Only a receipt carries a cost. A cost on an issue would be a second
  -- opinion about what something was worth, and the receipt already said.
  constraint stock_movements_cost_on_receipts check (
    unit_cost is null or kind = 'receipt')
);

comment on table stock_movements is
  'Every in and out, append-only. Stock on hand is sum(quantity) and is never '
  'stored — a quantity column would be wrong the first time two people '
  'received at once, with nothing to compare it against.';

comment on column stock_movements.quantity is
  'SIGNED. Positive in, negative out. One column rather than two whose '
  'difference somebody has to remember to take in the right order.';

-- ⚠ THE SINGLE-COLUMN FK WAS NOT ENOUGH, and the suite said so on the first
--   run: a movement could be recorded against PUN for an item belonging to
--   AGR. RLS would accept the write — the row carries the writer's own
--   hotel_id — and the quantity would then count toward another property's
--   stock, silently, in a figure nobody has any way to check.
--
--   COMPOSITE, so the database refuses rather than accepting the row and
--   letting RLS hide it. The same shape 012 applies to rooms, reservations
--   and folios, for the same reason. Rule D1.
alter table stock_movements drop constraint if exists stock_movements_item_id_fkey;
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'stock_movements_item_fk'
                    and conrelid = 'stock_movements'::regclass) then
    alter table stock_movements add constraint stock_movements_item_fk
      foreign key (hotel_id, item_id) references stock_items (hotel_id, id)
      on delete cascade;
  end if;
end $$;

create index if not exists stock_movements_item
  on stock_movements (item_id, business_date desc, id desc);
create index if not exists stock_movements_hotel_date
  on stock_movements (hotel_id, business_date desc);

-- A reversal points at exactly one movement, and only once. Two reversals of
-- one receipt would take the stock down twice.
create unique index if not exists stock_movements_one_reversal
  on stock_movements (reverses_id) where reverses_id is not null;


-- -----------------------------------------------------------------------------
-- Append-only, and it is the same trigger the folio uses
-- -----------------------------------------------------------------------------
drop trigger if exists stock_movements_append_only on stock_movements;
create trigger stock_movements_append_only
  before update or delete on stock_movements
  for each row execute function app.forbid_mutation();


-- -----------------------------------------------------------------------------
-- What is on hand
-- -----------------------------------------------------------------------------
-- Derived, every time, from the movements. The one definition of stock.
create or replace function app.stock_on_hand(p_item uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
    from stock_movements
   where item_id = p_item
     -- A reversed movement and its reversal cancel to zero, so both may stay
     -- in the sum. They are excluded anyway, because leaving them in makes
     -- the HISTORY read as though the stock moved and came back — which is
     -- not what happened. Somebody made a mistake and undid it.
     and reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = stock_movements.id
     )
$$;

comment on function app.stock_on_hand(uuid) is
  'What is in the store, summed from the movements. A reversed movement and '
  'its reversal are both excluded rather than left to cancel: they would '
  'read as stock that moved and came back, and nothing moved.';


-- -----------------------------------------------------------------------------
-- What it is worth
-- -----------------------------------------------------------------------------
-- WEIGHTED AVERAGE of what was actually paid, across the receipts that have
-- not been reversed. Not the last price — a hotel that bought rice at ₹40 and
-- then two kilos at ₹60 does not own rice worth ₹60 a kilo.
--
-- NULL when nothing has ever been received. That is the rule this system is
-- built on: an item nobody has bought yet has no value, and zero would be a
-- claim that it is worthless.
create or replace function app.stock_unit_cost(p_item uuid)
returns numeric
language sql
stable
as $$
  select case when sum(m.quantity) > 0
              then round(sum(m.quantity * m.unit_cost) / sum(m.quantity), 2)
         end
    from stock_movements m
   where m.item_id = p_item
     and m.kind = 'receipt'
     and m.unit_cost is not null
     and m.reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = m.id
     )
$$;

comment on function app.stock_unit_cost(uuid) is
  'Weighted average of what was actually paid. NULL when nothing has been '
  'received — an item nobody has bought has no value, and zero would claim '
  'it is worthless.';


-- -----------------------------------------------------------------------------
-- Reversing one
-- -----------------------------------------------------------------------------
-- The ONLY way to undo a movement, and it leaves both rows standing. Somebody
-- receiving 40kg of rice against the wrong item at seven in the morning needs
-- a way out that does not involve editing history.
create or replace function app.reverse_stock_movement(
  p_id bigint, p_by uuid, p_note text default null
) returns bigint
language plpgsql
as $$
declare
  m stock_movements;
  v_new bigint;
begin
  select * into m from stock_movements where id = p_id;
  if m.id is null then
    raise exception 'No such stock movement.';
  end if;
  if m.reverses_id is not null then
    raise exception 'That row is itself a reversal.'
      using hint = 'Reverse the movement it points at, or make a new one.';
  end if;
  if exists (select 1 from stock_movements r where r.reverses_id = p_id) then
    raise exception 'That movement has already been reversed.';
  end if;

  insert into stock_movements
    (hotel_id, item_id, business_date, kind, quantity, unit_cost,
     supplier, reference, note, to_outlet, reverses_id, moved_by)
  values
    (m.hotel_id, m.item_id, app.business_date(m.hotel_id),
     /* An 'adjustment', because the sign is the opposite of whatever it
        undoes and adjustment is the only kind allowed to go either way.
        Calling a reversed receipt a 'return' would say the goods went back
        to the supplier, which is a different thing that actually happened
        to somebody. */
     'adjustment', -m.quantity, null,
     m.supplier, m.reference,
     coalesce(p_note, 'Reversal of movement ' || p_id::text),
     m.to_outlet, p_id, p_by)
  returning id into v_new;

  return v_new;
end $$;

comment on function app.reverse_stock_movement(bigint, uuid, text) is
  'Undoes a movement by writing its opposite and pointing at it. Both rows '
  'stay: the store''s history is what somebody reads when the count is wrong.';


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
alter table stock_items enable row level security;
alter table stock_items force  row level security;
drop policy if exists stock_items_isolation on stock_items;
create policy stock_items_isolation on stock_items
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table stock_movements enable row level security;
alter table stock_movements force  row level security;
drop policy if exists stock_movements_isolation on stock_movements;
create policy stock_movements_isolation on stock_movements
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists stock_items_touch on stock_items;
create trigger stock_items_touch before update on stock_items
  for each row execute function app.touch_updated_at();

-- A movement must be recorded by somebody who works at that property. The
-- same assertion every other hotel-scoped ledger carries, applied by the same
-- function 012 wrote for it.
drop trigger if exists stock_movements_staff_scope on stock_movements;
create trigger stock_movements_staff_scope
  before insert or update on stock_movements
  for each row execute function app.assert_staff_has_hotel('moved_by');

grant select, insert, update on stock_items to pms_app;
grant select, insert on stock_movements to pms_app;
grant execute on function app.stock_on_hand(uuid) to pms_app;
grant execute on function app.stock_unit_cost(uuid) to pms_app;
grant execute on function app.reverse_stock_movement(bigint, uuid, text) to pms_app;
