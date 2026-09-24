-- =============================================================================
-- 135 · A separate VAT bill for alcohol (the owner's D22-44, 22 September)
-- =============================================================================
-- Written as 135; the master renumbers at merge. Refer to this file by what it
-- does - "a separate VAT bill for alcohol" - never by its number.
--
-- D22-44: alcohol gets its own VAT bill, issued at the same moment as the GST
-- document for the same sale - the restaurant's settlement, or the stay's tax
-- invoice for drinks put on the room bill; its own series per hotel restarting
-- each 1 April (VAT/5EL/2026-27/0001), never sharing numbers with GST
-- invoices; each document names the other; cancelled like a credit note, with
-- a reason.
--
-- THE GST INVOICE'S MECHANISM, NOT A SECOND ONE (011, 013, 016, 025): a series
-- row per hotel and financial year, consumed only by one security-definer
-- function; an issued bill is never changed (025's trigger); a cancellation is
-- its own numbered row, figures negated, with a reason, at most one per bill.
-- Its own tables because every reader of `invoices` means GST - the sales
-- register, the lodging tax report, the night audit - and a VAT row there
-- would be one missed filter from a GST return.
--
-- Replayed on every deploy: every statement is `if not exists`, guarded, or a
-- `create or replace` that keeps its signature (MEMORY 317).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The series: per hotel, per financial year
-- -----------------------------------------------------------------------------
create table if not exists vat_bill_series (
  hotel_id    uuid not null references hotels(id) on delete cascade,
  fin_year    text not null,                      -- '2026-27'
  prefix      text not null,                      -- 'VAT/5EL'
  next_number bigint not null default 1 check (next_number >= 1),
  primary key (hotel_id, fin_year)
);

-- As invoice_series (013): enabled, not forced, so the definer function below
-- is the only writer.
alter table vat_bill_series enable row level security;
drop policy if exists vat_series_read on vat_bill_series;
create policy vat_series_read on vat_bill_series
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
revoke insert, update, delete on vat_bill_series from pms_app;

drop trigger if exists vat_bill_series_audit on vat_bill_series;
create trigger vat_bill_series_audit after insert or update or delete on vat_bill_series
  for each row execute function app.write_audit();

-- app.next_invoice_number (011), with one difference: the year's row is opened
-- by the year's first bill, so the series restarts at 0001 on 1 April without
-- a deploy or a provisioning step. Four digits as the owner wrote it, and more
-- rather than fewer after 9999 (lpad would cut 10000 back to 1000).
create or replace function app.next_vat_bill_number(p_hotel_id uuid, p_fin_year text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_prefix text; v_num bigint;
begin
  insert into vat_bill_series (hotel_id, fin_year, prefix)
  select id, p_fin_year, 'VAT/' || code from hotels where id = p_hotel_id
  on conflict (hotel_id, fin_year) do nothing;

  update vat_bill_series
     set next_number = next_number + 1
   where hotel_id = p_hotel_id and fin_year = p_fin_year
  returning prefix, next_number - 1 into v_prefix, v_num;

  if v_num is null then
    raise exception 'No such hotel %', p_hotel_id;
  end if;

  return v_prefix || '/' || p_fin_year || '/'
      || lpad(v_num::text, greatest(4, length(v_num::text)), '0');
end
$$;


-- -----------------------------------------------------------------------------
-- 2 · The bills
-- -----------------------------------------------------------------------------
-- The sale is one of two: drinks on a room bill (folio_id, and invoice_id - the
-- GST tax invoice it was issued with), or a restaurant bill paid at the till
-- (pos_order_id). A cancellation names the bill it cancels instead.
create table if not exists vat_bills (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  fin_year       text not null,
  number         text not null,
  folio_id       uuid references folios(id),
  invoice_id     uuid references invoices(id),
  pos_order_id   uuid references pos_orders(id),
  recipient_name text,
  taxable_value  numeric(12,2) not null,
  vat_total      numeric(12,2) not null,
  total          numeric(12,2) not null,
  business_date  date not null,
  cancels_id     uuid references vat_bills(id),
  reason         text,
  issued_at      timestamptz not null default now(),
  issued_by      uuid references staff(id),
  unique (hotel_id, fin_year, number),
  -- A cancellation says why, and only a cancellation has a reason.
  constraint vat_bills_cancel_has_reason
    check ((cancels_id is null) = (nullif(btrim(reason), '') is null))
);

create unique index if not exists vat_bills_one_cancellation
  on vat_bills (cancels_id) where cancels_id is not null;
create index if not exists vat_bills_hotel_idx on vat_bills (hotel_id, issued_at desc);

-- Never changed, never deleted: 025's trigger, whose words fit a VAT bill too.
drop trigger if exists vat_bills_immutable on vat_bills;
create trigger vat_bills_immutable
  before update or delete on vat_bills
  for each row execute function app.reject_invoice_change();

alter table vat_bills enable row level security;
alter table vat_bills force row level security;
drop policy if exists vat_bills_scope on vat_bills;
create policy vat_bills_scope on vat_bills
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists vat_bills_issue on vat_bills;
create policy vat_bills_issue on vat_bills
  for insert with check ( hotel_id in (select app.auth_hotel_ids()) );
revoke update, delete on vat_bills from pms_app;


-- -----------------------------------------------------------------------------
-- 3 · Issuing one, beside the GST document
-- -----------------------------------------------------------------------------
-- Called in the same transaction as the GST tax invoice (p_invoice) or the
-- restaurant's settlement (p_order), so both documents exist or neither does.
-- The figures come from what was charged, never recomputed: the folio's live
-- VAT postings, or the order's VAT group after its share of any discount
-- (app.pos_order_by_tax). Answers the number, or null when the sale carries no
-- VAT - and on a folio that already has a live VAT bill, so an invoice issued
-- again after a credit note does not bill the same drinks twice.
create or replace function app.issue_vat_bill(p_invoice uuid, p_order uuid)
returns text
language plpgsql
as $$
declare
  v_hotel uuid; v_folio uuid; v_to text;
  v_taxable numeric; v_vat numeric; v_year text; v_num text;
begin
  if p_invoice is not null then
    select hotel_id, folio_id, recipient_name into v_hotel, v_folio, v_to
      from invoices where id = p_invoice;
    if exists (select 1 from vat_bills v
                where v.folio_id = v_folio
                  and not exists (select 1 from vat_bills c where c.cancels_id = v.id)) then
      return null;
    end if;
    select coalesce(sum(fp.amount), 0), coalesce(sum(fp.tax_amount), 0)
      into v_taxable, v_vat
      from folio_postings fp
     where fp.folio_id = v_folio
       and fp.tax_scheme = 'vat'
       and fp.category not in ('payment', 'refund')
       and fp.reverses_id is null
       and not exists (select 1 from folio_postings r where r.reverses_id = fp.id);
  else
    select hotel_id, customer_name into v_hotel, v_to from pos_orders where id = p_order;
    select coalesce(sum(t.taxable), 0), coalesce(sum(t.tax), 0)
      into v_taxable, v_vat
      from app.pos_order_by_tax(p_order) t
     where t.tax_scheme = 'vat';
  end if;

  if v_taxable + v_vat <= 0 then
    return null;
  end if;

  v_year := app.current_fin_year(v_hotel);
  v_num := app.next_vat_bill_number(v_hotel, v_year);

  insert into vat_bills (hotel_id, fin_year, number, folio_id, invoice_id, pos_order_id,
                         recipient_name, taxable_value, vat_total, total,
                         business_date, issued_by)
  values (v_hotel, v_year, v_num, v_folio, p_invoice, p_order,
          v_to, v_taxable, v_vat, v_taxable + v_vat,
          app.business_date(v_hotel), app.current_user_id());

  return v_num;
end
$$;

comment on function app.issue_vat_bill(uuid, uuid) is
  'D22-44: the VAT bill for a sale''s alcohol, issued with its GST tax invoice '
  '(p_invoice) or at the restaurant''s settlement (p_order). Null when the sale '
  'carries no VAT, or the folio already has a live VAT bill.';
