-- =============================================================================
-- 265 · Coupons: a promotion with a code the guest brings (D27-383 item 9;
--       built under D27-396)
-- =============================================================================
-- A coupon is a row of 083's pos_promotions - a code, a name, a percentage or
-- an amount off - with its own limits:
--
--   * valid_from, valid_to: the business dates it may go on a bill (both kept);
--   * max_uses: how many bills may carry it; NULL is no limit;
--   * min_bill: the least the dishes come to before it applies; NULL is none;
--   * is_coupon: typed from the guest's code at the Till or the Terminal, never
--     a button in the promotions list.
--
-- Each use is the bill itself: pos_orders.promotion_id. A bill closed unpaid
-- gives its use back; a paid, voided or NC one keeps it (app.pos_coupon_uses).
-- Never more than the bill: the till refuses it, and the arithmetic caps any
-- discount at the bill anyway (125).
--
-- The till checks first and says why; the trigger below refuses behind it, and
-- locks the coupon so two tills cannot both take its last use.
--
-- Re-runnable.
-- =============================================================================

alter table pos_promotions add column if not exists is_coupon  boolean not null default false;
alter table pos_promotions add column if not exists valid_from date;
alter table pos_promotions add column if not exists valid_to   date;
alter table pos_promotions add column if not exists max_uses   int;
alter table pos_promotions add column if not exists min_bill   numeric(12,2);

alter table pos_promotions drop constraint if exists pos_promotions_coupon_shape;
alter table pos_promotions add constraint pos_promotions_coupon_shape check (
  (max_uses is null or max_uses > 0)
  and (min_bill is null or min_bill > 0)
  and (valid_from is null or valid_to is null or valid_from <= valid_to)
  and (not is_coupon or (valid_from is not null and valid_to is not null)));

comment on column pos_promotions.is_coupon is
  'A coupon (261): its code is typed from what the guest brings, between valid_from and valid_to, '
  'at most max_uses bills, on a bill of at least min_bill.';

/* A coupon's uses: every bill that carries it, but one closed unpaid. */
create or replace function app.pos_coupon_uses(p_promotion uuid)
returns int
language sql stable as $$
  select count(*)::int from pos_orders
   where promotion_id = p_promotion and status <> 'abandoned';
$$;
grant execute on function app.pos_coupon_uses(uuid) to pms_app;

create or replace function app.pos_order_coupon_guard()
returns trigger
language plpgsql
as $$
declare
  p record;
  v_net numeric;
begin
  if new.promotion_id is null or new.promotion_id is not distinct from old.promotion_id then
    return new;
  end if;
  -- Locked: the second till waits here and then counts the first one's use.
  select * into p from pos_promotions where id = new.promotion_id for update;
  if not p.is_coupon and p.valid_from is null and p.valid_to is null
     and p.max_uses is null and p.min_bill is null then
    return new;
  end if;
  if not p.is_active then
    raise exception 'Coupon % is switched off.', p.code using errcode = '23514';
  end if;
  if (p.valid_from is not null and new.business_date < p.valid_from)
     or (p.valid_to is not null and new.business_date > p.valid_to) then
    raise exception 'Coupon % is not valid on %.', p.code, new.business_date using errcode = '23514';
  end if;
  if p.max_uses is not null
     and (select count(*) from pos_orders o
           where o.promotion_id = p.id and o.status <> 'abandoned' and o.id <> new.id) >= p.max_uses then
    raise exception 'Coupon % has been used % times, its limit.', p.code, p.max_uses using errcode = '23514';
  end if;
  if p.min_bill is not null then
    select net into v_net from app.pos_order_total(new.id);
    if coalesce(v_net, 0) < p.min_bill then
      raise exception 'Coupon % needs a bill of at least %.', p.code, p.min_bill using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_coupon_guard on pos_orders;
create trigger pos_orders_coupon_guard
  before update of promotion_id on pos_orders
  for each row execute function app.pos_order_coupon_guard();
