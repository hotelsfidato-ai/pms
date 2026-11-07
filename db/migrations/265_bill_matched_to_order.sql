-- =============================================================================
-- 270 · The supplier's bill matched to the order (D27-383 item 11)
-- =============================================================================
-- The owner's list of 6 November (D27-383, item 11): when a delivery against
-- an order comes with the supplier's bill, each line of the bill is compared
-- with what the order agreed, and every difference is flagged - on the
-- delivery, the order and Supplier dues - before the bill is paid:
--
--   quantity   more billed than came          billed_quantity  > received_quantity
--   price      a price above the agreed one   received_unit_cost > unit_price
--   gst        a GST rate other than agreed   gst_rate        <> agreed_gst_rate
--
-- NOTHING IS REFUSED BY IT. The delivery is recorded as it came, the bill goes
-- on the dues as printed. Only paying it asks: whoever records a payment on a
-- bill with a difference confirms they have seen the differences, and their
-- name is kept on the payment (differences_seen_by). The Accountant or the GM
-- decides; nothing here decides for them.
--
-- A MISSING FIGURE IS NEVER A DIFFERENCE. A line with no agreed GST rate, no
-- billed quantity or no cost each is not compared on that point, and reads "-".
-- Never a zero (the owner's oldest rule).
--
-- What is new:
--   purchase_request_lines.agreed_gst_rate   the order's GST rate, typed with
--     the agreed price while the order has not gone out (null: none agreed)
--   purchase_request_lines.billed_quantity   how much the supplier's bill
--     charges for, typed with the delivery when it is on credit
--   app.purchase_differences(order)          THE one definition, read by the
--     order, the dues and the payment's own check below
--   supplier_payments.differences_seen_by    who confirmed, on a payment of a
--     bill with a difference; refused without it (trigger), and always the
--     person recording the payment (check)
--
-- Decided under D27-396 (the owner reviews): the agreed price and the bill's
-- cost each are both BEFORE GST, as the delivery already says of its cost.
--
-- Never edits 116, 180, 246 or 249. Re-runnable.
-- =============================================================================

alter table purchase_request_lines
  add column if not exists agreed_gst_rate numeric(5,2),
  add column if not exists billed_quantity numeric(12,3);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_request_lines_agreed_gst_sane') then
    alter table purchase_request_lines add constraint purchase_request_lines_agreed_gst_sane
      check (agreed_gst_rate is null or agreed_gst_rate between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchase_request_lines_billed_sane') then
    alter table purchase_request_lines add constraint purchase_request_lines_billed_sane
      check (billed_quantity is null or billed_quantity >= 0);
  end if;
end $$;

comment on column purchase_request_lines.agreed_gst_rate is
  'The GST rate the order agreed for this line, in per cent, set with the agreed price before the order '
  'goes out. Null: none agreed, and the bill''s GST is not compared (a dash, never zero).';
comment on column purchase_request_lines.billed_quantity is
  'How much the supplier''s bill charges for on this line, typed with a delivery on credit. Kept beside '
  'received_quantity (what came) and quantity (what was ordered): all three stay.';


-- -----------------------------------------------------------------------------
-- THE ONE DEFINITION of a difference between a bill and its order
-- -----------------------------------------------------------------------------
-- One row per difference, in the order's line order: quantity, price, gst.
-- `billed` is the bill's figure; `against` is what came (quantity) or what was
-- agreed (price, gst). Security invoker: it reads through row security.
create or replace function app.purchase_differences(p_request uuid)
returns table (line_id uuid, line_no integer, item text, unit text, kind text, billed numeric, against numeric)
language sql
stable
as $fn$
  select pl.id, pl.line_no, i.name, i.unit, d.kind, d.billed, d.against
    from purchase_request_lines pl
    join stock_items i on i.id = pl.item_id
    cross join lateral (values
      (1, 'quantity', pl.billed_quantity,    pl.received_quantity),
      (2, 'price',    pl.received_unit_cost, pl.unit_price),
      (3, 'gst',      pl.gst_rate,           pl.agreed_gst_rate)) d(n, kind, billed, against)
   where pl.request_id = p_request
     and d.billed is not null and d.against is not null
     and case d.kind when 'gst' then d.billed <> d.against else d.billed > d.against end
   order by pl.line_no, d.n
$fn$;

grant execute on function app.purchase_differences(uuid) to pms_app;

comment on function app.purchase_differences(uuid) is
  'D27-383 item 11: each way an order''s delivered bill differs from the order - more billed than came, '
  'a price above the agreed one, a GST rate other than the agreed one. A missing figure is never a difference.';


-- -----------------------------------------------------------------------------
-- Paying a bill with a difference: whoever pays has seen them, by name
-- -----------------------------------------------------------------------------
alter table supplier_payments
  add column if not exists differences_seen_by uuid references staff(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'supplier_payments_seen_by_the_payer') then
    alter table supplier_payments add constraint supplier_payments_seen_by_the_payer
      check (differences_seen_by is null or differences_seen_by = recorded_by);
  end if;
end $$;

comment on column supplier_payments.differences_seen_by is
  'D27-383 item 11: on a payment of a bill that differs from its order, who confirmed they had seen the '
  'differences before paying: the person recording the payment. Null where the bill had none.';

create or replace function app.supplier_payment_differences_seen()
returns trigger
language plpgsql
as $fn$
begin
  if new.differences_seen_by is null and exists (
       select 1 from supplier_bills b
        cross join lateral app.purchase_differences(b.purchase_request_id) d
        where b.id = new.bill_id and b.purchase_request_id is not null) then
    raise exception 'This bill differs from its order. Whoever pays it first confirms they have seen the differences.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists supplier_payments_differences_seen on supplier_payments;
create trigger supplier_payments_differences_seen before insert on supplier_payments
  for each row execute function app.supplier_payment_differences_seen();
