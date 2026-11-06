import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { bucketOf } from "../../../src/modules/reports/builders/cityLedger.ts";
import { commissionOf } from "../../../src/modules/reports/builders/commission.ts";
import { halves } from "../../../src/modules/reports/builders/gst.ts";

/* ══════════════════════════════════════════════════════════════════
   D27-383 items 2-4: money owed by age, a statement of account,
   commission owed, GSTR-1, input tax credit, GST on advances.

   Reports only: each one is read from what its own property (RGT) holds,
   built here and deleted afterwards. Every figure below is worked out by
   hand in the comments, and each guard is seen to refuse.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const pg = async () => new (await import("pg")).default.Pool({ connectionString: SUPER });

const CODE = "RGT";
const GSTIN = "27AAAAR0000A1Z5";
let hotelId = "";
/* The day everything is reported on, and its month: fixed, so the test does
   not move with the calendar. Nothing has been audited here, so any day takes
   a posting. */
const B = "2026-08-31";
const month = "2026-08";
const people: Record<string, string> = {};

const call = (who: string, path: string) =>
  app.request(`/api/hotels/${CODE}${path}`, { headers: { "x-dev-staff-id": who } });
type Row = { kind: string; cells: Record<string, unknown> };
type Doc = { sections: { key: string; rows: Row[]; note?: string }[]; footnotes: string[] };
const report = async (path: string, who = "dev-owner") => {
  const res = await call(who, path);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Doc;
};
const rowsOf = (doc: Doc, key: string) => doc.sections.find((s) => s.key === key)!.rows;
const cellsOf = (rows: Row[], col: string, value: unknown) => rows.find((r) => r.cells[col] === value)?.cells;

