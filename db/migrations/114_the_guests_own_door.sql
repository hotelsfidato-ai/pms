-- =============================================================================
-- 114 · The guest's own door — one private page per booking
-- =============================================================================
-- The owner's D18-9, D18-10 and D18-13, 18 September: a guest checks in before
-- they arrive, asks for the spa, sends laundry and sees their bill, from ONE
-- private page per booking. There is no public page and no account: a guest is
-- not staff, holds no sign-in, and never will.
--
-- WHY THIS IS THE CAREFUL ONE. Every other door in this system is opened by a
-- person the hotel employs. This one is opened by whoever holds a link — and
-- behind it is a guest's name, their passport, and what they owe. So:
--
--   · A LINK IS A SECRET, and secrets are stored the way passwords are: only
--     the sha256 of the token is kept. The database cannot hand anybody a
--     working link, and neither can a backup that leaks.
--   · A LINK IS ONE BOOKING. Not a session, not an account, not "this guest's
--     stays": the token names exactly one reservation and nothing else is
--     reachable from it.
--   · A LINK DIES. At the end of the stay, or sooner if the desk revokes it.
--   · THE QR IN THE ROOM PROVES THE GUEST (D18-13). Scanning is not knowing:
--     a six-digit code goes to the phone the BOOKING carries, never to a
--     number somebody types, and five wrong guesses kill the code.
--   · NOTHING HERE RUNS IN A STAFF SESSION. The functions below are the only
--     way in, each takes a token hash, and each answers about that one
--     booking. There is no guest role, so there is nothing to widen by
--     mistake later.
--
-- The desk's side - "send this guest their link" - is an ordinary staff route
-- under row level security, like everything else a clerk does.
-- =============================================================================

create table if not exists guest_links (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id),
  reservation_id uuid not null references reservations(id),

  -- sha256 of the token, hex. The token itself exists for the length of one
  -- HTTP response and is never written down - the same shape as a POS key.
  token_hash    text not null unique,

  -- How the guest got here, so a screen can say "scanned in room 101" or
  -- "sent by the desk" and the record answers "how did they see this".
  origin        text not null default 'desk'
                check (origin in ('desk', 'confirmation', 'qr')),

  created_at    timestamptz not null default now(),
  created_by    uuid references staff(id),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    uuid references staff(id),

  -- Set when a code sent to the booking's own phone was answered correctly.
  -- Until then the page shows what a person at the desk could see anyway -
  -- their own name and dates - and NOT the bill.
  verified_at   timestamptz,
  last_seen_at  timestamptz,

  constraint guest_links_expires_after_it_starts check (expires_at > created_at)
);

comment on table guest_links is
  'One private page per booking (D18-9). The token is stored as a hash: the '
  'database cannot produce a working link, and a leaked backup is not a set '
  'of keys to every guest bill.';

create index if not exists guest_links_by_reservation
  on guest_links (reservation_id, created_at desc);

-- -----------------------------------------------------------------------------
-- The six digits that prove it is that guest (D18-13)
-- -----------------------------------------------------------------------------
create table if not exists guest_link_codes (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references guest_links(id) on delete cascade,

  -- Hashed, like the token. A code readable in the database is a code an
  -- administrator can use to open a guest's bill.
  code_hash   text not null,

  -- What it was sent to, masked for the record: "…4210". Never the number.
  sent_to     text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  consumed_at timestamptz,

  constraint guest_link_codes_attempts_sane check (attempts between 0 and 10)
);

comment on table guest_link_codes is
  'A code goes to the phone the BOOKING carries, never to a number somebody '
  'types into the page. Five wrong answers and it is dead (D18-13).';

