import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ROLES } from "../../../src/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LEDGER NAMES IN A HOTEL'S TALLY (the owner's D27-382)

   "A small page per hotel where the Accountant types each ledger name
   exactly as in their Tally; ... no name is ever invented."

   Everything here puts back what it typed: the names are setup, so one
   left behind would change every later file's answer.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerId: string;
let deskId: string;
let hotelId: string;

type Answer = {
  ledgers: { key: string; label: string; what: string; name: string | null }[];
  missing: string[];
};

const call = (method: string, staff: string, body?: unknown) =>
  app.request("/api/hotels/5EL/accounting/tally-ledgers", {
    method,
    headers: { "x-dev-staff-id": staff, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const read = async () => (await (await call("GET", ownerId)).json()) as Answer;
const keys = (a: Answer) => a.ledgers.map((l) => l.key);
const nameOf = (a: Answer, key: string) => a.ledgers.find((l) => l.key === key)?.name;

beforeAll(async () => {
  const { rows } = await sql(
    "select id::text, email from staff where email in ('owner@fidato.in','agra@fidato.in')");
  ownerId = rows.find((r) => r.email === "owner@fidato.in")!.id;
  deskId = rows.find((r) => r.email === "agra@fidato.in")!.id;
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0]!.id;
});

afterEach(async () => {
  await sql("delete from tally_ledger_names where hotel_id = $1", [hotelId]);
});

afterAll(async () => { await closePool(); });

describe("no name is ever invented", () => {
  it("starts every ledger blank, and names each one as missing", async () => {
    const a = await read();
    expect(a.ledgers.length).toBeGreaterThan(8);
    expect(a.ledgers.every((l) => l.name === null), "no default").toBe(true);
    expect(a.missing).toEqual(a.ledgers.map((l) => l.label));
  });

  it("asks for the ledgers a voucher posts to", async () => {
    const k = keys(await read());
    for (const key of ["room", "food", "other", "restaurant", "cgst", "sgst", "discount",
                       "round_off", "guests", "companies", "cash", "card", "upi"]) {
      expect(k, key).toContain(key);
    }
    expect(k, "a hotel's supply is intra-state: never IGST").not.toContain("igst");
    expect(k, "a bill to a company is What companies owe, not a way of paying").not.toContain("city_ledger");
  });
});

describe("the list follows how the hotel is set up", () => {
  const module = (on: boolean) => sql(
    `insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'alcohol', $2)
     on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`, [hotelId, on]);

  it("asks for alcohol and VAT only where the hotel serves alcohol (D21-91)", async () => {
    const { rows } = await sql(
      "select is_enabled from hotel_modules where hotel_id = $1 and module = 'alcohol'", [hotelId]);
    try {
      await module(false);
      const off = keys(await read());
      expect(off).not.toContain("alcohol");
      expect(off).not.toContain("vat");
      await module(true);
      const on = keys(await read());
      expect(on).toContain("alcohol");
      expect(on).toContain("vat");
    } finally {
      if (rows[0]) await module(rows[0].is_enabled as boolean);
      else await sql("delete from hotel_modules where hotel_id = $1 and module = 'alcohol'", [hotelId]);
    }
  });

  it("asks for the owner's allowance only where it is set", async () => {
    const { rows } = await sql("select owner_allowance_monthly from hotels where id = $1", [hotelId]);
    try {
      await sql("update hotels set owner_allowance_monthly = null where id = $1", [hotelId]);
      expect(keys(await read())).not.toContain("allowance");
      await sql("update hotels set owner_allowance_monthly = 5000 where id = $1", [hotelId]);
      expect(keys(await read())).toContain("allowance");
    } finally {
      await sql("update hotels set owner_allowance_monthly = $2 where id = $1",
        [hotelId, rows[0]!.owner_allowance_monthly]);
    }
  });

  it("asks for each other way of paying the hotel uses, and not one it does not", async () => {
    const kind = "wallet";
    expect(keys(await read())).not.toContain(kind);
    const { rows: [made] } = await sql(
      `insert into payment_methods (hotel_id, label, kind) values ($1, 'ACC test wallet', $2) returning id`,
      [hotelId, kind]);
    try {
      const a = await read();
      expect(keys(a)).toContain(kind);
      expect(a.missing).toContain("Wallet");
    } finally {
      await sql("delete from payment_methods where id = $1", [made!.id]);
    }
  });
});

describe("a name is kept as typed", () => {
  it("trims the two ends and keeps the spelling and the case", async () => {
    const r = await call("PUT", ownerId, { names: { room: "  ROOM rent  &  Guests' STAY\t" } });
    expect(r.status, await r.clone().text()).toBe(200);
    const a = (await r.json()) as Answer;
    expect(nameOf(a, "room")).toBe("ROOM rent  &  Guests' STAY");
    expect(a.missing).not.toContain("Room rent");
  });

  it("a name cleared goes back to blank, and the ledger is missing again", async () => {
    await call("PUT", ownerId, { names: { room: "Room rent A/c" } });
    const a = (await (await call("PUT", ownerId, { names: { room: "   " } })).json()) as Answer;
    expect(nameOf(a, "room")).toBeNull();
    expect(a.missing).toContain("Room rent");
    expect((await sql("select count(*)::int as n from tally_ledger_names where hotel_id = $1", [hotelId])).rows[0]!.n)
      .toBe(0);
  });

  it("changes only the names sent", async () => {
    await call("PUT", ownerId, { names: { room: "Room A/c", cgst: "CGST A/c" } });
    const a = (await (await call("PUT", ownerId, { names: { room: "Room Revenue" } })).json()) as Answer;
    expect(nameOf(a, "room")).toBe("Room Revenue");
    expect(nameOf(a, "cgst")).toBe("CGST A/c");
  });

  it("refuses, writing nothing, a ledger the hotel does not have, or a name that cannot be one", async () => {
    const bad = [
      { names: { igst: "IGST A/c" } },
      { names: { room: 7 } },
      { names: { room: "x".repeat(201) } },
      { names: { room: "a\u0001b" } },
      { nothing: true },
    ];
    for (const body of bad) {
      expect((await call("PUT", ownerId, { ...body })).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    /* One bad name in a good set saves none of them. */
    expect((await call("PUT", ownerId, { names: { room: "Room A/c", igst: "x" } })).status).toBe(400);
    expect(nameOf(await read(), "room")).toBeNull();
  });
});

describe("who may", () => {
  it("lets the accountant, the GM and an Admin read and change them, and nobody else", async () => {
    const as = async (role: string) => {
      const { rows: [s] } = await sql(
        `insert into staff (email, full_name) values ($1, $2)
         on conflict (email) do update set is_active = true returning id::text`,
        [`acc-${role}@fidato.in`, `Ledger test ${role}`]);
      await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
                 on conflict do nothing`, [s!.id, hotelId, role]);
      return s!.id as string;
    };
    const made: string[] = [];
    try {
      for (const role of ["finance", "gm", "admin"]) {
        const id = await as(role); made.push(id);
        expect((await call("GET", id)).status, `${role} reads`).toBe(200);
        expect((await call("PUT", id, { names: { room: `By ${role}` } })).status, `${role} changes`).toBe(200);
      }
      /* `automation` is a service account's, never a person's at a hotel. */
      for (const role of ROLES.filter((r) => !["owner", "admin", "gm", "finance", "automation"].includes(r))) {
        const id = await as(role); made.push(id);
        expect((await call("GET", id)).status, `${role} reads`).toBe(403);
        const before = nameOf(await read(), "room");
        const r = await call("PUT", id, { names: { room: "Not mine" } });
        expect(r.status, `${role} changes`).toBe(403);
        expect(nameOf(await read(), "room"), `${role} wrote nothing`).toBe(before);
      }
    } finally {
      await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [made]);
      await sql("update staff set is_active = false where id = any($1::uuid[])", [made]);
    }
  });

  it("refuses a clerk with no place at the hotel, reading or writing", async () => {
    expect((await call("GET", deskId)).status).toBe(403);
    expect((await call("PUT", deskId, { names: { room: "Not mine" } })).status).toBe(403);
    expect(nameOf(await read(), "room")).toBeNull();
  });
});
