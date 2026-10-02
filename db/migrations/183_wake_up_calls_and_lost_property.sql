-- =============================================================================
-- 183 · Wake-up calls and lost property (D27-239; the owner's answers D27-241)
-- =============================================================================
-- WAKE-UP CALLS. The desk sets one for a guest in house; a guest may ASK for
-- one from their own page, and it waits as a request the desk confirms. The
-- bell rings from fifteen minutes before until somebody marks it done; there
-- is no "missed" state. The time is the HOTEL's (app.hotel_moment, MEMORY 297).
--
--   asked      the guest asked from their page; the desk confirms or cancels
--   set        the desk set it, or confirmed the guest's
--   done       somebody called (who, when)
--   cancelled  not needed (who, when, why)
--
-- LOST PROPERTY. The desk and housekeeping log what was found; only the desk
-- marks it returned (to whom) or disposed (why). How many days it has been
-- kept is shown; nothing is disposed of by itself; no photo.
--
-- The guest's side goes through two definer functions behind the code, the
-- stay only from app.guest_unlocked (online-checkin rule 8); app.guest_link_open
-- is not touched. The master renumbers at merge; refer to this file as "wake-up
-- calls and lost property".
-- =============================================================================

create table if not exists wake_up_calls (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,
  reservation_id  uuid not null references reservations(id),
  room_id         uuid references rooms(id),
  call_at         timestamptz not null,
  note            text,
  status          text not null default 'set',
  from_guest      boolean not null default false,
  created_by      uuid references staff(id),
  created_at      timestamptz not null default now(),
  handled_by      uuid references staff(id),
  handled_at      timestamptz,
  cancel_reason   text,
  constraint wuc_status_valid check (status in ('asked', 'set', 'done', 'cancelled')),
  constraint wuc_note_short check (note is null or length(note) <= 200),
  constraint wuc_guest_asks check (not from_guest or created_by is null),
  constraint wuc_closed_says_who check (
    (status in ('done', 'cancelled')) = (handled_by is not null and handled_at is not null)),
  constraint wuc_cancel_says_why check (
    status <> 'cancelled' or length(btrim(coalesce(cancel_reason, ''))) > 0)
);
create index if not exists wake_up_calls_open
  on wake_up_calls (hotel_id, call_at) where status in ('asked', 'set');

alter table wake_up_calls enable row level security;
alter table wake_up_calls force  row level security;
drop policy if exists wake_up_calls_by_hotel on wake_up_calls;
create policy wake_up_calls_by_hotel on wake_up_calls for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, insert, update on wake_up_calls to pms_app;

create table if not exists lost_items (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  what           text not null,
  found_where    text not null,
  room_id        uuid references rooms(id),
  kept_where     text,
  found_at       timestamptz not null default now(),
  found_by       uuid references staff(id),
  status         text not null default 'kept',
  returned_to    text,
  dispose_reason text,
  handled_by     uuid references staff(id),
  handled_at     timestamptz,
  constraint li_what_given check (length(btrim(what)) between 1 and 200),
  constraint li_where_given check (length(btrim(found_where)) between 1 and 200),
  constraint li_status_valid check (status in ('kept', 'returned', 'disposed')),
  constraint li_cleared_says_who check (
    (status <> 'kept') = (handled_by is not null and handled_at is not null)),
  constraint li_returned_to_somebody check (
    status <> 'returned' or length(btrim(coalesce(returned_to, ''))) > 0),
  constraint li_disposed_says_why check (
    status <> 'disposed' or length(btrim(coalesce(dispose_reason, ''))) > 0)
);
create index if not exists lost_items_kept on lost_items (hotel_id, found_at) where status = 'kept';

alter table lost_items enable row level security;
alter table lost_items force  row level security;
drop policy if exists lost_items_by_hotel on lost_items;
create policy lost_items_by_hotel on lost_items for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, insert, update on lost_items to pms_app;

-- -----------------------------------------------------------------------------
-- The guest's side, behind the code
-- -----------------------------------------------------------------------------
-- A wake-up call asked for from the guest's page: a day of the stay (from the
-- day they arrived to the morning they leave), a time on the hotel's clock,
-- in the future; three waiting at most. True and written, or false and nothing.
create or replace function app.guest_wake_up_ask(
  p_token_hash text, p_unlock_hash text, p_day date, p_time text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record; v_at timestamptz; v_in date; v_out date; v_room uuid;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null or p_day is null
     or coalesce(p_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return false;
  end if;
  select r.check_in, r.check_out into v_in, v_out
    from reservations r where r.id = v.reservation_id and r.status in ('confirmed', 'checked_in');
  if v_in is null or p_day < v_in or p_day > v_out then return false; end if;

  v_at := app.hotel_moment(v.hotel_id, to_char(p_day, 'YYYY-MM-DD') || 'T' || p_time);
  if v_at <= now()
     or (select count(*) from wake_up_calls
          where reservation_id = v.reservation_id and status in ('asked', 'set')) >= 3 then
    return false;
  end if;

  select ra.room_id into v_room from room_assignments ra
   where ra.reservation_id = v.reservation_id and ra.released_at is null
   order by ra.from_date desc, ra.created_at desc limit 1;
  insert into wake_up_calls (hotel_id, reservation_id, room_id, call_at, status, from_guest)
  values (v.hotel_id, v.reservation_id, v_room, v_at, 'asked', true);
  return true;
end
$fn$;

-- What this guest asked for and set, on the hotel's clock.
create or replace function app.guest_wake_ups_mine(p_token_hash text, p_unlock_hash text)
returns table (call_at text, status text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select app.hotel_clock(w.hotel_id, w.call_at), w.status
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join wake_up_calls w on w.reservation_id = v.reservation_id
   where w.status in ('asked', 'set') or w.call_at > now() - interval '1 day'
   order by w.call_at;
$fn$;

revoke all on function app.guest_wake_up_ask(text, text, date, text) from public;
revoke all on function app.guest_wake_ups_mine(text, text) from public;
grant execute on function app.guest_wake_up_ask(text, text, date, text) to pms_app;
grant execute on function app.guest_wake_ups_mine(text, text) to pms_app;
