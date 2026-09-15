-- =============================================================================
-- 042 — void is not cancel, and where the booking came from
-- =============================================================================
--
-- VOID, DISTINCT FROM CANCEL
--
-- `status` allowed `cancelled` and nothing else, so a booking entered twice by
-- mistake and a booking a guest actually cancelled are the same row to every
-- report. They are not the same thing:
--
--   cancelled  it HAPPENED and was undone. It may carry a cancellation charge,
--              it belongs in cancellation statistics, and the guest did
--              something a hotel wants to measure.
--
--   void       it NEVER HAPPENED. A duplicate, a test, a wrong-property entry.
--              No charge, no revenue, and it must not appear in cancellation
--              statistics either — counting it there inflates a number
--              somebody makes decisions from.
--
-- Both stay on the record. Neither is deleted, for the same reason a struck
-- POS line is kept: a booking that vanishes is a booking nobody can explain.
--
--
-- WHERE THE BOOKING CAME FROM
--
-- `source` exists and answers "which channel" — direct, an OTA, walk-in. It
-- does not answer "which segment" or "who sold it", and without those no
-- source-mix report can exist. That report is the first thing an owner asks
-- for, and it cannot be back-filled: the information is only known at the
-- moment of booking.
--
-- Free text, not lookup tables. A fixed list acquires one entry meaning
-- "Other" and everybody picks it; a per-hotel list can come later, once there
-- is real data to build it from.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Void
-- -----------------------------------------------------------------------------
alter table reservations drop constraint if exists reservations_status_valid;
alter table reservations add constraint reservations_status_valid
  check (status in ('tentative', 'confirmed', 'checked_in', 'checked_out',
                    'no_show', 'cancelled', 'void'));

alter table reservations
  add column if not exists void_reason text,
  add column if not exists voided_by   uuid references staff(id),
  add column if not exists voided_at   timestamptz;

comment on column reservations.void_reason is
  'Required to void. "Entered twice", "wrong property", "test booking". A '
  'booking that disappears with no explanation is one nobody can account for.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_void_explained') then
    /* The null checks are not decoration. `status = ''void''` is a boolean, but
       writing the reason test without an explicit `is not null` would let a
       NULL reason evaluate the clause to NULL — and a CHECK constraint PASSES
       on NULL. That exact trap was caught by an assertion in 039. */
    alter table reservations add constraint reservations_void_explained
      check (status <> 'void'
             or (void_reason is not null
                 and length(trim(void_reason)) > 0
                 and voided_by is not null
                 and voided_at is not null));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- A voided booking holds no room
-- -----------------------------------------------------------------------------
-- The assignment is what makes a room unavailable. Leaving it behind on a
-- voided booking holds a room out of inventory for a stay that never existed —
-- and it is the kind of thing found weeks later, by a clerk who cannot sell a
-- room that looks empty.
-- -----------------------------------------------------------------------------
create or replace function app.void_releases_rooms()
returns trigger language plpgsql as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    update room_assignments
       set released_at = now()
     where reservation_id = new.id and released_at is null;
  end if;
  return new;
end $$;

drop trigger if exists reservations_void_releases on reservations;
create trigger reservations_void_releases
  after update of status on reservations
  for each row execute function app.void_releases_rooms();


-- -----------------------------------------------------------------------------
-- Where it came from
-- -----------------------------------------------------------------------------
alter table reservations
  add column if not exists business_source text,
  add column if not exists market_segment  text,
  add column if not exists sales_person    text;

comment on column reservations.business_source is
  'The account or channel that produced the booking — a travel agent, a '
  'corporate account, a wedding planner. Distinct from `source`, which is the '
  'technical channel it arrived through.';

comment on column reservations.market_segment is
  'Corporate, leisure, group, crew, government. The axis an owner slices '
  'revenue by, and the one that cannot be reconstructed after the fact.';

comment on column reservations.sales_person is
  'Who brought it in. Free text until there is a reason for a staff link — a '
  'seller may leave, and the booking they made still happened.';

create index if not exists reservations_segment_idx
  on reservations (hotel_id, market_segment)
  where market_segment is not null;
