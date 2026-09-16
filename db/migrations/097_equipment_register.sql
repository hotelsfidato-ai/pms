-- =============================================================================
-- The equipment register — everything durable in the hotel, the restaurant
-- and the rooms
-- =============================================================================
-- Phase 1B of docs/STOCK-AND-EQUIPMENT-PLAN.md (decisions S2, S7, S12–S16),
-- built by the equipment service. An AC, a TV, a fridge, an oven, a kettle, a
-- table. Not stock (the Store's: things used up), not door locks
-- (room-systems).
--
-- ⚠ REFER TO THIS FILE BY WHAT IT DOES, NEVER BY ITS NUMBER. The master
--   renumbers whichever of two lanes merges second (plan § 7). It was written
--   as 095 and became 097 when the master took 095 and 096 for the approvals.
--
-- THE OWNER'S ANSWERS THAT SHAPE IT (16 September; src/modules/equipment/MODULE.md)
--
--   * Categories: each property starts with NONE and grows its own list; the
--     same word in different capitals is one category.
--   * One by one with a tag, or a count in one place: the person adding chooses.
--   * The tag: the screen offers the next free number (EQ-0001…); a printed
--     label may be typed instead. No tag repeats at a property.
--   * A counted line's cost is PER PIECE; part of a count may move or be
--     retired, and becomes its own line WHEN ASKED.
--   * S12–S15: equipment going OUT of a store waits for the Inventory Manager
--     (the owner, an administrator or the GM instead); anybody who can see it
--     may ask. Between rooms, or into a store — another store included — is
--     recorded at once, by anybody who may edit.
--   * S16: a tagged item retired by somebody who may not approve waits in the
--     SAME shared approvals inbox, for the same people.
--
-- THE APPROVALS ARE THE CORE'S (076, 095, 096). Nothing here edits them. A
-- request is raised with `app.request_approval`, and decided on the core
-- endpoint — which records a DECISION and performs nothing (076's header). So
-- this file never copies a decision into its own tables. It WORKS OUT the
-- answer every time it is asked:
--
--   where a thing is     the latest move that needed no approval, or whose
--                        approval is `approved`           app.equipment_place
--   whether it is retired  retired directly, or an `equipment_retire` approval
--                        for it is `approved`             app.equipment_is_retired
--
-- A refused request therefore leaves a thing exactly where it was, and nothing
-- has to be undone.
--
-- THE RULES THIS FILE MAKES THE DATABASE'S, NOT A SCREEN'S
--
--   NEVER DELETED — revoked, not merely left out (010's default privileges).
--   EVERY THING IS SOMEWHERE — a room or a place, exactly one, from its first
--     move; checked when the transaction commits.
--   TAKING IT OUT OF A STORE NEEDS ITS APPROVAL — a move out of a store with no
--     request attached is refused while the property has the rule. A route
--     cannot skip the Inventory Manager by forgetting to ask.
--   ONE THING AT A TIME — while a move or a retirement waits, the thing does not
--     move again, change status or split.
--   A RETIRED THING NEVER CHANGES.
--   A COUNT CHANGES ONLY BY SPLITTING — the lines always add up.
--   THE HISTORY IS WRITTEN BY TRIGGERS, and the application may only read it.
--   NOTHING INVENTED — no category, item, cost or date is seeded; a cost nobody
--     typed is NULL (a dash), a warranty nobody entered is NULL (never "expired").
--
-- WHAT IT DOES NOT DO: repairs (phase 2B, housekeeping, `work_orders`), buying
-- (2C, purchasing). It changes no table it does not create; `locations` and
-- `suppliers` (094) carry no (hotel_id, id) key, so an item's place and supplier
-- are checked against its property by a trigger.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Categories — a list each property grows, starting empty
-- -----------------------------------------------------------------------------
create table if not exists equipment_categories (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  name        text not null,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),

  unique (hotel_id, id),
  constraint equipment_categories_name_present check (length(btrim(name)) > 0)
);

comment on table equipment_categories is
  'What kind of thing an item is — Furniture, Appliance, Kitchen equipment. '
  'Each property grows its own list from the add form; this schema ships none.';

create unique index if not exists equipment_categories_one_name
  on equipment_categories (hotel_id, lower(btrim(name)));

alter table equipment_categories enable row level security;
alter table equipment_categories force  row level security;
drop policy if exists hotel_isolation on equipment_categories;
create policy hotel_isolation on equipment_categories
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert on equipment_categories to pms_app;
revoke update, delete on equipment_categories from pms_app;

drop trigger if exists equipment_categories_staff_scope on equipment_categories;
create trigger equipment_categories_staff_scope
  before insert or update on equipment_categories
  for each row execute function app.assert_staff_has_hotel('created_by');


-- -----------------------------------------------------------------------------
-- The register
-- -----------------------------------------------------------------------------
-- No place column. Where a thing is lives in equipment_moves, and is worked out
-- (app.equipment_place) — because a move out of the store becomes true only when
-- somebody else approves it, on an endpoint this service does not own.
-- -----------------------------------------------------------------------------
create table if not exists equipment_items (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,

  name            text not null,
  category_id     uuid,

  held_as         text not null,             -- tagged | counted (S7)
  tag             text,
  quantity        integer not null default 1,

  supplier_id     uuid references suppliers(id),
  purchase_date   date,
  -- PER PIECE on a counted line; the item's own cost on a tagged one. NULL is
  -- "nobody typed it" — a dash, never a zero.
  unit_cost       numeric(12,2),
  warranty_ends   date,
  amc_ends        date,                      -- the service contract

  -- in_use | under_repair | retired. `retired` HERE is a retirement nobody had
  -- to approve; one approved in the inbox is found in `approvals`
  -- (app.equipment_is_retired asks both).
  status          text not null default 'in_use',
  retire_reason   text,
  retired_by      uuid references staff(id),
  retired_at      timestamptz,

  split_from      uuid,

  created_by      uuid references staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (hotel_id, id),

  constraint equipment_items_name_present check (length(btrim(name)) > 0),
  constraint equipment_items_held_as_known check (held_as in ('tagged', 'counted')),
  constraint equipment_items_status_known check (
    status in ('in_use', 'under_repair', 'retired')),
  constraint equipment_items_tag_or_count check (
    (held_as = 'tagged'  and tag is not null and length(btrim(tag)) > 0 and quantity = 1)
    or
    (held_as = 'counted' and tag is null and quantity >= 1)),
  constraint equipment_items_cost_sane check (unit_cost is null or unit_cost >= 0),
  constraint equipment_items_warranty_after_purchase check (
    warranty_ends is null or purchase_date is null or warranty_ends >= purchase_date),
  constraint equipment_items_amc_after_purchase check (
    amc_ends is null or purchase_date is null or amc_ends >= purchase_date),
  -- RETIRED MEANS WHO, WHEN AND WHY — all three, or it is not retired.
  constraint equipment_items_retired_complete check (
    (status = 'retired') = (retired_at is not null)
    and (retired_at is null or (retired_by is not null and retire_reason is not null))),

  constraint equipment_items_category_same_hotel
    foreign key (hotel_id, category_id) references equipment_categories (hotel_id, id),
  constraint equipment_items_split_same_hotel
    foreign key (hotel_id, split_from) references equipment_items (hotel_id, id)
);

comment on table equipment_items is
  'The register of durable things. Never deleted: a thing leaves by being '
  'retired. Where it is: equipment_moves (app.equipment_place). Whether it is '
  'retired: here, or an approved equipment_retire request (app.equipment_is_retired).';
comment on column equipment_items.unit_cost is
  'Per piece on a counted line; the item''s own cost on a tagged one. NULL '
  'means nobody typed it — a dash, never a zero.';
comment on column equipment_items.quantity is
  'Always 1 on a tagged item. On a counted line it changes ONLY by splitting '
  'part off as its own line (split_from), so the lines always add up.';

create unique index if not exists equipment_items_tag_unique
  on equipment_items (hotel_id, upper(btrim(tag))) where tag is not null;
create index if not exists equipment_items_hotel_status
  on equipment_items (hotel_id, status, name);

drop trigger if exists equipment_items_touch on equipment_items;
create trigger equipment_items_touch before update on equipment_items
  for each row execute function app.touch_updated_at();

alter table equipment_items enable row level security;
alter table equipment_items force  row level security;
drop policy if exists hotel_isolation on equipment_items;
create policy hotel_isolation on equipment_items
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on equipment_items to pms_app;
revoke delete on equipment_items from pms_app;

-- The shared audit trail (016, extended in 076): before and after of every write.
drop trigger if exists equipment_items_audit on equipment_items;
create trigger equipment_items_audit
  after insert or update or delete on equipment_items
  for each row execute function app.write_audit();

drop trigger if exists equipment_items_created_by_scope on equipment_items;
create trigger equipment_items_created_by_scope
  before insert or update on equipment_items
  for each row execute function app.assert_staff_has_hotel('created_by');
drop trigger if exists equipment_items_retired_by_scope on equipment_items;
create trigger equipment_items_retired_by_scope
  before insert or update on equipment_items
  for each row execute function app.assert_staff_has_hotel('retired_by');


-- -----------------------------------------------------------------------------
-- Moves — where each thing has been, and where it has been asked to go
-- -----------------------------------------------------------------------------
create table if not exists equipment_moves (
  id               uuid primary key default gen_random_uuid(),
  -- The order moves happened in. A uuid has none, and "the latest move" is the
  -- whole question app.equipment_place answers.
  seq              bigint generated always as identity,
  hotel_id         uuid not null references hotels(id) on delete cascade,
  item_id          uuid not null,

  -- placed  where a thing was put when it was added, or where a split line
  --         started. The first move of every item, and only the first.
  -- move    from one place to another — at once, or once approved.
  kind             text not null,

  from_room_id     uuid references rooms(id),
  from_location_id uuid references locations(id),
  to_room_id       uuid,
  to_location_id   uuid references locations(id),

  -- Why. Required by the approvals table when it leaves the store.
  note             text,

  -- The request, when it leaves a store (S12). A move with one counts only once
  -- that approval is `approved`; a move without one counts at once.
  approval_id      uuid references approvals(id),

  moved_by         uuid references staff(id),
  moved_at         timestamptz not null default now(),

  unique (seq),
  constraint equipment_moves_kind_known check (kind in ('placed', 'move')),
  constraint equipment_moves_one_place check (num_nonnulls(to_room_id, to_location_id) = 1),
  constraint equipment_moves_placed_from_nowhere check (
    kind = 'move' or (from_room_id is null and from_location_id is null and approval_id is null)),
  constraint equipment_moves_item_same_hotel
    foreign key (hotel_id, item_id) references equipment_items (hotel_id, id) on delete cascade,
  constraint equipment_moves_room_same_hotel
    foreign key (hotel_id, to_room_id) references rooms (hotel_id, id)
);

comment on table equipment_moves is
  'Every place each thing has stood, and every move asked for. Append-only. '
  'A move with an approval counts only once that approval is approved '
  '(app.equipment_place); a refused one leaves the thing where it was.';

create index if not exists equipment_moves_item on equipment_moves (item_id, seq desc);
create unique index if not exists equipment_moves_one_placed
  on equipment_moves (item_id) where kind = 'placed';

drop trigger if exists equipment_moves_append_only on equipment_moves;
create trigger equipment_moves_append_only
  before update or delete on equipment_moves
  for each row execute function app.forbid_mutation();

alter table equipment_moves enable row level security;
alter table equipment_moves force  row level security;
drop policy if exists hotel_isolation on equipment_moves;
create policy hotel_isolation on equipment_moves
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert on equipment_moves to pms_app;
revoke update, delete on equipment_moves from pms_app;

drop trigger if exists equipment_moves_staff_scope on equipment_moves;
create trigger equipment_moves_staff_scope
  before insert on equipment_moves
  for each row execute function app.assert_staff_has_hotel('moved_by');


-- -----------------------------------------------------------------------------
-- The history — added, split, status, retired, edited
-- -----------------------------------------------------------------------------
-- Moves are their own record (equipment_moves, with their approvals). This is
-- everything else that happens to a thing.
-- -----------------------------------------------------------------------------
create table if not exists equipment_history (
  id               bigint generated always as identity primary key,
  hotel_id         uuid not null references hotels(id) on delete cascade,
  item_id          uuid not null,

  kind             text not null,
  quantity         integer not null,

  -- Where it stood when this happened, for reading the history without
  -- replaying the moves.
  room_id          uuid references rooms(id),
  location_id      uuid references locations(id),
  from_status      text,
  to_status        text,
  related_item_id  uuid,
  changes          jsonb,
  note             text,

  done_by          uuid references staff(id),
  done_at          timestamptz not null default now(),

  constraint equipment_history_kind_known check (kind in (
    'added', 'split', 'status', 'retired', 'edited')),
  constraint equipment_history_quantity_positive check (quantity >= 1),
  constraint equipment_history_item_same_hotel
    foreign key (hotel_id, item_id) references equipment_items (hotel_id, id)
    on delete cascade
);

comment on table equipment_history is
  'What happened to each thing, who and when: added, split, status, retired, '
  'edited. Append-only, and written only by the triggers on equipment_items and '
  'equipment_moves — the application may read it and nothing else.';

create index if not exists equipment_history_item on equipment_history (item_id, id desc);

drop trigger if exists equipment_history_append_only on equipment_history;
create trigger equipment_history_append_only
  before update or delete on equipment_history
  for each row execute function app.forbid_mutation();

alter table equipment_history enable row level security;
alter table equipment_history force  row level security;
drop policy if exists hotel_isolation on equipment_history;
create policy hotel_isolation on equipment_history
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select on equipment_history to pms_app;
revoke insert, update, delete on equipment_history from pms_app;


-- -----------------------------------------------------------------------------
-- The answers, worked out every time
-- -----------------------------------------------------------------------------

-- WHERE A THING IS: its latest move that needed no approval, or whose approval
-- was approved. A waiting move, a refused one, one sent back: none of them.
create or replace function app.equipment_place(p_item uuid)
returns table (room_id uuid, location_id uuid, seq bigint)
language sql
stable
as $$
  select m.to_room_id, m.to_location_id, m.seq
    from equipment_moves m
    left join approvals a on a.id = m.approval_id
   where m.item_id = p_item
     and (m.approval_id is null or a.status = 'approved')
   order by m.seq desc
   limit 1
$$;

comment on function app.equipment_place(uuid) is
  'Where a thing is: its latest move that needed no approval, or whose approval '
  'is approved. Worked out every time — a decision on the core endpoint is '
  'never copied here, so it can never disagree with the inbox.';

-- A MOVE WAITING for a decision.
create or replace function app.equipment_move_waiting(p_item uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from equipment_moves m
      join approvals a on a.id = m.approval_id
     where m.item_id = p_item and a.status = 'pending')
$$;

-- A RETIREMENT WAITING for a decision (S16, the shared inbox).
create or replace function app.equipment_retire_waiting(p_item uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from approvals a
     where a.kind = 'equipment_retire' and a.subject_table = 'equipment_items'
       and a.subject_id = p_item and a.status = 'pending')
$$;

-- RETIRED: directly, or approved in the inbox.
create or replace function app.equipment_is_retired(p_item uuid)
returns boolean
language sql
stable
as $$
  select exists (select 1 from equipment_items i where i.id = p_item and i.status = 'retired')
      or exists (
           select 1 from approvals a
            where a.kind = 'equipment_retire' and a.subject_table = 'equipment_items'
              and a.subject_id = p_item and a.status = 'approved')
$$;

-- LEAVING A STORE (S12): from a place of kind `store` to anywhere that is not
-- a store. Into a store — another store included — is not leaving one (the
-- owner, 16 September).
create or replace function app.equipment_leaves_store(p_from_location uuid, p_to_location uuid)
returns boolean
language sql
stable
as $$
  select coalesce((select l.kind = 'store' from locations l where l.id = p_from_location), false)
     and not coalesce((select l.kind = 'store' from locations l where l.id = p_to_location), false)
$$;

-- WOULD `app.request_approval` RAISE ONE? The same test it applies (095), so
-- the guard below and the core function cannot disagree about whether a rule
-- is in force.
create or replace function app.equipment_issue_rule_applies(p_hotel uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from approval_rules r
     where r.hotel_id = p_hotel and r.kind = 'equipment_issue' and r.is_active
       and (r.over_amount is null or 0 > r.over_amount))
$$;

grant execute on function app.equipment_place(uuid) to pms_app;
grant execute on function app.equipment_move_waiting(uuid) to pms_app;
grant execute on function app.equipment_retire_waiting(uuid) to pms_app;
grant execute on function app.equipment_is_retired(uuid) to pms_app;
grant execute on function app.equipment_leaves_store(uuid, uuid) to pms_app;
grant execute on function app.equipment_issue_rule_applies(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Before a write to an item
-- -----------------------------------------------------------------------------
create or replace function app.equipment_items_guard()
returns trigger
language plpgsql
as $$
begin
  if new.supplier_id is not null and not exists (
       select 1 from suppliers s where s.id = new.supplier_id and s.hotel_id = new.hotel_id) then
    raise exception 'That supplier is not at this property.' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'retired' then
      raise exception 'An item is added in use or under repair, then retired — not added retired.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if app.equipment_is_retired(old.id) then
    raise exception 'A retired item is kept exactly as it was retired.'
      using errcode = 'check_violation',
            hint = 'Nothing about it changes. If it is back in use, add it again.';
  end if;
  if new.hotel_id is distinct from old.hotel_id then
    raise exception 'An item does not move between properties.' using errcode = 'check_violation';
  end if;
  if new.held_as is distinct from old.held_as then
    raise exception 'Whether an item is tagged or counted is decided when it is added.'
      using errcode = 'check_violation';
  end if;
  if new.split_from is distinct from old.split_from then
    raise exception 'Where a line came from does not change.' using errcode = 'check_violation';
  end if;
  -- A count changes only by splitting, which updates the old line from inside
  -- its own trigger (depth 2). A direct update is depth 1.
  if new.quantity is distinct from old.quantity and pg_trigger_depth() < 2 then
    raise exception 'A count changes only by moving or retiring part of it.'
      using errcode = 'check_violation',
            hint = 'Every piece stays on a line, so the lines always add up.';
  end if;
  -- ONE THING AT A TIME. A thing waiting to leave the store, or to be retired,
  -- is not put under repair or retired behind the approver's back.
  if new.status is distinct from old.status
     and (app.equipment_move_waiting(old.id) or app.equipment_retire_waiting(old.id)) then
    raise exception 'A request for this item is waiting in the approvals inbox. It is decided there first.'
      using errcode = 'check_violation';
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

-- NAMED TO FIRE FIRST: triggers of one timing fire in name order, and the
-- staff-scope triggers would otherwise answer "an item moving to another
-- property" with "Staff … has no access to" (the database suite caught it).
drop trigger if exists equipment_items_1_guard on equipment_items;
create trigger equipment_items_1_guard
  before insert or update on equipment_items
  for each row execute function app.equipment_items_guard();


-- -----------------------------------------------------------------------------
-- Before a move
-- -----------------------------------------------------------------------------
create or replace function app.equipment_moves_guard()
returns trigger
language plpgsql
as $$
declare
  v_room uuid; v_loc uuid; v_leaves boolean; a approvals;
begin
  if new.to_location_id is not null and not exists (
       select 1 from locations l where l.id = new.to_location_id and l.hotel_id = new.hotel_id) then
    raise exception 'That place is not at this property.' using errcode = 'check_violation';
  end if;

  if new.kind = 'placed' then
    if exists (select 1 from equipment_moves m where m.item_id = new.item_id) then
      raise exception 'An item is placed once, when it is added. After that it moves.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ---- a move ----------------------------------------------------------------
  if app.equipment_is_retired(new.item_id) then
    raise exception 'A retired item does not move.' using errcode = 'check_violation';
  end if;
  if app.equipment_move_waiting(new.item_id) or app.equipment_retire_waiting(new.item_id) then
    raise exception 'A request for this item is waiting in the approvals inbox. It is decided there first.'
      using errcode = 'check_violation';
  end if;

  -- FROM is where it IS, worked out — never what the caller says it was.
  select p.room_id, p.location_id into v_room, v_loc from app.equipment_place(new.item_id) p;
  new.from_room_id := v_room;
  new.from_location_id := v_loc;

  if new.to_room_id is not distinct from v_room and new.to_location_id is not distinct from v_loc then
    raise exception 'It is already there.' using errcode = 'check_violation';
  end if;

  v_leaves := app.equipment_leaves_store(v_loc, new.to_location_id);

  if not v_leaves and new.approval_id is not null then
    raise exception 'Only taking equipment out of a store is asked for.' using errcode = 'check_violation';
  end if;

  if v_leaves then
    if new.approval_id is null then
      -- S12, held by the database: while the property has the rule, a move out
      -- of the store with no request is refused, whichever route sends it.
      if app.equipment_issue_rule_applies(new.hotel_id) then
        raise exception 'Taking equipment out of the store waits for the Inventory Manager. Ask for it with a reason.'
          using errcode = 'check_violation';
      end if;
    else
      select * into a from approvals where id = new.approval_id;
      if a.id is null or a.hotel_id <> new.hotel_id or a.kind <> 'equipment_issue'
         or a.subject_table <> 'equipment_moves' or a.subject_id <> new.id then
        raise exception 'That approval is not the request for this move.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists equipment_moves_1_guard on equipment_moves;
create trigger equipment_moves_1_guard
  before insert on equipment_moves
  for each row execute function app.equipment_moves_guard();


-- -----------------------------------------------------------------------------
-- After a write: the history
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER because the application may not write the history itself.
-- In production the owner is pms_migrate, which holds BYPASSRLS (068).
-- `app.equipment_note` is a transaction-local setting a route may set to say
-- why; `app.current_user_id()` is who.
create or replace function app.equipment_items_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_by    uuid := app.current_user_id();
  v_note  text := nullif(current_setting('app.equipment_note', true), '');
  v_src   equipment_items;
  v_room  uuid; v_loc uuid;
  v_edits jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    -- A new thing is recorded as ADDED by its first move, which knows the place.
    if new.split_from is null then
      return new;
    end if;

    -- ---- A SPLIT: part of a counted line becomes its own line --------------
    select * into v_src from equipment_items
     where id = new.split_from and hotel_id = new.hotel_id for update;

    if v_src.id is null then
      raise exception 'No such line to take them from.' using errcode = 'check_violation';
    end if;
    if v_src.held_as <> 'counted' or new.held_as <> 'counted' then
      raise exception 'Only a counted line can be split.' using errcode = 'check_violation';
    end if;
    if app.equipment_is_retired(v_src.id) then
      raise exception 'A retired line is kept exactly as it was retired.' using errcode = 'check_violation';
    end if;
    if app.equipment_move_waiting(v_src.id) or app.equipment_retire_waiting(v_src.id) then
      raise exception 'A request for this line is waiting in the approvals inbox. It is decided there first.'
        using errcode = 'check_violation';
    end if;
    if new.quantity >= v_src.quantity then
      raise exception 'There are % on that line. Taking % leaves none — move or retire the whole line instead.',
        v_src.quantity, new.quantity using errcode = 'check_violation';
    end if;
    if new.status <> v_src.status then
      raise exception 'A split line starts in the state its line is in.' using errcode = 'check_violation';
    end if;

    update equipment_items set quantity = quantity - new.quantity where id = v_src.id;

    -- It starts where its line IS.
    select p.room_id, p.location_id into v_room, v_loc from app.equipment_place(v_src.id) p;
    insert into equipment_moves (hotel_id, item_id, kind, to_room_id, to_location_id, note, moved_by)
    values (new.hotel_id, new.id, 'placed', v_room, v_loc, v_note, coalesce(v_by, new.created_by));

    insert into equipment_history
      (hotel_id, item_id, kind, quantity, room_id, location_id, from_status, to_status,
       related_item_id, note, done_by)
    values
      (new.hotel_id, v_src.id, 'split', new.quantity, v_room, v_loc, v_src.status, v_src.status,
       new.id, v_note, coalesce(v_by, new.created_by)),
      (new.hotel_id, new.id, 'split', new.quantity, v_room, v_loc, v_src.status, new.status,
       v_src.id, v_note, coalesce(v_by, new.created_by));
    return new;
  end if;

  -- ---- UPDATE ----------------------------------------------------------------
  select p.room_id, p.location_id into v_room, v_loc from app.equipment_place(new.id) p;

  if new.status is distinct from old.status then
    insert into equipment_history
      (hotel_id, item_id, kind, quantity, room_id, location_id, from_status, to_status, note, done_by)
    values
      (new.hotel_id, new.id, case when new.status = 'retired' then 'retired' else 'status' end,
       new.quantity, v_room, v_loc, old.status, new.status,
       case when new.status = 'retired' then new.retire_reason else v_note end,
       case when new.status = 'retired' then new.retired_by else v_by end);
  end if;

  if new.name is distinct from old.name then
    v_edits := v_edits || jsonb_build_object('name', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.category_id is distinct from old.category_id then
    v_edits := v_edits || jsonb_build_object('category', jsonb_build_object(
      'from', (select c.name from equipment_categories c where c.id = old.category_id),
      'to',   (select c.name from equipment_categories c where c.id = new.category_id)));
  end if;
  if new.supplier_id is distinct from old.supplier_id then
    v_edits := v_edits || jsonb_build_object('supplier', jsonb_build_object(
      'from', (select s.name from suppliers s where s.id = old.supplier_id),
      'to',   (select s.name from suppliers s where s.id = new.supplier_id)));
  end if;
  if new.tag is distinct from old.tag then
    v_edits := v_edits || jsonb_build_object('tag', jsonb_build_object('from', old.tag, 'to', new.tag));
  end if;
  if new.purchase_date is distinct from old.purchase_date then
    v_edits := v_edits || jsonb_build_object('purchaseDate',
      jsonb_build_object('from', old.purchase_date, 'to', new.purchase_date));
  end if;
  if new.unit_cost is distinct from old.unit_cost then
    v_edits := v_edits || jsonb_build_object('unitCost',
      jsonb_build_object('from', old.unit_cost, 'to', new.unit_cost));
  end if;
  if new.warranty_ends is distinct from old.warranty_ends then
    v_edits := v_edits || jsonb_build_object('warrantyEnds',
      jsonb_build_object('from', old.warranty_ends, 'to', new.warranty_ends));
  end if;
  if new.amc_ends is distinct from old.amc_ends then
    v_edits := v_edits || jsonb_build_object('amcEnds',
      jsonb_build_object('from', old.amc_ends, 'to', new.amc_ends));
  end if;

  if v_edits <> '{}'::jsonb then
    insert into equipment_history (hotel_id, item_id, kind, quantity, room_id, location_id, changes, note, done_by)
    values (new.hotel_id, new.id, 'edited', new.quantity, v_room, v_loc, v_edits, v_note, v_by);
  end if;

  return new;
end $$;

drop trigger if exists equipment_items_record on equipment_items;
create trigger equipment_items_record
  after insert or update on equipment_items
  for each row execute function app.equipment_items_record();

-- A thing's first move says it was ADDED, and where.
create or replace function app.equipment_moves_record()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_item equipment_items;
begin
  if new.kind <> 'placed' then
    return new;
  end if;
  select * into v_item from equipment_items where id = new.item_id;
  if v_item.split_from is not null then
    return new;                    -- a split line: the split already said so
  end if;
  insert into equipment_history
    (hotel_id, item_id, kind, quantity, room_id, location_id, to_status, note, done_by)
  values
    (new.hotel_id, new.item_id, 'added', v_item.quantity, new.to_room_id, new.to_location_id,
     v_item.status, coalesce(new.note, nullif(current_setting('app.equipment_note', true), '')),
     coalesce(app.current_user_id(), new.moved_by, v_item.created_by));
  return new;
end $$;

drop trigger if exists equipment_moves_record on equipment_moves;
create trigger equipment_moves_record
  after insert on equipment_moves
  for each row execute function app.equipment_moves_record();

-- EVERY THING IS SOMEWHERE — checked when the transaction commits, because the
-- item has to exist before its first move can point at it.
create or replace function app.equipment_item_has_place()
returns trigger
language plpgsql
as $$
begin
  -- Checked at commit: a row inserted and removed in the same transaction (a
  -- property removed with its register) has nothing left to be somewhere.
  if not exists (select 1 from equipment_items i where i.id = new.id) then
    return null;
  end if;
  if not exists (select 1 from equipment_moves m where m.item_id = new.id and m.kind = 'placed') then
    raise exception 'Every item is somewhere: % was added with no room or place.', new.name
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

drop trigger if exists equipment_items_has_place on equipment_items;
create constraint trigger equipment_items_has_place
  after insert on equipment_items
  deferrable initially deferred
  for each row execute function app.equipment_item_has_place();


-- -----------------------------------------------------------------------------
-- The next tag the add form offers
-- -----------------------------------------------------------------------------
-- A SUGGESTION, not a reservation; the unique index refuses a repeat. Only tags
-- of the system's own shape count, so a typed "LOBBY-TV-2" neither blocks nor
-- bends the sequence. ⚠ NEVER A BARE lpad — it CUTS a longer string (root
-- MEMORY 280): pad only what is shorter.
create or replace function app.next_equipment_tag(p_hotel uuid)
returns text
language sql
stable
as $$
  select 'EQ-' || case when length(n::text) < 4 then lpad(n::text, 4, '0') else n::text end
    from (select coalesce(max(substring(upper(btrim(tag)) from '^EQ-([0-9]{1,9})$')::bigint), 0) + 1 as n
            from equipment_items
           where hotel_id = p_hotel
             and upper(btrim(tag)) ~ '^EQ-[0-9]{1,9}$') s
$$;

grant execute on function app.next_equipment_tag(uuid) to pms_app;