beforeAll(async () => {
  const db = await pg();
  const q = async (text: string, values: unknown[] = []) => (await db.query(text, values)).rows;
  try {
    const owner = (await q("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id as string;
    await q("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await q("select app.provision_property_unchecked($1,'Receivables Test','Nowhere')::text as id", [CODE]))[0]!.id;
    await q("update hotels set gstin = $2 where id = $1", [hotelId, GSTIN]);
    await q("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 5)", [hotelId]);
    const day = async (n: number) => (await q("select ($1::date - $2::int)::text as d", [B, n]))[0]!.d as string;

    const company = async (name: string, kind: string, days: number | null) =>
      (await q(`insert into companies (name, kind, credit_allowed, credit_days) values ($1, $2, true, $3)
                on conflict do nothing returning id::text`, [name, kind, days]))[0]?.id
      ?? (await q("select id::text from companies where name = $1", [name]))[0]!.id;
    const corp = await company("RGT Corporate", "corporate", 30);
    const agent = await company("RGT Agent", "travel_agent", null);
    const site = (await q(`insert into booking_sources (name, kind) values ('RGT Test Site', 'ota')
                           on conflict do nothing returning id::text`))[0]?.id
      ?? (await q("select id::text from booking_sources where name = 'RGT Test Site'"))[0]!.id;
    const guest = (await q("insert into guests (full_name) values ('RGT Guest') returning id::text"))[0]!.id;

    const stay = async (o: { status?: string; rate?: number; company?: string; source?: string;
                             pct?: number; site?: number; out?: string }) =>
      (await q(`insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                  agreed_rate, status, company_id, booking_source_id, commission_pct, commission_amount)
                values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 and code = 'STD'),
                        coalesce($8::date, $9::date) - 1, coalesce($8::date, $9::date), $3, $4, $5, $6, $7, $10)
                returning id::text`,
        [hotelId, guest, o.rate ?? 1000, o.status ?? "checked_out", o.company ?? null, o.source ?? null,
         o.pct ?? null, o.out ?? null, B, o.site ?? null]))[0]!.id as string;
    const folio = async (res: string, co?: string) =>
      (await q(`insert into folios (hotel_id, reservation_id, bill_to, company_id) values ($1, $2, $3, $4) returning id::text`,
        [hotelId, res, co ? "company" : "guest", co ?? null]))[0]!.id as string;
    const charge = async (f: string, on: string, category: string, amount: number, rate: number, kind: string | null = null) =>
      q(`insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount, tax_kind)
         values ($1, $2, $3, $4, $4, $5::numeric, $6::numeric, round($5::numeric * $6::numeric / 100.0, 2), $7)`,
        [hotelId, f, on, category, amount, rate, kind]);
    const paid = async (f: string, on: string, amount: number, method: string) => {
      const [p] = await q(`insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
                           values ($1, $2, $3, 'payment', 'Paid', $4) returning id`, [hotelId, f, on, -amount]);
      await q("insert into payments (hotel_id, posting_id, method, amount) values ($1, $2, $3, $4)", [hotelId, p!.id, method, amount]);
    };
    const companyPaid = async (co: string, on: string, amount: number) =>
      q(`insert into company_payments (hotel_id, company_id, amount, received_on, method, reference, recorded_by)
         values ($1, $2, $3, $4, 'bank_transfer', 'UTR RGT', $5)`, [hotelId, co, amount, on, owner]);
    let n = 0;
    const invoice = async (f: string, o: { taxable: number; tax: number; gstin?: string; on?: string; sacs?: object; credits?: string }) => {
      n += 1;
      const half = halves(o.tax);
      return (await q(`insert into invoices (hotel_id, folio_id, fin_year, number, gstin, recipient_name, recipient_gstin,
                         taxable_value, cgst_total, sgst_total, tax_total, total, business_date, sac_by_kind, credits_id, reason)
                       values ($1, $2, '2026-27', $3, $4, 'RGT Recipient', $5, $6, $7, $8, $9, $6::numeric + $9::numeric,
                               $10, $11, $12,
                               case when $12::uuid is null then null else 'Wrong guest' end) returning id::text`,
        [hotelId, f, `RGT/2026-27/0000${n}`, GSTIN, o.gstin ?? null, o.taxable, half.camt, half.samt, o.tax,
         o.on ?? B, JSON.stringify(o.sacs ?? {}), o.credits ?? null]))[0]!.id as string;
    };

    /* ── Dues by age and the statement ──────────────────────────────
       Corporate: sent 1,000 (B-100), 2,000 (B-45), 500 (B-10); paid 1,500
       (B-5). First in, first out: the 1,000 and 500 of the 2,000 are paid.
       Left: 1,500 at 45 days (31-60), 500 at 10 days (0-30); total 2,000.
       Agent: sent 300 (B-70), paid 500 (B-1): 200 paid ahead, total -200. */
    for (const [ago, amount] of [[100, 1000], [45, 2000], [10, 500]] as const) {
      const f = await folio(await stay({ company: corp, out: await day(ago - 1) }), corp);
      await charge(f, await day(ago), "room", amount, 0);
      await paid(f, await day(ago), amount, "city_ledger");
      if (ago === 10) {
        /* Its invoice (July), then a credit note on it (August): listed on the
           statement, not counted. */
        const inv = await invoice(f, { taxable: 500, tax: 0, on: await day(40) });
        await invoice(f, { taxable: -500, tax: 0, on: await day(2), credits: inv });
      }
    }
    await companyPaid(corp, await day(5), 1500);
    const af = await folio(await stay({ company: agent, out: await day(69) }), agent);
    await charge(af, await day(70), "room", 300, 0);
    await paid(af, await day(70), 300, "city_ledger");
    await companyPaid(agent, await day(1), 500);

    /* ── Commission: four stays checked out today ─────────────────
       15% of 2,000 = 300; the site's own 123.45 beats its 10%; an agent's
       10% of 500 = 50; one with no rate: a dash. Total 473.45. */
    const withRoom = async (o: Parameters<typeof stay>[0], room: number) => {
      const f = await folio(await stay(o));
      await charge(f, B, "room", room, 5);
    };
    await withRoom({ source: site, pct: 15 }, 2000);
    await withRoom({ source: site, pct: 10, site: 123.45 }, 1000);
    await withRoom({ company: agent, pct: 10 }, 500);
    await withRoom({ source: site }, 800);

    /* ── GSTR-1 for the month ──────────────────────────────────────
       A B2B invoice: room 2,000 at 5% (100) and other 500 at 18% (90);
       credited the same month. A B2C invoice: room 1,000 at 5% (50). */
    const b2b = await folio(await stay({ status: "checked_out" }));
    await charge(b2b, B, "room", 2000, 5);
    await charge(b2b, B, "misc", 500, 18, "other");
    const b2bInvoice = await invoice(b2b, { taxable: 2500, tax: 190, gstin: "27AAACR1234A1Z1", sacs: { other: "999799" } });
    await invoice(b2b, { taxable: -2500, tax: -190, gstin: "27AAACR1234A1Z1", credits: b2bInvoice });
    const b2c = await folio(await stay({ status: "checked_out" }));
    await charge(b2c, B, "room", 1000, 5);
    await invoice(b2c, { taxable: 1000, tax: 50 });

    /* ── GST on advances ────────────────────────────────────────────
       1,050 paid today on a stay at 3,000 a night (5%), no invoice: received,
       1,000 + 25 + 25. 2,100 paid in July, invoiced in August: adjusted,
       2,000 + 50 + 50. A "Bill to company" is not money received. */
    const adv1 = await folio(await stay({ status: "confirmed", rate: 3000, out: await day(-3) }));
    await paid(adv1, B, 1050, "upi");
    const adv2 = await folio(await stay({ status: "checked_out", rate: 3000 }));
    await paid(adv2, await day(40), 2100, "cash");
    await charge(adv2, B, "room", 2000, 5);
    await invoice(adv2, { taxable: 2000, tax: 100 });

    /* ── Input tax credit: three deliveries this month ─────────────── */
    await q("insert into suppliers (hotel_id, name, gstin) values ($1, 'RGT Supplier', '27AAAAS1111A1Z1')", [hotelId]);
    const item = (await q("insert into stock_items (hotel_id, name, unit) values ($1, 'RGT Rice', 'kg') returning id::text", [hotelId]))[0]!.id;
    const store = (await q("select id::text from locations where hotel_id = $1 order by name limit 1", [hotelId]))[0]!.id;
    const deliver = (supplier: string, gst: [number, number, boolean] | null) =>
      q(`insert into stock_movements (hotel_id, item_id, location_id, business_date, kind, quantity, unit_cost, supplier,
           reference, moved_by, gst_rate, gst_amount, gst_claimable)
         values ($1, $2, $3, $4, 'receipt', 10, 100, $5, 'PO-1', $6, $7, $8, $9)`,
        [hotelId, item, store, B, supplier, owner, gst?.[0] ?? null, gst?.[1] ?? null, gst?.[2] ?? null]);
    await deliver("RGT Supplier", [18, 180, true]);
    await deliver("Somebody Else", [5, 50, false]);
    await deliver("RGT Supplier", null);

    for (const role of ["front_desk", "revenue_manager", "hotel_manager", "finance"]) {
      const [p] = await q(`insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
                           on conflict (email) do update set is_active = true returning id::text`,
        [`rgt-${role}@fidato.in`, `RGT ${role}`, `test-uid-rgt-${role}`]);
      people[role] = p!.id;
      await q("delete from staff_hotels where staff_id = $1", [p!.id]);
      await q("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [p!.id, hotelId, role]);
    }
  } finally { await db.end(); }
}, 120_000);

afterAll(async () => {
  await closePool();
  const db = await pg();
  const triggers = ["folio_postings folio_postings_append_only", "hotels hotels_no_delete",
    "stock_movements stock_movements_append_only", "invoices invoices_immutable"];
  try {
    for (const t of triggers) await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of triggers) await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    await db.query("delete from staff_hotels where staff_id = any($1)", [Object.values(people)]);
    await db.query("update staff set is_active = false where id = any($1)", [Object.values(people)]);
    await db.end();
  }
}, 120_000);

describe("the small rules", () => {
  it("ages a bill into the right column, and the halves always cancel", () => {
    expect([0, 30, 31, 60, 61, 90, 91].map(bucketOf)).toEqual(["d30", "d30", "d60", "d60", "d90", "d90", "over90"]);
    expect(halves(0.05)).toEqual({ camt: 0.03, samt: 0.02 });
    expect(halves(-0.05)).toEqual({ camt: -0.03, samt: -0.02 });
  });
  it("commission: the site's figure, else the rate on the room revenue, else nothing", () => {
    expect(commissionOf(123.45, 10, 1000)).toBe(123.45);
    expect(commissionOf(null, 15, 2000)).toBe(300);
    expect(commissionOf(null, null, 800)).toBeNull();
    expect(commissionOf(null, 0, 800)).toBe(0);
  });
});

describe("money owed by age (D27-383 item 2)", () => {
  it("sets payments against the oldest bills and ages what is left; the total is the City ledger's", async () => {
    const rows = rowsOf(await report(`/reports/dues-by-age?asOn=${B}`), "aged");
    expect(cellsOf(rows, "account", "RGT Corporate")).toMatchObject(
      { creditDays: 30, d30: 500, d60: 1500, d90: 0, over90: 0, ahead: 0, total: 2000 });
    expect(cellsOf(rows, "account", "RGT Agent")).toMatchObject({ creditDays: null, d60: 0, d90: 0, ahead: -200, total: -200 });
    expect(rows.filter((r) => r.kind === "band").map((r) => r.cells["account"])).toEqual(["Companies", "Travel agents"]);
    expect(cellsOf(rows, "account", "Total owed")).toMatchObject({ total: 1800 });

    const ledger = rowsOf(await report(`/reports/city-ledger?asOn=${B}&from=${B}`), "accounts");
    expect(cellsOf(ledger, "account", "RGT Corporate")!["closing"]).toBe(2000);
    expect(cellsOf(ledger, "account", "RGT Agent")!["closing"]).toBe(-200);
  });

  it("is read by whoever reads Company accounts, and not by the revenue manager - on screen or as a file", async () => {
    expect((await call(people["front_desk"]!, `/reports/dues-by-age`)).status).toBe(200);
    expect((await call(people["revenue_manager"]!, `/reports/dues-by-age`)).status).toBe(403);
    expect((await call(people["revenue_manager"]!, `/reports/dues-by-age.xlsx`)).status).toBe(403);
    expect((await call(people["hotel_manager"]!, `/reports/dues-by-age.pdf`)).status).toBe(200);
  });
});

describe("a statement of account (D27-383 item 2)", () => {
  it("opens, runs and closes on the City ledger's figures, and lists the credit note without counting it", async () => {
    const doc = await report(`/reports/company-statement?account=${encodeURIComponent("RGT Corporate")}&from=2026-07-12&asOn=${B}`);
    const lines = rowsOf(doc, "ledger");
    expect(lines.map((r) => r.cells["balance"])).toEqual([1000, 3000, 3500, 2000, 2000]);
    expect(lines.map((r) => r.cells["debit"] ?? null)).toEqual([null, 2000, 500, null, null]);
    expect(lines[2]!.cells["detail"]).toMatch(/RGT Guest, no tax invoice yet/);
    expect(lines[3]!.cells).toMatchObject({ what: "Payment received", credit: 1500, detail: "Bank transfer, UTR RGT" });
    const notes = rowsOf(doc, "credit-notes");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.cells).toMatchObject({ credits: "RGT/2026-27/00001", total: 500, reason: "Wrong guest" });
  });

  it("asks which account, and never guesses one", async () => {
    const res = await call("dev-owner", "/reports/company-statement");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Pick an account for the statement.");
    expect((await call("dev-owner", "/reports/company-statement.csv")).status).toBe(400);
  });
});

describe("commission owed (D27-383 item 3)", () => {
  it("is the site's figure, else the rate on record times the room revenue, else a dash", async () => {
    const doc = await report(`/reports/commission?from=${month}-01&asOn=${B}`);
    const rows = rowsOf(doc, "bookings").filter((r) => r.kind === "row");
    expect(rows.map((r) => [r.cells["room"], r.cells["pct"], r.cells["site"], r.cells["owed"]]).sort()).toEqual([
      [1000, 10, 123.45, 123.45], [2000, 15, null, 300], [500, 10, null, 50], [800, null, null, null],
    ].sort());
    expect(cellsOf(rowsOf(doc, "bookings"), "booking", "Total")).toMatchObject({ owed: 473.45 });
    expect(doc.sections[0]!.note).toBe("1 booking has no commission on record: a dash, not counted in the totals.");
  });

  it("is for whoever holds commission: the revenue manager yes, reception and the hotel manager no", async () => {
    expect((await call(people["revenue_manager"]!, "/reports/commission")).status).toBe(200);
    expect((await call(people["revenue_manager"]!, "/reports/commission.csv")).status).toBe(200);
    expect((await call(people["front_desk"]!, "/reports/commission")).status).toBe(403);
    expect((await call(people["hotel_manager"]!, "/reports/commission.pdf")).status).toBe(403);
  });
});

describe("GSTR-1 (D27-383 item 4)", () => {
  it("B2B by rate, B2C small netted, the credit note in 9B, HSN apart, and the documents", async () => {
    const doc = await report(`/reports/gstr-1?month=${month}`);
    expect(rowsOf(doc, "b2b").filter((r) => r.kind === "row").map((r) => [r.cells["rt"], r.cells["txval"], r.cells["camt"], r.cells["samt"]]))
      .toEqual([[5, 2000, 50, 50], [18, 500, 45, 45]]);
    expect(rowsOf(doc, "cdnr").map((r) => [r.cells["rt"], r.cells["txval"]])).toEqual([[5, 2000], [18, 500]]);
    expect(rowsOf(doc, "b2cs").filter((r) => r.kind === "row").map((r) => [r.cells["rt"], r.cells["txval"], r.cells["camt"], r.cells["samt"]]))
      .toContainEqual([5, 3000, 75, 75]);
    expect(rowsOf(doc, "hsn-b2b").filter((r) => r.kind === "row").map((r) => r.cells["sac"])).toEqual(["996311", "999799"]);
    expect(doc.sections.find((s) => s.key === "problems")).toBeUndefined();
  });

  it("makes the offline tool's JSON from the same figures", async () => {
    const res = await call(people["finance"]!, `/reports/gstr-1.json?month=${month}`);
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as Record<string, any>;
    expect(json).toMatchObject({ gstin: GSTIN, fp: `${month.slice(5)}${month.slice(0, 4)}`, version: "GST3.2.2", b2cl: [], cdnur: [] });
    expect(json["b2b"][0].ctin).toBe("27AAACR1234A1Z1");
    expect(json["b2b"][0].inv[0]).toMatchObject({ pos: "27", rchrg: "N", inv_typ: "R", val: 2690 });
    expect(json["b2b"][0].inv[0].itms.map((i: any) => i.itm_det)).toEqual([
      { rt: 5, txval: 2000, iamt: 0, camt: 50, samt: 50, csamt: 0 },
      { rt: 18, txval: 500, iamt: 0, camt: 45, samt: 45, csamt: 0 }]);
    expect(json["cdnr"][0].nt[0]).toMatchObject({ ntty: "C", val: 2690 });
    expect(json["cdnr"][0].nt[0].idt).toBeUndefined();
    expect(json["hsn"]["hsn_b2c"].map((h: any) => [h.hsn_sc, h.rt, h.uqc, h.qty])).toContainEqual(["996311", 5, "NA", 0]);
    /* August: three tax invoices (B2B, B2C, the advance's), two credit notes. */
    expect(json["doc_issue"]["doc_det"].map((d: any) => [d.doc_num, d.docs[0].totnum])).toEqual([[1, 3], [5, 2]]);
  });

  it("refuses the file while an invoice no longer matches its bill, and says which", async () => {
    const db = await pg();
    try {
      const [{ id: folio }] = (await db.query("select f.id::text from folios f join invoices i on i.folio_id = f.id where f.hotel_id = $1 and i.taxable_value = 1000", [hotelId])).rows;
      await db.query(`insert into invoices (hotel_id, folio_id, fin_year, number, gstin, recipient_name, taxable_value,
                        cgst_total, sgst_total, tax_total, total, business_date)
                      values ($1, $2, '2026-27', 'RGT/2026-27/00099', $3, 'Off', 999, 0, 0, 0, 999, '2026-06-15')`,
        [hotelId, folio, GSTIN]);
      const earlier = "2026-06";
      const res = await call("dev-owner", `/reports/gstr-1.json?month=${earlier}`);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/Invoice RGT\/2026-27\/00099: its bill's lines no longer add up/);
      expect(rowsOf(await report(`/reports/gstr-1?month=${earlier}`), "problems")).toHaveLength(1);
    } finally { await db.end(); }
  });

  it("the file is a download: reception may not take it", async () => {
    expect((await call(people["front_desk"]!, `/reports/gstr-1.json?month=${month}`)).status).toBe(403);
  });
});

describe("input tax credit (D27-383 item 4)", () => {
  it("splits what was marked claimable from what was not, CGST and SGST where the GSTIN is in this state", async () => {
    const doc = await report(`/reports/input-tax-credit?month=${month}`, people["finance"]!);
    expect(rowsOf(doc, "claimable")[0]!.cells).toMatchObject({ gstin: "27AAAAS1111A1Z1", value: 1000, gst: 180, camt: 90, samt: 90, iamt: 0 });
    expect(rowsOf(doc, "not-claimable")[0]!.cells).toMatchObject({ gstin: null, gst: 50, camt: null, iamt: null });
    expect(doc.footnotes[1]).toMatch(/^1 delivery this month recorded no GST/);
  });
  it("is read by the four who read what is owed to suppliers", async () => {
    expect((await call(people["hotel_manager"]!, `/reports/input-tax-credit`)).status).toBe(403);
    expect((await call(people["hotel_manager"]!, `/reports/input-tax-credit.xlsx`)).status).toBe(403);
  });
});

describe("GST on advances (D27-383 item 4)", () => {
  it("received without an invoice is 11A; an earlier month's, invoiced now, is 11B", async () => {
    const doc = await report(`/reports/gst-advances?month=${month}`);
    const received = rowsOf(doc, "received").filter((r) => r.kind === "row");
    expect(received.map((r) => [r.cells["rt"], r.cells["amount"], r.cells["txval"], r.cells["camt"], r.cells["samt"]]))
      .toContainEqual([5, 1050, 1000, 25, 25]);
    /* Bill to company is not money received: none of the companies' bills is here. */
    expect(received.every((r) => r.cells["amount"] !== 1000 && r.cells["amount"] !== 2000)).toBe(true);
    const adjusted = rowsOf(doc, "adjusted").filter((r) => r.kind === "row");
    expect(adjusted.map((r) => [r.cells["amount"], r.cells["txval"], r.cells["camt"]])).toEqual([[2100, 2000, 50]]);
    expect(adjusted[0]!.cells["booking"]).toMatch(/invoice RGT\/2026-27\/0000\d/);
    /* July: that 2,100 was received with no invoice by July's end - 11A then. */
    const july = rowsOf(await report("/reports/gst-advances?month=2026-07"), "received").filter((r) => r.kind === "row");
    expect(july.map((r) => r.cells["amount"])).toEqual([2100]);
  });
  it("is money taken: the revenue manager does not read it", async () => {
    expect((await call(people["revenue_manager"]!, `/reports/gst-advances`)).status).toBe(403);
  });
});
