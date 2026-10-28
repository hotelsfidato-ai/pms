-- =============================================================================
-- 246 · What we owe suppliers: a bill on credit, and its payment (D27-370)
-- =============================================================================
-- The owner, 27 October: when goods come on credit, the delivery records the
-- supplier's bill - its number, date, amount and due date. The Supplier dues
-- list shows what is owed to each supplier; the bill is paid later (cash,
-- cheque, bank or UPI) and marked paid. No cash drawer changes.
--
--   * supplier_bills: one bill on credit, from a purchase order's delivery
--     (purchase_request_id) or a bar bill (bar_purchase_id) - exactly one.
--     The supplier's name as it stood on the delivery.
--   * Its payment is four columns on the same row, all or none: the owner's
--     words are "marked paid", so a payment pays the whole bill. Part
--     payments are not decided (purchasing CHANGELOG, the questions).
--   * The app may write a bill once and its payment once: no update of the
--     bill's own facts, no delete (column grants, below). Editing or deleting
--     a recorded bill or payment waits on the owner.
--
-- Re-runnable.
-- =============================================================================

create table if not exists supplier_bills (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references hotels(id) on delete cascade,
  purchase_request_id uuid unique references purchase_requests(id),
  bar_purchase_id     uuid unique references bar_purchases(id),
  supplier            text not null check (length(btrim(supplier)) between 1 and 120),
  bill_no             text not null check (length(btrim(bill_no)) between 1 and 60),
  bill_date           date not null,
  -- As printed on the bill. Never a default (no default prices).
  amount              numeric(12,2) not null check (amount > 0),
  due_on              date not null,
  recorded_by         uuid not null references staff(id),
  recorded_at         timestamptz not null default now(),
  paid_on             date,
  paid_method         text check (paid_method in ('cash', 'cheque', 'bank', 'upi')),
  paid_reference      text check (paid_reference is null or length(btrim(paid_reference)) between 1 and 80),
  paid_by             uuid references staff(id),
  paid_at             timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_bills_one_source') then
    alter table supplier_bills add constraint supplier_bills_one_source
      check (num_nonnulls(purchase_request_id, bar_purchase_id) = 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_bills_due_after_bill') then
    alter table supplier_bills add constraint supplier_bills_due_after_bill
      check (due_on >= bill_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'supplier_bills_paid_whole') then
    alter table supplier_bills add constraint supplier_bills_paid_whole
      check (num_nulls(paid_on, paid_method, paid_by, paid_at) in (0, 4)
             and (paid_reference is null or paid_on is not null));
  end if;
end $$;

create index if not exists supplier_bills_unpaid_idx
  on supplier_bills (hotel_id, due_on) where paid_on is null;

comment on table supplier_bills is
  'A supplier''s bill on credit (D27-370): from a delivery or a bar bill. Paid whole, once: '
  'paid_on, paid_method, paid_by and paid_at, with paid_reference. No cash drawer is touched.';

alter table supplier_bills enable row level security;
alter table supplier_bills force row level security;
drop policy if exists hotel_isolation on supplier_bills;
create policy hotel_isolation on supplier_bills
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

-- Recorded once; its payment recorded once; never deleted.
revoke all on supplier_bills from pms_app;
grant select, insert on supplier_bills to pms_app;
grant update (paid_on, paid_method, paid_reference, paid_by, paid_at) on supplier_bills to pms_app;


-- A payment is recorded once: a paid bill is not paid again or changed.
create or replace function app.supplier_bill_paid_once()
returns trigger
language plpgsql
as $$
begin
  if old.paid_on is not null then
    raise exception 'This bill is already marked paid.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists supplier_bills_paid_once on supplier_bills;
create trigger supplier_bills_paid_once before update on supplier_bills
  for each row execute function app.supplier_bill_paid_once();

-- ── A test hotel's classes: a supplier's bill is trading ───────────────────
-- 238's list, copied with ('supplier_bills', 'trading') added, and 244's ('pos_table_moves', 'trading')
-- kept (both written from 238 on 27 October; this one runs last, so it carries both).
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
  ('purchase_request_lines', 'trading'), ('supplier_bills', 'trading'), ('equipment_items', 'trading'),
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
