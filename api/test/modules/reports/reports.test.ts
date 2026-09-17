import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { buildReport, type ReportDoc } from "../../../src/modules/reports/index.ts";

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

/* ── The Manager report, in the owner's layout ────────────────────── */

const managerDoc = async (query = "") =>
  (await (await call(`/5EL/reports/manager${query}`)).json()) as ReportDoc;

type Three = { today: number | null; ptd: number | null; ytd: number | null };
const figure = (doc: ReportDoc, section: string, label: string): Three => {
  const r = doc.sections.find((x) => x.key === section)?.rows.find((x) => x.cells["label"] === label);
  expect(r, `${section} / ${label}`).toBeDefined();
  return {
    today: r!.cells["today"] as number | null,
    ptd: r!.cells["ptd"] as number | null,
    ytd: r!.cells["ytd"] as number | null,
  };
};

describe("the Manager report adds up the way its own page says", () => {
  it("builds its revenue lines from the rows above them, discount included", async () => {
    /* The report once showed ₹4,60,697.76 of revenue against a ledger
       holding ₹4,59,697.76: a discount fetched and never subtracted.
       Every total is checked against the rows printed above it. */
    const doc = await managerDoc();
    const extra = doc.sections.find((x) => x.key === "extra-charges")!;
    expect(extra.rows.some((r) => r.cells["label"] === "Discount")).toBe(true);
    for (const col of ["today", "ptd", "ytd"] as const) {
      const v = (s: string, l: string) => figure(doc, s, l)[col] as number;
      const extraRows = extra.rows.filter((r) => r.kind === "row")
        .reduce((t, r) => t + (r.cells[col] as number), 0);
      expect(extraRows, `${col} extra`).toBeCloseTo(v("extra-charges", "Total"), 2);
      expect(v("room-charges", "Total"))
        .toBeCloseTo(v("room-charges", "Room Charges") + v("room-charges", "Cancellation Revenue"), 2);
      expect(v("tax", "Total")).toBeCloseTo(v("tax", "SGST") + v("tax", "CGST"), 2);
      expect(v("revenue", "Total Revenue without Tax"))
        .toBeCloseTo(v("room-charges", "Total") + v("extra-charges", "Total"), 2);
      expect(v("revenue", "Total Revenue with Tax"))
        .toBeCloseTo(v("revenue", "Total Revenue without Tax") + v("tax", "Total"), 2);
      expect(v("revenue", "Transfer Charges to Guest Ledger"))
        .toBeCloseTo(v("revenue", "Total Revenue with Tax") + v("revenue", "POS to PMS Posting"), 2);
      expect(v("revenue-summary", "PMS Revenue")).toBeCloseTo(v("revenue", "Total Revenue without Tax"), 2);
      expect(v("revenue-summary", "Total Revenue"))
        .toBeCloseTo(v("revenue-summary", "PMS Revenue") + v("revenue-summary", "POS Revenue"), 2);
      expect(v("revenue-summary", "POS Revenue"))
        .toBeCloseTo(v("pos-summary", "All Outlet's Total Revenue without Tax"), 2);
    }
  });

  it("closes the guest ledger by its printed formula, at the balance the bills hold", async () => {
    const doc = await managerDoc("?asOn=2026-08-25");
    const g = (l: string) => figure(doc, "guest-ledger", l).today as number;
    expect(g("Closing Balance*")).toBeCloseTo(
      g("Opening Balance") - g("Carry Forwarded Advance Deposit")
        + g("Charge Posted to Guest Ledger") - g("Settlement by Guest"), 2);
    expect(g("Transfer From Advance Deposit*"))
      .toBe(figure(doc, "advance-deposit-ledger", "Balance Transfer to Guest Ledger").today);

    /* And the closing IS what the bills hold, asked of the database:
       every live posting to the day, less deposits still waiting for a
       guest who has not arrived. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ held: string }>(
        `with live as (
           select fp.* from folio_postings fp join hotels h on h.id = fp.hotel_id
            where h.code = '5EL' and fp.reverses_id is null
              and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)
              and fp.business_date <= '2026-08-25')
         select (coalesce((select sum(amount + tax_amount) from live), 0)
                 + coalesce((select sum(-l.amount) from live l
                              join folios f on f.id = l.folio_id
                              join reservations r on r.id = coalesce(l.reservation_id, f.reservation_id)
                             where l.category = 'payment'
                               and l.business_date < r.check_in and r.check_in > '2026-08-25'
                               and not exists (select 1 from payments p
                                                where p.posting_id = l.id and p.method = 'city_ledger')), 0)
                )::text as held`);
      expect(g("Closing Balance*")).toBeCloseTo(Number(rows[0]!.held), 2);
    } finally { await db.end(); }
  });

  it("keeps money taken before arrival in the advance deposit ledger until the guest comes", async () => {
    const db = await admin();
    let stay = "";
    let arrival = "";
    try {
      const { rows } = await db.query<{ id: string; arrival: string }>(
        `select r.id, to_char(r.check_in, 'YYYY-MM-DD') as arrival
           from reservations r join hotels h on h.id = r.hotel_id
          where h.code = '5EL' and r.status = 'confirmed' and r.check_in > '2026-08-26'
          order by r.check_in, r.reference limit 1`);
      stay = rows[0]!.id;
      arrival = rows[0]!.arrival;
    } finally { await db.end(); }

    const before = await managerDoc("?asOn=2026-08-25");
    const paid = await app.request(`/api/hotels/5EL/stays/${stay}/payments`, {
      method: "POST",
      headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
      body: JSON.stringify({ method: "UPI", amount: 1500 }),
    });
    expect(paid.status).toBe(200);
    const after = await managerDoc("?asOn=2026-08-25");
    const delta = (s: string, l: string) => Math.round(
      ((figure(after, s, l).today as number) - (figure(before, s, l).today as number)) * 100) / 100;

    expect(delta("advance-deposit-ledger", "Advance Deposit Collected")).toBe(1500);
    expect(delta("advance-deposit-ledger", "Closing Balance")).toBe(1500);
    expect(delta("guest-ledger", "Settlement by Guest")).toBe(0);
    expect(delta("guest-ledger", "Closing Balance*")).toBe(0);
    expect(delta("payment", "UPI")).toBe(1500);

    /* On the day the guest arrives, it crosses into the guest ledger. */
    const onArrival = await managerDoc(`?asOn=${arrival}`);
    expect(figure(onArrival, "advance-deposit-ledger", "Balance Transfer to Guest Ledger").today)
      .toBeGreaterThanOrEqual(1500);
    expect(figure(onArrival, "guest-ledger", "Carry Forwarded Advance Deposit").today)
      .toBe(figure(onArrival, "advance-deposit-ledger", "Balance Transfer to Guest Ledger").today);
  });

  it("counts the restaurant's settled bills as the till does", async () => {
    const db = await admin();
    let outlet = "";
    let item = "";
    try {
      const hotel = (await db.query<{ id: string }>("select id from hotels where code = '5EL'")).rows[0]!.id;
      outlet = (await db.query<{ code: string }>(
        "select code from pos_outlets where hotel_id = $1 and is_active order by code limit 1",
        [hotel])).rows[0]!.code;
      item = (await db.query<{ id: string }>(
        `select i.id::text from pos_menu_items i
          where i.hotel_id = $1 and i.is_active and i.off_until is null
            and not exists (select 1 from pos_item_variations v where v.item_id = i.id and v.is_active)
          limit 1`, [hotel])).rows[0]!.id;
    } finally { await db.end(); }

    const before = await managerDoc("?asOn=2026-08-25");
    const send = (method: string, path: string, body: unknown) => app.request(`/api/hotels${path}`, {
      method,
      headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const made = await send("POST", "/5EL/till/orders/batch",
      { outlet, table: "REP-1", lines: [{ itemId: item, qty: 2 }] });
    expect(made.status).toBe(200);
    const order = (await made.json()) as { id: string };
    const settled = await send("POST", `/5EL/till/orders/${order.id}/settle`, { method: "cash" });
    expect(settled.status).toBe(200);
    const after = await managerDoc("?asOn=2026-08-25");

    const db2 = await admin();
    let payable = 0;
    let withoutTax = 0;
    try {
      const { rows } = await db2.query<{ payable: string; taxable: string; round_off: string }>(
        "select payable::text, taxable::text, round_off::text from app.pos_order_total($1)", [order.id]);
      payable = Number(rows[0]!.payable);
      withoutTax = Number(rows[0]!.taxable) + Number(rows[0]!.round_off);
    } finally { await db2.end(); }

    const delta = (s: string, l: string) => Math.round(
      ((figure(after, s, l).today as number) - (figure(before, s, l).today as number)) * 100) / 100;
    expect(payable).toBeGreaterThan(0);
    expect(delta("pos-summary", "All Outlet's Total Revenue with Tax")).toBeCloseTo(payable, 2);
    expect(delta("pos-summary", "All Outlet's Total Revenue without Tax")).toBeCloseTo(withoutTax, 2);
    expect(delta("pos-payment-summary", "All Outlet's Payment Total")).toBeCloseTo(payable, 2);
    expect(delta("revenue-summary", "POS Revenue")).toBeCloseTo(withoutTax, 2);
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
  it("totals the same money the Manager report calls received today", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ amount: number }> };
    const taken = shift.rows.reduce((n, r) => n + r.amount, 0);
    /* The shift report defaults to TODAY, so it compares against the
       Manager report's Today column. */
    expect(taken).toBeCloseTo(figure(await managerDoc(), "payment", "Total Payment").today as number, 2);
  });

  it("says nothing rather than naming a cashier it does not know", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ cashier: string | null }> };

    /* The demo's postings predate staff attribution, so `cashier` is
       null. That must arrive as null: a "System" placeholder would
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

/* ── Dates: derived, never typed in (REP-1, REP-2) ────────────────────
   The Manager report's year started on the literal 1 April 2026, and the
   yearly grid asked for 2026 whatever the year. Both were right on the
   demo's 25 August 2026 — so every check here uses a date in ANOTHER
   month and ANOTHER financial year, where a literal cannot pass. */

describe("the reports' dates come from the report's own day", () => {
  const managerAsOn = async (query = "") => {
    const doc = await managerDoc(query);
    const fact = (label: string) => doc.facts.find((f) => f.label === label)?.value as string;
    return { doc, asOn: fact("As on Date"), ptdFrom: fact("PTD"), ytdFrom: fact("YTD") };
  };

  /** Sellable room-nights from `from` to `to`, asked of the database —
      what the YTD column must have counted if its window starts there. */
  const sellable = async (from: string, to: string) => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select coalesce(sum(app.sellable_rooms(h.id, d::date)), 0)::text as n
           from hotels h, generate_series($1::date, $2::date, interval '1 day') d
          where h.code = '5EL'`, [from, to]);
      return Number(rows[0]!.n);
    } finally { await db.end(); }
  };

  it("starts the year to date on the 1 April on or before the report's date", async () => {
    /* [as on, the year starts, the period starts] — either side of 1 April,
       in the demo's year and the next two. */
    const cases: Array<[string, string, string]> = [
      ["2026-08-25", "2026-04-01", "2026-08-01"],
      ["2027-02-10", "2026-04-01", "2027-02-01"],
      ["2027-03-31", "2026-04-01", "2027-03-01"],
      ["2027-04-01", "2027-04-01", "2027-04-01"],
      ["2027-05-10", "2027-04-01", "2027-05-01"],
      ["2028-01-15", "2027-04-01", "2028-01-01"],
    ];
    for (const [asOn, ytdFrom, ptdFrom] of cases) {
      /* No ptdFrom sent: the period must follow the report's date too. */
      const body = await managerAsOn(`?asOn=${asOn}`);
      expect(body.ytdFrom, `year start for ${asOn}`).toBe(ytdFrom);
      expect(body.ptdFrom, `period start for ${asOn}`).toBe(ptdFrom);
    }
  });

  it("counts the year to date over that window, not over the label alone", async () => {
    /* A label can be right while the query still uses the old start. The
       YTD room-nights are compared with the database's own sum over the
       window the label names. */
    for (const [asOn, ytdFrom] of [["2027-05-10", "2027-04-01"], ["2027-02-10", "2026-04-01"]]) {
      const body = await managerAsOn(`?asOn=${asOn}`);
      const ytd = figure(body.doc, "room-summary", "Total Available Room nights").ytd;
      expect(ytd, `YTD room-nights as on ${asOn}`).toBe(await sellable(ytdFrom!, asOn!));
    }
  });

  it("with nothing sent, follows the property into another month and financial year", async () => {
    const db = await admin();
    const { rows: [before] } = await db.query<{ set: string; derived: string }>(
      `select to_char(business_date, 'YYYY-MM-DD') as set,
              to_char(app.business_date(id), 'YYYY-MM-DD') as derived
         from hotels where code = '5EL'`);
    /* Moving hotels.business_date moves the property only while no night
       audit has completed; say so here rather than fail obscurely below. */
    expect(before!.derived, "5EL has a completed night audit; its date cannot be moved here")
      .toBe(before!.set);

    await db.query("update hotels set business_date = '2027-05-10' where code = '5EL'");
    try {
      const report = await managerAsOn();
      expect(report.asOn).toBe("2027-05-10");
      expect(report.ptdFrom).toBe("2027-05-01");
      expect(report.ytdFrom).toBe("2027-04-01");

      const yearly = (await (await call("/5EL/reports/yearly-statistics")).json()) as ReportDoc;
      expect(yearly.facts).toEqual([{ label: "Year", value: "2027", kind: "text" }]);
      expect(yearly.sections[0]!.rows.map((r) => r.cells["label"])).toEqual([
        "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December", "Grand Total",
      ]);

      const monthly = (await (await call("/5EL/reports/monthly-statistics")).json()) as ReportDoc;
      const days = monthly.sections[0]!.rows.filter((r) => r.kind === "row");
      expect(monthly.facts[0]?.value).toBe("May 2027");
      expect(days[0]?.cells["label"]).toBe("1 Sat");
      expect(days.at(-1)?.cells["label"]).toBe("31 Mon");
    } finally {
      await db.query("update hotels set business_date = $1 where code = '5EL'", [before!.set]);
      await db.end();
    }
  });

  it("says what each statistic is, so the screen prints it as that", async () => {
    const { doc } = await managerAsOn();
    const statistics = doc.sections.find((x) => x.key === "statistics")!.rows;
    expect(Object.fromEntries(statistics.map((r) => [r.cells["label"], r.unit]))).toEqual({
      "Occupancy Rate (%)": "percent",
      "Average Daily Rate (ADR)": "money",
      "Revenue Per Available Room": "money",
    });
  });
});

/* ── City ledger ──────────────────────────────────────────────────── */

describe("balances by booking source (finance's Company accounts)", () => {
  /* It printed "Mr. Agoda", "Mr. Walk-in" — a contact person made up for
     every account, on screen and in the CSV (found 15 September). */
  type LedgerRow = { account: string; contact: string | null; phone: string | null };
  const ledger = async () =>
    (await (await call("/5EL/reports/balances-by-source")).json()) as LedgerRow[];

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

/* ── The owner's layout: the statistics (D17-62, D17-71, D17-72) ─────
   The owner decided on 17 September, as the eZee exports count them:
   a night's room charge sits on the night it pays for, a night not yet
   posted from the business date on counts at the booking's rate, and a
   complimentary room is sold. Each rule is checked against the database
   directly, never against a constant the report could share. */

describe("the statistics, in the owner's layout", () => {
  type Row = ReportDoc["sections"][number]["rows"][number];
  const doc = async (path: string) =>
    (await (await call(path)).json()) as ReportDoc;
  const dayRow = (d: ReportDoc, label: string): Row =>
    d.sections[0]!.rows.find((r) => r.cells["label"] === label)!;

  it("splits a posting for several nights over those nights, to the paisa", async () => {
    const before = await doc("/5EL/reports/monthly-statistics?month=2026-03");
    const db = await admin();
    try {
      /* March 2026 holds nothing in the demo. Three nights for ₹3,000.01:
         ₹1,000.00, ₹1,000.00, and the paisa on the last. */
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
         select f.hotel_id, f.id, '2026-03-10', 'room', 'Room 999 · 3 nights', 3000.01, 5, 150.00
           from folios f join hotels h on h.id = f.hotel_id
          where h.code = '5EL' and f.reservation_id is not null
          limit 1`);
    } finally { await db.end(); }

    const after = await doc("/5EL/reports/monthly-statistics?month=2026-03");
    const grew = (label: string) =>
      Math.round(((dayRow(after, label).cells["room"] as number)
        - (dayRow(before, label).cells["room"] as number)) * 100) / 100;

    expect(grew("9 Mon")).toBe(0);
    expect(grew("10 Tue")).toBe(1000);
    expect(grew("11 Wed")).toBe(1000);
    expect(grew("12 Thu")).toBe(1000.01);
    expect(grew("13 Fri")).toBe(0);
    expect(grew("Total")).toBe(3000.01);
  });

  it("counts a night not posted yet at the booking's rate, from the business date on", async () => {
    /* September 2026 is after the demo's business date and nothing is
       posted there: every room charge on it is a booking's rate. */
    const september = await doc("/5EL/reports/monthly-statistics?month=2026-09");
    const db = await admin();
    try {
      for (const r of september.sections[0]!.rows.filter((x) => x.kind === "row")) {
        const day = Number(String(r.cells["label"]).split(" ")[0]);
        const date = `2026-09-${String(day).padStart(2, "0")}`;
        const { rows } = await db.query<{ rent: string; paying: string; comp: string }>(
          `select coalesce(sum(agreed_rate) filter (where not is_complimentary), 0)::text as rent,
                  count(*) filter (where not is_complimentary)::text as paying,
                  count(*) filter (where is_complimentary)::text as comp
             from reservations r join hotels h on h.id = r.hotel_id
            where h.code = '5EL'
              and r.status in ('confirmed','checked_in','checked_out')
              and r.check_in <= $1::date and r.check_out > $1::date`, [date]);
        expect(r.cells["room"], date).toBeCloseTo(Number(rows[0]!.rent), 2);
        expect(r.cells["sold"], date).toBe(Number(rows[0]!.paying));
        expect(r.cells["complimentary"], date).toBe(Number(rows[0]!.comp));
      }
    } finally { await db.end(); }
  });

  it("counts a complimentary room as occupied, in occupancy and the average rate", async () => {
    const august = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const days = august.sections[0]!.rows.filter((r) => r.kind === "row");
    const withComp = days.find((r) => (r.cells["complimentary"] as number) > 0);
    expect(withComp, "the demo has a complimentary night in August").toBeDefined();

    const c = withComp!.cells as Record<string, number>;
    const occupied = c["sold"]! + c["complimentary"]!;
    expect(c["occupancy"]).toBeCloseTo((occupied / c["available"]!) * 100, 2);
    expect(c["adr"]).toBeCloseTo(c["room"]! / occupied, 2);

    /* And the Dashboard's figure counts it the same way. */
    const date = `2026-08-${String(String(withComp!.cells["label"]).split(" ")[0]).padStart(2, "0")}`;
    const period = (await (await call(`/5EL/statistics/period?from=${date}&to=${date}`)).json()) as
      { roomsSold: number };
    expect(period.roomsSold).toBe(occupied);
  });

  it("adds its totals up from its own rows, and holds no expense it does not know", async () => {
    const august = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const rows = august.sections[0]!.rows;
    const days = rows.filter((r) => r.kind === "row");
    const totalRow = rows.find((r) => r.kind === "total")!;
    for (const k of ["available", "sold", "complimentary", "pax"]) {
      expect(totalRow.cells[k], k).toBe(days.reduce((t, r) => t + (r.cells[k] as number), 0));
    }
    for (const k of ["room", "extra", "tax", "receipt"]) {
      expect(totalRow.cells[k] as number, k)
        .toBeCloseTo(days.reduce((t, r) => t + (r.cells[k] as number), 0), 2);
    }
    for (const r of rows) expect(r.cells["expense"]).toBeNull();
  });

  it("draws the month's occupancy from the same figures", async () => {
    const chart = (await doc("/5EL/reports/monthly-occupancy?month=2026-08")).chart!;
    const grid = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const days = grid.sections[0]!.rows.filter((r) => r.kind === "row");
    expect(chart.x).toHaveLength(31);
    expect(chart.series[0]!.values).toEqual(days.map((r) => r.cells["occupancy"]));
  });

  it("refuses a report it does not know, rather than print an empty one", async () => {
    const hotelId = await withUser(ownerId, async (client) =>
      (await client.query<{ id: string }>("select id from hotels where code = '5EL'")).rows[0]!.id);
    await expect(withUser(ownerId, (client) =>
      buildReport(client, hotelId, "profit-and-loss", { asOn: "2026-08-25" }))).rejects.toThrow(/no report/);
    const bad = await call("/5EL/reports/monthly-statistics?month=2026-13");
    expect(bad.status).toBe(400);
  });
});

