-- =============================================================================
-- 099 · The audit log names the person — ADM-1
-- =============================================================================
-- THE OWNER'S DECISION, 17 September (D17-14): the audit log RECORDS and SHOWS
-- the real person, not "admin".
--
-- WHAT WAS WRONG, twice over.
--
--   Shown:    the Audit log reads the folio ledger, and the API typed the word
--             "admin" into every row (api/src/modules/admin/adminLists.ts).
--   Recorded: `folio_postings.posted_by` has existed since 006, and four of the
--             thirteen statements that write a posting never set it —
--
--               api/src/modules/finance/postings.ts      a charge, a reversal,
--                                                        a payment
--               api/src/modules/front-desk/operations.ts a walk-in's room charge
--
--             Measured in the development database on 17 September: 148 of 176
--             postings named nobody, and every one of them was made at the
--             desk. The till and the night audit named their person every time.
--             So fixing the screen alone would have printed a dash on nearly
--             everything the desk does.
--
-- 1 · RECORDED IN ONE PLACE. `posted_by` now defaults to the signed-in person.
--     A column default applies exactly when a statement leaves the column out —
--     the four doors above, and any door written later — and never overrides a
--     statement that names somebody (the till names its operator). MEMORY 242:
--     a rule every door must follow goes where every door passes through. No
--     other service's file changes.
--
--     Where nobody is signed in — a migration, the demo loader — the function
--     answers null, and so does the column. Nothing is invented.
--
--     Rows already written stay as they are: the ledger is append-only (014),
--     and who made them was never recorded, so it is not known.
--
-- 2 · SHOWN BY NAME. `app.posted_by_name(posting)` answers the full name of
--     whoever made a posting at a property the caller is at.
--
--     Not a join to `staff`: it is row-secured (027), so a general manager
--     reading a join would see a dash for the owner and for anybody not
--     rostered with them (MEMORY 283, the Store's STO-4).
--
--     Not `app.colleague_name` (096) either: that names people rostered at the
--     property NOW. An audit log is read after something has gone wrong, and
--     often after the person has gone — access removed is exactly when the
--     owner opens it. Their entries must still name them.
--
--     A name only, and only of the person behind an entry the caller's own
--     properties hold. WHO may read the audit log is the API's decision
--     (D17-15, api/src/modules/admin/grants.ts).
--
-- SECURITY DEFINER, owned by the migrator (BYPASSRLS since 068), so the name
-- is readable whatever `staff`'s policies show the caller. It still asks
-- `app.auth_hotel_ids()`, which reads the session's `app.user_id` — so it can
-- never answer for a posting at a property the caller is not at.
-- =============================================================================


-- ---------- 1 · who made it, recorded ----------
alter table folio_postings
  alter column posted_by set default app.current_user_id();

comment on column folio_postings.posted_by is
  'The person who made the posting. Defaults to the signed-in person (099), so '
  'a statement that leaves it out still records who; null only where nobody was '
  'signed in (a migration, a bulk load) or on rows written before 099.';


-- ---------- 2 · who made it, by name ----------
create or replace function app.posted_by_name(p_posting bigint)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s.full_name
    from folio_postings fp
    join staff s on s.id = fp.posted_by
   where fp.id = p_posting
     and fp.hotel_id in (select app.auth_hotel_ids())
$fn$;

revoke all on function app.posted_by_name(bigint) from public;
grant execute on function app.posted_by_name(bigint) to pms_app;

comment on function app.posted_by_name(bigint) is
  'The full name of whoever made this posting, if it is at a property the '
  'caller is at; else null. Names people who have since lost their access, '
  'which app.colleague_name does not. Who may read it is the API''s decision.';
