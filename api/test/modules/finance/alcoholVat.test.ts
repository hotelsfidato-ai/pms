import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import {
  buildReport, propertyFor, dailyFigures, posSales,
  type ReportDoc, type ReportSection,
} from "../../../src/modules/reports/index.ts";
import { dayBook, type DayBook } from "../../../src/modules/accounting/dayBook.ts";

/* ══════════════════════════════════════════════════════════════════
   ALCOHOL, AND ITS VAT — the owner, 21 September

   D21-90  "A switch per hotel - 'serves alcohol' - because some do and
           many do not." Off by default.
   D21-91  "10% VAT, not GST: one 'VAT 10%' line on the bill, never split
           into CGST/SGST, kept out of the GST sales register and the GST
           part of the accountant's export, with its own VAT ledger. The
           accountant confirms the rate on the tax screen."

   Everything is done the way a person does it - the switch on Settings,
   the rate on the tax card, the section's heading, a drink rung at the
   till and settled to a room - never by writing the rows straight in
   (MEMORY 313: a fixture that inserts a row is a claim something can make
   it). The 10% below is THIS FILE's figure, typed on the tax card as the
   accountant would; nothing in the system knows it.

   What it charged is reversed and what it opened is removed afterwards.
   The one thing that cannot be removed is the tax invoice issued in the
   seventh test: an issued invoice is permanent, by design.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "VATTEST";
const SECTION = `${TAG} Spirits`;
const VAT_RATE = 10;

let ownerId: string;
let hotelId: string;
let businessDate: string;
let whiskyId: string;
let tikkaId: string;

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels/5EL${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerId, "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
const send = (method: string, path: string, body?: unknown) =>
  as(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async <T>(res: Response) => (await res.json()) as T;

const switchAlcohol = async (enabled: boolean) => {
  const res = await send("POST", "/modules/alcohol", { enabled });
  expect(res.status, await res.clone().text()).toBe(200);
};

async function openOrder(label: string) {
  const res = await send("POST", "/till/orders", { outlet: "REST", table: `${TAG} ${label}` });
  expect(res.status, await res.clone().text()).toBe(200);
  return json<{ id: string; orderNo: string }>(res);
}

type Bill = {
  taxes: { rate: number; taxable: number; cgst: number; sgst: number }[];
  vat: { rate: number; taxable: number; vat: number }[];
  tax: number; total: number;
};
const billOf = async (stayId: string) => json<Bill>(await as(`/stays/${stayId}/bill`));
const gstTaxable = (b: Bill) => b.taxes.reduce((t, x) => t + Number(x.taxable), 0);

/* Carried between the tests of the one flow, in the order they run. */
let stayId = "";
let folioId = "";
let extraFolioId = "";
let order = { id: "", orderNo: "" };
let before: { book: DayBook; billed: Bill; vat: number; posVat: number; posTax: number; extraTax: number };

const theDay = () => withUser(ownerId, async (client) => {
  const property = await propertyFor(client, "5EL");
  const book = await dayBook(client, property!, businessDate, businessDate);
  const figures = await dailyFigures(client, hotelId, businessDate, businessDate);
  const pos = await posSales(client, hotelId, businessDate, businessDate);
  return { book, figures: figures[0]!, pos: pos[0] ?? { net: 0, tax: 0, alcohol: 0, vat: 0 } };
});

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  const h = (await sql(
    "select id::text, to_char(app.business_date(id), 'YYYY-MM-DD') as bd from hotels where code = '5EL'")).rows[0];
  hotelId = h.id; businessDate = h.bd;

  /* A section and a drink, as the menu screen makes them: no heading, and
     no rate of the drink's own - it follows its section. */
  const cat = await json<{ id: string }>(await send("POST", "/till/menu/categories", { name: SECTION }));
  const item = await send("POST", "/till/menu/items",
    { categoryId: cat.id, name: `${TAG} Whisky 30 ml`, price: 250 });
  expect(item.status, await item.clone().text()).toBe(200);
  whiskyId = (await json<{ id: string }>(item)).id;

  const menu = await json<{ categories: { items: { id: string; name: string }[] }[] }>(
    await as("/till/menu"));
  tikkaId = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
});

