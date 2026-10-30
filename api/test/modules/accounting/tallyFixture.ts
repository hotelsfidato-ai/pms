import type { PoolClient } from "pg";

/* ══════════════════════════════════════════════════════════════════
   ONE DAY HOLDING EVERY CASE A TALLY VOUCHER HAS TO CARRY

   Written into one connection's transaction by the caller, who rolls it back
   or commits it as it needs. Every figure is round enough to check by hand.

     on the bills    a room 2,000 + 240 GST; food 450.50 + 22.53; laundry 300 + 54;
                     a drink under VAT 1,000 + 100; a discount of 200, less 24 GST
     reversed        food 999 + 49.95, posted and taken back: in nothing
     paid            cash 1,500, card 500; 1,000 moved to a company; 250 refunded
     restaurant      two dishes in cash with a struck third, round off -0.34; a
                     drink by UPI; a bill part on the owner's allowance, part card
     no value        an NC bill and a voided bill
     company         one receipt by bank transfer, its name awkward on purpose
   ══════════════════════════════════════════════════════════════════ */

export const AWKWARD_COMPANY = `Sharma & Sons's <Travels>`;
export const STRUCK_PAISE = 77700;

type Fixture = { hotelId: string; day: string; staff: string; tag: string };

const post = async (
  client: PoolClient, f: Fixture, folio: string, category: string, description: string,
  amount: number, rate: number, tax: number, scheme = "gst",
) => (await client.query<{ id: string }>(
  `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                               amount, tax_rate, tax_amount, tax_scheme, posted_by)
   values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10) returning id::text`,
  [f.hotelId, folio, f.day, category, description, amount, rate, tax, scheme, f.staff])).rows[0]!.id;

/** A bill rung up while open and then settled, as a till does: lines first. */
async function bill(
  client: PoolClient, f: Fixture, outlet: string, item: string, no: string,
  lines: { qty: number; price: number; rate: number; scheme?: string; struck?: boolean }[],
) {
  const { rows: [o] } = await client.query<{ id: string }>(
    `insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by, status)
     values ($1, $2, $3, $4::date, $5, 'open') returning id::text`,
    [f.hotelId, outlet, `${f.tag}-${no}`, f.day, f.staff]);
  for (const l of lines) {
    await client.query(
      `insert into pos_order_lines (hotel_id, order_id, item_id, name, qty, unit_price, tax_rate, tax_scheme,
                                    added_by, voided, voided_by, voided_at)
       values ($1, $2, $3, 'A dish', $4, $5, $6, $7, $8, $9,
               case when $9 then $8::uuid end, case when $9 then now() end)`,
      [f.hotelId, o!.id, item, l.qty, l.price, l.rate, l.scheme ?? "gst", f.staff, l.struck ?? false]);
  }
  return o!.id;
}

const settle = async (
  client: PoolClient, f: Fixture, order: string, method: string, roundOff: number,
  tenders: [method: string, amount: number][],
) => {
  await client.query(
    `update pos_orders set status = 'settled', settled_by = $2, settled_at = now(),
                           payment_method = $3, round_off = $4 where id = $1`,
    [order, f.staff, method, roundOff]);
  for (const [how, amount] of tenders) {
    await client.query(
      `insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
       values ($1, $2, $3, $4, $5)`, [order, f.hotelId, how, amount, f.staff]);
  }
};

