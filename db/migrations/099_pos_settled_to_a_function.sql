-- =============================================================================
-- 099 · A restaurant bill settled to a banquet function
-- =============================================================================
-- The owner's D17-21 (17 September): restaurant food reaches a banquet
-- function's bill. The banquet chat's half shows a function's restaurant
-- orders on its bill; this is the till's half. Asked the same day how such an
-- order is PAID, the owner answered: on the function's bill only —
--
--   * the till settles it "to the function", the way it charges a room;
--   * cash, card, UPI and a room are refused for an order on a function, so
--     the host pays for it once, with the function;
--   * it may be taken off the function while it is still open.
--
-- WHY A PAYMENT METHOD AND NOT A POSTING. `app.banquet_event_total` (061)
-- already adds up every SETTLED order whose `event_id` is the function. A
-- folio posting as well would bill the host twice; and an order paid in cash
-- at the till would have been billed to the host too. So an order on a
-- function settles with the method 'function': nothing touches a folio, the
-- drawer does not expect it (only 'cash' reaches the tin — 050), and the day
-- end lists it beside "To a room" as business done.
--
-- WHICH FUNCTION is not this file's to decide. The rule — confirmed, bill
-- open, running on the business date — is the banquet service's
-- (`api/src/modules/banquet/attach.ts`), asked by the till's server before it
-- writes `event_id` and again before it settles.
--
-- ⚠ REPLAYED ON EVERY DEPLOY (MEMORY 284). Each check is replaced only when it
-- does not already know 'function', so a later migration that widens it again
-- is never narrowed by a replay of this one.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_payment_valid'
                    and pg_get_constraintdef(oid) like '%function%') then
    alter table pos_orders drop constraint if exists pos_orders_payment_valid;
    alter table pos_orders add constraint pos_orders_payment_valid check (
      payment_method is null
      or payment_method in ('room', 'cash', 'card', 'upi', 'split', 'function'));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_tenders_method_valid'
                    and pg_get_constraintdef(oid) like '%function%') then
    alter table pos_order_tenders drop constraint if exists pos_order_tenders_method_valid;
    alter table pos_order_tenders add constraint pos_order_tenders_method_valid check (
      method in ('room', 'cash', 'card', 'upi', 'function'));
  end if;

  -- A bill settled to a function names the function. The route refuses first,
  -- with a sentence; this is the guarantee behind it.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_function_has_event') then
    alter table pos_orders add constraint pos_orders_function_has_event check (
      status <> 'settled' or payment_method is distinct from 'function'
      or event_id is not null);
  end if;
end $$;

comment on column pos_orders.event_id is
  'The banquet function this order is on (061). Set and cleared by the till '
  'while the order is open, only for a function the banquet service allows '
  '(api/src/modules/banquet/attach.ts). An order on a function settles with '
  'payment_method ''function'' and nothing else (099, the owner''s D17-21): '
  'app.banquet_event_total counts it on the function''s bill.';
