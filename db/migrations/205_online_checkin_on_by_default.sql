-- =============================================================================
-- 205 · Online check-in is on for every hotel (the owner's D27-281 (3),
--       5 October)
-- =============================================================================
-- Reverses D27-266's "later": with no saved switch, online check-in is ON -
-- the voucher prints the guest's own check-in link and QR code, the email has
-- its link line, and the desk's Send check-in link shows. A hotel that saved
-- it OFF stays off. 193's function, the same signature, with one word changed.
--
-- Re-runnable.
-- =============================================================================

create or replace function app.online_checkin_on(p_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce((select s.is_on from guest_message_settings s
                    where s.hotel_id = p_hotel and s.kind = 'online-checkin'), true)
$fn$;

revoke all on function app.online_checkin_on(uuid) from public;
grant execute on function app.online_checkin_on(uuid) to pms_app;

comment on table guest_message_settings is
  'Each guest message switched On or Off for one hotel (D27-261, D27-264, D27-281): '
  'the voucher, online check-in, the invoice, the review request. No row: the '
  'voucher and online check-in on, the invoice and the review request off until switched on.';