create index if not exists guest_link_codes_live
  on guest_link_codes (link_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Row level security: staff see their own property's links; nobody else does
-- -----------------------------------------------------------------------------
alter table guest_links       enable row level security;
alter table guest_links       force  row level security;
alter table guest_link_codes  enable row level security;
alter table guest_link_codes  force  row level security;

drop policy if exists guest_links_by_hotel on guest_links;
create policy guest_links_by_hotel on guest_links
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- A code is reachable only through its link, and the guest's door does not use
-- policies at all: it goes through the definer functions below. Staff have no
-- business reading codes, so no policy grants it - the table is closed.
drop policy if exists guest_link_codes_none on guest_link_codes;

grant select, insert, update on guest_links to pms_app;
-- deliberately NOT granted on guest_link_codes: nothing a person does touches it.

-- -----------------------------------------------------------------------------
-- The only way in, and each one answers about ONE booking
-- -----------------------------------------------------------------------------
-- Every function takes the HASH of the token. The API hashes what arrived and
-- never sends the token to the database, so a query log is not a set of keys.

-- What the page may show before the guest has proved who they are: their own
-- name and their own dates. Anybody holding the link was given it by the
-- hotel or is standing in the room, and this is what a person at the desk
-- would tell them across the counter.
create or replace function app.guest_link_open(p_token_hash text)
returns table (
  link_id uuid, hotel_id uuid, hotel_code text, hotel_name text,
  reservation_id uuid, reference text, guest_name text,
  /* TEXT, not date. A `date` comes back to node as a Date at midnight in
     whatever zone the server keeps, which is how a stay that starts on the
     29th reaches a screen as the 28th (BQ-8's family, migration 113). */
  check_in text, check_out text, status text,
  verified boolean, phone_hint text
)
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  update guest_links set last_seen_at = now()
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  select l.id, h.id, h.code, h.name,
         r.id, r.reference, g.full_name,
         r.check_in::text, r.check_out::text, r.status,
         l.verified_at is not null,
         /* Enough for the guest to recognise their own number and no more:
            the last four digits, or nothing if the booking has no phone. */
         case when g.phone is null or length(g.phone) < 4 then null
              else '…' || right(g.phone, 4) end
    from guest_links l
    join reservations r on r.id = l.reservation_id
    join hotels h       on h.id = l.hotel_id
    join guests g       on g.id = r.guest_id
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > now();
$fn$;

comment on function app.guest_link_open(text) is
  'What a guest''s page may show before the six-digit code: their own name and '
  'dates, and the last four digits of the number the booking carries. Never '
  'the bill (D18-13).';

-- A code, for the number the BOOKING carries. The caller passes what the guest
-- typed; if it does not match the booking's own number, no code is made and
-- the answer says only "we have sent it if that number is right" - a page that
-- says "wrong number" is a page that confirms which number is right.
create or replace function app.guest_code_issue(p_token_hash text, p_phone text)
returns table (code text, sent_to text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid;
  v_phone text;
  v_code text;
begin
  select l.id, g.phone into v_link, v_phone
    from guest_links l
    join reservations r on r.id = l.reservation_id
    join guests g       on g.id = r.guest_id
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > now();

  if v_link is null or v_phone is null then
    return;                                     -- nothing, and nothing said
  end if;

  -- Digits only, both sides: a guest types 98765 43210 or +91 98765 43210 and
  -- means the same number the desk wrote down with spaces in it.
  if right(regexp_replace(v_phone, '\D', '', 'g'), 10)
     <> right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) then
    return;
  end if;

  -- Six digits, and never 000000: gen_random_bytes is the same source the
  -- rest of this system trusts for keys.
  v_code := lpad((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');

  /* One live code at a time. A guest who asks twice invalidates the first,
     so a code read over somebody's shoulder is worth nothing a minute later. */
  update guest_link_codes set consumed_at = now()
   where link_id = v_link and consumed_at is null;

  insert into guest_link_codes (link_id, code_hash, sent_to, expires_at)
  values (v_link, encode(digest(v_code, 'sha256'), 'hex'),
          '…' || right(regexp_replace(v_phone, '\D', '', 'g'), 4),
          now() + interval '10 minutes');

  return query select v_code, '…' || right(regexp_replace(v_phone, '\D', '', 'g'), 4);
end
$fn$;

comment on function app.guest_code_issue(text, text) is
  'A six-digit code for the number the BOOKING carries. A number that does not '
  'match gets no code and no explanation - saying "wrong number" would confirm '
  'the right one (D18-13).';

create or replace function app.guest_code_check(p_token_hash text, p_code text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid;
  v_id   uuid;
  v_ok   boolean := false;
begin
  select l.id into v_link
    from guest_links l
   where l.token_hash = p_token_hash
     and l.revoked_at is null
     and l.expires_at > now();
  if v_link is null then
    return false;
  end if;

  select c.id,
         c.code_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex')
    into v_id, v_ok
    from guest_link_codes c
   where c.link_id = v_link
     and c.consumed_at is null
     and c.expires_at > now()
     and c.attempts < 5
   order by c.created_at desc
   limit 1;

  if v_id is null then
    return false;                               -- none live, or five wrong
  end if;

  update guest_link_codes
     set attempts = attempts + 1,
         consumed_at = case when v_ok then now() else consumed_at end
   where id = v_id;

  if v_ok then
    update guest_links set verified_at = now() where id = v_link;
  end if;

  return v_ok;
end
$fn$;

comment on function app.guest_code_check(text, text) is
  'True once, for the right code. Counts every attempt and dies at five, so a '
  'guessed code is a million tries that end after five (D18-13).';

-- pms_app is the role the API connects as. It may call these; it may not read
-- the tables behind them.
grant execute on function app.guest_link_open(text)          to pms_app;
grant execute on function app.guest_code_issue(text, text)   to pms_app;
grant execute on function app.guest_code_check(text, text)   to pms_app;
