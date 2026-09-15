-- =============================================================================
-- 024_pos_bridge.sql — the seam a POS posts through
-- =============================================================================
-- Stage 7. THE POS ITSELF IS NOT BUILT HERE and will not be: Sattva is live in
-- eZee today and its replacement is being built by the owner. This migration
-- builds the boundary it posts across, so whoever writes the POS writes
-- against a contract instead of against a guess.
--
-- WHAT A POS ACTUALLY NEEDS FROM A PMS
--
--   1. "Which rooms can I charge?"    — occupied, folio open
--   2. "Charge this bill to room 204" — and tell me where it landed
--   3. "That bill was voided"         — undo it
--
-- Everything else — menus, tables, KOTs, stock, waiters — is the POS's own
-- business and must never appear in this schema. A PMS that models a menu has
-- absorbed a system it does not own.
--
-- THE FOUR RULES THIS BOUNDARY EXISTS TO ENFORCE
--
--   IDEMPOTENCY. A POS whose request times out WILL retry, and it should.
--   Without a uniqueness guarantee on the POS's own bill number, that retry
--   charges the guest twice and nobody finds out until checkout.
--   `unique (outlet_id, ticket_ref)` is the most important line in this file.
--
--   THE BUSINESS DATE IS THE HOTEL'S, NOT THE POS'S. A restaurant closing at
--   01:30 posts under a clock reading tomorrow. The hotel is still operating
--   in yesterday until its night audit runs. If the POS's date won, the
--   restaurant's revenue would land on a day the audit had already closed.
--   See MEMORY.md defect 19 — this exact mistake, already made once here.
--
--   VOIDS REVERSE, THEY DO NOT DELETE. `folio_postings` is append-only and a
--   trigger enforces it against every role, superuser included. A voided POS
--   bill gets a cancelling posting and the ledger shows both.
--
--   A POS IS NOT A PERSON, BUT IT IS A CALLER. It authenticates as a service
--   account holding the `pos` role — which 002_tenancy.sql listed before
--   anything used it — so Row Level Security applies to it exactly as to a
--   clerk. No second authorisation path to keep in step, and the audit log
--   names the outlet that posted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Outlets
-- -----------------------------------------------------------------------------
create table if not exists pos_outlets (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,

  -- What the POS calls itself in a URL. Stable; the display name is not.
  code         text not null,
  name         text not null,

  -- Which revenue line its charges land on. An outlet posts to ONE category:
  -- a restaurant is 'food', a bar 'beverage', a spa 'spa'. A mixed outlet
  -- sends the category per ticket and this is its default.
  category     text not null default 'food',

  -- The service account this outlet posts as. RLS scopes it to one hotel
  -- through staff_hotels, exactly as it scopes a clerk.
  staff_id     uuid not null references staff(id),

  -- sha256 of the API key, hex. The key itself is shown ONCE, at issue, and is
  -- never recoverable — storing it would make a database dump a break-in.
  api_key_hash text,

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (hotel_id, code),
  constraint pos_outlets_category_valid check (category in
    ('food', 'beverage', 'spa', 'laundry', 'minibar', 'telephone', 'misc'))
);

comment on table pos_outlets is
  'A point of sale permitted to charge a guest folio. The POS is a separate '
  'system, built and run elsewhere; this row is only its credential and its '
  'revenue category.';

comment on column pos_outlets.api_key_hash is
  'sha256 hex of the key. The key is shown once at issue and never stored, so '
  'a leaked dump does not hand over the ability to post charges.';

