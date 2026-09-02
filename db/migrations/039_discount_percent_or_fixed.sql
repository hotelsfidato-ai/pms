-- =============================================================================
-- 039 — a discount is a percentage or an amount, and the bill must say which
-- =============================================================================
-- 038 stored only `discount_amount`. The till screen offers PERCENTAGE or
-- FIXED, and the two are not interchangeable on the printed bill: "10% off"
-- and "₹115.70 off" are the same money and a different statement. A guest
-- querying the bill, and an auditor reading it a year later, need the one that
-- was actually chosen.
--
-- `discount_amount` stays authoritative for the arithmetic — every calculation
-- in app.pos_order_total works in rupees and must not learn about percentages.
-- These two columns record what was ENTERED, so the bill can print it.
-- =============================================================================

alter table pos_orders
  add column if not exists discount_type  text,
  add column if not exists discount_value numeric(10,2);

comment on column pos_orders.discount_type is
  '''percent'' or ''fixed'' — what the biller chose. Not used in any '
  'calculation; discount_amount is. This is so the bill can print "10% off" '
  'rather than an amount whose origin nobody can reconstruct.';

comment on column pos_orders.discount_value is
  'As entered: 10 for 10%, or 115.70 for a fixed amount. For a percentage this '
  'is the only record of the rate — recomputing it from the amount later fails '
  'the moment a line is added or struck.';

do $$
begin
  -- A discount amount means somebody chose a type and a value. Without them
  -- the bill can only print a number with no explanation of where it came from.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_discount_typed') then
    /* The null checks are not redundant. `discount_type in (...)` against a
       NULL evaluates to NULL, not false, and a CHECK constraint PASSES when it
       evaluates to NULL — so without them a discount with no type slips
       straight through. Caught by the assertion that expected a refusal and
       got a success. */
    alter table pos_orders add constraint pos_orders_discount_typed
      check (discount_amount = 0
             or (discount_type  is not null
                 and discount_type in ('percent', 'fixed')
                 and discount_value is not null
                 and discount_value > 0));
  end if;

  -- More than 100% is not a discount, it is a refund with the sign hidden.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_discount_percent_sane') then
    alter table pos_orders add constraint pos_orders_discount_percent_sane
      check (discount_type is distinct from 'percent' or discount_value <= 100);
  end if;

  -- A fixed discount's value IS the amount. Letting them disagree gives you a
  -- bill that prints one figure and charges another.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_discount_fixed_agrees') then
    alter table pos_orders add constraint pos_orders_discount_fixed_agrees
      check (discount_type is distinct from 'fixed'
             or discount_value = discount_amount);
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- Turning a percentage into money
-- -----------------------------------------------------------------------------
-- The till calls this when the biller picks a percentage, and writes the result
-- into discount_amount. Deliberately NOT a generated column: a percentage
-- recalculated on every read would silently change the discount on an already
-- printed bill when a line is added. The bill is a promise, not a formula.
-- -----------------------------------------------------------------------------
create or replace function app.pos_discount_for(p_order uuid, p_percent numeric)
returns numeric language sql stable as $$
  select round(coalesce((select net from app.pos_order_total(p_order)), 0)
               * p_percent / 100.0, 2);
$$;

comment on function app.pos_discount_for(uuid, numeric) is
  'The rupee value of a percentage discount, off the net, at the moment it is '
  'applied. Call it once and store the answer — never recompute it on read.';

grant execute on function app.pos_discount_for(uuid, numeric) to pms_app;
