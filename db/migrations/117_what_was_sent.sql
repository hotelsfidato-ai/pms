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

-- -----------------------------------------------------------------------------
-- Recording it, for a caller that has no staff session
-- -----------------------------------------------------------------------------
-- ⚠ FOUND BY ITS OWN TEST, 19 September. `messages_sent` is FORCE row-secured
-- and scoped to `app.auth_hotel_ids()`, which answers for a signed-in member of
-- staff. The first caller of the sender is THE GUEST'S OWN DOOR, which has no
-- staff session by design (migration 114: a guest is not staff and holds no
-- sign-in), so the insert was refused outright — and so would every message the
-- system sends by itself: the confirmation when the CRS makes a booking, the
-- reminder the day before, the review request after check-out. Nearly every
-- message this table exists to record.
--
-- So the WRITE goes through here. The hotel is named explicitly by a caller
-- that already reached the booking legitimately — the guest door through the
-- link's own token, a clerk through their session — and this function only
-- ever writes the row it is given.
--
-- THE READ IS UNCHANGED AND STILL FORCE-SECURED: the policy above decides who
-- can SEE what was sent, and nothing here widens it. A definer function that
-- inserts is not a definer function that selects.
create or replace function app.record_message_sent(
  p_hotel uuid, p_channel text, p_kind text,
  p_to_name text, p_to_phone text, p_to_email text,
  p_about_kind text, p_about_id text,
  p_document_name text, p_document_bytes integer,
  p_status text, p_detail text, p_sent_by uuid
) returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into messages_sent
    (hotel_id, channel, kind, to_name, to_phone, to_email,
     about_kind, about_id, document_name, document_bytes,
     status, detail, sent_by)
  values
    (p_hotel, p_channel, p_kind, p_to_name, p_to_phone, p_to_email,
     p_about_kind, p_about_id, p_document_name, p_document_bytes,
     p_status, p_detail, p_sent_by)
  returning id
$$;

comment on function app.record_message_sent(uuid, text, text, text, text, text, text, text, text, integer, text, text, uuid) is
  'Records one attempt to send. SECURITY DEFINER because most messages are '
  'sent by the system with no staff session behind them - the guest door, the '
  'booking confirmation, the reminder - and messages_sent is FORCE row-secured. '
  'It writes the row it is given and reads nothing; who may SEE what was sent '
  'is the policy on the table, unchanged.';

revoke all on function app.record_message_sent(uuid, text, text, text, text, text, text, text, text, integer, text, text, uuid) from public;
grant execute on function app.record_message_sent(uuid, text, text, text, text, text, text, text, text, integer, text, text, uuid) to pms_app;
