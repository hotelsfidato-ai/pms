import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A HOTEL'S OWN DETAILS (the owner's D27-213 and D27-214)

   A hotel's GM and Admin may edit their OWN hotel's details; until now
   only a group administrator could. The hotel's NAME stays the group
   owner's, like its code. Every change is recorded with who and when
   (the hotels_audit trigger). Another hotel's GM, and reception, change
   nothing.

   The hotel-level Admin is the case 168 fixed underneath: the write
   policy left that role out, so a save wrote nothing.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "HPROFILE";
const GSTIN = "09AAGCF5655F1ZI";

const people: Record<"gm" | "admin" | "desk" | "elsewhere", string> =
  { gm: "", admin: "", desk: "", elsewhere: "" };
let was: Record<string, unknown> = {};
let ownerId = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const patch = (who: string, body: unknown, code = "AGR") =>
  app.request(`/api/admin/hotels/${code}`, {
    method: "PATCH",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const stored = async () => (await sql<{
  name: string; phone: string | null; gstin: string | null; address_line: string | null;
}>("select name, phone, gstin, address_line from hotels where code = 'AGR'"))[0]!;

beforeAll(async () => {
  was = (await sql<Record<string, unknown>>(
    "select name, phone, gstin, address_line, city, state, email::text from hotels where code = 'AGR'"))[0]!;
  ownerId = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const at: [keyof typeof people, string, string][] = [
    ["gm", "AGR", "gm"], ["admin", "AGR", "admin"],
    ["desk", "AGR", "front_desk"], ["elsewhere", "PUN", "gm"],
  ];
  for (const [who, hotel, role] of at) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`hprofile-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $3 from hotels where code = $2",
      [row!.id, hotel, role]);
  }
});

afterAll(async () => {
  await sql(
    `update hotels set name = $1, phone = $2, gstin = $3, address_line = $4 where code = 'AGR'`,
    [was["name"], was["phone"], was["gstin"], was["address_line"]]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("a hotel's own details", () => {
  it("are saved by its GM, and the change is recorded under their name", async () => {
    const res = await patch(people.gm, {
      name: was["name"], addressLine: "1 Fort Road", phone: "0562 111 2222", gstin: GSTIN,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toMatchObject({
      address_line: "1 Fort Road", phone: "0562 111 2222", gstin: GSTIN,
    });
    /* The GSTIN prints on every invoice: who changed it, and when, is kept. */
    const log = await sql<{ n: string }>(
      `select count(*)::text as n from audit_log
        where table_name = 'hotels' and actor = $1 and after->>'gstin' = $2`,
      [people.gm, GSTIN]);
    expect(Number(log[0]!.n)).toBeGreaterThan(0);
  });

  it("are saved by its Admin - the save really writes (168)", async () => {
    const res = await patch(people.admin, { phone: "0562 333 4444" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stored()).phone).toBe("0562 333 4444");
  });

  it("keep their NAME for the group's owner: a GM renaming it is refused", async () => {
    const res = await patch(people.gm, { name: "Renamed By Its GM", phone: "0562 555 6666" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/name.*group/i);
    expect(await stored()).toMatchObject({ name: was["name"], phone: "0562 333 4444" });

    const owner = await patch(ownerId, { name: "Agra, by the owner" });
    expect(owner.status, await owner.clone().text()).toBe(200);
    expect((await stored()).name).toBe("Agra, by the owner");
  });

  it("are not another hotel's GM's to change", async () => {
    const before = await stored();
    const res = await patch(people.elsewhere, { phone: "0000" });
    expect([403, 404, 409]).toContain(res.status);
    expect(await stored()).toEqual(before);
  });

  it("nor reception's", async () => {
    const before = await stored();
    const res = await patch(people.desk, { phone: "0000" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("group administrator");
    expect(await stored()).toEqual(before);
  });
});
