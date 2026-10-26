-- =============================================================================
-- 241 · The guest's proforma bill is the desk's (the owner's D27-365 (5),
--       26 October)
-- =============================================================================
-- Since D27-344 the desk's proforma bill prints what the tax invoice does: the
-- stay's facts, the payments, the hotel's contacts and PAN, and each line's
-- HSN/SAC. The desk built those parts in the API with a staff session
-- (finance/folios.ts, finance/invoices.ts), so the guest's own page - which has
-- no session - printed the bill without them. The owner: make it identical.
--
-- ONE DEFINITION, MOVED HERE, NOT COPIED. The parts the desk built in the API
-- are now these functions, and the API calls them:
--
--   app.stay_facts(stay)        the stay as the printed documents show it -
--                               the tax invoice, the proforma, the registration
--                               card (was invoices.ts `stayFacts`)
--   app.bill_payments(folios)   money in, net of refunds, on those bills (was
--                               invoices.ts `paymentsOn`)
--   app.stay_proforma(stay)     `app.stay_bill` (123) with the parts above, the
--                               hotel's contacts, PAN and FSSAI number, and
--                               each line's HSN/SAC (was folios.ts' bill route)
--
-- ⚠ ALL THREE ARE SECURITY INVOKER, ON PURPOSE, as `app.stay_bill` is: row
-- security decides whose stay a clerk's session may read, exactly as the
-- queries they replace did. Only the guest's door reads past it, through
-- `app.guest_bill` below, which is a definer and reaches ONE stay: the one the
-- link's hash AND this phone's unlock resolve to now (`app.guest_unlocked`,
-- 121). The link alone, a stranger with a room card, or the last guest's
-- unlock reach no row, and so no bill.
--
-- NOT ON THE GUEST'S COPY: tonight's room night "to be posted tonight" and the
-- count of nights to come - the desk's print only (the owner's D27-205); the
-- API adds those beside this, for staff.
--
-- Re-runnable: create or replace, the same signatures and return types.
-- =============================================================================

