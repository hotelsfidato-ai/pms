-- =============================================================================
-- FINANCE — the service's own database checks
-- =============================================================================
-- ALCOHOL AND ITS VAT (the owner, 21 September: D21-90, D21-91). Refers to its
-- migration by what it does - "alcohol, a switch per property, and the VAT it
-- is taxed under" - never by its number (the master renumbers at merge).
--
-- WHAT IS BEING GUARDED, in the order it matters:
--
--   1 · the bill: VAT on alcohol is ONE line per rate, never a CGST/SGST pair,
--       and never merged into a GST rate that happens to be the same number;
--   2 · a reversal carries the tax of what it reverses, whoever writes it, so
--       VAT taken off a bill comes off VAT;
--   3 · a till bill split by tax as well as by rate, with the discount still
--       apportioned once, and the old per-rate answer unchanged beside it;
--   4 · nothing is seeded: the switch is off and there is no VAT rate until a
--       person sets one.
--
-- Builds its own property and leaves it, like shared.sql and spa.sql. Every
-- figure below is this file's own, not a rate anybody has decided.
-- =============================================================================

-- A NEW HOTEL HAS NO GST RATE (D22-9, "a new hotel has no GST rate until
-- somebody sets one"). Asked of the function that makes a property, directly.
do $$
declare h uuid;
begin
  h := app.provision_property_unchecked('NGR', 'No Rate Test', 'Nowhere');
  perform test.ok('finance gst', 'a new property is made with no CGST or SGST rate: a dash, never 2.5',
    (select cgst_rate is null and sgst_rate is null from hotels where id = h),
    (select coalesce(cgst_rate::text, 'null') || ' / ' || coalesce(sgst_rate::text, 'null')
       from hotels where id = h));
end $$;

-- A NEW YEAR'S GST SERIES OPENS ITSELF (D24-22, FIN-8): the first invoice of
-- a year with no series row is numbered 00001, not refused; the prefix is the
-- one the hotel already uses, and the old year's series does not move.
do $$
declare h uuid; fy text; before bigint; n text;
begin
  h := app.provision_property_unchecked('NFY', 'New Year Test', 'Nowhere');
  fy := app.current_fin_year(h);
  update invoice_series set prefix = 'NFY-X' where hotel_id = h and fin_year = fy;
  select next_number into before from invoice_series where hotel_id = h and fin_year = fy;
  n := app.next_invoice_number(h, '2097-98');
  perform test.ok('finance gst', 'a new year''s first GST invoice opens its own series, at 00001',
    n = 'NFY-X/2097-98/00001', n);
  n := app.next_invoice_number(h, '2097-98');
  perform test.ok('finance gst', 'and the next follows it, in the same five digits',
    n = 'NFY-X/2097-98/00002', n);
  perform test.ok('finance gst', 'the year before is not touched',
    (select next_number from invoice_series where hotel_id = h and fin_year = fy) = before);
end $$;

do $$
declare
  h uuid; rt uuid; g uuid; res uuid; fol uuid; clerk uuid;
  outlet uuid; ord uuid; ord2 uuid;
  food bigint; spirits bigint; rev bigint; bd date;
  bill jsonb; v text; n int; v_num numeric;
begin
  h := app.provision_property_unchecked('VAT', 'VAT Test', 'Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';
  bd := app.business_date(h);

  insert into staff (email, full_name) values ('vat-clerk@fidato.in', 'VAT Test Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  delete from staff_hotels where staff_id = clerk;
  insert into staff_hotels (staff_id, hotel_id, role) values (clerk, h, 'front_desk');

  insert into guests (full_name, phone) values ('VAT Test Guest', '9000000091')
  returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, bd, bd + 2, 3000, 'checked_in')
  returning id into res;
  insert into folios (hotel_id, reservation_id, status) values (h, res, 'open')
  returning id into fol;


  -- ===========================================================================
  -- 4 · NOTHING IS SEEDED
  -- ===========================================================================
  perform test.ok('finance vat', 'a new property is not switched on for alcohol (D21-90: off by default)',
    not app.module_enabled(h, 'alcohol'));
  perform test.ok('finance vat', 'and has no VAT rate: a missing rate is a dash, never 0',
    app.gst_rate_or_null(h, 'alcohol', 1000) is null,
    coalesce(app.gst_rate_or_null(h, 'alcohol', 1000)::text, 'null'));
  perform test.raises('finance vat', 'so billing under alcohol raises rather than billing at nought',
    format($q$select app.gst_rate(%L, 'alcohol', 1000)$q$, h), '23514');

  -- The three lists that had to learn the word.
  perform test.allows('finance vat', 'alcohol is a module a property can be switched on for',
    format($q$insert into hotel_modules (hotel_id, module, is_enabled) values (%L, 'alcohol', true)$q$, h));
  perform test.allows('finance vat', 'alcohol is a kind of supply a rate can be set for',
    format($q$insert into tax_rules (hotel_id, kind, over_amount, rate) values (%L, 'alcohol', 0, 10)$q$, h));
  perform test.allows('finance vat', 'a menu section can sell under alcohol',
    format($q$insert into pos_menu_categories (hotel_id, name, tax_kind) values (%L, 'Spirits', 'alcohol')$q$, h));
  perform test.raises('finance vat', 'a spa is still not a menu section''s heading',
    format($q$insert into pos_menu_categories (hotel_id, name, tax_kind) values (%L, 'Rubs', 'spa')$q$, h),
    '23514');


  -- ===========================================================================
  -- 1 · THE BILL: GST IN PAIRS, VAT ON ITS OWN LINE
  -- ===========================================================================
  -- Food at 5% GST, whisky at 10% VAT - and a charge at 10% GST, the same
  -- number as the VAT, which must not fold into it.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount)
  values (h, fol, bd, 'food', 'VAT test: dinner', 1000, 5, 50)
  returning id into food;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, tax_scheme)
  values (h, fol, bd, 'beverage', 'VAT test: whisky', 1500, 10, 150, 'vat')
  returning id into spirits;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount)
  values (h, fol, bd, 'misc', 'VAT test: something at ten per cent GST', 200, 10, 20);

  perform test.ok('finance vat', 'a posting that names no tax is GST - every row before alcohol was',
    (select tax_scheme from folio_postings where id = food) = 'gst');
  perform test.raises('finance vat', 'a posting cannot carry a tax this system does not know',
    format($q$insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                          amount, tax_rate, tax_amount, tax_scheme)
              values (%L, %L, %L, 'misc', 'x', 10, 0, 0, 'sales tax')$q$, h, fol, bd),
    '23514');

  bill := app.stay_bill(res);

  perform test.ok('finance vat', 'the bill has one VAT row, for the whisky',
    jsonb_array_length(bill->'vat') = 1, (bill->'vat')::text);
  perform test.ok('finance vat', 'that row is the VAT itself, whole - VAT 10% on 1,500 is 150, not two halves of 75',
    (bill->'vat'->0->>'rate')::numeric = 10
      and (bill->'vat'->0->>'taxable')::numeric = 1500
      and (bill->'vat'->0->>'vat')::numeric = 150
      and not (bill->'vat'->0 ? 'cgst') and not (bill->'vat'->0 ? 'sgst'),
    (bill->'vat')::text);
  perform test.ok('finance vat', 'the GST rows are the food and the 10% GST charge - the whisky is in neither',
    (select coalesce(sum((t->>'taxable')::numeric), 0) from jsonb_array_elements(bill->'taxes') t) = 1200,
    (bill->'taxes')::text);
  perform test.ok('finance vat', 'a GST rate equal to the VAT rate stays GST, in its own CGST/SGST pair',
    exists (select 1 from jsonb_array_elements(bill->'taxes') t
             where (t->>'rate')::numeric = 10 and (t->>'taxable')::numeric = 200
               and (t->>'cgst')::numeric = 10 and (t->>'sgst')::numeric = 10),
    (bill->'taxes')::text);
  perform test.ok('finance vat', 'and the bill''s total still counts the VAT: it is tax the guest pays',
    (bill->>'tax')::numeric = 220 and (bill->>'total')::numeric = 2920,
    format('tax %s total %s', bill->>'tax', bill->>'total'));


  -- ===========================================================================
  -- 2 · A REVERSAL CARRIES THE TAX OF WHAT IT REVERSES
  -- ===========================================================================
  -- Written as the desk's reverse writes it - no tax named - and then as a
  -- careless writer might, naming the wrong one.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, reverses_id)
  values (h, fol, bd, 'beverage', 'Reversal - VAT test: whisky', -1500, 10, -150, spirits)
  returning id into rev;
  perform test.ok('finance vat', 'a reversal of a VAT posting is VAT, though its writer named no tax',
    (select tax_scheme from folio_postings where id = rev) = 'vat',
    (select tax_scheme from folio_postings where id = rev));

  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, tax_scheme)
  values (h, fol, bd, 'beverage', 'VAT test: gin', 800, 10, 80, 'vat')
  returning id into spirits;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, tax_scheme, reverses_id)
  values (h, fol, bd, 'beverage', 'Void - VAT test: gin', -800, 10, -80, 'gst', spirits)
  returning id into rev;
  perform test.ok('finance vat', 'and stays VAT when its writer named GST - it cannot come off the GST side',
    (select tax_scheme from folio_postings where id = rev) = 'vat',
    (select tax_scheme from folio_postings where id = rev));

  bill := app.stay_bill(res);
  perform test.ok('finance vat', 'with both drinks reversed, the bill has no VAT line at all',
    jsonb_array_length(bill->'vat') = 0, (bill->'vat')::text);


  -- ===========================================================================
  -- 3 · A TILL BILL, BY TAX AND BY RATE
  -- ===========================================================================
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'VATBAR', 'VAT Test Bar', 'food', clerk)
  returning id into outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, outlet, app.pos_next_order_no(h, bd), bd, clerk)
  returning id into ord;

  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (ord, h, 'Paneer tikka', 1, 1000, 5, clerk);
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, tax_scheme, added_by)
  values (ord, h, 'Whisky (30 ml)', 2, 250, 10, 'vat', clerk);
  update pos_orders
     set discount_amount = 150, discount_type = 'fixed', discount_value = 150,
         discount_reason = 'VAT test'
   where id = ord;

  perform test.ok('finance vat', 'a till line that names no tax is GST',
    (select tax_scheme from pos_order_lines where order_id = ord and name = 'Paneer tikka') = 'gst');
  perform test.raises('finance vat', 'a till line cannot carry a tax this system does not know',
    format($q$insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, tax_scheme, added_by)
              values (%L, %L, 'x', 1, 1, 0, 'excise', %L)$q$, ord, h, clerk),
    '23514');

  select count(*) into n from app.pos_order_by_tax(ord);
  perform test.ok('finance vat', 'the bill breaks into a GST group and a VAT group', n = 2, n::text);
  select sum(discount) into v_num from app.pos_order_by_tax(ord);
  perform test.ok('finance vat', 'the discount is shared across both, to the paisa', v_num = 150, v_num::text);
  select tax into v_num from app.pos_order_by_tax(ord) where tax_scheme = 'vat';
  -- 500 of whisky carries a third of the 150 discount: 450 taxable, 45 VAT.
  perform test.ok('finance vat', 'the VAT is on the whisky after its share of the discount',
    v_num = 45, coalesce(v_num::text, 'null'));
  perform test.ok('finance vat', 'the per-rate answer every older reader uses is unchanged beside it',
    (select sum(taxable) from app.pos_order_by_rate(ord))
      = (select sum(taxable) from app.pos_order_by_tax(ord))
    and (select sum(tax) from app.pos_order_by_rate(ord))
      = (select sum(tax) from app.pos_order_by_tax(ord))
    and (select payable - round_off from app.pos_order_total(ord))
      = (select sum(taxable) + sum(tax) from app.pos_order_by_tax(ord)));

  -- A GST line at the VAT's own rate is two groups, not one.
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, outlet, app.pos_next_order_no(h, bd), bd, clerk)
  returning id into ord2;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (ord2, h, 'Something at ten per cent GST', 1, 100, 10, clerk);
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, tax_scheme, added_by)
  values (ord2, h, 'Beer', 1, 300, 10, 'vat', clerk);
  select count(*) into n from app.pos_order_by_tax(ord2);
  perform test.ok('finance vat', 'GST and VAT at the same rate are two groups, never merged', n = 2, n::text);
  select count(*) into n from app.pos_order_by_rate(ord2);
  perform test.ok('finance vat', '...and the per-rate answer still adds them into one rate', n = 1, n::text);

  delete from pos_order_lines where order_id in (ord, ord2);
  delete from pos_orders where id in (ord, ord2);
  delete from pos_outlets where id = outlet;
