-- =============================================================================
-- The equipment register — everything durable in the hotel, the restaurant
-- and the rooms
-- =============================================================================
-- Phase 1B of docs/STOCK-AND-EQUIPMENT-PLAN.md (decisions S2 and S7), built by
-- the equipment service. An AC, a TV, a fridge, an oven, a kettle, a table.
-- Not stock (the Store's: things used up), not door locks (room-systems).
--
-- ⚠ REFER TO THIS FILE BY WHAT IT DOES, NEVER BY ITS NUMBER. The Store chat
--   builds phase 1A at the same time and may take the same number; the master
--   renumbers whichever merges second (plan § 7).
--
-- THE OWNER'S ANSWERS THAT SHAPE IT (16 September)
--
--   * Categories: each property starts with NONE. Whoever adds an item picks
--     one already used there or types a new one; the same word in different
--     capitals is one category.
--   * One by one with a tag, or a count in one place: the person adding
--     chooses. No amount of money decides it.
--   * The tag: the screen offers the next free number (EQ-0001…); a printed
--     label already on the item may be typed instead. No tag repeats at a
--     property.
--   * A counted line's cost is PER PIECE, and part of a count may move or be
--     retired — recorded with how many, who and when.
--   * Retiring a tagged item waits for the GM when a Hotel Manager asks for
--     it. That is a question of WHO, which the server answers
--     (api/src/modules/equipment/grants.ts); this file only holds the request.
--
-- THE RULES THIS FILE MAKES THE DATABASE'S, NOT A SCREEN'S
--
--   NEVER DELETED. A thing leaves by being retired, with who, when and why.
--   Migration 010's default privileges hand pms_app DELETE on every new
--   table, so it is REVOKED below — leaving it out of the grant is not enough
--   (094 learned that from its own test).
--
--   A ROOM OR A PLACE, EXACTLY ONE. A room is a row in `rooms`; every other
--   place is a row in `locations` (094). Neither is copied here.
--
--   EVERY MOVE IS RECORDED, NOT OVERWRITTEN. The item row says where a thing
--   is now; `equipment_history` says where it was, where it went, who and
--   when. The history is written by TRIGGERS on the item, so no route can
--   change a place, a status or a count and forget to record it — the same
--   argument as `app.touch_updated_at()`: application code cannot forget.
--
--   NOTHING INVENTED. No category, item, cost or date is seeded. A cost
--   nobody typed is NULL — a dash on screen, never a zero. A warranty nobody
--   entered is NULL — a dash, never "expired".
--
-- WHAT IT DOES NOT DO
--
--   * Repairs. A work order pointing at an item is phase 2B (housekeeping,
--     `work_orders`, 058). "Under repair" is set by hand until then.
--   * Buying. A delivery of equipment arriving as a register entry is 2C.
--   * It changes no table it does not create. `locations` and `suppliers`
--     (094) carry no (hotel_id, id) key to point a composite foreign key at,
--     and adding one would be a change to 094 — the master's. So an item's
--     place and supplier are checked against its property by a trigger.
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

  -- The target of the item's composite key: a category at one property can
  -- never be pointed at by an item at another.
  unique (hotel_id, id),
  constraint equipment_categories_name_present check (length(btrim(name)) > 0)
);

comment on table equipment_categories is
  'What kind of thing an item is — Furniture, Appliance, Kitchen equipment. '
  'Each property grows its own list from the add form; this schema ships none.';

