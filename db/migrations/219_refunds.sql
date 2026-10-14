-- =============================================================================
-- 219 · A refund: money given back on a guest's own bill (the owner's
--       D27-315 Part B, 13 October)
-- =============================================================================
-- A bill paid more than it owes (an advance for nights not stayed) could not
-- be cleared: no refund existed, check-out refuses an overpaid bill, and
-- reversing the payment records no money going back. Now a refund is its own
-- line on the bill:
--
--   * a `refund` posting, POSITIVE: money out brings an overpaid (negative)
--     balance back up to ₹0. One sign, everywhere: a refund is never a charge
--     and never revenue; every report counts it with the payments, as money
--     paid back (the category exists since 006 and nothing posted it);
--   * its `refunds` row: the way it went back, a reference (the UPI ref, the
--     card approval, the cheque or transfer number), the reason and who;
--   * only the owner, an administrator, the GM or the accountant ('finance')
--     may record one - the four who may reverse a payment (D27-125) - and the
--     database refuses anyone else, whatever the server does;
--   * only on a guest's own bill: never a group's master bill, never a bill
--     addressed to a company; never more than the bill's credit;
--   * cash only below ₹20,000 (until the CA confirms the limit; a transfer
--     above), and a cash refund comes out of the drawer of whoever paid it.
--
-- Which way a refund may go (back by the way paid, never cash for card or
-- UPI) depends on the bill's payments and is the server's (finance/refunds).
-- Re-runnable.
-- =============================================================================

create table if not exists refunds (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  posting_id   bigint not null unique references folio_postings(id),
  method       text not null,
  method_label text not null,
  amount       numeric(12,2) not null,
  reference    text,
  reason       text not null,
  refunded_by  uuid not null references staff(id) default app.current_user_id(),
  created_at   timestamptz not null default now(),

  constraint refunds_method_known check (method in
    ('cash','card','upi','netbanking','wallet','cheque','bank_transfer')),
  constraint refunds_positive check (amount > 0),
  constraint refunds_reason_present check (length(btrim(reason)) > 0),
  -- The money moved somewhere a person can look it up; cash has no number.
  constraint refunds_reference_present check (
    method = 'cash' or length(btrim(coalesce(reference, ''))) > 0),
  -- Until the CA confirms the limit (D27-315): cash below ₹20,000.
  constraint refunds_cash_ceiling check (method <> 'cash' or amount < 20000)
);

create index if not exists refunds_hotel_idx on refunds (hotel_id, created_at);

comment on table refunds is
  'Money given back on a guest''s own bill (D27-315 B): one row per refund '
  'posting - the way, the reference, the reason and who. Append-only.';

alter table refunds enable row level security;
alter table refunds force  row level security;
drop policy if exists hotel_isolation on refunds;
create policy hotel_isolation on refunds
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

revoke all on refunds from pms_app;
grant select, insert on refunds to pms_app;


-- ── Who may give money back ──────────────────────────────────────────────
create or replace function app.may_refund(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff s
     where s.id = app.current_user_id() and s.is_active and s.is_group_admin
  ) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id() and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm', 'finance')
  )
$$;

comment on function app.may_refund(uuid) is
  'The owner, an administrator, the GM or the accountant at this hotel, or a '
  'group administrator: the four who may reverse a payment (D27-125) and the '
  'only ones who may record a refund or take one back (D27-315 B).';

revoke all on function app.may_refund(uuid) from public;
grant execute on function app.may_refund(uuid) to pms_app;


-- ── A refund line: who, and on which bill ────────────────────────────────
-- Asked of the posting itself, and of its reversal too: taking a refund back
-- is the same four people's. A session with no person (a migration, the
-- superuser's own repair) is not asked.
create or replace function app.refund_posting_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare b record;
begin
  if new.category <> 'refund' then return new; end if;
  if app.current_user_id() is not null and not app.may_refund(new.hotel_id) then
    raise exception 'Refunds are for the owner, an administrator, the general manager or the accountant.'
      using errcode = '42501';
  end if;
  if new.reverses_id is not null then return new; end if;

  if not (new.amount > 0) then
    raise exception 'A refund is money given back: its amount is positive.' using errcode = '23514';
  end if;
  select f.reservation_id, f.group_id, f.bill_to, f.company_id into b
    from folios f where f.id = new.folio_id;
  if b.reservation_id is null or b.group_id is not null
     or b.bill_to = 'company' or b.company_id is not null then
    raise exception 'A refund is given only on a guest''s own bill.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists folio_postings_refund_guard on folio_postings;
create trigger folio_postings_refund_guard
  before insert on folio_postings
  for each row when (new.category = 'refund')
  execute function app.refund_posting_guard();


