import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { propertyFor, type Property } from "../../../src/modules/reports/index.ts";
import { dayBook } from "../../../src/modules/accounting/dayBook.ts";
import { ledgerNames } from "../../../src/modules/accounting/ledgers.ts";
import { tallyVouchers, tallyXml, TallyRefused, type Voucher } from "../../../src/modules/accounting/tally.ts";
import { AWKWARD_COMPANY, closeDay, everyCase, STRUCK_PAISE } from "./tallyFixture.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TALLY FILES (ACC-4)

   These prove the file's shape and that it balances. What a real TallyPrime
   did with the file is another matter, and is written up in the service's
   CHANGELOG: it cannot run in this suite. Tally ERP 9 has only its shape here.

   Each case that makes data runs in one transaction, rolled back.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

let pool: pg.Pool;
let ownerId: string;
let deskId: string;
let hotelId: string;
let property: Property;
let day: string;

const paise = (n: number) => Math.round(n * 100);
/** A ledger's name in these tests is its own key, so a line can be asked for. */
const nameAll = async (c: pg.PoolClient) => {
  const { ledgers } = await ledgerNames(c, hotelId);
  for (const l of ledgers) {
    await c.query("insert into tally_ledger_names (hotel_id, ledger, name) values ($1, $2, $3)",
      [hotelId, l.key, l.key]);
  }
};

/** One rolled-back transaction, signed in as the owner. */
async function inTransaction<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true)", [ownerId]);
    return await work(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}

/** A fixture day, closed, every ledger named. */
const everything = (c: pg.PoolClient) => inFull(c).then(() => tallyVouchers(c, property, day, day));
async function inFull(c: pg.PoolClient) {
  await everyCase(c, { hotelId, day, staff: ownerId, tag: `TLY-${process.pid}` });
  await nameAll(c);
  await closeDay(c, hotelId, day, ownerId);
}

const one = (vouchers: Voucher[], type: Voucher["type"]) => vouchers.filter((v) => v.type === type);
const line = (v: Voucher, ledger: string) =>
  v.entries.filter((e) => e.ledger === ledger).reduce((t, e) => t + paise(e.amount), 0);

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: SUPER });
  const { rows } = await pool.query(
    "select id::text, email from staff where email in ('owner@fidato.in','agra@fidato.in')");
  ownerId = rows.find((r) => r.email === "owner@fidato.in")!.id;
  deskId = rows.find((r) => r.email === "agra@fidato.in")!.id;
  property = (await withUser(ownerId, (client) => propertyFor(client, "5EL")))!;
  hotelId = property.id;
  day = `${property.businessDate.slice(0, 7)}-02`;
});

afterAll(async () => { await pool.end(); await closePool(); });

/* ── The file's shape ──────────────────────────────────────────────── */

