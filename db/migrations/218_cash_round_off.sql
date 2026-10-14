-- =============================================================================
-- 218 · Cash on a room bill is taken to the rupee (the owner's D27-317,
--       13 October)
-- =============================================================================
-- A room bill carries paise (GST at 12% or 18% on a nightly rate). Nobody
-- hands over 37 paise, so the desk took ₹1,235 for a bill of ₹1,234.63 and
-- the drawer was 37 paise over at the count, every time.
--
-- The rule: when a room bill is paid in CASH, the cash taken is the nearest
-- rupee, and the difference (at most ±0.50) is recorded with the payment as
-- its round-off. The bill is credited with the exact amount, so it settles to
-- ₹0 and the GST invoice keeps its exact figures. UPI, card and every other
-- way pay the exact amount: a round-off on anything but cash is refused here.
-- The restaurant bill's own Round off (038) is a different thing and is not
-- touched.
--
-- The drawer expects what was really put in it: the bill's amount plus the
-- round-off. Re-runnable.
-- =============================================================================

alter table payments add column if not exists round_off numeric(4,2) not null default 0;

alter table payments drop constraint if exists payments_round_off_cash_only;
alter table payments add constraint payments_round_off_cash_only
  check (round_off between -0.50 and 0.50 and (round_off = 0 or method = 'cash'));

comment on column payments.round_off is
  'Cash on a room bill (D27-317): the cash taken is the nearest rupee; this is '
  'what was taken minus the bill''s amount, at most ±0.50. 0 for every other way.';

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
    + coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift and m.kind = 'top_up'), 0)
    - coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift
                   and (m.kind = 'withdrawal'
                        or (m.kind = 'expense'
                            and app.cash_expense_counts('cashier_movements', m.id)))), 0)
$$;