drop trigger if exists pos_outlets_touch on pos_outlets;
create trigger pos_outlets_touch before update on pos_outlets
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- Tickets — one row per bill the POS sent, whatever became of it
-- -----------------------------------------------------------------------------
create table if not exists pos_tickets (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  outlet_id     uuid not null references pos_outlets(id),

  -- The POS's OWN bill number, and the idempotency key. It has to be the
  -- POS's to choose: after a timeout it is the only identifier that still
  -- exists on the POS's side, because ours was never received.
  ticket_ref    text not null,

  folio_id      uuid   references folios(id),
  posting_id    bigint references folio_postings(id),

  -- The hotel's operating day, resolved here rather than sent by the POS.
  business_date date not null,

  amount        numeric(12,2) not null,
  tax_rate      numeric(5,2)  not null default 0,
  tax_amount    numeric(12,2) not null default 0,

  -- posted    the charge is on the folio
  -- voided    a reversing posting cancels it; both rows remain
  -- rejected  the PMS refused, with a reason the POS can show its operator
  status        text not null default 'posted',
  reject_reason text,

  -- What was on the bill. Kept so a guest asking "what is this 1,240?" at
  -- checkout gets an answer without a phone call to the restaurant. The PMS
  -- does not interpret this: they are the POS's line items, stored whole.
  items         jsonb,

  received_at     timestamptz not null default now(),
  voided_at       timestamptz,
  void_posting_id bigint references folio_postings(id),

  -- THE LINE THAT PREVENTS DOUBLE CHARGING.
  -- A POS whose request times out cannot know whether the charge landed, so
  -- it retries with the same bill number. This constraint turns that retry
  -- into a conflict the API answers with the ORIGINAL posting, instead of a
  -- second charge nobody notices until checkout.
  unique (outlet_id, ticket_ref),

  constraint pos_tickets_status_valid check (status in
    ('posted', 'voided', 'rejected')),
  -- A refusal says why. A silent one is not an answer a waiter can act on.
  constraint pos_tickets_rejected_has_reason check (
    status <> 'rejected' or reject_reason is not null),
  -- Anything not refused actually reached the ledger.
  constraint pos_tickets_posted_has_posting check (
    status = 'rejected' or posting_id is not null),
  -- A void points at the reversal that cancelled it.
  constraint pos_tickets_void_has_reversal check (
    status <> 'voided' or void_posting_id is not null)
);

comment on table pos_tickets is
  'Every bill a POS sent, refusals included. The refusals matter as much as '
  'the charges: they are how anyone settles "the restaurant says they charged '
  'it, the folio says otherwise".';

create index if not exists pos_tickets_hotel_date_idx
  on pos_tickets (hotel_id, business_date);
create index if not exists pos_tickets_folio_idx
  on pos_tickets (folio_id);


-- -----------------------------------------------------------------------------
-- Isolation. Both carry hotel_id, so both take the SAME policy every other
-- scoped table takes, written the same way — `hotel_id in (select
-- app.auth_hotel_ids())`, applied by the loop in 007_rls.sql.
--
-- Two details copied from 007 deliberately, because getting either wrong is
-- silent:
--
--   FORCE. Without `force row level security` the table OWNER bypasses the
--   policy entirely — and the owner is usually the role the API connects as.
--   The table would look protected and be open.
--
--   The subquery form. `hotel_id = any (app.auth_hotel_ids())` is rejected
--   outright — "set-returning functions are not allowed in policy
--   expressions" — which is the good case. It failed loudly here.
-- -----------------------------------------------------------------------------
do $rls$
declare t text;
begin
  foreach t in array array['pos_outlets', 'pos_tickets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format($p$
      create policy hotel_isolation on %I
        for all
        using      ( hotel_id in (select app.auth_hotel_ids()) )
        with check ( hotel_id in (select app.auth_hotel_ids()) )
    $p$, t);
  end loop;
end
$rls$;

-- ⚠ A GRANT LIST IS NOT A RESTRICTION.
--
--   This first read:
--
--       grant select, insert, update on pos_outlets to pms_app;
--       -- No DELETE on either.
--
--   and the comment was false. 010_roles.sql sets
--   `alter default privileges ... grant select, insert, update, DELETE on
--   tables to pms_app`, so every new table in this schema arrives with DELETE
--   already granted. Naming three privileges adds nothing and withholds
--   nothing — it only makes the file LOOK like it restricted something.
--
--   Caught by an assertion that checked the privilege instead of trusting the
--   grant. Revoking is the only thing that takes it away, which is why
--   014_simulation_fixes.sql revokes rather than re-grants on folio_postings.
revoke delete on pos_outlets, pos_tickets from pms_app;