end $$;


-- =============================================================================
-- A SEPARATE VAT BILL FOR ALCOHOL (the owner's D22-44)
-- =============================================================================
-- Its own series per hotel, restarting each 1 April, never sharing a number
-- with a GST invoice; issued beside the GST document of the same sale; never
-- changed; cancelled once, with a reason. Its own property: a VAT bill is
-- permanent, so this block leaves what it issues.
do $$
declare
  h uuid; rt uuid; g uuid; res uuid; fol uuid; clerk uuid; inv uuid;
  outlet uuid; ord uuid; ord2 uuid; bd date; fy text;
  gst_next bigint; v text; v2 text; b vat_bills;
begin
  h := app.provision_property_unchecked('VATB', 'VAT Bill Test', 'Nowhere');
  select id into rt from room_types where hotel_id = h and code = 'STD';
  bd := app.business_date(h);
  fy := app.current_fin_year(h);

  -- ── the series ──────────────────────────────────────────────────────────
  select next_number into gst_next from invoice_series where hotel_id = h and fin_year = fy;
  v := app.next_vat_bill_number(h, fy);
  perform test.ok('finance vat bill', 'the first VAT number of the year is VAT/<hotel>/<year>/0001',
    v = 'VAT/VATB/' || fy || '/0001', v);
  v := app.next_vat_bill_number(h, fy);
  perform test.ok('finance vat bill', 'and the next follows it', v = 'VAT/VATB/' || fy || '/0002', v);
  perform test.ok('finance vat bill', 'the GST invoice series did not move: the two never share numbers',
    (select next_number from invoice_series where hotel_id = h and fin_year = fy) = gst_next);
  v := app.next_vat_bill_number(h, '2098-99');
  perform test.ok('finance vat bill', 'a new financial year starts again at 0001, with no step to open it',
    v = 'VAT/VATB/2098-99/0001', v);
  update vat_bill_series set next_number = 10000 where hotel_id = h and fin_year = '2098-99';
  v := app.next_vat_bill_number(h, '2098-99');
  perform test.ok('finance vat bill', 'the ten-thousandth is 10000, not cut back to a number already used',
    v = 'VAT/VATB/2098-99/10000', v);

  -- ── drinks on a room bill, with the stay's tax invoice ──────────────────
  insert into guests (full_name, phone) values ('VAT Bill Guest', '9000000092') returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id,
                            check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), g, rt, bd, bd + 1, 3000, 'checked_in') returning id into res;
  insert into folios (hotel_id, reservation_id, status) values (h, res, 'open') returning id into fol;
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount)
  values (h, fol, bd, 'food', 'VAT bill test: dinner', 1000, 5, 50);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, tax_scheme)
  values (h, fol, bd, 'beverage', 'VAT bill test: whisky', 500, 10, 50, 'vat'),
         (h, fol, bd, 'beverage', 'VAT bill test: gin', 300, 10, 30, 'vat');
  -- The gin reversed: not a supply, so not on the bill.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                              amount, tax_rate, tax_amount, reverses_id)
  select h, fol, bd, 'beverage', 'Reversal - gin', -300, 10, -30, id
    from folio_postings where folio_id = fol and description = 'VAT bill test: gin';

  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, fol, fy, app.next_invoice_number(h, fy), 'VAT Bill Guest', 1050, 50)
  returning id into inv;
  v := app.issue_vat_bill(inv, null);
  select * into b from vat_bills where number = v;
  perform test.ok('finance vat bill', 'the tax invoice''s VAT bill is the next VAT number, not a GST one',
    v = 'VAT/VATB/' || fy || '/0003', coalesce(v, 'null'));
  perform test.ok('finance vat bill', 'it bills the live VAT on the folio - the whisky, not the reversed gin, not the dinner',
    b.taxable_value = 500 and b.vat_total = 50 and b.total = 550,
    format('%s + %s = %s', b.taxable_value, b.vat_total, b.total));
  perform test.ok('finance vat bill', 'it names the tax invoice it was issued with, and that invoice''s recipient',
    b.invoice_id = inv and b.folio_id = fol and b.recipient_name = 'VAT Bill Guest');
  perform test.ok('finance vat bill', 'a second tax invoice on the folio does not bill the same drinks twice',
    app.issue_vat_bill(inv, null) is null
      and (select count(*) from vat_bills where folio_id = fol) = 1);

  perform test.raises('finance vat bill', 'an issued VAT bill is never changed',
    format($q$update vat_bills set total = 1 where id = %L$q$, b.id), 'P0001');
  perform test.raises('finance vat bill', 'nor deleted',
    format($q$delete from vat_bills where id = %L$q$, b.id), 'P0001');
  perform test.raises('finance vat bill', 'a cancellation must say why',
    format($q$insert into vat_bills (hotel_id, fin_year, number, taxable_value, vat_total, total,
                                     business_date, cancels_id)
              values (%L, %L, 'VAT/VATB/x/1', -500, -50, -550, %L, %L)$q$, h, fy, bd, b.id),
    '23514');
  perform test.allows('finance vat bill', 'with a reason, it is a bill of its own',
    format($q$insert into vat_bills (hotel_id, fin_year, number, taxable_value, vat_total, total,
                                     business_date, cancels_id, reason)
              values (%L, %L, app.next_vat_bill_number(%L, %L), -500, -50, -550, %L, %L, 'wrong room')$q$,
           h, fy, h, fy, bd, b.id));
  perform test.raises('finance vat bill', 'and a bill is cancelled once',
    format($q$insert into vat_bills (hotel_id, fin_year, number, taxable_value, vat_total, total,
                                     business_date, cancels_id, reason)
              values (%L, %L, 'VAT/VATB/x/2', -500, -50, -550, %L, %L, 'again')$q$, h, fy, bd, b.id),
    '23505');

  -- ── a restaurant bill paid at the till ─────────────────────────────────
  insert into staff (email, full_name) values ('vat-bill-clerk@fidato.in', 'VAT Bill Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into pos_outlets (hotel_id, code, name, category, staff_id)
  values (h, 'VBBAR', 'VAT Bill Bar', 'food', clerk) returning id into outlet;
  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, outlet, app.pos_next_order_no(h, bd), bd, clerk) returning id into ord;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (ord, h, 'Paneer tikka', 1, 1000, 5, clerk);
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, tax_scheme, added_by)
  values (ord, h, 'Whisky (30 ml)', 2, 250, 10, 'vat', clerk);
  update pos_orders
     set discount_amount = 150, discount_type = 'fixed', discount_value = 150,
         discount_reason = 'VAT bill test'
   where id = ord;

  v2 := app.issue_vat_bill(null, ord);
  select * into b from vat_bills where number = v2;
  perform test.ok('finance vat bill', 'a restaurant bill''s VAT bill is the drinks after their share of the discount',
    b.pos_order_id = ord and b.taxable_value = 450 and b.vat_total = 45 and b.total = 495,
    format('%s + %s = %s', b.taxable_value, b.vat_total, b.total));

  insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
  values (h, outlet, app.pos_next_order_no(h, bd), bd, clerk) returning id into ord2;
  insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price, tax_rate, added_by)
  values (ord2, h, 'Lassi', 1, 100, 5, clerk);
  perform test.ok('finance vat bill', 'a bill with no alcohol gets no VAT bill, and no number is used',
    app.issue_vat_bill(null, ord2) is null
      and (select count(*) from vat_bills where pos_order_id = ord2) = 0
      and app.next_vat_bill_number(h, fy) = 'VAT/VATB/' || fy || '/0006');
