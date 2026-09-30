-- =============================================================================
-- 163 — the float kept back, and the cash deposits log (D27-190, D27-191)
-- =============================================================================
-- Every cash point counts out at its close: the front desk's shifts (059) and
-- each restaurant outlet's day (050). What the count keeps in the drawer for
-- the next shift is typed at the close; THE REST IS CASH TO DEPOSIT, and the
-- GM banks it the next morning. The owner or the accountant verifies.
--
--   cash to deposit, per cash point and business day
--     = counted − float kept            each close of that day
--     + "To the safe"                   it waits in the safe for the bank
--     − "Cash in (change from the safe)"  it came out of the safe
--
-- THE LOG IS APPEND-ONLY, like the folio: a deposit is never edited or
-- deleted. A wrong one is reversed by a line of its own, with a reason, and
-- entered again. The only change a row ever takes is the verification
-- stamp, once, and the database refuses any other.
--
-- THE LOG STARTS FROM THE RELEASE (D27-191): a close made before this
-- migration has no float kept, so its cash to deposit is unknown - a dash,
-- never a zero - and the days before are not listed at all.
-- =============================================================================

alter table cashier_shifts add column if not exists kept_cash numeric(12,2);
alter table pos_day_ends   add column if not exists kept_cash numeric(12,2);

-- Kept is what the count left in the drawer: never more than was counted.
alter table cashier_shifts drop constraint if exists cashier_shifts_kept_sane;
alter table cashier_shifts add constraint cashier_shifts_kept_sane check (
  kept_cash is null or (kept_cash >= 0 and kept_cash <= counted_cash));
alter table pos_day_ends drop constraint if exists pos_day_ends_kept_sane;
alter table pos_day_ends add constraint pos_day_ends_kept_sane check (
  kept_cash is null or (kept_cash >= 0 and kept_cash <= counted_cash));

-- The close routes ask for it every time. The database does not insist: a
-- close without it (one made before this migration) is an unknown cash to
-- deposit, shown as a dash, and never read as zero.


-- -----------------------------------------------------------------------------
-- The deposits
-- -----------------------------------------------------------------------------
create table if not exists cash_deposits (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- The business day whose cash this banks. Several deposits may bank one
  -- day; a slip covering two days is one line per day, same slip number.
  business_date date not null,
  amount        numeric(12,2) not null,

  deposited_on  date,
  bank          text,
  slip_no       text,

  -- A reversal: the wrong line it takes back, once, and why.
  reverses_id   uuid unique references cash_deposits(id),
  reason        text,

  recorded_by   uuid not null references staff(id),
  recorded_at   timestamptz not null default now(),

  verified_by   uuid references staff(id),
  verified_at   timestamptz,

  constraint cash_deposits_a_deposit check (
    reverses_id is not null
    or (amount > 0 and deposited_on is not null
        and length(trim(coalesce(bank, ''))) > 0
        and length(trim(coalesce(slip_no, ''))) > 0)),
  constraint cash_deposits_a_reversal check (
    reverses_id is null
    or (amount < 0 and length(trim(coalesce(reason, ''))) > 0
        and verified_at is null)),
  constraint cash_deposits_verified_complete check (
    (verified_by is null) = (verified_at is null))
);

create index if not exists cash_deposits_day_idx
  on cash_deposits (hotel_id, business_date);

comment on table cash_deposits is
  'Cash banked, per business day it banks (D27-190). Append-only: a wrong '
  'line is reversed by a line of its own; only the verification is stamped, '
  'once.';

-- The one change a deposit takes: its verification, once, and nothing else.
create or replace function app.cash_deposit_verified_once()
returns trigger language plpgsql as $$
begin
  if old.verified_at is not null then
    raise exception 'that deposit is already verified';
  end if;
  if (new.id, new.hotel_id, new.business_date, new.amount, new.deposited_on,
      new.bank, new.slip_no, new.reverses_id, new.reason, new.recorded_by,
      new.recorded_at)
     is distinct from
     (old.id, old.hotel_id, old.business_date, old.amount, old.deposited_on,
      old.bank, old.slip_no, old.reverses_id, old.reason, old.recorded_by,
      old.recorded_at) then
    raise exception 'a deposit is never edited'
      using hint = 'Reverse it with a reason and record it again.';
  end if;
  return new;
end $$;

drop trigger if exists cash_deposits_verified_once on cash_deposits;
create trigger cash_deposits_verified_once
  before update on cash_deposits
  for each row execute function app.cash_deposit_verified_once();


-- -----------------------------------------------------------------------------
-- Why a day's deposits differ from its cash to deposit
-- -----------------------------------------------------------------------------
-- Red until explained (D27-191). An explanation counts for the deposits made
-- before it; a later deposit on that day asks again.
create table if not exists cash_deposit_notes (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  business_date date not null,
  reason        text not null,
  recorded_by   uuid not null references staff(id),
  recorded_at   timestamptz not null default now(),

  constraint cash_deposit_notes_reason_given check (length(trim(reason)) > 0)
);

create index if not exists cash_deposit_notes_day_idx
  on cash_deposit_notes (hotel_id, business_date);


-- -----------------------------------------------------------------------------
-- Cash to deposit, per cash point and business day
-- -----------------------------------------------------------------------------
-- Null where a close of that day kept no figure (a close from before this
-- migration): unknown is a dash, never a zero.
create or replace function app.cash_to_deposit(p_hotel uuid)
returns table (business_date date, point text, amount numeric)
language sql stable as $$
  select cs.business_date, 'Front desk'::text,
         case when bool_or(cs.kept_cash is null) then null
              else sum(cs.counted_cash - cs.kept_cash + coalesce(m.safe, 0)) end
    from cashier_shifts cs
    left join lateral (
      select sum(case mv.kind when 'withdrawal' then mv.amount
                              when 'top_up' then -mv.amount else 0 end) as safe
        from cashier_movements mv where mv.shift_id = cs.id) m on true
   where cs.hotel_id = p_hotel and cs.closed_at is not null
   group by cs.business_date
  union all
  select d.business_date, o.name,
         d.counted_cash - d.kept_cash + coalesce(m.safe, 0)
    from pos_day_ends d
    join pos_outlets o on o.id = d.outlet_id
    left join lateral (
      select sum(case mv.kind when 'withdrawal' then mv.amount
                              when 'top_up' then -mv.amount else 0 end) as safe
        from pos_cash_movements mv
       where mv.outlet_id = d.outlet_id and mv.business_date = d.business_date) m on true
   where d.hotel_id = p_hotel and d.closed_at is not null
$$;

comment on function app.cash_to_deposit(uuid) is
  'Per cash point and business day: counted less the float kept, plus To the '
  'safe, less Cash in from the safe (D27-191). Null where a close kept no '
  'figure - unknown, not zero.';


-- -----------------------------------------------------------------------------
-- Isolation and grants: insert and read only; the verification stamp alone
-- may be written afterwards.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cash_deposits', 'cash_deposit_notes']
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

revoke all on cash_deposits, cash_deposit_notes from pms_app;
grant select, insert on cash_deposits, cash_deposit_notes to pms_app;
grant update (verified_by, verified_at) on cash_deposits to pms_app;
grant execute on function app.cash_to_deposit(uuid) to pms_app;
