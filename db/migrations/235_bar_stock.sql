-- =============================================================================
-- 235 · Bar stock: what each drink takes, off the bar the moment it is sent
--       (the owner's D27-354, 21 October)
-- =============================================================================
-- "When the KOT is punched, that sale needs to reduce the inventory." Each bar
-- dish - and each of its sizes - says what it takes from the bar's store:
-- so many ml of a bottle (Imperial Blue 60 ml takes 60 ml of "Imperial Blue
-- 750 ml") or so many whole ones (a NIP, one 180 ml bottle; a beer, one bottle).
-- The GM sets it once (bar_pours). When a line goes to the kitchen or the bar,
-- this trigger takes it off the bar's store: an ISSUE to the outlet that sold
-- it, marked with the order line (stock_movements.pos_line_id), in bottles to
-- the thousandth (60 ml of 750 ml is 0.08).
--
--   * An issue, not a new kind: 180 rewrites the list of kinds on every replay
--     (MEMORY 284), and a row of a kind it does not name would stop a deploy.
--     A sale is told from a hand issue by its pos_line_id.
--   * Only when a line goes from waiting to sent, and only one not struck: a
--     drink struck after the bar had it stays out, as poured (the owner). A
--     dish with nothing set takes nothing; the report lists it as not set up.
--   * Any door that sends - the Till, the Terminal, a waiter's phone, a
--     guest's order accepted - goes through this one trigger.
--   * daily_report_emails may hold "bar-stock": the Bar stock report by email.
--
-- Re-runnable.
-- =============================================================================

alter table stock_movements add column if not exists pos_line_id bigint;
comment on column stock_movements.pos_line_id is
  'The order line a bar sale took this for (D27-354, 235): set only on the issue the '
  'sending of that line made. No foreign key: the ledger keeps it after an order is gone.';
create index if not exists stock_movements_pos_line_idx
  on stock_movements (pos_line_id) where pos_line_id is not null;

create table if not exists bar_pours (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  item_id       uuid not null references pos_menu_items(id) on delete cascade,
  -- Null: every size of the dish, unless a size has a row of its own.
  variation_id  uuid references pos_item_variations(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id),
  -- So many ml of a bottle, or so many whole ones - one of the two.
  ml            int check (ml between 1 and 20000),
  units         numeric(8,3) check (units > 0),
  set_by        uuid references staff(id),
  set_at        timestamptz not null default now(),
  constraint bar_pours_ml_or_units check ((ml is null) <> (units is null))
);
create unique index if not exists bar_pours_one_per_size
  on bar_pours (item_id, coalesce(variation_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table bar_pours is
  'What a bar dish, or one of its sizes, takes from the bar''s store (D27-354): ml of a '
  'bottle, or whole ones. Read by app.pos_line_takes_from_bar when a line is sent.';

alter table bar_pours enable row level security;
alter table bar_pours force row level security;
drop policy if exists hotel_isolation on bar_pours;
create policy hotel_isolation on bar_pours
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update, delete on bar_pours to pms_app;


-- ── Off the bar the moment it is sent ────────────────────────────────────
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

  select id into v_store from locations
   where hotel_id = new.hotel_id and is_bar_store and is_active;
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
  'D27-354: a line sent to the kitchen or the bar takes what its dish takes from the bar''s '
  'store, as an issue to its outlet marked with the line.';

drop trigger if exists pos_order_lines_take_from_bar on pos_order_lines;
create trigger pos_order_lines_take_from_bar
  after insert or update of kot_status on pos_order_lines
  for each row execute function app.pos_line_takes_from_bar();


-- ── The Bar stock report may be emailed (204's list, with "bar-stock") ──────
alter table daily_report_emails drop constraint if exists daily_report_emails_report_known;
alter table daily_report_emails add constraint daily_report_emails_report_known
  check (report in ('night-audit', 'manager', 'money-owed', 'restaurant-stock', 'bar-stock'));


-- ── A test hotel's classes: what each dish takes is setup ─────────────────
-- 234's list, copied with one change: ('bar_pours', 'setup').
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
