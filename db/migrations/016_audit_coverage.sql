-- =============================================================================
-- 016_audit_coverage.sql — the tables nobody was watching
-- =============================================================================
-- Found by asking the live database which tables actually carry an audit
-- trigger, rather than trusting the list in 011.
--
-- 011 audited nine tables. Thirteen were left unwatched, and four of those hold
-- figures that change money or identity:
--
--   payments          — settlement status and bank references, editable silently
--   guest_documents   — passport and visa numbers, editable silently
--   night_audit_runs  — the day-close revenue figure, rewritable after the fact
--   hotels            — the GSTIN that prints on every invoice
--   room_types        — base_rate, which is what the property charges
--
-- Additive only. Nothing in 001–015 is rewritten.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extend audit coverage.
-- -----------------------------------------------------------------------------
-- Deliberately NOT audited, and why:
--   folio_postings    — already append-only; the ledger is its own trail
--   audit_log         — auditing the audit log is a recursion, not a control
--   room_status_log   — already an append-only history
--   schema_migrations — infrastructure, written only by the migration runner
--   meal_plans / room_type_templates — static reference data
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'payments',            -- money: settlement, bank reference
    'guest_documents',     -- identity documents (DPDP)
    'night_audit_runs',    -- the day-close figure
    'hotels',              -- GSTIN, which prints on every invoice
    'room_types',          -- base_rate: what the property charges
    'invoice_series',      -- statutory numbering
    'reservation_groups'   -- who a block belongs to
  ] loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on %I
         for each row execute function app.write_audit()', t, t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- A payment that moves no money is not a payment.
-- -----------------------------------------------------------------------------
-- ⚠ An earlier probe reported "negative payment refused" and that reading was
--   WRONG. The zero-value insert immediately before it had already consumed the
--   posting_id, so the negative one was rejected by unique(posting_id) — not by
--   any check on the amount. There was no amount validation at all.
--
--   The sign is deliberately left open: a refund is a genuine negative payment.
--   Only zero is meaningless.
-- -----------------------------------------------------------------------------
alter table payments drop constraint if exists payments_nonzero;
alter table payments add constraint payments_nonzero check (amount <> 0);


-- -----------------------------------------------------------------------------
-- Invoice numbering cannot run backwards.
-- -----------------------------------------------------------------------------
-- next_number had no constraint at all, so it could be set negative — and a GST
-- series that restarts or reverses is a statutory problem, not a data one.
-- The RLS policy already blocks the application from writing this table; this
-- guards the migration role and anything running as owner.
-- -----------------------------------------------------------------------------
alter table invoice_series drop constraint if exists inv_series_forward;
alter table invoice_series add constraint inv_series_forward check (next_number >= 1);


-- -----------------------------------------------------------------------------
-- Room rates cannot be negative.
-- -----------------------------------------------------------------------------
alter table room_types drop constraint if exists room_types_rate_sane;
alter table room_types add constraint room_types_rate_sane check (base_rate >= 0);

alter table reservations drop constraint if exists reservations_rate_sane;
alter table reservations add constraint reservations_rate_sane check (agreed_rate >= 0);


insert into schema_migrations (version) values ('016_audit_coverage')
on conflict (version) do nothing;


-- =============================================================================
-- A NOTE ON THE INDEX RULE — constraint 12 is too absolute as written.
-- =============================================================================
-- CONSTRAINTS.md says "never create an index on a hotel-scoped table that does
-- not lead with hotel_id". Checking the live database, ten indexes do not, and
-- on inspection almost all of them are CORRECT:
--
--   reservations_guest_idx (guest_id)     — finds a guest's stays ACROSS
--                                           properties, which is the point of a
--                                           group-level guest record
--   reservations_group_idx (group_id)     — group bookings may span properties
--   staff_hotels_staff_idx (staff_id)     — the lookup auth_hotel_ids() makes
--   folio_postings_folio_idx (folio_id)   — point lookup on a uuid
--   ra_no_double_booking (room_id, range) — room_id is a uuid; adding hotel_id
--                                           would be redundant
--
-- The real rule is narrower: an index serving a LIST or RANGE scan that RLS
-- will filter must lead with hotel_id. An index serving a POINT lookup on a
-- globally-unique uuid need not, because the seek already lands on one row.
--
-- Constraint 12 has been reworded accordingly. A rule stated too strongly gets
-- someone to "fix" a correct index and make it worse.
-- =============================================================================
