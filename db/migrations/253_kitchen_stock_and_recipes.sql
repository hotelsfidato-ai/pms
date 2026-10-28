-- =============================================================================
-- 253 · The kitchen's stock: recipes, taken off the kitchen store by every KOT
--       (the owner's D27-373 and D27-374, 28 October)
-- =============================================================================
-- Inventory's Restaurant tab, "all needed for a full-fledged POS system": the
-- kitchen store's daily sheet and recipes, the bar's way (235, 238).
--
--   * locations.is_kitchen_store: which store is the kitchen's, one per hotel,
--     as is_bar_store (234) marks the bar's. Each hotel's "Kitchen store" (104)
--     is marked here, and a new hotel's by default_stores (the owner's
--     D27-378, as the Bar store was) - only where the hotel has none marked,
--     so a replay changes nothing the GM chose on the Restaurant tab. Never the
--     Bar store or the Bar counter.
--   * recipe_lines: what one of a dish takes from the kitchen store - so much
--     of a Store item, in that item's own unit. A size (variation), a side
--     (045's add-ons) and a numbered add-on (208) have lines of their own,
--     taken ON TOP of the dish's; none is "nothing extra". A dish with no
--     lines sells as today and takes nothing (D27-374).
--   * app.pos_line_takes_from_kitchen: when a line is SENT (the KOT), its
--     recipe comes off the kitchen store as an ISSUE to its outlet, marked
--     with the line (stock_movements.pos_line_id), in the same transaction as
--     the KOT. It never refuses: an item below zero shows red on the sheet,
--     put right by a delivery or a count (D27-374).
--   * STRUCK: before the KOT the line took nothing, so nothing is owed back.
--     Once the kitchen had it (a strike, or "fewer" of a sent dish - 209's
--     struck copy), the ingredients stay used and count as WASTAGE with the
--     strike's reason: the line's issue is undone (069's undo) and written
--     again as the part still sold and the part wasted. Stock does not move.
--   * Bar stock's switch (239) does not touch any of this.
--
-- No new kind of movement: 180 rewrites that list on every replay (MEMORY 284).
--
-- Re-runnable.
-- =============================================================================

-- ── Which store is the kitchen's ───────────────────────────────────────────
alter table locations add column if not exists is_kitchen_store boolean not null default false;
create unique index if not exists locations_one_kitchen_store on locations (hotel_id) where is_kitchen_store;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_kitchen_not_bar') then
    alter table locations add constraint locations_kitchen_not_bar
      check (not (is_kitchen_store and (is_bar_store or is_bar_counter)));
  end if;
end $$;
comment on column locations.is_kitchen_store is
  'The kitchen''s store (D27-373): every KOT takes the recipes of what it sends from it. One per '
  'hotel, its "Kitchen store" unless changed on Inventory''s Restaurant tab; never the bar''s store or counter.';

-- Each hotel's "Kitchen store" is marked, where it has none marked (D27-378).
update locations l set is_kitchen_store = true
 where l.kind = 'store' and l.name = 'Kitchen store' and not l.is_bar_store and not l.is_bar_counter
   and not exists (select 1 from locations o where o.hotel_id = l.hotel_id and o.is_kitchen_store);

-- 238's, with one change: the Kitchen store it makes is marked the kitchen's.
create or replace function app.default_stores(p_hotel uuid)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v_made int := 0;
begin
  if exists (select 1 from locations where hotel_id = p_hotel and kind = 'store') then
    return 0;
  end if;
  insert into locations (hotel_id, name, kind, is_bar_store, is_bar_counter, is_kitchen_store)
  values (p_hotel, 'Main store', 'store', false, false, false),
         (p_hotel, 'Kitchen store', 'store', false, false, true),
         (p_hotel, 'Bar store', 'store', true, false, false),
         (p_hotel, 'Bar counter', 'store', false, true, false)
  on conflict (hotel_id, name) do nothing;
  get diagnostics v_made = row_count;
  return v_made;
end $fn$;
revoke all on function app.default_stores(uuid) from public;

-- ── Recipes ────────────────────────────────────────────────────────────────
create table if not exists recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references hotels(id) on delete cascade,
  -- Whose line: a dish (item_id), one of its sizes (item_id and variation_id),
  -- a side (addon_id) or a numbered add-on (numbered_addon_id).
  item_id           uuid references pos_menu_items(id) on delete cascade,
  variation_id      uuid references pos_item_variations(id) on delete cascade,
  addon_id          uuid references pos_addons(id) on delete cascade,
  numbered_addon_id uuid references pos_numbered_addons(id) on delete cascade,
  stock_item_id     uuid not null references stock_items(id),
  -- For ONE of it, in the Store item's own unit (0.2 kg, 2 pieces).
  quantity          numeric(12,3) not null check (quantity > 0 and quantity <= 100000),
  set_by            uuid references staff(id),
  set_at            timestamptz not null default now(),
  constraint recipe_lines_one_owner check (
    num_nonnulls(item_id, addon_id, numbered_addon_id) = 1
    and (variation_id is null or item_id is not null))
);
create unique index if not exists recipe_lines_once on recipe_lines (
  coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(variation_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(addon_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(numbered_addon_id, '00000000-0000-0000-0000-000000000000'::uuid),
  stock_item_id);
create index if not exists recipe_lines_item on recipe_lines (item_id);
create index if not exists recipe_lines_stock_item on recipe_lines (stock_item_id);

comment on table recipe_lines is
  'What one of a dish, a size, a side or a numbered add-on takes from the kitchen store '
  '(D27-374), in the Store item''s unit. A size''s or an add-on''s lines are on top of the dish''s. '
  'Read by app.pos_line_takes_from_kitchen when a line is sent.';

alter table recipe_lines enable row level security;
alter table recipe_lines force row level security;
drop policy if exists hotel_isolation on recipe_lines;
create policy hotel_isolation on recipe_lines
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update, delete on recipe_lines to pms_app;


-- ── Off the kitchen store the moment it is sent; struck after, wastage ─────
create or replace function app.pos_line_takes_from_kitchen()
returns trigger
language plpgsql
as $$
declare
  v_store  uuid;
  v_before numeric;
  v_after  numeric;
  v_reason text;
  v_keep   numeric;
  m        record;
begin
  -- (1) SENT: one issue per Store item the line's recipe takes.
  if not new.voided and new.kot_status <> 'pending'
     and (tg_op = 'INSERT' or old.kot_status = 'pending') then
    select id into v_store from locations
     where hotel_id = new.hotel_id and is_kitchen_store and is_active;
    if v_store is null then
      return null;
    end if;
    insert into stock_movements
      (hotel_id, item_id, location_id, business_date, kind, quantity, reference,
       to_outlet, moved_by, pos_line_id)
    select new.hotel_id, t.stock_item_id, v_store, app.business_date(new.hotel_id),
           'issue', -round(new.qty * sum(t.quantity), 3),
           'Bill ' || o.order_no || coalesce(' KOT ' || new.kot_no, ''),
           o.outlet_id, app.current_user_id(), new.id
      from (
        -- The dish's own lines, its size's, a side's, a numbered add-on line's...
        select r.stock_item_id, r.quantity from recipe_lines r
         where r.hotel_id = new.hotel_id
           and ((r.item_id = new.item_id and r.variation_id is null)
                or r.variation_id = new.variation_id
                or r.addon_id = new.addon_id
                or r.numbered_addon_id = new.numbered_addon_id)
        union all
        -- ...and each numbered add-on folded into the dish, so many of it per dish (208).
        select r.stock_item_id,
               r.quantity * case when jsonb_typeof(a -> 'qty') = 'number' then (a ->> 'qty')::numeric else 1 end
          from jsonb_array_elements(case when jsonb_typeof(new.numbered_addons -> 'addons') = 'array'
                                         then new.numbered_addons -> 'addons' else '[]'::jsonb end) a
          join recipe_lines r on r.hotel_id = new.hotel_id and r.numbered_addon_id::text = a ->> 'id'
      ) t
      join stock_items i on i.id = t.stock_item_id and i.hotel_id = new.hotel_id
      join pos_orders o on o.id = new.order_id
     group by t.stock_item_id, o.order_no, o.outlet_id
    having round(new.qty * sum(t.quantity), 3) > 0;
    return null;
  end if;

  -- (2) STRUCK ONCE THE KITCHEN HAD IT, or fewer of it: what went stays used,
  --     as wastage with the strike's reason.
  if tg_op <> 'UPDATE' or old.kot_status = 'pending' then
    return null;
  end if;
  v_before := case when old.voided then 0 else old.qty end;
  v_after  := case when new.voided then 0 else new.qty end;
  if v_after >= v_before then
    return null;
  end if;
  v_reason := case when new.voided then nullif(btrim(new.void_reason), '') end;
  if v_reason is null then
    -- Fewer of a sent dish (or its sides): the struck copy written in this same act (209).
    select nullif(btrim(l.void_reason), '') into v_reason from pos_order_lines l
     where l.order_id = new.order_id and l.voided and l.was_sent_when_voided and l.voided_at = now()
     order by l.id desc limit 1;
  end if;
  for m in
    select s.* from stock_movements s
     where s.pos_line_id = new.id and s.kind = 'issue' and s.reverses_id is null
       and not exists (select 1 from stock_movements r where r.reverses_id = s.id)
       -- The kitchen's, never the bar's: a drink struck stays poured (235).
       and not exists (select 1 from locations l
                        where l.id = s.location_id and (l.is_bar_store or l.is_bar_counter))
  loop
    perform app.reverse_stock_movement(m.id, app.current_user_id(), 'Struck after the KOT');
    v_keep := round(m.quantity * v_after / v_before, 3);
    if v_keep <> 0 then
      insert into stock_movements
        (hotel_id, item_id, location_id, business_date, kind, quantity, reference,
         to_outlet, moved_by, pos_line_id)
      values (m.hotel_id, m.item_id, m.location_id, app.business_date(m.hotel_id), 'issue', v_keep,
              m.reference, m.to_outlet, app.current_user_id(), new.id);
    end if;
    if m.quantity - v_keep <> 0 then
      insert into stock_movements
        (hotel_id, item_id, location_id, business_date, kind, quantity, reference, note,
         to_outlet, moved_by, pos_line_id)
      values (m.hotel_id, m.item_id, m.location_id, app.business_date(m.hotel_id), 'wastage',
              m.quantity - v_keep, m.reference,
              'Struck after the KOT' || coalesce(': ' || v_reason, ''),
              m.to_outlet, app.current_user_id(), new.id);
    end if;
  end loop;
  return null;
end $$;

comment on function app.pos_line_takes_from_kitchen() is
  'D27-374: a line sent takes its recipe from the kitchen store, as issues to its outlet marked '
  'with the line; struck (or fewer) once sent, that part becomes wastage with the reason.';

drop trigger if exists pos_order_lines_take_from_kitchen on pos_order_lines;
create trigger pos_order_lines_take_from_kitchen
  after insert or update of kot_status, voided, qty on pos_order_lines
  for each row execute function app.pos_line_takes_from_kitchen();


-- ── A test hotel's classes: 249's list, with recipe_lines as setup ──────────
-- ⚠ 250-252 (release 15's helpers) may redefine this too; whichever merges
-- last must carry every entry.
create or replace function app.test_hotel_classes()
returns table (table_name text, class text)
language sql
immutable
as $$
  values
  -- setup ------------------------------------------------------------------
  ('room_types', 'setup'), ('rooms', 'setup'), ('room_type_amenities', 'setup'),
  ('room_type_photos', 'setup'), ('rates', 'setup'), ('rate_offsets', 'setup'),
  ('rate_plan_settings', 'setup'), ('rate_plan_sources', 'setup'),
  ('rate_restrictions', 'setup'), ('pricing_basis', 'setup'),
  ('booking_source_rates', 'setup'), ('room_promotions', 'setup'),
  ('cancellation_policies', 'setup'), ('inclusions', 'setup'),
  ('hotel_meal_days', 'setup'), ('hotel_holidays', 'setup'), ('tax_rules', 'setup'),
  ('tax_sac', 'setup'), ('payment_methods', 'setup'), ('hotel_lists', 'setup'),
  ('hotel_modules', 'setup'), ('hotel_texts', 'setup'), ('hotel_amenities', 'setup'),
  ('hotel_logos', 'setup'), ('hotel_photos', 'setup'), ('guest_message_settings', 'setup'),
  ('pos_outlets', 'setup'), ('pos_sections', 'setup'), ('pos_tables', 'setup'),
  ('pos_menu_categories', 'setup'), ('pos_menu_items', 'setup'),
  ('pos_item_variations', 'setup'), ('pos_addon_groups', 'setup'), ('pos_addons', 'setup'),
  ('pos_item_addon_groups', 'setup'), ('pos_numbered_addons', 'setup'),
  ('pos_kot_kinds', 'setup'), ('pos_promotions', 'setup'), ('locations', 'setup'),
  ('stock_items', 'setup'), ('bar_pours', 'setup'), ('recipe_lines', 'setup'),
  ('stock_levels', 'setup'), ('suppliers', 'setup'),
  ('equipment_categories', 'setup'), ('laundry_price_items', 'setup'),
  ('spa_therapists', 'setup'), ('spa_treatments', 'setup'), ('banquet_venues', 'setup'),
  ('banquet_packages', 'setup'), ('approval_rules', 'setup'),
  ('purchase_requesters', 'setup'), ('review_links', 'setup'),
  -- trading ----------------------------------------------------------------
  ('reservations', 'trading'), ('reservation_inclusions', 'trading'),
  ('room_assignments', 'trading'), ('room_blocks', 'trading'),
  ('room_status_log', 'trading'), ('housekeeping_assignments', 'trading'),
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'), ('refunds', 'trading'),
  ('invoices', 'trading'), ('vat_bills', 'trading'), ('closed_day_corrections', 'trading'),
  ('night_audit_runs', 'trading'), ('form_c_filings', 'trading'),
  ('form_iii_stays', 'trading'), ('guest_links', 'trading'), ('guest_link_codes', 'trading'),
  ('guest_unlocks', 'trading'), ('guest_desk_replies', 'trading'),
  ('guest_detail_submissions', 'trading'), ('guest_digilocker_attempts', 'trading'),
  ('guest_food_orders', 'trading'), ('guest_id_photos', 'trading'),
  ('guest_id_photo_views', 'trading'), ('guest_requests', 'trading'),
  ('key_cards', 'trading'), ('wake_up_calls', 'trading'), ('lost_items', 'trading'),
  ('work_orders', 'trading'), ('work_order_costs', 'trading'), ('attachments', 'trading'),
  ('approvals', 'trading'), ('pos_orders', 'trading'), ('pos_order_lines', 'trading'),
  ('pos_order_tenders', 'trading'), ('pos_line_events', 'trading'),
  ('pos_tickets', 'trading'), ('pos_kot_prints', 'trading'), ('pos_kot_reprints', 'trading'),
  ('pos_bill_prints', 'trading'), ('bar_purchases', 'trading'), ('bar_purchase_lines', 'trading'),
  ('bar_requests', 'trading'), ('bar_request_lines', 'trading'), ('bar_closed_days', 'trading'),
  ('pos_tender_changes', 'trading'), ('pos_requests', 'trading'), ('pos_table_moves', 'trading'),
  ('pos_cash_movements', 'trading'), ('pos_day_ends', 'trading'),
  ('pos_denominations', 'trading'), ('cashier_shifts', 'trading'),
  ('cashier_movements', 'trading'), ('cashier_denominations', 'trading'),
  ('cashier_float_claims', 'trading'), ('cash_deposits', 'trading'),
  ('cash_deposit_notes', 'trading'), ('company_payments', 'trading'),
  ('credit_limit_allowances', 'trading'), ('contracts', 'trading'),
  ('contract_rates', 'trading'), ('banquet_events', 'trading'),
  ('banquet_event_packages', 'trading'), ('table_bookings', 'trading'),
  ('spa_appointments', 'trading'), ('laundry_dockets', 'trading'),
  ('laundry_docket_lines', 'trading'), ('loyalty_members', 'trading'),
  ('loyalty_points', 'trading'), ('stock_movements', 'trading'),
  ('stock_count_lines', 'trading'), ('purchase_requests', 'trading'),
  ('purchase_request_lines', 'trading'), ('supplier_bills', 'trading'),
  ('supplier_payments', 'trading'), ('supplier_credit_notes', 'trading'),
  ('supplier_reversals', 'trading'), ('equipment_items', 'trading'),
  ('equipment_history', 'trading'), ('equipment_moves', 'trading'),
  -- never ------------------------------------------------------------------
  ('staff_hotels', 'never'), ('channel_hotels', 'never'), ('channel_room_types', 'never'),
  ('channel_rate_plans', 'never'), ('channel_ari_sent', 'never'),
  ('channel_ari_pushes', 'never'), ('channel_bookings', 'never'), ('crs_hotels', 'never'),
  ('crs_room_types', 'never'), ('crs_bookings', 'never'), ('market_rate_settings', 'never'),
  ('market_rates', 'never'), ('daily_report_emails', 'never'), ('invoice_series', 'never'),
  ('vat_bill_series', 'never'), ('audit_log', 'never'), ('messages_sent', 'never'),
  ('hotel_bank_details', 'never'), ('pos_kot_stations', 'never'),
  ('hotel_setup_steps', 'never'),
  -- group ------------------------------------------------------------------
  ('hotels', 'group'), ('staff', 'group'), ('guests', 'group'), ('companies', 'group'),
  ('reservation_groups', 'group'), ('guest_documents', 'group'), ('guest_joins', 'group'),
  ('guest_not_same', 'group'), ('offer_opt_ins', 'group'), ('offer_opt_outs', 'group'),
  ('guest_messaging_began', 'group'), ('meal_plans', 'group'), ('booking_sources', 'group'),
  ('sales_people', 'group'), ('vip_levels', 'group'), ('amenities', 'group'),
  ('group_settings', 'group'), ('room_type_templates', 'group'),
  ('provisioning_keys', 'group'), ('sign_ins', 'group'), ('telemetry_events', 'group'),
  ('telemetry_requests', 'group'), ('schema_migrations', 'group')
$$;
