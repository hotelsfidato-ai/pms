import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  ADMIN_READ_ROLES, ADMIN_READ_REFUSED, type AdminRead,
} from "../../../src/modules/admin/grants.ts";
import {
  ROLES, ASSIGNABLE_ROLES, canAccess, type Role,
} from "../../../../src/lib/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SERVER REFUSES WHAT THE SCREEN REFUSES — API-2, D17-15

   The 16 September route audit had a reception clerk read 28 KB of
   audit log and the property's settings through the API, while both
   screens told the same clerk "This page is not part of your role".
   The owner's answer, 17 September: refuse it, like the screen, for
   every role without the grant.

   The screen's rule is `canAccess(role, resource)`. This file asks it
   of `src/lib/permissions.ts` directly — never of the server's copy —
   and tries both reads as EVERY role a person can be given.

   ⚠ THE REFUSALS ARE THE POINT. A file that only proved the owner can
   read passes with no guard at all.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "API2TEST";

const READS: { what: AdminRead; path: string }[] = [
  { what: "audit_log", path: "/audit-log" },
  { what: "setting", path: "/settings" },
];

let ownerId: string;
let gmElsewhereId: string;
let onlyElsewhereId: string;
const staffByRole = new Map<string, string>();

const get = (staffId: string, path: string) =>
  app.request(`/api/hotels/${HOTEL}${path}`, { headers: { "x-dev-staff-id": staffId } });

const person = async (key: string, roles: { hotel: string; role: string }[]) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`api2-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-api2-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const r of roles) {
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = $3`, [id, r.role, r.hotel]);
  }
  return id;
};

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  for (const role of ASSIGNABLE_ROLES) {
    staffByRole.set(role, await person(role, [{ hotel: HOTEL, role }]));
  }
  /* The role that counts is the one AT THIS HOTEL — a GM somewhere else
     who is reception here is reception here. */
  gmElsewhereId = await person("gm-elsewhere", [
    { hotel: "AGR", role: "gm" },
    { hotel: HOTEL, role: "front_desk" },
  ]);
  onlyElsewhereId = await person("only-elsewhere", [{ hotel: "AGR", role: "gm" }]);
});

afterAll(async () => {
  await sql(
    `delete from staff_hotels where staff_id in
       (select id from staff where email like 'api2-%@fidato.in')`);
  await sql("update staff set is_active = false where email like 'api2-%@fidato.in'");
  await closePool();
});

describe("the server's lists are the screen's", () => {
  it.each(READS)("$what: exactly the roles the matrix lets open the screen", ({ what }) => {
    const screen = ROLES.filter((role) => canAccess(role, what)).sort();
    expect(
      [...ADMIN_READ_ROLES[what]].sort(),
      `api/src/modules/admin/grants.ts disagrees with src/lib/permissions.ts on ${what}. ` +
        "Who may do what is changed in permissions.ts, and copied here in the same commit.",
    ).toEqual(screen);
  });

  it("every role a person can be given is covered below", () => {
    /* If a role joins the matrix, the loop below tries it without being
       told — this pins that the loop reads the same list. */
    expect(staffByRole.size).toBe(ASSIGNABLE_ROLES.length);
  });
});

describe("every role, both reads, at this hotel", () => {
  const cases = ASSIGNABLE_ROLES.flatMap((role: Role) =>
    READS.map((r) => ({ role, ...r, may: canAccess(role, r.what) })));

  it.each(cases)("$role reading $what → allowed: $may", async ({ role, what, path, may }) => {
    const res = await get(staffByRole.get(role)!, path);
    const text = await res.clone().text();
    if (may) {
      expect(res.status, `${role} should read ${what}: ${text}`).toBe(200);
      const body = (await res.json()) as unknown;
      expect(Array.isArray(body), `${role}'s ${what} is not the real list: ${text}`).toBe(true);
    } else {
      expect(res.status, `${role} should be refused ${what}: ${text}`).toBe(403);
      const body = (await res.json()) as { ok: boolean; reason: string };
      expect(body.ok).toBe(false);
      /* Rule 6: say who can, so the person knows whom to ask. */
      expect(body.reason).toBe(ADMIN_READ_REFUSED[what]);
      expect(body.reason).toMatch(/owner/i);
    }
  });
});

describe("who is asking, beyond the role list", () => {
  it.each(READS)("a group administrator reads $what", async ({ path }) => {
    const res = await get(ownerId, path);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it.each(READS)("a GM at another hotel who is reception here is refused $what here", async ({ path }) => {
    const res = await get(gmElsewhereId, path);
    expect(res.status, await res.clone().text()).toBe(403);
  });

  it.each(READS)("somebody not rostered here at all gets nothing of $what", async ({ path }) => {
    /* Row security hides the property itself, so this is "no such
       property" — what matters is that it is not the data. */
    const res = await get(onlyElsewhereId, path);
    expect(res.status, await res.clone().text()).toBe(404);
  });
});