-- ── A refund row matches its line and leaves no bill owing ───────────────
create or replace function app.refund_row_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare p record; bal numeric;
begin
  select fp.hotel_id, fp.folio_id, fp.category, fp.amount, fp.reverses_id into p
    from folio_postings fp where fp.id = new.posting_id;
  if p is null or p.category <> 'refund' or p.reverses_id is not null
     or p.hotel_id <> new.hotel_id or p.amount <> new.amount then
    raise exception 'A refund''s row is its own refund line, for the same amount.' using errcode = '23514';
  end if;
  -- Never more than the bill's credit: after it the bill owes at most ₹0.
  select coalesce(sum(fp.amount + fp.tax_amount), 0) into bal
    from folio_postings fp
   where fp.folio_id = p.folio_id
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings r where r.reverses_id = fp.id);
  if bal > 0 then
    raise exception 'That is more than the bill''s credit.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists refunds_row_guard on refunds;
create trigger refunds_row_guard
  before insert on refunds
  for each row execute function app.refund_row_guard();


-- ── Every refund line has its row, by the end of the transaction ─────────
create or replace function app.refund_has_row()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from refunds where posting_id = new.id) then
    raise exception 'A refund line needs its way, reference and reason.' using errcode = '23514';
  end if;
  return null;
end $$;

drop trigger if exists folio_postings_refund_has_row on folio_postings;
create constraint trigger folio_postings_refund_has_row
  after insert on folio_postings
  deferrable initially deferred
  for each row when (new.category = 'refund' and new.reverses_id is null)
  execute function app.refund_has_row();


-- ── The drawer: cash given back leaves the drawer of whoever gave it ─────
create or replace function app.cashier_expected_cash(p_shift uuid)
returns numeric
language sql stable as $$
  with s as (select * from cashier_shifts where id = p_shift)
  select
    (select opening_cash from s)
    + coalesce((
        select sum(-fp.amount + p.round_off)
          from folio_postings fp
          join payments p on p.posting_id = fp.id
          cross join s
         where fp.hotel_id = s.hotel_id
           and fp.category = 'payment'
           and p.method = 'cash'
           and fp.posted_by = s.staff_id
           and fp.created_at >= s.opened_at
           and fp.created_at < coalesce(s.closed_at, now())
           and fp.reverses_id is null
           and not exists (
             select 1 from folio_postings rev where rev.reverses_id = fp.id)
      ), 0)
    - coalesce((
        select sum(fp.amount)
          from folio_postings fp
          join refunds rf on rf.posting_id = fp.id
          cross join s
         where fp.hotel_id = s.hotel_id
           and fp.category = 'refund'
           and rf.method = 'cash'
           and fp.posted_by = s.staff_id
           and fp.created_at >= s.opened_at
           and fp.created_at < coalesce(s.closed_at, now())
           and not exists (
             select 1 from folio_postings rev where rev.reverses_id = fp.id)
      ), 0)
    + coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift and m.kind = 'top_up'), 0)
    - coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift
                   and (m.kind = 'withdrawal'
                        or (m.kind = 'expense'
                            and app.cash_expense_counts('cashier_movements', m.id)))), 0)
$$;


-- ── The bill, the guest's spend and the voucher: a refund is money out ───
-- Copied from their latest versions (122, 175, 169) with ONE change each: a
-- refund is never a charge, and what was paid is net of what was given back.
-- Their grants and comments stand (create or replace keeps them).
create or replace function app.stay_charged(p_reservation uuid)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(fp.amount + fp.tax_amount), 0)
    from folio_postings fp
    join folios f on f.id = fp.folio_id
   where f.reservation_id = p_reservation
     and fp.category not in ('payment', 'refund')
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
$$;

