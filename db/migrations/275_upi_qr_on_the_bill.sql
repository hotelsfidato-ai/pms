-- =============================================================================
-- 275 · The hotel's UPI ID for the QR code on the bill (D27-396 wave 4,
--       "build all")
-- =============================================================================
-- Refer to it as the migration "the UPI QR on the bill": the master renumbers
-- at the merge.
--
-- An unpaid bill (the proforma bill, a tax invoice with a balance, an open
-- restaurant bill) prints a UPI QR code: the guest scans it with any UPI app
-- and pays the hotel's own UPI ID. Nothing is charged, sent or recorded by the
-- system; the desk records the payment when it arrives.
--
-- The UPI ID lives in `hotel_bank_details` (169), which only whoever MANAGES
-- the hotel may read: the desk has no use for an account number. But the
-- clerk printing the bill needs the UPI ID, which is printed for every guest
-- anyway. So this definer answers THAT and the payee's name - never the
-- account number, the IFSC or the bank - and only to somebody who works at
-- the hotel (app.auth_hotel_ids): anybody else, and the guest's own page
-- (no session), get null, as does a hotel with no UPI ID set.
--
-- The payee is the bank account's name: the UPI ID is only ever set on a bank
-- row, and its account name is required there (169's check).
-- Re-runnable.
-- =============================================================================

create or replace function app.hotel_upi(p_hotel uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object('id', b.upi_id, 'payee', b.account_name)
    from hotel_bank_details b
   where b.hotel_id = p_hotel
     and b.upi_id is not null
     and p_hotel in (select app.auth_hotel_ids());
$fn$;

comment on function app.hotel_upi(uuid) is
  'The hotel''s UPI ID and payee name for the QR on an unpaid bill (D27-396): to its own staff only; '
  'null with none set. Never the account number.';

revoke all on function app.hotel_upi(uuid) from public;
grant execute on function app.hotel_upi(uuid) to pms_app;
