-- =============================================================================
-- 275 · Housekeeping checklists (D27-383 item 10, built under D27-396)
-- =============================================================================
-- Refer to this file by what it does, "housekeeping checklists" - the master
-- renumbers it.
--
--   * hotels.checklists_required: a room is marked clean or inspected only by
--     ticking its checklist. OFF by default, so today's flow does not change
--     until a hotel turns it on (D27-396). Owner, administrator or GM
--     (app.manages_hotel, as every hotel setting).
--   * hk_checklists: per hotel, a list of items for one job - checkout clean,
--     stay-over, deep clean, inspection - for one room type, or for every room
--     type that has none of its own (room_type_id NULL).
--   * hk_checklist_runs: one ticking of a checklist in one room: who, when,
--     each item as it read then, ticked or failed with a note. Written once,
--     never changed. A cleaning job's run is always passed (a room is clean
--     only when every item is ticked); an inspection may fail items, and the
--     room goes back to Needs cleaning.
--
-- Also: both of the test hotel's lists (255's, with the minibar's two tables
-- and these two added) - the classes, and the full reset's steps.
--
-- Re-runnable: replayed on every deploy.
-- =============================================================================

alter table hotels add column if not exists checklists_required boolean not null default false;
comment on column hotels.checklists_required is
  'D27-383 item 10: a room is marked clean or inspected only by ticking its checklist. '
  'Off by default (D27-396).';
grant update (checklists_required) on hotels to pms_app;

create table if not exists hk_checklists (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  job          text not null,
  -- NULL: every room type that has no list of its own for this job.
  room_type_id uuid,
  items        text[] not null,
  updated_by   uuid references staff(id),
  updated_at   timestamptz not null default now(),
  constraint hk_checklists_job_known
    check (job in ('checkout', 'stayover', 'deep', 'inspection')),
  constraint hk_checklists_type_here
    foreign key (hotel_id, room_type_id) references room_types (hotel_id, id) on delete cascade,
  constraint hk_checklists_items_sane
    check (cardinality(items) between 1 and 60 and array_position(items, null) is null)
);