end $$;


-- =============================================================================
-- OVER THE CREDIT LIMIT, ALLOWED WITH A REASON (199; the owner's D27-275)
-- =============================================================================
-- The owner, an Administrator or the GM may allow it; the database asks the
-- role too, and the allowance is in the audit log under their name.
-- =============================================================================
do $$
declare
  h uuid; co uuid; gm uuid; desk uuid; n int;
begin
  h := app.provision_property_unchecked('FCL', 'Credit Limit Test', 'Nowhere');
  insert into companies (name, credit_allowed, credit_limit) values ('D275 Credit Co', true, 1000)
  returning id into co;
  insert into staff (email, full_name) values ('d275-cl-gm@fidato.in', 'D275 GM')
  on conflict (email) do update set is_active = true returning id into gm;
  insert into staff (email, full_name) values ('d275-cl-desk@fidato.in', 'D275 Desk')
  on conflict (email) do update set is_active = true returning id into desk;
  delete from staff_hotels where staff_id in (gm, desk);
  insert into staff_hotels (staff_id, hotel_id, role) values (gm, h, 'gm'), (desk, h, 'front_desk');

  perform set_config('app.user_id', desk::text, true);
  perform test.raises('finance credit limit', 'reception cannot record an allowance over the limit',
    format($q$set local role pms_app;
             insert into credit_limit_allowances (hotel_id, company_id, title, amount, over_by, reason)
             values (%L, %L, 'x', 100, 50, 'because')$q$, h, co), '42501');

  perform set_config('app.user_id', gm::text, true);
  set local role pms_app;
  insert into credit_limit_allowances (hotel_id, company_id, title, amount, over_by, reason)
  values (h, co, 'D275 Credit Co: a charge', 100, 50, 'Cleared by the owner');
  get diagnostics n = row_count;
  reset role;
  perform set_config('app.user_id', '', true);
  perform test.ok('finance credit limit', 'the GM records one', n = 1, n || ' rows');
  perform test.ok('finance credit limit', 'and the audit log names the GM',
    exists (select 1 from audit_log where table_name = 'credit_limit_allowances' and actor = gm
              and after->>'reason' = 'Cleared by the owner'));
  perform test.ok('finance credit limit', 'the app cannot change or remove one',
    not has_table_privilege('pms_app', 'credit_limit_allowances', 'update')
      and not has_table_privilege('pms_app', 'credit_limit_allowances', 'delete'));

  delete from credit_limit_allowances where hotel_id = h;
  delete from companies where id = co;
  delete from staff_hotels where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
end $$;


-- =============================================================================
-- WHAT A COMPANY OWES ACROSS THE GROUP (203; the owner's D27-279 (6))
-- =============================================================================
-- The City ledger's closing balance for the company, summed over every hotel:
-- bills sent "Bill to company" that still stand, less what it paid. Read by
-- reception at one hotel, it still counts the other's, as one number.
-- Scratch rows: the run's database is dropped after.
-- =============================================================================
do $$
declare
  h1 uuid; h2 uuid; t1 uuid; t2 uuid; g uuid; co uuid; desk uuid;
  r1 uuid; r2 uuid; f1 uuid; f2 uuid; p bigint; owes numeric;
begin
  h1 := app.provision_property_unchecked('FG1', 'Group Owes One', 'Nowhere');
  h2 := app.provision_property_unchecked('FG2', 'Group Owes Two', 'Nowhere');
  select id into t1 from room_types where hotel_id = h1 and code = 'STD';
  select id into t2 from room_types where hotel_id = h2 and code = 'STD';
  insert into companies (name, credit_allowed, credit_limit) values ('D279 Group Co', true, 10000)
  returning id into co;
  perform test.ok('finance group owes', 'a company that was never sent a bill owes nothing',
    app.company_owes(co) = 0, app.company_owes(co)::text);

  insert into staff (email, full_name) values ('d279-desk@fidato.in', 'D279 Desk')
  on conflict (email) do update set is_active = true returning id into desk;
  delete from staff_hotels where staff_id = desk;
  insert into staff_hotels (staff_id, hotel_id, role) values (desk, h1, 'front_desk');

  insert into guests (full_name) values ('D279 Group Guest') returning id into g;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status, company_id)
  values (h1, app.next_reference(h1), g, t1, app.business_date(h1), app.business_date(h1) + 1, 2000, 'confirmed', co)
  returning id into r1;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                            agreed_rate, status, company_id)
  values (h2, app.next_reference(h2), g, t2, app.business_date(h2), app.business_date(h2) + 1, 2000, 'confirmed', co)
  returning id into r2;
  insert into folios (hotel_id, reservation_id, status) values (h1, r1, 'open') returning id into f1;
  insert into folios (hotel_id, reservation_id, status) values (h2, r2, 'open') returning id into f2;

  -- ₹1,500 sent at the first hotel, ₹2,500 at the second.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h1, f1, app.business_date(h1), 'payment', 'Transferred to city ledger', -1500, 0, 0) returning id into p;
  insert into payments (hotel_id, posting_id, method, method_label, amount)
  values (h1, p, 'city_ledger', 'Bill to company', 1500);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h2, f2, app.business_date(h2), 'payment', 'Transferred to city ledger', -2500, 0, 0) returning id into p;
  insert into payments (hotel_id, posting_id, method, method_label, amount)
  values (h2, p, 'city_ledger', 'Bill to company', 2500);
  -- ₹700 sent at the second and reversed: not owed.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h2, f2, app.business_date(h2), 'payment', 'Transferred to city ledger', -700, 0, 0) returning id into p;
  insert into payments (hotel_id, posting_id, method, method_label, amount)
  values (h2, p, 'city_ledger', 'Bill to company', 700);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount,
                              reverses_id)
  values (h2, f2, app.business_date(h2), 'payment', 'Reversal - Transferred to city ledger (why: test)', 700, 0, 0, p);
  -- ₹1,000 paid at the first.
  insert into company_payments (hotel_id, company_id, amount, received_on, method, recorded_by)
  values (h1, co, 1000, app.business_date(h1), 'bank_transfer', desk);

  perform test.ok('finance group owes', 'what it owes is every hotel''s bills less what it paid (1,500 + 2,500 - 1,000)',
    app.company_owes(co) = 3000, app.company_owes(co)::text);

  perform set_config('app.user_id', desk::text, true);
  set local role pms_app;
  owes := app.company_owes(co);
  reset role;
  perform set_config('app.user_id', '', true);
  perform test.ok('finance group owes', 'reception at one hotel is answered for the whole group',
    owes = 3000, owes::text);
