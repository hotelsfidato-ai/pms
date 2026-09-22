-- =============================================================================
-- 126 · Alcohol, a switch per property, and the VAT it is taxed under
-- =============================================================================
-- Refer to this file by what it does, never by its number (the master
-- renumbers at merge).
--
-- THE OWNER, 21 September:
--   D21-90  "A switch per hotel - 'serves alcohol' - because some do and many
--            do not." Off by default.
--   D21-91  "10% VAT, not GST: one 'VAT 10%' line on the bill, never split into
--            CGST/SGST, kept out of the GST sales register and the GST part of
--            the accountant's export, with its own VAT ledger. The accountant
--            confirms the rate on the tax screen."
--
-- WHAT THIS ADDS, and nothing more:
--
--   1 · 'alcohol' is a MODULE a property is switched on for. No row is written:
--       `app.module_enabled` reads an absent row as off for anything but `pos`,
--       so every property - and every one made later - is off until the owner
--       or an administrator turns it on (D17-36: the switches are theirs).
--
--   2 · 'alcohol' is a KIND OF SUPPLY: `tax_rules` may hold its rate and a menu
--       section may sell under it. Its rate is VAT. NO RATE IS WRITTEN HERE.
--       The owner said ten per cent and the accountant confirms it; until
--       somebody types it on the tax card the kind has no rule, and a kind with
--       no rule refuses to bill (067) - a dash, never a zero.
--
--   3 · A till line and a folio posting SAY WHICH TAX THEY CARRY:
--       `tax_scheme`, 'gst' or 'vat'. Every row written before this file is GST
--       - it is the only tax this system has ever charged - which is why the
--       column fills in as 'gst' and why 'gst' is what a writer that says
--       nothing gets. Only the till writes 'vat', and only for a dish in an
--       alcohol section that follows the section's rate.
--
--   4 · A REVERSAL CARRIES THE TAX OF THE LINE IT REVERSES. Four writers make
--       reversing rows (the desk's reverse, a folio transfer, an outside till's
--       void, and whatever comes next); one trigger says it once, so a VAT line
--       taken off a bill cannot come off the GST side.
--
--   5 · `app.pos_order_by_tax` - 040's per-rate breakdown, split by tax as well
--       as by rate. `app.pos_order_by_rate` keeps its shape (MEMORY 317: never
--       change a return type an earlier file made) and is now read FROM it, so
--       the discount apportionment is still written once.
--
--   6 · `app.stay_bill` (123) keeps GST in `taxes`, each rate its CGST/SGST
--       pair, and puts VAT in its own `vat` rows - one line per rate, never
--       halved. The totals are unchanged: VAT is tax the guest pays.
--
-- REPLAYED ON EVERY DEPLOY. Every constraint below is rewritten only when it
-- does not already say what this file wants, and 067's rewrite of the menu
-- section's list is guarded the same way now (MEMORY 284, 293, 299).
-- `db/tests/rerun.sh` switches a property on for alcohol, gives it a VAT rate
-- and a section taxed as alcohol between its passes, so a narrowing file fails
-- there rather than on the server.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · the switch
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'hotel_modules'::regclass
       and conname  = 'hotel_modules_known'
       and pg_get_constraintdef(oid) like '%alcohol%'
  ) then
    alter table hotel_modules drop constraint if exists hotel_modules_known;
    alter table hotel_modules add constraint hotel_modules_known
      check (module in ('pos', 'banquet', 'reception_pos', 'channel_manager',
                        'laundry', 'spa', 'alcohol'));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2 · the kind of supply
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'tax_rules'::regclass
       and conname  = 'tax_rules_kind_known'
       and pg_get_constraintdef(oid) like '%alcohol%'
  ) then
    alter table tax_rules drop constraint if exists tax_rules_kind_known;
    alter table tax_rules add constraint tax_rules_kind_known
      check (kind in ('room', 'restaurant', 'bar', 'banquet', 'spa', 'alcohol',
                      'other'));
  end if;
end $$;

comment on constraint tax_rules_kind_known on tax_rules is
  'The kinds of supply a property sells under. ''alcohol'' is VAT, not GST '
  '(D21-91): its rule is the VAT rate, set on the tax card and never seeded.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos_menu_categories'::regclass
       and conname  = 'pos_menu_categories_tax_kind_known'
       and pg_get_constraintdef(oid) like '%alcohol%'
  ) then
    alter table pos_menu_categories
      drop constraint if exists pos_menu_categories_tax_kind_known;
    alter table pos_menu_categories
      add constraint pos_menu_categories_tax_kind_known
      check (tax_kind is null
             or tax_kind in ('restaurant', 'bar', 'banquet', 'alcohol', 'other'));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3 · which tax a line carries
-- -----------------------------------------------------------------------------
alter table pos_order_lines add column if not exists tax_scheme text not null default 'gst';
alter table folio_postings  add column if not exists tax_scheme text not null default 'gst';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'pos_order_lines'::regclass
                    and conname  = 'pos_order_lines_tax_scheme_known') then
    alter table pos_order_lines add constraint pos_order_lines_tax_scheme_known
      check (tax_scheme in ('gst', 'vat'));
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'folio_postings'::regclass
                    and conname  = 'folio_postings_tax_scheme_known') then
    alter table folio_postings add constraint folio_postings_tax_scheme_known
      check (tax_scheme in ('gst', 'vat'));
  end if;
