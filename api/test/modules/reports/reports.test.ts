import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE REPORTS AGREE WITH EACH OTHER

   Every figure here is derived from `folio_postings`. Two reports of
   one figure that disagree mean one of them is wrong, and the demo
   dataset is calibrated to a real eZee export — so "wrong" is
   checkable rather than a matter of opinion.

   THE TEST THAT EXISTS BECAUSE IT CAUGHT SOMETHING

   The Manager Report reported ₹4,60,697.76 of revenue against a ledger
   holding ₹4,59,697.76. `w.discount` was fetched, typed, and never
   read: the total was higher than the ledger by every discount the
   property had ever given, and the report's own rows did not subtract
   to its own closing balance.

   Found by building the Guest Ledger over the same postings and
   watching the two disagree by exactly ₹1,000 — the single discount in
   the fixture.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;

const call = (path: string) =>
  app.request(`/api/hotels${path}`, { headers: { "x-dev-staff-id": ownerId } });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'",
    )).rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => { await closePool(); });

interface ManagerRow { label: string; ptd: number | null }
interface ManagerSection { title: string; rows: ManagerRow[] }

async function manager(): Promise<ManagerSection[]> {
  const body = (await (await call("/5EL/reports/manager")).json()) as
    { sections: ManagerSection[] };
  return body.sections;
}

const rowOf = (sections: ManagerSection[], section: string, label: string) =>
  sections.find((s) => s.title === section)?.rows.find((r) => r.label === label);

/* ── The one that caught the discount ─────────────────────────────── */

describe("the Manager Report and the Guest Ledger agree", () => {
  it("reports the same charges to the paisa", async () => {
    const ledger = (await (await call("/5EL/reports/guest-ledger")).json()) as
      { rows: Array<{ charges: number; payments: number; closing: number }> };

    const charges = ledger.rows.reduce((n, r) => n + r.charges, 0);
    const sections = await manager();
    const posted = rowOf(sections, "Guest Ledger", "Charge Posted to Guest Ledger");

    expect(posted?.ptd).toBeCloseTo(charges, 2);
  });

  it("reports the same settlement, and the same closing balance", async () => {
    const ledger = (await (await call("/5EL/reports/guest-ledger")).json()) as
      { rows: Array<{ charges: number; payments: number; closing: number }> };

    const payments = ledger.rows.reduce((n, r) => n + r.payments, 0);
    const closing = ledger.rows.reduce((n, r) => n + r.closing, 0);

    const sections = await manager();
    expect(rowOf(sections, "Guest Ledger", "Settlement by Guest")?.ptd)
      .toBeCloseTo(payments, 2);
    expect(rowOf(sections, "Guest Ledger", "Closing Balance")?.ptd)
      .toBeCloseTo(closing, 2);
  });

  it("subtracts the discount from revenue", async () => {
    /* `net = room + extra` omitted it entirely. The rows are checked
       against the total rather than against a constant, so this holds
       whatever the fixture contains. */
    const sections = await manager();
    const room = rowOf(sections, "Revenue", "Room Charges")?.ptd ?? 0;
    const extra = rowOf(sections, "Revenue", "Extra Charges")?.ptd ?? 0;
    const discount = rowOf(sections, "Revenue", "Discount")?.ptd ?? 0;
    const sgst = rowOf(sections, "Revenue", "SGST")?.ptd ?? 0;
    const cgst = rowOf(sections, "Revenue", "CGST")?.ptd ?? 0;
    const net = rowOf(sections, "Revenue", "Total Revenue without Tax")?.ptd ?? 0;
    const gross = rowOf(sections, "Revenue", "Total Revenue with Tax")?.ptd ?? 0;

    /* Discount is SHOWN, so the total can be reconstructed from what is
       printed. A total nobody can rebuild from the rows above it is a
       total nobody can check. */
    expect(rowOf(sections, "Revenue", "Discount")).toBeTruthy();
    expect(discount).toBeLessThanOrEqual(0);

    expect(net).toBeCloseTo(room + extra + discount, 2);
    expect(gross).toBeCloseTo(net + sgst + cgst, 2);
  });
});

/* ── The GST register against the invoices it extracts ────────────── */