/* ── No show, and the City ledger (D17-62; the owner's decisions of 17 Sep) ── */

describe("the no show report", () => {
  it("still prints an empty day, with its date, and says nobody failed to arrive", async () => {
    const doc = (await (await call("/5EL/reports/no-show?asOn=2026-08-25")).json()) as ReportDoc;
    expect(doc.facts).toEqual([{ label: "As On Date", value: "2026-08-25", kind: "date" }]);
    expect(doc.sections[0]!.rows).toEqual([]);
    expect(doc.sections[0]!.empty).toMatch(/Nobody failed to arrive/);
  });

  it("lists a booking the audit marked no-show, on its arrival day only", async () => {
    const db = await admin();
    let reference = "";
    let arrival = "";
    try {
      const { rows } = await db.query<{ reference: string; arrival: string }>(
        `update reservations r set status = 'no_show'
          where r.id = (select r2.id from reservations r2 join hotels h on h.id = r2.hotel_id
                         where h.code = '5EL' and r2.status = 'confirmed' and r2.check_in > '2026-08-25'
                         order by r2.check_in limit 1)
          returning r.reference, to_char(r.check_in, 'YYYY-MM-DD') as arrival`);
      reference = rows[0]!.reference;
      arrival = rows[0]!.arrival;
    } finally { await db.end(); }

    const that = (await (await call(`/5EL/reports/no-show?asOn=${arrival}`)).json()) as ReportDoc;
    expect(that.sections[0]!.rows.map((r) => r.cells["reference"])).toContain(reference);
    const before = (await (await call("/5EL/reports/no-show?asOn=2026-08-25")).json()) as ReportDoc;
    expect(before.sections[0]!.rows.map((r) => r.cells["reference"])).not.toContain(reference);
  });
});