create or replace function app.stay_bill(p_reservation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  with stay as (
    select r.id, r.hotel_id, r.reference, r.check_in, r.check_out,
           g.full_name as guest
      from reservations r
      join guests g on g.id = r.guest_id
     where r.id = p_reservation_id
  ),
  live as (
    select fp.id, fp.business_date, fp.category, fp.description,
           fp.amount, coalesce(fp.tax_amount, 0) as tax_amount, fp.tax_rate,
           fp.tax_scheme, f.bill_to, co.name as company, f.opened_at,
           -- Where the line came from, through a correction to its origin
           -- (134, 139): an early or late fee is the room's (D27-223).
           case when fp.source_type = 'correction'
                then (select c.origin from closed_day_corrections c where c.id = fp.source_id)
                else fp.source_type end as source
      from folio_postings fp
      join folios f on f.id = fp.folio_id
      left join companies co on co.id = f.company_id
      join stay s on s.id = f.reservation_id
     where fp.reverses_id is null
       and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
  ),
  charges as (select * from live where category not in ('payment', 'refund')),
  totals as (
    select coalesce(sum(amount), 0)                      as net,
           coalesce(sum(tax_amount), 0)                  as tax
      from charges
  ),
  paid as (
    -- Net of refunds: money given back is money out (219, D27-315 B).
    select coalesce(-sum(amount), 0) as paid from live where category in ('payment', 'refund')
  ),
  by_rate as (
    -- CGST and SGST are each HALF of the line's own rate, and of its tax.
    select tax_scheme, tax_rate as rate,
           sum(amount)     as taxable,
           sum(tax_amount) as tax
      from charges
     where tax_amount <> 0 and tax_rate is not null
     group by tax_scheme, tax_rate
  )
  select case when not exists (select 1 from stay) then null else jsonb_build_object(
    'hotel', (select jsonb_build_object(
                'name', h.name, 'address', h.address_line, 'city', h.city,
                'state', h.state, 'phone', h.phone, 'gstin', h.gstin)
                from hotels h join stay s on s.hotel_id = h.id),
    'stay', (select jsonb_build_object(
                'reference', s.reference, 'guest', s.guest,
                'checkIn', s.check_in::text, 'checkOut', s.check_out::text,
                'room', app.stay_room(s.id))
                from stay s),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                'date', c.business_date::text, 'description', c.description,
                'category', c.category, 'amount', c.amount, 'tax', c.tax_amount,
                'rate', c.tax_rate, 'scheme', c.tax_scheme, 'source', c.source,
                'billTo', c.bill_to, 'company', c.company)
                order by c.opened_at, c.business_date, c.id)
                from charges c), '[]'::jsonb),
    'taxes', coalesce((select jsonb_agg(jsonb_build_object(
                'rate', b.rate, 'taxable', b.taxable,
                'cgst', round(b.tax / 2, 2), 'sgst', b.tax - round(b.tax / 2, 2))
                order by b.rate)
                from by_rate b where b.tax_scheme = 'gst'), '[]'::jsonb),
    -- VAT (D21-91): one line per rate, never halved.
    'vat', coalesce((select jsonb_agg(jsonb_build_object(
                'rate', b.rate, 'taxable', b.taxable, 'vat', b.tax)
                order by b.rate)
                from by_rate b where b.tax_scheme = 'vat'), '[]'::jsonb),
    'net',      (select net from totals),
    'tax',      (select tax from totals),
    'total',    (select net + tax from totals),
    'rounded',  (select round(net + tax, 0) from totals),
    'roundOff', (select round(net + tax, 0) - (net + tax) from totals),
    'paid',     (select paid from paid),
    'balance',  (select (select net + tax from totals) - (select paid from paid))
  ) end;
$fn$;

