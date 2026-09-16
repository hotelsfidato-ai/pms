import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { PLACE_KEEPERS } from "../src/routes/places.ts";
import { ASSIGNABLE_ROLES } from "../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   PLACES AND SUPPLIERS — api/src/routes/places.ts

   The door 094 lacked: nothing could add a place or a supplier, so no
   property had a store. Who may change them is the owner, an administrator
   and the GM (the roles the owner's table gives everything on stock and
   equipment); anyone rostered may read.

   EVERY ROLE IS TRIED, because a file that proves the GM can add a place
   passes just as well when the chef can. A refusal must leave nothing.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "PLACESTEST";
const person = new Map<string, string>();   // role → firebase uid
let hotelId: string;

const as = (uid: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": uid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const clear = async () => {
  await sql("delete from locations where name like $1", [`${TAG}%`]);
  await sql("delete from suppliers where name like $1", [`${TAG}%`]);
};

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  for (const role of ASSIGNABLE_ROLES) {
    const uid = `test-uid-places-${role}`;
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true, firebase_uid = excluded.firebase_uid
       returning id::text`,
      [`places-${role}@fidato.in`, `${TAG} ${role}`, uid]);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
      [rows[0].id, hotelId, role]);
    person.set(role, uid);
  }
  await clear();
});

afterAll(async () => {
  await clear();
  const uids = [...person.values()];
  await sql(`delete from staff_hotels where staff_id in
               (select id from staff where firebase_uid = any($1))`, [uids]);
  await sql("update staff set is_active = false where firebase_uid = any($1)", [uids]);
  await closePool();
});

describe("who may change places and suppliers", () => {
  it("is the owner, an administrator and the GM", () => {
    expect([...PLACE_KEEPERS].sort()).toEqual(["admin", "gm", "owner"]);
  });

  for (const role of ASSIGNABLE_ROLES) {
    const may = PLACE_KEEPERS.includes(role);

    it(`${may ? "lets" : "refuses"} ${role} ${may ? "add" : "adding"} a place and a supplier`, async () => {
      await clear();
      const uid = person.get(role)!;

      const read = await as(uid, "/5EL/places");
      expect(read.status, "anybody rostered may read").toBe(200);
      expect(((await read.json()) as { mayChange: boolean }).mayChange).toBe(may);

      const place = await as(uid, "/5EL/places", "POST", { name: `${TAG} Main store`, kind: "store" });
      const supplier = await as(uid, "/5EL/suppliers", "POST", { name: `${TAG} Kirana Bros` });
      const written = Number((await sql(
        `select (select count(*) from locations where name like $1)
              + (select count(*) from suppliers where name like $1) as n`, [`${TAG}%`])).rows[0].n);

      if (may) {
        expect(place.status, await place.clone().text()).toBe(200);
        expect(supplier.status, await supplier.clone().text()).toBe(200);
        expect(written).toBe(2);
      } else {
        expect(place.status).toBe(403);
        expect(supplier.status).toBe(403);
        expect(((await place.json()) as { reason: string }).reason).toContain("general manager");
        expect(written, "a refusal leaves nothing behind").toBe(0);
      }
    });
  }
});

describe("adding and changing, in words a person can act on", () => {
  const gm = () => person.get("gm")!;

  it("refuses a place with no kind, a second place with the same name, and a malformed GSTIN", async () => {
    await clear();
    const noKind = await as(gm(), "/5EL/places", "POST", { name: `${TAG} Lobby` });
    expect(noKind.status).toBe(409);
    expect(((await noKind.json()) as { reason: string }).reason).toBe("Choose what kind of place this is.");

    expect((await as(gm(), "/5EL/places", "POST", { name: `${TAG} Lobby`, kind: "public_area" })).status).toBe(200);
    const twice = await as(gm(), "/5EL/places", "POST", { name: `${TAG} Lobby`, kind: "office" });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as { reason: string }).reason).toContain("already a place called");

    const gst = await as(gm(), "/5EL/suppliers", "POST", { name: `${TAG} Oil Co`, gstin: "NOT-A-GSTIN" });
    expect(gst.status).toBe(409);
    expect(((await gst.json()) as { reason: string }).reason).toContain("15 characters");
  });

  it("takes a GSTIN typed with spaces and small letters as printed", async () => {
    await clear();
    const res = await as(gm(), "/5EL/suppliers", "POST",
      { name: `${TAG} Solapur Electricals`, gstin: "27abcde1234f1z5 " });
    expect(res.status, await res.clone().text()).toBe(200);
    const row = (await sql("select gstin from suppliers where name = $1", [`${TAG} Solapur Electricals`])).rows[0];
    expect(row.gstin).toBe("27ABCDE1234F1Z5");
  });

  it("switches a place off and on — and it is never deleted", async () => {
    await clear();
    const made = await as(gm(), "/5EL/places", "POST", { name: `${TAG} Bar store`, kind: "store" });
    const { id } = (await made.json()) as { id: string };

    const off = await as(gm(), `/5EL/places/${id}`, "PUT", { name: `${TAG} Bar store`, kind: "store", isActive: false });
    expect(off.status).toBe(200);
    const list = (await (await as(gm(), "/5EL/places")).json()) as { places: { id: string; isActive: boolean }[] };
    expect(list.places.find((p) => p.id === id)?.isActive).toBe(false);

    const del = await as(gm(), `/5EL/places/${id}`, "DELETE");
    expect(del.status, "there is no delete").toBe(404);
    expect((await sql("select count(*)::int as n from locations where id = $1", [id])).rows[0].n).toBe(1);
  });
});
