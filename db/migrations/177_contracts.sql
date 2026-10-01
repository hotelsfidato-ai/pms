-- =============================================================================
-- 177 · Contracts: a company's record, and the rates it has agreed per hotel
-- =============================================================================
-- D27-178 (build every service still "Not built yet") and D27-184, the owner's
-- answers to the contracts lane's thirteen questions, all as recommended:
--
--   C-1  a contract prices by FIXED RATES or by a % OFF THE DAY'S RATE, one or
--        the other, chosen per contract
--   C-2  fixed rates are SINGLE and DOUBLE per room type and meal plan, either
--        may be a dash; a third guest pays the calendar's extra-person price
--   C-3  the contract in force on the ARRIVAL date prices every night (the
--        booking keeps the first night's price for every night, D27-61)
--   C-4  no contract figure for the room type and plan: the day's calendar
--        price, and the desk is told so
--   C-8  an agent's contract may carry a commission, stamped on the booking in
--        place of the booking source's (082's rule: stamped, never looked up)
--   C-9  credit is the COMPANY's, for the whole group: allowed or not, days and
--        limit. Companies already billed on credit start with it allowed
--   C-11 no two companies with one name or one GSTIN (asked by the route: an
--        index could fail a deploy on rows nobody has seen)
--
-- ⚠ NO DEFAULT PRICES. A figure nobody set is NULL and reads as a dash. 004
--   gave credit_limit and credit_days a default of 0 that nothing ever wrote
--   or read; here they become "not set" and 0 is no longer a value either.
--
-- Re-runnable. The two one-time changes to existing companies run only on the
-- first pass, so a manager's later "no credit" is never undone by a replay.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The company's record (004): what kind, where it is billed, whether on credit
-- -----------------------------------------------------------------------------
alter table companies add column if not exists kind    text not null default 'corporate';
alter table companies add column if not exists state   text;
alter table companies add column if not exists pincode text;

alter table companies drop constraint if exists companies_kind_valid;
alter table companies add constraint companies_kind_valid
  check (kind in ('corporate', 'travel_agent'));

alter table companies drop constraint if exists companies_pincode_format;
alter table companies add constraint companies_pincode_format
  check (pincode is null or pincode ~ '^[1-9][0-9]{5}$');

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'companies' and column_name = 'credit_allowed') then
    alter table companies add column credit_allowed boolean not null default false;
    /* C-9: a company a bill has already been sent to on credit keeps that
       credit - the same account the City ledger report names (a bill's own
       company, else its booking's). */
    update companies co set credit_allowed = true
     where exists (
       select 1 from payments p
         join folio_postings fp on fp.id = p.posting_id
         join folios f on f.id = fp.folio_id
         left join reservations r on r.id = coalesce(fp.reservation_id, f.reservation_id)
        where p.method = 'city_ledger'
          and coalesce(f.company_id, r.company_id) = co.id);
  end if;

  if exists (select 1 from information_schema.columns
              where table_name = 'companies' and column_name = 'credit_limit'
                and is_nullable = 'NO') then
    alter table companies alter column credit_limit drop not null;
    alter table companies alter column credit_limit drop default;
    alter table companies alter column credit_days  drop not null;
    alter table companies alter column credit_days  drop default;
    update companies set credit_limit = null where credit_limit = 0;
    update companies set credit_days  = null where credit_days  = 0;
  end if;
end $$;

alter table companies drop constraint if exists companies_credit_figures;
alter table companies add constraint companies_credit_figures
  check ((credit_limit is null or credit_limit > 0)
         and (credit_days is null or credit_days between 1 and 365));

comment on column companies.kind is
  'corporate | travel_agent (D27-184).';
comment on column companies.credit_allowed is
  'May a bill be sent to this company on credit ("Bill to company"). The '
  'group''s answer, at every hotel (C-9).';
comment on column companies.credit_limit is
  'Rupees. NULL is not set, a dash. Shown, not enforced, until a company''s '
  'payment is recorded (D27-152).';
comment on column companies.credit_days is
  'Days to pay. NULL is not set, a dash. Shown, not enforced (D27-152).';


-- -----------------------------------------------------------------------------
-- Who keeps the list: the owner, an administrator or a GM anywhere, or a group
-- administrator (C-6). 013 let only the owner and the GM change a company;
-- the administrator holds company:edit in the matrix and was refused here.
-- Reception may ADD one (C-7) - 013's insert policy already lets any staff.
-- -----------------------------------------------------------------------------
create or replace function app.keeps_companies()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm')
  )
$$;

comment on function app.keeps_companies() is
  'The owner, an administrator or a general manager at any hotel, or a group '
  'administrator (D27-184, C-6): who may change a company and its contracts.';

