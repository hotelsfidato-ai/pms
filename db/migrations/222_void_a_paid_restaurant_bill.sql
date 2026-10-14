-- =============================================================================
-- 222 · A paid restaurant bill voided (the owner's D27-324 (1) and D27-327,
--       14 October)
-- =============================================================================
-- Until now an order was only open, paid (`settled`) or closed unpaid
-- (`abandoned`, 028): a bill paid by mistake - the wrong table, charged twice -
-- could not be taken back by anybody. Now the owner, an administrator or the
-- GM may void a PAID bill, with a reason:
--
--   * the same business day only, before that outlet's restaurant day is
--     closed (its drawer counted);
--   * never a bill that went to a room or a function: it reached a folio, and
--     is reversed on that bill;
--   * a card or UPI bill names the refund's reference (UPI reference, card
--     approval); cash needs none;
--   * the bill keeps its number, is `void` for good, and keeps its lines and
--     payments (the kitchen made the food; how money was taken is evidence);
--   * its alcohol's VAT bill (135) gets its cancellation, as finance cancels
--     one: a numbered row with the figures negated and the reason;
--   * the cash goes back to the guest out of the RESTAURANT'S TIN, where the
--     notes still are the same day (the owner's D27-327); nobody's front-desk
--     drawer is touched. Nothing to write for it: the tin's Expected
--     (app.pos_expected_cash, 189) counts paid bills' cash only, so a voided
--     bill's cash leaves it by itself.
--
-- Every report that counts restaurant sales reads `status = 'settled'`, so a
-- voided bill leaves them by itself; the routes say what each one does.
-- Re-runnable (db/tests/rerun.sh): guarded, or create or replace with the
-- same signature.
-- =============================================================================

alter table pos_orders add column if not exists voided_by uuid references staff(id);
alter table pos_orders add column if not exists voided_at timestamptz;
alter table pos_orders add column if not exists void_reason text;
alter table pos_orders add column if not exists void_reference text;

comment on column pos_orders.void_reason is
  'Why a paid bill was voided (D27-324): the owner, an administrator or the GM, '
  'the same business day. Required on a void.';
comment on column pos_orders.void_reference is
  'The refund''s reference for a card or UPI bill voided (the UPI reference, '
  'the card approval). Null for cash.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_status_valid'
                    and pg_get_constraintdef(oid) like '%void%') then
    alter table pos_orders drop constraint if exists pos_orders_status_valid;
    alter table pos_orders add constraint pos_orders_status_valid check (
      status in ('open', 'settled', 'abandoned', 'void'));
  end if;

  -- A void says who, when and why. Who and when are the database's (below).
  if not exists (select 1 from pg_constraint where conname = 'pos_orders_void_complete') then
    alter table pos_orders add constraint pos_orders_void_complete check (
      status <> 'void'
      or (voided_by is not null and voided_at is not null
          and length(btrim(coalesce(void_reason, ''))) > 0));
  end if;

  -- A voided bill reprints VOID (D27-324).
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_bill_prints_heading_check'
                    and pg_get_constraintdef(oid) like '%void%') then
    alter table pos_bill_prints drop constraint if exists pos_bill_prints_heading_check;
    alter table pos_bill_prints add constraint pos_bill_prints_heading_check check (
      heading in ('interim', 'bill', 'duplicate', 'void'));
  end if;
end $$;


