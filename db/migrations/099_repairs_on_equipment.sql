-- =============================================================================
-- Repairs on equipment, and what a repair cost — with its proof (phase 2B)
-- =============================================================================
-- docs/STOCK-AND-EQUIPMENT-PLAN.md phase 2B, built by the housekeeping service,
-- whose `work_orders` (058) are the repairs. Refer to this file by what it does
-- — "repairs on equipment" — never by its number (plan § 7).
--
-- THE OWNER'S ANSWERS, 17 September (docs/briefs/decisions-2026-09-17.md, and
-- the questions put to them the same morning):
--
--   D17-5  who records a cost: owner, admin, GM, Hotel Manager, Inventory
--          Manager. The API holds that list (costRoles.ts) — this file holds
--          what a cost IS, whoever sends it.
--   D17-6  no approval, but NO COST WITHOUT PROOF: a photo or screenshot of
--          the bill, the payment or the transaction, kept in `attachments`
--          (077). A cost row cannot exist without one — refused here, not only
--          on the screen.
--   D17-7  opening a repair on an item makes it "Under repair", closing it
--          makes it "In use". The equipment tables are the equipment service's,
--          so that is done through its front door by the API, not by a
--          trigger here reaching into them.
--   asked  a repair points at ONE TAGGED item, or at none. A counted line
--          ("12 kettles in 104") is not repaired — marking it would mark the
--          working ones too.
--   asked  a repair may carry SEVERAL costs, each with its own proof — a visit
--          and then a part are two bills.
--   asked  a cost is never edited or deleted. A wrong one is CANCELLED, with
--          who, when and why, and stays on the record out of the total.
--
-- EVERY STATEMENT HERE CAN RUN TWICE. Every deploy replays every migration
-- from 001 (root MEMORY 284): columns and tables "if not exists", constraints
-- added only when absent, triggers and policies dropped and made again.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A repair can point at a piece of equipment
-- -----------------------------------------------------------------------------
alter table work_orders add column if not exists equipment_item_id uuid;

do $$
begin
  -- The pair a cost's foreign key needs, so a cost cannot name a repair at
  -- another property. Always true of existing rows: `id` is already unique.
  if not exists (select 1 from pg_constraint
                  where conname = 'work_orders_hotel_id_id_key') then
    alter table work_orders
      add constraint work_orders_hotel_id_id_key unique (hotel_id, id);
  end if;

  -- The item is at the same property as the repair. equipment_items carries
  -- `unique (hotel_id, id)` for exactly this (the equipment register).
  if not exists (select 1 from pg_constraint
                  where conname = 'work_orders_equipment_same_hotel') then
    alter table work_orders
      add constraint work_orders_equipment_same_hotel
      foreign key (hotel_id, equipment_item_id)
      references equipment_items (hotel_id, id);
  end if;
end $$;

create index if not exists work_orders_equipment_idx
  on work_orders (equipment_item_id) where equipment_item_id is not null;

comment on column work_orders.equipment_item_id is
  'The tagged piece of equipment this repair is for, or null — most repairs '
  '(a dripping tap, the lobby door) are for no item on the register.';

-- ONE TAGGED THING, CHOSEN WHEN THE REPAIR IS RAISED. Reading the item's
-- `held_as` is the only look this file takes at the register, and it only
-- reads. Changing the item later would leave one thing "Under repair" with
-- nothing open on it, and another in use with a repair open.
create or replace function app.work_order_equipment_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.equipment_item_id is distinct from old.equipment_item_id then
      raise exception 'The equipment a repair is for is chosen when it is raised.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.equipment_item_id is not null and not exists (
       select 1 from equipment_items i
        where i.id = new.equipment_item_id
          and i.hotel_id = new.hotel_id
          and i.held_as = 'tagged') then
    raise exception 'A repair points at one tagged item. A counted line is retired or replaced, not repaired.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists work_orders_equipment_guard on work_orders;
create trigger work_orders_equipment_guard
  before insert or update on work_orders
  for each row execute function app.work_order_equipment_guard();


