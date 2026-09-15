-- =============================================================================
-- 062 — idempotency for the writes an offline client holds
-- =============================================================================
-- `011_model_additions.sql` added `folio_postings.idempotency_key` under the
-- heading "C4 — idempotency keys. Offline tolerance guarantees retries", and
-- said exactly why:
--
--     "A POS terminal on dropping wifi WILL resend. Without a key the second
--      write succeeds and a real guest is charged twice — and because the
--      ledger is append-only, correcting it needs a human to notice first."
--
-- That column has been correct and unused for the whole project, because there
-- was no offline client to send a key. There is one now, and it holds more
-- than folio postings.
--
-- WHICH WRITES NEED THIS. Only the ones where sending twice makes TWO THINGS.
--
--   work_orders        POST twice = two dripping taps in the maintenance list
--   banquet_events     POST twice = two enquiries for one telephone call
--
-- And which do NOT, so this file does not grow rules it does not need:
--
--   housekeeping status   a PUT of "clean" twice leaves the room clean.
--                         Naturally idempotent; a key would be ceremony.
--   invoices, payments,   never queued at all — src/lib/offline.ts refuses
--   the night audit       them, because a statutory number issued twice
--                         cannot be repaired after the guest has gone.
--
-- THE KEY IS THE CLIENT'S, and it is minted when the PERSON ACTED — not when
-- the request was sent. Minting it per attempt is the same as having none,
-- which is the mistake this whole mechanism exists to make impossible.
--
-- A PARTIAL UNIQUE INDEX, not a constraint: rows written by anything that is
-- not the offline client carry NULL, and NULLs must not collide with each
-- other. The same shape 011 used.
-- =============================================================================

alter table work_orders    add column if not exists idempotency_key uuid;
alter table banquet_events add column if not exists idempotency_key uuid;

create unique index if not exists work_orders_idem_idx
  on work_orders (hotel_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists banquet_events_idem_idx
  on banquet_events (hotel_id, idempotency_key)
  where idempotency_key is not null;

comment on column work_orders.idempotency_key is
  'Minted by the client when somebody TAPPED, reused on every retry. A held '
  'work order that syncs twice must not become two work orders.';

comment on column banquet_events.idempotency_key is
  'Minted by the client when somebody registered the enquiry. One telephone '
  'call is one enquiry, however many times the tablet retries.';
