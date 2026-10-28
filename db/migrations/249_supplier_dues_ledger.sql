-- =============================================================================
-- 249 · Supplier dues, the owner's follow-ups (D27-372, 28 October)
-- =============================================================================
-- 246 kept one payment on the bill's own row, paying it whole. The owner chose:
--
--   * PART PAYMENTS: any amount up to what is left, each its own row - date,
--     method, reference (required unless cash), who recorded it and who HANDED
--     OVER the money (a typed name). `supplier_payments`.
--   * TDS on a payment, entered by the Accountant: section (194C, 194Q, 194J,
--     194I), rate and amount, all three or none. The supplier is paid the
--     rest; paid + TDS settles the bill. The PMS works out nothing.
--   * CREDIT NOTES, money only: the supplier's or ours, against the supplier
--     or one bill. `supplier_credit_notes`. No stock moves here.
--   * A mistake is REVERSED, with a reason, never edited or deleted:
--     `supplier_reversals`, one row per bill, payment or credit note reversed.
--     A wrong bill may be followed by its correct one (`replaces_id`).
--   * A bar bill's supplier comes from the supplier list: bar_purchases.supplier_id.
--     Old bar bills keep their typed name.
--
-- Payments already recorded on a bill row (246's paid_* columns) are copied
-- into supplier_payments once, at the bill's whole amount; the columns stay
-- (246 replays and names them) but nothing writes or reads them from here on.
--
-- Money rows are written once: the app may insert and read, never update or
-- delete. Re-runnable: replayed on every deploy; constraints added once.
-- =============================================================================

-- 246's "paid once" trigger refuses ANY update of a paid bill, the backfill
-- below included; payments are no longer on the bill row, so it goes. (246
-- recreates it on a replay; this drops it again before the updates.)
drop trigger if exists supplier_bills_paid_once on supplier_bills;

-- ── The supplier, from the list ──────────────────────────────────────────────
alter table supplier_bills add column if not exists supplier_id uuid references suppliers(id);
alter table supplier_bills add column if not exists replaces_id uuid references supplier_bills(id);
alter table bar_purchases  add column if not exists supplier_id uuid references suppliers(id);

comment on column supplier_bills.supplier_id is
  'The supplier on the list (D27-372). Null only for a bill recorded before 249 whose typed name matched none.';
comment on column supplier_bills.replaces_id is
  'The reversed bill this one corrects (D27-372): the same delivery or bar bill, its right figures.';
comment on column bar_purchases.supplier_id is
  'The supplier picked from the list (D27-372). Null on a bar bill recorded before 249: its name was typed.';

update supplier_bills b set supplier_id = r.supplier_id
  from purchase_requests r
 where r.id = b.purchase_request_id and b.supplier_id is null and r.supplier_id is not null;
update supplier_bills b set supplier_id = p.supplier_id
  from bar_purchases p
 where p.id = b.bar_purchase_id and b.supplier_id is null and p.supplier_id is not null;
-- A bar bill typed before 249: the supplier on the list with exactly that name.
update supplier_bills b set supplier_id = s.id
  from suppliers s
 where b.supplier_id is null and s.hotel_id = b.hotel_id
   and lower(btrim(s.name)) = lower(btrim(b.supplier));

-- One live bill per delivery or bar bill: the first is unique, and each bill
-- is corrected at most once (246's plain unique would stop the correction).
alter table supplier_bills drop constraint if exists supplier_bills_purchase_request_id_key;
alter table supplier_bills drop constraint if exists supplier_bills_bar_purchase_id_key;
create unique index if not exists supplier_bills_first_per_order
  on supplier_bills (purchase_request_id) where replaces_id is null;
create unique index if not exists supplier_bills_first_per_bar_bill
  on supplier_bills (bar_purchase_id) where replaces_id is null;
create unique index if not exists supplier_bills_corrected_once on supplier_bills (replaces_id);

-- ── Payments ─────────────────────────────────────────────────────────────────
create table if not exists supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  bill_id        uuid not null references supplier_bills(id),
  paid_on        date not null,
  method         text not null check (method in ('cash', 'cheque', 'bank', 'upi')),
  reference      text check (reference is null or length(btrim(reference)) between 1 and 80),
  -- Paid to the supplier. Never a default (no default prices).
  amount         numeric(12,2) not null check (amount > 0),
  -- Who handed over the money: a name, typed. Null only on a payment copied from 246.
  handed_over_by text check (handed_over_by is null or length(btrim(handed_over_by)) between 1 and 80),
  tds_section    text check (tds_section in ('194C', '194Q', '194J', '194I')),
  tds_rate       numeric(5,2) check (tds_rate > 0 and tds_rate <= 100),
  tds_amount     numeric(12,2) check (tds_amount > 0),
  recorded_by    uuid not null references staff(id),
  recorded_at    timestamptz not null default now()
);
create index if not exists supplier_payments_bill_idx on supplier_payments (bill_id);
create index if not exists supplier_payments_paid_idx on supplier_payments (hotel_id, paid_on);

-- 246's payments, once each, at the bill's amount: they paid it whole.
insert into supplier_payments (hotel_id, bill_id, paid_on, method, reference, amount, recorded_by, recorded_at)
select b.hotel_id, b.id, b.paid_on, b.paid_method, b.paid_reference, b.amount, b.paid_by, b.paid_at
  from supplier_bills b
 where b.paid_on is not null
   and not exists (select 1 from supplier_payments p where p.bill_id = b.id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_payments_tds_whole') then
    alter table supplier_payments add constraint supplier_payments_tds_whole
      check (num_nulls(tds_section, tds_rate, tds_amount) in (0, 3));
  end if;
  -- Cheque, bank and UPI carry their reference; cash needs none. NOT VALID: a
  -- payment copied from 246 may lack one, and is left as it was recorded.
  if not exists (select 1 from pg_constraint where conname = 'supplier_payments_reference_unless_cash') then
    alter table supplier_payments add constraint supplier_payments_reference_unless_cash
      check (method = 'cash' or reference is not null) not valid;
  end if;
end $$;

comment on table supplier_payments is
  'A payment against a supplier''s bill (D27-372): any part of what is left. amount went to the supplier; '
  'tds_amount was deducted; together they settle the bill. No cash drawer is touched.';

-- ── Credit notes ─────────────────────────────────────────────────────────────
create table if not exists supplier_credit_notes (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  supplier_id  uuid not null references suppliers(id),
  bill_id      uuid references supplier_bills(id),
  -- Whose note it is: the supplier's, or one the hotel raised.
  issued_by    text not null check (issued_by in ('supplier', 'hotel')),
  note_no      text not null check (length(btrim(note_no)) between 1 and 60),
  note_date    date not null,
  amount       numeric(12,2) not null check (amount > 0),
  reason       text not null check (length(btrim(reason)) between 1 and 200),
  recorded_by  uuid not null references staff(id),
  recorded_at  timestamptz not null default now()
);
create index if not exists supplier_credit_notes_supplier_idx on supplier_credit_notes (supplier_id);
create index if not exists supplier_credit_notes_bill_idx on supplier_credit_notes (bill_id) where bill_id is not null;

comment on table supplier_credit_notes is
  'A credit note, money only (D27-372): reduces what is owed to the supplier, or on one bill. '
  'Returned goods leave the store as a store movement, separately.';

-- ── Reversals ────────────────────────────────────────────────────────────────
create table if not exists supplier_reversals (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  bill_id         uuid unique references supplier_bills(id),
  payment_id      uuid unique references supplier_payments(id),
  credit_note_id  uuid unique references supplier_credit_notes(id),
  reason          text not null check (length(btrim(reason)) between 1 and 200),
  -- The property's calendar day it was reversed: the statement's date for it.
  reversed_on     date not null,
  reversed_by     uuid not null references staff(id),
  reversed_at     timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_reversals_one_thing') then
    alter table supplier_reversals add constraint supplier_reversals_one_thing
      check (num_nonnulls(bill_id, payment_id, credit_note_id) = 1);
  end if;
end $$;

comment on table supplier_reversals is
  'A wrong bill, payment or credit note reversed, with its reason (D27-372). Both rows stay; '
  'each is reversed once (unique).';

-- ── Isolation and grants: written once, read; never changed or deleted ───────
do $$
declare t text;
begin
  foreach t in array array['supplier_payments', 'supplier_credit_notes', 'supplier_reversals'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$create policy hotel_isolation on %I
      using (hotel_id in (select app.auth_hotel_ids()))
      with check (hotel_id in (select app.auth_hotel_ids()))$p$, t);
    execute format('revoke all on %I from pms_app', t);
    execute format('grant select, insert on %I to pms_app', t);
  end loop;
end $$;
-- The bill row's own payment columns are 246's: no longer written.
revoke update on supplier_bills from pms_app;

-- ── What is left on a bill, on a date (null: today) ──────────────────────────
-- Its amount, less the payments and TDS and the credit notes against it, each
-- dated by then and not reversed by then. A bill reversed by then owes nothing.
create or replace function app.supplier_bill_owed(p_bill uuid, p_on date default null)
returns numeric
language sql
stable
as $$
  select case
           when exists (select 1 from supplier_reversals r
                         where r.bill_id = b.id and (p_on is null or r.reversed_on <= p_on)) then 0::numeric
           else b.amount
             - coalesce((select sum(p.amount + coalesce(p.tds_amount, 0)) from supplier_payments p
                          where p.bill_id = b.id and (p_on is null or p.paid_on <= p_on)
                            and not exists (select 1 from supplier_reversals r where r.payment_id = p.id
                                             and (p_on is null or r.reversed_on <= p_on))), 0)
             - coalesce((select sum(n.amount) from supplier_credit_notes n
                          where n.bill_id = b.id and (p_on is null or n.note_date <= p_on)
                            and not exists (select 1 from supplier_reversals r where r.credit_note_id = n.id
                                             and (p_on is null or r.reversed_on <= p_on))), 0)
         end
    from supplier_bills b where b.id = p_bill
$$;
grant execute on function app.supplier_bill_owed(uuid, date) to pms_app;

-- ── A bill is never settled past its amount, nor paid once reversed ──────────
-- Asked under a lock on the bill, so two payments at once cannot both fit.
create or replace function app.supplier_bill_not_overpaid()
returns trigger
language plpgsql
as $$
declare v_more numeric;
begin
  if new.bill_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('supplier_bill:' || new.bill_id::text));
  if exists (select 1 from supplier_reversals where bill_id = new.bill_id) then
    raise exception 'This bill was reversed; nothing more is recorded against it.' using errcode = 'check_violation';
  end if;
  if tg_table_name = 'supplier_payments' then
    v_more := new.amount + coalesce(new.tds_amount, 0);
  else
    v_more := new.amount;
  end if;
  if v_more > app.supplier_bill_owed(new.bill_id) then
    raise exception 'More than is left on the bill.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists supplier_payments_not_overpaid on supplier_payments;
create trigger supplier_payments_not_overpaid before insert on supplier_payments
  for each row execute function app.supplier_bill_not_overpaid();
drop trigger if exists supplier_credit_notes_not_overpaid on supplier_credit_notes;
create trigger supplier_credit_notes_not_overpaid before insert on supplier_credit_notes
  for each row execute function app.supplier_bill_not_overpaid();

-- A bill is reversed only when nothing paid or credited against it still stands:
-- those are reversed first. Under the same lock as a payment.
create or replace function app.supplier_bill_reversible()
returns trigger
language plpgsql
as $$
begin
  if new.bill_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('supplier_bill:' || new.bill_id::text));
  if exists (select 1 from supplier_payments p where p.bill_id = new.bill_id
              and not exists (select 1 from supplier_reversals r where r.payment_id = p.id))
     or exists (select 1 from supplier_credit_notes n where n.bill_id = new.bill_id
              and not exists (select 1 from supplier_reversals r where r.credit_note_id = n.id)) then
    raise exception 'Reverse the payments and credit notes on this bill first.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists supplier_reversals_bill_clear on supplier_reversals;
create trigger supplier_reversals_bill_clear before insert on supplier_reversals
  for each row execute function app.supplier_bill_reversible();

-- ── A test hotel's classes: the three new tables are trading ─────────────────
-- 246's list, copied with supplier_payments, supplier_credit_notes and
-- supplier_reversals added (it carries 244's pos_table_moves and 246's
-- supplier_bills). ⚠ Migration 248 (another helper's) may also redefine this
-- function; whichever is merged, the LAST migration must carry every entry.
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
  ('purchase_request_lines', 'trading'), ('supplier_bills', 'trading'),
  ('supplier_payments', 'trading'), ('supplier_credit_notes', 'trading'),
  ('supplier_reversals', 'trading'), ('equipment_items', 'trading'),
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
