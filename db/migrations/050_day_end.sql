-- =============================================================================
-- 050 — the restaurant's day end
-- =============================================================================
-- Three steps, as the screens have it:
--
--   Day End Overview  →  Cash Calculations  →  Finalize
--
-- THE SAME SHAPE AS THE NIGHT AUDIT, deliberately, and not a second one. The
-- hotel's audit refuses to close while something is wrong and NAMES it — a
-- due-out room that never checked out, because the two possible truths lead to
-- opposite postings and only a person at the desk knows which. A restaurant
-- close has the same character: an open table and an unsettled bill are both
-- questions a person answers, not conditions a job can decide.
--
-- WHAT THE DRAWER IS EXPECTED TO HOLD is derived, never stored:
--
--   opening float
--   + cash taken            settled orders whose tender was cash
--   + top-ups               money put IN during the shift
--   − expenses              money paid OUT of the drawer
--   − withdrawals           money taken to the safe
--   = expected
--
-- and the count is the notes actually in the tin. The difference between them
-- is the only figure anybody argues about, so it is calculated in one place
-- and shown before the close rather than discovered after it.
-- =============================================================================

create table if not exists pos_day_ends (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  outlet_id     uuid not null references pos_outlets(id) on delete cascade,
  business_date date not null,

  -- What was in the tin at the start. Entered, because the previous close
  -- may have left a different float than it counted.
  opening_cash  numeric(12,2) not null default 0,

  -- What the count came to. Null until somebody counts.
  counted_cash  numeric(12,2),

  -- A count that does not match is not refused — it is RECORDED, with a
  -- reason. Refusing it would mean a shift that cannot close, and the money
  -- is already whatever it is.
  variance_reason text,

  closed_by     uuid references staff(id),
  closed_at     timestamptz,

  created_at    timestamptz not null default now(),

  unique (outlet_id, business_date),
  constraint pos_day_ends_opening_sane check (opening_cash >= 0),
  constraint pos_day_ends_counted_sane check (
    counted_cash is null or counted_cash >= 0),

  -- Closed means counted, by somebody, at a time. A close missing any of the
  -- three is a day nobody can be asked about.
  constraint pos_day_ends_closed_complete check (
    closed_at is null
    or (counted_cash is not null and closed_by is not null))
);

comment on table pos_day_ends is
  'One row per outlet per operating day. Created when the count starts, '
  'closed when somebody finalises it.';

comment on column pos_day_ends.variance_reason is
  'Why the count differs from what was expected. Not a refusal — the money is '
  'already whatever it is, and a shift that cannot close is worse than a '
  'difference that is written down.';


-- -----------------------------------------------------------------------------
-- Money in and out of the drawer, that is not a sale
-- -----------------------------------------------------------------------------
create table if not exists pos_cash_movements (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  outlet_id     uuid not null references pos_outlets(id) on delete cascade,
  business_date date not null,

  kind          text not null,
  amount        numeric(12,2) not null,

  -- Always. An unexplained hundred rupees out of a till is the thing a day
  -- end exists to surface, and "misc" is what people type when the field is
  -- optional.
  reason        text not null,

  recorded_by   uuid not null references staff(id),
  recorded_at   timestamptz not null default now(),

  constraint pos_cash_movements_kind check (kind in (
    'expense',        -- paid out: a delivery of vegetables, a repair
    'top_up',         -- put in: change brought from the safe
    'withdrawal',     -- taken out: cash to the safe mid-shift
    'due_collection'  -- a bill settled to an account, paid later in cash
  )),
  constraint pos_cash_movements_amount_positive check (amount > 0),
  constraint pos_cash_movements_reason_given check (length(trim(reason)) > 0)
);

create index if not exists pos_cash_movements_day_idx
  on pos_cash_movements (outlet_id, business_date);


-- -----------------------------------------------------------------------------
-- The count
-- -----------------------------------------------------------------------------
-- Notes and coins, counted by denomination. Stored rather than just a total
-- because a drawer that is short by exactly one 500 is a different
-- conversation from one short by 500 in mixed change.
-- -----------------------------------------------------------------------------
create table if not exists pos_denominations (
  day_end_id uuid not null references pos_day_ends(id) on delete cascade,
  value      numeric(8,2) not null,
  count      int not null,

  primary key (day_end_id, value),
  constraint pos_denominations_count_sane check (count >= 0),
  constraint pos_denominations_value_sane check (value > 0)
);

comment on table pos_denominations is
  'The notes actually in the tin. Kept per denomination because short by one '
  '500 is a different conversation from short by 500 in mixed change.';


-- -----------------------------------------------------------------------------
-- What the drawer should hold
-- -----------------------------------------------------------------------------
-- Cash only. A card settlement never touched the tin, and a bill charged to a
-- room reached a folio — counting either would leave the drawer permanently
-- "short" by the amount of business done properly.
-- -----------------------------------------------------------------------------
create or replace function app.pos_expected_cash(p_outlet uuid, p_date date)
returns numeric language sql stable as $$
  select
    coalesce((select opening_cash from pos_day_ends
               where outlet_id = p_outlet and business_date = p_date), 0)
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
  'Opening float plus cash taken plus money put in, less money paid out. Cash '
  'ONLY — a card settlement never touched the tin, and counting it would leave '
  'the drawer permanently short by the amount of business done properly.';