describe("the file", () => {
  const VOUCHER: Voucher = {
    type: "Sales", id: "5EL-2026-08-02-sales", date: "2026-08-02", narration: `Tom & Jerry's <bill> "x" ₹`,
    entries: [{ ledger: `Guests' Ledger & Co <A/c>`, amount: 118.5 }, { ledger: "Room Rent", amount: -118.5 }],
  };

  it("carries vouchers only, never a ledger master, and names no company", () => {
    for (const version of ["prime", "erp9"] as const) {
      const file = tallyXml([VOUCHER], version);
      expect(file).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
      expect(file).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
      expect(file).toContain("<VOUCHER ");
      expect(file, "no master of any kind").not.toMatch(/<LEDGER[ >]|<GROUP|All Masters/);
      expect(file, "it goes into the company open in Tally").not.toContain("SVCURRENTCOMPANY");
    }
  });

  it("escapes every name, in the five forms XML has, and is pure ASCII", () => {
    const file = tallyXml([VOUCHER], "prime");
    expect(file).toContain("<LEDGERNAME>Guests&apos; Ledger &amp; Co &lt;A/c&gt;</LEDGERNAME>");
    expect(file).toContain("<NARRATION>Tom &amp; Jerry&apos;s &lt;bill&gt; &quot;x&quot; &#8377;</NARRATION>");
    /* eslint-disable-next-line no-control-regex */
    expect(file).toMatch(/^[\x09\x0a\x0d\x20-\x7e]*$/);
  });

  it("drops a character XML cannot carry at all", () => {
    const file = tallyXml([{ ...VOUCHER, narration: "a\u0001b" }], "erp9");
    expect(file).toContain("<NARRATION>ab</NARRATION>");
  });

  it("writes a debit deemed positive and negative, a credit neither, and Tally's date", () => {
    const file = tallyXml([VOUCHER], "prime");
    expect(file).toContain("<DATE>20260802</DATE>");
    expect(file).toMatch(/&lt;A\/c&gt;<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-118\.50<\/AMOUNT>/);
    expect(file).toMatch(/Room Rent<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>118\.50<\/AMOUNT>/);
  });

  it("gives Tally Prime its voucher view, and Tally ERP 9 the plain voucher", () => {
    const prime = tallyXml([VOUCHER], "prime");
    const erp9 = tallyXml([VOUCHER], "erp9");
    expect(prime).toContain(`OBJVIEW="Accounting Voucher View"`);
    expect(prime).toContain("<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>");
    expect(prime).toContain("<ISINVOICE>No</ISINVOICE>");
    expect(erp9).not.toMatch(/OBJVIEW|PERSISTEDVIEW|ISINVOICE/);
    for (const file of [prime, erp9]) expect(file).toContain("<ALLLEDGERENTRIES.LIST>");
  });

  it("gives a voucher the same REMOTEID every time, so a corrected day replaces itself", () => {
    expect(tallyXml([VOUCHER], "prime")).toContain(`REMOTEID="5EL-2026-08-02-sales"`);
  });
});

/* ── What stops the file ───────────────────────────────────────────── */

describe("the export stays off", () => {
  it("until every ledger is named, and the sentence says which", async () => {
    await inTransaction(async (c) => {
      const { ledgers } = await ledgerNames(c, hotelId);
      await c.query("insert into tally_ledger_names (hotel_id, ledger, name) values ($1, 'room', 'Room')", [hotelId]);
      const refused = await tallyVouchers(c, property, day, day).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(TallyRefused);
      const sentence = (refused as Error).message;
      expect(sentence).toMatch(/^Type these ledger names first: /);
      expect(sentence, "the one typed is not asked for").not.toContain("Room rent");
      for (const l of ledgers.filter((x) => x.key !== "room")) expect(sentence).toContain(l.label);
    });
  });

  it("refuses a range holding a day the night audit has not closed, and names it", async () => {
    await inTransaction(async (c) => {
      await nameAll(c);
      await closeDay(c, hotelId, day, ownerId);
      const next = `${day.slice(0, 8)}03`;
      await expect(tallyVouchers(c, property, day, next))
        .rejects.toThrow(`The night audit has not closed 3 ${["Aug"][0]} ${day.slice(0, 4)}.`);
    });
  });
});

describe("a day that cannot balance", () => {
  it("is refused, naming the day and the difference, with no line added", async () => {
    await inTransaction(async (c) => {
      await inFull(c);
      /* A settled bill with no tender: the money is in Sales and in no ledger. */
      await c.query("delete from night_audit_runs where hotel_id = $1 and business_date = $2::date", [hotelId, day]);
      const { rows: [o] } = await c.query<{ id: string }>(
        `insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by, status)
         select $1, id, 'TLY-NOPAY', $2::date, $3, 'open' from pos_outlets where hotel_id = $1 limit 1
         returning id::text`, [hotelId, day, ownerId]);
      await c.query(
        `insert into pos_order_lines (hotel_id, order_id, item_id, name, qty, unit_price, tax_rate, added_by)
         select $1, $2, i.id, 'A dish', 1, 100, 0, $3
           from pos_menu_items i join pos_menu_categories k on k.id = i.category_id where k.hotel_id = $1 limit 1`,
        [hotelId, o!.id, ownerId]);
      await c.query(
        "update pos_orders set status = 'settled', settled_by = $2, settled_at = now(), payment_method = 'cash' where id = $1",
        [o!.id, ownerId]);
      await closeDay(c, hotelId, day, ownerId);

      const refused = await tallyVouchers(c, property, day, day).catch((e: unknown) => e) as Error;
      expect(refused).toBeInstanceOf(TallyRefused);
      expect(refused.message).toMatch(/^2 Aug \d{4} cannot be exported: its Sales voucher has debits of/);
      expect(refused.message).toContain("a difference of ₹100.00");
    });
  });

  it("is refused when a payment has no way of paying on record", async () => {
    await inTransaction(async (c) => {
      await nameAll(c);
      const { rows: [f] } = await c.query<{ id: string }>(
        "select id::text from folios where hotel_id = $1 and status = 'open' limit 1", [hotelId]);
      await c.query(
        `insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
         values ($1, $2, $3::date, 'payment', 'No way recorded', -75, 0, 0)`, [hotelId, f!.id, day]);
      await closeDay(c, hotelId, day, ownerId);
      await expect(tallyVouchers(c, property, day, day))
        .rejects.toThrow(/2 Aug \d{4} cannot be exported: ₹75.00 has no way of paying recorded/);
    });
  });
});

