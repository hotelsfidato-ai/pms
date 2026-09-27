import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   EVERY ROLE, NOT ANY (28 September, the release review)

   Somebody who is front desk at Agra and GM at Pune has one password.
   Agra's GM could reset it, because ONE of their roles was one Agra's
   GM could give, and then sign in as Pune's GM. The routes, end to
   end; the database functions are asked directly in
   db/tests/modules/admin.sql (MEMORY 318).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const as = (id: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { "x-dev-staff-id": id, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let owner = "", gm = "", two = "", one = "";

const mk = async (email: string, name: string, roles: [string, string][]) => {
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`, [email, name, `test-uid-${email.replace(/\W/g, "")}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  for (const [code, role] of roles) {
    await sql(`insert into staff_hotels (staff_id, hotel_id, role)
               select $1, id, $3 from hotels where code = $2`, [row!.id, code, role]);
  }
  return row!.id;
};

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  gm = await mk("er-gm@fidato.in", "ERTEST Agra GM", [["AGR", "gm"]]);
  two = await mk("er-two@fidato.in", "ERTEST Desk at Agra, GM at Pune", [["AGR", "front_desk"], ["PUN", "gm"]]);
  one = await mk("er-one@fidato.in", "ERTEST Desk at Agra", [["AGR", "front_desk"]]);
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = any($1)", [[gm, two, one]]);
  await sql("update staff set is_active = false where id = any($1)", [[gm, two, one]]);
  await closePool();
});

describe("a GM and somebody who is also above them at another hotel", () => {
  it("⚠ REFUSES Agra's GM the password of Pune's GM who is also desk at Agra", async () => {
    const res = await as(gm, `/admin/staff/${two}/password`, "POST", { password: "not-happening-1" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(
      "You can set a password for yourself, and for somebody who works only at properties you "
      + "manage, in a role you could give. Not for a group administrator.");
  });

  it("⚠ REFUSES editing them, and re-inviting their address (which sets the password)", async () => {
    const edit = await as(gm, `/admin/staff/${two}`, "PATCH", { fullName: "Renamed From Agra" });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { reason: string }).reason).toBe(
      "Only a group administrator, or the manager of every property they work at, "
      + "can change somebody's name or phone.");

    const again = await as(gm, "/admin/staff", "POST", {
      email: "er-two@fidato.in", name: "ERTEST Taken", password: "a-real-password",
      hotelCode: "AGR", role: "front_desk",
    });
    expect(again.status).toBe(403);
    expect(((await again.json()) as { reason: string }).reason).toMatch(/cannot manage/);

    const [row] = await sql<{ full_name: string }>("select full_name from staff where id = $1", [two]);
    expect(row!.full_name).toBe("ERTEST Desk at Agra, GM at Pune");
  });

  it("People says so, and still lets the GM run somebody who works only at Agra", async () => {
    const res = await as(gm, "/admin/staff");
    const { staff } = (await res.json()) as {
      staff: { id: string; mayEdit: boolean; maySwitch: boolean; maySetPassword: boolean }[];
    };
    expect(staff.find((p) => p.id === two)).toMatchObject(
      { mayEdit: false, maySwitch: false, maySetPassword: false });
    expect(staff.find((p) => p.id === one)).toMatchObject(
      { mayEdit: true, maySwitch: true, maySetPassword: true });
  });

  it("a group administrator still may", async () => {
    const res = await as(owner, `/admin/staff/${two}`, "PATCH", { fullName: "ERTEST Renamed by Owner" });
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await (await as(owner, "/admin/staff")).json()) as {
      staff: { id: string; mayEdit: boolean; maySetPassword: boolean }[];
    };
    expect(list.staff.find((p) => p.id === two)).toMatchObject({ mayEdit: true, maySetPassword: true });
  });
});
