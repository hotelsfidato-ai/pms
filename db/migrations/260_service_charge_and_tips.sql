-- =============================================================================
-- 264 · A voluntary service charge, and tips (D27-383 item 9; built under D27-396)
-- =============================================================================
-- THE LAW FIRST. The CCPA's guidelines of 4 July 2022 (under section 18(2)(l)
-- of the Consumer Protection Act, 2019): a hotel or restaurant may not add a
-- service charge automatically or by default, nor collect it under any other
-- name; the guest may pay one only voluntarily, and must be told it is
-- voluntary. The Delhi High Court upheld them (March 2025). So:
--
--   * pos_outlets.service_charge_pct - the restaurant's rate, set on Restaurant
--     setup. NULL, the default, is "no service charge here". No rate is put in.
--   * pos_orders.service_charge_pct - put on ONE bill only when the cashier
--     ticks it, with the guest's agreement, while the bill is open; copied from
--     the restaurant's rate at that moment (a later change of the rate leaves
--     the bill as ticked). The bill prints it as voluntary.
--   * GST: a service charge collected is part of the value of the supply
--     (CGST Act s.15), so it is taxed with the food. It is worked out on the
--     GST part of the bill AFTER its discount and shared across its rates the
--     way 125 shares the discount, so each rate's taxable carries its part and
--     the tax, the bill, a room's postings and every report that reads
--     app.pos_order_by_tax take it in. Alcohol (VAT, its own VAT bill, D22-44)
--     takes no service charge: decided under D27-396 as the stricter reading,
--     because the VAT bill is a separate document and the states' VAT on a
--     service charge differs - a question for the CA.
--   * app.pos_order_service_charge(order): the amount, from the breakdown.
--
-- A TIP is money for the staff, not a sale and not taxed: pos_orders.tip and
-- tip_method, written with the payment (cash, card or UPI; never a room or a
-- function), outside the tenders - which still add up to the bill exactly. A
-- cash tip is in the tin, so app.pos_expected_cash counts it.
--
-- Neither changes on a bill that is not open (the guard below), so a paid bill
-- stays as it was paid.
--
-- Re-runnable. app.pos_order_by_tax and app.pos_expected_cash keep 125's and
-- 189's signatures (MEMORY 317).
-- =============================================================================

alter table pos_outlets add column if not exists service_charge_pct numeric(5,2);
alter table pos_outlets drop constraint if exists pos_outlets_service_charge_sane;
alter table pos_outlets add constraint pos_outlets_service_charge_sane
  check (service_charge_pct is null or (service_charge_pct > 0 and service_charge_pct <= 20));
comment on column pos_outlets.service_charge_pct is
  'The restaurant''s voluntary service charge, % (260). NULL: none - the default (CCPA, 4 July 2022). '
  'Put on a bill only when the cashier ticks it with the guest''s agreement.';

alter table pos_orders add column if not exists service_charge_pct numeric(5,2);
alter table pos_orders drop constraint if exists pos_orders_service_charge_sane;
alter table pos_orders add constraint pos_orders_service_charge_sane
  check (service_charge_pct is null or (service_charge_pct > 0 and service_charge_pct <= 20));
comment on column pos_orders.service_charge_pct is
  'The voluntary service charge the guest agreed to on this bill (260), the restaurant''s rate '
  'when ticked. NULL: none.';

alter table pos_orders add column if not exists tip numeric(12,2);
alter table pos_orders add column if not exists tip_method text;
alter table pos_orders drop constraint if exists pos_orders_tip_sane;
alter table pos_orders add constraint pos_orders_tip_sane check (
  (tip is null and tip_method is null)
  or (tip > 0 and tip_method in ('cash', 'card', 'upi')
      and status in ('settled', 'void')
      and coalesce(payment_method, '') not in ('room', 'function')));
comment on column pos_orders.tip is
  'A tip for the staff taken with the payment (260): not a sale, not taxed, not a tender.';

/* Ticked only to the restaurant's own rate, and neither changes once the bill
   is not open - the settle's own update (open to settled) writes the tip. */
create or replace function app.pos_order_charge_guard()
returns trigger
language plpgsql
as $$
begin
  if (new.service_charge_pct, new.tip, new.tip_method)
     is not distinct from (old.service_charge_pct, old.tip, old.tip_method) then
    return new;
  end if;
  if old.status <> 'open' then
    raise exception 'Bill % is %: its service charge and tip stay as they were.', old.order_no, old.status
      using errcode = '23514';
  end if;
  if new.service_charge_pct is distinct from old.service_charge_pct
     and new.service_charge_pct is not null
     and new.service_charge_pct is distinct from
         (select service_charge_pct from pos_outlets where id = new.outlet_id) then
    raise exception 'That is not this restaurant''s service charge.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_charge_guard on pos_orders;
create trigger pos_orders_charge_guard
  before update on pos_orders
  for each row execute function app.pos_order_charge_guard();


