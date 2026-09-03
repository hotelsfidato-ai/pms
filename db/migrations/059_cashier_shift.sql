-- =============================================================================
-- 059 — the front desk shift
-- =============================================================================
-- Cashiering was the last placeholder route in the application, and its own
-- note said why: "unspecified — placeholder until the live flow is observed."
-- It has now been observed. It is a front-desk shift close: open with a float,
-- take receipts through the shift, count the drawer, hand over to whoever is
-- on next.
--
-- THE SAME SHAPE AS THE POS DAY END, deliberately, and not a second idea. That
-- close already answers the same questions — what was taken, what is expected,
-- what was counted, why they differ — and a front office that reasons about
-- its drawer differently from its restaurant is a front office where the two
-- get compared and nobody can.
--
-- A SEPARATE TABLE FROM `pos_cash_movements`, though. That one is keyed by
-- outlet; the front desk has no outlet, and widening a live table so a second
-- caller can leave the column null is how a NOT NULL becomes decorative.
--
-- WHAT IS EXPECTED IN THE DRAWER IS TIME-SCOPED, NOT DATE-SCOPED:
--
--   opening float
--   + cash receipts posted BY THIS CASHIER between open and close
--   + money put in
--   − money paid out
--   = expected
--
-- Keyed on the timestamp rather than the business date because a person can
-- work two shifts in one operating day, and the second must not inherit the
-- first's takings. The reversal rule is the Manager Report's: a receipt that
-- has been reversed is not money the cashier holds.
-- =============================================================================

create table if not exists cashier_shifts (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- Whose shift. Not who opened it: a supervisor may open a drawer for
  -- somebody else, and the money is still that person's to account for.
  staff_id      uuid not null references staff(id),
  business_date date not null,

  opened_at     timestamptz not null default now(),
  opened_by     uuid references staff(id),
  opening_cash  numeric(12,2) not null default 0,

  counted_cash  numeric(12,2),
  variance_reason text,

  -- Who takes the drawer next. Null when the shift simply ends — the last
  -- close of the night hands over to nobody.
  handed_to     uuid references staff(id),

  closed_by     uuid references staff(id),
  closed_at     timestamptz,

  constraint cashier_shifts_opening_sane check (opening_cash >= 0),
  constraint cashier_shifts_counted_sane check (
    counted_cash is null or counted_cash >= 0),
  -- Closed means counted, by somebody, at a time.
  constraint cashier_shifts_closed_complete check (
    closed_at is null
    or (counted_cash is not null and closed_by is not null))
);

-- ONE OPEN SHIFT PER PERSON. Two open drawers for one cashier means neither
-- can be reconciled, and the second one silently inherits nothing.
create unique index if not exists cashier_shifts_one_open
  on cashier_shifts (hotel_id, staff_id) where closed_at is null;

create index if not exists cashier_shifts_day_idx
  on cashier_shifts (hotel_id, business_date);

comment on table cashier_shifts is
  'A front-desk drawer between opening and handover. Same shape as the POS '
  'day end on purpose — a front office that reasons about its cash differently '
  'from its restaurant cannot compare the two.';


-- -----------------------------------------------------------------------------
-- Money in and out that is not a receipt
-- -----------------------------------------------------------------------------
create table if not exists cashier_movements (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  shift_id    uuid not null references cashier_shifts(id) on delete cascade,

  kind        text not null,
  amount      numeric(12,2) not null,
  -- Always. An unexplained hundred rupees out of a drawer is the thing a
  -- shift close exists to surface, and "misc" is what people type when the
  -- field is optional.
  reason      text not null,

  recorded_by uuid not null references staff(id),
  recorded_at timestamptz not null default now(),

  constraint cashier_movements_kind check (kind in (
    'expense',      -- paid out: a taxi, a courier
    'top_up',       -- put in: change from the safe
    'withdrawal'    -- taken out: cash to the safe mid-shift
  )),
  constraint cashier_movements_amount_positive check (amount > 0),
  constraint cashier_movements_reason_given check (length(trim(reason)) > 0)
);

create index if not exists cashier_movements_shift_idx
  on cashier_movements (shift_id);


create table if not exists cashier_denominations (
  shift_id uuid not null references cashier_shifts(id) on delete cascade,
  value    numeric(8,2) not null,
  count    int not null,

  primary key (shift_id, value),
  constraint cashier_denominations_count_sane check (count >= 0),
  constraint cashier_denominations_value_sane check (value > 0)
);


-- -----------------------------------------------------------------------------
-- What the drawer should hold
-- -----------------------------------------------------------------------------
-- Cash only. A card settlement never touched the drawer and a bill left on a
-- folio was not collected — counting either leaves the desk permanently short
-- by the amount of business done properly.
-- -----------------------------------------------------------------------------
create or replace function app.cashier_expected_cash(p_shift uuid)
returns numeric
language sql stable as $$
  with s as (select * from cashier_shifts where id = p_shift)
  select
    (select opening_cash from s)
    + coalesce((
        select sum(-fp.amount)
          from folio_postings fp
          join payments p on p.posting_id = fp.id
          cross join s
         where fp.hotel_id = s.hotel_id
           and fp.category = 'payment'
           and p.method = 'cash'
           and fp.posted_by = s.staff_id
           and fp.created_at >= s.opened_at
           and fp.created_at < coalesce(s.closed_at, now())
           /* A reversed receipt is not money in the drawer. Same rule the
              Manager Report and the cashier report already use. */
           and fp.reverses_id is null
           and not exists (
             select 1 from folio_postings rev where rev.reverses_id = fp.id)
      ), 0)
    + coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift and m.kind = 'top_up'), 0)
    - coalesce((select sum(m.amount) from cashier_movements m
                 where m.shift_id = p_shift
                   and m.kind in ('expense', 'withdrawal')), 0)
$$;

comment on function app.cashier_expected_cash(uuid) is
  'Opening float plus cash receipts taken by this cashier during this shift, '
  'plus money put in, less money paid out. Scoped by TIMESTAMP, not business '
  'date, because one person can work two shifts in an operating day and the '
  'second must not inherit the first''s takings.';


-- -----------------------------------------------------------------------------
-- A closed shift stays closed
-- -----------------------------------------------------------------------------
create or replace function app.cashier_shift_is_final()
returns trigger language plpgsql as $$
begin
  if old.closed_at is not null then
    raise exception 'that shift is already closed'
      using hint = 'A correction is a movement on the current shift, not an '
                   'edit of a finished one.';
  end if;
  return new;
end $$;

drop trigger if exists cashier_shifts_final on cashier_shifts;
create trigger cashier_shifts_final
  before update on cashier_shifts
  for each row execute function app.cashier_shift_is_final();


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cashier_shifts', 'cashier_movements']
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

alter table cashier_denominations enable row level security;
alter table cashier_denominations force  row level security;
drop policy if exists denominations_isolation on cashier_denominations;
create policy denominations_isolation on cashier_denominations
  for all
  using      ( shift_id in (select id from cashier_shifts) )
  with check ( shift_id in (select id from cashier_shifts) );

grant select, insert, update on cashier_shifts to pms_app;
grant select, insert on cashier_movements to pms_app;
grant select, insert, update, delete on cashier_denominations to pms_app;
grant execute on function app.cashier_expected_cash(uuid) to pms_app;