end $$;

comment on column pos_order_lines.tax_scheme is
  'Which tax tax_rate is: ''gst'' (halved into CGST and SGST) or ''vat'' '
  '(alcohol, D21-91 - one line, never halved). Copied onto the line when it is '
  'rung, like the rate.';
comment on column folio_postings.tax_scheme is
  'Which tax tax_rate and tax_amount are: ''gst'' or ''vat'' (alcohol, D21-91). '
  'A reversal always carries the scheme of the posting it reverses.';


-- -----------------------------------------------------------------------------
-- 4 · a reversal carries the tax of what it reverses
-- -----------------------------------------------------------------------------
create or replace function app.folio_posting_reverses_its_tax()
returns trigger language plpgsql as $$
begin
  select fp.tax_scheme into new.tax_scheme
    from folio_postings fp where fp.id = new.reverses_id;
  return new;
end $$;

comment on function app.folio_posting_reverses_its_tax() is
  'A reversing posting takes the tax_scheme of the posting it reverses, '
  'whoever writes it - so VAT taken off a bill comes off VAT, not GST.';

drop trigger if exists folio_postings_reverses_its_tax on folio_postings;
create trigger folio_postings_reverses_its_tax
  before insert on folio_postings
  for each row when (new.reverses_id is not null)
  execute function app.folio_posting_reverses_its_tax();


-- -----------------------------------------------------------------------------
-- 5 · an order, broken down by tax and by rate
-- -----------------------------------------------------------------------------
-- 040's arithmetic, word for word, with the tax added to the grouping. For an
-- order with no VAT line the groups, the discount shares and the residue land
-- exactly where 040 put them: the tie-break still orders by rate first.
create or replace function app.pos_order_by_tax(p_order uuid)
returns table (
  tax_scheme text,
  tax_rate   numeric,
  rate_net   numeric,   -- lines at this rate, before discount
  discount   numeric,   -- this group's share, residue included
  taxable    numeric,   -- rate_net - discount
  tax        numeric    -- on the DISCOUNTED value
)
language sql stable as $$
  with ord as (
    select coalesce(o.discount_amount, 0) as want_disc
      from pos_orders o where o.id = p_order
  ),
  rates as (
    select l.tax_scheme, l.tax_rate, sum(round(l.qty * l.unit_price, 2)) as rate_net
      from pos_order_lines l
     where l.order_id = p_order and not l.voided
     group by l.tax_scheme, l.tax_rate
  ),
  tot as (select coalesce(sum(r.rate_net), 0) as net from rates r),
  capped as (
    select least((select want_disc from ord), (select net from tot)) as disc
  ),
  shared as (
    select
      r.tax_scheme,
      r.tax_rate,
      r.rate_net,
      case when (select net from tot) = 0 then 0
           else round((select disc from capped) * r.rate_net
                      / (select net from tot), 2)
      end as rate_disc,
      row_number() over (order by r.rate_net desc, r.tax_rate, r.tax_scheme)
        as biggest_first
    from rates r
  ),
  settled_shares as (
    select
      s.tax_scheme,
      s.tax_rate,
      s.rate_net,
      s.rate_disc + case when s.biggest_first = 1
                         then (select disc from capped) - sum(s.rate_disc) over ()
                         else 0 end as rate_disc
    from shared s
  )
  select
    s.tax_scheme,
    s.tax_rate,
    s.rate_net,
    s.rate_disc,
    s.rate_net - s.rate_disc,
    round((s.rate_net - s.rate_disc) * s.tax_rate / 100.0, 2)
  from settled_shares s
  order by s.tax_rate, s.tax_scheme;
$$;

comment on function app.pos_order_by_tax(uuid) is
  'The bill broken down by tax (gst or vat) and rate, with any discount '
  'apportioned and the rounding residue absorbed by the largest group. A folio '
  'posting carries one rate and one tax, so this is the shape a POS bill '
  'reaches a folio in.';

-- Same columns, same answers for a GST-only order; read from the one above so
-- the apportionment is not written twice.
create or replace function app.pos_order_by_rate(p_order uuid)
returns table (
  tax_rate numeric,
  rate_net numeric,
  discount numeric,
  taxable  numeric,
  tax      numeric
)
language sql stable as $$
  select t.tax_rate, sum(t.rate_net), sum(t.discount), sum(t.taxable), sum(t.tax)
    from app.pos_order_by_tax(p_order) t
   group by t.tax_rate
   order by t.tax_rate;
$$;

comment on function app.pos_order_by_rate(uuid) is
  'The bill by rate alone - app.pos_order_by_tax added up across GST and VAT. '
  'Anything that must tell GST from VAT reads pos_order_by_tax.';

grant execute on function app.pos_order_by_tax(uuid)  to pms_app;
grant execute on function app.pos_order_by_rate(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 6 · the bill as it stands: GST in pairs, VAT on its own line
-- -----------------------------------------------------------------------------
-- 123's function, with `tax_scheme` read and the tax rows split by it. Same
-- return type (jsonb); `vat` is a new key and nothing else moves.
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
                'rate', c.tax_rate, 'billTo', c.bill_to, 'company', c.company)
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
  'was paid. Invoker rights: row security decides who may read it; the guest''s '
  'door reads it from its own definer function.';

grant execute on function app.stay_bill(uuid) to pms_app;
