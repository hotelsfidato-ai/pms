-- =============================================================================
-- 026_identity_capture.sql — a guest's document can actually be recorded
-- =============================================================================
-- Phase 1, item 1. `guest_documents` has existed since 013 and NOTHING HAS EVER
-- WRITTEN TO IT. Check-in asks the clerk to "Capture ID document", which flips
-- a boolean the client sends and the server files into a note. No passport
-- number, no expiry, no visa has ever reached the database from a check-in.
--
-- That matters twice over:
--
--   · the Form C register built in 025 names every foreign national who owes a
--     filing and prints "not on record" where the passport should be, because
--     there is nothing to print
--   · the C-Form report on the reports index carries the note "needs passport
--     capture at check-in", which has been true for the whole project
--
-- WHAT WAS MISSING FROM 013
--
-- It created a SELECT policy and an INSERT policy. There is no UPDATE policy,
-- and the primary key is guest_id — so the SECOND time a guest presents a
-- document, the insert conflicts and there is no way to record it.
--
-- A guest returning with a renewed visa is not an edge case. It is the normal
-- life of a returning corporate guest, and the document on file being three
-- years stale is exactly the thing an FRRO inspection asks about.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A document can be corrected and renewed
-- -----------------------------------------------------------------------------
drop policy if exists gd_update_by_reservation on guest_documents;
create policy gd_update_by_reservation on guest_documents
  for update
  using (
    exists (
      select 1 from reservations r
       where r.guest_id = guest_documents.guest_id
         and r.hotel_id in (select app.auth_hotel_ids())
    )
  )
  with check (
    exists (
      select 1 from reservations r
       where r.guest_id = guest_documents.guest_id
         and r.hotel_id in (select app.auth_hotel_ids())
    )
  );

comment on policy gd_update_by_reservation on guest_documents is
  'A guest who returns with a renewed visa, or whose number was mistyped, must '
  'be correctable. Scoped exactly as the read and insert policies: a property '
  'may touch the documents of guests who have stayed with IT.';

-- No DELETE policy, deliberately. Removing a document does not un-record the
-- stay it was presented for, and a compliance register with a hole in it is
-- worse than one with a stale row. Correct it; do not erase it.

grant select, insert, update on guest_documents to pms_app;
revoke delete on guest_documents from pms_app;


-- -----------------------------------------------------------------------------
-- When it was captured, and by whom
-- -----------------------------------------------------------------------------
-- `updated_at` exists and says when the row last moved. It does not say who
-- looked at a passport, and "the clerk who checked them in" is not derivable
-- once a document has been corrected twice.
-- -----------------------------------------------------------------------------
alter table guest_documents
  add column if not exists captured_by uuid references staff(id),
  add column if not exists captured_at timestamptz;

comment on column guest_documents.captured_by is
  'The staff member who saw the document. An FRRO inspection asks who checked, '
  'not only what was recorded.';

drop trigger if exists guest_documents_touch on guest_documents;
create trigger guest_documents_touch before update on guest_documents
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- A passport needs an expiry; an Aadhaar does not
-- -----------------------------------------------------------------------------
-- Not every document has the same fields, and a constraint that demanded them
-- all would make an Indian guest's Aadhaar impossible to record.
--
-- What IS worth refusing: a passport with no number. That is not a captured
-- document, it is a tick in a box — which is precisely what this migration
-- exists to end.
-- -----------------------------------------------------------------------------
alter table guest_documents drop constraint if exists gd_number_present;
alter table guest_documents add constraint gd_number_present
  check (id_type is null or (id_number is not null and length(trim(id_number)) > 0));

comment on constraint gd_number_present on guest_documents is
  'A document type with no number is a tick in a box. Recording one would '
  'satisfy the check-in flow and tell an inspection nothing.';


-- -----------------------------------------------------------------------------
-- Who still owes a document
-- -----------------------------------------------------------------------------
-- The Form C register answers this for FOREIGN nationals. Indian properties
-- must record an identity document for every guest, so the question is wider
-- than Form C and deserves its own answer.
-- -----------------------------------------------------------------------------
create or replace function app.identity_missing(p_hotel_id uuid)
returns table (
  reservation_id uuid,
  guest_id       uuid,
  guest_name     text,
  nationality    text,
  room_number    text,
  arrived        date,
  foreign_national boolean
)
language sql
stable
as $fn$
  select r.id, g.id, g.full_name, g.nationality,
         coalesce(rm.number, '—'), r.check_in,
         g.nationality <> 'IN'
    from reservations r
    join guests g on g.id = r.guest_id
    left join guest_documents gd on gd.guest_id = g.id
    left join room_assignments ra on ra.reservation_id = r.id
                                 and ra.released_at is null
    left join rooms rm on rm.id = ra.room_id
   where r.hotel_id = p_hotel_id
     and r.status in ('checked_in', 'checked_out')
     -- No row at all, or a row with nothing on it. The second case is what a
     -- half-finished capture leaves behind.
     and (gd.guest_id is null or gd.id_number is null)
   order by (g.nationality <> 'IN') desc, r.check_in desc
$fn$;

comment on function app.identity_missing(uuid) is
  'Guests who have stayed and have no identity document on file. Foreign '
  'nationals first, because theirs carries a 24-hour legal deadline.';


-- -----------------------------------------------------------------------------
-- The assertions live in db/tests/suite.sql, not here.
--
-- A self-test in this file has no guest to test against: guests come from the
-- suite and the demo loader, both of which run AFTER the migrations. The first
-- version of this file proved that by failing on its own guard, which is the
-- guard working — MEMORY.md defect 22 is the same mistake made in 025, and the
-- rule that came out of it was "assertions belong where the fixtures are".
-- -----------------------------------------------------------------------------