-- ── Who may void a paid bill ─────────────────────────────────────────────
-- Written out, not borrowed from another answer (as 134 says of its own):
-- this one is the owner's D27-324 and changes only with them.
create or replace function app.voids_paid_pos_bills(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm'));
$$;

comment on function app.voids_paid_pos_bills(uuid) is
  'D27-324: the owner, an administrator or the GM at this hotel, or a group '
  'administrator, may void a paid restaurant bill.';

revoke all on function app.voids_paid_pos_bills(uuid) from public;
grant execute on function app.voids_paid_pos_bills(uuid) to pms_app;


-- ── The void, as the database holds it ───────────────────────────────────
-- The route refuses first, each with a sentence; this is the guarantee
-- behind it. A session with no person (a migration, the superuser's own
-- repair) is not asked who it is.
create or replace function app.pos_order_void_guard()
returns trigger
language plpgsql
as $$
begin
  -- Void for good, and who, when and why stay as written.
  if old.status = 'void' then
    if new.status is distinct from 'void'
       or (new.voided_by, new.voided_at, new.void_reason, new.void_reference)
          is distinct from (old.voided_by, old.voided_at, old.void_reason, old.void_reference) then
      raise exception 'Bill % is void and stays as it was voided.', old.order_no using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is distinct from 'void' then
    return new;
  end if;

  if app.current_user_id() is not null and not app.voids_paid_pos_bills(new.hotel_id) then
    raise exception 'Voiding a paid bill is for the owner, an administrator or the general manager.'
      using errcode = '42501';
  end if;
  if old.status <> 'settled' then
    raise exception 'Only a paid bill is voided; bill % is %.', old.order_no, old.status
      using errcode = '23514';
  end if;
  if coalesce(old.payment_method, '') in ('room', 'function')
     or coalesce(new.payment_method, '') in ('room', 'function') then
    raise exception 'Bill % went to a room or a function: it is reversed on that bill.', old.order_no
      using errcode = '23514';
  end if;
  if old.business_date <> app.business_date(new.hotel_id) then
    raise exception 'Bill % is of %: only the same business day is voided.', old.order_no, old.business_date
      using errcode = '23514';
  end if;
  if exists (select 1 from pos_day_ends d
              where d.outlet_id = old.outlet_id and d.business_date = old.business_date
                and d.closed_at is not null) then
    raise exception 'The restaurant''s day is closed: bill % is not voided.', old.order_no
      using errcode = '23514';
  end if;
  if exists (select 1 from pos_order_tenders t
              where t.order_id = old.id and t.method in ('card', 'upi'))
     and length(btrim(coalesce(new.void_reference, ''))) = 0 then
    raise exception 'A card or UPI bill names the refund''s reference.' using errcode = '23514';
  end if;

  -- Who and when are the database's, not the caller's.
  new.voided_by := coalesce(app.current_user_id(), new.voided_by);
  new.voided_at := now();
  return new;
end $$;

drop trigger if exists pos_orders_void_guard on pos_orders;
create trigger pos_orders_void_guard
  before update on pos_orders
  for each row execute function app.pos_order_void_guard();


-- ── Its alcohol's VAT bill is cancelled with it ──────────────────────────
-- Finance's cancellation (invoices.ts, POST /vat-bills/:number/cancel), in
-- the same transaction as the void: a numbered row of the same series and
-- year, the figures negated, the reason, at most one per bill (135's index).
create or replace function app.pos_order_void_cancels_vat()
returns trigger
language plpgsql
as $$
begin
  insert into vat_bills (hotel_id, fin_year, number, recipient_name, taxable_value,
                         vat_total, total, business_date, cancels_id, reason, issued_by)
  select v.hotel_id, v.fin_year, app.next_vat_bill_number(v.hotel_id, v.fin_year),
         v.recipient_name, -v.taxable_value, -v.vat_total, -v.total,
         app.business_date(v.hotel_id), v.id,
         'Restaurant bill ' || new.order_no || ' voided: ' || new.void_reason,
         app.current_user_id()
    from vat_bills v
   where v.pos_order_id = new.id
     and v.cancels_id is null
     and not exists (select 1 from vat_bills c where c.cancels_id = v.id);
  return null;
end $$;

drop trigger if exists pos_orders_void_cancels_vat on pos_orders;
create trigger pos_orders_void_cancels_vat
  after update on pos_orders
  for each row when (new.status = 'void' and old.status is distinct from 'void')
  execute function app.pos_order_void_cancels_vat();


-- ── A voided bill's payments are evidence too ────────────────────────────
-- 212's version (a test hotel's reset may remove them), with one change: a
-- voided bill keeps its payments as a paid one does.
create or replace function app.pos_tender_settled_immutable()
returns trigger
language plpgsql
as $$
begin
  -- D27-296: a test hotel's settled bills, during its reset.
  if app.test_reset_allows(old.hotel_id) then
    return old;
  end if;
  if exists (select 1 from pos_orders
              where id = old.order_id and status in ('settled', 'void')) then
    raise exception 'tenders on a settled order cannot be removed'
      using hint = 'Reverse the bill instead. How money was taken is evidence.';
  end if;
  return old;
end $$;

