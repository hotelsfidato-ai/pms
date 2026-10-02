-- =============================================================================
-- 189 — a company pays what it owes; a cash expense waits for a yes
--       (D27-152, D27-239, D27-242)
-- =============================================================================
-- A bill settled "Bill to company" is money the account owes: the City
-- ledger's Debit (payments.method 'city_ledger'). Until now nothing recorded
-- the company paying it, so the ledger's Opening, Credit and Closing printed
-- "-". This is that record: plain payments against an account - no GST
-- receipt voucher, which waits on the CA (B5, C2).
--
-- THE ACCOUNT IS THE ONE THE LEDGER NAMES: a company, else the booking site a
-- booking came through (booking sites are not companies here). So a payment
-- names exactly one of the two.
--
-- APPEND-ONLY, like the folio and the deposits log: a wrong line is reversed
-- by a line of its own, once, with a reason; nothing is edited or deleted.
-- =============================================================================

create table if not exists company_payments (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references hotels(id) on delete cascade,

  company_id        uuid references companies(id),
  booking_source_id uuid references booking_sources(id),

  amount            numeric(12,2) not null,
  -- The day the money reached the hotel, as typed; not after the business date.
  received_on       date not null,
  method            text not null,
  -- The bank's UTR, the cheque's number: what the accountant matches.
  reference         text,
  note              text,

  -- A reversal: the wrong line it takes back, once, and why.
  reverses_id       uuid unique references company_payments(id),
  reason            text,

  recorded_by       uuid not null references staff(id),
  recorded_at       timestamptz not null default now(),

  constraint company_payments_one_account check (
    (company_id is null) <> (booking_source_id is null)),
  -- A company pays by bank, cheque, UPI or card; never cash (D27-242).
  constraint company_payments_method_known check (
    method in ('bank_transfer', 'cheque', 'upi', 'card')),
  constraint company_payments_a_payment check (
    reverses_id is not null or amount > 0),
  constraint company_payments_a_reversal check (
    reverses_id is null
    or (amount < 0 and length(trim(coalesce(reason, ''))) > 0))
);

create index if not exists company_payments_hotel_idx
  on company_payments (hotel_id, received_on);

comment on table company_payments is
  'What a company or booking site paid against what it owes on the City '
  'ledger (D27-239). Append-only: a wrong line is reversed by its own line.';

alter table company_payments enable row level security;
alter table company_payments force  row level security;
drop policy if exists hotel_isolation on company_payments;
create policy hotel_isolation on company_payments
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

revoke all on company_payments from pms_app;
grant select, insert on company_payments to pms_app;


-- =============================================================================
-- A CASH EXPENSE WAITS FOR A YES (D27-239, D27-242)
-- =============================================================================
-- Money paid out of a drawer - the desk's (cashier_movements) or an outlet's
-- tin (pos_cash_movements) - is raised in the approvals inbox (076) and does
-- not count until the GM or the owner says yes; nobody approves their own
-- (076's app.decide_approval). EVERY expense: no amount is seeded, so the
-- rule's `over_amount` is null.
--
-- Nothing applies a decision. Whether an expense counts is worked out by
-- the database every time (app.cash_expense_counts), as equipment's place
-- is: a yes makes it count, even after the drawer closed; a refusal leaves
-- it uncounted - a shortage on that drawer, and nothing more.
-- =============================================================================

insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'cash_expense', 'gm', null, array['owner']
  from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

create or replace function app.cash_expense_rule_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'cash_expense', 'gm', null, array['owner'])
  on conflict (hotel_id, kind, approver_role) do nothing;
  return new;
end $fn$;

revoke all on function app.cash_expense_rule_for_new_property() from public;

drop trigger if exists hotels_cash_expense_rule on hotels;
create trigger hotels_cash_expense_rule
  after insert on hotels
  for each row execute function app.cash_expense_rule_for_new_property();

-- Counts when nobody was asked (no rule then), or once somebody said yes.
create or replace function app.cash_expense_counts(p_table text, p_id uuid)
returns boolean
language sql stable as $$
  select not exists (select 1 from approvals a
                      where a.subject_table = p_table and a.subject_id = p_id)
      or exists (select 1 from approvals a
                  where a.subject_table = p_table and a.subject_id = p_id
                    and a.status = 'approved')
$$;

comment on function app.cash_expense_counts(text, uuid) is
  'Whether a paid-out counts in its drawer: no approval was asked, or one '
  'was given (D27-242). Waiting or refused, it does not.';

grant execute on function app.cash_expense_counts(text, uuid) to pms_app;

-- 059's sum, an expense counted only once it counts.
create or replace function app.cashier_expected_cash(p_shift uuid)
returns numeric
language sql stable as $$
  with s as (select * from cashier_shifts where id = p_shift)
  select
    (select opening_cash from s)
    + coalesce((
        select sum(-fp.amount)
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
    + coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift and m.kind = 'top_up'), 0)
    - coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift
                   and (m.kind = 'withdrawal'
                        or (m.kind = 'expense'
                            and app.cash_expense_counts('cashier_movements', m.id)))), 0)
$$;

-- 165's sum, the same rule for an outlet's tin.
create or replace function app.pos_expected_cash(p_outlet uuid, p_date date)
returns numeric language sql stable as $$
  select
    coalesce(app.pos_opening_cash(p_outlet, p_date), 0)
    + coalesce((select sum(t.amount)
                  from pos_order_tenders t
                  join pos_orders o on o.id = t.order_id
                 where o.outlet_id = p_outlet and o.business_date = p_date
                   and o.status = 'settled' and t.method = 'cash'), 0)
    + coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and m.kind in ('top_up', 'due_collection')), 0)
    - coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and (m.kind = 'withdrawal'
                        or (m.kind = 'expense'
                            and app.cash_expense_counts('pos_cash_movements', m.id)))), 0)
$$;
