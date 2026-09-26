-- =============================================================================
-- 140 · Cash of ₹2 lakh refused, and a PAN above ₹1 lakh (the owner's D25-40)
-- =============================================================================
-- Income-tax Act 2025 s.186 (was 269ST): no cash of ₹2,00,000 or more from one
-- person in a day, for one transaction, or for one event; the penalty under
-- s.451 equals the amount. Income-tax Rules 2026, Rule 159 Table Sl. 15: cash
-- of more than ₹1,00,000 paid to a hotel or restaurant at one time needs the
-- payer's PAN, or Form 97 from somebody who has none; a non-resident is exempt
-- (Rule 159(6)(b)). All in force from 1 April 2026.
--
-- The owner, 26 September: counted "stay, group and day" - the cash already
-- taken on this stay, on the whole group if it is one (a wedding party is one
-- event), and everything this guest paid in cash that day on any stay. Refunds
-- do not bring it down. The till refuses per bill. The PAN, or "Form 97 taken",
-- is kept with the payment, and a foreign guest is not asked.
--
-- The routes ask before they write (api/src/modules/finance/cashLimit.ts);
-- this holds what they keep, and the one count they ask.
-- =============================================================================

alter table payments add column if not exists pan text;
alter table payments add column if not exists form_97 boolean not null default false;
alter table payments drop constraint if exists payments_pan_shape;
alter table payments add constraint payments_pan_shape
  check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

comment on column payments.pan is
  'The payer''s PAN, asked when more than 1,00,000 was paid in cash at once '
  '(Rule 159, D25-40). Null when not asked, or when form_97 is true.';
comment on column payments.form_97 is
  'The payer had no PAN and gave Form 97 instead (Rule 159(2)(b), D25-40).';

-- The restaurant bill: the same two, and the till's own "guest from abroad",
-- because the till has no guest record to read a nationality from.
alter table pos_orders add column if not exists pan text;
alter table pos_orders add column if not exists form_97 boolean not null default false;
alter table pos_orders add column if not exists non_resident boolean not null default false;
alter table pos_orders drop constraint if exists pos_orders_pan_shape;
alter table pos_orders add constraint pos_orders_pan_shape
  check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');

-- CASH ALREADY TAKEN FROM THIS GUEST: on this stay, on its group, and on any
-- of this guest's stays on this business day. A payment reversed as a mistake
-- was never received and is left out; a refund is money going the other way
-- and does not bring the receipt down. Invoker: row security keeps it to the
-- hotels the clerk works at.
create or replace function app.cash_taken(p_stay uuid, p_date date)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(p.amount), 0)
    from reservations me
    join reservations r on r.id = me.id
                        or r.group_id = me.group_id
                        or r.guest_id = me.guest_id
    join folios f         on f.reservation_id = r.id
    join folio_postings fp on fp.folio_id = f.id
    join payments p       on p.posting_id = fp.id
   where me.id = p_stay
     and p.method = 'cash'
     and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)
     and (r.id = me.id
          or r.group_id = me.group_id
          or fp.business_date = p_date)
$$;

comment on function app.cash_taken(uuid, date) is
  'Cash already received from this guest (D25-40): the stay, its group, and '
  'this guest''s other stays on this day. Reversed payments left out; refunds '
  'not subtracted.';