-- -----------------------------------------------------------------------------
-- The breakdown, with the service charge in each GST rate's taxable
-- -----------------------------------------------------------------------------
-- 125's body to `settled_shares`, unchanged; then the service charge on the GST
-- groups' discounted value, shared by that value, the paisa left over to the
-- biggest GST group. With no service charge every figure is 125's.
create or replace function app.pos_order_by_tax(p_order uuid)
returns table (
  tax_scheme text,
  tax_rate   numeric,
  rate_net   numeric,   -- lines at this rate, before discount
  discount   numeric,   -- this group's share, residue included
  taxable    numeric,   -- rate_net - discount + this group's service charge
  tax        numeric    -- on that
)
language sql stable as $$
  with ord as (
    select coalesce(o.discount_amount, 0) as want_disc, o.service_charge_pct as sc_pct
      from pos_orders o where o.id = p_order
  ),
  rates as (
    select l.tax_scheme, l.tax_rate, sum(round(l.qty * l.unit_price, 2)) as rate_net
      from pos_order_lines l
     where l.order_id = p_order and not l.voided
     group by l.tax_scheme, l.tax_rate
  ),
  tot as (select coalesce(sum(r.rate_net), 0) as net from rates r),
  capped as (
    select least((select want_disc from ord), (select net from tot)) as disc
  ),
  shared as (
    select
      r.tax_scheme,
      r.tax_rate,
      r.rate_net,
      case when (select net from tot) = 0 then 0
           else round((select disc from capped) * r.rate_net
                      / (select net from tot), 2)
      end as rate_disc,
      row_number() over (order by r.rate_net desc, r.tax_rate, r.tax_scheme)
        as biggest_first
    from rates r
  ),
  settled_shares as (
    select
      s.tax_scheme,
      s.tax_rate,
      s.rate_net,
      s.rate_disc + case when s.biggest_first = 1
                         then (select disc from capped) - sum(s.rate_disc) over ()
                         else 0 end as rate_disc
    from shared s
  ),
  sc_base as (
    select coalesce(sum(s.rate_net - s.rate_disc) filter (where s.tax_scheme = 'gst'), 0) as base
      from settled_shares s
  ),
  sc_total as (
    select coalesce(round((select sc_pct from ord) * (select base from sc_base) / 100.0, 2), 0) as total
  ),
  sc_shares as (
    select
      s.*,
      case when s.tax_scheme <> 'gst' or (select base from sc_base) = 0 then 0
           else round((select total from sc_total) * (s.rate_net - s.rate_disc)
                      / (select base from sc_base), 2)
      end as share,
      row_number() over (order by (s.tax_scheme = 'gst') desc, s.rate_net - s.rate_disc desc,
                                  s.tax_rate) as gst_first
    from settled_shares s
  ),
  with_service as (
    select
      x.tax_scheme, x.tax_rate, x.rate_net, x.rate_disc,
      x.share + case when x.gst_first = 1 and x.tax_scheme = 'gst'
                     then (select total from sc_total) - sum(x.share) over ()
                     else 0 end as service
    from sc_shares x
  )
  select
    w.tax_scheme,
    w.tax_rate,
    w.rate_net,
    w.rate_disc,
    w.rate_net - w.rate_disc + w.service,
    round((w.rate_net - w.rate_disc + w.service) * w.tax_rate / 100.0, 2)
  from with_service w
  order by w.tax_rate, w.tax_scheme;
$$;

comment on function app.pos_order_by_tax(uuid) is
  'A bill by tax and rate (125), each with its share of the discount and, since 264, of the '
  'voluntary service charge (GST groups only); tax on the result. Everything that prints, posts '
  'or reports a restaurant bill reads this.';

create or replace function app.pos_order_service_charge(p_order uuid)
returns numeric
language sql stable as $$
  select coalesce(sum(t.taxable - t.rate_net + t.discount), 0) from app.pos_order_by_tax(p_order) t;
$$;
comment on function app.pos_order_service_charge(uuid) is
  'The voluntary service charge on a bill, before tax (260): 0 when none was ticked.';
grant execute on function app.pos_order_service_charge(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- What the tin should hold: 189's, and the cash tips
-- -----------------------------------------------------------------------------
create or replace function app.pos_expected_cash(p_outlet uuid, p_date date)
returns numeric language sql stable as $$
  select
    coalesce(app.pos_opening_cash(p_outlet, p_date), 0)
    + coalesce((select sum(t.amount)
                  from pos_order_tenders t
                  join pos_orders o on o.id = t.order_id
                 where o.outlet_id = p_outlet and o.business_date = p_date
                   and o.status = 'settled' and t.method = 'cash'), 0)
    /* Cash tips, in the tin until handed to the staff (260). */
    + coalesce((select sum(o.tip) from pos_orders o
                 where o.outlet_id = p_outlet and o.business_date = p_date
                   and o.status = 'settled' and o.tip_method = 'cash'), 0)
    + coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and m.kind in ('top_up', 'due_collection')), 0)
    - coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and (m.kind = 'withdrawal'
                        or (m.kind = 'expense'
                            and app.cash_expense_counts('pos_cash_movements', m.id)))), 0)
$$;
