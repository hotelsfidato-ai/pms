import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/* ══════════════════════════════════════════════════════════════════
   ADDING SOMEBODY NEW, AS A GM OR A HOTEL'S ADMIN (ADM-6, D22-3, D23-2)

   The route wrote the person with one `insert … on conflict do update …
   returning`, and both halves ask staff's READ policies about the new
   row - which a GM or a hotel's Admin cannot read until it is rostered.
   So adding somebody new failed, after the sign-in account was made.
   The other suites stop at the account (no Firebase here); this one
   stands in for it, so the route runs on to the rows.
   ══════════════════════════════════════════════════════════════════ */

vi.mock("../../../src/identity.ts", async (original) => ({
  ...(await original<typeof import("../../../src/identity.ts")>()),
  ensureAccount: async (email: string) => ({ uid: `test-uid-${email}`, existed: false }),
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

const RUN = Date.now();
const made: string[] = [];
let gmId: string;
let adminId: string;

const add = (by: string, email: string, role: string) =>
  app.request("/api/admin/staff", {
    method: "POST",
    headers: { "x-dev-staff-id": by, "content-type": "application/json" },
    body: JSON.stringify({
      email, name: `ADM6 ${role}`, password: "a-real-password", hotelCode: "AGR", role,
    }),
  });

const rosteredAs = async (email: string) => (await sql(
  `select sh.role from staff s
     join staff_hotels sh on sh.staff_id = s.id
     join hotels h on h.id = sh.hotel_id and h.code = 'AGR'
    where s.email = $1 and s.is_active`, [email])).rows.map((r) => r.role as string);

beforeAll(async () => {
  const at = async (email: string, role: string) => {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [email, `ADM6 ${role}`, `test-uid-${email}`])).rows[0].id as string;
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = 'AGR'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [id, role]);
    made.push(id);
    return id;
  };
  gmId = await at("adm6-gm@fidato.in", "gm");
  adminId = await at("adm6-admin@fidato.in", "admin");
});

afterAll(async () => {
  const ids = (await sql("select id::text from staff where email like $1", [`adm6-%-${RUN}@fidato.in`]))
    .rows.map((r) => r.id as string);
  await sql("delete from staff_hotels where staff_id = any($1)", [[...made, ...ids]]);
  await sql("update staff set is_active = false where id = any($1)", [[...made, ...ids]]);
  await closePool();
});

describe("adding somebody new at their own hotel (ADM-6)", () => {
  it("lets the GM add a new person, and they are rostered there", async () => {
    const email = `adm6-new-${RUN}@fidato.in`;
    const res = await add(gmId, email, "front_desk");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { existed: boolean }).existed).toBe(false);
    expect(await rosteredAs(email)).toEqual(["front_desk"]);
  });

  it("lets a hotel's Admin add a new person as Admin there (D23-2)", async () => {
    const email = `adm6-newadmin-${RUN}@fidato.in`;
    const res = await add(adminId, email, "admin");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await rosteredAs(email)).toEqual(["admin"]);
  });

  it("brings back somebody already there rather than adding them twice", async () => {
    const email = `adm6-new-${RUN}@fidato.in`;
    const before = (await sql("select id::text from staff where email = $1", [email])).rows[0].id;
    const res = await add(gmId, email, "housekeeping");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { id: string; existed: boolean };
    expect(body).toMatchObject({ id: before, existed: true });
    expect(await rosteredAs(email)).toEqual(["housekeeping"]);
  });
});
