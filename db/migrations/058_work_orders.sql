-- =============================================================================
-- 058 — work orders
-- =============================================================================
-- A housekeeper finds a dripping tap in 204. Today the only thing the system
-- can do with that is take the room out of service — which is the wrong answer
-- for a dripping tap, and means the alternative is a note on paper that nobody
-- can search when the same tap drips again in November.
--
-- A WORK ORDER IS NOT A ROOM BLOCK, and conflating them is the mistake this
-- table exists to avoid:
--
--   room_blocks   the room is not sellable between these dates. Inventory.
--   work_orders   somebody has to fix something. Work.
--
-- Most work orders take no room out at all. A broken air conditioner in July
-- does, and then there are two rows — the block says the room cannot be sold,
-- the order says who is fixing it — and the order points at the block so
-- putting the room back is one decision rather than two people guessing.
--
-- NOT EVERY ORDER IS ABOUT A ROOM. A lift, a generator, the lobby door: those
-- have no room_id and must not be forced to invent one.
--
-- THE HISTORY IS THE POINT. A closed order is never deleted, because the
-- question a manager actually asks is "how many times have we fixed this room
-- this year", and a table that only holds open work cannot answer it.
-- =============================================================================

create table if not exists work_orders (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,

  -- Null for anything that is not a room: a lift, a generator, the lobby.
  room_id     uuid references rooms(id),

  -- Set when the fault also took the room out of service, so putting it back
  -- is one decision. Null for the dripping tap that took nothing out.
  block_id    uuid references room_blocks(id),

  title       text not null,
  detail      text,

  category    text not null default 'maintenance',
  priority    text not null default 'normal',
  status      text not null default 'open',

  raised_by   uuid references staff(id),
  raised_at   timestamptz not null default now(),

  -- Who is fixing it. Null while nobody has picked it up, which is a real and
  -- common state and not an error.
  assigned_to uuid references staff(id),

  closed_by   uuid references staff(id),
  closed_at   timestamptz,
  -- What was actually done. Required to close, because "fixed" is what people
  -- write when the field is optional, and it is useless in November.
  resolution  text,

  constraint work_orders_title_given check (length(trim(title)) > 0),
  constraint work_orders_category_valid check (category in (
    'maintenance', 'housekeeping', 'electrical', 'plumbing',
    'furniture', 'it', 'other')),
  constraint work_orders_priority_valid check (priority in (
    'low', 'normal', 'high', 'urgent')),
  constraint work_orders_status_valid check (status in (
    'open', 'in_progress', 'done', 'cancelled')),

  -- Closed means closed BY somebody, AT a time, with what was done. An order
  -- missing any of the three is one nobody can be asked about.
  constraint work_orders_closed_complete check (
    status not in ('done', 'cancelled')
    or (closed_at is not null and closed_by is not null
        and length(trim(coalesce(resolution, ''))) > 0)),
  -- And an OPEN order must not carry a closing.
  constraint work_orders_open_is_open check (
    status in ('done', 'cancelled') or closed_at is null)
);

create index if not exists work_orders_open_idx
  on work_orders (hotel_id, status, priority)
  where status in ('open', 'in_progress');

create index if not exists work_orders_room_idx
  on work_orders (room_id) where room_id is not null;

comment on table work_orders is
  'Something that has to be fixed. NOT a room block — most orders take no '
  'room out of service. A closed one is kept, because "how many times have we '
  'fixed this room this year" is the question a manager actually asks.';

comment on column work_orders.block_id is
  'The room block this fault caused, when it caused one. Putting the room back '
  'is then one decision rather than two people guessing whether the other has '
  'already done it.';


-- -----------------------------------------------------------------------------
-- A room belongs to the property the order does
-- -----------------------------------------------------------------------------
-- Without this, an order at Akkalkot can name a room in Pune. RLS scopes the
-- ORDER by hotel_id, and would not notice the room.
-- -----------------------------------------------------------------------------
create or replace function app.work_order_room_is_here()
returns trigger language plpgsql as $$
declare v_hotel uuid;
begin
  if new.room_id is not null then
    select hotel_id into v_hotel from rooms where id = new.room_id;
    if v_hotel is distinct from new.hotel_id then
      raise exception 'that room is at another property';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists work_orders_room_here on work_orders;
create trigger work_orders_room_here
  before insert or update on work_orders
  for each row execute function app.work_order_room_is_here();


-- -----------------------------------------------------------------------------
-- What is outstanding
-- -----------------------------------------------------------------------------
-- Ordered by how long it has been waiting WITHIN its priority, because the
-- thing a maintenance list is for is finding what has been ignored.
-- -----------------------------------------------------------------------------
create or replace function app.work_orders_open(p_hotel uuid)
returns table (
  id          uuid,
  room        text,
  title       text,
  detail      text,
  category    text,
  priority    text,
  status      text,
  raised_by   text,
  raised_at   timestamptz,
  assigned_to text,
  days_open   int,
  blocks_room boolean
)
language sql stable as $$
  select
    w.id,
    rm.number,
    w.title, w.detail, w.category, w.priority, w.status,
    rs.full_name, w.raised_at, asg.full_name,
    (current_date - w.raised_at::date)::int,
    w.block_id is not null
  from work_orders w
  left join rooms rm on rm.id = w.room_id
  left join staff rs on rs.id = w.raised_by
  left join staff asg on asg.id = w.assigned_to
 where w.hotel_id = p_hotel
   and w.status in ('open', 'in_progress')
 order by
   case w.priority when 'urgent' then 0 when 'high' then 1
                   when 'normal' then 2 else 3 end,
   w.raised_at;
$$;

comment on function app.work_orders_open(uuid) is
  'Outstanding work, most urgent first and oldest first within that — a '
  'maintenance list exists to surface what has been ignored.';


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
alter table work_orders enable row level security;
alter table work_orders force  row level security;
drop policy if exists work_orders_isolation on work_orders;
create policy work_orders_isolation on work_orders
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on work_orders to pms_app;
grant execute on function app.work_orders_open(uuid) to pms_app;
