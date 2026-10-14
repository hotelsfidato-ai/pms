-- =============================================================================
-- 226 · A reprinted KOT prints at the station (the owner's D27-329 (2), 15 October)
-- =============================================================================
-- "A reprinted KOT prints at the station's printer (the kitchen's or the
-- bar's), not on the device where Reprint is pressed." Reprint is on the order
-- pad, the Till and the Terminal (D27-329 (5)).
--
-- A REPRINT ASKED IS A ROW HERE, waiting for the computer that prints that
-- KOT's kind (211's pos_kot_kinds.station_id) - where the KOT first went, as
-- the kind is stamped on each line when it is sent. That computer finds it in
-- its own ask (POST till/kot-stations/poll), claims it before the paper by
-- setting printed_at, and prints the KOT's slip marked REPRINT - the same ask,
-- claim and slip as a new KOT, not a second way of printing. A computer
-- offline: the reprint waits for it, as a new KOT does.
--
-- pos_kot_prints (157, 211) is left alone: a KOT is printed once, and a
-- reprint writes nothing there.
--
-- The app asks a reprint and marks it printed; it never changes which KOT was
-- asked, nor removes one. A test hotel counts it as trading (219's list,
-- copied with that one line added).
--
-- Re-runnable.
-- =============================================================================

create table if not exists pos_kot_reprints (
  id         bigserial primary key,
  hotel_id   uuid not null references hotels(id) on delete cascade,
  order_id   uuid not null references pos_orders(id) on delete cascade,
  kot_no     int  not null,
  -- Which slip of the KOT: its kind, so it prints where that kind prints.
  kind_id    uuid not null references pos_kot_kinds(id),
  asked_by   uuid not null references staff(id),
  asked_at   timestamptz not null default now(),
  -- The station's claim, before the paper; null while it waits.
  printed_at timestamptz
);

comment on table pos_kot_reprints is
  'A KOT slip asked to print again (D27-329 (2)): it waits for the computer '
  'that prints its kind, which claims it (printed_at) and prints it marked REPRINT.';

create index if not exists pos_kot_reprints_waiting_idx
  on pos_kot_reprints (kind_id) where printed_at is null;

alter table pos_kot_reprints enable row level security;
alter table pos_kot_reprints force row level security;
drop policy if exists hotel_isolation on pos_kot_reprints;
create policy hotel_isolation on pos_kot_reprints
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

-- Asked, then printed; nothing else changes and nothing is removed. 010's
-- default privileges would give update and delete on every column.
grant select, insert on pos_kot_reprints to pms_app;
revoke update, delete on pos_kot_reprints from pms_app;
grant update (printed_at) on pos_kot_reprints to pms_app;
grant usage on sequence pos_kot_reprints_id_seq to pms_app;


-- ── A test hotel's classes: a reprint is trading, as a printed KOT is ──────
-- 219's list, copied with one change: ('pos_kot_reprints', 'trading'). A table
-- in no class is refused by db/tests/modules/test-hotels.sql (D27-320).
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
  ('pos_bill_prints', 'trading'),
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