afterAll(async () => {
  try {
    /* Anything this file left live on a folio, reversed - a reversal, never
       a delete: the ledger is append-only. */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                   amount, tax_rate, tax_amount, reverses_id, source_type)
       select fp.hotel_id, fp.folio_id, fp.business_date, fp.category,
              'Reversal - alcohol test', -fp.amount, fp.tax_rate, -fp.tax_amount, fp.id, 'pos'
         from folio_postings fp
         join pos_tickets t on t.posting_id = fp.id
         join pos_orders o on o.order_no = split_part(t.ticket_ref, '/', 1)
        where o.table_ref like $1
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
      [`${TAG}%`]);
    /* ...and any VAT still live here, wherever it was moved: nothing but this
       file sells alcohol at the demo property. */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                   amount, tax_rate, tax_amount, reverses_id)
       select fp.hotel_id, fp.folio_id, fp.business_date, fp.category,
              'Reversal - alcohol test', -fp.amount, fp.tax_rate, -fp.tax_amount, fp.id
         from folio_postings fp
        where fp.hotel_id = $1 and fp.tax_scheme = 'vat' and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
      [hotelId]);
    /* The second bill this file opened on the stay, empty again: closed, so
       no till or check-out finds an extra open folio on the room. */
    if (extraFolioId) {
      await sql("update folios set status = 'closed' where id = $1", [extraFolioId]);
    }

    /* The orders, with the two triggers that guard a paid bill lifted as
       till.test.ts and load-demo.ts do - never weakened. */
    const { rows: orders } = await sql(
      "select id::text, order_no from pos_orders where table_ref like $1", [`${TAG}%`]);
    if (orders.length) {
      await sql("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
      await sql("alter table pos_order_lines disable trigger pos_order_lines_frozen");
      try {
        await sql("delete from pos_orders where id = any($1::uuid[])", [orders.map((o) => o.id)]);
      } finally {
        await sql("alter table pos_order_lines enable trigger pos_order_lines_frozen");
        await sql("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
      }
      for (const o of orders) {
        await sql("delete from pos_tickets where ticket_ref like $1", [`${o.order_no}%`]);
      }
    }

    await sql("delete from pos_menu_items where name like $1", [`${TAG}%`]);
    await sql("delete from pos_menu_categories where name like $1", [`${TAG}%`]);
    await sql("delete from tax_rules where kind = 'alcohol' and hotel_id = $1", [hotelId]);
    await sql("delete from hotel_modules where module = 'alcohol' and hotel_id = $1", [hotelId]);
  } finally {
    await closePool();
  }
});

describe("serves alcohol - a switch per property, off by default (D21-90)", () => {
  it("is off, and the tax card has no Alcohol heading", async () => {
    const mods = await json<{ modules: { module: string; enabled: boolean }[] }>(await as("/modules"));
    expect(mods.modules.find((m) => m.module === "alcohol")).toEqual({ module: "alcohol", enabled: false });

    const tax = await json<{ servesAlcohol: boolean; kinds: { kind: string }[] }>(await as("/tax"));
    expect(tax.servesAlcohol).toBe(false);
    expect(tax.kinds.map((k) => k.kind)).not.toContain("alcohol");
  });

  it("while off, alcohol can be neither rated nor given to a menu section", async () => {
    const put = await send("PUT", "/tax/alcohol", { slabs: [{ rate: VAT_RATE }] });
    expect(put.status).toBe(409);
    expect((await json<{ reason: string }>(put)).reason).toMatch(/not switched on for alcohol/);
    const rules = await sql("select count(*)::int as n from tax_rules where hotel_id = $1 and kind = 'alcohol'", [hotelId]);
    expect(rules.rows[0].n, "the refusal was cosmetic - a rate was written").toBe(0);

    const patch = await send("PATCH", `/menu-categories/${encodeURIComponent(SECTION)}/tax-kind`, { kind: "alcohol" });
    expect(patch.status).toBe(409);
    const cat = await sql("select tax_kind from pos_menu_categories where hotel_id = $1 and name = $2", [hotelId, SECTION]);
    expect(cat.rows[0].tax_kind).toBeNull();
  });

  it("switched on, the heading appears with NO rate - nothing is seeded - and VAT is one rate", async () => {
    await switchAlcohol(true);

    const tax = await json<{ servesAlcohol: boolean; kinds: { kind: string; slabs: unknown[] }[] }>(await as("/tax"));
    expect(tax.servesAlcohol).toBe(true);
    expect(tax.kinds.find((k) => k.kind === "alcohol"), "the Alcohol heading").toEqual({ kind: "alcohol", slabs: [] });

    const bands = await send("PUT", "/tax/alcohol",
      { slabs: [{ overAmount: 0, rate: VAT_RATE }, { overAmount: 5000, rate: 20 }] });
    expect(bands.status).toBe(409);
    expect((await json<{ reason: string }>(bands)).reason).toMatch(/one rate/);

    const silly = await send("PUT", "/tax/alcohol", { slabs: [{ rate: 150 }] });
    expect((await json<{ reason: string }>(silly)).reason).toBe("A VAT rate is a percentage between 0 and 100.");

    const patch = await send("PATCH", `/menu-categories/${encodeURIComponent(SECTION)}/tax-kind`, { kind: "alcohol" });
    expect(patch.status, await patch.clone().text()).toBe(200);
  });
});

