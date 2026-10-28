import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GUEST'S COMPANY AND GSTIN ON A BOOKING (the owner's D27-371)

     the booking       Company name, GSTIN and address, all optional, kept
                       on the booking; a GSTIN with a wrong shape or a wrong
                       check digit refused in words, nothing written
     the stay panel    the same three changed on one stay; refused the same
                       way, and only for whoever may change a booking
     the tax invoice   the guest's bill is made out to that company - name,
                       GSTIN, address - and the guest still pays: the bill
                       stays the guest's, no company is added to the list
     the GST register  the invoice listed with the company's GSTIN and name
     Bill to company   a company on record still wins (today's rule)
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "D27371";
/** GSTN's own example; and the same with the 15th character wrong. */
const GOOD = "27AAPFU0939F1ZV";
const BAD_CHECK = "27AAPFU0939F1ZW";
const CHECK_SENTENCE =
  "That GSTIN is not right - a character is mistyped. Check it against the company's GST certificate.";

let owner = "";
let housekeeper = "";
let typeId = "";
let source = "";
let companyId = "";
const touched: string[] = [];

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const booking = (name: string, over: Record<string, unknown> = {}) => ({
  guestName: `${TAG} ${name}`, phone: "9811100071", checkIn: "2029-06-10", checkOut: "2029-06-11",
  bookingSourceId: source,
  lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, children: 0, rooms: 1, agreedRate: 4000 }],
  ...over,
});

const companyOf = async (name: string) => sql<{ n: string | null; g: string | null; a: string | null }>(
  `select r.guest_company_name as n, r.guest_company_gstin as g, r.guest_company_address as a
     from reservations r join guests gu on gu.id = r.guest_id where gu.full_name = $1`, [`${TAG} ${name}`]);

/** A demo stay with GST charges, no invoice yet, and no company billed. */
const invoiceable = async () => (await sql<{ id: string }>(
  `select r.id::text from reservations r
     join folios f on f.reservation_id = r.id
     join folio_postings fp on fp.folio_id = f.id
    where r.hotel_id = (select id from hotels where code = '5EL')
      and r.company_id is null and r.id <> all($1::uuid[])
      and fp.category not in ('payment','refund') and fp.tax_scheme = 'gst'
      and not exists (select 1 from invoices i where i.folio_id = f.id)
      and not exists (select 1 from folios o where o.reservation_id = r.id and o.bill_to = 'company')
    group by r.id having sum(fp.amount) > 0
    limit 1`, [touched]))[0]!.id;

