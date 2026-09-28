import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/* ══════════════════════════════════════════════════════════════════
   LAST SEEN (QA AD-2)

   The Users list said "-" for everybody, including people signed in that
   day: nothing read a time. It reads Firebase's own record now. This suite
   has no Firebase, so a stand-in answers for one person and the server is
   told it has a service account.
   ══════════════════════════════════════════════════════════════════ */

process.env["FIREBASE_SERVICE_ACCOUNT"] = "{}";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    getUsers: async (ids: Array<{ uid: string }>) => ({
      users: ids.filter((i) => i.uid === "test-uid-ls-seen").map((i) => ({
        uid: i.uid,
        metadata: { lastRefreshTime: "Mon, 28 Sep 2026 10:00:00 GMT", lastSignInTime: null },
      })),
    }),
  }),
}));
vi.mock("../../../src/auth.ts", async (original) => ({
  ...(await original<typeof import("../../../src/auth.ts")>()),
  firebaseApp: () => ({}),
}));

const { app } = await import("../../../src/server.ts");
const { closePool } = await import("../../../src/db.ts");

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerId: string;
const made: string[] = [];

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  for (const key of ["seen", "never"]) {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`ls-${key}@fidato.in`, `LSTEST ${key}`, `test-uid-ls-${key}`])).rows[0].id as string;
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'front_desk' from hotels where code = '5EL'
       on conflict do nothing`, [id]);
    made.push(id);
  }
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = any($1)", [made]);
  await sql("update staff set is_active = false where id = any($1)", [made]);
  await closePool();
});

describe("the Users list's last seen (QA AD-2)", () => {
  it("gives Firebase's last-active time, and null for somebody never seen", async () => {
    const res = await app.request("/api/hotels/5EL/staff", { headers: { "x-dev-staff-id": ownerId } });
    const rows = (await res.json()) as Array<{ email: string; lastSeen: string | null }>;
    expect(rows.find((r) => r.email === "ls-seen@fidato.in")?.lastSeen).toBe("2026-09-28T10:00:00.000Z");
    expect(rows.find((r) => r.email === "ls-never@fidato.in")?.lastSeen).toBeNull();
  });
});
