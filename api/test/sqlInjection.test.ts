import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SQL INJECTION: TYPED TEXT STAYS TEXT (the owner's D27-340)

   The audit found every value a person types goes to the database as a
   parameter, never as SQL. This proves it from the outside with the classic
   attacks - in a search the database runs, in a guest's name that is
   saved, and in an address - and checks nothing was dropped, widened or
   slowed: the guests table keeps its rows, an "or 1=1" finds nobody, a
   pg_sleep does not sleep, and the name is saved exactly as typed.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
let owner = "";
let guest = { id: "", full_name: "" };

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};
const call = (path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: init.method ?? "GET",
    headers: { "x-dev-staff-id": owner, ...(init.body ? { "content-type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
const guests = async () => Number((await sql("select count(*)::int as n from guests"))[0].n);

const ATTACKS = [
  "' OR '1'='1",
  "x' OR 1=1 --",
  "'; DROP TABLE guests; --",
  "Robert'); DROP TABLE guests;--",
  "' UNION SELECT id::text, email, null, null, 0, false FROM staff --",
  "'; SELECT pg_sleep(5); --",
  "%' OR full_name LIKE '%",
];

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'"))[0].id;
  [guest] = await sql(
    `select g.id::text, g.full_name from guests g
       join reservations r on r.guest_id = g.id
       join hotels h on h.id = r.hotel_id and h.code = '5EL'
      limit 1`) as [{ id: string; full_name: string }];
});

afterAll(async () => {
  await sql("update guests set full_name = $2 where id = $1", [guest.id, guest.full_name]);
  await closePool();
});

describe("typed text stays text (D27-340)", () => {
  it("a search with each attack finds nobody it should not, quickly, and drops nothing", async () => {
    const before = await guests();
    for (const q of ATTACKS) {
      const started = Date.now();
      const res = await call(`/crm/guests?q=${encodeURIComponent(q)}`);
      expect(res.status, `${q}: ${await res.clone().text()}`).toBe(200);
      const rows = (await res.json()) as unknown[] | { guests?: unknown[] };
      const found = Array.isArray(rows) ? rows : rows.guests ?? [];
      /* "or 1=1" would have answered every guest; no guest is named like these. */
      expect(found.length, q).toBe(0);
      expect(Date.now() - started, `${q} slept`).toBeLessThan(4000);
    }
    expect(await guests()).toBe(before);
  });

  it("a guest named with an attack is saved exactly as typed, and the table is whole", async () => {
    const before = await guests();
    const name = "Robert'); DROP TABLE guests;--";
    const res = await call(`/guests/${guest.id}`, { method: "PATCH", body: { fullName: name } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await sql("select full_name from guests where id = $1", [guest.id]))[0].full_name).toBe(name);
    expect(await guests()).toBe(before);
  });

  it("an attack in the address is refused or not found, never a database error", async () => {
    for (const bad of ["' OR 1=1 --", "1;DROP TABLE guests"]) {
      const res = await call(`/guests/${encodeURIComponent(bad)}`);
      expect([400, 404], `${bad}: ${res.status}`).toContain(res.status);
    }
  });
});
