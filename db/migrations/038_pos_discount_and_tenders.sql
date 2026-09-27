-- =============================================================================
-- 038 — a discount that can be audited, and a bill that can be paid two ways
-- =============================================================================
-- Today the till settles ONE method, the FULL amount, with NO discount. Every
-- restaurant discounts — a staff meal, a complaint, a manager's call — so a till
-- with nowhere to record it does not stop the discount happening. It moves it
-- somewhere invisible: the biller voids a line, or takes less cash than the bill
-- says. Both make revenue reporting wrong, and neither leaves a trace anybody
-- can investigate.
--
-- So: a discount is allowed, and it must say WHY. An amount with no reason is
-- an unauditable hole, which is worse than not offering the feature.
--
-- Three things arrive together because they are one screen and one arithmetic:
--
--   · discount, with a reason, apportioned across tax rates
--   · round off, so the payable is a number a person can hand over
--   · tenders, so a bill can be part cash and part card
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The discount, and the rounding, on the order
-- -----------------------------------------------------------------------------
alter table pos_orders
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists discount_reason text,
  add column if not exists round_off       numeric(12,2) not null default 0;

comment on column pos_orders.discount_amount is
  'Off the NET, before tax — the Indian GST treatment: a discount shown on the '
  'invoice reduces the taxable value. Apportioned across tax rates by '
  'app.pos_order_total, never applied to the gross.';

comment on column pos_orders.discount_reason is
  'Required whenever there is a discount. Free text on purpose: a fixed list '
  'gets one entry that means "other" and everybody picks it.';

comment on column pos_orders.round_off is
  'Signed. -0.37 rounds 976.37 down to 976. Kept as its own column because it '
  'appears as its own line on the bill and its own row in the day book.';

do $$
begin
  -- A discount with no reason is the thing this migration exists to prevent.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_discount_has_reason') then
    alter table pos_orders add constraint pos_orders_discount_has_reason
      check (discount_amount = 0
             or (discount_reason is not null and length(trim(discount_reason)) > 0));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_discount_sane') then
    alter table pos_orders add constraint pos_orders_discount_sane
      check (discount_amount >= 0);
  end if;

  -- A round-off is pennies. Anything larger is a discount wearing a disguise,
  -- and it would escape the reason requirement above.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_round_off_small') then
    alter table pos_orders add constraint pos_orders_round_off_small
      check (round_off > -1 and round_off < 1);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Tenders — how the bill was actually paid
-- -----------------------------------------------------------------------------
-- `pos_orders.payment_method` is one column and holds one value. A guest paying
-- ₹500 cash and the rest by card has no way to be recorded, so the biller picks
-- whichever is larger and the cash drawer stops reconciling.
--
-- The column stays: for a single-tender bill it still names the method, which is
-- every row that exists today and every query already written against them. A
-- split bill sets it to 'split' and the detail lives here.
-- -----------------------------------------------------------------------------
create table if not exists pos_order_tenders (
  id         bigserial primary key,
  order_id   uuid not null references pos_orders(id) on delete cascade,
  hotel_id   uuid not null references hotels(id) on delete cascade,

  method     text not null,
  amount     numeric(12,2) not null,

  -- What the guest physically handed over, for cash. Change is
  -- tendered - amount, and it is derived rather than stored: a stored change
  -- figure is one more thing that can disagree with the arithmetic.
  tendered   numeric(12,2),

  -- Card last four, UPI reference, the room number for a room charge. Not
  -- validated: the shape differs per method and a wrong format should not stop
  -- a guest leaving.
  reference  text,

  taken_by   uuid not null references staff(id),
  taken_at   timestamptz not null default now(),

  constraint pos_order_tenders_method_valid check (method in
    ('room', 'cash', 'card', 'upi')),

  -- A zero tender is a row that means nothing. A negative one is a refund,
  -- which is a different feature and must not sneak in here.
  constraint pos_order_tenders_amount_positive check (amount > 0),

  -- Only cash is handed over. A card "tendered" is the amount, always.
  constraint pos_order_tenders_tendered_cash_only check (
    tendered is null or (method = 'cash' and tendered >= amount))
);

create index if not exists pos_order_tenders_order_idx
  on pos_order_tenders (order_id);
create index if not exists pos_order_tenders_hotel_idx
  on pos_order_tenders (hotel_id, taken_at);

