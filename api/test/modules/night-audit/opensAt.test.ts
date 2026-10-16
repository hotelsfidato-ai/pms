import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT OPENS AT ITS TIME (the owner's D27-338)

   "Nobody can do the night audit for that day until 16:00." A per-hotel
   "Night audit opens at" (16:00 to begin), by the hotel's own clock:
   before it, today's business date is locked - the checklist says so and
   the run refuses; a business date already behind is never locked. The
   time is the owner's and an administrator's to change, not the GM's.
   Its own property (NAO), deleted afterwards. The lock is driven by the
   setting (23:59 locks, 00:00 opens), never by the clock of the test.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "NAO";
let hotelId = "";
let today = "";
const staff = new Map<string, string>();

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};
const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": staff.get(who) ?? who,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const blockers = async (asOn?: string) => {
  const res = await call("owner", `/night-audit${asOn ? `?asOn=${asOn}` : ""}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { canRun: { blockers: { id: string; reason: string }[] } }).canRun.blockers;
};
const opensAt = (t: string) => sql("update hotels set night_audit_opens_at = $2::time where id = $1", [hotelId, t]);

beforeAll(async () => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    const owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    staff.set("owner", owner);
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query("select app.provision_property_unchecked($1, 'Night Audit Opens', 'Nowhere')::text as id",
      [CODE])).rows[0].id;
  } finally { await db.end(); }
  /* The hotel's business date IS its today, whatever the hour: a new hotel's
     date is the database's (UTC), a day behind India from 00:00 to 05:30 -
     the release run of 17 Oct, 00:20, met it (MEMORY 416). */
  await sql("update hotels set business_date = (now() at time zone timezone)::date where id = $1", [hotelId]);
  today = (await sql("select app.business_date($1)::text as d", [hotelId]))[0].d;
  for (const role of ["gm", "admin"]) {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`nao-${role}@fidato.in`, `NAO ${role}`, `test-uid-nao-${role}`]))[0].id;
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
    staff.set(role, id);
  }
});

afterAll(async () => {
  await closePool();
  await sql("alter table hotels disable trigger hotels_no_delete");
  try { await sql("delete from hotels where id = $1", [hotelId]); }
  finally { await sql("alter table hotels enable trigger hotels_no_delete"); }
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[staff.get("gm"), staff.get("admin")]]);
});

describe("the night audit's opening time (D27-338)", () => {
  it("starts at 16:00 for a new hotel, whose business date is the hotel's today", async () => {
    const [h] = await sql(
      `select to_char(night_audit_opens_at, 'HH24:MI') as t,
              app.business_date(id) = (now() at time zone timezone)::date as today
         from hotels where id = $1`, [hotelId]);
    expect(h).toEqual({ t: "16:00", today: true });
  });

  it("locks today's day before its time: the checklist says so and the run refuses", async () => {
    await opensAt("23:59");
    const locked = (await blockers()).find((b) => b.id === "not-yet");
    expect(locked?.reason).toMatch(/^The night audit for .+ opens at 23:59, by the hotel's clock\.$/);
    const run = await call("owner", "/night-audit/run", "POST", { businessDate: today });
    expect(run.status).toBe(409);
    expect(((await run.json()) as { reason: string }).reason).toContain("opens at 23:59");
    expect((await sql("select count(*)::int as n from night_audit_runs where hotel_id = $1", [hotelId]))[0].n).toBe(0);
  });

  it("never locks a day already behind", async () => {
    const yesterday = (await sql("select ($1::date - 1)::text as d", [today]))[0].d as string;
    expect((await blockers(yesterday)).map((b) => b.id)).not.toContain("not-yet");
  });

  it("opens from its time", async () => {
    await opensAt("00:00");
    expect((await blockers()).map((b) => b.id)).not.toContain("not-yet");
    await opensAt("16:00");
  });

  it("is the owner's and an admin's to change - the GM still saves the hours", async () => {
    const gm = await call("gm", "/front-desk", "PATCH", { nightAuditOpensAt: "17:00" });
    expect(gm.status).toBe(409);
    expect(((await gm.json()) as { reason: string }).reason)
      .toBe("The night audit's opening time is for the owner or an administrator. Ask one of them.");
    expect((await call("gm", "/front-desk", "PATCH", { checkInTime: "13:00" })).status).toBe(200);
    expect((await call("admin", "/front-desk", "PATCH", { nightAuditOpensAt: "17:30" })).status).toBe(200);
    const setup = (await (await call("owner", "/room-setup")).json()) as { frontDesk: { nightAuditOpensAt: string } };
    expect(setup.frontDesk.nightAuditOpensAt).toBe("17:30");
    expect((await call("owner", "/front-desk", "PATCH", { nightAuditOpensAt: "25:00" })).status).toBe(409);
  });
});