/** The whole day. The caller closes it, if it wants it closed. */
export async function everyCase(client: PoolClient, f: Fixture): Promise<void> {
  const { rows: [h] } = await client.query<{ folio: string; outlet: string; item: string; company: string }>(
    `select (select id::text from folios where hotel_id = $1 and status = 'open' limit 1) as folio,
            (select id::text from pos_outlets where hotel_id = $1 and is_active limit 1) as outlet,
            (select i.id::text from pos_menu_items i join pos_menu_categories c on c.id = i.category_id
              where c.hotel_id = $1 limit 1) as item,
            (select id::text from companies where name = $2) as company`,
    [f.hotelId, AWKWARD_COMPANY]);
  const { folio, outlet, item } = h!;
  const company = h!.company ?? (await client.query<{ id: string }>(
    "insert into companies (name) values ($1) returning id::text", [AWKWARD_COMPANY])).rows[0]!.id;

  await post(client, f, folio, "room", `${f.tag} Room 101`, 2000, 12, 240);
  await post(client, f, folio, "food", `${f.tag} Desk food`, 450.5, 5, 22.53);
  await post(client, f, folio, "laundry", `${f.tag} Laundry`, 300, 18, 54);
  await post(client, f, folio, "food", `${f.tag} A drink`, 1000, 10, 100, "vat");
  await post(client, f, folio, "discount", `${f.tag} Discount`, -200, 12, -24);

  /* Posted and taken back: a reversed line and its reversal leave every figure. */
  const wrong = await post(client, f, folio, "food", `${f.tag} Wrong food`, 999, 5, 49.95);
  await client.query(
    `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                 amount, tax_rate, tax_amount, reverses_id, posted_by)
     values ($1, $2, $3::date, 'food', 'Reversal', -999, 5, -49.95, $4, $5)`,
    [f.hotelId, folio, f.day, wrong, f.staff]);

  for (const [method, amount] of [["cash", 1500], ["card", 500], ["city_ledger", 1000]] as const) {
    const id = await post(client, f, folio, "payment", `${f.tag} ${method}`, -amount, 0, 0);
    await client.query(
      "insert into payments (hotel_id, posting_id, method, amount) values ($1, $2, $3, $4)",
      [f.hotelId, id, method, amount]);
  }
  const refund = await post(client, f, folio, "refund", `${f.tag} Refunded`, 250, 0, 0);
  await client.query(
    `insert into refunds (hotel_id, posting_id, method, method_label, amount, reason, refunded_by)
     values ($1, $2, 'cash', 'Cash', 250, 'Fixture', $3)`, [f.hotelId, refund, f.staff]);

  /* In cash, with a struck line that must not count: 1,030.80 + 51.54, paid 1,082. */
  const cash = await bill(client, f, outlet, item, "CASH", [
    { qty: 2, price: 515.4, rate: 5 },
    { qty: 1, price: STRUCK_PAISE / 100, rate: 5, struck: true },
  ]);
  await settle(client, f, cash, "cash", -0.34, [["cash", 1082]]);
  /* A drink under VAT by UPI: 400 + 40. */
  const upi = await bill(client, f, outlet, item, "UPI", [{ qty: 1, price: 400, rate: 10, scheme: "vat" }]);
  await settle(client, f, upi, "upi", 0, [["upi", 440]]);
  /* The owner's allowance, its free part a sale like any other (D27-366): 200 + 10. */
  const free = await bill(client, f, outlet, item, "ALLOW", [{ qty: 1, price: 200, rate: 5 }]);
  await settle(client, f, free, "split", 0, [["allowance", 150], ["card", 60]]);

  /* No value anywhere: given free, and voided after it was paid. */
  const nc = await bill(client, f, outlet, item, "NC", [{ qty: 1, price: 500, rate: 5 }]);
  await client.query(
    `update pos_orders set status = 'no_charge', nc_by = $2, nc_at = now(), nc_reason = 'Fixture' where id = $1`,
    [nc, f.staff]);
  const voided = await bill(client, f, outlet, item, "VOID", [{ qty: 1, price: 600, rate: 5 }]);
  await client.query(
    `update pos_orders set status = 'void', voided_by = $2, voided_at = now(), void_reason = 'Fixture' where id = $1`,
    [voided, f.staff]);

  await client.query(
    `insert into company_payments (hotel_id, company_id, amount, received_on, method, reference, recorded_by)
     values ($1, $2, 1000, $3::date, 'bank_transfer', $4, $5)`,
    [f.hotelId, company, f.day, `UTR&1'2`, f.staff]);
}

/** The night audit's closing, as the audit leaves it. */
export const closeDay = (client: PoolClient, hotelId: string, day: string, staff: string) =>
  client.query(
    `insert into night_audit_runs (hotel_id, business_date, status, run_by, completed_at)
     values ($1, $2::date, 'completed', $3, now()) on conflict do nothing`, [hotelId, day, staff]);