/* ── Every case, against the day book ──────────────────────────────── */

describe("every voucher, from the day book's own figures", () => {
  it("balances to the paisa, every one of them", async () => {
    await inTransaction(async (c) => {
      const vouchers = await everything(c);
      expect(vouchers.length).toBeGreaterThanOrEqual(5);
      for (const v of vouchers) {
        expect(v.entries.reduce((t, e) => t + paise(e.amount), 0), v.id).toBe(0);
        expect(v.entries.every((e) => e.amount !== 0), `${v.id}: no line of nothing`).toBe(true);
      }
    });
  });

  it("makes the Sales voucher line for line from the day's columns", async () => {
    await inTransaction(async (c) => {
      const vouchers = await everything(c);
      const book = await dayBook(c, property, day, day);
      const d = book.days[0]!;
      const sales = one(vouchers, "Sales")[0]!;

      expect(line(sales, "room")).toBe(-paise(d.room));
      expect(line(sales, "food")).toBe(-paise(d.food));
      expect(line(sales, "other")).toBe(-paise(d.otherExtra));
      expect(line(sales, "restaurant")).toBe(-paise(d.pos));
      expect(line(sales, "alcohol")).toBe(-paise(d.alcohol));
      expect(line(sales, "discount")).toBe(paise(d.discount));
      expect(line(sales, "vat"), "VAT is its own ledger, never CGST or SGST").toBe(-paise(d.vat));
      expect(line(sales, "cgst") + line(sales, "sgst"), "GST is the day's GST").toBe(-paise(d.tax));
      expect(Math.abs(line(sales, "cgst") - line(sales, "sgst")), "halved, within a paisa").toBeLessThanOrEqual(1);
    });
  });

  it("takes the restaurant's money where it went, and its round off", async () => {
    await inTransaction(async (c) => {
      const sales = one(await everything(c), "Sales")[0]!;
      expect(line(sales, "round_off"), "rounded down 0.34, a debit").toBe(34);
      expect(line(sales, "allowance"), "the owner's allowance, its free part").toBe(15000);
    });
  });

  it("leaves out a struck line, an NC bill, a voided bill and a reversed charge", async () => {
    const without = await inTransaction(async (c) => {
      await nameAll(c);
      await closeDay(c, hotelId, day, ownerId);
      return dayBook(c, property, day, day);
    });
    await inTransaction(async (c) => {
      const vouchers = await everything(c);
      const sales = one(vouchers, "Sales")[0]!;
      /* The fixture's own sales, once each: not 777 struck, not 500 NC, not
         600 voided, not 999 reversed. */
      const added = (n: number) => n + 0;
      expect(-line(sales, "restaurant") - paise(without.days[0]!.pos)).toBe(added(103080 + 20000));
      expect(-line(sales, "food") - paise(without.days[0]!.food)).toBe(45050);
      expect(JSON.stringify(sales)).not.toContain(String(STRUCK_PAISE));
    });
  });

  it("moves a bill to a company by journal, and a refund by payment voucher", async () => {
    await inTransaction(async (c) => {
      const vouchers = await everything(c);
      const journal = one(vouchers, "Journal").find((v) => v.date === day)!;
      expect(line(journal, "companies")).toBe(100000);
      expect(line(journal, "guests")).toBe(-100000);
      const refund = one(vouchers, "Payment").find((v) => v.date === day)!;
      expect(line(refund, "guests")).toBe(25000);
      expect(line(refund, "cash")).toBe(-25000);
    });
  });

  it("the Receipt voucher less the refund is the day book's Receipts", async () => {
    await inTransaction(async (c) => {
      const vouchers = await everything(c);
      const d = (await dayBook(c, property, day, day)).days[0]!;
      const receipt = one(vouchers, "Receipt").find((v) => v.id.endsWith(`${day}-receipt`))!;
      const refund = one(vouchers, "Payment")[0]!;
      expect(-line(receipt, "guests") - line(refund, "guests")).toBe(paise(d.receipt));
      expect(line(receipt, "cash")).toBeGreaterThanOrEqual(150000);
    });
  });

  it("gives each company receipt its own voucher, with its party in words", async () => {
    await inTransaction(async (c) => {
      const receipt = one(await everything(c), "Receipt").find((v) => v.id.includes("company-receipt"))!;
      expect(line(receipt, "bank_transfer")).toBe(100000);
      expect(line(receipt, "companies")).toBe(-100000);
      expect(receipt.narration).toContain(AWKWARD_COMPANY);
      const file = tallyXml([receipt], "prime");
      expect(file).toContain("Sharma &amp; Sons&apos;s &lt;Travels&gt;");
      expect(file).toContain("UTR&amp;1&apos;2");
    });
  });

  it("makes no voucher for a day of nothing", async () => {
    await inTransaction(async (c) => {
      await nameAll(c);
      const empty = "2020-01-01";
      await closeDay(c, hotelId, empty, ownerId);
      expect(await tallyVouchers(c, property, empty, empty)).toEqual([]);
    });
  });

  it("marks a test hotel's narration, so nothing passes for the real thing (D27-296)", async () => {
    await inTransaction(async (c) => {
      await inFull(c);
      const vouchers = await tallyVouchers(c, { ...property, test: true }, day, day);
      expect(vouchers.every((v) => v.narration.startsWith("TEST - NOT VALID. "))).toBe(true);
    });
  });
});

