-- =============================================================================
-- 211 · The KOT section of Restaurant setup (D27-292)
-- =============================================================================
-- The owner, 9 October: "one KOT machine prints everything - bar, restaurant,
-- bills. Let me configure several, by place, in Restaurant setup." Asked
-- question by question:
--
-- (1) KOT KINDS. Each KOT says what it is at the top - "KITCHEN KOT 14", "BAR
--     KOT 14" - and prints where its kind prints. They start as Kitchen and Bar
--     (renamed at will, never switched off: every dish has to print somewhere);
--     more can be added (Tandoor, Desserts) and switched off. Per hotel, as the
--     menu is.
--
-- (2) STATIONS ARE COMPUTERS. The website cannot reach a printer by its IP, so
--     a station is a computer at the hotel (a browser, by the id it keeps,
--     157), named ("Bar PC"); its printer is the one the computer prints to.
--     ONE COMPUTER PER KIND (the owner): choosing a kind on another computer
--     moves it there, as 157's switch moved the outlet's. One computer may
--     print several kinds, or all of them, and the bills.
--
-- (3) ROUTING IS PER MENU SECTION, PRE-FILLED. A section names its kind, or
--     names none and follows its tax heading: Bar and Alcohol to the Bar kind,
--     everything else to the Kitchen kind. An add-on or a side goes with its
--     dish. The kind is STAMPED on each line when it is sent, so a KOT reprints
--     where it first printed, whatever the sections say next month.
--
-- (4) ONE SEND, ONE NUMBER, ONE SLIP PER KIND. A claim (157's pos_kot_prints)
--     is now per kind: "BAR KOT 14" and "KITCHEN KOT 14" are printed apart.
--     A docket printed whole before this counts as printed for every kind.
--
-- (5) THE BILL PRINTER. One computer may print the bills, silently, as the
--     KOTs are: Print bill on any screen asks for it here, and the computer
--     prints it. INTERIM BILL before payment, BILL after, BILL · DUPLICATE
--     after that - decided when it is asked. "Print here" on the bill page
--     takes the bill off that computer's list.
--
-- 157's station columns on pos_outlets stay, unread: their computer becomes a
-- station that prints every kind, so nothing stops printing on the day.
--
-- Re-runnable.
-- =============================================================================

-- (2) ------------------------------------------------------------------------
create table if not exists pos_kot_stations (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  -- The id the browser keeps (157): checked for shape only.
  device       text not null check (device ~ '^[A-Za-z0-9_-]{8,64}$'),
  name         text not null check (length(trim(name)) between 1 and 60),
  prints_bills boolean not null default false,
  -- From when it prints the bills: a bill asked before is not its to print.
  bills_since  timestamptz,
  seen_at      timestamptz,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  check (not prints_bills or bills_since is not null)
);

comment on table pos_kot_stations is
  'A computer at the hotel that prints KOTs and/or bills (D27-292): its '
  'browser''s own id, its name, when it last asked. Its kinds name it.';

create unique index if not exists pos_kot_stations_device_idx
  on pos_kot_stations (hotel_id, device) where is_active;
-- One bill printer per hotel.
create unique index if not exists pos_kot_stations_bills_idx
  on pos_kot_stations (hotel_id) where prints_bills and is_active;

-- (1) ------------------------------------------------------------------------
create table if not exists pos_kot_kinds (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 30),
  -- The two it starts with: where a section with no kind of its own prints.
  role          text check (role in ('food', 'bar')),
  sort          int  not null default 100,
  station_id    uuid references pos_kot_stations(id),
  -- From when that computer prints this kind: a KOT sent before is not its.
  station_since timestamptz,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check ((station_id is null) = (station_since is null)),
  -- Kitchen and Bar are never switched off: every dish prints somewhere.
  check (role is null or is_active)
);

comment on table pos_kot_kinds is
  'What a KOT is - Kitchen, Bar, Tandoor (D27-292) - and the one computer '
  'that prints it. Its name heads the slip: "BAR KOT 14".';

create unique index if not exists pos_kot_kinds_name_idx
  on pos_kot_kinds (hotel_id, lower(trim(name))) where is_active;
create unique index if not exists pos_kot_kinds_role_idx
  on pos_kot_kinds (hotel_id, role) where role is not null;

