-- =============================================================================
-- 234 · A bar bill recorded, with its photo (the owner's D27-354, 21 October)
-- =============================================================================
-- Purchasing gets a Bar side: a bill that has come is recorded directly - the
-- supplier, its number and date, a photo of it (attachments, 077) and its drinks
-- with the bottles and the cost per bottle as paid (liquor is not under GST).
-- Each drink goes into the BAR STORE at once as a receipt on the Store's own
-- ledger (069), pointing at its bill. No approval: the bill has already come.
--
--   * locations.is_bar_store: which store is the bar's - until now only its
--     name said so ("Bar store", 104). Set on each hotel's "Bar store"; one per
--     hotel; the stores made for a new hotel mark theirs.
--   * stock_items.size_ml: a bottle's size, so the bar counts in bottles and
--     ml (D27-354): a 60 ml peg is 0.08 of a 750 ml bottle.
--   * bar_purchases: the bill. stock_movements.bar_purchase_id: its drinks.
--
-- Re-runnable.
-- =============================================================================

alter table locations add column if not exists is_bar_store boolean not null default false;
create unique index if not exists locations_one_bar_store on locations (hotel_id) where is_bar_store;
update locations l set is_bar_store = true
 where l.kind = 'store' and l.name = 'Bar store'
   and not exists (select 1 from locations o where o.hotel_id = l.hotel_id and o.is_bar_store);

comment on column locations.is_bar_store is
  'The bar''s store (D27-354): bar bills are received into it and the bar''s sales and count come out of it. One per hotel.';

-- 104's, with one change: the Bar store it makes is marked the bar's.
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
  insert into locations (hotel_id, name, kind, is_bar_store)
  values (p_hotel, 'Main store', 'store', false),
         (p_hotel, 'Kitchen store', 'store', false),
         (p_hotel, 'Bar store', 'store', true)
  on conflict (hotel_id, name) do nothing;
  get diagnostics v_made = row_count;
  return v_made;
end $fn$;
revoke all on function app.default_stores(uuid) from public;

alter table stock_items add column if not exists size_ml int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_items_size_ml_sane') then
    alter table stock_items add constraint stock_items_size_ml_sane
      check (size_ml is null or size_ml between 1 and 20000);
  end if;
end $$;
comment on column stock_items.size_ml is
  'A bottle''s size in ml (D27-354): the bar counts in bottles and ml. Null for anything not poured.';

create table if not exists bar_purchases (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  supplier      text not null check (length(btrim(supplier)) between 1 and 120),
  bill_no       text not null check (length(btrim(bill_no)) between 1 and 60),
  bill_date     date not null,
  business_date date not null,
  recorded_by   uuid not null references staff(id),
  recorded_at   timestamptz not null default now(),
  -- The same bill twice is a mistake, not a second delivery.
  unique (hotel_id, supplier, bill_no)
);

comment on table bar_purchases is
  'A bar bill recorded (D27-354): its drinks are receipts into the bar''s store '
  '(stock_movements.bar_purchase_id); its photo is an attachment (subject_table bar_purchases).';

alter table bar_purchases enable row level security;
alter table bar_purchases force row level security;
drop policy if exists hotel_isolation on bar_purchases;
create policy hotel_isolation on bar_purchases
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

-- Recorded, never changed: a wrong drink is reversed on the Store's ledger.
grant select, insert on bar_purchases to pms_app;
revoke update, delete on bar_purchases from pms_app;

alter table stock_movements add column if not exists bar_purchase_id uuid references bar_purchases(id);
create index if not exists stock_movements_bar_purchase_idx
  on stock_movements (bar_purchase_id) where bar_purchase_id is not null;


-- ── A test hotel's classes: a bar bill is trading ──────────────────────────
-- 225's list, copied with one change: ('bar_purchases', 'trading').
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
  ('stock_items', 'setup'), ('stock_levels', 'setup'), ('suppliers', 'setup'),
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
  ('pos_bill_prints', 'trading'), ('bar_purchases', 'trading'),
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
