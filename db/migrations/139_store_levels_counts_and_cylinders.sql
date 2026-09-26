-- =============================================================================
-- 139 · A store's levels, its count, and cylinders full and empty
-- =============================================================================
-- The Store's second part (D22-38), the owner's answers D25-12 to D25-19
-- (docs/briefs/decisions-2026-09-25.md).
--
--   LEVELS PER STORE (D25-12, D25-13). Until now an item had one "warn me
--   below" figure for the whole hotel (069's reorder_level). A level is now
--   per item PER STORE, a row in stock_levels; no row, or a null, is no level
--   - a dash, never "below". Today's figure becomes the Main store's level,
--   where every older movement sits (D17-2), and the item's column is emptied
--   so nothing reads two answers.
--
--   THE COUNT (D25-15..17) needs nothing new here: each difference is an
--   `adjustment`, written by the Store's API with who saved it and why. 069
--   and 112 already hold it.
--
--   CYLINDERS (D25-18, D25-19). An item counted in "cylinder" is FULL
--   cylinders, as before; its EMPTIES are movements of the same item marked
--   `empty`, in the same stores, so the ledger's rules (append-only, per store,
--   undo) cover them unchanged. On hand stays full only - every reader of
--   app.stock_on_hand (the Store, Purchasing) keeps its meaning. The deposit
--   the supplier holds is two typed figures on the item, null until typed.
--
-- Never edits 069 or 112: their functions are replaced here with the same
-- signatures and return types (MEMORY 317). Replay-safe (MEMORY 162, 284).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- What counts as a cylinder
-- -----------------------------------------------------------------------------
-- The owner's rule (D25-18): an item counted in "cylinder". ONE definition,
-- read by the API's list and by the check below.
create or replace function app.counted_in_cylinders(p_unit text)
returns boolean
language sql
immutable
as $$
  select lower(trim(p_unit)) in ('cylinder', 'cylinders')
$$;

grant execute on function app.counted_in_cylinders(text) to pms_app;


-- -----------------------------------------------------------------------------
-- A level per item, per store (D25-12, D25-13)
-- -----------------------------------------------------------------------------
create table if not exists stock_levels (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  item_id        uuid not null,
  location_id    uuid not null references locations(id),
  -- NULL is a level somebody cleared: no warning, the same as no row.
  reorder_level  numeric(12,3),
  set_by         uuid references staff(id),
  set_at         timestamptz not null default now(),

  unique (item_id, location_id),
  -- The same composite key 069 gives a movement: a level at one property
  -- cannot point at another's item (MEMORY 161).
  constraint stock_levels_item_fk foreign key (hotel_id, item_id)
    references stock_items (hotel_id, id) on delete cascade,
  constraint stock_levels_sane check (reorder_level is null or reorder_level >= 0)
);

comment on table stock_levels is
  'The level an item is warned at, per store (D25-12). No row, or NULL, is no '
  'level: a dash, never "below".';

-- A store at this property, and a store: 112's check, read as it is - the
-- columns it reads have the same names here.
drop trigger if exists stock_levels_place on stock_levels;
create trigger stock_levels_place
  before insert or update on stock_levels
  for each row execute function app.stock_movement_place();

alter table stock_levels enable row level security;
alter table stock_levels force  row level security;
drop policy if exists stock_levels_isolation on stock_levels;
create policy stock_levels_isolation on stock_levels
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

drop trigger if exists stock_levels_audit on stock_levels;
create trigger stock_levels_audit after insert or update or delete on stock_levels
  for each row execute function app.write_audit();

grant select, insert, update on stock_levels to pms_app;
revoke delete on stock_levels from pms_app;

-- D25-12: today's one figure becomes the Main store's level, and the item's
-- own column is emptied - one place holds a level from now on. A replay finds
-- every column already empty and copies nothing.
insert into stock_levels (hotel_id, item_id, location_id, reorder_level)
select i.hotel_id, i.id, app.main_store(i.hotel_id), i.reorder_level
  from stock_items i
 where i.reorder_level is not null
on conflict (item_id, location_id) do nothing;

update stock_items set reorder_level = null where reorder_level is not null;