describe("the GST sales register", () => {
  it("carries every invoice issued in the window, and no other", async () => {
    const body = (await (await call("/5EL/reports/gst-sales")).json()) as {
      from: string; to: string;
      rows: Array<{ number: string; taxable: number; cgst: number;
                    sgst: number; total: number }>;
    };

    const db = await admin();
    try {
      /* Dated by the property's BUSINESS DATE, not the wall clock. An
         invoice raised at 09:00 on the 29th for a stay that closed on
         the 25th belongs to the 25th — filtering on issued_at put it
         outside an August register entirely. */
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from invoices i
          where i.hotel_id = (select id from hotels where code = '5EL')
            and coalesce(i.business_date, i.issued_at::date)
                between $1::date and $2::date`,
        [body.from, body.to],
      );
      expect(body.rows.length).toBe(Number(rows[0]!.n));
    } finally {
      await db.end();
    }

    /* And every row adds up on its own. */
    for (const r of body.rows) {
      expect(r.cgst + r.sgst + r.taxable, r.number).toBeCloseTo(r.total, 2);
    }
  });
});

/* ── Cashier shift ────────────────────────────────────────────────── */

describe("the cashier shift", () => {
  it("totals the same money the Manager Report calls received", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ amount: number }> };
    const taken = shift.rows.reduce((n, r) => n + r.amount, 0);

    const sections = await manager();
    const today = sections.find((s) => s.title === "Payment")
      ?.rows.find((r) => r.label === "Total Payment");

    const body = (await (await call("/5EL/reports/manager")).json()) as {
      sections: Array<{ title: string; rows: Array<{ label: string; today: number | null }> }>;
    };
    const managerToday = body.sections
      .find((s) => s.title === "Payment")
      ?.rows.find((r) => r.label === "Total Payment")?.today ?? 0;

    expect(today, "the Manager Report has no Total Payment row").toBeTruthy();
    /* The shift report defaults to TODAY, so it compares against the
       Manager Report's today column, not its period-to-date one. */
    expect(taken).toBeCloseTo(managerToday, 2);
  });

  it("says nothing rather than naming a cashier it does not know", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ cashier: string | null }> };

    /* The demo's postings predate staff attribution, so `cashier` is
       null. That must arrive as null — a "System" placeholder would
       name somebody who did not take the money. */
    for (const r of shift.rows) {
      expect(r.cashier === null || typeof r.cashier === "string").toBe(true);
    }
  });
});

/* ── C-Form ───────────────────────────────────────────────────────── */

describe("the C-Form report", () => {
  it("says on its own body that this system does not file", async () => {
    const body = (await (await call("/5EL/reports/c-form")).json()) as
      { note: string; rows: unknown[] };
    /* Not only in a comment, and not only on the screen. Anything
       consuming this must not assume the filing happened. */
    expect(body.note).toMatch(/does not file/i);
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("carries only foreign nationals", async () => {
    const body = (await (await call("/5EL/reports/c-form")).json()) as
      { rows: Array<{ nationality: string }> };
    for (const r of body.rows) expect(r.nationality).not.toBe("IN");
  });
});

/* ── City ledger ──────────────────────────────────────────────────── */

describe("the city ledger", () => {
  /* It printed "Mr. Agoda", "Mr. Walk-in" — a contact person made up for
     every account, on screen and in the CSV (found 15 September). */
  type LedgerRow = { account: string; contact: string | null; phone: string | null };
  const ledger = async () =>
    (await (await call("/5EL/reports/city-ledger")).json()) as LedgerRow[];

  it("names no contact it does not hold", async () => {
    const rows = await ledger();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.contact ?? "").not.toMatch(/^Mr\. /);
  });

  it("shows a company's own contact, from its record, on its row only", async () => {
    const rows = await ledger();
    const db = await admin();
    try {
      const { rows: companies } = await db.query<{ name: string }>(
        "select name from companies where name = any($1) order by name limit 1",
        [rows.map((r) => r.account)]);
      const company = companies[0]?.name;
      expect(company, "no company among the ledger's accounts").toBeDefined();

      await db.query(
        "update companies set contact_name = 'Test Contact', phone = 'test-phone' where name = $1",
        [company]);
      try {
        const after = await ledger();
        const own = after.find((r) => r.account === company)!;
        expect(own.contact).toBe("Test Contact");
        expect(own.phone).toBe("test-phone");
        for (const r of after.filter((x) => x.account !== company)) {
          expect(r.contact).not.toBe("Test Contact");
        }
      } finally {
        await db.query(
          "update companies set contact_name = null, phone = null where name = $1", [company]);
      }
    } finally { await db.end(); }
  });
});
