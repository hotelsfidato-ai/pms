-- =============================================================================
-- 174 · The hotel's logo on the guest's own page (D27-223)
-- =============================================================================
-- The owner, 1 October: "the guest's page shows the hotel's logo, else the
-- group's" - the rule every guest document already follows (D27-214; the
-- voucher's `app.guest_voucher`, 168 section 5).
--
-- The staff screens read the logo through `groupSettings.ts`, under a
-- person's session; the guest's door has no person, so it asks this one
-- definer function instead - the same coalesce, PNG or SVG (an <img> draws
-- both). It answers ONLY the picture: its type, its bytes and a tag for the
-- browser's cache, the same for every link to that hotel. Nothing of the
-- stay or the guest, so it needs no unlock: the page shows the hotel's name
-- before the code already. A revoked, expired or unknown link answers no row.
-- New function only; nothing earlier is changed (MEMORY 317).
-- =============================================================================

create or replace function app.guest_logo(p_token_hash text)
returns table (logo_type text, logo bytea, tag text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select l.logo_type, l.logo, md5(l.logo)
    from app.guest_link_stay(p_token_hash) s
    cross join lateral (
      select 1 as rank, hl.logo_type, hl.logo from hotel_logos hl where hl.hotel_id = s.hotel_id
      union all
      select 2, gs.logo_type, gs.logo from group_settings gs where gs.logo is not null
      order by 1
      limit 1) l;
$fn$;

comment on function app.guest_logo(text) is
  'The logo for the guest''s page (D27-223): the link''s hotel''s own, else the '
  'group''s. The picture only; no row for a link that does not open.';

revoke all on function app.guest_logo(text) from public;
grant execute on function app.guest_logo(text) to pms_app;
