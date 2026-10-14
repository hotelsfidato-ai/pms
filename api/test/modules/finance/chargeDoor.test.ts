import { describe, it, expect, afterAll } from "vitest";
import { withSession } from "../../../src/auth.ts";
import { closePool } from "../../../src/db.ts";
import { postCharge } from "../../../src/modules/finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DOOR A CHARGE REACHES A ROOM BILL THROUGH

   Opened 18 September for the laundry and the spa, which both owe D18-7:
   a charge goes straight onto the room bill as its own line, not through
   the restaurant till and not by writing `folio_postings`.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved a charge lands
   would pass with the door wide open. The reason the checks live behind
   the door rather than in front of the HTTP route is that a service
   calls the function and never sees the route — so every one of them is
   tried HERE, from the function, exactly as another service calls it.

   The last of them is the one this was written for: `app.gst_rate`
   RAISES where a property has set no rule for a kind of supply, and a
   raise aborts the transaction. A property that has not set its spa rate
   is an ordinary state, not a crash, so the door asks first and refuses
   with the sentence that says what to do. Without that check this test's
   last case takes the whole transaction down with it.

   Nothing here is left behind: every posting it makes is reversed by the
   append-only ledger's own rule, in a transaction that is rolled back.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

afterAll(async () => { await closePool(); });

/** One in-house stay at the demo property, and the property's own id. */
async function aStayInHouse() {
  const { rows } = await sql(
    `select r.id::text as stay, h.id::text as hotel
       from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'checked_in'
      limit 1`);
  return rows[0] as { stay: string; hotel: string } | undefined;
}

/* Every call runs inside the owner's session and is UNDONE, so this file
   can run in any order beside every other and leave the demo property
   exactly as it found it (MEMORY 292: a test suite left ₹2,734.50 on a
   real property's bills). */
const attempt = <T>(fn: (client: Parameters<Parameters<typeof withSession>[1]>[0]) => Promise<T>) =>
  withSession("dev-owner", async (client) => {
    try {
      return await fn(client);
    } finally {
      await client.query("rollback");
    }
  });

describe("the charge door", () => {
  it("posts a laundry charge onto the stay's own bill", async () => {
    const stay = await aStayInHouse();
    expect(stay, "the demo has an in-house stay").toBeTruthy();

    const out = await attempt((client) =>
      postCharge(client, stay!.hotel, stay!.stay, {
        description: "Laundry · 3 shirts, press",
        amount: 180,
        category: "Laundry",
      }));
    expect(out!.ok, out!.ok ? "" : (out as { reason: string }).reason).toBe(true);
  });

  /* The review of 1 October: "Payment" and "Refund" were charge headings, so
     a direct call wrote a payment line with no payment record and no drawer,
     and a refund with GST on it. Since D27-315 B a refund has its own step
     on the bill (219), and the refusal sends the desk there: reversing the
     payment records no money going back. */
  it("refuses a payment or a refund as a charge", async () => {
    const stay = await aStayInHouse();
    const as = (category: string) => attempt((client) =>
      postCharge(client, stay!.hotel, stay!.stay, { description: category, amount: 500, category }));
    expect(await as("Payment")).toEqual({ ok: false, reason: "Take a payment through Payments." });
    expect(await as("Refund"))
      .toEqual({ ok: false, reason: "A refund is not a charge. Give it with Refund on the bill." });
  });

  it("refuses a charge with no words on it", async () => {
    const stay = await aStayInHouse();
    const out = await attempt((client) =>
      postCharge(client, stay!.hotel, stay!.stay, { description: "   ", amount: 180 }));
    expect(out!.ok).toBe(false);
    expect((out as { reason: string }).reason).toContain("description");
  });

  it("refuses a charge of nothing", async () => {
    const stay = await aStayInHouse();
    const out = await attempt((client) =>
      postCharge(client, stay!.hotel, stay!.stay, { description: "Laundry", amount: 0 }));
    expect(out!.ok).toBe(false);
    expect((out as { reason: string }).reason).toContain("not a charge");
  });

  it("refuses a stay that does not exist", async () => {
    const stay = await aStayInHouse();
    const out = await attempt((client) =>
      postCharge(client, stay!.hotel, "00000000-0000-0000-0000-000000000000",
        { description: "Laundry", amount: 180 }));
    expect(out!.ok).toBe(false);
    expect((out as { reason: string }).reason).toContain("not found");
  });

  it("refuses a bill that has been closed", async () => {
    const { rows } = await sql(
      `select r.id::text as stay, h.id::text as hotel
         from reservations r join hotels h on h.id = r.hotel_id
        where h.code = '5EL' and r.status = 'checked_out'
        limit 1`);
    if (!rows[0]) return; /* no departed stay in the demo: nothing to prove */
    const out = await attempt((client) =>
      postCharge(client, rows[0].hotel, rows[0].stay,
        { description: "Laundry", amount: 180 }));
    expect(out!.ok).toBe(false);
    expect((out as { reason: string }).reason).toContain("closed");
  });

  /* ⚠ THE ONE THIS FILE WAS WRITTEN FOR. Asked with a kind of supply the
     property has set no rule for. Without the door's own check,
     `app.gst_rate` raises and the transaction is aborted — and a refusal
     after an abort is a commit of nothing (MEMORY 243). With it, the
     answer is a sentence naming what to do, and the session is still
     usable afterwards, which the second half proves. */
  it("refuses — and does not abort the transaction — where no tax rule covers the kind", async () => {
    const stay = await aStayInHouse();
    const out = await attempt(async (client) => {
      const refused = await postCharge(client, stay!.hotel, stay!.stay, {
        description: "A supply nobody has set a rate for",
        amount: 500,
        taxKind: "no_rule_for_this_kind_of_supply",
      });
      /* The session survived the refusal: a transaction that had been
         aborted answers 25P02 to anything at all. */
      const { rows } = await client.query<{ alive: number }>("select 1 as alive");
      return { refused, alive: rows[0]?.alive };
    });

    expect(out!.refused.ok).toBe(false);
    expect((out!.refused as { reason: string }).reason).toContain("Settings → Taxes and billing");
    expect(out!.alive, "the transaction is still usable after the refusal").toBe(1);
  });

  it("leaves the property's bills exactly as it found them", async () => {
    const { rows } = await sql(
      `select count(*)::int as n from folio_postings fp
         join hotels h on h.id = fp.hotel_id
        where h.code = '5EL' and fp.description like '%3 shirts, press%'`);
    expect(rows[0].n, "every posting this file made was rolled back").toBe(0);
  });
});
