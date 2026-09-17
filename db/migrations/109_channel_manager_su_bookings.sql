-- =============================================================================
-- 109 · The SU channel manager: bookings SU pushes, as they arrive
-- =============================================================================
-- D17-79 (17 September): SU PUSHES each booking to the PMS the moment it
-- happens. Part 4 of four.
--
-- THE INBOX IS THE FIRST THING THAT HAPPENS. SU's message is written here, whole
-- (minus the card fields, below), before anything is worked out from it. Then it
-- is acknowledged to SU, which stops SU resending it every ten minutes and
-- dropping it after an hour; then it is turned into a booking. Storing first is
-- what makes the rest recoverable: whatever happens next, the message is not
-- lost and can be read by a person.
--
-- A MESSAGE ARRIVES TWICE. SU resends a message it has not been told about
-- every ten minutes, three times, and then drops the booking and emails the
-- property. So the same message WILL arrive again, and
-- `unique (hotel_id, su_booking_id, notif_id)` is what makes the second copy a
-- no-op that is answered exactly as the first was, rather than a second booking.
-- The booking itself is kept from doubling separately, by the reservations
-- door's own key (RES-3).
--
-- ⚠ NO CARD NUMBER, NO CVC, NO TOKEN (D17-83). They are cut out of the message
-- BEFORE THE INSERT — in `inbound/scrub.ts`, the moment the message is read off
-- the wire — never afterwards, and never by an update. `payload` is what is
-- left. There is no column for them and no code that writes one, so nothing
-- here can leak what the PMS was never meant to hold.
--
-- Re-runnable; touches no table it does not create; creates no rows.
-- =============================================================================

create table if not exists channel_bookings (
  id             bigint generated always as identity primary key,
  hotel_id       uuid not null references hotels(id) on delete cascade,
  -- SU's own ids: the booking (channel booking id + SU hotel id) and this
  -- message about it. A booking has several messages: new, modified, cancelled.
  su_booking_id  text not null,
  notif_id       text not null,
  -- The booking site, as SU numbers it (19 Booking.com, 189 Agoda, 9 Expedia,
  -- 105 Goibibo/MMT). Text, because SU sends it as text.
  channel_code   text,
  channel_name   text,
  status         text not null,
  arrival        date,
  departure      date,
  guest_name     text,
  rooms          int,
  currency       text,
  total          numeric(12,2),
  commission     numeric(12,2),
  -- SU's message, with every card field removed first.
  payload        jsonb not null,
  received_at    timestamptz not null default now(),
  -- When SU was told we have it. Null: SU is still resending.
  acknowledged_at timestamptz,
  -- What became of it. 'received' until it has been worked out.
  outcome        text not null default 'received',
  outcome_reason text,
  -- The reservations it became, when it became any.
  reservation_ids uuid[] not null default '{}',
  handled_at     timestamptz,
  handled_by     uuid references staff(id),

  constraint channel_bookings_status_known
    check (status in ('new', 'modified', 'cancelled', 'request')),
  constraint channel_bookings_outcome_known
    check (outcome in ('received', 'created', 'changed', 'cancelled',
                       'refused_no_room', 'needs_attention', 'ignored')),
  constraint channel_bookings_ids_present
    check (length(btrim(su_booking_id)) > 0 and length(btrim(notif_id)) > 0),
  constraint channel_bookings_stay_sane
    check (arrival is null or departure is null or departure > arrival)
);

-- The same message twice is one row. SU resends every ten minutes for an hour
-- until it is told the message arrived, so the second copy is not a mistake:
-- it is answered with the first answer, and nothing is written again.
create unique index if not exists channel_bookings_one_message
  on channel_bookings (hotel_id, su_booking_id, notif_id);

-- Every message about one booking, newest first: what a person reads.
create index if not exists channel_bookings_by_booking
  on channel_bookings (hotel_id, su_booking_id, received_at desc);

-- What still needs somebody.
create index if not exists channel_bookings_waiting
  on channel_bookings (hotel_id, received_at desc)
  where outcome in ('received', 'refused_no_room', 'needs_attention');

comment on table channel_bookings is
  'Every booking message SU pushed, as it arrived, with the card fields already '
  'removed (D17-83). Written before anything is worked out from it, acknowledged '
  'to SU, then turned into a booking. The same message twice is one row.';

comment on column channel_bookings.outcome is
  'received: not yet worked out · created/changed/cancelled: it reached the '
  'reservations door · refused_no_room: no room free, so no booking was made '
  '(D17-80) and the GM deals with the site · needs_attention: something a person '
  'must read · ignored: nothing to do (a message for a booking we never made).';

alter table channel_bookings enable row level security;
alter table channel_bookings force  row level security;
drop policy if exists hotel_isolation on channel_bookings;
create policy hotel_isolation on channel_bookings
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on channel_bookings to pms_app;
revoke delete on channel_bookings from pms_app;

drop trigger if exists channel_bookings_audit on channel_bookings;
create trigger channel_bookings_audit
  after insert or update or delete on channel_bookings
  for each row execute function app.write_audit();

drop trigger if exists channel_bookings_handled_by_scope on channel_bookings;
create trigger channel_bookings_handled_by_scope
  before insert or update on channel_bookings
  for each row execute function app.assert_staff_has_hotel('handled_by');


-- -----------------------------------------------------------------------------
-- Which hotel a pushed message belongs to, before anybody has a session
-- -----------------------------------------------------------------------------
-- SU pushes to ONE address for the whole account and names the hotel by the id
-- we gave it. The door has no person behind it, so it cannot read channel_hotels
-- under row-level security to find out which hotel that is. This answers that
-- one question and nothing else: an SU hotel id in, a hotel id and its service
-- account out, and only for a hotel that is on SU and switched on for the
-- channel manager (D17-45).
create or replace function app.channel_hotel_for(p_su_hotel_id text)
returns table (hotel_id uuid, run_as uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select ch.hotel_id, ch.run_as
    from channel_hotels ch
   where upper(ch.su_hotel_id) = upper(btrim(p_su_hotel_id))
     and ch.on_su
     and app.module_enabled(ch.hotel_id, 'channel_manager')
$fn$;

revoke all on function app.channel_hotel_for(text) from public;
grant execute on function app.channel_hotel_for(text) to pms_app;

comment on function app.channel_hotel_for(text) is
  'The hotel an SU hotel id belongs to, and the service account its channel work '
  'runs as - only for a hotel that is on SU and switched on for the channel '
  'manager. For the pushed-booking door, which has no person behind it.';