-- A bill that was sent was sent, and a refused one is evidence. The same
-- reason folio_postings has no DELETE.


-- -----------------------------------------------------------------------------
-- Authenticating a machine
--
-- A POS presents a key. Resolving that key to an outlet requires READING
-- pos_outlets — but pos_outlets is behind RLS, and RLS needs a session, and
-- the session is what we are trying to establish. The same cycle
-- app.current_user_id() has with `staff`, and the same answer: SECURITY
-- DEFINER, running as the owner, so this one lookup can happen before anyone
-- is authenticated.
--
-- It returns the outlet's SERVICE ACCOUNT. Everything after this point runs
-- through withUser() as that account, so RLS scopes the POS to its own hotel
-- exactly as it scopes a clerk. There is no second authorisation path.
--
-- Takes the HASH, never the key. The key does not enter the database.
-- -----------------------------------------------------------------------------
create or replace function app.pos_outlet_for_key(p_key_hash text)
returns table (
  outlet_id uuid,
  hotel_id  uuid,
  staff_id  uuid,
  code      text,
  name      text,
  category  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select o.id, o.hotel_id, o.staff_id, o.code, o.name, o.category
    from pos_outlets o
    join hotels h on h.id = o.hotel_id
   where o.api_key_hash = p_key_hash
     and p_key_hash is not null
     and length(p_key_hash) = 64        -- a sha256 hex digest, or nothing
     and o.is_active
     and h.is_active
$fn$;

comment on function app.pos_outlet_for_key(text) is
  'Resolves a POS API key hash to its outlet and service account. SECURITY '
  'DEFINER because this read must happen before any session exists. Takes the '
  'hash only — the key itself never reaches the database.';

revoke all on function app.pos_outlet_for_key(text) from public;
grant execute on function app.pos_outlet_for_key(text) to pms_app;


-- -----------------------------------------------------------------------------
-- Which rooms a POS may charge — ONE definition, so the waiter's list and the
-- PMS's refusal cannot disagree.
-- -----------------------------------------------------------------------------
create or replace function app.pos_chargeable_rooms(p_hotel_id uuid)
returns table (
  room_number text,
  guest_name  text,
  folio_id    uuid,
  balance     numeric
)
language sql
stable
as $fn$
  select rm.number,
         g.full_name,
         f.id,
         coalesce((select sum(fp.amount) from folio_postings fp
                    where fp.folio_id = f.id), 0)
    from reservations r
    join folios f            on f.reservation_id = r.id
    join room_assignments ra on ra.reservation_id = r.id
                            and ra.released_at is null
    join rooms rm            on rm.id = ra.room_id
    join guests g            on g.id = r.guest_id
   where r.hotel_id = p_hotel_id
     -- Checked in, with an open folio. A reservation that has not arrived has
     -- nobody in the restaurant; a departed one has a folio that is closed.
     and r.status = 'checked_in'
     and f.status = 'open'
   order by rm.number
$fn$;

comment on function app.pos_chargeable_rooms(uuid) is
  'Rooms a POS may charge: checked in, folio open. The waiter list and the '
  'API refusal both read this, so a room cannot appear in one and be refused '
  'by the other.';


-- -----------------------------------------------------------------------------
-- The idempotency guarantee is asserted in db/tests/suite.sql, NOT here.
--
-- It was here first, as a `do $$` block, and it was VACUOUS: migration 017
-- deletes the REPLACE placeholder properties, so by the time this file runs
-- there is no hotel to test against. The block returned early and the
-- migration reported success with the unique constraint deliberately removed.
--
-- That is MEMORY.md defect 10 in a new costume — a guard that quietly does
-- nothing when its subject is missing — written into a file whose own header
-- lectures about exactly that failure. It was caught by removing the
-- constraint and watching the migration pass.
--
-- Assertions belong where the fixtures are. `suite.sql` has two real
-- properties and real staff, and run.sh now compares its assertion count
-- between runs, so one that stops running is visible.
-- -----------------------------------------------------------------------------
