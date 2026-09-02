-- =============================================================================
-- 048 — who is at the table, who is serving it, and where the food is going
-- =============================================================================
-- The five icons above the bill, and one column that has existed since 034
-- with nothing setting it.
--
--   covers      how many people are eating. Feeds average-per-cover, which is
--               the number a restaurant actually runs on — revenue per table
--               says nothing when a table seats two some nights and six on
--               others.
--
--   waiter      who took it. Without this no per-waiter reporting can exist,
--               and it cannot be reconstructed afterwards: `opened_by` is
--               whoever was logged into the terminal, which on a shared till
--               is one person all evening.
--
--   customer    mobile, name, address, locality. Required to deliver anything,
--               and useful for a guest who comes back.
--
--   order_type  dine in · takeaway · room service · delivery. In the schema
--               since 034, displayed by the kitchen pass, and set by NOTHING.
--
--   held        parked. A table that has ordered drinks and is not ready to
--               order food should not be a bill somebody has to remember.
-- =============================================================================

alter table pos_orders
  add column if not exists covers            smallint,
  add column if not exists waiter_id         uuid references staff(id),
  add column if not exists customer_name     text,
  add column if not exists customer_phone    text,
  add column if not exists customer_address  text,
  add column if not exists customer_locality text,
  add column if not exists held_at           timestamptz;

comment on column pos_orders.covers is
  'People eating, not seats at the table. Average-per-cover is the metric a '
  'restaurant runs on, and it cannot be derived from anything else here.';

comment on column pos_orders.waiter_id is
  'Who took the order. NOT opened_by — that is whoever was signed into the '
  'terminal, which on a shared till is one person for the whole evening.';

comment on column pos_orders.held_at is
  'Parked. A table that has ordered drinks and is not ready for food should '
  'not be a bill a waiter has to remember.';

do $$
begin
  -- Zero covers is a table nobody is sitting at, which is not an order.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_covers_sane') then
    alter table pos_orders add constraint pos_orders_covers_sane
      check (covers is null or covers > 0);
  end if;

  /* YOU CANNOT DELIVER TO NOBODY.

     A delivery with no phone number is a bill that reaches the kitchen,
     gets cooked, and then cannot leave the building. The address can wait —
     a regular gives their number and the rest is already on file — but the
     number cannot.

     Enforced only once there is something to deliver: an order is created
     as dine-in and switched, and the constraint must not refuse the moment
     somebody taps the Delivery tab before typing anything. So it applies at
     SETTLEMENT, where the bill is real. */
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_orders_delivery_reachable') then
    alter table pos_orders add constraint pos_orders_delivery_reachable
      check (status <> 'settled'
             or order_type <> 'delivery'
             or (customer_phone is not null
                 and length(trim(customer_phone)) > 0));
  end if;
end $$;

create index if not exists pos_orders_waiter_idx
  on pos_orders (hotel_id, waiter_id, business_date)
  where waiter_id is not null;

create index if not exists pos_orders_customer_idx
  on pos_orders (hotel_id, customer_phone)
  where customer_phone is not null;


-- -----------------------------------------------------------------------------
-- A waiter works at this property
-- -----------------------------------------------------------------------------
-- The same rule 012 (D7) states for housekeeping, for the same reason: a
-- person from another property named on an order produces per-waiter figures
-- for somebody who was never in the building, and nobody notices because the
-- report still adds up.
-- -----------------------------------------------------------------------------
create or replace function app.pos_waiter_works_here()
returns trigger language plpgsql as $$
begin
  if new.waiter_id is null then
    return new;
  end if;

  if not exists (
    select 1 from staff_hotels sh
     where sh.staff_id = new.waiter_id and sh.hotel_id = new.hotel_id
  ) then
    raise exception 'that person does not work at this property'
      using hint = 'Per-waiter figures for somebody who was never in the '
                   'building still add up, which is why this is refused here.';
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_waiter_scope on pos_orders;
create trigger pos_orders_waiter_scope
  before insert or update of waiter_id on pos_orders
  for each row execute function app.pos_waiter_works_here();


-- -----------------------------------------------------------------------------
-- Average per cover
-- -----------------------------------------------------------------------------
-- The one figure this migration exists to make possible. Orders with no covers
-- recorded are EXCLUDED rather than counted as one — a missing number is not a
-- table of one, and treating it as one drags the average down by exactly the
-- amount of the carelessness.
-- -----------------------------------------------------------------------------
create or replace function app.pos_average_cover(
  p_hotel uuid, p_from date, p_to date
)
returns table (
  business_date date,
  orders        int,
  covers        int,
  revenue       numeric,
  per_cover     numeric
)
language sql stable as $$
  select
    o.business_date,
    count(*)::int,
    sum(o.covers)::int,
    sum((select payable from app.pos_order_total(o.id))),
    round(sum((select payable from app.pos_order_total(o.id)))
          / nullif(sum(o.covers), 0), 2)
  from pos_orders o
 where o.hotel_id = p_hotel
   and o.business_date between p_from and p_to
   and o.status = 'settled'
   and o.covers is not null
 group by o.business_date
 order by o.business_date;
$$;

comment on function app.pos_average_cover(uuid, date, date) is
  'Revenue per person, per day. Orders with no covers recorded are excluded, '
  'not counted as one — a missing number is not a table of one.';

grant execute on function app.pos_average_cover(uuid, date, date) to pms_app;