create or replace function app.stay_facts(p_reservation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object(
    'reference', r.reference,
    -- The registration card's number, given at check-in (230).
    'grCardNo', r.gr_card_no,
    'guest', g.full_name,
    'roomType', rt.name,
    'room', (select rm.number from room_assignments ra join rooms rm on rm.id = ra.room_id
              where ra.reservation_id = r.id
              order by ra.released_at desc nulls first, ra.from_date desc limit 1),
    'adults', r.adults, 'children', r.children,
    'plan', r.meal_plan,
    'nights', case when r.is_day_use then 0 else greatest(r.check_out - r.check_in, 0) end,
    -- The moment of check-in and check-out where the trail has it, else the
    -- booked day.
    'arrival', coalesce(app.hotel_clock(r.hotel_id, cin.at, 'DD Mon YYYY, HH24:MI'), to_char(r.check_in, 'DD Mon YYYY')),
    'departure', coalesce(app.hotel_clock(r.hotel_id, cout.at, 'DD Mon YYYY, HH24:MI'), to_char(r.check_out, 'DD Mon YYYY')),
    'source', app.booking_source_label(bs.name, co.name, r.source),
    'checkedInBy', cin.who,
    'checkedOutBy', cout.who)
    from reservations r
    join guests g on g.id = r.guest_id
    join room_types rt on rt.id = r.room_type_id
    left join booking_sources bs on bs.id = r.booking_source_id
    left join companies co on co.id = r.company_id
    left join lateral (
      select a.at, s.full_name as who from audit_log a left join staff s on s.id = a.actor
       where a.table_name = 'reservations' and a.row_id = r.id::text
         and a.after->>'status' = 'checked_in' and a.before->>'status' is distinct from 'checked_in'
       order by a.at desc limit 1) cin on true
    left join lateral (
      select a.at, s.full_name as who from audit_log a left join staff s on s.id = a.actor
       where a.table_name = 'reservations' and a.row_id = r.id::text
         and a.after->>'status' = 'checked_out' and a.before->>'status' is distinct from 'checked_out'
       order by a.at desc limit 1) cout on true
   where r.id = p_reservation_id;
$fn$;

comment on function app.stay_facts(uuid) is
  'The stay as the printed documents show it (D27-342, D27-344): booking, room, '
  'guests, plan, nights, arrival and departure, who checked the guest in and out. '
  'Invoker rights: row security decides who may read it.';

grant execute on function app.stay_facts(uuid) to pms_app;

create or replace function app.bill_payments(p_folio_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  -- Each payment and refund not reversed (a receipt is a negative line;
  -- shown as received).
  select coalesce(jsonb_agg(jsonb_build_object(
           'date', to_char(fp.business_date, 'YYYY-MM-DD'),
           'description', fp.description,
           'amount', -fp.amount)
           order by fp.business_date, fp.created_at, fp.id), '[]'::jsonb)
    from folio_postings fp
   where fp.folio_id = any(p_folio_ids)
     and fp.category in ('payment', 'refund')
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id);
$fn$;

comment on function app.bill_payments(uuid[]) is
  'Money in, net of refunds, on these bills (D27-342). Invoker rights: row '
  'security decides who may read it.';

grant execute on function app.bill_payments(uuid[]) to pms_app;

create or replace function app.stay_proforma(p_reservation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  select b || jsonb_build_object(
    -- Each line's code: the hotel's for its kind (Settings > Taxes), a room's
    -- 996311 where none is typed (the invoices' own default).
    'lines', coalesce((select jsonb_agg(l || jsonb_build_object('sac',
                case when l->>'category' = 'room' then coalesce(t.codes->>'room', '996311')
                     else t.codes->>(l->>'category') end) order by n)
                from jsonb_array_elements(b->'lines') with ordinality x(l, n)), '[]'::jsonb),
    -- How to reach the hotel, its PAN (the one inside its GSTIN where none is
    -- typed) and its FSSAI number.
    'hotel', (b->'hotel') || jsonb_build_object(
                'email', h.email::text, 'website', h.website, 'fssai', h.fssai_number,
                'pan', coalesce(h.pan, case when length(h.gstin) = 15 then substr(h.gstin, 3, 10) end)),
    'details', app.stay_facts(r.id),
    'payments', app.bill_payments(array(select f.id from folios f where f.reservation_id = r.id)))
    from app.stay_bill(p_reservation_id) b
    join reservations r on r.id = p_reservation_id
    join hotels h on h.id = r.hotel_id
    cross join lateral (select jsonb_object_agg(s.kind, s.sac_code) as codes
                          from tax_sac s where s.hotel_id = h.id) t
   where b is not null;
$fn$;

comment on function app.stay_proforma(uuid) is
  'The proforma bill (D27-344): app.stay_bill with the stay''s facts, the '
  'payments, the hotel''s contacts, PAN and FSSAI number, and each line''s '
  'HSN/SAC. The desk''s print and the guest''s page both read it. Invoker '
  'rights: row security decides who may read it.';

grant execute on function app.stay_proforma(uuid) to pms_app;

-- THE GUEST'S BILL (124), now the whole proforma (D27-365 (5)). The same
-- guard, the same signature: the stay comes only from `app.guest_unlocked`.
create or replace function app.guest_bill(p_token_hash text, p_unlock_hash text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select app.stay_proforma(v.reservation_id)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v;
$fn$;

comment on function app.guest_bill(text, text) is
  'The proforma bill as the desk prints it, for the guest''s own page - '
  'app.stay_proforma (241) for the one stay this link and this phone''s unlock '
  'reach, and nothing before the code is answered (D21-6, D21-10, D27-365).';

revoke execute on function app.guest_bill(text, text) from public;
grant execute on function app.guest_bill(text, text) to pms_app;
