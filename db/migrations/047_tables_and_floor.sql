-- =============================================================================
-- 047 — the floor
-- =============================================================================
-- `pos_orders.table_ref` is free text with nothing behind it. It was right for
-- a till that only had to print "Table 4" on a docket, and it cannot answer any
-- of the questions the floor view asks:
--
--   which tables exist · which are free · how long has 12 been sitting
--   what is running on 8 · which section is it in
--
-- SECTIONS ARE REAL, not a label. A/C, Non A/C and Bar are priced, staffed and
-- closed independently, and a waiter finds a table by walking to a section
-- first. A flat list of thirty tables is a list nobody scans.
--
-- THE FIVE COLOURS ARE DERIVED, NEVER STORED. Blank, running, KOT sent,
-- printed, paid are all knowable from the order and its lines. A stored status
-- is a sixth thing to keep in step, and it is the one that will be wrong on the
-- night a manager is watching the floor.
-- =============================================================================

create table if not exists pos_sections (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  outlet_id  uuid not null references pos_outlets(id) on delete cascade,

  name       text not null,          -- A/C, Non A/C, Bar
  sort_order int not null default 0,
  is_active  boolean not null default true,

  created_at timestamptz not null default now(),
  unique (outlet_id, name)
);

create table if not exists pos_tables (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  section_id uuid not null references pos_sections(id) on delete cascade,

  -- What is painted on the table. "12", "AC4", "Bar 2".
  label      text not null,
  seats      smallint,

  -- Where it sits in the grid. Not pixels: a floor plan drawn to scale is a
  -- drawing tool, and what a waiter needs is the same arrangement every time
  -- so muscle memory works.
  row_no     smallint not null default 0,
  col_no     smallint not null default 0,

  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  unique (section_id, label),
  constraint pos_tables_seats_sane check (seats is null or seats > 0)
);

comment on table pos_tables is
  'A real table, in a section, at a position in the grid. Colour is NEVER '
  'stored here — it is derived from the order sitting on it.';

create index if not exists pos_tables_section_idx
  on pos_tables (section_id) where is_active;


-- -----------------------------------------------------------------------------
-- The order knows which table it is on
-- -----------------------------------------------------------------------------
alter table pos_orders
  add column if not exists table_id   uuid references pos_tables(id),
  -- When the bill was printed, and when the table was reset. Both are what
  -- make "printed" and "paid" different colours on the floor.
  add column if not exists printed_at timestamptz,
  add column if not exists cleared_at timestamptz;

comment on column pos_orders.table_ref is
  'Kept. Every order taken before there were tables has one, and a free-text '
  '"Poolside" is still a real answer — a floor plan does not have to cover '
  'everywhere food is served.';

comment on column pos_orders.cleared_at is
  'The table was reset and is free again. A settled bill still occupies its '
  'table until somebody clears it — that is what the paid colour means, and '
  'why it is not the same as blank.';

create index if not exists pos_orders_table_live_idx
  on pos_orders (table_id) where cleared_at is null;


-- -----------------------------------------------------------------------------
-- The floor, as one query
-- -----------------------------------------------------------------------------
-- Every table with whatever is sitting on it. One request for the whole
-- screen: a grid that fetches a tile at a time is a grid that flickers as it
-- fills, and a waiter reads the WHOLE floor at once or not at all.
--
-- `state` in the order a tile cares about, most-urgent last:
--
--   blank    nothing on it
--   running  an order open, nothing sent to the kitchen yet
--   kot      lines have gone to the kitchen — food is being cooked
--   printed  the bill has been printed; the guest is paying
--   paid     settled, and the table still needs resetting
-- -----------------------------------------------------------------------------
create or replace function app.pos_floor(p_outlet uuid)
returns table (
  section_id   uuid,
  section      text,
  table_id     uuid,
  label        text,
  seats        smallint,
  row_no       smallint,
  col_no       smallint,
  order_id     uuid,
  order_no     text,
  state        text,
  opened_at    timestamptz,
  minutes      int,
  payable      numeric
)
language sql stable as $$
  with live as (
    /* The order sitting on each table: the most recent one not yet
       cleared. distinct on, so a table that has had four orders today
       shows the current one and not the first. */
    select distinct on (o.table_id)
           o.table_id, o.id, o.order_no, o.status, o.opened_at,
           o.printed_at,
           exists (select 1 from pos_order_lines l
                    where l.order_id = o.id and not l.voided
                      and l.kot_status <> 'pending') as sent
      from pos_orders o
     where o.table_id is not null and o.cleared_at is null
     order by o.table_id, o.opened_at desc
  )
  select
    s.id, s.name, t.id, t.label, t.seats, t.row_no, t.col_no,
    l.id, l.order_no,
    case
      when l.id is null            then 'blank'
      when l.status = 'settled'    then 'paid'
      when l.printed_at is not null then 'printed'
      when l.sent                  then 'kot'
      else 'running'
    end,
    l.opened_at,
    case when l.opened_at is null then null
         else greatest(0, (extract(epoch from now() - l.opened_at) / 60)::int)
    end,
    case when l.id is null then null
         else (select payable from app.pos_order_total(l.id)) end
  from pos_sections s
  join pos_tables t on t.section_id = s.id and t.is_active
  left join live l on l.table_id = t.id
 where s.outlet_id = p_outlet and s.is_active
 order by s.sort_order, s.name, t.row_no, t.col_no, t.label;
$$;

comment on function app.pos_floor(uuid) is
  'Every table with whatever is on it, and the state its tile should show. '
  'Derived: a stored colour is a sixth thing to keep in step, and the one '
  'that will be wrong on the night a manager is watching.';


-- -----------------------------------------------------------------------------
-- One live order per table
-- -----------------------------------------------------------------------------
-- Two open orders on table 8 is two bills nobody can tell apart, and the floor
-- view would show one of them at random. A partial unique index says it once,
-- rather than every caller remembering to check.
-- -----------------------------------------------------------------------------
create unique index if not exists pos_orders_one_live_per_table
  on pos_orders (table_id)
  where table_id is not null and cleared_at is null and status = 'open';


-- -----------------------------------------------------------------------------
-- A settled bill is cleared, not reopened
-- -----------------------------------------------------------------------------
create or replace function app.pos_clear_is_final()
returns trigger language plpgsql as $$
begin
  if old.cleared_at is not null and new.cleared_at is null then
    raise exception 'a cleared table cannot be un-cleared'
      using hint = 'Open a new order on it.';
  end if;
  return new;
end $$;

drop trigger if exists pos_orders_clear_final on pos_orders;
create trigger pos_orders_clear_final
  before update of cleared_at on pos_orders
  for each row execute function app.pos_clear_is_final();


-- -----------------------------------------------------------------------------
-- Isolation and grants
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pos_sections', 'pos_tables']
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

grant select, insert, update, delete on pos_sections to pms_app;
grant select, insert, update, delete on pos_tables   to pms_app;
grant execute on function app.pos_floor(uuid)        to pms_app;
