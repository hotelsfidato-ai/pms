import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { noteSignIn, isSignedOut, forgetSignedOutForTests } from "../../../src/signIns.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SIGN-IN HISTORY (D27-243 5.4, D27-245 Q-B)

   Written once per sign-in, whatever the number of requests; time and
   device shown to the owner (anybody) and an Admin (the people at their
   hotel); the network address kept and never sent; 90 days.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const RUN = Date.now();
const ADDRESS = "203.0.113.9";
const DEVICE = `TestBrowser/${RUN} (Windows NT 10.0)`;
let owner: string;
const ids: Record<string, string> = {};
const uid = (who: string) => `test-uid-si-${who}-${RUN}`;

const read = (by: string) =>
  app.request(`/api/admin/staff/${ids["clerk"]}/sign-ins`, { headers: { "x-dev-staff-id": by } });

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  for (const [who, code, role] of [
    ["clerk", "5EL", "front_desk"], ["admin", "5EL", "admin"],
    ["gm", "5EL", "gm"], ["elsewhere", "AGR", "admin"],
  ] as const) {
    ids[who] = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3) returning id::text`,
      [`si-${who}-${RUN}@fidato.in`, `SI ${who}`, uid(who)])).rows[0].id;
    await sql(`insert into staff_hotels (staff_id, hotel_id, role)
               select $1, id, $2 from hotels where code = $3`, [ids[who], role, code]);
  }
});

afterAll(async () => {
  const all = Object.values(ids);
  await sql("delete from sign_ins where staff_id = any($1::uuid[])", [all]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [all]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [all]);
  await closePool();
});

describe("a sign-in", () => {
  it("is written once, however many requests carry it, with its device and address", async () => {
    const headers = new Headers({ "user-agent": DEVICE, "x-forwarded-for": `${ADDRESS}, 10.0.0.1` });
    const signedIn = Math.floor(RUN / 1000);
    await noteSignIn(uid("clerk"), signedIn, headers);
    await noteSignIn(uid("clerk"), signedIn, headers);
    const { rows } = await sql(
      "select device, host(address) as address from sign_ins where staff_id = $1", [ids["clerk"]]);
    expect(rows).toEqual([{ device: DEVICE, address: ADDRESS }]);
  });

  it("is kept 90 days", async () => {
    await sql(`insert into sign_ins (staff_id, auth_time, at)
               values ($1, now() - interval '91 days', now() - interval '91 days')`, [ids["clerk"]]);
    await noteSignIn(uid("clerk"), Math.floor(RUN / 1000) + 60, new Headers());
    const { rows } = await sql(
      "select count(*)::int as n, min(at) > now() - interval '90 days' as recent from sign_ins where staff_id = $1",
      [ids["clerk"]]);
    expect(rows[0]).toEqual({ n: 2, recent: true });
  });
});

describe("who reads the history (Q-B)", () => {
  it("shows the owner and the hotel's Admin the time and device, never the address", async () => {
    for (const by of [owner, ids["admin"]!]) {
      const res = await read(by);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(DEVICE);
      expect(text).not.toContain(ADDRESS);
    }
  });

  it("is refused to the GM and to an Admin of another hotel", async () => {
    expect((await read(ids["gm"]!)).status).toBe(403);
    expect((await read(ids["elsewhere"]!)).status).toBe(403);
  });
});

/* D27-255: one device signed out, by the owner or the hotel's Admin. */
describe("signing out one device (P7)", () => {
  const A = Math.floor(RUN / 1000) + 600;
  const B = Math.floor(RUN / 1000) + 1200;
  type Row = { id: string; device: string | null; signedOutAt: string | null; signedOutBy: string | null };
  const rowsOf = async () => ((await (await read(owner)).json()) as { signIns: Row[] }).signIns;
  const signOut = (by: string, id: string) =>
    app.request(`/api/admin/sign-ins/${id}/sign-out`, { method: "POST", headers: { "x-dev-staff-id": by } });

  it("refuses that device's sign-in and no other, and says so on the list", async () => {
    await noteSignIn(uid("clerk"), A, new Headers({ "user-agent": "Device A" }));
    await noteSignIn(uid("clerk"), B, new Headers({ "user-agent": "Device B" }));
    const a = (await rowsOf()).find((r) => r.device === "Device A");
    expect(a?.signedOutAt).toBeNull();

    expect((await signOut(ids["gm"]!, a!.id)).status, "the GM").toBe(403);
    expect((await signOut(ids["elsewhere"]!, a!.id)).status, "an Admin of another hotel").toBe(403);
    expect((await signOut(ids["admin"]!, a!.id)).status, "the hotel's Admin").toBe(200);

    expect(await isSignedOut(uid("clerk"), A)).toBe(true);
    expect(await isSignedOut(uid("clerk"), B)).toBe(false);
    const after = (await rowsOf()).find((r) => r.id === a!.id)!;
    expect(after.signedOutAt).not.toBeNull();
    expect(after.signedOutBy).toBe("SI admin");
  });

  it("is remembered by a fresh server, from the database", async () => {
    forgetSignedOutForTests();
    expect(await isSignedOut(uid("clerk"), A)).toBe(true);
    expect(await isSignedOut(uid("clerk"), B)).toBe(false);
  });
});
