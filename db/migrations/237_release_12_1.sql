-- =============================================================================
-- 237 · Release 12.1 (the owner's D27-363, 25 October)
-- =============================================================================
--   * pos_kot_stations.slip_mm: a printing computer's shortest slip. The
--     Fidato Printer app's KOTs came out sideways on the BAR PC while its
--     longer bills came out upright (MEMORY 427): a receipt printer's driver
--     turns a page it takes for landscape. Each slip is as long as it needs
--     and never shorter than this; null is the system's 160 mm, a little
--     above the bills that printed upright. Set and tested in Restaurant
--     setup, KOT section, on the computer itself.
--   * pos_tender_changes: a paid restaurant bill's cash, card or UPI changed
--     to another of the three, before the night audit, by the GM, the owner
--     or an Admin, with a reason (tenderChanges.ts). The tender is updated in
--     place (its method; `tendered` only means cash), and this row keeps from
--     what, to what, how much, why, who, when, and whether the drawer had
--     been counted. The day end lists them.
--   * pos_requests: a waiter or cashier SENDS the GM what they may not do
--     themselves - strike a dish the kitchen has, a discount, an NC bill,
--     void a paid bill - with a reason, instead of being refused. Each is
--     an approval (kind 'pos_request', subject the request) in the GM's
--     inbox and bell; the GM, the owner or an Admin approves (never their
--     own) and approving does it, with the same checks as at the till
--     (posRequests.ts, routes/approvals.ts). A rule for every hotel.
--
-- Re-runnable.
-- =============================================================================

alter table pos_kot_stations add column if not exists slip_mm int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pos_kot_stations_slip_mm_sane') then
    alter table pos_kot_stations add constraint pos_kot_stations_slip_mm_sane
      check (slip_mm is null or slip_mm between 60 and 400);
  end if;
end $$;
comment on column pos_kot_stations.slip_mm is
  'This computer''s shortest slip, in mm (D27-363): a slip is as long as it needs and never shorter. '
  'Null: 160 mm. A KOT that prints sideways is made longer here.';

-- ── A paid bill's payment mode changed ─────────────────────────────────────
create table if not exists pos_tender_changes (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  order_id      uuid not null references pos_orders(id) on delete cascade,
  tender_id     bigint not null,
  from_method   text not null check (from_method in ('cash', 'card', 'upi')),
  to_method     text not null check (to_method in ('cash', 'card', 'upi')),
  amount        numeric(12,2) not null check (amount > 0),
  reason        text not null check (length(btrim(reason)) between 1 and 300),
  business_date date not null,
  -- The till's day end was already closed: its counted drawer no longer
  -- matches by this much, and the day end says why.
  after_day_end boolean not null default false,
  changed_by    uuid not null references staff(id),
  changed_at    timestamptz not null default now(),
  constraint pos_tender_changes_changes check (from_method <> to_method)
);
create index if not exists pos_tender_changes_day on pos_tender_changes (hotel_id, business_date);
create index if not exists pos_tender_changes_order on pos_tender_changes (order_id);
comment on table pos_tender_changes is
  'A paid restaurant bill''s payment mode changed before the night audit (D27-363): kept, never changed.';

alter table pos_tender_changes enable row level security;
alter table pos_tender_changes force row level security;
drop policy if exists hotel_isolation on pos_tender_changes;
create policy hotel_isolation on pos_tender_changes
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert on pos_tender_changes to pms_app;
revoke update, delete on pos_tender_changes from pms_app;

-- The change is an update of the tender's method in place.
grant update (method, tendered) on pos_order_tenders to pms_app;

-- ── A waiter's request to the GM ───────────────────────────────────────────
create table if not exists pos_requests (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  order_id      uuid not null references pos_orders(id) on delete cascade,
  -- The dish, for a strike; null for the bill's own acts.
  line_id       bigint,
  kind          text not null check (kind in ('strike_line', 'discount', 'no_charge', 'void_bill')),
  -- What exactly: a discount's type and value, a void's refund reference.
  details       jsonb not null default '{}',
  -- What the GM reads: "Strike 1 x Paneer Tikka - Table 4, bill ...-0012".
  summary       text not null,
  reason        text not null check (length(btrim(reason)) between 1 and 300),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  approval_id   uuid references approvals(id),
  requested_by  uuid not null references staff(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references staff(id),
  decided_at    timestamptz,
  decision_note text,
  constraint pos_requests_line check ((kind = 'strike_line') = (line_id is not null)),
  constraint pos_requests_not_own check (decided_by is null or decided_by <> requested_by)
);
create index if not exists pos_requests_order on pos_requests (order_id);
create index if not exists pos_requests_pending on pos_requests (hotel_id) where status = 'pending';
comment on table pos_requests is
  'A waiter''s or cashier''s request to the GM (D27-363): strike a sent dish, a discount, NC, void a paid bill. '
  'Approved in the Approvals inbox, which does it.';

alter table pos_requests enable row level security;
alter table pos_requests force row level security;
drop policy if exists hotel_isolation on pos_requests;
create policy hotel_isolation on pos_requests
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update on pos_requests to pms_app;
revoke delete on pos_requests from pms_app;

-- The till hears a request sent, approved or rejected, as it hears an order move.
drop trigger if exists pos_requests_changed on pos_requests;
create trigger pos_requests_changed
  after insert or update on pos_requests
  for each row execute function app.pos_changed();

-- The approvals inbox learns the kind (096's list, with pos_request), guarded
-- as 095 and 096 are: only when the list does not know it yet (MEMORY 284).
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'approval_rules_kind_known'
                    and pg_get_constraintdef(oid) like '%pos_request%') then
    alter table approval_rules drop constraint if exists approval_rules_kind_known;
    alter table approval_rules add constraint approval_rules_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment',
               'equipment_issue', 'equipment_retire', 'pos_request'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'approvals_kind_known'
                    and pg_get_constraintdef(oid) like '%pos_request%') then
    alter table approvals drop constraint if exists approvals_kind_known;
    alter table approvals add constraint approvals_kind_known check (
      kind in ('purchase', 'cash_expense', 'stock_adjustment',
               'equipment_issue', 'equipment_retire', 'pos_request'));
  end if;
end $$;

-- The GM decides; the owner and an Admin too (D27-363).
insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'pos_request', 'gm', null, array['owner', 'admin']
  from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

create or replace function app.pos_request_rule_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'pos_request', 'gm', null, array['owner', 'admin'])
  on conflict (hotel_id, kind, approver_role) do nothing;
  return new;
end $fn$;
revoke all on function app.pos_request_rule_for_new_property() from public;

drop trigger if exists hotels_pos_request_rule on hotels;
create trigger hotels_pos_request_rule
  after insert on hotels
  for each row execute function app.pos_request_rule_for_new_property();

-- ── A test hotel's classes: 235's list, with the two new trading tables ────
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