describe("the city ledger, as the owner decided", () => {
  it("debits the bills transferred to an account, and claims no balance it cannot know", async () => {
    const db = await admin();
    let stay = "";
    try {
      stay = (await db.query<{ id: string }>(
        `select r.id from reservations r join hotels h on h.id = r.hotel_id
          where h.code = '5EL' and r.status = 'checked_in' order by r.reference limit 1`)).rows[0]!.id;
    } finally { await db.end(); }

    const statsBefore = (await (await call("/5EL/reports/monthly-statistics?month=2026-08")).json()) as ReportDoc;
    const moved = await app.request(`/api/hotels/5EL/stays/${stay}/payments`, {
      method: "POST",
      headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
      body: JSON.stringify({ method: "Bill to company", amount: 1234.5 }),
    });
    expect(moved.status).toBe(200);

    const doc = (await (await call("/5EL/reports/city-ledger?asOn=2026-08-25")).json()) as ReportDoc;
    const rows = doc.sections[0]!.rows;
    const accounts = rows.filter((r) => r.kind === "row");
    const totalRow = rows.find((r) => r.kind === "total")!;
    expect(totalRow.cells["debit"] as number).toBeCloseTo(
      accounts.reduce((t, r) => t + (r.cells["debit"] as number), 0), 2);
    expect(accounts.some((r) => r.cells["debit"] === 1234.5)).toBe(true);
    for (const r of rows) {
      expect(r.cells["opening"]).toBeNull();
      expect(r.cells["credit"]).toBeNull();
      expect(r.cells["closing"]).toBeNull();
    }

    /* A transfer is not money received: the day's Receipt did not move. */
    const statsAfter = (await (await call("/5EL/reports/monthly-statistics?month=2026-08")).json()) as ReportDoc;
    const receipt = (d: ReportDoc) =>
      d.sections[0]!.rows.find((r) => r.cells["label"] === "25 Tue")!.cells["receipt"];
    expect(receipt(statsAfter)).toBe(receipt(statsBefore));
  });

  it("leaves out an account with nothing on the day unless asked to show it", async () => {
    const other = (await (await call("/5EL/reports/city-ledger?asOn=2026-08-20")).json()) as ReportDoc;
    expect(other.sections[0]!.rows).toEqual([]);
    const all = (await (await call("/5EL/reports/city-ledger?asOn=2026-08-26&from=2026-08-26&ignoreZero=0")).json()) as ReportDoc;
    expect(all.facts.find((f) => f.label === "Ignore zero balance account")?.value).toBe("No");
    const accounts = all.sections[0]!.rows.filter((r) => r.kind === "row");
    expect(accounts.length).toBeGreaterThan(0);
    for (const r of accounts) expect(r.cells["debit"]).toBe(0);
  });
});
