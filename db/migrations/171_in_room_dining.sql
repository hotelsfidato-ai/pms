-- =============================================================================
-- 171 — in-room dining from the menu (D27-224, D27-225; the in-stay plan, A)
-- =============================================================================
-- A guest checked in orders from the restaurant's menu on their own page. The
-- order is a SUBMISSION: a person accepts it on the Terminal, and only then is
-- it a room-service order the kitchen cooks and the waiter charges to the room
-- at delivery (the owner's answers). Or declines it, with a reason the guest
-- reads.
--
-- THE DOOR'S RULES (online-checkin MODULE.md): the stay only from
-- app.guest_unlocked inside a definer taking both hashes; no id of a stay, a
-- room or an order from the caller beyond their own order; the guest taps, and
-- the only typing is one note; every refusal is a plain false or nothing.
--
-- THE GUEST'S PRICE IS KEPT (Q1): each line carries the price the guest saw,
-- worked out here, once. Accept works it out again and is refused if it moved -
-- never more than the guest saw.
-- =============================================================================

create table if not exists guest_food_orders (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  -- [{itemId, qty, variationId, moreChoiceIds, addonIds, name, unitPrice}]
  basket         jsonb not null,
  note           text,
  status         text not null default 'waiting',
  pos_order_id   uuid references pos_orders(id),
  reason         text,
  handled_by     uuid references staff(id),
  handled_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint guest_food_orders_status_ok
    check (status in ('waiting', 'accepted', 'declined', 'cancelled')),
  constraint guest_food_orders_note_short
    check (note is null or char_length(note) <= 200),
  constraint guest_food_orders_declined_says_why
    check (status <> 'declined' or btrim(coalesce(reason, '')) <> ''),
  constraint guest_food_orders_accepted_names_its_order
    check (status <> 'accepted' or pos_order_id is not null)
);

create index if not exists guest_food_orders_waiting_idx
  on guest_food_orders (hotel_id) where status = 'waiting';

alter table guest_food_orders enable row level security;
alter table guest_food_orders force  row level security;
drop policy if exists hotel_isolation on guest_food_orders;
create policy hotel_isolation on guest_food_orders
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, update on guest_food_orders to pms_app;


-- -----------------------------------------------------------------------------
-- Whether the restaurant takes a stay's order now (Q5): the stay checked in,
-- the POS on, the restaurant (REST) open and not "closed for a while", and its
-- day not closed (D27-118). The restaurant, or null.
-- -----------------------------------------------------------------------------
create or replace function app.guest_dining_outlet(p_reservation uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select o.id
    from reservations r
    join pos_outlets o on o.hotel_id = r.hotel_id and o.code = 'REST' and o.is_active
   where r.id = p_reservation
     and r.status = 'checked_in'
     and app.module_enabled(r.hotel_id, 'pos')
     and (o.closed_until is null or o.closed_until <= now())
     and not exists (select 1 from pos_day_ends d
                      where d.outlet_id = o.id
                        and d.business_date = app.business_date(r.hotel_id)
                        and d.closed_at is not null);
$fn$;


-- -----------------------------------------------------------------------------
-- What one of a dish costs with these choices, as the till prices it (the
-- first type's choice, plus the further types', plus the sides), and its name
-- as the kitchen reads it. NULL when the dish is not on the guest's menu now
-- (off, taken off the card, alcohol, no GST rate) or a choice does not belong.
-- One rule for the guest's order and for Accept, so a change between them shows.
-- -----------------------------------------------------------------------------
create or replace function app.guest_dish_price(
  p_hotel uuid, p_item uuid, p_variation uuid, p_more uuid[], p_addons uuid[])
returns table (unit_price numeric, name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_item record;
  v_first_label text;
  v_first_price numeric;
  v_more_price numeric := 0;
  v_more_labels text;
  v_addon_price numeric := 0;
  v_types int;
begin
  select i.id, i.name, i.price into v_item
    from pos_menu_items i
    join pos_menu_categories c on c.id = i.category_id and c.is_active
   where i.id = p_item and i.hotel_id = p_hotel and i.is_active
     and (i.off_until is null or i.off_until <= now())
     -- no alcohol (the owner): a section taxed as alcohol is not offered
     and coalesce(c.tax_kind, 'other') <> 'alcohol'
     -- a dish the till cannot ring - no GST rate - is not offered either
     and coalesce(i.tax_rate,
                  app.gst_rate_or_null(i.hotel_id, coalesce(c.tax_kind, 'other'), i.price))
         is not null;
  if v_item.id is null then return; end if;

  -- The first type: one of its choices, or none when the dish has none.
  if exists (select 1 from pos_item_variations
              where item_id = p_item and is_active and type_no = 1) then
    select label, price into v_first_label, v_first_price from pos_item_variations
     where id = p_variation and item_id = p_item and is_active and type_no = 1;
    if v_first_price is null then return; end if;
  elsif p_variation is not null then
    return;
  end if;

  -- Each further type: exactly one of its choices.
  select count(distinct type_no) into v_types from pos_item_variations
   where item_id = p_item and is_active and type_no > 1;
  if coalesce(cardinality(p_more), 0) <> v_types then return; end if;
  if v_types > 0 then
    select sum(price), string_agg(label, ', ' order by type_no), count(distinct type_no)
      into v_more_price, v_more_labels, v_types
      from pos_item_variations
     where id = any(p_more) and item_id = p_item and is_active and type_no > 1;
    if v_types <> cardinality(p_more) then return; end if;
  end if;

  -- The sides: each offered on this dish and on today, within its group's rule.
  if coalesce(cardinality(p_addons), 0) > 0 then
    if (select count(*) from pos_addons a
         where a.id = any(p_addons) and a.hotel_id = p_hotel and a.is_active
           and (a.off_until is null or a.off_until <= now())
           and exists (select 1 from pos_item_addon_groups ig
                        where ig.group_id = a.group_id and ig.item_id = p_item))
       <> cardinality(p_addons) then
      return;
    end if;
    select sum(price) into v_addon_price from pos_addons where id = any(p_addons);
  end if;
  if exists (select 1 from pos_item_addon_groups ig
               join pos_addon_groups g on g.id = ig.group_id
              where ig.item_id = p_item
                and exists (select 1 from pos_addons a where a.group_id = g.id and a.is_active)
                and ((select count(*) from pos_addons a
                       where a.group_id = g.id and a.id = any(coalesce(p_addons, '{}')))
                     not between g.min_select and coalesce(g.max_select, 1000))) then
    return;
  end if;

  return query select
    coalesce(v_first_price, v_item.price) + coalesce(v_more_price, 0) + coalesce(v_addon_price, 0),
    v_item.name || coalesce(' (' || nullif(concat_ws(', ', v_first_label, v_more_labels), '') || ')', '');
end
$fn$;


-- -----------------------------------------------------------------------------
-- The menu the guest sees: what guest_dish_price would price, with its
-- choices and sides, by section. Empty when the restaurant is not taking
-- orders - the section on the page hides itself.
-- -----------------------------------------------------------------------------
create or replace function app.guest_menu(p_token_hash text, p_unlock_hash text)
returns table (section text, item jsonb)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select c.name,
         jsonb_build_object(
           'id', i.id, 'name', i.name, 'price', i.price, 'isVeg', i.is_veg,
           'variations', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', v.id, 'label', v.label, 'price', v.price,
                      'typeNo', v.type_no, 'kind', v.kind, 'heading', v.heading)
                    order by v.type_no, v.sort_order, v.price)
               from pos_item_variations v where v.item_id = i.id and v.is_active), '[]'),
           'addonGroups', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.id, 'label', g.label,
                      'minSelect', g.min_select, 'maxSelect', g.max_select,
                      'addons', (select jsonb_agg(jsonb_build_object(
                                          'id', a.id, 'label', a.label, 'price', a.price,
                                          'offUntil', a.off_until)
                                        order by a.sort_order, a.label)
                                   from pos_addons a
                                  where a.group_id = g.id and a.is_active
                                    and (a.off_until is null or a.off_until <= now())))
                    order by ig.sort_order, g.label)
               from pos_item_addon_groups ig
               join pos_addon_groups g on g.id = ig.group_id
              where ig.item_id = i.id
                and exists (select 1 from pos_addons a
                             where a.group_id = g.id and a.is_active
                               and (a.off_until is null or a.off_until <= now()))), '[]'))
    from app.guest_unlocked(p_token_hash, p_unlock_hash) u
    join pos_menu_items i on i.hotel_id = u.hotel_id
    join pos_menu_categories c on c.id = i.category_id
   where app.guest_dining_outlet(u.reservation_id) is not null
     and i.is_active and c.is_active
     and (i.off_until is null or i.off_until <= now())
     and coalesce(c.tax_kind, 'other') <> 'alcohol'
     and coalesce(i.tax_rate,
                  app.gst_rate_or_null(i.hotel_id, coalesce(c.tax_kind, 'other'), i.price))
         is not null
   order by c.sort_order, c.name, i.sort_order, i.name;