revoke all on function app.keeps_companies() from public;
grant execute on function app.keeps_companies() to public;

drop policy if exists companies_update on companies;
create policy companies_update on companies
  for update using ( app.keeps_companies() ) with check ( app.keeps_companies() );


-- -----------------------------------------------------------------------------
-- A contract: one company at one hotel, for a period
-- -----------------------------------------------------------------------------
create table if not exists contracts (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references hotels(id) on delete cascade,
  company_id       uuid not null references companies(id),
  name             text not null,
  valid_from       date not null,
  valid_to         date not null,
  -- C-1: fixed rates (contract_rates) or a % off the day's calendar price.
  pricing          text not null,
  discount_percent numeric(5,2),
  -- C-8: an agent's commission, stamped on the booking. NULL: none agreed.
  commission_pct   numeric(5,2),
  notes            text,
  is_active        boolean not null default true,
  updated_by       uuid references staff(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (hotel_id, id),
  constraint contracts_name_given check (length(trim(name)) between 1 and 80),
  constraint contracts_dates check (valid_to >= valid_from),
  constraint contracts_pricing_valid check (pricing in ('rates', 'discount')),
  constraint contracts_discount_shape check (
    (pricing = 'discount' and discount_percent > 0 and discount_percent <= 100)
    or (pricing = 'rates' and discount_percent is null)),
  constraint contracts_commission_sane check (
    commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)),
  -- C-3: one contract in force per company, hotel and date, or "which one
  -- priced it" has two answers.
  constraint contracts_one_in_force exclude using gist (
    hotel_id with =, company_id with =,
    daterange(valid_from, valid_to, '[]') with &&) where (is_active)
);

comment on table contracts is
  'A company''s agreed terms at one hotel for a period (D27-184): fixed rates '
  '(contract_rates) or a % off the day''s price, and an agent''s commission. '
  'The one in force on the arrival date prices the booking.';

-- C-2: single and double per room type and meal plan. No row, or a NULL, is a
-- dash: the booking takes the day's calendar price and says so (C-4).
create table if not exists contract_rates (
  hotel_id      uuid not null,
  contract_id   uuid not null,
  room_type_id  uuid not null,
  meal_plan     text not null references meal_plans(code),
  price_single  numeric(12,2),
  price_double  numeric(12,2),
  updated_at    timestamptz not null default now(),

  primary key (contract_id, room_type_id, meal_plan),
  foreign key (hotel_id, contract_id) references contracts (hotel_id, id) on delete cascade,
  foreign key (hotel_id, room_type_id) references room_types (hotel_id, id) on delete cascade,
  -- A price of 0 is a gift, and a gift is the booking's complimentary tick.
  constraint contract_rates_prices check (
    (price_single is null or price_single > 0)
    and (price_double is null or price_double > 0))
);

comment on table contract_rates is
  'A fixed-rate contract''s price per room per night, before tax: single (one '
  'guest) and double (two). NULL is not agreed, a dash. A third guest pays the '
  'calendar''s extra-person price (C-2).';

-- The contract a booking was made under, stamped (T-3): which one priced it
-- stays true when the contract later changes or ends.
alter table reservations add column if not exists contract_id uuid;
alter table reservations drop constraint if exists reservations_contract_fk;
alter table reservations add constraint reservations_contract_fk
  foreign key (hotel_id, contract_id) references contracts (hotel_id, id);

comment on column reservations.contract_id is
  'The contract in force for the booking''s company on arrival, stamped when '
  'the booking was made (D27-184). NULL: no contract.';