-- "AC" and "ac" are one category (the owner's answer). "AC" and "Air
-- conditioner" are two, and the filter shows both so somebody can tidy them.
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
create table if not exists equipment_items (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,

  name            text not null,             -- "Split AC 1.5 ton", "Electric kettle"
  category_id     uuid,

  -- S7, chosen by the person adding it.
  --   tagged   one thing, one row, one tag unique at the property
  --   counted  "12 kettles in room 104" — one row with a quantity
  held_as         text not null,
  tag             text,
  quantity        integer not null default 1,

  -- WHERE IT IS NOW. Exactly one of the two. Where it WAS is the history.
  room_id         uuid,
  location_id     uuid references locations(id),

  supplier_id     uuid references suppliers(id),
  purchase_date   date,
  -- PER PIECE on a counted line (the owner's answer); the item's own cost on
  -- a tagged one. NULL is "nobody typed it" — a dash, never a zero.
  unit_cost       numeric(12,2),
  warranty_ends   date,
  amc_ends        date,                      -- the service contract

  status          text not null default 'in_use',

  -- A retirement ASKED FOR and not yet decided. Only ever on a tagged item:
  -- a counted line, and anything the GM retires, goes straight through.
  retire_reason        text,
  retire_requested_by  uuid references staff(id),
  retire_requested_at  timestamptz,

  -- Who made it final, and when. Kept after approval beside the request, so
  -- the record says who asked AND who agreed.
  retired_by      uuid references staff(id),
  retired_at      timestamptz,

  -- A line made by taking part of a counted line elsewhere. Its history
  -- starts from the line it came from.
  split_from      uuid,

  created_by      uuid references staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (hotel_id, id),

  constraint equipment_items_name_present check (length(btrim(name)) > 0),
  constraint equipment_items_held_as_known check (held_as in ('tagged', 'counted')),
  constraint equipment_items_status_known check (
    status in ('in_use', 'under_repair', 'retired')),

  -- A tagged thing is ONE thing with a tag. A counted line has a count and no
  -- tag — a tag on "12 kettles" would name none of them.
  constraint equipment_items_tag_or_count check (
    (held_as = 'tagged'  and tag is not null and length(btrim(tag)) > 0 and quantity = 1)
    or
    (held_as = 'counted' and tag is null and quantity >= 1)),

  constraint equipment_items_one_place check (num_nonnulls(room_id, location_id) = 1),

  constraint equipment_items_cost_sane check (unit_cost is null or unit_cost >= 0),
  constraint equipment_items_warranty_after_purchase check (
    warranty_ends is null or purchase_date is null or warranty_ends >= purchase_date),
  constraint equipment_items_amc_after_purchase check (
    amc_ends is null or purchase_date is null or amc_ends >= purchase_date),

  -- RETIRED MEANS WHO, WHEN AND WHY — all three, or it is not retired.
  constraint equipment_items_retired_complete check (
    (status = 'retired') = (retired_at is not null)
    and (retired_at is null or (retired_by is not null and retire_reason is not null))),

  constraint equipment_items_request_complete check (
    retire_requested_at is null
    or (retire_requested_by is not null and retire_reason is not null
        and held_as = 'tagged')),

  constraint equipment_items_category_same_hotel
    foreign key (hotel_id, category_id) references equipment_categories (hotel_id, id),
  constraint equipment_items_room_same_hotel
    foreign key (hotel_id, room_id) references rooms (hotel_id, id),
  constraint equipment_items_split_same_hotel
    foreign key (hotel_id, split_from) references equipment_items (hotel_id, id)
);

comment on table equipment_items is
  'The register of durable things. Never deleted: a thing leaves by being '
  'retired. Where it is now lives here; where it was lives in '
  'equipment_history, written by triggers so no route can forget.';
comment on column equipment_items.unit_cost is
  'Per piece on a counted line; the item''s own cost on a tagged one. NULL '
  'means nobody typed it — a dash, never a zero.';
comment on column equipment_items.quantity is
  'Always 1 on a tagged item. On a counted line it changes ONLY by moving or '
  'retiring part of it, which makes a new line (split_from) — so every piece '
  'is always on exactly one line, and the lines add up.';

-- A tag names one thing at a property. "eq-0001" and "EQ-0001 " are the same
-- label to anybody reading it off a sticker.
create unique index if not exists equipment_items_tag_unique
  on equipment_items (hotel_id, upper(btrim(tag))) where tag is not null;

create index if not exists equipment_items_hotel_status
  on equipment_items (hotel_id, status, name);
create index if not exists equipment_items_room
  on equipment_items (room_id) where room_id is not null;
create index if not exists equipment_items_location
  on equipment_items (location_id) where location_id is not null;

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
-- NEVER DELETED. Revoked, not merely left out: 010's default privileges grant
-- DELETE on every new table.
revoke delete on equipment_items from pms_app;

-- The shared audit trail (016, extended in 076 to the Store's tables): before
-- and after of every write, beside the register's own history. The history
-- says what happened to a THING; the audit log says what happened to a ROW,
-- which is what an auditor asks for.
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
drop trigger if exists equipment_items_requested_by_scope on equipment_items;
create trigger equipment_items_requested_by_scope
  before insert or update on equipment_items
  for each row execute function app.assert_staff_has_hotel('retire_requested_by');


-- -----------------------------------------------------------------------------
-- The history — append-only, written by the triggers below and nothing else
-- -----------------------------------------------------------------------------
create table if not exists equipment_history (
  id               bigint generated always as identity primary key,
  hotel_id         uuid not null references hotels(id) on delete cascade,
  item_id          uuid not null,

  kind             text not null,
  -- How many pieces this concerned: 1 for a tagged item, the line's count or
  -- the part split off for a counted one.
  quantity         integer not null,

  from_room_id     uuid references rooms(id),
  from_location_id uuid references locations(id),
  to_room_id       uuid references rooms(id),
  to_location_id   uuid references locations(id),
  from_status      text,
  to_status        text,

  -- A split names the other line: on the old line, the new one it made; on
  -- the new line, the one it came from.
  related_item_id  uuid,
  -- An edit: { "field": { "from": …, "to": … } } for each field that changed.
  changes          jsonb,
  note             text,

  done_by          uuid references staff(id),
  done_at          timestamptz not null default now(),

  constraint equipment_history_kind_known check (kind in (
    'added',             -- typed in, or imported
    'split',             -- part of a counted line became its own line
    'moved',             -- to another room or place
    'status',            -- in use ↔ under repair
    'retire_requested',  -- a Hotel Manager asked; waits for the GM
    'retire_declined',
    'retired',
    'edited'             -- name, category, supplier, dates, cost, tag
  )),
  constraint equipment_history_quantity_positive check (quantity >= 1),

  constraint equipment_history_item_same_hotel
    foreign key (hotel_id, item_id) references equipment_items (hotel_id, id)
    on delete cascade
);

comment on table equipment_history is
  'Where each thing was, where it went, what happened to it, who and when. '
  'Append-only, and written only by the triggers on equipment_items — the '
  'application may read it and nothing else.';

create index if not exists equipment_history_item
  on equipment_history (item_id, id desc);

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

-- READ ONLY for the application. A history row the API could insert by hand
-- is a history anybody with a bug could write. The triggers run as their
-- owner (SECURITY DEFINER) and are the only writer.
grant select on equipment_history to pms_app;
revoke insert, update, delete on equipment_history from pms_app;


-- -----------------------------------------------------------------------------
-- Before a write: what the database refuses outright
-- -----------------------------------------------------------------------------
create or replace function app.equipment_items_guard()
returns trigger
language plpgsql
as $$
begin
  -- ---- a place and a supplier at THIS property ----------------------------
  -- 094 has no (hotel_id, id) key to point a composite foreign key at, so the
  -- check is here. Without it an item at one property could name another
  -- property's lobby, and RLS would hide the lobby's name from its own screen.
  if new.location_id is not null and not exists (
       select 1 from locations l
        where l.id = new.location_id and l.hotel_id = new.hotel_id) then
    raise exception 'That place is not at this property.'
      using errcode = 'check_violation';
  end if;
  if new.supplier_id is not null and not exists (
       select 1 from suppliers s
        where s.id = new.supplier_id and s.hotel_id = new.hotel_id) then
    raise exception 'That supplier is not at this property.'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    -- A thing is added in use or under repair. Retired, or waiting to be, is
    -- something that HAPPENS to a thing, with a person and a reason.
    if new.status = 'retired' or new.retire_requested_at is not null then
      raise exception 'An item is added in use or under repair, then retired — not added retired.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- ---- UPDATE ----------------------------------------------------------------
  if old.status = 'retired' then
    raise exception 'A retired item is kept exactly as it was retired.'
      using errcode = 'check_violation',
            hint = 'Nothing about it changes. If it is back in use, add it again.';
  end if;

  if new.hotel_id is distinct from old.hotel_id then
    raise exception 'An item does not move between properties.'
      using errcode = 'check_violation';
  end if;
  if new.held_as is distinct from old.held_as then
    raise exception 'Whether an item is tagged or counted is decided when it is added.'
      using errcode = 'check_violation';
  end if;
  if new.split_from is distinct from old.split_from then
    raise exception 'Where a line came from does not change.'
      using errcode = 'check_violation';
  end if;

  -- A COUNT CHANGES ONLY BY SPLITTING. Typing 11 over 12 would lose a kettle
  -- with no record of where it went. The split below updates the old line
  -- from inside its own trigger (depth 2); a direct update is depth 1.
  if new.quantity is distinct from old.quantity and pg_trigger_depth() < 2 then
    raise exception 'A count changes only by moving or retiring part of it.'
      using errcode = 'check_violation',
            hint = 'Every piece stays on a line, so the lines always add up.';
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;

-- NAMED TO FIRE FIRST. Triggers of one timing fire in name order, and the
-- staff-scope triggers above would otherwise answer "an item moving to another
-- property" with "Staff … has no access to" — refused, but for a reason that
-- names the wrong thing. The database suite caught exactly that.
drop trigger if exists equipment_items_1_guard on equipment_items;
create trigger equipment_items_1_guard
  before insert or update on equipment_items
  for each row execute function app.equipment_items_guard();


-- -----------------------------------------------------------------------------
-- After a write: the history
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER because the application may not write the history itself.
-- In production the owner is pms_migrate, which holds BYPASSRLS (068), so the
-- insert is not stopped by the FORCE policy above.
--
-- `app.equipment_note` is a transaction-local setting a route may set to say
-- why (set_config(..., true)); `app.current_user_id()` is who.
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
  v_edits jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    if new.split_from is null then
      insert into equipment_history
        (hotel_id, item_id, kind, quantity, to_room_id, to_location_id,
         to_status, note, done_by)
      values
        (new.hotel_id, new.id, 'added', new.quantity, new.room_id,
         new.location_id, new.status, v_note, coalesce(v_by, new.created_by));
      return new;
    end if;

    -- ---- A SPLIT: part of a counted line becomes its own line --------------
    select * into v_src from equipment_items
     where id = new.split_from and hotel_id = new.hotel_id
       for update;

    if v_src.id is null then
      raise exception 'No such line to take them from.' using errcode = 'check_violation';
    end if;
    if v_src.held_as <> 'counted' or new.held_as <> 'counted' then
      raise exception 'Only a counted line can be split.' using errcode = 'check_violation';
    end if;
    if v_src.status = 'retired' then
      raise exception 'A retired line is kept exactly as it was retired.'
        using errcode = 'check_violation';
    end if;
    if new.quantity >= v_src.quantity then
      raise exception 'There are % on that line. Taking % leaves none — move or retire the whole line instead.',
        v_src.quantity, new.quantity using errcode = 'check_violation';
    end if;
    -- A new line starts exactly where the old one is. Moving it, or retiring
    -- it, is then its own recorded step — so the history reads "2 split off"
    -- followed by "moved to room 105", which is what happened.
    if new.room_id is distinct from v_src.room_id
       or new.location_id is distinct from v_src.location_id
       or new.status <> v_src.status then
      raise exception 'A split line starts where its line is, in the same state.'
        using errcode = 'check_violation';
    end if;

    update equipment_items set quantity = quantity - new.quantity
     where id = v_src.id;

    insert into equipment_history
      (hotel_id, item_id, kind, quantity, from_room_id, from_location_id,
       to_room_id, to_location_id, from_status, to_status, related_item_id,
       note, done_by)
    values
      (new.hotel_id, v_src.id, 'split', new.quantity,
       v_src.room_id, v_src.location_id, v_src.room_id, v_src.location_id,
       v_src.status, v_src.status, new.id, v_note, coalesce(v_by, new.created_by)),
      (new.hotel_id, new.id, 'split', new.quantity,
       v_src.room_id, v_src.location_id, new.room_id, new.location_id,
       v_src.status, new.status, v_src.id, v_note, coalesce(v_by, new.created_by));
    return new;
  end if;

  -- ---- UPDATE ----------------------------------------------------------------
  -- A count going down is the split above, already recorded on both lines.

  if new.room_id is distinct from old.room_id
     or new.location_id is distinct from old.location_id then
    insert into equipment_history
      (hotel_id, item_id, kind, quantity, from_room_id, from_location_id,
       to_room_id, to_location_id, note, done_by)
    values
      (new.hotel_id, new.id, 'moved', new.quantity, old.room_id, old.location_id,
       new.room_id, new.location_id, v_note, v_by);
  end if;

  if new.retire_requested_at is not null and old.retire_requested_at is null then
    insert into equipment_history
      (hotel_id, item_id, kind, quantity, from_status, to_status, note, done_by)
    values
      (new.hotel_id, new.id, 'retire_requested', new.quantity, old.status,
       new.status, new.retire_reason, new.retire_requested_by);
  end if;

  if old.retire_requested_at is not null and new.retire_requested_at is null
     and new.status <> 'retired' then
    insert into equipment_history
      (hotel_id, item_id, kind, quantity, from_status, to_status, note, done_by)
    values
      (new.hotel_id, new.id, 'retire_declined', new.quantity, old.status,
       new.status, v_note, v_by);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'retired' then
      insert into equipment_history
        (hotel_id, item_id, kind, quantity, from_status, to_status,
         from_room_id, from_location_id, note, done_by)
      values
        (new.hotel_id, new.id, 'retired', new.quantity, old.status, new.status,
         new.room_id, new.location_id, new.retire_reason, new.retired_by);
    else
      insert into equipment_history
        (hotel_id, item_id, kind, quantity, from_status, to_status, note, done_by)
      values
        (new.hotel_id, new.id, 'status', new.quantity, old.status, new.status,
         v_note, v_by);
    end if;
  end if;

  -- The details. What each was and what it became, so "who changed the cost
  -- of the lobby TV" has an answer.
  if new.name is distinct from old.name then
    v_edits := v_edits || jsonb_build_object('name',
      jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.category_id is distinct from old.category_id then
    v_edits := v_edits || jsonb_build_object('category',
      jsonb_build_object(
        'from', (select c.name from equipment_categories c where c.id = old.category_id),
        'to',   (select c.name from equipment_categories c where c.id = new.category_id)));
  end if;
  if new.supplier_id is distinct from old.supplier_id then
    v_edits := v_edits || jsonb_build_object('supplier',
      jsonb_build_object(
        'from', (select s.name from suppliers s where s.id = old.supplier_id),
        'to',   (select s.name from suppliers s where s.id = new.supplier_id)));
  end if;
  if new.tag is distinct from old.tag then
    v_edits := v_edits || jsonb_build_object('tag',
      jsonb_build_object('from', old.tag, 'to', new.tag));
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
    insert into equipment_history
      (hotel_id, item_id, kind, quantity, changes, note, done_by)
    values
      (new.hotel_id, new.id, 'edited', new.quantity, v_edits, v_note, v_by);
  end if;

  return new;
end $$;

comment on function app.equipment_items_record() is
  'Writes equipment_history for every add, split, move, status change, '
  'retirement and edit. The only writer of that table.';

drop trigger if exists equipment_items_record on equipment_items;
create trigger equipment_items_record
  after insert or update on equipment_items
  for each row execute function app.equipment_items_record();


-- -----------------------------------------------------------------------------
-- The next tag the add form offers
-- -----------------------------------------------------------------------------
-- A SUGGESTION, not a reservation: two people adding at once may both be
-- offered EQ-0007, and the unique index refuses the second, which the server
-- says in words. Numbers only count tags of the system's own shape, so a
-- printed label typed as "LOBBY-TV-2" neither blocks nor bends the sequence.
--
-- ⚠ NEVER A BARE lpad. In Postgres lpad CUTS a longer string to the length
--   asked for (root MEMORY 280): lpad('10000', 4, '0') is '1000', which is a
--   tag already taken. Pad only what is shorter.
create or replace function app.next_equipment_tag(p_hotel uuid)
returns text
language sql
stable
as $$
  select 'EQ-' || case when length(n::text) < 4 then lpad(n::text, 4, '0')
                       else n::text end
    from (select coalesce(max(substring(upper(btrim(tag)) from '^EQ-([0-9]{1,9})$')::bigint), 0) + 1 as n
            from equipment_items
           where hotel_id = p_hotel
             and upper(btrim(tag)) ~ '^EQ-[0-9]{1,9}$') s
$$;

comment on function app.next_equipment_tag(uuid) is
  'The next EQ-number at a property, offered by the add form. A suggestion; '
  'the unique index is what refuses a repeat.';

grant execute on function app.next_equipment_tag(uuid) to pms_app;
