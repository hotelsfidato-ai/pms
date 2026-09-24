-- =============================================================================
-- 130 · A message to the front desk, from the guest's own page (D23-14)
-- =============================================================================
-- The owner, 23 September: "One 'Message the front desk' box: the guest types
-- anything; it lands in that booking's Guest messages at the desk with an
-- unread count, and the desk marks it handled."
--
-- It is a guest request of a third kind, 'desk', in 121's `guest_requests`:
-- the same row a spa or laundry request is - the stay it came from, the words,
-- open until a person marks it, and who and when - written by the same definer
-- function behind the same unlock, with the same limits (500 characters, ten
-- open at once for the stay). "Open" is "unread".
--
-- Only two things change, and neither changes a signature (MEMORY 317):
--   · the kind check takes 'desk';
--   · `app.guest_request_make` takes 'desk' where the hotel has no module to
--     switch on - the desk is always there. Its body only; the same arguments
--     and the same boolean, so 121's `create or replace` on a replay makes the
--     old body and this file makes this one again.
-- =============================================================================

alter table guest_requests drop constraint if exists gr_kind_valid;
alter table guest_requests add constraint gr_kind_valid
  check (kind in ('spa', 'laundry', 'desk'));

create or replace function app.guest_request_make(
  p_token_hash text, p_unlock_hash text, p_kind text, p_what text, p_wanted text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null
     or p_kind not in ('spa', 'laundry', 'desk')
     or (p_kind <> 'desk' and not app.module_enabled(v.hotel_id, p_kind))
     or (select count(*) from guest_requests
          where reservation_id = v.reservation_id and status = 'open') >= 10 then
    return false;
  end if;

  insert into guest_requests (hotel_id, reservation_id, kind, what, wanted)
  values (v.hotel_id, v.reservation_id, p_kind, trim(p_what), nullif(trim(p_wanted), ''));
  return true;
end
$fn$;

comment on function app.guest_request_make(text, text, text, text, text) is
  'A spa or laundry request where the hotel offers it (D21-63), or a message to '
  'the front desk (D23-14) - behind this phone''s unlock, ten open at most.';
