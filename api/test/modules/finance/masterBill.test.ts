import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTLE THE MASTER BILL (the owner's D27-305 (10), 12 October)

   A group's master bill ("Host pays", 056) carried the routed nights and
   nothing could take money on it, invoice it or send it to the city ledger.
   Now the group's page does, through the stay's own doors: a payment in any
   of the hotel's ways (takeFolioPayment), its tax invoice from the same
   series (issueFolioInvoice), and "Bill to company" to the City ledger of
   the company the master is addressed to - over the company's credit limit
   only with the GM's reason (D27-275, D27-279).

   Its own property (MBL), deleted afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

const CODE = "MBL";
const NOBODY = "00000000-0000-4000-8000-000000000000";
let hotelId = "";
let company = "";
/** Billed to the company, and a family's, billed to nobody. */
let corporate = "";
let family = "";
/** A group whose host pays in cash (D27-337 (c)). */
let cashGroup = "";
const staff = new Map<string, string>();

const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-dev-staff-id": staff.get(who) ?? who,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const answer = async (res: Response) =>
  (await res.json()) as { ok: boolean; reason?: string; needs?: string; number?: string; duplicate?: boolean;
                          recipient?: string; total?: number };

const masterOf = async (group: string) => (await sql(
  `select f.id::text, f.bill_to, f.company_id::text,
          coalesce((select sum(fp.amount + fp.tax_amount) from folio_postings fp where fp.folio_id = f.id), 0)::float8
            as balance,
          (select count(*)::int from folio_postings fp where fp.folio_id = f.id) as lines
     from folios f where f.group_id = $1 and f.status = 'open'`, [group]))[0] as
  { id: string; bill_to: string; company_id: string | null; balance: number; lines: number };

/** Two rooms in one group, as one booking makes them: one guest, one company. */
async function group(name: string, co: string | null): Promise<string> {
  const g = (await sql("insert into reservation_groups (name) values ($1) returning id::text", [name]))[0].id;
  const guest = (await sql("insert into guests (full_name) values ($1) returning id::text", [`${name} Host`]))[0].id;
  for (let i = 0; i < 2; i += 1) {
    await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, company_id, group_id,
                                 route_room_to_group, check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 and code = 'STD'),
               $3, $4, true, app.business_date($1), app.business_date($1) + 1, 3000, 'confirmed')`,
      [hotelId, guest, co, g]);
  }
  return g;
}

/** The night audit's two routed nights, on the master: ₹3,000 + 5% each. */
const nights = async (g: string, folio: string) => sql(
  `insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                               description, amount, tax_rate, tax_amount)
   select $1, $2, r.id, app.business_date($1), 'room', 'Room night', 3000, 5, 150
     from reservations r where r.group_id = $3`, [hotelId, folio, g]);

beforeAll(async () => {
  /* A property is made by a group administrator (perBill's way). */
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    const owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query("select app.provision_property_unchecked($1, 'Master Bill Test', 'Nowhere')::text as id",
      [CODE])).rows[0].id;
  } finally { await db.end(); }
  await sql("update hotels set gstin = '27AAAAA0000A1Z5', state = 'MH' where id = $1", [hotelId]);
  company = (await sql(
    `insert into companies (name, gstin, address_line, city, credit_allowed)
     values ('MBL Travels', '27BBBBB1111B1Z5', '12 MG Road', 'Pune', true) returning id::text`))[0].id;
  for (const role of ["front_desk", "gm", "read_only", "housekeeping"]) {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`mbl-${role}@fidato.in`, `MBL ${role}`, `test-uid-mbl-${role}`]))[0].id;
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
    staff.set(role, id);
  }
  corporate = await group("MBL Wedding", company);
  family = await group("MBL Family", null);
});

afterAll(async () => {
  await closePool();
  const triggers = ["folio_postings folio_postings_append_only", "invoices invoices_immutable",
                    "hotels hotels_no_delete", "guests guests_no_delete"];
  for (const t of triggers) await sql(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
  try {
    await sql("delete from invoices where hotel_id = $1", [hotelId]);
    await sql("delete from hotels where id = $1", [hotelId]);
    await sql("delete from reservation_groups where id = any($1::uuid[])", [[corporate, family, cashGroup].filter(Boolean)]);
    await sql("delete from guests where full_name like 'MBL %'");
    await sql("delete from companies where id = $1", [company]);
  } finally {
    for (const t of triggers) await sql(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
  }
});

describe("a group's master bill (D27-305 (10))", () => {
  it("is addressed to the company the group's rooms are billed to, when the host account opens", async () => {
    for (const g of [corporate, family]) {
      const res = await call("front_desk", `/groups/${g}/master`, {});
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(await masterOf(corporate)).toMatchObject({ bill_to: "company", company_id: company });
    expect(await masterOf(family)).toMatchObject({ bill_to: "guest", company_id: null });

    await nights(corporate, (await masterOf(corporate)).id);
    await nights(family, (await masterOf(family)).id);
    const page = (await (await call("front_desk", `/groups/${corporate}`)).json()) as {
      master: { balance: number; company: string | null; invoice: string | null };
    };
    expect(page.master).toMatchObject({ balance: 6300, company: "MBL Travels", invoice: null });
  });

  it("refuses roles without the right before any row is read - a group that exists or one that does not", async () => {
    const before = (await masterOf(corporate)).lines;
    for (const g of [corporate, NOBODY]) {
      const viewer = await call("read_only", `/groups/${g}/payments`, { method: "UPI", amount: 100 });
      expect(viewer.status).toBe(403);
      expect((await answer(viewer)).reason).toMatch(/^Taking a payment is for /);
      const keeper = await call("housekeeping", `/groups/${g}/payments`, { method: "UPI", amount: 100 });
      expect(keeper.status).toBe(403);
      const invoice = await call("read_only", `/groups/${g}/invoice`, {});
      expect(invoice.status).toBe(403);
      expect((await answer(invoice)).reason).toMatch(/^Issuing a tax invoice is for /);
    }
    expect((await masterOf(corporate)).lines).toBe(before);
  });

  it("takes a payment in one of the hotel's ways, and refuses one it does not take", async () => {
    const wrong = await call("front_desk", `/groups/${corporate}/payments`, { method: "Barter", amount: 100 });
    expect(wrong.status).toBe(409);
    expect((await answer(wrong)).reason).toBe('"Barter" is not a payment method this hotel takes.');

    const res = await call("front_desk", `/groups/${corporate}/payments`, { method: "UPI", amount: 1300 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await masterOf(corporate)).balance).toBe(5000);
    const [paid] = await sql(
      `select p.method, p.method_label, -fp.amount::float8 as amount from payments p
         join folio_postings fp on fp.id = p.posting_id where fp.folio_id = $1`, [(await masterOf(corporate)).id]);
    expect(paid).toEqual({ method: "upi", method_label: "UPI", amount: 1300 });
  });

  it("asks for nothing it has no figure for: no amount is refused, never taken as ₹0", async () => {
    const res = await call("front_desk", `/groups/${corporate}/payments`, { method: "UPI" });
    expect(res.status).toBe(409);
    expect((await answer(res)).reason).toBe("A payment must be greater than zero.");
  });

  it("sends the rest to the company's City ledger only past its credit limit with the GM's reason", async () => {
    await sql("update companies set credit_limit = 1000 where id = $1", [company]);
    const over = await call("front_desk", `/groups/${corporate}/payments`, { method: "Bill to company", amount: 5000 });
    expect(over.status).toBe(409);
    expect(await answer(over)).toMatchObject({
      reason: "MBL Travels is over its credit limit by ₹4,000.00.", needs: "credit-limit" });

    /* Reception's reason is not an allowance: the owner, an Admin or the GM. */
    const desk = await answer(await call("front_desk", `/groups/${corporate}/payments`,
      { method: "Bill to company", amount: 5000, overLimitReason: "The company always pays" }));
    expect(desk.reason).toMatch(/Allowing it is for the owner, an administrator or the general manager/);
    expect(await sql("select 1 from credit_limit_allowances where company_id = $1", [company])).toHaveLength(0);

    const gm = await call("gm", `/groups/${corporate}/payments`,
      { method: "Bill to company", amount: 5000, overLimitReason: "Cleared by the owner" });
    expect(gm.status, await gm.clone().text()).toBe(200);
    expect((await masterOf(corporate)).balance).toBe(0);
    const [allowed] = await sql(
      `select a.reason, a.title, l.actor::text as actor from credit_limit_allowances a
         join audit_log l on l.table_name = 'credit_limit_allowances' and l.row_id = a.id::text
        where a.company_id = $1`, [company]);
    expect(allowed).toEqual({ reason: "Cleared by the owner", title: "MBL Travels: MBL Wedding, the host's bill",
                              actor: staff.get("gm") });
    /* The City ledger's Debit: what the company owes, across the group. */
    expect(Number((await sql("select app.company_owes($1)::text as n", [company]))[0].n)).toBe(5000);
  });

  it("will not send a bill billed to nobody to the city ledger", async () => {
    const before = (await masterOf(family)).lines;
    const res = await call("gm", `/groups/${family}/payments`, { method: "Bill to company", amount: 6300 });
    expect(res.status).toBe(409);
    expect((await answer(res)).reason).toBe(
      "MBL Family is not billed to a company, so its bill cannot go to the city ledger. Take the payment another way.");
    expect((await masterOf(family)).lines).toBe(before);
  });

  it("issues its tax invoice from the same series, to the company, once - and never sends it by itself", async () => {
    const res = await call("front_desk", `/groups/${corporate}/invoice`, {});
    const first = await answer(res);
    expect(res.status, JSON.stringify(first)).toBe(200);
    expect(first).toMatchObject({ ok: true, recipient: "MBL Travels", total: 6300 });
    const [series] = await sql("select prefix, fin_year from invoice_series where hotel_id = $1", [hotelId]);
    expect(first.number).toBe(`${series.prefix}/${series.fin_year}/00001`);

    const again = await answer(await call("gm", `/groups/${corporate}/invoice`, {}));
    expect(again).toMatchObject({ duplicate: true, number: first.number });

    const [issued] = await sql(
      "select id::text, recipient_gstin, recipient_address from invoices where number = $1", [first.number]);
    expect(issued).toMatchObject({ recipient_gstin: "27BBBBB1111B1Z5", recipient_address: "12 MG Road, Pune" });
    /* D27-284: a company's invoice is not sent by itself - nor is any master's. */
    expect(await sql("select * from app.guest_invoices_owed(3, $1, $2)", [hotelId, issued.id])).toHaveLength(0);

    const page = (await (await call("front_desk", `/groups/${corporate}`)).json()) as { master: { invoice: string } };
    expect(page.master.invoice).toBe(first.number);

    /* D27-307 (4): the invoice says it is a master bill's, so the screen
       offers no Send invoice - nothing could send it. */
    const printed = (await (await call("front_desk", `/invoices/${first.number}`)).json()) as { masterBill?: boolean };
    expect(printed.masterBill).toBe(true);
  });

  it("invoices a group billed to nobody to the guest who leads it", async () => {
    expect((await call("front_desk", `/groups/${family}/payments`, { method: "UPI", amount: 6300 })).status).toBe(200);
    const res = await answer(await call("front_desk", `/groups/${family}/invoice`, {}));
    expect(res).toMatchObject({ ok: true, recipient: "MBL Family Host", total: 6300 });
  });

  /* D27-337 (c): a master bill carries room nights, so cash on it is taken to
     the rupee as on a room bill - the bill credited the exact amount, the
     drawer the rupee, the difference kept as the payment's round-off. */
  it("takes cash on the master bill to the rupee, keeping the round-off", async () => {
    cashGroup = await group("MBL Cash", null);
    expect((await call("front_desk", `/groups/${cashGroup}/master`, {})).status).toBe(200);
    await nights(cashGroup, (await masterOf(cashGroup)).id);
    const res = await call("gm", `/groups/${cashGroup}/payments`, { method: "Cash", amount: 3000.4 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { roundOff: -0.4 } });
    const [paid] = await sql(
      `select -fp.amount::float8 as amount, p.round_off::float8 as round_off, fp.description from payments p
         join folio_postings fp on fp.id = p.posting_id where fp.folio_id = $1`, [(await masterOf(cashGroup)).id]);
    expect(paid).toEqual({ amount: 3000.4, round_off: -0.4,
                           description: "Received - Cash (₹3,000.00 taken, round-off -₹0.40)" });
    expect((await masterOf(cashGroup)).balance).toBeCloseTo(3299.6, 2);
  });
});
