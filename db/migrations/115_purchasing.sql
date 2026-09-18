-- =============================================================================
-- 115 · Purchasing — a request, an approval, an order, a delivery
-- =============================================================================
-- Phase 2C of docs/STOCK-AND-EQUIPMENT-PLAN.md and § 1 of
-- docs/BUILD-PLAN-2026-09-18.md. The owner's answers are D18-2, D18-3 and
-- D18-4 (docs/briefs/decisions-2026-09-18.md).
--
-- THIS INVENTS NOTHING. Every part it needs already exists and has been live
-- since 17 September:
--
--   approvals (076, 095)         one inbox, one engine. Its `purchase` kind has
--                                been defined since 076 and wired to NOTHING.
--                                This joins it.
--   suppliers (094)              who a thing is bought from
--   locations (094, 104)         the stores a delivery lands in
--   stock_movements (069, 112)   the Store's ledger, per store
--
-- WHAT IS NEW HERE, and why each is a row rather than code:
--
--   purchase_requesters      WHO MAY RAISE A REQUEST, per property (D18-2).
--                            The owner's words: a setting, changeable at any
--                            time WITHOUT A DEPLOY. Department heads (the
--                            kitchen, housekeeping) are switched on the day the
--                            owner wants them, not the day somebody ships.
--   purchase_requests        one record, from "we need rice" to "it arrived".
--   purchase_request_lines   what, how much, at what price, and what came.
--
-- WHAT THIS DOES NOT DO
--
--   * It does not decide anything. A purchase waits in the ONE approvals inbox
--     (076), decided by `app.decide_approval`, which already refuses a second
--     decision and refuses the asker deciding their own. The request's state is
--     READ from that row; it is never copied into this table, because a status
--     copied is a status that disagrees.
--   * It does not move stock. A delivery is a `receipt` written by the Store,
--     through the Store's own front door. This table records what was ordered
--     and what came - which may differ, and both stay.
--   * It does not invent a price. `unit_price` is NULL until somebody agrees
--     one, a screen shows "-" for it, and an order with an unpriced line CANNOT
--     BE SENT (app.mark_purchase_ordered raises). The owner's oldest rule,
--     enforced where it cannot be gone around.
--   * No amount ships above which the owner must approve: D18-4 is "no limit -
--     the GM approves every purchase", confirming D17-35. If that ever changes
--     it is a row in approval_rules, which is what 076 built it for.
--
-- Replay-safe (MEMORY 284, 293): it creates, and it never rewrites a constraint
-- an earlier migration owns. `approval_rules_kind_known` has accepted
-- 'purchase' since 076, so nothing here touches it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Who may raise a request, per property (D18-2)
-- -----------------------------------------------------------------------------
-- A ROLE and not a person, for the reason 076 gives about approvers: staff
-- leave, and a list pointing at somebody who left is a list that stops.
--
-- Switched OFF rather than deleted, like approval_rules beside it: who was
-- allowed to buy things last March is part of the record of what was bought.
-- -----------------------------------------------------------------------------
create table if not exists purchase_requesters (
  hotel_id   uuid not null references hotels(id) on delete cascade,
  role       text not null,

  is_active  boolean not null default true,
  set_by     uuid references staff(id),
  set_at     timestamptz not null default now(),

  primary key (hotel_id, role),
  -- app.assignable_roles() is THE list (078). A role offered here that the
  -- database refuses elsewhere is the fault 078 was written to end.
  constraint purchase_requesters_role_valid check (role = any (app.assignable_roles()))
);

comment on table purchase_requesters is
  'Who may raise a purchase request at this property (D18-2). A setting, so '
  'the owner switches a department head on without a deploy. A role, not a '
  'person. Switched off, never deleted.';

