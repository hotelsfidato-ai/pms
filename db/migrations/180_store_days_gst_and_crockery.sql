-- =============================================================================
-- 180 · The Store: GST on a delivery, expiry, department, breakage, the
--       count's record, and an item's cost as a running average
-- =============================================================================
-- D27-238, the owner's answers of 2 October (docs/briefs/decisions-2026-09-27.md):
--   6.2 GST on purchases is RECORDED now - amount, rate, claimable or not. What
--       it means for a cost is the CA's to decide; nothing here decides it.
--   6.3 an item's cost is a RUNNING average, updated at each delivery
--   6.4 a department on an issue and an expiry date on a delivery, both optional
--   2A  breakage is a movement, with who
--   and every line of a count is kept, so "last counted" is a fact, not a guess
--
-- WHAT IT DOES
--   * stock_movements: gst_rate, gst_amount, gst_claimable (a delivery's, all
--     three or none), expires_on (a delivery's), department (an issue's),
--     broken_by (a breakage's), and the kind `breakage` (out, like waste)
--   * purchase_request_lines: the same GST three and expires_on, set when the
--     delivery is received
--   * stock_items.crockery: crockery and cutlery, which may be in use at a
--     restaurant, a bar or a kitchen place; breakage is only theirs
--   * hotels.food_cost_basis = 'before_gst' everywhere (the owner's Q5)
--   * stock_count_lines: every counted line, matched or not, append-only
--   * app.stock_movement_costs(item): the running-average walk, ONE function so
--     a change to its rules is one change; app.stock_unit_cost(item) keeps its
--     name and now reads the walk
--
-- Never edits 069, 112 or 140: their functions are replaced here, whole.
-- Replay-safe: every step checks before it acts (MEMORY 162, 284).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A delivery's GST, its expiry; an issue's department; who broke it
-- -----------------------------------------------------------------------------
alter table stock_movements
  add column if not exists gst_rate      numeric(5,2),
  add column if not exists gst_amount    numeric(12,2),
  add column if not exists gst_claimable boolean,
  add column if not exists expires_on    date,
  add column if not exists department    text,
  add column if not exists broken_by     uuid references staff(id);

comment on column stock_movements.gst_rate is
  'The GST rate on the supplier''s bill for this delivery, in per cent. With '
  'gst_amount and gst_claimable: all three, or none - none is "not recorded", '
  'a dash, never zero. unit_cost is the price BEFORE GST.';
comment on column stock_movements.gst_amount is
  'The GST on this delivery, as the bill says it, in rupees.';
comment on column stock_movements.gst_claimable is
  'Whether this GST can be claimed back (input tax credit). What a cost '
  'includes because of it is the CA''s decision, not this table''s.';
comment on column stock_movements.expires_on is
  'Use by, on a delivery. Optional (D27-238 6.4).';
comment on column stock_movements.department is
  'Which department an issue was for. Optional (D27-238 6.4).';
comment on column stock_movements.broken_by is
  'Who broke it, on a breakage. Null is "not known".';

alter table stock_movements drop constraint if exists stock_movements_kind_known;
alter table stock_movements add constraint stock_movements_kind_known check (
  kind in ('receipt', 'issue', 'wastage', 'adjustment', 'return', 'transfer', 'breakage'));

-- 069's sign rule, with breakage beside waste: it only ever takes stock out.
alter table stock_movements drop constraint if exists stock_movements_sign_matches_kind;
alter table stock_movements add constraint stock_movements_sign_matches_kind check (
  case kind
    when 'receipt'  then quantity > 0
    when 'return'   then quantity < 0
    when 'issue'    then quantity < 0
    when 'wastage'  then quantity < 0
    when 'breakage' then quantity < 0
    else true
  end);

alter table stock_movements drop constraint if exists stock_movements_gst_whole;
alter table stock_movements add constraint stock_movements_gst_whole check (
  (gst_rate is null) = (gst_amount is null) and (gst_rate is null) = (gst_claimable is null));

alter table stock_movements drop constraint if exists stock_movements_gst_sane;
alter table stock_movements add constraint stock_movements_gst_sane check (
  (gst_rate is null or gst_rate between 0 and 100)
  and (gst_amount is null or gst_amount >= 0));

-- A delivery's own facts. An undo is an adjustment and copies none of them.
alter table stock_movements drop constraint if exists stock_movements_delivery_facts;
alter table stock_movements add constraint stock_movements_delivery_facts check (
  (gst_rate is null and expires_on is null) or (kind = 'receipt' and not empty));

alter table stock_movements drop constraint if exists stock_movements_department_on_issues;
alter table stock_movements add constraint stock_movements_department_on_issues check (
  department is null or (kind = 'issue' and length(btrim(department)) > 0));

alter table stock_movements drop constraint if exists stock_movements_broken_by_on_breakage;
alter table stock_movements add constraint stock_movements_broken_by_on_breakage check (
  broken_by is null or kind = 'breakage');

-- Who broke it works here, as whoever recorded it must (069).
drop trigger if exists stock_movements_broken_by_scope on stock_movements;
create trigger stock_movements_broken_by_scope
  before insert on stock_movements
  for each row execute function app.assert_staff_has_hotel('broken_by');


-- -----------------------------------------------------------------------------
-- Crockery and cutlery (2A; the owner's answers of 2 October, D27-242)
-- -----------------------------------------------------------------------------
-- A plate issued to the restaurant is not used up: it is IN USE there until it
-- breaks or comes back. So a crockery item may also sit at a place of kind
-- restaurant, bar or kitchen - a place the hotel adds in Places and suppliers;
-- this creates none. A move puts it there, a level there is its par, the count
-- sheet counts it there, and a breakage is written where it broke.
alter table stock_items
  add column if not exists crockery boolean not null default false;

comment on column stock_items.crockery is
  'Crockery and cutlery (D27-242): may be in use at a restaurant, a bar or a '
  'kitchen as well as kept in a store; it leaves by breakage, with who.';

-- 112's check, with that one exception. It serves stock_levels and
-- stock_count_lines too (140, above), so a par and a count may be at the place.
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
    if v_kind in ('restaurant', 'bar', 'kitchen')
       and exists (select 1 from stock_items i where i.id = new.item_id and i.crockery) then
      return new;
    end if;
    raise exception 'Stock is kept only in a store.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Breakage is crockery's (Q10). Anything else that spoils is waste.
create or replace function app.stock_breakage_is_crockery()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'breakage' and not exists (
       select 1 from stock_items i where i.id = new.item_id and i.crockery) then
    raise exception 'Breakage is recorded for crockery and cutlery. Anything else is waste.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists stock_movements_breakage_crockery on stock_movements;
create trigger stock_movements_breakage_crockery
  before insert on stock_movements
  for each row execute function app.stock_breakage_is_crockery();


-- -----------------------------------------------------------------------------
-- How the food cost is counted (Q5, the owner: costs before GST over sales
-- before GST)
-- -----------------------------------------------------------------------------
-- Set for every hotel, and every new one, so the % shows. Kept as a column so
-- the CA can change it; null shows the % as a dash. Another basis is another
-- value here, built when it is chosen.
alter table hotels
  add column if not exists food_cost_basis text default 'before_gst';

comment on column hotels.food_cost_basis is
  'How the Store counts food cost % (D27-242): before_gst is the stock issued, '
  'valued before GST, over the till''s sales before GST. Null shows a dash.';

alter table hotels drop constraint if exists hotels_food_cost_basis_known;
alter table hotels add constraint hotels_food_cost_basis_known check (
  food_cost_basis is null or food_cost_basis = 'before_gst');


-- -----------------------------------------------------------------------------
-- A purchase line's GST and expiry, set when the delivery is received
-- -----------------------------------------------------------------------------
alter table purchase_request_lines
  add column if not exists gst_rate      numeric(5,2),
  add column if not exists gst_amount    numeric(12,2),
  add column if not exists gst_claimable boolean,
  add column if not exists expires_on    date;

comment on column purchase_request_lines.gst_rate is
  'The GST on the delivered line, as the supplier''s bill says it: with '
  'gst_amount and gst_claimable, all three or none. The Store''s receipt '
  'carries the same three.';

alter table purchase_request_lines drop constraint if exists purchase_request_lines_gst_whole;
alter table purchase_request_lines add constraint purchase_request_lines_gst_whole check (
  (gst_rate is null) = (gst_amount is null) and (gst_rate is null) = (gst_claimable is null));

alter table purchase_request_lines drop constraint if exists purchase_request_lines_gst_sane;
alter table purchase_request_lines add constraint purchase_request_lines_gst_sane check (
  (gst_rate is null or gst_rate between 0 and 100)
  and (gst_amount is null or gst_amount >= 0));


-- -----------------------------------------------------------------------------
-- Every counted line
-- -----------------------------------------------------------------------------
-- A count that matched the book wrote nothing (D25-15), so nothing said the
-- shelf had been counted at all. Each line counted is kept here - matched or
-- not - with who and when, and the correction it wrote if it differed. "Last
-- counted" is the latest of these; a report of count differences reads them.
create table if not exists stock_count_lines (
  id            bigint generated always as identity primary key,
  hotel_id      uuid not null references hotels(id) on delete cascade,
  item_id       uuid not null,
  location_id   uuid not null references locations(id),
  -- Empty cylinders, counted apart from full ones (D25-18).
  empty         boolean not null default false,
  book          numeric(12,3) not null,
  counted       numeric(12,3) not null,
  counted_by    uuid references staff(id),
  counted_at    timestamptz not null default now(),
  business_date date not null,
  -- The correction this line wrote; null when the shelf matched the book.
  movement_id   bigint references stock_movements(id),

  -- The composite key 069 gives a movement: a count at one property cannot
  -- point at another's item (MEMORY 161).
  constraint stock_count_lines_item_fk foreign key (hotel_id, item_id)
    references stock_items (hotel_id, id) on delete cascade,
  constraint stock_count_lines_counted_sane check (counted >= 0)
);

comment on table stock_count_lines is
  'Every line of every count, matched or not (D27-238). Append-only. The last '
  'time an item was counted in a place is the latest row for the two.';

create index if not exists stock_count_lines_place
  on stock_count_lines (hotel_id, location_id, item_id, counted_at desc);

-- A store at this property, as for a movement and a level (112, 140).
drop trigger if exists stock_count_lines_place on stock_count_lines;
create trigger stock_count_lines_place
  before insert on stock_count_lines
  for each row execute function app.stock_movement_place();

drop trigger if exists stock_count_lines_staff_scope on stock_count_lines;
create trigger stock_count_lines_staff_scope
  before insert on stock_count_lines
  for each row execute function app.assert_staff_has_hotel('counted_by');

drop trigger if exists stock_count_lines_append_only on stock_count_lines;
create trigger stock_count_lines_append_only
  before update or delete on stock_count_lines
  for each row execute function app.forbid_mutation();

alter table stock_count_lines enable row level security;
alter table stock_count_lines force  row level security;
drop policy if exists stock_count_lines_isolation on stock_count_lines;
create policy stock_count_lines_isolation on stock_count_lines
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert on stock_count_lines to pms_app;
revoke update, delete on stock_count_lines from pms_app;


-- -----------------------------------------------------------------------------
-- What an item cost: a running average, moved at each delivery (D27-238 6.3)
-- -----------------------------------------------------------------------------
-- THE WALK. The item's movements in the order they were written, and for each
-- the value of one unit at that moment:
--   * a priced delivery is worth what was paid, and moves the average by what
--     is on the shelf then: (held x average + quantity x cost) / (held + quantity).
--     With nothing held, its cost IS the average.
--   * a delivery nobody priced leaves the average as it was
--   * everything else leaves at the average of its moment and does not move it
-- Left out, as on hand leaves them out: empty cylinders, a move between stores
-- (it nets to zero for the item), an undone row and the undo itself.
--
-- ONE FUNCTION, so a change to these rules (Q7) is one change. Null where no
-- delivery has been priced yet: a dash, never zero.
create or replace function app.stock_movement_costs(p_item uuid)
returns table (movement_id bigint, unit_value numeric, average_after numeric)
language plpgsql
stable
as $$
declare
  m     record;
  v_qty numeric := 0;
  v_avg numeric;
begin
  for m in
    select s.id, s.kind, s.quantity, s.unit_cost
      from stock_movements s
     where s.item_id = p_item
       and not s.empty
       and s.kind <> 'transfer'
       and s.reverses_id is null
       and not exists (select 1 from stock_movements r where r.reverses_id = s.id)
     order by s.id
  loop
    if m.kind = 'receipt' then
      -- What was paid; null for a delivery nobody priced, which moves nothing.
      if m.unit_cost is not null then
        v_avg := case when v_avg is null or v_qty <= 0 then m.unit_cost
                      else (v_qty * v_avg + m.quantity * m.unit_cost) / (v_qty + m.quantity) end;
      end if;
      unit_value := m.unit_cost;
    else
      unit_value := round(v_avg, 2);
    end if;
    v_qty := v_qty + m.quantity;
    movement_id := m.id;
    average_after := round(v_avg, 2);
    return next;
  end loop;
end $$;

comment on function app.stock_movement_costs(uuid) is
  'The running average, walked: each movement''s value per unit at its moment '
  '(a delivery: what was paid), and the average after it. A report values what '
  'went out with this, never with today''s average (D27-238).';

grant execute on function app.stock_movement_costs(uuid) to pms_app;

-- 069's name and signature, so every reader moves to the running average at
-- once: the average after the item's last movement.
create or replace function app.stock_unit_cost(p_item uuid)
returns numeric
language sql
stable
as $$
  select c.average_after
    from app.stock_movement_costs(p_item) c
   order by c.movement_id desc
   limit 1
$$;

comment on function app.stock_unit_cost(uuid) is
  'The running average after the last movement (D27-238). NULL when no '
  'delivery has been priced - an item nobody has bought has no value, and zero '
  'would claim it is worthless.';

grant execute on function app.stock_unit_cost(uuid) to pms_app;
