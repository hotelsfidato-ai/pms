-- =============================================================================
-- 106 · Stock is held in a store, and moves between stores
-- =============================================================================
-- Phase 1A of docs/STOCK-AND-EQUIPMENT-PLAN.md, the Store chat. Until now a
-- hotel's stock was one number per item: nothing said whether the forty kilos
-- of rice were in the Main store or already in the kitchen. Migration 104 gave
-- every hotel a Main store, a Kitchen store and a Bar store (D17-3). This puts
-- the stock in them.
--
-- THE OWNER'S DECISIONS (docs/briefs/decisions-2026-09-17.md and the Store
-- chat's questions of 17 September):
--   D17-2  stock already recorded, which has no place, sits in the Main store
--   stock is shown per store and in total; moving it between stores is ONE act
--   that writes both halves, and undoing it undoes both
--
-- WHAT THIS DOES
--   * every movement names the store it happened in (`location_id`, required)
--   * a movement's store is at the movement's property, and is a `store`
--   * `transfer` is a movement kind: two rows, one out of a store and one into
--     another, sharing a `transfer_id`, written together or not at all
--   * `app.stock_on_hand(item, store)` — the one definition, per store; the
--     total `app.stock_on_hand(item)` is unchanged, and a move nets to zero in it
--   * `app.reverse_stock_movement` undoes both halves of a move
--   * what was recorded before today goes into the hotel's Main store (D17-2)
--
-- WHAT IT DOES NOT DO
--   * change what an item is worth: weighted average cost stays per item (S4),
--     and a store's share is that average times what is there
--   * par levels, the count sheet or gas — the Store's next merge
--   * touch `locations` (094, the master's) — it is read, never changed
--
-- Never edits 069: every change to its functions is a `create or replace` here.
-- Replay-safe: every step checks before it acts (MEMORY 162, 284).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Which store, and which move
-- -----------------------------------------------------------------------------
alter table stock_movements
  add column if not exists location_id uuid references locations(id),
  add column if not exists transfer_id uuid;

comment on column stock_movements.location_id is
  'The store it happened in. Required. A place of kind store at the same '
  'property — checked by stock_movements_place.';
comment on column stock_movements.transfer_id is
  'Pairs the two halves of a move between stores: one out of a store, one into '
  'another. Set on a transfer and on nothing else.';

alter table stock_movements drop constraint if exists stock_movements_kind_known;
alter table stock_movements add constraint stock_movements_kind_known check (
  kind in ('receipt', 'issue', 'wastage', 'adjustment', 'return', 'transfer'));

-- The sign constraint (069) already lets a transfer go either way: its `else
-- true` branch covers every kind it does not name.

alter table stock_movements drop constraint if exists stock_movements_transfer_pairs;
alter table stock_movements add constraint stock_movements_transfer_pairs check (
  (kind = 'transfer') = (transfer_id is not null));


-- -----------------------------------------------------------------------------
-- The hotel's Main store
-- -----------------------------------------------------------------------------
-- By the owner's name first (104 creates it), then the oldest store, so a hotel
-- that renamed "Main store" still has an answer. NULL only for a hotel with no
-- store at all, which 104's trigger does not allow to arise.
create or replace function app.main_store(p_hotel uuid)
returns uuid
language sql
stable
as $$
  select id
    from locations
   where hotel_id = p_hotel and kind = 'store'
   order by (name = 'Main store') desc, is_active desc, created_at, id
   limit 1
$$;

comment on function app.main_store(uuid) is
  'The store stock goes to when nobody said which: the one named Main store, '
  'else the oldest store at the hotel (D17-2).';

grant execute on function app.main_store(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- D17-2 · What was recorded before today sits in the Main store
-- -----------------------------------------------------------------------------
-- The append-only guard is lifted for this one statement and put straight
-- back, as 056 did for folio postings: it changes no quantity, no cost and no
-- date, and writes down where the owner has said the stock is. The staff-scope
-- check (069) fires on UPDATE too, and a movement recorded by somebody no
-- longer rostered would refuse the back-fill for a reason that has nothing to
-- do with it — lifted for the same statement. The audit trigger stays on, so
-- every row moved is in the audit log. `location_id is null` makes a replay a
-- no-op; the whole run is one transaction, so a failure puts the guards back.
do $$
declare h record;
begin
  if exists (select 1 from stock_movements where location_id is null) then
    for h in select distinct hotel_id from stock_movements where location_id is null loop
      perform app.default_stores(h.hotel_id);
    end loop;

    alter table stock_movements disable trigger stock_movements_append_only;
    alter table stock_movements disable trigger stock_movements_staff_scope;
    update stock_movements m
       set location_id = app.main_store(m.hotel_id)
     where m.location_id is null;
    alter table stock_movements enable trigger stock_movements_staff_scope;
    alter table stock_movements enable trigger stock_movements_append_only;
  end if;
end $$;

alter table stock_movements alter column location_id set not null;

create index if not exists stock_movements_item_place
  on stock_movements (item_id, location_id);
create index if not exists stock_movements_transfer
  on stock_movements (transfer_id) where transfer_id is not null;


-- -----------------------------------------------------------------------------
-- A movement's store is at its property, and is a store
-- -----------------------------------------------------------------------------
-- `locations` (094) carries no (hotel_id, id) key and is not this service's to
-- change, so the property is checked by a trigger — the same answer 097 gave
-- for an equipment item's place.
--
-- A MOVEMENT THAT NAMES NO STORE SITS IN THE MAIN STORE — D17-2's rule, applied
-- to whatever still writes without one: the frozen database suite, the shared
-- checks, a loader. The Store's own API always names the store and refuses a
-- request that does not; this is the floor under everything else, not the
-- screen's default.
create or replace function app.stock_movement_place()
returns trigger
language plpgsql
as $$
declare v_hotel uuid; v_kind text;
begin
  if new.location_id is null then
    new.location_id := app.main_store(new.hotel_id);
  end if;

  select l.hotel_id, l.kind into v_hotel, v_kind
    from locations l where l.id = new.location_id;
  if v_hotel is null or v_hotel <> new.hotel_id then
    raise exception 'That store is not at this property.' using errcode = 'check_violation';
  end if;
  if v_kind <> 'store' then
    raise exception 'Stock is kept only in a store.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists stock_movements_place on stock_movements;
create trigger stock_movements_place
  before insert on stock_movements
  for each row execute function app.stock_movement_place();


-- -----------------------------------------------------------------------------
-- What is on hand in one store
-- -----------------------------------------------------------------------------
-- The same definition as the total (069), narrowed to a store. The total is
-- untouched: a move is one row out and one row in, and sums to zero.
create or replace function app.stock_on_hand(p_item uuid, p_location uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(quantity), 0)
    from stock_movements
   where item_id = p_item
     and location_id = p_location
     and reverses_id is null
     and not exists (
       select 1 from stock_movements r where r.reverses_id = stock_movements.id
     )
$$;

comment on function app.stock_on_hand(uuid, uuid) is
  'What is in one store, summed from the movements. The total, stock_on_hand(item), '
  'is the sum of these.';

grant execute on function app.stock_on_hand(uuid, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- A move between stores is two halves, written together
-- -----------------------------------------------------------------------------
-- ONE INSERT OF TWO ROWS, so the check below — deferred to the end of the
-- transaction — always finds both. The item is locked first, so two moves of
-- the same rice at once cannot both find the forty kilos.
create or replace function app.transfer_stock(
  p_item uuid, p_from uuid, p_to uuid, p_quantity numeric, p_by uuid, p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_hotel uuid;
  v_pair  uuid := gen_random_uuid();
  v_have  numeric;
begin
  select hotel_id into v_hotel from stock_items where id = p_item for update;
  if v_hotel is null then
    raise exception 'No such item in this store.' using errcode = 'check_violation';
  end if;
  if p_from = p_to then
    raise exception 'It is already there.' using errcode = 'check_violation';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'How much? A move of nothing is not a move.' using errcode = 'check_violation';
  end if;
  v_have := app.stock_on_hand(p_item, p_from);
  if p_quantity > v_have then
    raise exception 'There is not that much in that store.' using errcode = 'check_violation';
  end if;

  insert into stock_movements
    (hotel_id, item_id, location_id, business_date, kind, quantity, note, transfer_id, moved_by)
  values
    (v_hotel, p_item, p_from, app.business_date(v_hotel), 'transfer', -p_quantity, p_note, v_pair, p_by),
    (v_hotel, p_item, p_to,   app.business_date(v_hotel), 'transfer',  p_quantity, p_note, v_pair, p_by);

  return v_pair;
end $$;

comment on function app.transfer_stock(uuid, uuid, uuid, numeric, uuid, text) is
  'Moves stock from one store to another: two movements sharing a transfer_id, '
  'written in one statement. Returns the transfer_id.';

grant execute on function app.transfer_stock(uuid, uuid, uuid, numeric, uuid, text) to pms_app;

-- Neither half may exist without the other, and neither may be undone alone.
--
-- CHECKED WHEN THE STATEMENT ENDS, over the rows it wrote — not deferred to
-- the commit. A deferred check leaves an event queued for every stock insert,
-- and Postgres then refuses any ALTER TABLE on the table in that transaction
-- ("pending trigger events"): the frozen database suite lifts the append-only
-- guard to clean up after itself, and stopped there. Both writers here — a move
-- and an undo — put every half in ONE statement, so the end of the statement is
-- the right moment, and nothing waits.
create or replace function app.stock_transfer_whole()
returns trigger
language plpgsql
as $$
begin
  if exists (
       select 1
         from (select distinct transfer_id from written where kind = 'transfer') w
         join lateral (
                select count(*) as rows, sum(quantity) as total,
                       count(distinct location_id) as places, count(distinct item_id) as items
                  from stock_movements s
                 where s.transfer_id = w.transfer_id) t on true
        where t.rows <> 2 or t.total <> 0 or t.places <> 2 or t.items <> 1) then
    raise exception 'A move between stores is two halves written together: out of one store and into another.'
      using errcode = 'check_violation';
  end if;

  if exists (
       select 1
         from written r
         join stock_movements half on half.id = r.reverses_id and half.kind = 'transfer'
         join stock_movements leg  on leg.transfer_id = half.transfer_id
        where not exists (select 1 from stock_movements u where u.reverses_id = leg.id)) then
    raise exception 'Undoing a move undoes both halves.' using errcode = 'check_violation';
  end if;

  return null;
end $$;

drop trigger if exists stock_movements_transfer_whole on stock_movements;
create trigger stock_movements_transfer_whole
  after insert on stock_movements
  referencing new table as written
  for each statement execute function app.stock_transfer_whole();


-- -----------------------------------------------------------------------------
-- Undoing one — in its own store, and a move as a whole
-- -----------------------------------------------------------------------------
-- 069's function, with two changes: the undo is written in the store the
-- movement happened in, and undoing either half of a move undoes both — in ONE
-- statement, which the check above reads when it ends. It returns the id of the
-- undo of the row that was asked for.
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
       supplier, reference, note, to_outlet, reverses_id, moved_by)
    select leg.hotel_id, leg.item_id, leg.location_id, app.business_date(leg.hotel_id),
           /* An 'adjustment', as in 069: the sign is the opposite of what it
              undoes, and adjustment is the kind allowed to go either way. */
           'adjustment', -leg.quantity, null,
           leg.supplier, leg.reference,
           coalesce(p_note, 'Reversal of movement ' || leg.id::text),
           leg.to_outlet, leg.id, p_by
      from stock_movements leg
     where (m.transfer_id is not null and leg.transfer_id = m.transfer_id)
        or (m.transfer_id is null and leg.id = m.id)
     order by leg.id
    returning id, reverses_id
  )
  select id into v_ask from undone where reverses_id = p_id;

  return v_ask;
end $$;

comment on function app.reverse_stock_movement(bigint, uuid, text) is
  'Undoes a movement by writing its opposite, in the same store, and pointing at '
  'it. Undoing either half of a move between stores undoes both. Both rows stay.';

grant execute on function app.reverse_stock_movement(bigint, uuid, text) to pms_app;
