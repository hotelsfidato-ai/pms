-- =============================================================================
-- 274 · The minibar (D27-383 item 10, built under D27-396)
-- =============================================================================
-- Refer to this file by what it does, "the minibar" - the master renumbers it.
--
--   * minibar_items: per hotel, what a room's minibar holds. Each is a STORE
--     item (stock_items), so its refill is an issue from a store and the stock
--     moves. Its selling price is TYPED BY THE HOTEL: NULL until somebody says,
--     and an item with no price cannot be charged (no default prices).
--   * minibar_records: what was taken from one room's minibar, recorded by
--     housekeeping when cleaning (or the desk at check-out). The lines are kept
--     as they were recorded - name, quantity, the price then, whether it was
--     alcohol, the store movement that refilled it. The charges are ordinary
--     bill lines (finance's postCharge) carrying source_type 'minibar' and this
--     record's id; nothing here is a second ledger.
--
--     status   charged      on the stay's bill;
--              waiting      for the desk: 'disputed' (the housekeeper was not
--                           sure, or the guest says not theirs) or
--                           'after_checkout' (found once the stay had left -
--                           a closed bill is never added to);
--              not_charged  the desk decided not to, and said why.
--     A record is decided ONCE: waiting -> charged or not_charged, never back.
--
-- Re-runnable: replayed on every deploy.
-- =============================================================================

create table if not exists minibar_items (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  stock_item_id uuid not null,
  -- Typed by the hotel. NULL: nobody has said, so it cannot be charged.
  price         numeric(12,2),
  -- The store its refill is issued from (a Bar store's drinks from the bar's).
  store_id      uuid not null references locations(id),
  is_active     boolean not null default true,
  created_by    uuid references staff(id),
  created_at    timestamptz not null default now(),
  constraint minibar_items_one_each unique (hotel_id, stock_item_id),
  constraint minibar_items_stock_here
    foreign key (hotel_id, stock_item_id) references stock_items (hotel_id, id),
  constraint minibar_items_price_sane check (price is null or (price > 0 and price < 100000000))
);

comment on table minibar_items is
  'What a room''s minibar holds (D27-383 item 10): a Store item, its refill store, and the '
  'selling price the hotel typed - NULL until typed, and then it cannot be charged.';

create table if not exists minibar_records (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  room_id        uuid not null,
  -- The stay it is charged to, or would be (the one that left, after check-out).
  reservation_id uuid,
  business_date  date not null,
  -- [{item, name, quantity, price, alcohol, movement}] as recorded.
  lines          jsonb not null,
  status         text not null,
  waiting_why    text,
  recorded_by    uuid not null references staff(id),
  recorded_at    timestamptz not null default now(),
  decided_by     uuid references staff(id),
  decided_at     timestamptz,
  decided_note   text,
  constraint minibar_records_room_here
    foreign key (hotel_id, room_id) references rooms (hotel_id, id),
  constraint minibar_records_stay_here
    foreign key (hotel_id, reservation_id) references reservations (hotel_id, id),
  constraint minibar_records_status_known
    check (status in ('charged', 'waiting', 'not_charged')),
  constraint minibar_records_why_known
    check (waiting_why is null or waiting_why in ('disputed', 'after_checkout')),
  constraint minibar_records_waiting_says_why
    check (status <> 'waiting' or waiting_why is not null),
  constraint minibar_records_lines_present
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  constraint minibar_records_charged_has_stay
    check (status <> 'charged' or reservation_id is not null),
  constraint minibar_records_decided_whole
    check ((decided_at is null) = (decided_by is null)),
  constraint minibar_records_not_charged_says_why
    check (status <> 'not_charged' or length(btrim(coalesce(decided_note, ''))) > 0)
);

create index if not exists minibar_records_waiting
  on minibar_records (hotel_id) where status = 'waiting';
create index if not exists minibar_records_recent
  on minibar_records (hotel_id, recorded_at desc);

comment on table minibar_records is
  'What was taken from a room''s minibar (D27-383 item 10). charged: on the stay''s bill '
  '(its lines'' postings carry source_type ''minibar'' and this id); waiting: for the desk, '
  'disputed or found after check-out; not_charged: the desk said why. Decided once.';

-- ── Decided once ────────────────────────────────────────────────────────────
create or replace function app.minibar_record_decided_once()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'waiting' then
    raise exception 'This minibar record is already decided.' using errcode = 'check_violation';
  end if;
  if new.status = 'waiting' or new.decided_by is null then
    raise exception 'A waiting minibar record is decided: charged, or not charged with a reason.'
      using errcode = 'check_violation';
  end if;
  if new.hotel_id is distinct from old.hotel_id or new.room_id is distinct from old.room_id
     or new.reservation_id is distinct from old.reservation_id or new.lines is distinct from old.lines
     or new.recorded_by is distinct from old.recorded_by or new.recorded_at is distinct from old.recorded_at
     or new.business_date is distinct from old.business_date or new.waiting_why is distinct from old.waiting_why then
    raise exception 'What was recorded is never changed - only the desk''s decision is added.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists minibar_records_1_decided_once on minibar_records;
create trigger minibar_records_1_decided_once
  before update on minibar_records
  for each row execute function app.minibar_record_decided_once();

drop trigger if exists minibar_records_recorded_by_scope on minibar_records;
create trigger minibar_records_recorded_by_scope
  before insert on minibar_records
  for each row execute function app.assert_staff_has_hotel('recorded_by');

drop trigger if exists minibar_records_decided_by_scope on minibar_records;
create trigger minibar_records_decided_by_scope
  before update on minibar_records
  for each row execute function app.assert_staff_has_hotel('decided_by');

-- Money, and who wrote it: the shared audit trail.
drop trigger if exists minibar_items_audit on minibar_items;
create trigger minibar_items_audit
  after insert or update on minibar_items
  for each row execute function app.write_audit();
drop trigger if exists minibar_records_audit on minibar_records;
create trigger minibar_records_audit
  after insert or update on minibar_records
  for each row execute function app.write_audit();

-- ── Isolation and grants ────────────────────────────────────────────────────
alter table minibar_items enable row level security;
alter table minibar_items force  row level security;
drop policy if exists hotel_isolation on minibar_items;
create policy hotel_isolation on minibar_items
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table minibar_records enable row level security;
alter table minibar_records force  row level security;
drop policy if exists hotel_isolation on minibar_records;
create policy hotel_isolation on minibar_records
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- An item is switched off, never deleted (a record names it). A record is
-- written once and decided once. REVOKED: 010's default privileges grant
-- DELETE on anything new.
revoke all on minibar_items from pms_app;
grant select, insert on minibar_items to pms_app;
grant update (price, store_id, is_active) on minibar_items to pms_app;
revoke all on minibar_records from pms_app;
grant select, insert on minibar_records to pms_app;
grant update (status, decided_by, decided_at, decided_note) on minibar_records to pms_app;
