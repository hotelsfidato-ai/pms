-- =============================================================================
-- 111 · A booking that came from a booking site: its commission, and its cancelling
-- =============================================================================
-- D17-79: SU pushes a booking to the PMS, and the channel manager turns it into
-- a real one through reservations' own door. Two things that door needs and the
-- table has not had.
--
-- 1. THE COMMISSION SU SENDS (D17-84). A booking already carries
--    `commission_pct`, the percentage agreed with that source, copied onto the
--    booking when it is made. An OTA sends the AMOUNT it will keep, which is
--    not always the percentage times the rate: a site may waive it, or apply a
--    promotion. Both are kept — the percentage says what was agreed, the amount
--    says what the site said. NULL where the site sent nothing, never 0: zero
--    would claim the booking cost no commission.
--
-- 2. CANCELLING. A booking from a site is cancelled by the site, and the PMS is
--    told. `cancelled` has been a status since 005 and nothing has ever written
--    it: the desk uses `void`, which means "this booking should never have
--    existed". A guest who cancelled did exist, and the difference is what a
--    no-show report and a cancellation report count. So the columns that say
--    who, when and why — the shape 102 uses for a repair, checked the same way.
--
-- Nothing here changes an existing booking: every column is nullable and no row
-- is written. Replayed on every deploy, so every statement is `if not exists`
-- or guarded by what it adds.
-- =============================================================================

alter table reservations add column if not exists commission_amount numeric(12,2);
alter table reservations add column if not exists cancelled_at  timestamptz;
alter table reservations add column if not exists cancelled_by  uuid references staff(id);
alter table reservations add column if not exists cancel_reason text;

comment on column reservations.commission_amount is
  'What the booking site said it will keep, when it sends a figure (D17-84). '
  'NULL means it sent none - not that there is no commission. commission_pct '
  'is what was agreed with that source.';
comment on column reservations.cancel_reason is
  'Why a booking was cancelled. A cancellation is not a void: the booking was '
  'real, and the guest called it off.';

-- A cancellation that says WHEN says WHY.
--
-- Not "every cancelled booking says why": bookings have carried the status
-- since 005 and none of them has a reason, the demo fixtures included, so that
-- rule would refuse to load a database that is not wrong - only older. This
-- says the narrower, true thing: whatever writes these columns writes both, so
-- a half-recorded cancellation cannot exist. The door in
-- api/src/modules/reservations/channel.ts always writes both.
--
-- Guarded by what it adds, so a replay leaves a later, wider version alone
-- (MEMORY 293).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'reservations'::regclass
       and conname  = 'reservations_cancelled_says_why'
  ) then
    alter table reservations add constraint reservations_cancelled_says_why
      check (
        cancelled_at is null
        or length(btrim(coalesce(cancel_reason, ''))) > 0
      );
  end if;
end $$;

-- What a machine needs to find its own booking again. `ota_reference` already
-- carries the sender's reference (091); this index is for the cancellation and
-- the change, which arrive knowing only that.
create index if not exists reservations_by_external_ref
  on reservations (hotel_id, booking_source_id, ota_reference)
  where ota_reference is not null;