end $$;


-- =============================================================================
-- A GROUP'S MASTER BILL, SETTLED (the owner's D27-305 (10))
-- =============================================================================
-- The group's page sends its master bill "Bill to company" to the City ledger
-- of the company the master is addressed to (folios.company_id, written when
-- the host account opens). The ledger reads the BILL's company, so a master's
-- transfer counts for that company and one addressed to nobody for nobody. Its
-- tax invoice is never sent by itself (D27-284) - not even with the hotel's
-- invoice switch on, and not by the desk's button either.
-- =============================================================================
do $$
declare
  h uuid; co uuid; g1 uuid; g2 uuid; m1 uuid; m2 uuid; p bigint; inv uuid; fy text; n int;
begin
  h := app.provision_property_unchecked('FMB', 'Master Bill Test', 'Nowhere');
  insert into companies (name, credit_allowed) values ('D305 Master Co', true) returning id into co;
  insert into reservation_groups (name) values ('D305 Wedding') returning id into g1;
  insert into reservation_groups (name) values ('D305 Family') returning id into g2;
  insert into folios (hotel_id, group_id, bill_to, company_id) values (h, g1, 'company', co) returning id into m1;
  insert into folios (hotel_id, group_id) values (h, g2) returning id into m2;

  -- ₹2,000 from each master sent to the city ledger.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, m1, app.business_date(h), 'payment', 'Transferred to city ledger', -2000, 0, 0) returning id into p;
  insert into payments (hotel_id, posting_id, method, method_label, amount)
  values (h, p, 'city_ledger', 'Bill to company', 2000);
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, m2, app.business_date(h), 'payment', 'Transferred to city ledger', -2000, 0, 0) returning id into p;
  insert into payments (hotel_id, posting_id, method, method_label, amount)
  values (h, p, 'city_ledger', 'Bill to company', 2000);

  perform test.ok('finance master bill', 'a master bill sent to the city ledger is owed by the company it is addressed to',
    app.company_owes(co) = 2000, app.company_owes(co)::text);

  insert into guest_message_settings (hotel_id, kind, is_on, switched_on_at)
  values (h, 'invoice', true, now() - interval '1 hour');
  fy := app.current_fin_year(h);
  insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
  values (h, m1, fy, app.next_invoice_number(h, fy), 'D305 Master Co', 6300, 300) returning id into inv;
  select count(*) into n from app.guest_invoices_owed(3, h, null) o where o.invoice_id = inv;
  perform test.ok('finance master bill', 'its tax invoice is not sent by itself, with the invoice switch on', n = 0, n || ' rows');
  select count(*) into n from app.guest_invoices_owed(3, h, inv);
  perform test.ok('finance master bill', 'nor by the desk''s Send invoice', n = 0, n || ' rows');