comment on table pos_order_tenders is
  'One row per payment against an order. A single-tender bill has one row and '
  'pos_orders.payment_method mirrors it; a split bill has several and that '
  'column reads ''split''.';


-- -----------------------------------------------------------------------------
-- 'split' becomes a payment method the order may carry
-- -----------------------------------------------------------------------------
-- ⚠ REPLAYED ON EVERY DEPLOY (MEMORY 284). Replaced only while the check
-- does not know 'split' yet. Unguarded, a replay put back this narrower check
-- over 099's, which knows 'function', and the first bill ever settled to a
-- banquet function failed it: the whole migration rolled back and the deploy
-- stopped (28 September, the release review).
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_payment_valid'
                    and pg_get_constraintdef(oid) like '%split%') then
    alter table pos_orders drop constraint if exists pos_orders_payment_valid;
    alter table pos_orders add constraint pos_orders_payment_valid
      check (payment_method is null or payment_method in
        ('room', 'cash', 'card', 'upi', 'split'));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- A room tender still means a folio posting exists
-- -----------------------------------------------------------------------------
-- The existing check says: settled + payment_method 'room' ⇒ ticket_id. A split
-- bill part-paid to a room reads 'split', so that check no longer fires and a
-- room charge could settle with nothing on the folio — a bill somebody thinks is
-- on a room and is not, which is the exact fault 024 was written to prevent.
--
-- A check constraint cannot see another table, so this is a trigger.
-- -----------------------------------------------------------------------------
create or replace function app.pos_room_tender_needs_ticket()
returns trigger language plpgsql as $$
declare
  v_order  pos_orders%rowtype;
begin
  select * into v_order from pos_orders
   where id = coalesce(new.order_id, old.order_id);

  if v_order.status = 'settled'
     and exists (select 1 from pos_order_tenders
                  where order_id = v_order.id and method = 'room')
     and v_order.ticket_id is null then
    raise exception
      'order % settles part or all to a room but carries no ticket', v_order.order_no
      using hint = 'A room charge without a ticket is a bill nobody will find on the folio.';
  end if;

  return null;
end $$;

drop trigger if exists pos_order_tenders_room_ticket on pos_order_tenders;
create constraint trigger pos_order_tenders_room_ticket
  after insert or update on pos_order_tenders
  deferrable initially deferred
  for each row execute function app.pos_room_tender_needs_ticket();


-- -----------------------------------------------------------------------------
-- The totals — one definition, now carrying the discount
-- -----------------------------------------------------------------------------
-- Used by the till, the bill and the settlement, so the three cannot disagree.
-- The discount is apportioned across TAX RATES, not applied to the gross: a
-- restaurant selling 5% food and 18% beverages together must reduce each rate's
-- taxable value in proportion, or the per-rate postings are wrong. That split
-- was a defect once already.
--
-- Apportioning by proportion leaves a paise residue. It is absorbed by the
-- LARGEST rate group, so the parts always sum to the whole — a bill that is a
-- paise out is a bill the guest is holding and querying.
--
-- Returns more columns than before. Callers reading net/tax/gross keep working;
-- gross is still what is payable before rounding.
-- -----------------------------------------------------------------------------
-- The return type gains columns, and Postgres refuses to replace a function
-- whose OUT parameters change. Dropped explicitly rather than discovered as
-- "cannot change return type of existing function" halfway through a deploy.
drop function if exists app.pos_order_total(uuid);