-- -----------------------------------------------------------------------------
-- The overview
-- -----------------------------------------------------------------------------
create or replace function app.pos_day_summary(p_outlet uuid, p_date date)
returns table (
  settled_orders  int,
  settled_value   numeric,
  abandoned_orders int,
  abandoned_value  numeric,
  comp_orders     int,
  discount_given  numeric,
  by_method       jsonb
)
language sql stable as $$
  with mine as (
    select o.id, o.status,
           (select payable from app.pos_order_total(o.id)) as payable,
           (select discount from app.pos_order_total(o.id)) as discount
      from pos_orders o
     where o.outlet_id = p_outlet and o.business_date = p_date
  )
  select
    count(*) filter (where status = 'settled')::int,
    coalesce(sum(payable) filter (where status = 'settled'), 0),
    /* Abandoned is not cancelled-and-forgotten: every one carries a reason,
       and the total is what walked out of the door. */
    count(*) filter (where status = 'abandoned')::int,
    coalesce(sum(payable) filter (where status = 'abandoned'), 0),
    count(*) filter (where status = 'settled' and payable = 0)::int,
    coalesce(sum(discount) filter (where status = 'settled'), 0),
    coalesce((
      select jsonb_object_agg(method, total) from (
        select t.method, sum(t.amount) as total
          from pos_order_tenders t
          join pos_orders o2 on o2.id = t.order_id
         where o2.outlet_id = p_outlet and o2.business_date = p_date
           and o2.status = 'settled'
         group by t.method
      ) x
    ), '{}'::jsonb)
  from mine;
$$;

comment on function app.pos_day_summary(uuid, date) is
  'The overview cards: what was settled, what walked out, what was given away, '
  'and how the money arrived.';


-- -----------------------------------------------------------------------------
-- What stops a close
-- -----------------------------------------------------------------------------
-- The night audit's rule, in a restaurant: only the things a PERSON must
-- decide. A drawer that does not balance is recorded with a reason rather than
-- refused — the money is already whatever it is — but an open table and an
-- unsettled bill are questions nobody else can answer.
-- -----------------------------------------------------------------------------
create or replace function app.pos_day_end_blockers(p_outlet uuid, p_date date)
returns table (id text, reason text, detail text)
language sql stable as $$
  select 'open_orders',
         /* Singular and plural all the way through the sentence. "There is
            1 bill still open. Settle them" is the sort of thing nobody
            notices in a migration and everybody notices on a screen. */
         case when n = 1
           then 'There is 1 bill still open. Settle it, or close it unpaid '
                || 'with a reason — the day end will not decide which.'
           else 'There are ' || n || ' bills still open. Settle them, or '
                || 'close them unpaid with a reason — the day end will not '
                || 'decide which.'
         end,
         string_agg(order_no, ', ')
    from (select order_no, count(*) over () as n
            from pos_orders
           where outlet_id = p_outlet and business_date = p_date
             and status = 'open') x
   group by n
  union all
  select 'uncleared_tables',
         case when n = 1
           then '1 table has a settled bill that was never cleared. Clear it '
                || 'so tomorrow starts with an empty floor.'
           else n || ' tables have a settled bill that was never cleared. '
                || 'Clear them so tomorrow starts with an empty floor.'
         end,
         string_agg(label, ', ')
    from (select t.label, count(*) over () as n
            from pos_orders o
            join pos_tables t on t.id = o.table_id
           where o.outlet_id = p_outlet and o.business_date = p_date
             and o.status = 'settled' and o.cleared_at is null) y
   group by n;
$$;

comment on function app.pos_day_end_blockers(uuid, date) is
  'Only what a PERSON must decide. A drawer that does not balance is recorded '
  'with a reason, not refused — but an open bill and an uncleared table are '
  'questions nobody else can answer.';


-- -----------------------------------------------------------------------------
-- A closed day stays closed
-- -----------------------------------------------------------------------------
create or replace function app.pos_day_end_is_final()
returns trigger language plpgsql as $$
begin
  if old.closed_at is not null then
    raise exception 'the day end for % is already closed', old.business_date
      using hint = 'A correction is a movement on today, not an edit of '
                   'yesterday.';
  end if;
  return new;
end $$;

drop trigger if exists pos_day_ends_final on pos_day_ends;
create trigger pos_day_ends_final
  before update on pos_day_ends
  for each row execute function app.pos_day_end_is_final();


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pos_day_ends', 'pos_cash_movements']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;
end $$;

-- Denominations hang off a day end that is already isolated. A hotel_id here
-- would be a third place for the same fact to be wrong.
alter table pos_denominations enable row level security;
alter table pos_denominations force  row level security;
drop policy if exists denominations_isolation on pos_denominations;
create policy denominations_isolation on pos_denominations
  for all
  using      ( day_end_id in (select id from pos_day_ends) )
  with check ( day_end_id in (select id from pos_day_ends) );

grant select, insert, update on pos_day_ends            to pms_app;
grant select, insert         on pos_cash_movements      to pms_app;
grant select, insert, update, delete on pos_denominations to pms_app;
grant execute on function app.pos_expected_cash(uuid, date)     to pms_app;
grant execute on function app.pos_day_summary(uuid, date)       to pms_app;
grant execute on function app.pos_day_end_blockers(uuid, date)  to pms_app;