end $$;


-- =============================================================================
-- CASH ON A ROOM BILL, TO THE RUPEE (the owner's D27-317)
-- =============================================================================
-- The bill is credited with its exact amount; the round-off (at most ±0.50)
-- rides on the cash payment and the drawer expects the rupees really taken.
-- Only cash is rounded: a round-off on any other way is refused.
-- =============================================================================
do $$
declare h uuid; desk uuid; g uuid; f uuid; sh uuid; p bigint; e numeric;
begin
  h := app.provision_property_unchecked('FRO', 'Round-off Test', 'Nowhere');
  select id into desk from staff where email = 'agra@fidato.in';
  insert into staff_hotels (staff_id, hotel_id, role) values (desk, h, 'front_desk') on conflict do nothing;
  insert into reservation_groups (name) values ('D317 Round-off') returning id into g;
  insert into folios (hotel_id, group_id) values (h, g) returning id into f;
  insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_at, opened_by)
  values (h, desk, app.business_date(h), 500, now() - interval '1 hour', desk) returning id into sh;

  -- Before now(): the drawer counts what was taken up to the moment it is asked.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount,
                              tax_rate, tax_amount, posted_by, created_at)
  values (h, f, app.business_date(h), 'payment', 'Received - Cash', -1234.63, 0, 0, desk,
          now() - interval '30 minutes')
  returning id into p;
  insert into payments (hotel_id, posting_id, method, amount, round_off)
  values (h, p, 'cash', 1234.63, 0.37);
  e := app.cashier_expected_cash(sh);
  perform test.ok('finance round-off', 'the drawer expects the rupees taken (500 + 1,234.63 + 0.37)',
    e = 1735, e::text);

  perform test.raises('finance round-off', 'a round-off of more than 50 paise is refused',
    format($q$insert into payments (hotel_id, posting_id, method, amount, round_off)
              values (%L, %s, 'cash', 1, 0.51)$q$, h, p), '23514');

  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount,
                              tax_rate, tax_amount, posted_by)
  values (h, f, app.business_date(h), 'payment', 'Received - UPI', -50.63, 0, 0, desk)
  returning id into p;
  perform test.raises('finance round-off', 'UPI is never rounded: a round-off on it is refused',
    format($q$insert into payments (hotel_id, posting_id, method, amount, round_off)
              values (%L, %s, 'upi', 50.63, 0.37)$q$, h, p), '23514');