describe("the till - a drink under alcohol is VAT", () => {
  it("with no VAT rate set, the drink is refused and nothing reaches the order", async () => {
    const o = await openOrder("no rate");
    const res = await send("POST", `/till/orders/${o.id}/lines`, { itemId: whiskyId, qty: 1 });
    expect(res.status).toBe(409);
    expect((await json<{ reason: string }>(res)).reason).toMatch(/has no VAT rate/);
    const lines = await sql("select count(*)::int as n from pos_order_lines where order_id = $1", [o.id]);
    expect(lines.rows[0].n).toBe(0);
  });

  it("switched off again, the till refuses a drink its section still calls alcohol", async () => {
    await switchAlcohol(false);
    const o = await openOrder("off");
    const res = await send("POST", `/till/orders/${o.id}/lines`, { itemId: whiskyId, qty: 1 });
    expect(res.status).toBe(409);
    expect((await json<{ reason: string }>(res)).reason).toMatch(/not switched on for alcohol/);
    await switchAlcohol(true);
  });

  it("with the rate set, it rings up as VAT and reaches the room bill as its own VAT line", async () => {
    const put = await send("PUT", "/tax/alcohol", { slabs: [{ rate: VAT_RATE, note: "alcohol test" }] });
    expect(put.status, await put.clone().text()).toBe(200);

    /* A room nobody has invoiced yet, so the invoice below is this file's. */
    const { rooms } = await json<{ rooms: { room: string; folioId: string }[] }>(await as("/till/rooms"));
    const free = await sql(
      `select f.id::text as folio, f.reservation_id::text as stay from folios f
        where f.id = any($1::uuid[])
          and not exists (select 1 from invoices i where i.folio_id = f.id)
        limit 1`, [rooms.map((r) => r.folioId)]);
    expect(free.rows[0], "an in-house room with no invoice yet").toBeTruthy();
    folioId = free.rows[0].folio; stayId = free.rows[0].stay;
    const room = rooms.find((r) => r.folioId === folioId)!.room;

    const day = await theDay();
    before = {
      book: day.book, billed: await billOf(stayId),
      vat: day.figures.vat, posVat: day.pos.vat, posTax: day.pos.tax, extraTax: day.figures.extraTax,
    };

    order = await openOrder("settled");
    await send("POST", `/till/orders/${order.id}/lines`, { itemId: tikkaId, qty: 1 });
    const rung = await send("POST", `/till/orders/${order.id}/lines`, { itemId: whiskyId, qty: 2 });
    expect(rung.status, await rung.clone().text()).toBe(200);
    const read = await json<{ lines: { name: string; taxRate: number; taxScheme: string }[]; tax: number }>(rung);
    const whisky = read.lines.find((l) => l.name.startsWith(TAG))!;
    expect(whisky).toMatchObject({ taxRate: VAT_RATE, taxScheme: "vat" });
    expect(read.lines.find((l) => l.name === "Paneer Tikka")!.taxScheme).toBe("gst");

    const settled = await send("POST", `/till/orders/${order.id}/settle`, { method: "room", room, folioId });
    expect(settled.status, await settled.clone().text()).toBe(200);

    const { rows: posted } = await sql(
      `select fp.tax_scheme, fp.tax_rate::float as rate, fp.amount::float as amount,
              fp.tax_amount::float as tax, fp.description
         from folio_postings fp join pos_tickets t on t.posting_id = fp.id
        where t.ticket_ref like $1 order by fp.tax_scheme`, [`${order.orderNo}%`]);
    expect(posted.length, "food and drink are two postings: GST and VAT").toBe(2);
    expect(posted[0]).toMatchObject({ tax_scheme: "gst", rate: 5, amount: 320, tax: 16 });
    expect(posted[1]).toMatchObject({ tax_scheme: "vat", rate: VAT_RATE, amount: 500, tax: 50 });
    expect(posted[1].description).toContain(`(VAT ${VAT_RATE}%)`);

    const after = await billOf(stayId);
    expect(after.vat, "one VAT line, whole - never halved").toEqual([{ rate: VAT_RATE, taxable: 500, vat: 50 }]);
    expect(gstTaxable(after) - gstTaxable(before.billed), "the whisky is in no CGST/SGST row").toBeCloseTo(320, 2);
    expect(Number(after.tax) - Number(before.billed.tax), "and the guest still pays its VAT").toBeCloseTo(66, 2);
  });

  it("the GST invoice and the GST sales register leave the VAT out", async () => {
    const { rows } = await sql(
      `select coalesce(sum(fp.amount) filter (where fp.category <> 'tax'), 0)::float as charges,
              coalesce(sum(fp.tax_amount), 0)::float as tax
         from folio_postings fp
        where fp.folio_id = $1 and fp.category not in ('payment','refund')
          and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`, [folioId]);
    const all = rows[0] as { charges: number; tax: number };

    const res = await send("POST", `/stays/${stayId}/invoice`);
    expect(res.status, await res.clone().text()).toBe(200);
    const inv = await json<{ number: string; taxableValue: number; cgst: number; sgst: number; taxTotal: number }>(res);
    expect(inv.taxableValue, "the invoice's taxable value is the GST supplies alone").toBeCloseTo(all.charges - 500, 2);
    expect(inv.taxTotal, "its tax is GST alone").toBeCloseTo(all.tax - 50, 2);
    expect(inv.cgst + inv.sgst).toBeCloseTo(all.tax - 50, 2);

    const doc = await json<{ lines: { description: string }[] }>(
      await as(`/invoices/${encodeURIComponent(inv.number)}`));
    expect(doc.lines.map((l) => l.description).join(" | ")).not.toContain("VAT");

    const register = await json<{ rows: { number: string; taxable: number; cgst: number; sgst: number }[] }>(
      await as(`/reports/gst-sales?from=${businessDate}&to=${businessDate}`));
    const row = register.rows.find((r) => r.number === inv.number);
    expect(row, "the invoice is in the register").toBeTruthy();
    expect(row!.taxable).toBeCloseTo(all.charges - 500, 2);
    expect(row!.cgst + row!.sgst).toBeCloseTo(all.tax - 50, 2);
  });

  it("the accountant's export: VAT in its own column, and in no GST column", async () => {
    const day = await theDay();
    const d = (f: (b: DayBook) => number) => f(day.book) - f(before.book);
    const t = (b: DayBook) => b.total;

    /* The reports door names the VAT, on the folio and at the outlet ... */
    expect(day.figures.vat - before.vat, "the folio's VAT").toBeCloseTo(50, 2);
    const posVat = day.pos.vat - before.posVat;

    /* ... and the export moves it, and only it, out of the GST columns. */
    expect(d((b) => t(b).vat)).toBeCloseTo(50 + posVat, 2);
    expect(d((b) => t(b).extraTax), "Extra tax carries the tikka's GST, not the whisky's VAT")
      .toBeCloseTo(day.figures.extraTax - before.extraTax - 50, 2);
    expect(d((b) => t(b).posTax)).toBeCloseTo(day.pos.tax - before.posTax - posVat, 2);
    expect(d((b) => t(b).tax), "GST is room + extras + outlets, with no VAT in it")
      .toBeCloseTo(d((b) => t(b).roomTax) + d((b) => t(b).extraTax) + d((b) => t(b).posTax), 2);
    expect(d((b) => t(b).alcohol)).toBeGreaterThanOrEqual(500);
  });

  it("the Manager report prints the VAT as one line, never a CGST/SGST pair", async () => {
    const doc: ReportDoc = await withUser(ownerId, (client) =>
      buildReport(client, hotelId, "manager", { asOn: businessDate }));
    const pos = (doc.sections as ReportSection[]).find((s) => s.key === "pos-summary")!;
    const labels = pos.rows.map((r) => String(r.cells["label"]));
    const vatLine = pos.rows.find((r) => r.cells["label"] === `Tax - VAT ${VAT_RATE}%`);
    expect(vatLine, labels.join(" | ")).toBeTruthy();
    expect(Number(vatLine!.cells["today"])).toBeCloseTo(50, 2);
    expect(labels, "the VAT halved into CGST/SGST").not.toContain(`Tax - CGST ${VAT_RATE / 2}%`);
  });

  it("moved to another of the stay's folios, it stays VAT - on the bill, and out of the Manager report's CGST/SGST", async () => {
    const sgst = async () => {
      const doc: ReportDoc = await withUser(ownerId, (client) =>
        buildReport(client, hotelId, "manager", { asOn: businessDate }));
      const tax = (doc.sections as ReportSection[]).find((s) => s.key === "tax")!;
      return Number(tax.rows.find((r) => r.cells["label"] === "SGST")!.cells["today"]);
    };
    const sgstBefore = await sgst();

    const opened = await send("POST", `/stays/${stayId}/folios`, { billTo: "guest" });
    expect(opened.status, await opened.clone().text()).toBe(200);
    extraFolioId = (await json<{ id: string }>(opened)).id;

    const { rows } = await sql(
      `select fp.id::text from folio_postings fp join pos_tickets t on t.posting_id = fp.id
        where t.ticket_ref like $1 and fp.tax_scheme = 'vat'`, [`${order.orderNo}%`]);
    const moved = await send("POST", `/postings/${rows[0].id}/transfer`, { toFolioId: extraFolioId });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const movedId = (await json<{ id: string }>(moved)).id;

    const schemes = await sql(
      `select (select tax_scheme from folio_postings where id = $1::bigint) as arrived,
              (select tax_scheme from folio_postings where reverses_id = $2::bigint) as left`,
      [movedId, rows[0].id]);
    expect(schemes.rows[0], "both halves of the move are VAT").toEqual({ arrived: "vat", left: "vat" });
    expect((await billOf(stayId)).vat).toEqual([{ rate: VAT_RATE, taxable: 500, vat: 50 }]);
    expect(await sgst(), "the moved VAT was halved into the Manager report's SGST").toBeCloseTo(sgstBefore, 2);
  });

  it("a correction at the desk takes VAT off the VAT side", async () => {
    const { rows } = await sql(
      `select fp.id::text from folio_postings fp join folios f on f.id = fp.folio_id
        where f.reservation_id = $1 and fp.tax_scheme = 'vat' and fp.reverses_id is null
          and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`, [stayId]);
    expect(rows.length, "the whisky, live on one of the stay's bills").toBe(1);
    const res = await send("POST", `/stays/${stayId}/charges/${rows[0].id}/reverse`);
    expect(res.status, await res.clone().text()).toBe(200);
    const made = await json<{ data: { id: string } }>(res);
    const rev = await sql("select tax_scheme from folio_postings where id = $1::bigint", [made.data.id]);
    expect(rev.rows[0].tax_scheme).toBe("vat");
    expect((await billOf(stayId)).vat).toEqual([]);
  });
});

describe("the rate a charge will carry - the Add charge dialog's question", () => {
  it("is the rule for this kind and amount, from the one slab rule", async () => {
    const ask = async (kind: string, amount: number) =>
      json<{ rate: number | null; scheme: string }>(await as(`/tax/${kind}/rate?amount=${amount}`));
    for (const amount of [1000, 8000]) {
      const expected = (await sql(
        "select app.gst_rate_or_null($1, 'room', $2)::float as r", [hotelId, amount])).rows[0].r;
      expect((await ask("room", amount)).rate, `room at ${amount}`).toBe(expected);
    }
    expect(await ask("alcohol", 300)).toMatchObject({ rate: VAT_RATE, scheme: "vat" });
  });

  it("is null - a dash on the screen - where nobody has set one", async () => {
    /* Cleared on the tax card, as a person puts a heading back to unset. */
    const cleared = await send("PUT", "/tax/alcohol", { slabs: [] });
    expect(cleared.status, await cleared.clone().text()).toBe(200);
    expect((await json<{ rate: number | null }>(await as("/tax/alcohol/rate?amount=300"))).rate).toBeNull();
    const nonsense = await as("/tax/whisky/rate?amount=300");
    expect(nonsense.status).toBe(409);
  });
});
