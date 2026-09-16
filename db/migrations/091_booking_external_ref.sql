-- =============================================================================
-- 091 · A booking sent twice is one booking (RES-3)
-- =============================================================================
-- `POST /:code/bookings` had no idempotency. A channel manager whose request
-- timed out resends it — that is what a machine does — and each resend made a
-- second guest, a second group, a second set of confirmed bookings holding
-- inventory and a second set of open folios. None of it can be deleted, only
-- voided with a reason (042). A clerk would notice; a feed does not.
--
-- THE KEY IS THE SENDER'S OWN REFERENCE, not one this system mints. The
-- channel manager already has a number for the booking — the OTA's, or the
-- CRS's reservation id — and it sends the same one however many times it
-- tries. A key minted here on receipt would be new on every attempt, which is
-- the same as having none (062 says it: minted when the PERSON ACTED).
--
-- ⚠ UNIQUE PER BOOKING SOURCE, NOT PER HOTEL. Two channels number their
-- bookings independently; Agoda's 123456 and the CRS's 123456 are different
-- bookings, and a key across sources would answer one with the other.
--
-- ⚠ WHY A LINE NUMBER. 005's dormant `ota_reference` is the column this uses,
-- and it cannot be unique on its own: ONE request for a wedding makes nine
-- reservation rows, all carrying the same sender's reference. `ota_line` is the
-- room's place in that request, 1 to n, so (source, reference, line) is unique
-- and line 1 is what two racing copies collide on — the database serialises
-- them, the second waits for the first to commit and then fails at the index.
--
-- THE FINGERPRINT is what lets a repeat be told from an AMENDMENT. The same
-- reference with the same content is a retry, and is answered with the
-- references the first attempt made. The same reference with different content
-- is not a retry — it is a changed booking, which this door does not take
-- (HMS-INTEGRATION-PLAN step 1.3: "a differing copy with the same reference is
-- refused with a reason"; amendments stay by hand, CRS-22). A hash, not the
-- request: the request carries a guest's phone and email, which already have a
-- home in `guests`, and a second copy of them here would be a second place to
-- forget to protect.
--
-- A PARTIAL INDEX, as 011 and 062 did it: every booking the desk takes has no
-- sender's reference, and those NULLs must never collide with each other.
-- Re-runnable.
-- =============================================================================

alter table reservations add column if not exists ota_line        smallint;
alter table reservations add column if not exists ota_fingerprint text;

-- A line number means nothing without the reference, the channel it is unique
-- within, and the fingerprint a repeat is compared against. All or none.
alter table reservations drop constraint if exists reservations_ota_line_complete;
alter table reservations add constraint reservations_ota_line_complete
  check (ota_line is null
         or (ota_line >= 1
             and ota_reference is not null and length(btrim(ota_reference)) > 0
             and booking_source_id is not null
             and ota_fingerprint is not null));

create unique index if not exists reservations_ota_line_idx
  on reservations (hotel_id, booking_source_id, ota_reference, ota_line)
  where ota_line is not null;

comment on column reservations.ota_reference is
  'The sender''s own reference for the booking — the OTA''s number, or the CRS''s '
  'reservation id. Set by POST /:code/bookings when the caller sends externalRef. '
  'Every room of one request carries the same one; ota_line tells them apart.';

comment on column reservations.ota_line is
  'This room''s place in the request that made it, 1 to n. With the booking source '
  'and ota_reference it is unique (reservations_ota_line_idx), so a request sent '
  'twice cannot make two bookings. NULL for everything the desk takes.';

comment on column reservations.ota_fingerprint is
  'A hash of the request that made this room. A repeat with the same reference and '
  'the same fingerprint is a retry and is answered with the original references; '
  'a different fingerprint is a changed booking, and is refused.';