create unique index if not exists hk_checklists_one_per_job
  on hk_checklists (hotel_id, job, coalesce(room_type_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table hk_checklists is
  'A housekeeping checklist (D27-383 item 10): the items of one job for one room type, '
  'or for every room type without its own (room_type_id NULL).';

create table if not exists hk_checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_id       uuid not null,
  job           text not null,
  business_date date not null,
  -- [{item, ok, note}] in the checklist's order, as the items read then.
  results       jsonb not null,
  passed        boolean not null,
  done_by       uuid not null references staff(id),
  done_at       timestamptz not null default now(),
  constraint hk_checklist_runs_room_here
    foreign key (hotel_id, room_id) references rooms (hotel_id, id),
  constraint hk_checklist_runs_job_known
    check (job in ('checkout', 'stayover', 'deep', 'inspection')),
  constraint hk_checklist_runs_results_present
    check (jsonb_typeof(results) = 'array' and jsonb_array_length(results) > 0),
  -- Passed is every item ticked; a cleaning job is never failed, only finished.
  constraint hk_checklist_runs_passed_true
    check (passed = not jsonb_path_exists(results, '$[*] ? (@.ok == false)')),
  constraint hk_checklist_runs_cleaning_passes
    check (job = 'inspection' or passed)
);

create index if not exists hk_checklist_runs_room
  on hk_checklist_runs (hotel_id, room_id, done_at desc);

comment on table hk_checklist_runs is
  'One ticking of a checklist in one room (D27-383 item 10): who, when, each item ticked '
  'or failed with a note. Written once.';

drop trigger if exists hk_checklist_runs_done_by_scope on hk_checklist_runs;
create trigger hk_checklist_runs_done_by_scope
  before insert on hk_checklist_runs
  for each row execute function app.assert_staff_has_hotel('done_by');

alter table hk_checklists enable row level security;
alter table hk_checklists force  row level security;
drop policy if exists hotel_isolation on hk_checklists;
create policy hotel_isolation on hk_checklists
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table hk_checklist_runs enable row level security;
alter table hk_checklist_runs force  row level security;
drop policy if exists hotel_isolation on hk_checklist_runs;
create policy hotel_isolation on hk_checklist_runs
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- A list is the hotel's to change or remove (a run keeps its own words);
-- a run is written once. REVOKED: 010's default privileges grant DELETE.
revoke all on hk_checklists from pms_app;
grant select, insert, update, delete on hk_checklists to pms_app;
revoke all on hk_checklist_runs from pms_app;
grant select, insert on hk_checklist_runs to pms_app;


-- =============================================================================
-- The test hotel's classes and the full reset's steps
-- =============================================================================
-- Both lists as 255 left them, with minibar_items and hk_checklists: setup;
-- minibar_records and hk_checklist_runs: trading, cleared before reservations.
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
  ('tally_ledger_names', 'setup'),
  ('stock_levels', 'setup'), ('suppliers', 'setup'),
  ('equipment_categories', 'setup'), ('laundry_price_items', 'setup'),
  ('spa_therapists', 'setup'), ('spa_treatments', 'setup'), ('banquet_venues', 'setup'),
  ('banquet_packages', 'setup'), ('approval_rules', 'setup'),
  ('purchase_requesters', 'setup'), ('review_links', 'setup'),
  ('minibar_items', 'setup'), ('hk_checklists', 'setup'),
  -- trading ----------------------------------------------------------------
  ('reservations', 'trading'), ('reservation_inclusions', 'trading'),
  ('stay_companions', 'trading'),
  ('room_assignments', 'trading'), ('room_blocks', 'trading'),
  ('room_status_log', 'trading'), ('housekeeping_assignments', 'trading'),
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'), ('refunds', 'trading'),
  ('invoices', 'trading'), ('vat_bills', 'trading'), ('closed_day_corrections', 'trading'),
  ('night_audit_runs', 'trading'), ('night_audit_undos', 'trading'), ('form_c_filings', 'trading'),
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
  ('minibar_records', 'trading'), ('hk_checklist_runs', 'trading'),
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

create or replace function owner_reset.steps(p_fresh boolean)
returns table (step int, table_name text, where_sql text)
language sql
immutable
as $fn$
  select s.step::int, s.e ->> 0, s.e ->> 1
    from (
      select e, o as step from jsonb_array_elements($list$[
        ["minibar_records",           "hotel_id = $1"],
        ["hk_checklist_runs",         "hotel_id = $1"],
        ["vat_bills",                 "hotel_id = $1"],
        ["guest_food_orders",         "hotel_id = $1"],
        ["pos_order_tenders",         "order_id in (select id from pos_orders where hotel_id = $1)"],
        ["pos_order_lines",           "hotel_id = $1"],
        ["pos_tender_changes",        "hotel_id = $1"],
        ["pos_requests",              "hotel_id = $1"],
        ["pos_orders",                "hotel_id = $1"],
        ["pos_tickets",               "hotel_id = $1"],
        ["pos_cash_movements",        "hotel_id = $1"],
        ["pos_denominations",         "day_end_id in (select id from pos_day_ends where hotel_id = $1)"],
        ["pos_day_ends",              "hotel_id = $1"],
        ["banquet_event_packages",    "hotel_id = $1"],
        ["cashier_float_claims",      "closed_shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_denominations",     "shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_movements",         "hotel_id = $1"],
        ["cashier_shifts",            "hotel_id = $1"],
        ["cash_deposit_notes",        "hotel_id = $1"],
        ["cash_deposits",             "hotel_id = $1"],
        ["company_payments",          "hotel_id = $1"],
        ["spa_appointments",          "hotel_id = $1"],
        ["laundry_dockets",           "hotel_id = $1"],
        ["table_bookings",            "hotel_id = $1"],
        ["guest_id_photo_views",      "hotel_id = $1"],
        ["guest_id_photos",           "hotel_id = $1"],
        ["guest_digilocker_attempts", "hotel_id = $1"],
        ["guest_links",               "hotel_id = $1"],
        ["form_c_filings",            "hotel_id = $1"],
        ["form_iii_stays",            "hotel_id = $1"],
        ["stay_companions",           "hotel_id = $1"],
        ["closed_day_corrections",    "hotel_id = $1"],
        ["invoices",                  "hotel_id = $1"],
        ["refunds",                   "hotel_id = $1"],
        ["payments",                  "hotel_id = $1"],
        ["loyalty_points",            "hotel_id = $1"],
        ["folio_postings",            "hotel_id = $1"],
        ["folios",                    "hotel_id = $1"],
        ["guest_documents",           "guest_id in (select guest_id from reservations where hotel_id = $1) and not exists (select 1 from reservations r where r.guest_id = guest_documents.guest_id and r.hotel_id <> $1) and not exists (select 1 from stay_companions c where c.guest_id = guest_documents.guest_id and c.hotel_id <> $1)"],
        ["housekeeping_assignments",  "hotel_id = $1"],
        ["room_assignments",          "hotel_id = $1"],
        ["room_status_log",           "hotel_id = $1"],
        ["work_order_costs",          "hotel_id = $1"],
        ["work_orders",               "hotel_id = $1"],
        ["wake_up_calls",             "hotel_id = $1"],
        ["lost_items",                "hotel_id = $1"],
        ["room_blocks",               "hotel_id = $1"],
        ["banquet_events",            "hotel_id = $1"],
        ["reservations",              "hotel_id = $1"],
        ["reservation_groups",        "(lead_hotel_id is null or lead_hotel_id = $1) and not exists (select 1 from reservations r where r.group_id = reservation_groups.id and r.hotel_id <> $1) and not exists (select 1 from folios f where f.group_id = reservation_groups.id and f.hotel_id <> $1)"],
        ["night_audit_undos",         "hotel_id = $1"],
        ["night_audit_runs",          "hotel_id = $1"],
        ["bar_request_lines",         "hotel_id = $1"],
        ["bar_requests",              "hotel_id = $1"],
        ["bar_closed_days",           "hotel_id = $1"],
        ["supplier_reversals",        "hotel_id = $1"],
        ["supplier_payments",         "hotel_id = $1"],
        ["supplier_credit_notes",     "hotel_id = $1"],
        ["supplier_bills",            "hotel_id = $1"],
        ["bar_purchase_lines",        "hotel_id = $1"],
        ["stock_count_lines",         "hotel_id = $1"],
        ["stock_movements",           "hotel_id = $1"],
        ["bar_purchases",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
      union all
      select e, 1000 + o from jsonb_array_elements($list$[
        ["equipment_moves",           "hotel_id = $1"],
        ["equipment_history",         "hotel_id = $1"],
        ["purchase_request_lines",    "hotel_id = $1"],
        ["purchase_requests",         "hotel_id = $1"],
        ["approvals",                 "hotel_id = $1"],
        ["crs_bookings",              "hotel_id = $1"],
        ["channel_bookings",          "hotel_id = $1"],
        ["messages_sent",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
       where p_fresh
    ) s
   order by s.step
$fn$;