comment on column stock_items.reorder_level is
  'No longer read or written: a level is per store, in stock_levels (D25-12). '
  'Emptied when its figures moved to each item''s Main store.';


-- -----------------------------------------------------------------------------
-- Empty cylinders (D25-18)
-- -----------------------------------------------------------------------------
alter table stock_movements
  add column if not exists empty boolean not null default false;

comment on column stock_movements.empty is
  'An EMPTY cylinder of this item (D25-18): back from the kitchen (receipt), '
  'taken by the supplier (return), or counted (adjustment). Never in on hand.';

-- Empties come in, go back, or are counted - and carry no cost: the refill
-- price is on the full cylinders' receipt (D17-4).
alter table stock_movements drop constraint if exists stock_movements_empty_kinds;
alter table stock_movements add constraint stock_movements_empty_kinds check (
  not empty or (kind in ('receipt', 'return', 'adjustment') and unit_cost is null));

create or replace function app.stock_empty_is_cylinder()
returns trigger
language plpgsql
as $$
begin
  if new.empty and not exists (
       select 1 from stock_items i
        where i.id = new.item_id and app.counted_in_cylinders(i.unit)) then
    raise exception 'Only an item counted in cylinders has empties.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists stock_movements_empty_cylinder on stock_movements;
create trigger stock_movements_empty_cylinder
  before insert on stock_movements
  for each row execute function app.stock_empty_is_cylinder();

-- The deposit the supplier holds (D25-19, D17-4). Typed, never derived; NULL
-- until somebody types it.
alter table stock_items
  add column if not exists cylinders_on_deposit integer,
  add column if not exists deposit_per_cylinder numeric(12,2);

alter table stock_items drop constraint if exists stock_items_deposit_sane;
alter table stock_items add constraint stock_items_deposit_sane check (
  (cylinders_on_deposit is null or cylinders_on_deposit >= 0)
  and (deposit_per_cylinder is null or deposit_per_cylinder >= 0));


-- -----------------------------------------------------------------------------
-- On hand is full stock; empties are counted apart
-- -----------------------------------------------------------------------------
-- 069's and 112's definitions, with empties left out. Same signatures.
create or replace function app.stock_on_hand(p_item uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
    from stock_movements
   where item_id = p_item
     and not empty
     and reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = stock_movements.id
     )
$$;

create or replace function app.stock_on_hand(p_item uuid, p_location uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
    from stock_movements
   where item_id = p_item
     and location_id = p_location
     and not empty
     and reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = stock_movements.id
     )
$$;

-- Empty cylinders in one store, or (no store) in every store together.
create or replace function app.stock_empties(p_item uuid, p_location uuid default null)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
    from stock_movements
   where item_id = p_item
     and (p_location is null or location_id = p_location)
     and empty
     and reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = stock_movements.id
     )
$$;

comment on function app.stock_empties(uuid, uuid) is
  'Empty cylinders of an item in one store, or in all of them (D25-18).';

grant execute on function app.stock_empties(uuid, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- An undo keeps an empty an empty
-- -----------------------------------------------------------------------------
-- 112's function, copying `empty` onto the undo row - without it, undoing
-- "one empty back" would take a FULL cylinder off the shelf.
create or replace function app.reverse_stock_movement(
  p_id bigint, p_by uuid, p_note text default null
) returns bigint
language plpgsql
as $$
declare
  m     stock_movements;
  v_ask bigint;
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

  with undone as (
    insert into stock_movements
      (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost,
       supplier, reference, note, to_outlet, reverses_id, moved_by, empty)
    select leg.hotel_id, leg.item_id, leg.location_id, app.business_date(leg.hotel_id),
           'adjustment', -leg.quantity, null,
           leg.supplier, leg.reference,
           coalesce(p_note, 'Reversal of movement ' || leg.id::text),
           leg.to_outlet, leg.id, p_by, leg.empty
      from stock_movements leg
     where (m.transfer_id is not null and leg.transfer_id = m.transfer_id)
        or (m.transfer_id is null and leg.id = m.id)
     order by leg.id
    returning id, reverses_id
  )
  select id into v_ask from undone where reverses_id = p_id;

  return v_ask;
end $$;

grant execute on function app.reverse_stock_movement(bigint, uuid, text) to pms_app;
