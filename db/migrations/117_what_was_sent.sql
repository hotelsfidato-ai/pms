-- =============================================================================
-- 117 · What was sent, to whom, and whether it arrived
-- =============================================================================
-- The owner's D17-34, D17-65, D17-87 and D18-20: bills, vouchers, confirmations
-- and offers leave the PMS as JSON with the PDF attached, through the n8n on
-- this same server, and n8n writes the message. This table is the PMS's own
-- record of every one of those attempts.
--
-- WHY A RECORD AT ALL. "Did the guest get their bill?" is asked at the desk,
-- the day after, by somebody who was not there. Without a row, the honest
-- answer is that nobody knows: n8n's own execution log is behind a login the
-- desk does not have and is pruned. One row per attempt, kept with the booking
-- it is about, is the difference between a clerk answering and a clerk
-- guessing.
--
-- ⚠ NOTHING IS RECORDED WHEN NOTHING WAS ATTEMPTED. Until the webhook address
-- and the secret are in the server's settings, no screen offers to send and no
-- row is written. A table full of "not configured" would be a log of the
-- system's own unfinished state, not of anything anybody did.
--
-- THIS MIGRATION REPLAYS FROM 001 ON EVERY DEPLOY, like every other. It
-- creates and it grants; it rewrites no constraint that another file defines
-- (MEMORY 284, 293, 299).

create table if not exists messages_sent (
  id             bigint generated always as identity primary key,
  hotel_id       uuid not null references hotels(id) on delete cascade,

  -- Which way it went. The PMS decides this per message, and n8n branches on
  -- the same word (docs/briefs/n8n-sending.md, step 4).
  channel        text not null,
  constraint messages_sent_channel_known
    check (channel in ('whatsapp', 'email')),

  -- What it was: a bill, a voucher, a booking confirmation, a review request,
  -- an offer. Deliberately NOT a constraint list: a new kind of message is a
  -- word, not a migration, and the wording lives in n8n either way.
  kind           text not null,

  -- WHO IT WENT TO, as it was at the time. A guest changes their number and
  -- the record of where the bill actually went must not change with them.
  to_name        text,
  to_phone       text,
  to_email       text,

  -- WHAT IT WAS ABOUT, loosely joined on purpose: a reservation, a folio, an
  -- invoice, a purchase order. A hard foreign key per kind would be five
  -- nullable columns and a check nobody can read.
  about_kind     text,
  about_id       text,

  -- Whether a document went with it (D18-20) and which one, so "they say they
  -- never got the PDF" is answerable.
  document_name  text,
  document_bytes integer,

  sent_at        timestamptz not null default now(),

  -- sent: the receiver answered 200. failed: it did not, and `detail` says
  -- what it said. There is no third state, because a message the PMS never
  -- handed over is not an attempt.
  status         text not null,
  constraint messages_sent_status_known
    check (status in ('sent', 'failed')),

  -- The receiver's own answer, or the reason it could not be reached. Kept
  -- short: it is shown to a clerk, not parsed.
  detail         text,

  -- Null where the system sent it by itself (a confirmation on booking, the
  -- reminder the day before) rather than a person pressing a button.
  sent_by        uuid references staff(id)
);

comment on table messages_sent is
  'Every message the PMS handed to n8n: what, to whom, when, and whether the '
  'receiver took it. One row per attempt. Nothing is written where nothing '
  'was attempted - a message cannot be sent at all until the webhook address '
  'and the secret are in the server''s settings.';

create index if not exists messages_sent_by_hotel_and_time
  on messages_sent (hotel_id, sent_at desc);

-- "Was this booking's confirmation sent?" is the question the desk asks, so it
-- is the one with an index.
create index if not exists messages_sent_about
  on messages_sent (hotel_id, about_kind, about_id);

-- -----------------------------------------------------------------------------
-- Row level security: a property's messages are its own
-- -----------------------------------------------------------------------------
alter table messages_sent enable row level security;
alter table messages_sent force  row level security;

drop policy if exists messages_sent_by_hotel on messages_sent;
create policy messages_sent_by_hotel on messages_sent
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- Append-only in practice: a record of what was sent is not edited afterwards.
grant select, insert on messages_sent to pms_app;