do $$
declare t text;
begin
  foreach t in array array['contracts', 'contract_rates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format(
      'create policy hotel_isolation on %I for all
         using      ( hotel_id in (select app.auth_hotel_ids()) )
         with check ( hotel_id in (select app.auth_hotel_ids()) )', t);
    execute format('grant select on %I to pms_app', t);
    -- Changed only by the people who keep the list (C-6), whatever the route.
    execute format('drop policy if exists kept_by_managers on %I', t);
    execute format(
      'create policy kept_by_managers on %I as restrictive
         for insert with check ( app.keeps_companies() )', t);
    execute format('drop policy if exists changed_by_managers on %I', t);
    execute format(
      'create policy changed_by_managers on %I as restrictive
         for update using ( app.keeps_companies() )', t);
    execute format('drop policy if exists removed_by_managers on %I', t);
    execute format(
      'create policy removed_by_managers on %I as restrictive
         for delete using ( app.keeps_companies() )', t);
    execute format('grant insert, update on %I to pms_app', t);
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function app.write_audit()', t || '_audit', t);
  end loop;
end $$;

-- A rate cleared on the form is removed, not left as a row of dashes. A
-- contract itself is never deleted: it is ended (is_active), and bookings
-- keep pointing at it.
grant delete on contract_rates to pms_app;
revoke delete on contracts from pms_app;

drop trigger if exists contracts_touch on contracts;
create trigger contracts_touch before update on contracts
  for each row execute function app.touch_updated_at();
drop trigger if exists contract_rates_touch on contract_rates;
create trigger contract_rates_touch before update on contract_rates
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- The contract in force (C-3)
-- -----------------------------------------------------------------------------
create or replace function app.contract_in_force(
  p_company uuid, p_hotel uuid, p_date date
)
returns table (id uuid, name text, commission_pct numeric)
language sql stable as $$
  select c.id, c.name, c.commission_pct
    from contracts c
   where c.company_id = p_company and c.hotel_id = p_hotel and c.is_active
     and p_date between c.valid_from and c.valid_to
$$;

comment on function app.contract_in_force(uuid, uuid, date) is
  'The company''s contract at this hotel in force on the date, if any. At most '
  'one: contracts_one_in_force.';

grant execute on function app.contract_in_force(uuid, uuid, date) to pms_app;


-- -----------------------------------------------------------------------------
-- One night under a contract
-- -----------------------------------------------------------------------------
-- app.tariff_for's rules, kept: a total is NULL, with `unpriced` naming what is
-- missing, whenever any part has no price - never a partial total, never 0.
--
--   discount  the day's calendar total less the %, to the paisa. An unpriced
--             calendar night stays unpriced.
--   rates     one guest: the single figure; two or more: the double, and
--             each guest past two pays the calendar's extra-person price,
--             adults first (tariff_for's order). A figure not agreed: the
--             calendar's own tariff, and from_contract is false (C-4).
-- -----------------------------------------------------------------------------
create or replace function app.contract_price(
  p_contract  uuid,
  p_room_type uuid,
  p_meal_plan text,
  p_date      date,
  p_adults    int,
  p_children  int
)
returns table (total numeric, unpriced text, from_contract boolean)
language plpgsql stable as $$
declare
  v_pricing text;
  v_pct     numeric;
  v_figure  numeric;
  v_adult   numeric;
  v_child   numeric;
  v_xa      int;
  v_xc      int;
  v_missing text[] := '{}';
begin
  select c.pricing, c.discount_percent into v_pricing, v_pct
    from contracts c where c.id = p_contract;

  if v_pricing = 'rates' then
    select case when p_adults + p_children = 1 then r.price_single else r.price_double end
      into v_figure
      from contract_rates r
     where r.contract_id = p_contract and r.room_type_id = p_room_type
       and r.meal_plan = p_meal_plan;
  end if;

  if v_pricing is null or (v_pricing = 'rates' and v_figure is null) then
    select t.total, t.unpriced, false into total, unpriced, from_contract
      from app.tariff_for(p_room_type, p_meal_plan, p_date, p_adults, p_children) t;
    return next;
    return;
  end if;

  from_contract := true;

  if v_pricing = 'discount' then
    select round(t.total * (100 - v_pct) / 100, 2), t.unpriced into total, unpriced
      from app.tariff_for(p_room_type, p_meal_plan, p_date, p_adults, p_children) t;
    return next;
    return;
  end if;

  v_xa := greatest(p_adults - 2, 0);
  v_xc := greatest(p_children - greatest(2 - p_adults, 0), 0);
  select a.adult, a.child into v_adult, v_child
    from app.extra_person_rates(p_room_type, p_meal_plan, p_date) a;
  if v_xa > 0 and v_adult is null then
    v_missing := array_append(v_missing, case when v_xa = 1
      then 'the extra adult' else v_xa || ' extra adults' end);
  end if;
  if v_xc > 0 and v_child is null then
    v_missing := array_append(v_missing, case when v_xc = 1
      then 'the extra child' else v_xc || ' extra children' end);
  end if;

  if array_length(v_missing, 1) is null then
    total := v_figure + v_xa * coalesce(v_adult, 0) + v_xc * coalesce(v_child, 0);
    unpriced := null;
  else
    total := null;
    unpriced := array_to_string(v_missing, ' and ');
  end if;
  return next;
end $$;

comment on function app.contract_price(uuid, uuid, text, date, int, int) is
  'One night for a party under a contract (D27-184): its single or double '
  'rate plus the calendar''s extra persons, or the day''s price less its %. '
  'No figure agreed: the calendar''s tariff with from_contract false. NULL '
  'total, with `unpriced` naming what is missing, never a partial one.';

grant execute on function app.contract_price(uuid, uuid, text, date, int, int) to pms_app;
