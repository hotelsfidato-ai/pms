import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openDrawer } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   CASH ON A ROOM BILL IS TAKEN TO THE RUPEE (the owner's D27-317)

   The bill is credited with its exact amount; the cash taken is the
   nearest rupee and the difference is kept with the payment as its
   round-off, so the drawer the desk counts balances. UPI pays the exact
   amount, with no round-off. Everything is keyed and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";
let stay = "";
let putAway: () => Promise<void> = async () => {};
const keys = [randomUUID(), randomUUID(), randomUUID()];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const pay = (body: unknown, key: string) =>
  app.request(`/api/hotels/5EL/stays/${stay}/payments`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });

const line = async (key: string) => (await sql<{
  amount: string; description: string; round_off: string; method: string;
}>(
  `select fp.amount::text, fp.description, p.round_off::text, p.method
     from folio_postings fp join payments p on p.posting_id = fp.id
    where fp.idempotency_key = $1`, [key]))[0]!;

const expected = async () => Number((await sql<{ e: string }>(
  `select app.cashier_expected_cash(cs.id)::text as e from cashier_shifts cs
    where cs.staff_id = $1 and cs.closed_at is null
      and cs.hotel_id = (select id from hotels where code = '5EL')`, [owner]))[0]!.e);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  stay = (await sql<{ id: string }>(
    `select r.id::text from reservations r
       join folios f on f.reservation_id = r.id and f.status = 'open'
      where r.hotel_id = (select id from hotels where code = '5EL') and r.status = 'checked_in'
      limit 1`))[0]!.id;
  /* A fresh drawer of our own, so what it expects is only this file's cash. */
  await sql("delete from cashier_shifts where staff_id = $1 and closed_at is null", [owner]);
  putAway = await openDrawer("5EL", owner);
});

afterAll(async () => {
  await putAway();
  await sql(`delete from payments where posting_id in
               (select id from folio_postings where idempotency_key = any($1::uuid[]))`, [keys]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("delete from folio_postings where idempotency_key = any($1::uuid[])", [keys]);
  } finally {
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
  await closePool();
});

describe("cash on a room bill", () => {
  it("credits the bill exactly and keeps the round-off down to the rupee", async () => {
    const res = await pay({ method: "Cash", amount: 123.37, heldAsCredit: true }, keys[0]!);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { data: { roundOff: number } }).data.roundOff).toBe(-0.37);
    const l = await line(keys[0]!);
    expect(Number(l.amount)).toBe(-123.37);
    expect(Number(l.round_off)).toBe(-0.37);
    expect(l.description).toBe("Received - Cash (₹123.00 taken, round-off -₹0.37)");
  });

  it("rounds up as well as down: at most ±0.50", async () => {
    const res = await pay({ method: "Cash", amount: 10.5, heldAsCredit: true }, keys[1]!);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(Number((await line(keys[1]!)).round_off)).toBe(0.5);
  });

  it("balances the drawer: it expects the rupees taken, not the paise billed", async () => {
    /* 123 + 11, on a float of 0. */
    expect(await expected()).toBe(134);
  });

  it("does not round UPI: the exact amount, no round-off", async () => {
    const res = await pay({ method: "UPI", amount: 50.63, heldAsCredit: true }, keys[2]!);
    expect(res.status, await res.clone().text()).toBe(200);
    const l = await line(keys[2]!);
    expect(Number(l.amount)).toBe(-50.63);
    expect(Number(l.round_off)).toBe(0);
    expect(l.description).toBe("Received - UPI");
    expect(await expected()).toBe(134);
  });
});
