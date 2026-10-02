import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

/* ══════════════════════════════════════════════════════════════════
   PASSWORDS BY ROLE (D27-243 5.3, D27-245)

   At least 10 characters for the owner, an Admin and a GM; 8 for
   everybody else. Somebody GIVEN one of those roles while holding a
   shorter password must set a 10-character one at their next sign-in.
   Firebase is stood in for, so the routes run on to the rows.
   ══════════════════════════════════════════════════════════════════ */

vi.mock("../../../src/identity.ts", async (original) => ({
  ...(await original<typeof import("../../../src/identity.ts")>()),
  ensureAccount: async (email: string) => ({ uid: `test-uid-${email}`, existed: false }),
  setAccountPassword: async () => {},
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
const NINE = "nine-char";
const TEN = "ten-chars!";
let owner: string;
let gm: string;
let desk: string;

const post = (by: string, path: string, body: unknown) =>
  app.request(`/api${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": by, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const reason = async (res: Response) => String((await res.json() as { reason?: string }).reason ?? "");

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  const at = async (email: string, role: string) => {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3) returning id::text`,
      [email, `PW ${role}`, `test-uid-${email}`])).rows[0].id as string;
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = 'AGR'`, [id, role]);
    return id;
  };
  gm = await at(`pw-gm-${RUN}@fidato.in`, "gm");
  desk = await at(`pw-desk-${RUN}@fidato.in`, "front_desk");
});

afterAll(async () => {
  await sql(
    `update staff set is_active = false where email like $1`, [`pw-%-${RUN}@fidato.in`]);
  await sql(
    `delete from staff_hotels where staff_id in (select id from staff where email like $1)`,
    [`pw-%-${RUN}@fidato.in`]);
  await closePool();
});

describe("a password's length follows the role (5.3)", () => {
  it("asks 10 characters of a new GM, and 8 of a new desk clerk", async () => {
    const add = (role: string, password: string) => post(owner, "/admin/staff", {
      email: `pw-new-${role}-${RUN}@fidato.in`, name: `PW new ${role}`,
      password, hotelCode: "AGR", role,
    });
    const refused = await add("gm", NINE);
    expect(refused.status).toBe(409);
    expect(await reason(refused)).toContain("10 characters");
    expect((await add("front_desk", NINE)).status).toBe(200);
  });

  it("asks the same of a reset, by the person's role", async () => {
    const forGm = await post(owner, `/admin/staff/${gm}/password`, { password: NINE });
    expect(forGm.status).toBe(409);
    expect(await reason(forGm)).toContain("10 characters");
    expect((await post(owner, `/admin/staff/${gm}/password`, { password: TEN })).status).toBe(200);
    expect((await post(owner, `/admin/staff/${desk}/password`, { password: NINE })).status).toBe(200);
  });
});

describe("given a manager's role with a short password (D27-245)", () => {
  it("must set a 10-character one at the next sign-in, and that clears it", async () => {
    const due = async () => (await (await app.request("/api/me/password", {
      headers: { "x-dev-staff-id": desk },
    })).json()) as { due: boolean; min: number };

    expect(await due()).toEqual({ due: false, min: 8 });
    /* Their 9-character password is fine for the desk... */
    expect((await post(owner, `/admin/staff/${desk}/password`, { password: NINE })).status).toBe(200);
    /* ...and not for the GM they are made. */
    expect((await post(owner, `/admin/staff/${desk}/access`, { code: "AGR", role: "gm" })).status)
      .toBe(200);
    expect(await due()).toEqual({ due: true, min: 10 });

    /* They set their own, long enough: nothing is due. */
    expect((await post(desk, `/admin/staff/${desk}/password`, { password: TEN })).status).toBe(200);
    expect(await due()).toEqual({ due: false, min: 10 });
  });
});