create or replace function app.guest_voucher(p_reservation uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with l as (
    select r.* from reservations r where r.id = p_reservation and r.status = 'confirmed'
  ),
  made as (
    -- Who made the booking: the audit's own record of the row being made (016).
    -- reservations.created_by is never written, so this is the record there is.
    select a.actor
      from audit_log a
     where a.table_name = 'reservations' and a.row_id = p_reservation::text
       and a.action = 'INSERT'
     order by a.at
     limit 1
  ),
  confirmed as (
    -- Who made it confirmed, and when: the audit's own record of the change
    -- (a booking made confirmed, or confirmed after waiting for the hotel).
    select a.actor, a.at
      from audit_log a
     where a.table_name = 'reservations' and a.row_id = p_reservation::text
       and a.after->>'status' = 'confirmed'
       and coalesce(a.before->>'status', '') <> 'confirmed'
     order by a.at desc
     limit 1
  )
  select jsonb_build_object(
    'reference', l.reference,
    'bookedOn', (l.created_at at time zone h.timezone)::date,
    'checkIn', l.check_in,
    'checkOut', l.check_out,
    'nights', l.check_out - l.check_in,
    'hotel', jsonb_build_object(
      'name', h.name, 'address', h.address_line, 'city', h.city, 'state', h.state,
      'phone', h.phone, 'email', h.email, 'gstin', h.gstin,
      'checkInTime', to_char(h.check_in_time, 'HH24:MI'),
      'checkOutTime', to_char(h.check_out_time, 'HH24:MI')),
    'groupName', (select gs.name from group_settings gs),
    -- A PNG only: the PDF draws PNG, and an SVG logo prints the name instead.
    'logoPng', coalesce(
                 (select encode(hl.logo, 'base64') from hotel_logos hl
                   where hl.hotel_id = l.hotel_id and hl.logo_type = 'image/png'),
                 (select encode(gs.logo, 'base64') from group_settings gs
                   where gs.logo_type = 'image/png')),
    'guest', (select jsonb_build_object('name', g.full_name, 'email', g.email, 'phone', g.phone)
                from guests g where g.id = l.guest_id),
    'company', (select c.name from companies c where c.id = l.company_id),
    'rooms', (
      select jsonb_agg(jsonb_build_object(
               'roomType', rt.name,
               -- The code with its words, as every screen says it (D27-164),
               -- from the one list the database keeps (inventory's pricing.ts
               -- reads it the same way); the bare code where it has no row.
               'mealPlan', coalesce((select mp.code || ' · ' || mp.includes
                                       from meal_plans mp where mp.code = r.meal_plan),
                                    r.meal_plan),
               'adults', r.adults, 'children', r.children,
               'nights', r.check_out - r.check_in,
               'rate', r.agreed_rate,
               'complimentary', r.is_complimentary,
               -- added by 169: the guests past what the room's price covers, by the
               -- tariff's own count (app.tariff_for, 162) - never a second rule here.
               'extraAdults', (select t.extra_adults from app.tariff_for(
                                  r.room_type_id, coalesce(r.meal_plan, 'EP'), r.check_in,
                                  r.adults::int, r.children::int) t),
               'extraChildren', (select t.extra_children from app.tariff_for(
                                  r.room_type_id, coalesce(r.meal_plan, 'EP'), r.check_in,
                                  r.adults::int, r.children::int) t),
               'gstRate', case when r.is_complimentary then null
                               else app.gst_rate_or_null(r.hotel_id, 'room', r.agreed_rate) end)
             order by r.created_at, r.reference)
        from reservations r
        join room_types rt on rt.id = r.room_type_id
       where coalesce(r.group_id, r.id) = coalesce(l.group_id, l.id)
         and r.status in ('confirmed', 'checked_in')),
    'terms', jsonb_build_object(
      'name', l.cancel_terms, 'freeUntilHours', l.cancel_free_until_hours,
      'cancelBasis', l.cancel_basis, 'cancelPercent', l.cancel_percent,
      'cancelAmount', l.cancel_amount, 'noShowBasis', l.no_show_basis,
      'noShowPercent', l.no_show_percent, 'noShowAmount', l.no_show_amount),
    -- ---- added by 169 (D27-215); every key above and below is as 168 has it ----
    'contact', h.reservations_contact,
    -- A person's name. A booking a machine made - the channel manager's or the
    -- CRS's own account - says where it came from. Nothing where no record is kept.
    'bookedBy', (select case
                          when m.actor in (select ch.run_as from channel_hotels ch where ch.run_as is not null
                                           union all
                                           select cr.run_as from crs_hotels cr where cr.run_as is not null)
                            then (select bs.name from booking_sources bs where bs.id = l.booking_source_id)
                          else (select s.full_name from staff s where s.id = m.actor)
                        end
                   from made m),
    -- What the booking's bills have RECEIVED, by the bill's own definition of
    -- "paid" (finance/folios.ts): payments, leaving out a reversed payment and
    -- its reversal - on the folios of every standing room of the group, and on
    -- the group's own folio. Read here, with the rest, so the voucher's figures
    -- are one read; and whom the lead's bill is made out to.
    'payment', jsonb_build_object(
      'received', (select coalesce(-sum(fp.amount), 0)
                     from folio_postings fp
                     join folios f on f.id = fp.folio_id
                    where fp.category in ('payment', 'refund')
                      and fp.reverses_id is null
                      and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
                      and (f.reservation_id in (
                             select r.id from reservations r
                              where coalesce(r.group_id, r.id) = coalesce(l.group_id, l.id)
                                and r.status in ('confirmed', 'checked_in'))
                           or (l.group_id is not null and f.group_id = l.group_id))),
      'billTo', (select f.bill_to from folios f
                  where f.reservation_id = l.id order by f.opened_at limit 1)),
    -- The hotel's bank details, or null: the voucher leaves the block out.
    'bank', (select jsonb_build_object(
                      'accountName', b.account_name, 'accountNumber', b.account_number,
                      'bankName', b.bank_name, 'branch', b.branch, 'ifsc', b.ifsc, 'upi', b.upi_id)
               from hotel_bank_details b where b.hotel_id = l.hotel_id),
    -- The group's office details, for the footer; each null until typed.
    'group', (select jsonb_build_object(
                       'name', gs.name, 'address', gs.office_address, 'phone', gs.phone,
                       'email', gs.email, 'website', gs.website, 'gstin', gs.gstin,
                       'instagram', gs.instagram)
                from group_settings gs),
    'housePolicies', to_jsonb(h.house_policies),
    'confirmedBy', (select s.full_name from confirmed c join staff s on s.id = c.actor),
    'confirmedAt', (select to_char(c.at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI')
                      from confirmed c)
  )
  from l join hotels h on h.id = l.hotel_id;
$fn$;


-- ── A test hotel's classes: refunds are trading, as payments are ─────────
-- 215's list, copied with one change: ('refunds', 'trading'). A table in no
-- class is refused by db/tests/modules/test-hotels.sql (D27-320).
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
