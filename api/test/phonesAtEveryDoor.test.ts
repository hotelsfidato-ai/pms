import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   X-2 · AN IMPOSSIBLE PHONE IS REFUSED WHERE A PERSON TYPES IT

   The QA of 28 September saved "abc" and "not-an-email" on the walk-in,
   New booking, People > Edit, the till's "This order", the banquet's
   telephone and Form III's phone in India. The walk-in, New booking,
   Edit guest and Form III have their own tests; these are the other three
   doors, each asking validate.ts (the owner's 21 September phone rule).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let hotelId = "";
let staffId = "";
let banquetBefore: boolean | null = null;

const call = (method: string, path: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;

beforeAll(async () => {
  [{ id: hotelId }] = await sql<{ id: string }>("select id::text from hotels where code = '5EL'") as [{ id: string }];
  [{ id: staffId }] = await sql<{ id: string }>(
    "select id::text from staff where email = 'agra@fidato.in'") as [{ id: string }];
  banquetBefore = (await sql<{ on: boolean }>(
    "select is_enabled as on from hotel_modules where hotel_id = $1 and module = 'banquet'", [hotelId]))[0]?.on ?? null;
  await sql(`insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'banquet', true)
             on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);
});

afterAll(async () => {
  if (banquetBefore === null) {
    await sql("delete from hotel_modules where hotel_id = $1 and module = 'banquet'", [hotelId]);
  } else {
    await sql("update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'banquet'",
      [hotelId, banquetBefore]);
  }
  await closePool();
});

describe("X-2 · the phone on the other three doors", () => {
  it("People > Edit refuses a phone that is not one (AD-3)", async () => {
    const before = await sql("select phone from staff where id = $1", [staffId]);
    const res = await call("PATCH", `/api/admin/staff/${staffId}`, { phone: "abc" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/not a phone number/);
    expect(await sql("select phone from staff where id = $1", [staffId])).toEqual(before);
  });

  it("the till's order refuses one", async () => {
    const res = await call("PATCH", `/api/hotels/5EL/till/orders/${randomUUID()}`, { customerPhone: "abc" });
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/not a phone number/);
  });

  it("a banquet enquiry refuses one, and a bad email", async () => {
    const enquiry = {
      venueId: randomUUID(), title: "X-2 test", hostName: "X-2 host",
      startsAt: "2031-01-10T10:00", endsAt: "2031-01-10T14:00",
    };
    const phone = await call("POST", "/api/hotels/5EL/banquet/events", { ...enquiry, hostPhone: "abc" });
    expect(phone.status).toBe(409);
    expect(await reasonOf(phone)).toMatch(/not a phone number/);
    const email = await call("POST", "/api/hotels/5EL/banquet/events",
      { ...enquiry, hostPhone: "9822012345", hostEmail: "not-an-email" });
    expect(await reasonOf(email)).toMatch(/not an email address/);
  });
});