alter table purchase_requesters enable row level security;
alter table purchase_requesters force  row level security;
drop policy if exists hotel_isolation on purchase_requesters;
create policy hotel_isolation on purchase_requesters
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on purchase_requesters to pms_app;
-- REVOKED, not merely left out of the grant: migration 010 set DEFAULT
-- PRIVILEGES, so every new table hands pms_app DELETE by itself (094's note).
revoke delete on purchase_requesters from pms_app;


-- -----------------------------------------------------------------------------
-- The request, which becomes the order
-- -----------------------------------------------------------------------------
-- ONE row from beginning to end, because a request and the order it becomes are
-- the same piece of paper at two ages. A rejected request never becomes an
-- order, and the refusal is on its approval row where the GM wrote it.
--
-- `status` is where the request has got to IN THIS SERVICE. What the GM said is
-- not here: it is read from `approvals` through `approval_id`, exactly as
-- equipment reads its own (api/src/modules/equipment/equipment.ts).
-- -----------------------------------------------------------------------------
create table if not exists purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,

  -- The order's own reference, printed on the PDF the supplier receives.
  reference     text not null,

  -- WHICH STORE it is for. Where the delivery lands, and where the PDF tells
  -- the supplier to deliver. A place of kind `store` — checked below.
  store_id      uuid not null references locations(id),

  -- Chosen when the order is placed, not when it is asked for: you ask for rice
  -- before you decide who to buy it from.
  supplier_id   uuid references suppliers(id),

  -- WHY, in the asker's own words, and NOT OPTIONAL — the same rule 076 applies
  -- to every approval, for the same reason: a request with no reason is one an
  -- approver can only approve blind.
  reason        text not null,

  status        text not null default 'requested',

  -- The approval this is waiting on, or null where no rule called for one
  -- (076: a property with no rules can still buy nails).
  approval_id   uuid references approvals(id),

  requested_by  uuid not null references staff(id),
  requested_at  timestamptz not null default now(),

  ordered_at    timestamptz,
  ordered_by    uuid references staff(id),

  received_at   timestamptz,
  received_by   uuid references staff(id),
  -- What the store keeper wants on the record about the delivery: short
  -- delivery, a damaged case, a different brand.
  delivery_note text,

  cancelled_at     timestamptz,
  cancelled_by     uuid references staff(id),
  cancelled_reason text,

  updated_at    timestamptz not null default now(),

  unique (hotel_id, reference),
  constraint purchase_requests_reason_present check (length(btrim(reason)) > 0),
  constraint purchase_requests_status_known check (
    status in ('requested', 'ordered', 'received', 'cancelled')),

  -- An order that has been sent names its supplier and says who sent it and
  -- when. Half a fact is the row nobody can read back.
  constraint purchase_requests_ordered_complete check (
    status in ('requested', 'cancelled')
    or (supplier_id is not null and ordered_at is not null and ordered_by is not null)),
  constraint purchase_requests_received_complete check (
    status <> 'received'
    or (received_at is not null and received_by is not null)),
  -- A CANCELLATION WITHOUT A REASON IS THE ROW NOBODY CAN ACT ON — the shape
  -- 076's refusal check has, and 042's void before it. Written with an explicit
  -- `is not null`, because a check constraint PASSES on null.
  constraint purchase_requests_cancel_explained check (
    status <> 'cancelled'
    or (cancelled_at is not null and cancelled_by is not null
        and cancelled_reason is not null and length(btrim(cancelled_reason)) > 0))
);

comment on table purchase_requests is
  'A purchase, from "we need rice" to "it arrived". What the GM decided is NOT '
  'copied here -- it is read from the approvals row this points at, because a '
  'status copied is a status that disagrees.';

create index if not exists purchase_requests_queue
  on purchase_requests (hotel_id, status, requested_at desc);

drop trigger if exists purchase_requests_touch on purchase_requests;
create trigger purchase_requests_touch before update on purchase_requests
  for each row execute function app.touch_updated_at();

alter table purchase_requests enable row level security;
alter table purchase_requests force  row level security;
drop policy if exists hotel_isolation on purchase_requests;
create policy hotel_isolation on purchase_requests
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on purchase_requests to pms_app;
-- No delete: an order that was sent to a supplier happened. One that should not
-- have been is CANCELLED, with a reason, and stays.
revoke delete on purchase_requests from pms_app;


-- -----------------------------------------------------------------------------
-- What is on it
-- -----------------------------------------------------------------------------
-- `hotel_id` is carried on the line as well as on its request, the way
-- pos_order_lines carries it (028): one isolation rule, the same on every
-- table, rather than a policy that reaches through a parent.
--
-- ORDERED AND RECEIVED ARE TWO FIGURES AND BOTH STAY. The brief is explicit:
-- what was ordered and what actually came may differ, and the record holds
-- both. Nothing here overwrites `quantity` with what turned up.
-- -----------------------------------------------------------------------------
create table if not exists purchase_request_lines (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  request_id  uuid not null references purchase_requests(id) on delete cascade,

  line_no     integer not null,
  item_id     uuid not null references stock_items(id),

  quantity    numeric(12,3) not null,

  -- The AGREED price, per unit. NULL until somebody agrees one, and it prints
  -- as "-". An order with one of these still null cannot be sent.
  unit_price  numeric(12,2),

  -- What actually came, and what it actually cost. Null until the delivery.
  received_quantity  numeric(12,3),
  received_unit_cost numeric(12,2),

  note        text,

  unique (request_id, line_no),
  -- One line per item: two lines for the same rice is two people counting.
  unique (request_id, item_id),
  constraint purchase_request_lines_quantity_positive check (quantity > 0),
  constraint purchase_request_lines_price_sane check (
    unit_price is null or unit_price >= 0),
  constraint purchase_request_lines_received_sane check (
    (received_quantity is null or received_quantity >= 0)
    and (received_unit_cost is null or received_unit_cost >= 0))
);

