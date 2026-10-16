-- =============================================================================
-- 227 · A cash refund to the rupee (the owner's D27-337 (d), 16 October)
-- =============================================================================
-- "A cash refund is rounded to the rupee too, the guest's bill keeping the
-- exact figure" - as a cash payment is (218, D27-317). A credit of ₹1,234.63
-- given back in cash: the refund line and its row stay ₹1,234.63; the cash
-- handed over is ₹1,235.00, and `refunds.round_off` keeps the +0.37.
--
-- Two changes, nothing else:
--   * `refunds.round_off`, at most ±0.50, and only on a cash refund;
--   * app.cashier_expected_cash (219's text): the cash a refund took out of
--     the drawer is `amount + round_off` - what was handed over.
-- The day reports count the bill's exact figure, as they do for payments.
-- Re-runnable.
-- =============================================================================

alter table refunds add column if not exists round_off numeric(4,2) not null default 0;
alter table refunds drop constraint if exists refunds_round_off_cash_only;
alter table refunds add constraint refunds_round_off_cash_only
  check (round_off between -0.50 and 0.50 and (round_off = 0 or method = 'cash'));
comment on column refunds.round_off is
  'A cash refund (D27-337): the cash handed over is the nearest rupee; this is '
  'what was handed over minus the refund''s amount, at most ±0.50. 0 for every other way.';

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
        select sum(fp.amount + rf.round_off)
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
