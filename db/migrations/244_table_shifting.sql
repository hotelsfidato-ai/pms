-- =============================================================================
-- 244 · Table shifting: Move and Join (the owner's D27-370, 27 October)
-- =============================================================================
-- "Table shifting ... yes to both but separate options", "no slip".
--
--   * MOVE: an open dine-in order goes to a free table of its section. Its
--     KOTs and its bill go with it - they hang off the order. Only the order's
--     table changes (table_id, table_ref); nothing prints.
--   * JOIN: the open order of another table of the section comes onto this
--     one - its lines, and with them its KOTs (a KOT number is the outlet's
--     for the day, 049, so none clash) - and the emptied order is closed as
--     JOINED: no sale, no void, not closed unpaid. It cannot be undone.
--
-- Every move and every join is kept in pos_table_moves: who, when, from which
-- table to which. Kept, never changed.
--
-- A joined order counts nowhere: every report that counts restaurant sales
-- reads `status = 'settled'`, the day end counts 'settled' and 'abandoned',
-- the bill lists read settled / void / no_charge, and a joined order has no
-- lines left and no tenders. It is cleared from its table as it is joined.
--
-- Its KOTs' printed marks (pos_kot_prints) move with its lines, or the KOT
-- computer would print them again under the other order: the one column
-- pms_app may now update there.
--
-- Re-runnable.
-- =============================================================================

alter table pos_orders add column if not exists joined_into uuid references pos_orders(id);
comment on column pos_orders.joined_into is
  'D27-370: the order this one''s lines went onto when its table was joined to another. '
  'Set on a joined order only.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_status_valid'
                    and pg_get_constraintdef(oid) like '%joined%') then
    alter table pos_orders drop constraint if exists pos_orders_status_valid;
    alter table pos_orders add constraint pos_orders_status_valid check (
      status in ('open', 'settled', 'abandoned', 'void', 'no_charge', 'joined'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'pos_orders_joined_into') then
    alter table pos_orders add constraint pos_orders_joined_into check (
      (status = 'joined') = (joined_into is not null));
  end if;
end $$;

-- A joined order stays joined (it cannot be undone, D27-370).
create or replace function app.pos_order_joined_stays()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'joined'
     and (new.status, new.joined_into) is distinct from (old.status, old.joined_into) then
    raise exception 'Bill % was joined to another and stays joined.', old.order_no
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_joined_stays on pos_orders;
create trigger pos_orders_joined_stays
  before update on pos_orders
  for each row execute function app.pos_order_joined_stays();

-- ── The record ──────────────────────────────────────────────────────────────
create table if not exists pos_table_moves (
  id              bigserial primary key,
  hotel_id        uuid not null references hotels(id) on delete cascade,
  -- The order that moved; for a join, the one the other came onto.
  order_id        uuid not null references pos_orders(id) on delete cascade,
  -- A join: the order emptied into order_id. Null for a move.
  joined_order_id uuid references pos_orders(id) on delete cascade,
  -- The tables' names as they were, as table_ref keeps them.
  from_table      text not null,
  to_table        text not null,
  moved_by        uuid not null references staff(id),
  moved_at        timestamptz not null default now()
);
create index if not exists pos_table_moves_order on pos_table_moves (order_id);
comment on table pos_table_moves is
  'Every table move and join of a restaurant order (D27-370): who, when, from which table to '
  'which. Kept, never changed.';

alter table pos_table_moves enable row level security;
alter table pos_table_moves force row level security;
drop policy if exists hotel_isolation on pos_table_moves;
create policy hotel_isolation on pos_table_moves
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert on pos_table_moves to pms_app;
grant usage on sequence pos_table_moves_id_seq to pms_app;
revoke update, delete on pos_table_moves from pms_app;

-- A joined order's printed KOTs go with its lines (above).
grant update (order_id) on pos_kot_prints to pms_app;

-- ── A test hotel's classes: 238's list, with pos_table_moves ──
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