end $$;


-- =============================================================================
-- A REFUND (the owner's D27-315 Part B)
-- =============================================================================
-- A refund line is positive (money out), only on a guest's own bill, only by
-- the owner, an administrator, the GM or the accountant, with its row (way,
-- reference, reason) by the end of the transaction, never more than the
-- bill's credit, and cash only below ₹20,000.
-- =============================================================================
do $$
declare h uuid; desk uuid; acct uuid; gst uuid; g uuid; r uuid; f uuid; gf uuid; p bigint; n int;
begin
  h := app.provision_property_unchecked('FRF', 'Refund Rules Test', 'Nowhere');
  select id into desk from staff where email = 'agra@fidato.in';
  select id into acct from staff where email = 'pune@fidato.in';
  insert into staff_hotels (staff_id, hotel_id, role) values (desk, h, 'front_desk'), (acct, h, 'finance')
  on conflict (staff_id, hotel_id) do update set role = excluded.role;
  insert into guests (full_name) values ('D315 Guest') returning id into gst;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), gst, (select id from room_types where hotel_id = h and code = 'STD'),
          app.business_date(h), app.business_date(h) + 1, 1000, 'checked_in') returning id into r;
  insert into folios (hotel_id, reservation_id) values (h, r) returning id into f;
  insert into reservation_groups (name) values ('D315 Group') returning id into g;
  insert into folios (hotel_id, group_id) values (h, g) returning id into gf;
  -- ₹1,000 charged, ₹30,000 paid: ₹29,000 owed back.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, f, app.business_date(h), 'room', 'Room', 1000, 0, 0),
         (h, f, app.business_date(h), 'payment', 'Received - Cash', -30000, 0, 0);

  perform set_config('app.user_id', desk::text, true);
  perform test.raises('finance refund', 'reception cannot write a refund line',
    format($q$set local role pms_app;
             insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
             values (%L, %L, app.business_date(%L), 'refund', 'Refunded - Cash', 100, 0, 0)$q$, h, f, h), '42501');

  perform set_config('app.user_id', acct::text, true);
  perform test.raises('finance refund', 'a refund is positive: money out',
    format($q$insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
             values (%L, %L, app.business_date(%L), 'refund', 'x', -100, 0, 0)$q$, h, f, h), '23514');
  perform test.raises('finance refund', 'never on a group''s master bill',
    format($q$insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
             values (%L, %L, app.business_date(%L), 'refund', 'x', 100, 0, 0)$q$, h, gf, h), '23514');

  set constraints folio_postings_refund_has_row immediate;
  perform test.raises('finance refund', 'a refund line needs its way, reference and reason',
    format($q$insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
             values (%L, %L, app.business_date(%L), 'refund', 'x', 100, 0, 0)$q$, h, f, h), '23514');
  set constraints folio_postings_refund_has_row deferred;

  perform test.raises('finance refund', 'cash only below ₹20,000',
    format($q$with l as (insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
                         values (%L, %L, app.business_date(%L), 'refund', 'x', 20000, 0, 0) returning id)
             insert into refunds (hotel_id, posting_id, method, method_label, amount, reason)
             select %L, l.id, 'cash', 'Cash', 20000, 'left early' from l$q$, h, f, h, h), '23514');
  perform test.raises('finance refund', 'never more than the bill''s credit',
    format($q$with l as (insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
                         values (%L, %L, app.business_date(%L), 'refund', 'x', 29000.01, 0, 0) returning id)
             insert into refunds (hotel_id, posting_id, method, method_label, amount, reference, reason)
             select %L, l.id, 'bank_transfer', 'Bank transfer', 29000.01, 'UTR 1', 'left early' from l$q$, h, f, h, h), '23514');
  perform test.raises('finance refund', 'a transfer has a reference',
    format($q$with l as (insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
                         values (%L, %L, app.business_date(%L), 'refund', 'x', 100, 0, 0) returning id)
             insert into refunds (hotel_id, posting_id, method, method_label, amount, reason)
             select %L, l.id, 'bank_transfer', 'Bank transfer', 100, 'left early' from l$q$, h, f, h, h), '23514');

  -- The accountant gives ₹19,000 in cash and ₹10,000 by transfer: the bill owes nothing.
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, f, app.business_date(h), 'refund', 'Refunded - Cash', 19000, 0, 0) returning id into p;
  insert into refunds (hotel_id, posting_id, method, method_label, amount, reason)
  values (h, p, 'cash', 'Cash', 19000, 'left early');
  insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
  values (h, f, app.business_date(h), 'refund', 'Refunded - Bank transfer (UTR 7)', 10000, 0, 0) returning id into p;
  insert into refunds (hotel_id, posting_id, method, method_label, amount, reference, reason)
  values (h, p, 'bank_transfer', 'Bank transfer', 10000, 'UTR 7', 'left early');
  select count(*) into n from refunds where hotel_id = h and refunded_by = acct;
  perform test.ok('finance refund', 'the accountant gives it, and is recorded as who', n = 2, n || ' rows');
  perform test.ok('finance refund', 'the bill then owes nothing: the bill''s own figures say so',
    (app.stay_bill(r)->>'balance')::numeric = 0 and (app.stay_bill(r)->>'paid')::numeric = 1000
      and (app.stay_bill(r)->>'net')::numeric = 1000,
    app.stay_bill(r)->>'net' || ' / ' || (app.stay_bill(r)->>'paid') || ' / ' || (app.stay_bill(r)->>'balance'));
  perform test.ok('finance refund', 'a refund is not the guest''s spend', app.stay_charged(r) = 1000,
    app.stay_charged(r)::text);
  -- The suite is one transaction: run the pending row checks here (both refunds
  -- have their rows), or a later block's ALTER TABLE meets "pending trigger events".
  set constraints folio_postings_refund_has_row immediate;
  set constraints folio_postings_refund_has_row deferred;
  perform set_config('app.user_id', '', true);