comment on column purchase_request_lines.unit_price is
  'The AGREED price per unit. Null means nobody has agreed one: it shows "-", '
  'never 0, and the order cannot be sent until it is set.';
comment on column purchase_request_lines.received_quantity is
  'What actually came. Kept beside `quantity`, never over it -- the point of '
  'the delivery screen is that the two can differ and both are on the record.';

create index if not exists purchase_request_lines_request
  on purchase_request_lines (request_id, line_no);

alter table purchase_request_lines enable row level security;
alter table purchase_request_lines force  row level security;
drop policy if exists hotel_isolation on purchase_request_lines;
create policy hotel_isolation on purchase_request_lines
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on purchase_request_lines to pms_app;
revoke delete on purchase_request_lines from pms_app;


-- -----------------------------------------------------------------------------
-- A line, its request and its store all belong to ONE property
-- -----------------------------------------------------------------------------
-- Row level security scopes each table to the properties the caller may see. It
-- does NOT stop a caller who can see two properties from ordering Agra's rice
-- into Pune's store. This does.
--
-- And only a place of kind `store` holds stock (094) — the same rule 112 puts
-- on stock_movements, said here so a delivery cannot be aimed at the lobby.
-- -----------------------------------------------------------------------------
create or replace function app.purchase_request_place()
returns trigger
language plpgsql
as $fn$
declare v_kind text; v_hotel uuid;
begin
  select kind, hotel_id into v_kind, v_hotel from locations where id = new.store_id;
  if v_hotel is null or v_hotel <> new.hotel_id then
    raise exception 'That store is not at this property.'
      using errcode = 'foreign_key_violation';
  end if;
  if v_kind <> 'store' then
    raise exception 'Stock is delivered into a store, not into a %.', v_kind
      using errcode = 'check_violation';
  end if;

  if new.supplier_id is not null then
    perform 1 from suppliers where id = new.supplier_id and hotel_id = new.hotel_id;
    if not found then
      raise exception 'That supplier is not at this property.'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  return new;
end $fn$;

drop trigger if exists purchase_requests_place on purchase_requests;
create trigger purchase_requests_place
  before insert or update of store_id, supplier_id, hotel_id on purchase_requests
  for each row execute function app.purchase_request_place();


create or replace function app.purchase_line_belongs()
returns trigger
language plpgsql
as $fn$
declare v_hotel uuid;
begin
  select hotel_id into v_hotel from purchase_requests where id = new.request_id;
  if v_hotel is null or v_hotel <> new.hotel_id then
    raise exception 'That line is not on this property''s order.'
      using errcode = 'foreign_key_violation';
  end if;

  perform 1 from stock_items where id = new.item_id and hotel_id = new.hotel_id;
  if not found then
    raise exception 'That item is not in this property''s store.'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists purchase_request_lines_belong on purchase_request_lines;
create trigger purchase_request_lines_belong
  before insert or update of request_id, item_id, hotel_id on purchase_request_lines
  for each row execute function app.purchase_line_belongs();