create function app.pos_order_total(p_order uuid)
returns table (
  net       numeric,   -- lines, before any discount
  discount  numeric,   -- actually applied, capped at net
  taxable   numeric,   -- net - discount
  tax       numeric,   -- on the DISCOUNTED value, per rate
  gross     numeric,   -- taxable + tax
  round_off numeric,
  payable   numeric    -- gross + round_off, what the guest hands over
)
language sql stable as $$
  with ord as (
    select coalesce(discount_amount, 0) as want_disc,
           coalesce(round_off, 0)       as ro
      from pos_orders where id = p_order
  ),
  rates as (
    select tax_rate, sum(round(qty * unit_price, 2)) as rate_net
      from pos_order_lines
     where order_id = p_order and not voided
     group by tax_rate
  ),
  tot as (select coalesce(sum(rate_net), 0) as net from rates),
  -- Never discount more than the bill. A till that allows it produces a
  -- negative payable and a refund nobody authorised.
  capped as (
    select least((select want_disc from ord), (select net from tot)) as disc
  ),
  shared as (
    select
      r.tax_rate,
      r.rate_net,
      case when (select net from tot) = 0 then 0
           else round((select disc from capped) * r.rate_net
                      / (select net from tot), 2)
      end as rate_disc,
      row_number() over (order by r.rate_net desc, r.tax_rate) as biggest_first
    from rates r
  ),
  -- The residue lands on the largest group, once.
  settled_shares as (
    select
      tax_rate,
      rate_net,
      rate_disc + case when biggest_first = 1
                       then (select disc from capped) - sum(rate_disc) over ()
                       else 0 end as rate_disc
    from shared
  )
  select
    (select net from tot)                                              as net,
    coalesce(sum(s.rate_disc), 0)                                      as discount,
    (select net from tot) - coalesce(sum(s.rate_disc), 0)              as taxable,
    coalesce(sum(round((s.rate_net - s.rate_disc) * s.tax_rate / 100.0, 2)), 0) as tax,
    (select net from tot) - coalesce(sum(s.rate_disc), 0)
      + coalesce(sum(round((s.rate_net - s.rate_disc) * s.tax_rate / 100.0, 2)), 0) as gross,
    (select ro from ord)                                               as round_off,
    (select net from tot) - coalesce(sum(s.rate_disc), 0)
      + coalesce(sum(round((s.rate_net - s.rate_disc) * s.tax_rate / 100.0, 2)), 0)
      + (select ro from ord)                                           as payable
  from settled_shares s;
$$;

comment on function app.pos_order_total(uuid) is
  'The one definition of what an order costs. Discount comes off the net and is '
  'apportioned across tax rates with the residue on the largest group, so the '
  'per-rate postings always sum to the bill.';


-- -----------------------------------------------------------------------------
-- Tenders must add up to the bill
-- -----------------------------------------------------------------------------
-- Checked at settlement rather than continuously: a bill is tendered in several
-- statements and would be "short" between them.
-- -----------------------------------------------------------------------------
create or replace function app.pos_tenders_cover_bill(p_order uuid)
returns boolean language sql stable as $$
  select coalesce((select sum(amount) from pos_order_tenders where order_id = p_order), 0)
       = coalesce((select payable from app.pos_order_total(p_order)), 0);
$$;

comment on function app.pos_tenders_cover_bill(uuid) is
  'True when the tenders sum exactly to the payable. The till calls this before '
  'marking an order settled; a bill that is short is a drawer that will not '
  'reconcile at day end.';


-- -----------------------------------------------------------------------------
-- A settled bill's tenders are evidence, not scratch
-- -----------------------------------------------------------------------------
-- Removing a tender from a settled order rewrites how money was taken, after
-- the drawer has been counted against it. Before settlement they are working
-- rows and the biller may correct them freely.
-- -----------------------------------------------------------------------------
create or replace function app.pos_tender_settled_immutable()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from pos_orders
              where id = old.order_id and status = 'settled') then
    raise exception 'tenders on a settled order cannot be removed'
      using hint = 'Reverse the bill instead. How money was taken is evidence.';
  end if;
  return old;
end $$;

drop trigger if exists pos_order_tenders_no_delete_settled on pos_order_tenders;
create trigger pos_order_tenders_no_delete_settled
  before delete on pos_order_tenders
  for each row execute function app.pos_tender_settled_immutable();


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- The suite asserts every hotel-scoped table in public has RLS and a policy.
-- Stated here rather than discovered by that assertion.
-- -----------------------------------------------------------------------------
alter table pos_order_tenders enable row level security;
alter table pos_order_tenders force  row level security;

drop policy if exists pos_order_tenders_isolation on pos_order_tenders;
create policy pos_order_tenders_isolation on pos_order_tenders
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- 014 granted "all tables in schema public" once. That is not a standing rule —
-- it did not cover this table, and a table the app cannot read is a screen that
-- renders empty with no error.
-- -----------------------------------------------------------------------------
grant select, insert, delete on pos_order_tenders            to pms_app;
grant usage, select          on sequence pos_order_tenders_id_seq to pms_app;
grant execute on function app.pos_order_total(uuid)          to pms_app;
grant execute on function app.pos_tenders_cover_bill(uuid)   to pms_app;
