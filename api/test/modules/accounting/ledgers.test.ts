import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ROLES } from "../../../src/permissions.ts";
import { ledgerNames } from "../../../src/modules/accounting/ledgers.ts";

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
const keys = (a: Pick<Answer, "ledgers">) => a.ledgers.map((l) => l.key);
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
  /* A new hotel in one rolled-back transaction: nothing another test file left
     behind can stand in for what is being asked here. */
  const onNewHotel = async (work: (c: pg.PoolClient, hotel: string) => Promise<void>) => {
    const pool = new pg.Pool({ connectionString: SUPER });
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.user_id', $1, true)", [ownerId]);
      const hotel = (await c.query<{ id: string }>(
        "select app.provision_property_unchecked('LDG', 'Ledger Test', 'Nowhere')::text as id")).rows[0]!.id;
      await work(c, hotel);
    } finally {
      await c.query("rollback");
      c.release();
      await pool.end();
    }
  };
  const list = async (c: pg.PoolClient, hotel: string) => keys(await ledgerNames(c, hotel));

  it("asks for alcohol and VAT only where the hotel serves alcohol (D21-91)", async () => {
    await onNewHotel(async (c, hotel) => {
      const alcohol = (on: boolean) => c.query(
        `insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'alcohol', $2)
         on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`, [hotel, on]);
      expect(await list(c, hotel)).not.toContain("alcohol");
      expect(await list(c, hotel)).not.toContain("vat");
      await alcohol(true);
      expect(await list(c, hotel)).toContain("alcohol");
      expect(await list(c, hotel)).toContain("vat");
      await alcohol(false);
      expect(await list(c, hotel)).not.toContain("alcohol");
    });
  });

  it("asks for the owner's allowance only where it is set", async () => {
    await onNewHotel(async (c, hotel) => {
      expect(await list(c, hotel)).not.toContain("allowance");
      await c.query("update hotels set owner_allowance_monthly = 5000 where id = $1", [hotel]);
      expect(await list(c, hotel)).toContain("allowance");
    });
  });

  it("asks for each other way of paying the hotel uses, and not one it does not", async () => {
    await onNewHotel(async (c, hotel) => {
      expect(await list(c, hotel)).not.toContain("wallet");
      await c.query("insert into payment_methods (hotel_id, label, kind) values ($1, 'A wallet', 'wallet')", [hotel]);
      const a = await ledgerNames(c, hotel);
      expect(keys(a)).toContain("wallet");
      expect(a.missing).toContain("Wallet");
    });
  });

  /* Sold, and since switched off: those days still have to be exported, so the
     form must still ask. Without this a hotel could never export them. */
  it("still asks for what the hotel has used and since switched off", async () => {
    await onNewHotel(async (c, hotel) => {
      const { rows: [o] } = await c.query<{ id: string }>(
        `with outlet as (
           insert into pos_outlets (hotel_id, code, name, staff_id, api_key_hash)
           values ($1, 'REST', 'Restaurant', $2, repeat('a', 64)) returning id)
         insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by, status)
         select $1, id, 'LDG-1', '2026-08-02', $2, 'open' from outlet returning id::text`, [hotel, ownerId]);
      await c.query(
        `insert into pos_order_lines (hotel_id, order_id, name, qty, unit_price, tax_rate, tax_scheme, added_by)
         values ($1, $2, 'A drink', 1, 100, 10, 'vat', $3)`, [hotel, o!.id, ownerId]);
      expect(await list(c, hotel)).toContain("alcohol");
      expect(await list(c, hotel)).toContain("vat");
    });
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
