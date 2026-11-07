-- =============================================================================
-- 272 · The waitlist: a guest waiting for a room type on nights that are full
-- =============================================================================
-- The audit's Step 2, item 8 (D27-383), built under D27-396. The desk writes
-- down a guest it could not book - name, phone, the nights, the room type and
-- a note. When a room frees up (a cancellation, a shorter stay, an allotment
-- released) the waitlist screen shows who was waiting for those nights with
-- the rooms now free, oldest first. Turning one into a booking is the usual
-- New booking, filled in from the entry, which then says "booked".
--
-- NOTHING IS BOOKED OR SENT BY ITSELF: the hotel decides, and no guest is
-- told anything by the system (D27-396). No row is ever deleted: an entry is
-- waiting, booked (its booking named) or removed (who, when and why).
--
-- Re-runnable.
-- =============================================================================

create table if not exists waitlist (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references hotels(id) on delete cascade,
  guest_name     text not null,
  phone          text,
  room_type_id   uuid not null,
  arrival        date not null,
  departure      date not null,
  note           text,
  status         text not null default 'waiting',
  reservation_id uuid references reservations(id),
  created_by     uuid references staff(id),
  created_at     timestamptz not null default now(),
  closed_by      uuid references staff(id),
  closed_at      timestamptz,
  close_reason   text,

  foreign key (hotel_id, room_type_id) references room_types (hotel_id, id),
  constraint waitlist_name   check (length(trim(guest_name)) between 1 and 120),
  constraint waitlist_dates  check (departure > arrival and departure - arrival <= 90),
  constraint waitlist_status check (status in ('waiting', 'booked', 'removed')),
  constraint waitlist_closed check ((status = 'waiting') = (closed_at is null)),
  constraint waitlist_booked check ((status = 'booked') = (reservation_id is not null)),
  constraint waitlist_note   check (note is null or length(note) <= 500),
  constraint waitlist_reason check (close_reason is null or length(close_reason) <= 200)
);

comment on table waitlist is
  'Guests the desk could not book, waiting for a room type on their nights '
  '(D27-383, 272). Waiting, booked or removed; never deleted, never acted on '
  'by the system.';

create index if not exists waitlist_waiting_idx
  on waitlist (hotel_id, created_at) where status = 'waiting';

alter table waitlist enable row level security;
alter table waitlist force  row level security;
drop policy if exists hotel_isolation on waitlist;
create policy hotel_isolation on waitlist for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
grant select, insert, update on waitlist to pms_app;
revoke delete on waitlist from pms_app;

drop trigger if exists waitlist_audit on waitlist;
create trigger waitlist_audit after insert or update or delete on waitlist
  for each row execute function app.write_audit();