do $$
declare t text;
begin
  foreach t in array array['pos_kot_stations', 'pos_kot_kinds'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
    -- Nothing is deleted (the owner): switched off, as sections and tables are.
    execute format('grant select, insert, update on %I to pms_app', t);
    execute format('revoke delete on %I from pms_app', t);
  end loop;
end $$;

-- Every hotel starts with Kitchen and Bar - those there now, and any made later.
create or replace function app.pos_kot_kinds_seed(p_hotel uuid)
returns void language sql security definer set search_path = public as $$
  insert into pos_kot_kinds (hotel_id, name, role, sort)
  values (p_hotel, 'Kitchen', 'food', 1), (p_hotel, 'Bar', 'bar', 2)
  on conflict do nothing;
$$;

select app.pos_kot_kinds_seed(id) from hotels;

create or replace function app.pos_kot_kinds_for_new_hotel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app.pos_kot_kinds_seed(new.id);
  return new;
end $$;

drop trigger if exists hotels_kot_kinds on hotels;
create trigger hotels_kot_kinds
  after insert on hotels
  for each row execute function app.pos_kot_kinds_for_new_hotel();

-- 157's computer prints every kind, from when it was switched on.
do $$
declare o record; v_station uuid;
begin
  for o in select hotel_id, kot_station_device, kot_station_name, kot_station_since, kot_station_seen_at
             from pos_outlets
            where kot_station_device is not null and api_key_hash is null
  loop
    select id into v_station from pos_kot_stations
     where hotel_id = o.hotel_id and device = o.kot_station_device and is_active;
    if v_station is null then
      insert into pos_kot_stations (hotel_id, device, name, seen_at)
      values (o.hotel_id, o.kot_station_device, o.kot_station_name, o.kot_station_seen_at)
      returning id into v_station;
    end if;
    update pos_kot_kinds set station_id = v_station, station_since = o.kot_station_since
     where hotel_id = o.hotel_id and station_id is null and is_active;
  end loop;
end $$;

comment on column pos_outlets.kot_station_device is
  'Superseded by pos_kot_stations (211, D27-292); kept, unread.';

-- (3) ------------------------------------------------------------------------
alter table pos_menu_categories
  add column if not exists kot_kind_id uuid references pos_kot_kinds(id);
comment on column pos_menu_categories.kot_kind_id is
  'Which KOT this section''s dishes print on (D27-292). Null follows the tax '
  'heading: Bar and Alcohol to the Bar kind, the rest to the Kitchen kind.';

alter table pos_order_lines
  add column if not exists kot_kind_id uuid references pos_kot_kinds(id);
comment on column pos_order_lines.kot_kind_id is
  'The KOT kind this line printed on, stamped when it was sent (D27-292).';

/** The kind a dish prints on: its section's own, else by its heading. */
create or replace function app.pos_kot_kind_for(p_hotel uuid, p_item uuid)
returns uuid language sql stable as $$
  select coalesce(
    (select k.id
       from pos_menu_items i
       join pos_menu_categories c on c.id = i.category_id
       join pos_kot_kinds k on k.id = c.kot_kind_id and k.is_active
      where i.id = p_item),
    (select k.id
       from pos_kot_kinds k
      where k.hotel_id = p_hotel
        and k.role = case when (select c.tax_kind
                                  from pos_menu_items i
                                  join pos_menu_categories c on c.id = i.category_id
                                 where i.id = p_item) in ('bar', 'alcohol')
                          then 'bar' else 'food' end));
$$;

/** A line's kind: what it was stamped with, else its dish's (a side or an
    add-on goes with its dish). Lines sent before 211 have no stamp. */
create or replace function app.pos_line_kot_kind(p_line bigint)
returns uuid language sql stable as $$
  select coalesce(l.kot_kind_id, p.kot_kind_id,
                  app.pos_kot_kind_for(l.hotel_id, coalesce(l.item_id, p.item_id)))
    from pos_order_lines l
    left join pos_order_lines p on p.id = l.parent_line_id
   where l.id = p_line;
$$;

-- Stamped when it goes to the kitchen, by every door that sends.
create or replace function app.pos_line_stamps_kot_kind()
returns trigger language plpgsql as $$
declare v_parent_item uuid; v_parent_kind uuid;
begin
  if old.kot_status = 'pending' and new.kot_status <> 'pending' and new.kot_kind_id is null then
    if new.parent_line_id is not null then
      select item_id, kot_kind_id into v_parent_item, v_parent_kind
        from pos_order_lines where id = new.parent_line_id;
    end if;
    new.kot_kind_id := coalesce(v_parent_kind,
      app.pos_kot_kind_for(new.hotel_id, coalesce(new.item_id, v_parent_item)));
  end if;
  return new;
end $$;

drop trigger if exists pos_order_lines_kot_kind on pos_order_lines;
create trigger pos_order_lines_kot_kind
  before update of kot_status on pos_order_lines
  for each row execute function app.pos_line_stamps_kot_kind();

grant execute on function app.pos_kot_kind_for(uuid, uuid) to pms_app;
grant execute on function app.pos_line_kot_kind(bigint)     to pms_app;

-- (4) ------------------------------------------------------------------------
alter table pos_kot_prints add column if not exists kind_id uuid references pos_kot_kinds(id);
alter table pos_kot_prints drop constraint if exists pos_kot_prints_pkey;
alter table pos_kot_prints drop constraint if exists pos_kot_prints_slip_key;
alter table pos_kot_prints
  add constraint pos_kot_prints_slip_key unique nulls not distinct (order_id, kot_no, kind_id);
comment on column pos_kot_prints.kind_id is
  'Which slip of the docket (D27-292). Null: the whole docket, printed before 211.';

-- (5) ------------------------------------------------------------------------
create table if not exists pos_bill_prints (
  id           bigserial primary key,
  hotel_id     uuid not null references hotels(id) on delete cascade,
  order_id     uuid not null references pos_orders(id) on delete cascade,
  heading      text not null check (heading in ('interim', 'bill', 'duplicate')),
  -- The bill printer it was asked of; null when it was printed here.
  station_id   uuid references pos_kot_stations(id),
  asked_by     uuid not null references staff(id),
  asked_at     timestamptz not null default now(),
  printed_at   timestamptz,
  -- "Print here" used instead: the bill printer no longer prints it.
  printed_here boolean not null default false,
  check (station_id is not null or printed_here)
);

comment on table pos_bill_prints is
  'Each bill printed or asked for (D27-292): at the bill printer, or here. '
  'Its heading is decided when asked: INTERIM BILL, BILL, BILL · DUPLICATE.';

create index if not exists pos_bill_prints_order_idx on pos_bill_prints (order_id);
create index if not exists pos_bill_prints_waiting_idx
  on pos_bill_prints (station_id) where printed_at is null and not printed_here;

alter table pos_bill_prints enable row level security;
alter table pos_bill_prints force row level security;
drop policy if exists hotel_isolation on pos_bill_prints;
create policy hotel_isolation on pos_bill_prints
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));
grant select, insert, update on pos_bill_prints to pms_app;
grant usage on sequence pos_bill_prints_id_seq to pms_app;
revoke delete on pos_bill_prints from pms_app;
