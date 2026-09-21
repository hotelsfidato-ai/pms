-- =============================================================================
-- 124 · The guest's bill, behind the six digits (D21-10)
-- =============================================================================
-- Exactly the bill the desk prints: this wraps finance's one definition,
-- `app.stay_bill` (migration 123), and adds no arithmetic of its own. A second
-- query over folio_postings is how a guest's page and the printed bill come to
-- disagree at check-out.
--
-- Like everything behind the code (121), it answers only through
-- `app.guest_unlocked`: the link's hash AND this phone's unlock, for the stay
-- they resolve to now. The link alone, a stranger with a room card, or an
-- unlock from the last guest in the room gets no row at all.
-- =============================================================================

create or replace function app.guest_bill(p_token_hash text, p_unlock_hash text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select app.stay_bill(v.reservation_id)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v;
$fn$;

comment on function app.guest_bill(text, text) is
  'The bill as it stands, for the guest''s own page - app.stay_bill (123) for '
  'the one stay this link and this phone''s unlock reach, and nothing before '
  'the code is answered (D21-6, D21-10).';

revoke execute on function app.guest_bill(text, text) from public;
grant execute on function app.guest_bill(text, text) to pms_app;
