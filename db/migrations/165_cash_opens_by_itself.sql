-- =============================================================================
-- 165 — cash opens by itself after the night audit (D27-200, D27-201)
-- =============================================================================
-- The owner, after the hotel's supervisor: "after the night audit, the new
-- register is open, the new cash thing is open ... we don't need to open the
-- thing separately." So there is no counting step at the start of a day. The
-- opening balance is the float the last close kept; the closing count, its
-- reason, the float kept and the deposits log (163) all stay.
--
-- THE TILL: an outlet's day is open as soon as a float carries to it. That is
-- a derived fact, not a row - app.pos_opening_cash. Only an outlet's very
-- first day (no earlier close that kept a float) is counted once, by hand.
--
-- THE FRONT DESK stays per person. A kept float names the next person
-- (D27-201) and waits for them; their drawer opens by itself on it the first
-- time they take cash, and anyone else starts at ₹0. A FLOAT IS CARRIED ONCE:
-- cashier_float_claims says which drawer took which close's float, and its
-- primary key is what makes twice impossible.
-- =============================================================================

create table if not exists cashier_float_claims (
  -- The close whose kept float was taken up. One close, one taker.
  closed_shift_id   uuid primary key references cashier_shifts(id) on delete cascade,
  -- The drawer it opened, or was added to.
  taken_by_shift_id uuid not null references cashier_shifts(id) on delete cascade,
  claimed_at        timestamptz not null default now(),

  constraint cashier_float_claims_not_itself check (closed_shift_id <> taken_by_shift_id)
);

comment on table cashier_float_claims is
  'Which drawer took up the float a close kept (D27-200). The primary key is '
  'the rule: a kept float is carried into one drawer, once.';

alter table cashier_float_claims enable row level security;
alter table cashier_float_claims force  row level security;
drop policy if exists float_claims_isolation on cashier_float_claims;
create policy float_claims_isolation on cashier_float_claims
  for all
  using      ( closed_shift_id in (select id from cashier_shifts) )
  with check ( closed_shift_id in (select id from cashier_shifts) );

revoke all on cashier_float_claims from pms_app;
grant select, insert on cashier_float_claims to pms_app;


-- -----------------------------------------------------------------------------
-- The float waiting for one person at the desk
-- -----------------------------------------------------------------------------
-- Closes that kept a float, named this person, and have not been taken up.
-- A close that kept a float with nobody named (made before D27-201) is
-- nobody's: it is never carried.
create or replace function app.cashier_float_waiting(p_hotel uuid, p_staff uuid)
returns numeric
language sql stable as $$
  select coalesce(sum(cs.kept_cash), 0)
    from cashier_shifts cs
   where cs.hotel_id = p_hotel
     and cs.handed_to = p_staff
     and cs.closed_at is not null
     and cs.kept_cash > 0
     and not exists (select 1 from cashier_float_claims c
                      where c.closed_shift_id = cs.id)
$$;

comment on function app.cashier_float_waiting(uuid, uuid) is
  'The kept floats handed to this person and not yet taken up by a drawer of '
  'theirs (D27-201). What their drawer opens on; zero for anyone else.';

grant execute on function app.cashier_float_waiting(uuid, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- What an outlet's day opens on
-- -----------------------------------------------------------------------------
-- The day's own row once the night count (or the first-day count) has made
-- it; until then the float kept at the outlet's most recent close that kept
-- one, however many days back - the money is still in the tin. Null only on
-- the outlet's first-ever day: nothing has been counted, and unknown is not
-- zero.
create or replace function app.pos_opening_cash(p_outlet uuid, p_date date)
returns numeric
language sql stable as $$
  select coalesce(
    (select d.opening_cash from pos_day_ends d
      where d.outlet_id = p_outlet and d.business_date = p_date),
    (select d.kept_cash from pos_day_ends d
      where d.outlet_id = p_outlet and d.business_date < p_date
        and d.closed_at is not null and d.kept_cash is not null
      order by d.business_date desc limit 1))
$$;

comment on function app.pos_opening_cash(uuid, date) is
  'The float an outlet''s day opens on: its own row, else the float kept at '
  'the most recent close that kept one (D27-200). Null on the first-ever day.';

grant execute on function app.pos_opening_cash(uuid, date) to pms_app;

-- 050's sum, reading the opening from the one place above.
create or replace function app.pos_expected_cash(p_outlet uuid, p_date date)
returns numeric language sql stable as $$
  select
    coalesce(app.pos_opening_cash(p_outlet, p_date), 0)
    + coalesce((select sum(t.amount)
                  from pos_order_tenders t
                  join pos_orders o on o.id = t.order_id
                 where o.outlet_id = p_outlet and o.business_date = p_date
                   and o.status = 'settled' and t.method = 'cash'), 0)
    + coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and m.kind in ('top_up', 'due_collection')), 0)
    - coalesce((select sum(m.amount) from pos_cash_movements m
                 where m.outlet_id = p_outlet and m.business_date = p_date
                   and m.kind in ('expense', 'withdrawal')), 0)
$$;

comment on function app.pos_expected_cash(uuid, date) is
  'The day''s opening (app.pos_opening_cash) plus cash taken plus money put '
  'in, less money paid out. Cash ONLY - a card settlement never touched the tin.';
