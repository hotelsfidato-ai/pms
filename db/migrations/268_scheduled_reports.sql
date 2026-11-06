-- =============================================================================
-- 268 · Scheduled reports: any report by email, daily, weekly or monthly
--       (the owner's D27-383 item 5, built under D27-396)
-- =============================================================================
-- Refer to it by what it does - "scheduled reports" - never by its number.
--
-- A list per hotel. Each row is one report, the period it covers (yesterday,
-- last week Monday to Sunday, last month, the month so far), how often (daily
-- after the night audit, weekly on a chosen day, monthly on a chosen date), the
-- file (PDF or Excel) and the addresses. It goes AFTER THAT DAY'S NIGHT AUDIT,
-- in the same sweep as the daily report emails ("daily report emails",
-- "corrected daily reports"): a day never closed sends nothing.
--
-- Which reports may be scheduled, and with which period, is the API's
-- (api/src/modules/reports/emails.ts): a key is a word, not a constraint.
-- Each send is one messages_sent row per address (kind 'report', about
-- 'report-schedule', '<schedule>/<business date>/<address>'), so a failed send
-- shows on Connection health as the daily ones do. The last send and its
-- result are kept on the row for the list.
--
-- Re-runnable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The schedules
-- -----------------------------------------------------------------------------
create table if not exists report_schedules (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  report        text not null,
  period        text not null,
  frequency     text not null,
  -- Weekly: ISO day of the week, 1 Monday to 7 Sunday. Monthly: 1 to 28, so
  -- every month has it. Each only with its own frequency.
  weekday       smallint,
  day_of_month  smallint,
  file_type     text not null,
  -- Typed, checked by the API (one address each, lower case, no repeats).
  addresses     text[] not null,
  is_paused     boolean not null default false,
  -- Who saved it last: the report is built as that person sees it while they
  -- still run the hotel (app.report_schedules_due), as the daily ones are.
  changed_by    uuid references staff(id),
  changed_at    timestamptz not null default now(),
  -- The last send and its result, written by the sweep. 'refused': nothing
  -- was sent that day and the reason says why (a day not yet closed, a file
  -- too large, the bar's reports switched off).
  last_date     date,
  last_status   text,
  last_detail   text,
  last_at       timestamptz,

  constraint report_schedules_period_known
    check (period in ('yesterday', 'last-week', 'last-month', 'month-to-date')),
  constraint report_schedules_when
    check ((frequency = 'daily' and weekday is null and day_of_month is null)
        or (frequency = 'weekly' and weekday between 1 and 7 and day_of_month is null)
        or (frequency = 'monthly' and day_of_month between 1 and 28 and weekday is null)),
  constraint report_schedules_file_known check (file_type in ('pdf', 'xlsx')),
  constraint report_schedules_some_addresses
    check (coalesce(array_length(addresses, 1), 0) between 1 and 20),
  constraint report_schedules_last_known check (last_status in ('sent', 'failed', 'refused'))
);

create index if not exists report_schedules_by_hotel on report_schedules (hotel_id);

comment on table report_schedules is
  'Reports emailed on a schedule after the night audit (D27-383 item 5): the report, '
  'its period, daily, weekly or monthly, the file and the addresses; the last send and '
  'its result.';

-- THE SHARED POLICY NAME. Read by the hotel's people (the addresses are offered
-- when a report is emailed by hand); written only by the people who set the
-- hotel up (owner, Administrator, GM, a group administrator), as the daily
-- report emails are.
alter table report_schedules enable row level security;
alter table report_schedules force  row level security;
drop policy if exists hotel_isolation on report_schedules;
create policy hotel_isolation on report_schedules
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( app.manages_hotel(hotel_id) );
-- A delete has no check of its own: taken off by the same people only.
drop policy if exists report_schedules_removed_by_managers on report_schedules;
create policy report_schedules_removed_by_managers on report_schedules as restrictive
  for delete using ( app.manages_hotel(hotel_id) );
revoke all on report_schedules from pms_app;
grant select, insert, update, delete on report_schedules to pms_app;

-- Audited when somebody changes what goes where; not when the sweep writes the
-- last send's result, which nobody chose.
drop trigger if exists report_schedules_audit on report_schedules;
create trigger report_schedules_audit
  after insert or delete or update of report, period, frequency, weekday, day_of_month,
                                      file_type, addresses, is_paused
  on report_schedules
  for each row execute function app.write_audit();

-- NOTHING LEAVES A TEST HOTEL (D27-296): it cannot have a schedule.
drop trigger if exists report_schedules_not_in_test_hotels on report_schedules;
create trigger report_schedules_not_in_test_hotels before insert or update on report_schedules
  for each row execute function app.refuse_in_test_hotel();


-- -----------------------------------------------------------------------------
-- 2 · What is due: each schedule, to each address, after the audit of its day
-- -----------------------------------------------------------------------------
-- Each night audit completed in the last two days; each schedule not paused,
-- saved before that audit completed, whose day it is (daily; weekly on its
-- weekday; monthly on its date - of the day the audit closed); each address
-- not sent yet for that schedule and day, under the tries; not a day the sweep
-- already refused. The period is worked out from the day closed by the API.
--
-- BUILT BY, as the daily ones: the person who saved it while they still run
-- the hotel, else whoever runs it now. A DEFINER: the sweep has nobody signed
-- in, and both tables are FORCE row-secured.
create or replace function app.report_schedules_due(p_most_attempts integer, p_hotel uuid default null)
returns table (
  schedule_id uuid, hotel_id uuid, hotel_code text, hotel_name text, timezone text,
  business_date text, report text, period text, frequency text, weekday smallint,
  day_of_month smallint, file_type text, address text, built_by uuid, about_id text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s.id, n.hotel_id, h.code, h.name, h.timezone, n.business_date::text,
         s.report, s.period, s.frequency, s.weekday, s.day_of_month, s.file_type,
         a.address, b.id, s.id::text || '/' || n.business_date::text || '/' || a.address
    from night_audit_runs n
    join hotels h            on h.id = n.hotel_id
    join report_schedules s  on s.hotel_id = n.hotel_id and not s.is_paused
                            and s.changed_at <= n.completed_at
    cross join lateral unnest(s.addresses) as a(address)
    join lateral (
      select p.id from staff p
       where p.is_active
         and (p.is_group_admin
              or exists (select 1 from staff_hotels sh
                          where sh.staff_id = p.id and sh.hotel_id = n.hotel_id
                            and sh.role in ('owner', 'gm', 'admin')))
       order by (p.id = s.changed_by) desc nulls last, p.id
       limit 1
    ) b on true
   where n.status = 'completed'
     and n.completed_at > now() - interval '2 days'
     and (p_hotel is null or n.hotel_id = p_hotel)
     and (s.frequency = 'daily'
          or (s.frequency = 'weekly' and extract(isodow from n.business_date) = s.weekday)
          or (s.frequency = 'monthly' and extract(day from n.business_date) = s.day_of_month))
     and not coalesce(s.last_status = 'refused' and s.last_date = n.business_date, false)
     and not exists (select 1 from messages_sent m
                      where m.hotel_id = n.hotel_id and m.about_kind = 'report-schedule'
                        and m.about_id = s.id::text || '/' || n.business_date::text || '/' || a.address
                        and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.hotel_id = n.hotel_id and m.about_kind = 'report-schedule'
             and m.about_id = s.id::text || '/' || n.business_date::text || '/' || a.address
             and m.status = 'failed') < p_most_attempts
   order by n.completed_at, s.id, a.address
$fn$;

comment on function app.report_schedules_due(integer, uuid) is
  'The scheduled report emails owed after each completed night audit (D27-383 item 5): '
  'each schedule not paused whose day it is, to each address, once per day closed.';

revoke all on function app.report_schedules_due(integer, uuid) from public;
grant execute on function app.report_schedules_due(integer, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 3 · The test hotel's classes: report_schedules is 'never'
-- -----------------------------------------------------------------------------
-- The list as "night audit guard and undo" left it, with report_schedules
-- beside daily_report_emails: a test hotel never copies another's schedules.
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
  -- never ------------------------------------------------------------------
  ('staff_hotels', 'never'), ('channel_hotels', 'never'), ('channel_room_types', 'never'),
  ('channel_rate_plans', 'never'), ('channel_ari_sent', 'never'),
  ('channel_ari_pushes', 'never'), ('channel_bookings', 'never'), ('crs_hotels', 'never'),
  ('crs_room_types', 'never'), ('crs_bookings', 'never'), ('market_rate_settings', 'never'),
  ('market_rates', 'never'), ('daily_report_emails', 'never'), ('report_schedules', 'never'),
  ('invoice_series', 'never'),
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
