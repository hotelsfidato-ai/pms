-- =============================================================================
-- 215 · Set up this hotel: what a person chose on each step (the owner's
--       D27-311, 13 October)
-- =============================================================================
-- The setup wizard walks a hotel to go-live in 18 steps. Whether a step is
-- DONE is worked out from the hotel's own rows every time it is asked (the
-- API, api/src/modules/admin/setup.ts) - never stored, so it cannot go stale.
-- What is stored is only what the data cannot show, per hotel and per step:
--
--   completed   a step the PMS cannot check, marked done by hand
--   later       "not now": the step waits in the "Still to do" list
--   remind      "remind me on <remind_on>": on that day and after, the bell
--               of the hotel's owner, Admin and GM says so (derived in the
--               bell's own read, never a stored message)
--
-- with who chose it and when. No row: nothing chosen. "Clear" deletes the row.
--
-- Who: whoever manages THIS hotel (app.manages_hotel: a group administrator,
-- or owner, GM or Admin at it) reads and writes, and nobody else - FORCE RLS,
-- as hotel_bank_details. The API's role gate asks the same three roles first.
--
-- A test hotel never copies it (class 'never'): another hotel's progress is
-- not the test hotel's.
--
-- Re-runnable: created if missing, policies and trigger dropped and made
-- again, the class list replaced with the same signature (MEMORY 317).
-- =============================================================================

create table if not exists hotel_setup_steps (
  hotel_id   uuid not null references hotels(id) on delete cascade,
  step       text not null,
  choice     text not null,
  remind_on  date,
  chosen_by  uuid references staff(id) on delete set null default app.current_user_id(),
  chosen_at  timestamptz not null default now(),

  primary key (hotel_id, step),
  constraint hotel_setup_steps_choice_known check (choice in ('completed', 'later', 'remind')),
  -- A reminder has its day; nothing else has one.
  constraint hotel_setup_steps_remind_has_a_day check ((choice = 'remind') = (remind_on is not null))
);

comment on table hotel_setup_steps is
  'Set up this hotel (D27-311): per hotel and step, a choice the data cannot show - '
  'completed by hand, later, or remind on a day - with who and when. Whether a step '
  'is done is derived by the API from the hotel''s rows, never stored here.';

alter table hotel_setup_steps enable row level security;
alter table hotel_setup_steps force  row level security;
drop policy if exists hotel_setup_steps_read on hotel_setup_steps;
create policy hotel_setup_steps_read on hotel_setup_steps
  for select using ( app.manages_hotel(hotel_id) );
drop policy if exists hotel_setup_steps_write on hotel_setup_steps;
create policy hotel_setup_steps_write on hotel_setup_steps
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
revoke all on hotel_setup_steps from pms_app;
grant select, insert, update, delete on hotel_setup_steps to pms_app;

drop trigger if exists hotel_setup_steps_audit on hotel_setup_steps;
create trigger hotel_setup_steps_audit after insert or update or delete on hotel_setup_steps
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- Every table is in one class (212, section 7): this one is 'never'. The list
-- is 212's, unchanged, with hotel_setup_steps added to 'never'.
-- -----------------------------------------------------------------------------
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
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'),
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
  ('pos_tickets', 'trading'), ('pos_kot_prints', 'trading'), ('pos_bill_prints', 'trading'),
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
