import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS STOPS PRINTING A TAX NOBODY CHARGES — ADM-2, D17-37

   `GET /:code/settings` printed `hotels.cgst_rate` and `sgst_rate` as
   "2.5%" and "2.5%", "editable at Stage 8" — the flat pair migration 067
   replaced with `tax_rules` — and followed every GSTIN with "— demo, not
   a real GSTIN". The owner, 17 September: show the tax actually used,
   "-" where nothing is set.

   The rules themselves are finance's (`GET /:code/tax`); the screen asks
   finance for them (src/modules/admin/components/TaxInUse.tsx). What the
   server owes is to stop sending the old figures, to say where the tax
   goes, and to print the GSTIN as it is stored.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";

interface Group { title: string; note?: string; taxInUse?: boolean; rows: { label: string; value: string }[] }

let ownerId: string;
let gmId: string;
let clerkId: string;
let storedGstin: string | null;

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`adm2-${key}@fidato.in`, `ADM2TEST ${key}`, `test-uid-adm2-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  return id;
};

const get = async (staffId: string, path: string) =>
  app.request(`/api/hotels/${HOTEL}${path}`, { headers: { "x-dev-staff-id": staffId } });

const settingsAs = async (staffId: string) => {
  const res = await get(staffId, "/settings");
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Group[];
};

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  gmId = await person("gm", "gm");
  clerkId = await person("clerk", "front_desk");
  storedGstin = (await sql(
    "select gstin from hotels where code = $1", [HOTEL])).rows[0].gstin as string | null;
});

afterAll(async () => {
  await sql("update hotels set gstin = $1 where code = $2", [storedGstin, HOTEL]);
  await sql(
    `delete from staff_hotels where staff_id in
       (select id from staff where email like 'adm2-%@fidato.in')`);
  await sql("update staff set is_active = false where email like 'adm2-%@fidato.in'");
  await closePool();
});

describe("the old flat tax is gone", () => {
  it("no CGST or SGST row, nothing 'editable at Stage 8'", async () => {
    const groups = await settingsAs(ownerId);
    const text = JSON.stringify(groups);
    expect(text).not.toMatch(/CGST|SGST/);
    expect(text).not.toMatch(/Stage 8|editableAt/);
  });

  it("the tax group says the tax goes there, and where it is set", async () => {
    const groups = await settingsAs(ownerId);
    const tax = groups.find((g) => g.taxInUse);
    expect(tax, "no group carries the tax in use").toBeDefined();
    expect(tax!.title).toBe("Tax and billing");
    expect(tax!.note).toMatch(/Configuration/);
  });
});

describe("the GSTIN, as it is stored", () => {
  const gstinRow = (groups: Group[]) =>
    groups.flatMap((g) => g.rows).find((r) => r.label === "GSTIN")!.value;

  it("a set GSTIN is printed exactly, with no 'demo' after it", async () => {
    await sql("update hotels set gstin = '27AAGCF5655F1ZI' where code = $1", [HOTEL]);
    expect(gstinRow(await settingsAs(ownerId))).toBe("27AAGCF5655F1ZI");
  });

  it("an unset GSTIN is '-', not a dash followed by a disclaimer", async () => {
    await sql("update hotels set gstin = null where code = $1", [HOTEL]);
    expect(gstinRow(await settingsAs(ownerId))).toBe("-");
  });
});

describe("the readers the screens rely on answer the people who open them", () => {
  it("the GM reads Settings (D17-36)", async () => {
    await settingsAs(gmId);
  });

  it.each([
    ["the GM", () => gmId],
    ["reception", () => clerkId],
  ])("finance's tax rules answer %s, for the Properties cards", async (_who, id) => {
    const res = await get(id(), "/tax");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { kinds: { kind: string }[] };
    expect(body.kinds.map((k) => k.kind)).toEqual(["room", "restaurant", "bar", "banquet", "spa", "laundry", "other"]);
  });
});
