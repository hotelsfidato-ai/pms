-- =============================================================================
-- 123 · The bill as it stands — one definition, for the desk and the guest
-- =============================================================================
-- Refer to this file by what it does, never by its number.
--
-- THE OWNER, 21 September: a guest sees "exactly the interim bill the desk
-- prints" (D21-10), and the desk's printed bill must stop carrying a made-up
-- tax number (approved the same day).
--
-- WHAT WAS WRONG, measured before this was written. The desk's printed bill
-- (FolioPanel's Invoice dialog) built itself in the browser, and:
--   · printed "5 Elements By Fidato Hotels · Akkalkot · GSTIN 27AAAAA0000A1Z5"
--     as fixed text at every hotel - the demo's number, which the fixture
--     itself labels "NOT A REAL GSTIN" - never the hotel's own;
--   · printed "CGST 2.5% / SGST 2.5%" whatever the lines were taxed at, so a
--     room over ₹7,500 (18%) read as 5%;
--   · counted a REVERSING line while leaving out the line it reversed, so a
--     corrected charge came off the net twice.
-- Live on 18 September's version too. Nobody had been handed one: nobody
-- uses live for real yet.
--
-- ONE DEFINITION. `app.stay_bill` answers what the bill says, from the ledger
-- and the hotel's own record, and both the desk (GET .../stays/:id/bill) and
-- the guest's page read it. A second definition of "what the guest owes" is
-- how a page and a printout come to disagree at check-out.
--
-- ⚠ SECURITY INVOKER, ON PURPOSE. Row security decides who sees it: a clerk's
-- session sees only their own hotels' stays, exactly as every other finance
-- read. The guest's door calls it from inside its own security-definer
-- function, which reaches only the stay its token resolves to (121) - so the
-- same function serves both without a second copy and without a new door.
--
-- THE LEDGER'S LIVE LINES are the ones FOLIO_SELECT (api finance/folios.ts)
-- has always summed for the balance: not a reversing line, and not a line
-- somebody reversed. Both sides of a correction go, which is what makes it
-- cancel.
--
-- NO DEFAULT FIGURES. A hotel with no GSTIN answers null (the page prints a
-- dash); a line with no tax has no tax row; nothing is filled in.
-- =============================================================================

create or replace function app.stay_bill(p_reservation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $fn$
  with stay as (
    select r.id, r.hotel_id, r.reference, r.check_in, r.check_out,
           g.full_name as guest
      from reservations r
      join guests g on g.id = r.guest_id
     where r.id = p_reservation_id
  ),
  live as (
    select fp.id, fp.business_date, fp.category, fp.description,
           fp.amount, coalesce(fp.tax_amount, 0) as tax_amount, fp.tax_rate,
           f.bill_to, co.name as company, f.opened_at
      from folio_postings fp
      join folios f on f.id = fp.folio_id
      left join companies co on co.id = f.company_id
      join stay s on s.id = f.reservation_id
     where fp.reverses_id is null
       and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
  ),
  charges as (select * from live where category <> 'payment'),
  totals as (
    select coalesce(sum(amount), 0)                      as net,
           coalesce(sum(tax_amount), 0)                  as tax
      from charges
  ),
  paid as (
    select coalesce(-sum(amount), 0) as paid from live where category = 'payment'
  ),
  by_rate as (
    -- CGST and SGST are each HALF of the line's own rate, and of its tax.
    select tax_rate as rate,
           sum(amount)     as taxable,
           sum(tax_amount) as tax
      from charges
     where tax_amount <> 0 and tax_rate is not null
     group by tax_rate
  )
  select case when not exists (select 1 from stay) then null else jsonb_build_object(
    'hotel', (select jsonb_build_object(
                'name', h.name, 'address', h.address_line, 'city', h.city,
                'state', h.state, 'phone', h.phone, 'gstin', h.gstin)
                from hotels h join stay s on s.hotel_id = h.id),
    'stay', (select jsonb_build_object(
                'reference', s.reference, 'guest', s.guest,
                'checkIn', s.check_in::text, 'checkOut', s.check_out::text,
                'room', app.stay_room(s.id))
                from stay s),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                'date', c.business_date::text, 'description', c.description,
                'category', c.category, 'amount', c.amount, 'tax', c.tax_amount,
                'rate', c.tax_rate, 'billTo', c.bill_to, 'company', c.company)
                order by c.opened_at, c.business_date, c.id)
                from charges c), '[]'::jsonb),
    'taxes', coalesce((select jsonb_agg(jsonb_build_object(
                'rate', b.rate, 'taxable', b.taxable,
                'cgst', round(b.tax / 2, 2), 'sgst', b.tax - round(b.tax / 2, 2))
                order by b.rate)
                from by_rate b), '[]'::jsonb),
    'net',      (select net from totals),
    'tax',      (select tax from totals),
    'total',    (select net + tax from totals),
    'rounded',  (select round(net + tax, 0) from totals),
    'roundOff', (select round(net + tax, 0) - (net + tax) from totals),
    'paid',     (select paid from paid),
    'balance',  (select (select net + tax from totals) - (select paid from paid))
  ) end;
$fn$;

comment on function app.stay_bill(uuid) is
  'The one definition of a stay''s bill as it stands (D21-10): the hotel''s '
  'own name and GSTIN, the live lines, tax by each line''s own rate split '
  'CGST/SGST, totals, what was paid. Invoker rights: row security decides '
  'who may read it; the guest''s door reads it from its own definer function.';

grant execute on function app.stay_bill(uuid) to pms_app;