const issue = async (stay: string) => {
  const res = await call(owner, "POST", `/stays/${stay}/invoice`);
  expect(res.status, await res.clone().text()).toBe(200);
  const { number } = (await res.json()) as { number: string };
  return (await sql<{ number: string; recipient_name: string; recipient_gstin: string | null;
                      recipient_address: string | null; business_date: string }>(
    `select number, recipient_name, recipient_gstin, recipient_address, business_date::text
       from invoices where number = $1`, [number]))[0]!;
};

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  typeId = (await sql<{ id: string }>(
    "select id::text from room_types where hotel_id = $1 and is_active order by sort_order limit 1", [hotel]))[0]!.id;
  source = (await sql<{ id: string }>("select id::text from booking_sources where is_active order by name limit 1"))[0]!.id;
  companyId = (await sql<{ id: string }>(
    `insert into companies (name, gstin, address_line, city)
     values ('${TAG} Billed Co', '29ABCDE1234F1ZW', '1 Brigade Road', 'Bengaluru') returning id::text`))[0]!.id;
  housekeeper = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ('d27371-hk@fidato.in', '${TAG} HK', 'test-uid-d27371-hk')
     on conflict (email) do update set is_active = true returning id::text`))[0]!.id;
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'housekeeping') on conflict do nothing",
    [housekeeper, hotel]);
});

afterAll(async () => {
  await sql(`update reservations set guest_company_name = null, guest_company_gstin = null,
               guest_company_address = null, company_id = null where id = any($1::uuid[])`, [touched]);
  /* The bookings this file made go too: the demo's room-nights are calibrated
     (inventory.test.ts), and two left behind moved them in release 14's gates. */
  const made = (await sql<{ id: string }>(
    "select r.id::text from reservations r join guests g on g.id = r.guest_id where g.full_name like $1",
    [`${TAG} %`])).map((r) => r.id);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [made]);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [made]);
  await sql("delete from reservations where id = any($1::uuid[])", [made]);
  await sql("alter table guests disable trigger guests_no_delete");
  try {
    await sql("delete from guests where full_name like $1", [`${TAG} %`]);
  } finally { await sql("alter table guests enable trigger guests_no_delete"); }
  await closePool();
});

describe("New booking's guest company", () => {
  it("books without one, and keeps nothing", async () => {
    const res = await call(owner, "POST", "/bookings", booking("No company"));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await companyOf("No company")).toEqual([{ n: null, g: null, a: null }]);
  });

  it("keeps the name, the GSTIN (upper case) and the address on the booking", async () => {
    const res = await call(owner, "POST", "/bookings", booking("With company", {
      guestCompany: { name: " Acme Traders ", gstin: GOOD.toLowerCase(), address: "4 Park Street, Pune" },
    }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await companyOf("With company")).toEqual([{ n: "Acme Traders", g: GOOD, a: "4 Park Street, Pune" }]);
    /* No company is added to the companies list (the owner's choice). */
    expect(await sql("select 1 from companies where name = 'Acme Traders'")).toHaveLength(0);
  });

  it("refuses a wrong GSTIN - a bad shape, and a good shape with a bad check digit - writing nothing", async () => {
    for (const [gstin, sentence] of [
      ["27AAPFU0939F1Z", "A GSTIN is 15 characters: 2 digits, the 10-character PAN, then 3 more, e.g. 27AAPFU0939F1ZV."],
      [BAD_CHECK, CHECK_SENTENCE],
    ] as const) {
      const res = await call(owner, "POST", "/bookings", booking(`Bad ${gstin}`, { guestCompany: { name: "X", gstin } }));
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toBe(sentence);
      expect(await sql("select 1 from guests where full_name = $1", [`${TAG} Bad ${gstin}`])).toHaveLength(0);
    }
  });
});

describe("a returning guest's last company (D27-372)", () => {
  it("is offered with the suggestion: their most recent booking that had one", async () => {
    /* A phone of this run's own, so a re-run starts with nobody on it. */
    const phone = `98${String(Date.now() % 1e8).padStart(8, "1")}`;
    const returning = async () => {
      const res = await call(owner, "GET", `/guests/returning?phone=${phone}`);
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { matches: Array<{ guestId?: string; lastCompany?: unknown }> }).matches;
    };
    /* A night of its own each, or the repeat guard answers the first again. */
    const night = (i: number) => ({ checkIn: `2029-07-1${i}`, checkOut: `2029-07-1${i + 1}` });
    expect((await call(owner, "POST", "/bookings", booking("Returning", { phone, ...night(0) }))).status).toBe(200);
    const [first] = await returning();
    expect(first!.guestId).toBeTruthy();
    expect(first, "no company yet, nothing offered").not.toHaveProperty("lastCompany");

    const guestId = first!.guestId;
    for (const [i, guestCompany] of [
      { name: "Acme Traders", gstin: GOOD, address: "4 Park Street, Pune" },
      { name: "Beta Foods" },
      undefined,
    ].entries()) {
      const res = await call(owner, "POST", "/bookings",
        booking("Returning", { phone, guestId, ...night(i + 1), ...(guestCompany ? { guestCompany } : {}) }));
      expect(res.status, await res.clone().text()).toBe(200);
    }
    /* The last booking had none: the one before it, Beta, is offered. */
    expect((await returning())[0]).toMatchObject({
      guestId, lastCompany: { name: "Beta Foods", gstin: null, address: null },
    });
  });
});

describe("the stay panel's change", () => {
  it("refuses a bad check digit, and anyone who may not change a booking", async () => {
    const stay = await invoiceable();
    const bad = await call(owner, "PUT", `/stays/${stay}/guest-company`, { name: "Acme", gstin: BAD_CHECK });
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { reason: string }).reason).toBe(CHECK_SENTENCE);
    const hk = await call(housekeeper, "PUT", `/stays/${stay}/guest-company`, { name: "Acme", gstin: GOOD });
    expect(hk.status).toBe(403);
    expect(await sql("select 1 from reservations where id = $1 and guest_company_gstin is not null", [stay])).toHaveLength(0);
  });
});

describe("the tax invoice and the GST sales register", () => {
  it("makes the guest's bill out to the company - name, GSTIN, address - and the guest still pays", async () => {
    const stay = await invoiceable();
    touched.push(stay);
    const put = await call(owner, "PUT", `/stays/${stay}/guest-company`,
      { name: "Acme Traders", gstin: GOOD, address: "4 Park Street, Pune" });
    expect(put.status, await put.clone().text()).toBe(200);

    const inv = await issue(stay);
    expect(inv).toMatchObject({
      recipient_name: "Acme Traders", recipient_gstin: GOOD, recipient_address: "4 Park Street, Pune",
    });
    /* Who pays is unchanged: every bill of the stay is still the guest's. */
    expect(await sql("select bill_to, company_id from folios where reservation_id = $1", [stay]))
      .toEqual(expect.arrayContaining([{ bill_to: "guest", company_id: null }]));
    expect(await sql("select 1 from folios where reservation_id = $1 and bill_to = 'company'", [stay])).toHaveLength(0);

    /* B2B in the register: its row carries the company's GSTIN and name. */
    const reg = await app.request(
      `/api/hotels/5EL/reports/gst-sales?from=${inv.business_date}&to=${inv.business_date}`,
      { headers: { "x-dev-staff-id": owner } });
    expect(reg.status).toBe(200);
    const { rows } = (await reg.json()) as { rows: Array<{ number: string; recipient: string; gstin: string | null }> };
    expect(rows.find((r) => r.number === inv.number)).toMatchObject({ recipient: "Acme Traders", gstin: GOOD, type: "B2B" });

    /* D27-372: its credit note takes the invoice's type. */
    const cn = await call(owner, "POST", `/invoices/${inv.number}/credit-note`, { reason: `${TAG} wrong company` });
    expect(cn.status, await cn.clone().text()).toBe(200);
    const { number: cnNumber } = (await cn.json()) as { number: string };
    const cnDate = (await sql<{ d: string }>("select business_date::text as d from invoices where number = $1", [cnNumber]))[0]!.d;
    const after = (await (await app.request(
      `/api/hotels/5EL/reports/gst-sales?from=${inv.business_date}&to=${cnDate}`,
      { headers: { "x-dev-staff-id": owner } })).json()) as { rows: Array<{ number: string }> };
    expect(after.rows.find((r) => r.number === cnNumber)).toMatchObject({ creditsInvoice: inv.number, type: "B2B" });
  });

  it("lists an invoice with no GSTIN as B2C (D27-372)", async () => {
    const stay = await invoiceable();
    touched.push(stay);
    const inv = await issue(stay);
    expect(inv.recipient_gstin).toBeNull();
    const reg = (await (await app.request(
      `/api/hotels/5EL/reports/gst-sales?from=${inv.business_date}&to=${inv.business_date}`,
      { headers: { "x-dev-staff-id": owner } })).json()) as { rows: Array<{ number: string }> };
    expect(reg.rows.find((r) => r.number === inv.number)).toMatchObject({ gstin: null, type: "B2C" });
  });

  it("with only a GSTIN typed (a proprietor's), names the guest with that GSTIN", async () => {
    const stay = await invoiceable();
    touched.push(stay);
    await sql("update reservations set guest_company_gstin = $2 where id = $1", [stay, GOOD]);
    const guest = (await sql<{ n: string }>(
      "select g.full_name as n from reservations r join guests g on g.id = r.guest_id where r.id = $1", [stay]))[0]!.n;
    expect(await issue(stay)).toMatchObject({ recipient_name: guest, recipient_gstin: GOOD });
  });

  it("leaves 'Bill to company' as it is: the company on record wins over a typed one", async () => {
    const stay = await invoiceable();
    touched.push(stay);
    await sql(`update reservations set company_id = $2, guest_company_name = 'Typed Co',
                 guest_company_gstin = $3, guest_company_address = 'Typed address' where id = $1`,
      [stay, companyId, GOOD]);
    expect(await issue(stay)).toMatchObject({
      recipient_name: `${TAG} Billed Co`, recipient_gstin: "29ABCDE1234F1ZW",
      recipient_address: "1 Brigade Road, Bengaluru",
    });
  });
});