$fn$;


-- -----------------------------------------------------------------------------
-- The guest's order: 1 to 30 dishes, 1 to 20 of each, three waiting at most,
-- one note. Each line priced here, as the guest saw it. The new order's id,
-- or null for every refusal.
-- -----------------------------------------------------------------------------
create or replace function app.guest_food_order_make(
  p_token_hash text, p_unlock_hash text, p_basket jsonb, p_note text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
  v_line jsonb;
  v_qty int;
  v_price record;
  v_lines jsonb := '[]';
  v_id uuid;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null
     or app.guest_dining_outlet(v.reservation_id) is null
     or jsonb_typeof(p_basket) <> 'array'
     or jsonb_array_length(p_basket) not between 1 and 30
     or char_length(coalesce(p_note, '')) > 200
     or (select count(*) from guest_food_orders
          where reservation_id = v.reservation_id and status = 'waiting') >= 3 then
    return null;
  end if;

  for v_line in select * from jsonb_array_elements(p_basket) loop
    v_qty := case when jsonb_typeof(v_line->'qty') = 'number' then (v_line->>'qty')::numeric::int end;
    if v_qty is null or v_qty not between 1 and 20 then return null; end if;
    select * into v_price from app.guest_dish_price(
      v.hotel_id,
      (v_line->>'itemId')::uuid,
      nullif(v_line->>'variationId', '')::uuid,
      array(select jsonb_array_elements_text(coalesce(v_line->'moreChoiceIds', '[]')))::uuid[],
      array(select jsonb_array_elements_text(coalesce(v_line->'addonIds', '[]')))::uuid[]);
    if v_price.unit_price is null then return null; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'itemId', v_line->>'itemId', 'qty', v_qty,
      'variationId', nullif(v_line->>'variationId', ''),
      'moreChoiceIds', coalesce(v_line->'moreChoiceIds', '[]'),
      'addonIds', coalesce(v_line->'addonIds', '[]'),
      'name', v_price.name, 'unitPrice', v_price.unit_price));
  end loop;

  insert into guest_food_orders (hotel_id, reservation_id, basket, note)
  values (v.hotel_id, v.reservation_id, v_lines, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
exception
  -- a malformed id in the basket is a refusal like any other
  when invalid_text_representation then return null;
end
$fn$;


-- The guest's own orders, newest first: what they asked for and what became of it.
create or replace function app.guest_food_orders_mine(p_token_hash text, p_unlock_hash text)
returns table (id uuid, basket jsonb, note text, status text, reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select f.id, f.basket, f.note, f.status, f.reason, f.created_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) u
    join guest_food_orders f on f.reservation_id = u.reservation_id
   order by f.created_at desc;
$fn$;

-- Taken back while nobody has accepted it.
create or replace function app.guest_food_order_cancel(
  p_token_hash text, p_unlock_hash text, p_order uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  with done as (
    update guest_food_orders f set status = 'cancelled'
      from app.guest_unlocked(p_token_hash, p_unlock_hash) u
     where f.id = p_order and f.reservation_id = u.reservation_id
       and f.status = 'waiting'
    returning f.id)
  select exists (select 1 from done);
$fn$;

do $$
declare f text;
begin
  foreach f in array array[
    'app.guest_menu(text, text)',
    'app.guest_food_order_make(text, text, jsonb, text)',
    'app.guest_food_orders_mine(text, text)',
    'app.guest_food_order_cancel(text, text, uuid)',
    'app.guest_dining_outlet(uuid)',
    'app.guest_dish_price(uuid, uuid, uuid, uuid[], uuid[])']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to pms_app', f);
  end loop;
end $$;
