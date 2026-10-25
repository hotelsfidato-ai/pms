-- =============================================================================
-- 238 · The bar as the excise registers keep it: a Bar store and a Bar counter
--       (the owner's D27-361, 22 October)
-- =============================================================================
-- From the owner's photos of FORM FLR-1A/2A/3A (daily, by brand and bottle
-- size) and FORM FLR-3 (monthly): "2 places - the store where it's counted
-- whole, and the counter ... the counter requested 5 bottles so the approval
-- will be given to move ... closing count ... then the night audit, and the
-- morning audit of stock".
--
--   * locations.is_bar_counter: the BAR COUNTER, one per hotel, beside the Bar
--     store (234). Supplier bills still go into the Bar store; every KOT now
--     takes from the counter (app.pos_line_takes_from_bar, 235's with the place
--     changed - the Bar store when a hotel has no counter). Made for every
--     hotel that has a Bar store, and by default_stores() for a new one. It
--     starts empty: the counter asks the store.
--   * stock_items.count_as: poured (hard liquor, wine - whole NIPs or bottles
--     in the store, sealed and the open one's ml at the counter), whole (beer -
--     bottles everywhere), packet (cigarettes - packets, and at the counter the
--     open packet's sticks: pack_size). brand, liquor and imported place a
--     drink in the registers' rows and columns.
--   * stock_count_lines.moment: the closing count before the night audit, or
--     the bar manager's morning count at opening.
--   * bar_requests, bar_request_lines: the counter asks the store; the GM or the
--     Inventory Manager approves - never their own ask - and approving moves it
--     (app.transfer_stock, from the API, in the same transaction; each line
--     keeps its transfer_id).
--   * bar_closed_days: "Bar closed today", the GM's reason - the night audit
--     then does not wait for the bar's count.
--
-- No new kind of movement: 180 rewrites that list on every replay (MEMORY 284).
-- A move store -> counter is a 'transfer'.
--
-- Re-runnable.
-- =============================================================================

-- ── The counter ─────────────────────────────────────────────────────────────
alter table locations add column if not exists is_bar_counter boolean not null default false;
create unique index if not exists locations_one_bar_counter on locations (hotel_id) where is_bar_counter;
comment on column locations.is_bar_counter is
  'The bar''s counter (D27-361): every KOT takes from it; the counter asks the Bar store for '
  'stock. One per hotel.';

-- A store already called "Bar counter" is marked; else one is made beside the Bar store.
update locations l set is_bar_counter = true
 where l.kind = 'store' and l.name = 'Bar counter' and not l.is_bar_store
   and not exists (select 1 from locations o where o.hotel_id = l.hotel_id and o.is_bar_counter);
insert into locations (hotel_id, name, kind, is_bar_counter)
select s.hotel_id, 'Bar counter', 'store', true
  from locations s
 where s.is_bar_store
   and not exists (select 1 from locations o where o.hotel_id = s.hotel_id and o.is_bar_counter)
on conflict (hotel_id, name) do nothing;

-- 234's, with one change: the Bar counter beside the Bar store.
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
  insert into locations (hotel_id, name, kind, is_bar_store, is_bar_counter)
  values (p_hotel, 'Main store', 'store', false, false),
         (p_hotel, 'Kitchen store', 'store', false, false),
         (p_hotel, 'Bar store', 'store', true, false),
         (p_hotel, 'Bar counter', 'store', false, true)
  on conflict (hotel_id, name) do nothing;
  get diagnostics v_made = row_count;
  return v_made;
end $fn$;
revoke all on function app.default_stores(uuid) from public;

-- ── How a drink is counted, and where it sits in the registers ─────────────
alter table stock_items add column if not exists count_as text;
alter table stock_items add column if not exists pack_size int;
alter table stock_items add column if not exists brand text;
alter table stock_items add column if not exists liquor text;
alter table stock_items add column if not exists imported boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_items_count_as_known') then
    alter table stock_items add constraint stock_items_count_as_known
      check (count_as is null or count_as in ('poured', 'whole', 'packet'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_pack_size_sane') then
    alter table stock_items add constraint stock_items_pack_size_sane
      check (pack_size is null or pack_size between 1 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_packet_has_size') then
    alter table stock_items add constraint stock_items_packet_has_size
      check (count_as is distinct from 'packet' or pack_size is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_poured_has_size') then
    alter table stock_items add constraint stock_items_poured_has_size
      check (count_as is distinct from 'poured' or size_ml is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_liquor_known') then
    alter table stock_items add constraint stock_items_liquor_known
      check (liquor is null or liquor in ('whisky', 'rum', 'vodka', 'gin', 'brandy', 'tequila',
                                          'liqueur', 'wine', 'beer_strong', 'beer_mild', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_items_brand_sane') then
    alter table stock_items add constraint stock_items_brand_sane
      check (brand is null or length(btrim(brand)) between 1 and 120);
  end if;
end $$;
-- The bar's drinks so far: poured when they have a size, else whole.
update stock_items set count_as = case when size_ml is not null then 'poured' else 'whole' end
 where category = 'Bar' and count_as is null;
comment on column stock_items.count_as is
  'How the bar counts it (D27-361): poured (NIPs/bottles, the open one in ml at the counter), '
  'whole (beer: bottles), packet (cigarettes: packets, the open one''s sticks at the counter). '
  'Null for anything not the bar''s.';
comment on column stock_items.liquor is
  'Its row group in the excise registers (FLR-1A/2A/3A, FLR-3); null: not in them (cigarettes).';

-- ── The closing count, or the morning count ────────────────────────────────
alter table stock_count_lines add column if not exists moment text not null default 'closing';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_count_lines_moment_known') then
    alter table stock_count_lines add constraint stock_count_lines_moment_known
      check (moment in ('closing', 'morning'));
  end if;
end $$;
comment on column stock_count_lines.moment is
  'closing: the count before the night audit; morning: the bar manager''s count at opening (D27-361).';

-- ── The counter asks the store ─────────────────────────────────────────────
create table if not exists bar_requests (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  business_date date not null,
  requested_by  uuid not null references staff(id),
  requested_at  timestamptz not null default now(),
  note          text check (note is null or length(btrim(note)) between 1 and 300),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 300),
  -- Nobody approves their own ask.
  constraint bar_requests_not_own check (decided_by is null or decided_by <> requested_by),
  constraint bar_requests_decided check ((status = 'pending') = (decided_by is null)),
  constraint bar_requests_rejected_why check (status <> 'rejected' or decision_note is not null)
);
create index if not exists bar_requests_pending on bar_requests (hotel_id, requested_at) where status = 'pending';
comment on table bar_requests is
  'The bar counter asking the Bar store for stock (D27-361). Approved by the GM or the Inventory '
  'Manager, never the one who asked; approving moves each line store -> counter.';

create table if not exists bar_request_lines (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  request_id  uuid not null references bar_requests(id) on delete cascade,
  item_id     uuid not null,
  quantity    numeric(12,3) not null check (quantity > 0),
  -- The move approving made (stock_movements.transfer_id).
  transfer_id uuid,
  constraint bar_request_lines_item_fk foreign key (hotel_id, item_id)
    references stock_items (hotel_id, id),
  unique (request_id, item_id)
);
create index if not exists bar_request_lines_request on bar_request_lines (request_id);

create table if not exists bar_closed_days (
  hotel_id      uuid not null references hotels(id) on delete cascade,
  business_date date not null,
  reason        text not null check (length(btrim(reason)) between 1 and 300),
  closed_by     uuid not null references staff(id),
  closed_at     timestamptz not null default now(),
  primary key (hotel_id, business_date)
);
comment on table bar_closed_days is
  '"Bar closed today" (D27-361): the GM''s reason; the night audit does not wait for the bar''s count.';

alter table bar_requests enable row level security;
alter table bar_requests force row level security;
drop policy if exists hotel_isolation on bar_requests;
create policy hotel_isolation on bar_requests
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update on bar_requests to pms_app;
revoke delete on bar_requests from pms_app;

alter table bar_request_lines enable row level security;
alter table bar_request_lines force row level security;
drop policy if exists hotel_isolation on bar_request_lines;
create policy hotel_isolation on bar_request_lines
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update on bar_request_lines to pms_app;
revoke delete on bar_request_lines from pms_app;

alter table bar_closed_days enable row level security;
alter table bar_closed_days force row level security;
drop policy if exists hotel_isolation on bar_closed_days;
create policy hotel_isolation on bar_closed_days
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, delete on bar_closed_days to pms_app;

-- ── Every KOT takes from the counter (235's, the place changed) ────────────
create or replace function app.pos_line_takes_from_bar()
returns trigger
language plpgsql
as $$
declare
  v_pour  record;
  v_store uuid;
  v_qty   numeric;
begin
  if new.voided or new.kot_status = 'pending' or new.item_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.kot_status <> 'pending' then
    return null;
  end if;

  -- The size's own row first, else the dish's.
  select p.stock_item_id, p.ml, p.units, i.size_ml into v_pour
    from bar_pours p join stock_items i on i.id = p.stock_item_id
   where p.item_id = new.item_id
     and (p.variation_id = new.variation_id or p.variation_id is null)
   order by (p.variation_id is null)
   limit 1;
  if not found then
    return null;
  end if;
  if v_pour.ml is not null and coalesce(v_pour.size_ml, 0) = 0 then
    return null;   -- ml of a bottle with no size: nothing safe to take
  end if;

  -- The counter (D27-361); a hotel with none still takes from its Bar store.
  select id into v_store from locations
   where hotel_id = new.hotel_id and is_active and (is_bar_counter or is_bar_store)
   order by is_bar_counter desc
   limit 1;
  if v_store is null then
    return null;
  end if;

  v_qty := case when v_pour.ml is not null
                then round(new.qty * v_pour.ml / v_pour.size_ml::numeric, 3)
                else round(new.qty * v_pour.units, 3) end;
  if v_qty <= 0 then
    return null;
  end if;

  insert into stock_movements
    (hotel_id, item_id, location_id, business_date, kind, quantity, reference,
     to_outlet, moved_by, pos_line_id)
  select new.hotel_id, v_pour.stock_item_id, v_store, app.business_date(new.hotel_id),
         'issue', -v_qty,
         'Bill ' || o.order_no || coalesce(' KOT ' || new.kot_no, ''),
         o.outlet_id, app.current_user_id(), new.id
    from pos_orders o where o.id = new.order_id;
  return null;
end $$;

comment on function app.pos_line_takes_from_bar() is
  'D27-354, D27-361: a line sent to the kitchen or the bar takes what its dish takes from the '
  'bar counter (else the Bar store), as an issue to its outlet marked with the line.';

drop trigger if exists pos_order_lines_take_from_bar on pos_order_lines;
create trigger pos_order_lines_take_from_bar
  after insert or update of kot_status on pos_order_lines
  for each row execute function app.pos_line_takes_from_bar();


-- ── A test hotel's classes: 237's list (235's with release 12.1's two), with the three new trading tables ──
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
  ('stock_items', 'setup'), ('bar_pours', 'setup'), ('stock_levels', 'setup'), ('suppliers', 'setup'),
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
  ('pos_tender_changes', 'trading'), ('pos_requests', 'trading'),
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
  ('purchase_request_lines', 'trading'), ('equipment_items', 'trading'),
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
