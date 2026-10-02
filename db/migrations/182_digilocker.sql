-- =============================================================================
-- 182 · DigiLocker, a fourth way in - prepared, switched off (D27-235 2.5)
-- =============================================================================
-- The owner, 2 October: DigiLocker through API Setu as a DigiLocker partner
-- (direct, not a KYC company), prepared now and switched off until the partner
-- keys and the lawyer's answers arrive. Their answers to the plan:
--   · it unlocks the page like Google: the DigiLocker account's mobile must be
--     the booking's own number (the last ten digits);
--   · the ID it vouches for goes to the desk as a SUBMISSION, never confirmed
--     by itself (D21-8);
--   · only the masked Aadhaar number and the name as DigiLocker gives it are
--     kept (D27-207); the eAadhaar XML is never fetched.
--
-- The door (api/src/routes/guestDigilocker.ts) speaks OAuth 2.0 with PKCE to
-- DigiLocker (Authorized Partner API Specification v2.2, October 2022) and
-- hands this file only what it decided on: the state's hash, the verifier,
-- and from the id_token the mobile, the masked number and the name.
--
-- `app.guest_link_open` is NOT touched (online-checkin rule 8, D27-225).
-- The master renumbers at merge; refer to this file as "DigiLocker".
-- =============================================================================

-- One sign-in in flight, ten minutes at most. Nobody reads this table but the
-- three functions below: forced row security and no grant to the app at all.
create table if not exists guest_digilocker_attempts (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,
  link_id     uuid not null references guest_links(id) on delete cascade,
  -- sha256 of the OAuth `state`, which travels through the guest's browser.
  state_hash  text not null unique,
  -- The PKCE code_verifier: useless without the client secret AND the code,
  -- and gone at the first answer or after ten minutes.
  verifier    text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  taken_at    timestamptz
);

alter table guest_digilocker_attempts enable row level security;
alter table guest_digilocker_attempts force  row level security;

comment on table guest_digilocker_attempts is
  'A DigiLocker sign-in in flight (D27-235 2.5): the state''s hash and the PKCE '
  'verifier, for ten minutes and one answer. Read only by the definer functions.';

-- Where a submission came from, and the name the ID carries.
alter table guest_detail_submissions add column if not exists source text not null default 'typed';
alter table guest_detail_submissions drop constraint if exists gds_source_valid;
alter table guest_detail_submissions add constraint gds_source_valid
  check (source in ('typed', 'digilocker'));
alter table guest_detail_submissions add column if not exists id_name text;

comment on column guest_detail_submissions.source is
  'typed: the guest wrote it. digilocker: DigiLocker vouched for it (D27-235) - '
  'still a submission the desk confirms against the real ID.';
comment on column guest_detail_submissions.id_name is
  'The name as DigiLocker gives it, for the desk to compare with the booking.';


-- -----------------------------------------------------------------------------
-- 1 · Begin: a link that reaches a stay with a phone gets one attempt
-- -----------------------------------------------------------------------------
create or replace function app.guest_digilocker_begin(
  p_token_hash text, p_state_hash text, p_verifier text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link uuid; v_hotel uuid;
begin
  if coalesce(length(p_state_hash), 0) <> 64
     or coalesce(length(p_verifier), 0) not between 43 and 128 then
    return false;
  end if;

  select s.link_id, s.hotel_id into v_link, v_hotel
    from app.guest_link_stay(p_token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id
   where length(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g')) >= 10;
  if v_link is null then return false; end if;

  delete from guest_digilocker_attempts where link_id = v_link or expires_at < now();
  insert into guest_digilocker_attempts (hotel_id, link_id, state_hash, verifier, expires_at)
  values (v_hotel, v_link, p_state_hash, p_verifier, now() + interval '10 minutes');
  return true;
end
$fn$;

-- -----------------------------------------------------------------------------
-- 2 · Take: the verifier, once, while the attempt lives
-- -----------------------------------------------------------------------------
create or replace function app.guest_digilocker_take(p_state_hash text)
returns text
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  update guest_digilocker_attempts set taken_at = now()
   where state_hash = p_state_hash and taken_at is null and expires_at > now()
  returning verifier;
$fn$;

-- -----------------------------------------------------------------------------
-- 3 · Answer: the mobile must be the booking's; then the unlock and the
--     submission. The attempt goes either way.
-- -----------------------------------------------------------------------------
create or replace function app.guest_digilocker_answer(
  p_state_hash text, p_mobile text, p_masked_aadhaar text, p_name text, p_unlock_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_attempt guest_digilocker_attempts%rowtype;
  v_stay uuid; v_guest uuid; v_phone text;
  v_mobile text := right(regexp_replace(coalesce(p_mobile, ''), '\D', '', 'g'), 10);
  v_last4  text := substring(coalesce(p_masked_aadhaar, '') from '([0-9]{4})$');
begin
  delete from guest_digilocker_attempts
   where state_hash = p_state_hash and taken_at is not null and expires_at > now()
  returning * into v_attempt;

  if v_attempt.id is null or coalesce(length(p_unlock_hash), 0) <> 64
     or length(v_mobile) <> 10 or v_last4 is null then
    return false;
  end if;

  select s.reservation_id, r.guest_id,
         right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10)
    into v_stay, v_guest, v_phone
    from guest_links l
    cross join lateral app.guest_link_stay(l.token_hash) s
    join reservations r on r.id = s.reservation_id
    join guests g       on g.id = r.guest_id
   where l.id = v_attempt.link_id;

  if v_stay is null or v_phone is distinct from v_mobile then
    return false;
  end if;

  update guest_links set verified_at = now() where id = v_attempt.link_id;
  insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at)
  values (v_attempt.link_id, v_stay, p_unlock_hash, now() + interval '24 hours');

  -- The ID, waiting for the desk. A submission the guest typed and the desk
  -- has not handled keeps everything else it says; DigiLocker's ID replaces
  -- the ID in it (one waiting per stay, 121).
  update guest_detail_submissions
     set id_type = 'aadhaar', id_number = 'xxxxxxxx' || v_last4,
         source = 'digilocker', id_name = nullif(btrim(p_name), '')
   where reservation_id = v_stay and status = 'waiting';
  if not found then
    insert into guest_detail_submissions
      (hotel_id, reservation_id, guest_id, id_type, id_number, source, id_name)
    values (v_attempt.hotel_id, v_stay, v_guest, 'aadhaar', 'xxxxxxxx' || v_last4,
            'digilocker', nullif(btrim(p_name), ''));
  end if;
  return true;
end
$fn$;

comment on function app.guest_digilocker_answer(text, text, text, text, text) is
  'DigiLocker (D27-235 2.5): true, this phone unlocked for a day and the masked '
  'Aadhaar waiting for the desk, only when DigiLocker''s mobile is the booking''s.';

revoke all on function app.guest_digilocker_begin(text, text, text) from public;
revoke all on function app.guest_digilocker_take(text) from public;
revoke all on function app.guest_digilocker_answer(text, text, text, text, text) from public;
grant execute on function app.guest_digilocker_begin(text, text, text) to pms_app;
grant execute on function app.guest_digilocker_take(text) to pms_app;
grant execute on function app.guest_digilocker_answer(text, text, text, text, text) to pms_app;