-- -----------------------------------------------------------------------------
-- What a repair cost
-- -----------------------------------------------------------------------------
create table if not exists work_order_costs (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  work_order_id  uuid not null,

  -- Rupees, as typed. Never a default: a repair that cost nothing has no cost
  -- row at all, and a dash on the screen — never a zero (HANDOVER § 5).
  amount         numeric(12,2) not null,
  note           text,

  -- THE PROOF. Not null, and the guard below checks it is a file kept against
  -- THIS cost, at this property — not somebody else's bill reused.
  proof_id       uuid not null references attachments(id),

  recorded_by    uuid not null references staff(id),
  recorded_at    timestamptz not null default now(),

  -- A wrong cost is cancelled, never deleted: who, when and why, all three.
  cancelled_by   uuid references staff(id),
  cancelled_at   timestamptz,
  cancel_reason  text,

  constraint work_order_costs_order_same_hotel
    foreign key (hotel_id, work_order_id) references work_orders (hotel_id, id),
  constraint work_order_costs_amount_positive check (amount > 0),
  constraint work_order_costs_cancel_complete check (
    (cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or
    (cancelled_at is not null and cancelled_by is not null
     and length(btrim(coalesce(cancel_reason, ''))) > 0))
);

create index if not exists work_order_costs_order
  on work_order_costs (hotel_id, work_order_id, recorded_at);

comment on table work_order_costs is
  'What a repair cost. Each row carries its proof (a photo or screenshot of the '
  'bill, payment or transaction) and is never edited or deleted: a wrong one is '
  'cancelled with who, when and why, and stays on the record out of the total.';


-- -----------------------------------------------------------------------------
-- No cost without its proof; nothing about a cost changes but its cancelling
-- -----------------------------------------------------------------------------
create or replace function app.work_order_costs_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.cancelled_at is not null then
      raise exception 'A cost is recorded, then cancelled — not recorded cancelled.'
        using errcode = 'check_violation';
    end if;
    if not exists (
         select 1 from attachments a
          where a.id = new.proof_id
            and a.hotel_id = new.hotel_id
            and a.subject_table = 'work_order_costs'
            and a.subject_id = new.id) then
      raise exception 'A repair cost is recorded with its proof: a photo or screenshot of the bill, the payment or the transaction.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.cancelled_at is not null then
    raise exception 'A cancelled cost stays exactly as it was cancelled.'
      using errcode = 'check_violation';
  end if;
  if new.cancelled_at is null
     or new.hotel_id      is distinct from old.hotel_id
     or new.work_order_id is distinct from old.work_order_id
     or new.amount        is distinct from old.amount
     or new.note          is distinct from old.note
     or new.proof_id      is distinct from old.proof_id
     or new.recorded_by   is distinct from old.recorded_by
     or new.recorded_at   is distinct from old.recorded_at then
    raise exception 'A recorded cost is never changed. Cancel it with a reason, and record the right one with its proof.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Named to fire before the staff-scope triggers, which fire in name order
-- too (the equipment register's note on the same trap).
drop trigger if exists work_order_costs_1_guard on work_order_costs;
create trigger work_order_costs_1_guard
  before insert or update on work_order_costs
  for each row execute function app.work_order_costs_guard();

drop trigger if exists work_order_costs_recorded_by_scope on work_order_costs;
create trigger work_order_costs_recorded_by_scope
  before insert on work_order_costs
  for each row execute function app.assert_staff_has_hotel('recorded_by');

drop trigger if exists work_order_costs_cancelled_by_scope on work_order_costs;
create trigger work_order_costs_cancelled_by_scope
  before update on work_order_costs
  for each row execute function app.assert_staff_has_hotel('cancelled_by');

-- Money, and who wrote it: the shared audit trail.
drop trigger if exists work_order_costs_audit on work_order_costs;
create trigger work_order_costs_audit
  after insert or update on work_order_costs
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
alter table work_order_costs enable row level security;
alter table work_order_costs force  row level security;
drop policy if exists hotel_isolation on work_order_costs;
create policy hotel_isolation on work_order_costs
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on work_order_costs to pms_app;
-- REVOKED, not merely left out: 010's default privileges grant DELETE on
-- anything new.
revoke delete on work_order_costs from pms_app;