-- -----------------------------------------------------------------------------
-- The order's own reference
-- -----------------------------------------------------------------------------
-- PO-5EL-2609-0001. Built like app.next_reference (092) and with the same trap
-- avoided: `lpad` CUTS a string longer than the length asked for, so at the
-- ten-thousandth order every reference would collapse to four digits and
-- `unique (hotel_id, reference)` would refuse every order after that
-- (MEMORY 280). Pad only what is shorter.
--
-- Its own count per hotel, not the booking one: an order is not a booking, and
-- a purchase reference sharing a counter with reservations reads as a booking
-- to everybody who has ever used a hotel system.
-- -----------------------------------------------------------------------------
create or replace function app.next_purchase_reference(p_hotel_id uuid)
returns text
language plpgsql
as $fn$
declare v_code text; v_tz text; v_next bigint;
begin
  select code, timezone into v_code, v_tz from hotels where id = p_hotel_id;
  if v_code is null then
    raise exception 'Unknown hotel %', p_hotel_id;
  end if;

  -- Serialised for THIS hotel until the transaction ends, so the caller must
  -- insert the request in the same transaction (092's rule).
  perform pg_advisory_xact_lock(hashtext('purchase_ref:' || p_hotel_id::text));

  select coalesce(max(substring(reference from '[0-9]+$')::bigint), 0) + 1
    into v_next
    from purchase_requests
   where hotel_id = p_hotel_id;

  return 'PO-' || v_code
      || '-' || to_char(now() at time zone coalesce(v_tz, 'Asia/Kolkata'), 'YYMM')
      || '-' || case when length(v_next::text) < 4
                     then lpad(v_next::text, 4, '0')
                     else v_next::text end;
end $fn$;

comment on function app.next_purchase_reference(uuid) is
  'The next purchase order reference for a hotel: PO-<code>-<YYMM>-<number>. '
  'Holds a per-hotel lock until the transaction ends, so the caller inserts the '
  'request in that same transaction. Never truncated (MEMORY 280).';

grant execute on function app.next_purchase_reference(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- May the person signed in raise one here? (D18-2)
-- -----------------------------------------------------------------------------
-- The setting is the authority, and it is asked HERE so a screen, a later
-- endpoint and a script all get the same answer.
--
-- A GROUP ADMINISTRATOR counts as the owner, which is how the whole system
-- reads them (api/src/routes/approvals.ts, `meAt`): they hold authority at
-- every property without a row at each.
-- -----------------------------------------------------------------------------
create or replace function app.may_raise_purchase(p_hotel uuid)
returns boolean
language sql
stable
as $fn$
  select exists (
    select 1 from staff s
     where s.id = app.current_user_id()
       and s.is_active
       and (
         (s.is_group_admin and exists (
            select 1 from purchase_requesters pr
             where pr.hotel_id = p_hotel and pr.role = 'owner' and pr.is_active))
         or exists (
            select 1 from staff_hotels sh
              join purchase_requesters pr
                on pr.hotel_id = sh.hotel_id and pr.role = sh.role
             where sh.staff_id = s.id and sh.hotel_id = p_hotel and pr.is_active))
  )
$fn$;

comment on function app.may_raise_purchase(uuid) is
  'Whether the signed-in person may raise a purchase request at this property '
  '(D18-2). Reads purchase_requesters, the per-property setting. A group '
  'administrator counts as the owner, as everywhere else.';

grant execute on function app.may_raise_purchase(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Sending the order
-- -----------------------------------------------------------------------------
-- THREE REFUSALS THAT MATTER, in the database rather than only in a route, for
-- the reason 076 gives: a control another endpoint can walk around is not a
-- control.
--
--   1. Not approved  — the whole point of D18-4.
--   2. No price      — the owner's oldest rule. An order that leaves this
--                      building with a blank against an item is an order the
--                      supplier prices themselves.
--   3. Already sent  — a second send is a second order to the same supplier.
-- -----------------------------------------------------------------------------
create or replace function app.mark_purchase_ordered(
  p_request  uuid,
  p_supplier uuid,
  p_by       uuid
) returns void
language plpgsql
as $fn$
declare v_row purchase_requests; v_approval text; v_unpriced int; v_lines int;
begin
  select * into v_row from purchase_requests where id = p_request for update;
  if v_row.id is null then
    raise exception 'No such purchase request.' using errcode = 'no_data_found';
  end if;

  if v_row.status <> 'requested' then
    raise exception 'That order was already %.', v_row.status
      using errcode = 'check_violation';
  end if;

  if v_row.approval_id is not null then
    select status into v_approval from approvals where id = v_row.approval_id;
    if v_approval is distinct from 'approved' then
      raise exception
        'This is waiting in the approvals inbox. It is ordered once it is approved.'
        using errcode = 'check_violation';
    end if;
  end if;

  select count(*), count(*) filter (where unit_price is null)
    into v_lines, v_unpriced
    from purchase_request_lines where request_id = p_request;

  if v_lines = 0 then
    raise exception 'There is nothing on this order.' using errcode = 'check_violation';
  end if;
  if v_unpriced > 0 then
    raise exception
      'Every line needs an agreed price before the order can be sent. % of them have none.',
      v_unpriced
      using errcode = 'check_violation';
  end if;

  if p_supplier is null then
    raise exception 'Who is this ordered from?' using errcode = 'check_violation';
  end if;

  update purchase_requests
     set status = 'ordered', supplier_id = p_supplier,
         ordered_at = now(), ordered_by = p_by
   where id = p_request;
end $fn$;

comment on function app.mark_purchase_ordered(uuid, uuid, uuid) is
  'Sends an order: refuses one that is not approved, one with a line nobody has '
  'priced, and one already sent. In the database, because a control another '
  'endpoint can walk around is not a control.';

grant execute on function app.mark_purchase_ordered(uuid, uuid, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Receiving it
-- -----------------------------------------------------------------------------
-- The stock itself is written by the STORE, through its own front door. This
-- only records that the delivery happened, and refuses one against an order
-- that was never sent.
-- -----------------------------------------------------------------------------
create or replace function app.mark_purchase_received(
  p_request uuid,
  p_by      uuid,
  p_note    text
) returns void
language plpgsql
as $fn$
declare v_row purchase_requests;
begin
  select * into v_row from purchase_requests where id = p_request for update;
  if v_row.id is null then
    raise exception 'No such purchase request.' using errcode = 'no_data_found';
  end if;
  if v_row.status <> 'ordered' then
    raise exception
      'A delivery is received against an order that has been sent. This one is %.',
      v_row.status
      using errcode = 'check_violation';
  end if;

  update purchase_requests
     set status = 'received', received_at = now(), received_by = p_by,
         delivery_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
end $fn$;

comment on function app.mark_purchase_received(uuid, uuid, text) is
  'Records that the delivery arrived. The stock is written by the Store, '
  'through its own door; this refuses a delivery against an order never sent.';

grant execute on function app.mark_purchase_received(uuid, uuid, text) to pms_app;


-- -----------------------------------------------------------------------------
-- The owner's two rules, at every property and every new one
-- -----------------------------------------------------------------------------
-- 095's shape exactly, and for its reason: a property created tomorrow needs
-- the same rules as one created today, and nothing would say so if a hotel
-- quietly arrived with no approver and nobody able to ask.
--
--   D18-4  the GM approves EVERY purchase, whatever the amount. `over_amount`
--          is NULL, which is "always" and is NOT the same as 0 (076's note).
--          `also_decided_by` is empty: the group owner may always decide
--          (api/src/routes/approvals.ts), and nobody else is named.
--   D18-2  the Inventory Manager (`stores`), the GM, the owner and an
--          administrator may raise one. Department heads are switched on by the
--          owner, on the screen, when they want them.
-- -----------------------------------------------------------------------------
insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
select h.id, 'purchase', 'gm', null, '{}'::text[] from hotels h
on conflict (hotel_id, kind, approver_role) do nothing;

insert into purchase_requesters (hotel_id, role)
select h.id, r.role
  from hotels h, unnest(array['stores', 'gm', 'owner', 'admin']) as r(role)
on conflict (hotel_id, role) do nothing;

-- SECURITY DEFINER for 095's reason: both tables FORCE row level security and a
-- property being created is not yet among its creator's hotels. It owns nothing
-- but these two inserts.
create or replace function app.purchasing_rules_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, also_decided_by)
  values (new.id, 'purchase', 'gm', null, '{}'::text[])
  on conflict (hotel_id, kind, approver_role) do nothing;

  insert into purchase_requesters (hotel_id, role)
  select new.id, r.role from unnest(array['stores', 'gm', 'owner', 'admin']) as r(role)
  on conflict (hotel_id, role) do nothing;

  return new;
end $fn$;

revoke all on function app.purchasing_rules_for_new_property() from public;

drop trigger if exists hotels_purchasing_rules on hotels;
create trigger hotels_purchasing_rules
  after insert on hotels
  for each row execute function app.purchasing_rules_for_new_property();


-- -----------------------------------------------------------------------------
-- The trail
-- -----------------------------------------------------------------------------
-- §20 of the requirements asks for "purchase approved" and 076 put the trigger
-- on `approvals`. What was ORDERED, and WHO WAS ALLOWED TO ORDER IT, are the
-- other halves of that question, and an auditor asks all three.
do $$
declare t text;
begin
  foreach t in array array['purchase_requesters', 'purchase_requests'] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function app.write_audit()', t, t);
  end loop;
end $$;
