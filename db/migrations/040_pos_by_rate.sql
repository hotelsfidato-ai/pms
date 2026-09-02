-- =============================================================================
-- 040 — the per-rate breakdown, in ONE place
-- =============================================================================
-- The room-settle path in api/src/routes/till.ts computes its own per-rate
-- split straight from pos_order_lines:
--
--     select tax_rate, sum(round(qty * unit_price, 2)), ...
--       from pos_order_lines where order_id = $1 and not voided
--      group by tax_rate
--
-- That was correct until 038, and is now WRONG the moment a discount exists:
-- the guest is shown a discounted bill and the folio receives the full amount.
-- Nobody notices at the till — the till's total is right — and it surfaces days
-- later as a folio that does not match the restaurant bill in the guest's hand.
--
-- app.pos_order_total already apportions a discount across tax rates. That
-- apportionment now lives here, once, and the total is built from it. The API
-- reads the same function, so the bill, the settlement and the folio posting
-- cannot disagree — which is the rule 028 stated and this migration restores.
-- =============================================================================

create or replace function app.pos_order_by_rate(p_order uuid)
returns table (
  tax_rate numeric,
  rate_net numeric,   -- lines at this rate, before discount
  discount numeric,   -- this rate's share, residue included
  taxable  numeric,   -- rate_net - discount
  tax      numeric    -- on the DISCOUNTED value
)
language sql stable as $$
  with ord as (
    select coalesce(discount_amount, 0) as want_disc
      from pos_orders where id = p_order
  ),
  rates as (
    select l.tax_rate, sum(round(l.qty * l.unit_price, 2)) as rate_net
      from pos_order_lines l
     where l.order_id = p_order and not l.voided
     group by l.tax_rate
  ),
  tot as (select coalesce(sum(r.rate_net), 0) as net from rates r),
  -- Never discount more than the bill: a till that allows it produces a
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
  -- Apportioning by proportion leaves a paise residue. It lands on the largest
  -- group, once, so the parts always sum to the whole. A bill that is a paise
  -- out is a bill the guest is holding and querying.
  settled_shares as (
    select
      s.tax_rate,
      s.rate_net,
      s.rate_disc + case when s.biggest_first = 1
                         then (select disc from capped) - sum(s.rate_disc) over ()
                         else 0 end as rate_disc
    from shared s
  )
  select
    s.tax_rate,
    s.rate_net,
    s.rate_disc,
    s.rate_net - s.rate_disc,
    round((s.rate_net - s.rate_disc) * s.tax_rate / 100.0, 2)
  from settled_shares s
  order by s.tax_rate;
$$;

comment on function app.pos_order_by_rate(uuid) is
  'The bill broken down by tax rate, with any discount apportioned and the '
  'rounding residue absorbed by the largest group. GST treats two rates as two '
  'taxable supplies, and folio_postings carries one rate per row — so this is '
  'the shape a POS bill reaches a folio in. The till, the printed bill and the '
  'posting all read it, so they cannot disagree.';


-- -----------------------------------------------------------------------------
-- The total is now built FROM the breakdown
-- -----------------------------------------------------------------------------
-- Same columns, same answers. What changes is that the apportionment exists
-- once instead of twice — the second copy is exactly how the folio and the till
-- drifted apart in the first place.
-- -----------------------------------------------------------------------------
drop function if exists app.pos_order_total(uuid);

create function app.pos_order_total(p_order uuid)
returns table (
  net       numeric,
  discount  numeric,
  taxable   numeric,
  tax       numeric,
  gross     numeric,
  round_off numeric,
  payable   numeric
)
language sql stable as $$
  select
    coalesce(sum(r.rate_net), 0),
    coalesce(sum(r.discount), 0),
    coalesce(sum(r.taxable),  0),
    coalesce(sum(r.tax),      0),
    coalesce(sum(r.taxable),  0) + coalesce(sum(r.tax), 0),
    o.ro,
    coalesce(sum(r.taxable),  0) + coalesce(sum(r.tax), 0) + o.ro
  from (select coalesce(round_off, 0) as ro
          from pos_orders where id = p_order) o
  left join app.pos_order_by_rate(p_order) r on true
  group by o.ro;
$$;

comment on function app.pos_order_total(uuid) is
  'What an order costs, summed from app.pos_order_by_rate so the total and the '
  'per-rate postings are the same arithmetic rather than two copies of it.';

grant execute on function app.pos_order_by_rate(uuid) to pms_app;
grant execute on function app.pos_order_total(uuid)   to pms_app;
