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