/* ── The route ─────────────────────────────────────────────────────── */

describe("the file's address", () => {
  const range = () => `from=${day}&to=${day}`;
  const call = (file: string, staff: string) =>
    app.request(`/api/hotels/5EL/accounting/${file}?${range()}`, { headers: { "x-dev-staff-id": staff } });

  it("refuses, in the sentence, while a ledger is blank", async () => {
    const r = await call("tally-prime.xml", ownerId);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(/^Type these ledger names first: /);
  });

  it("refuses reception, as the day book does", async () => {
    expect((await call("tally-erp9.xml", deskId)).status).toBe(403);
  });

  it("refuses a date that is not one, and a third kind of Tally file", async () => {
    const r = await app.request("/api/hotels/5EL/accounting/tally-prime.xml?from=x&to=y",
      { headers: { "x-dev-staff-id": ownerId } });
    expect(r.status).toBe(400);
    expect((await call("tally-seven.xml", ownerId)).status).toBe(404);
  });

  it("hands over the file once it can be made, under the two names", async () => {
    await inTransaction(async (c) => { await nameAll(c); await c.query("commit"); await c.query("begin"); });
    await pool.query(
      `insert into night_audit_runs (hotel_id, business_date, status, run_by, completed_at)
       values ($1, $2::date, 'completed', $3, now())`, [hotelId, day, ownerId]);
    try {
      for (const [file, tag] of [["tally-prime.xml", "tally-prime"], ["tally-erp9.xml", "tally-erp9"]] as const) {
        const r = await call(file, ownerId);
        expect(r.status, await r.clone().text()).toBe(200);
        expect(r.headers.get("content-type")).toMatch(/xml/);
        expect(r.headers.get("content-disposition")).toContain(`-${tag}-${day}-to-${day}.xml"`);
        expect(await r.text()).toContain("<ENVELOPE>");
      }
    } finally {
      await pool.query("delete from night_audit_runs where hotel_id = $1 and business_date = $2::date", [hotelId, day]);
      await pool.query("delete from tally_ledger_names where hotel_id = $1", [hotelId]);
    }
  });
});