end $$;

-- THE PETTY CASH BOOK (the owner's D27-370): a paid-out's category is one of five
-- words, the same in the restaurant's tin and the front desk's drawer, and only on
-- an expense. One recorded before it has none (the routes require it of a new one).
do $$
declare h uuid; s uuid; sh uuid; o uuid;
begin
  h := app.provision_property_unchecked('PCB', 'Petty Cash Test', 'Nowhere');
  insert into staff (email, full_name) values ('pcb-clerk@fidato.in', 'Petty Cash Clerk') returning id into s;
  insert into cashier_shifts (hotel_id, staff_id, business_date) values (h, s, current_date) returning id into sh;
  insert into pos_outlets (hotel_id, code, name, staff_id) values (h, 'PCB', 'Petty Cash Cafe', s) returning id into o;

  perform test.allows('finance petty cash', 'a desk paid-out with one of the five, and one from before with none',
    format($q$insert into cashier_movements (hotel_id, shift_id, kind, amount, reason, recorded_by, category)
              values (%L,%L,'expense',100,'courier',%L,'Office'), (%L,%L,'expense',50,'old taxi',%L,null)$q$,
           h, sh, s, h, sh, s));
  perform test.raises('finance petty cash', 'the desk refuses a sixth word',
    format($q$insert into cashier_movements (hotel_id, shift_id, kind, amount, reason, recorded_by, category)
              values (%L,%L,'expense',100,'lunch',%L,'Food')$q$, h, sh, s), '23514');
  perform test.raises('finance petty cash', 'and a category on money in',
    format($q$insert into cashier_movements (hotel_id, shift_id, kind, amount, reason, recorded_by, category)
              values (%L,%L,'top_up',100,'change',%L,'Office')$q$, h, sh, s), '23514');

  perform test.allows('finance petty cash', 'a restaurant expense with one of the five',
    format($q$insert into pos_cash_movements (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by, category)
              values (%L,%L,current_date,'expense',80,'vegetables',%L,'Kitchen')$q$, h, o, s));
  perform test.raises('finance petty cash', 'the tin refuses a sixth word',
    format($q$insert into pos_cash_movements (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by, category)
              values (%L,%L,current_date,'expense',80,'gas',%L,'kitchen')$q$, h, o, s), '23514');
  perform test.raises('finance petty cash', 'and a category on a due paid',
    format($q$insert into pos_cash_movements (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by, category)
              values (%L,%L,current_date,'due_collection',80,'room 101',%L,'Other')$q$, h, o, s), '23514');
end $$;
