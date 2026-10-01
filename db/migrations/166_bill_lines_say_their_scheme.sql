-- =============================================================================
-- 166 — a bill's lines say their tax scheme (D27-200, 30 September)
-- =============================================================================
-- The owner: the bill is drawn in sections - Room with GST, Restaurant with
-- GST, Bar with VAT, then other charges. The printed bill reads app.stay_bill,
-- whose lines carried a category and a rate but not the scheme, so a VAT line
-- and a GST line at the same rate could not be told apart.
--
-- 125's function with ONE key added to each line: 'scheme' ('gst' or 'vat').
-- Same return type (jsonb, MEMORY 317); no figure, no row and no other key
-- moves. create or replace, so it replays.
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
           fp.tax_scheme, f.bill_to, co.name as company, f.opened_at
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
    select tax_scheme, tax_rate as rate,
           sum(amount)     as taxable,
           sum(tax_amount) as tax
      from charges
     where tax_amount <> 0 and tax_rate is not null
     group by tax_scheme, tax_rate
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
                'rate', c.tax_rate, 'scheme', c.tax_scheme,
                'billTo', c.bill_to, 'company', c.company)
                order by c.opened_at, c.business_date, c.id)
                from charges c), '[]'::jsonb),
    'taxes', coalesce((select jsonb_agg(jsonb_build_object(
                'rate', b.rate, 'taxable', b.taxable,
                'cgst', round(b.tax / 2, 2), 'sgst', b.tax - round(b.tax / 2, 2))
                order by b.rate)
                from by_rate b where b.tax_scheme = 'gst'), '[]'::jsonb),
    -- VAT (D21-91): one line per rate, never halved.
    'vat', coalesce((select jsonb_agg(jsonb_build_object(
                'rate', b.rate, 'taxable', b.taxable, 'vat', b.tax)
                order by b.rate)
                from by_rate b where b.tax_scheme = 'vat'), '[]'::jsonb),
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
  'own name and GSTIN, the live lines, GST by each line''s own rate split '
  'CGST/SGST, VAT on alcohol as its own line per rate (D21-91), totals, what '
  'was paid. Each line says its scheme, gst or vat (166), so the bill can be '
  'drawn in sections. Invoker rights: row security decides who may read it; the guest''s '
  'door reads it from its own definer function.';

grant execute on function app.stay_bill(uuid) to pms_app;
