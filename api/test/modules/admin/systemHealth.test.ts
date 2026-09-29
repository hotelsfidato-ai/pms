import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, pool } from "../../../src/db.ts";
import { READ_RULES, whoMay } from "../../../src/roleGate.ts";
import { flush, queryName } from "../../../src/telemetry.ts";
import { readBackupLog, p95 } from "../../../src/modules/admin/systemHealth.ts";

/* ══════════════════════════════════════════════════════════════════
   SYSTEM HEALTH AND TELEMETRY (the owner's D27-91 and D27-92, 28 September)

   Every request counted by its route PATTERN, never its address; a server
   error by its kind, never its message; a slow query by its SQL with the
   literals out. The screen's API for the owner and an administrator only.
   The database's own guard and the 180 days, without this route in front
   of them, are db/tests/modules/admin.sql ("telemetry").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "HEALTHTEST";
const people: Record<"admin" | "desk" | "nowhere", string> = { admin: "", desk: "", nowhere: "" };
let owner = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const get = (who: string, path: string) =>
  app.request(`/api/hotels/5EL${path}`, { headers: { "x-dev-staff-id": who } });

beforeAll(async () => {
  await sql("delete from telemetry_requests");
  await sql("delete from telemetry_events");
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const [who, role] of [["admin", "admin"], ["desk", "front_desk"], ["nowhere", null]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`health-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    if (role) {
      await sql(
        "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
        [row!.id, role]);
    }
  }
});

afterAll(async () => {
  await sql("delete from telemetry_requests");
  await sql("delete from telemetry_events");
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("telemetry", () => {
  it("counts a request by its route's pattern, with no id or hotel in it", async () => {
    const id = "6f1c2d3e-0000-4000-8000-00000000abcd";
    expect((await get(owner, `/stays/${id}`)).status).toBe(404);
    await flush();
    const rows = await sql<{ method: string; route: string; status: number; count: number }>(
      "select method, route, status, count from telemetry_requests");
    expect(rows).toContainEqual({ method: "GET", route: "/api/hotels/:code/stays/:id", status: 404, count: 1 });
    const kept = JSON.stringify(rows);
    expect(kept).not.toContain(id);
    expect(kept).not.toContain("5EL");
  });

  it("records a server error by its kind, and logs neither the address nor the message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(owner, "/stays/not-a-uuid-GUESTNAME");
    const logged = log.mock.calls.flat().map(String).join(" ");
    log.mockRestore();
    expect(res.status).toBe(500);
    await flush();
    const events = await sql<{ kind: string; place: string; what: string }>(
      "select kind, place, what from telemetry_events where kind = 'error'");
    expect(events).toContainEqual({ kind: "error", place: "GET /api/hotels/:code/stays/:id", what: "22P02" });
    expect(JSON.stringify(events)).not.toContain("GUESTNAME");
    /* Postgres's message here is: invalid input syntax for type uuid: "not-a-uuid-GUESTNAME". */
    expect(logged).toContain("/api/hotels/:code/stays/:id");
    expect(logged).not.toContain("GUESTNAME");
  });

  it("counts a slow query by its SQL with the values taken out", async () => {
    const client = await pool.connect();
    try { await client.query("select pg_sleep(1.05), 'Mr Guest Name' as who"); } finally { client.release(); }
    await flush();
    const slow = await sql<{ what: string; max_ms: number }>(
      "select what, max_ms from telemetry_events where kind = 'slow_query'");
    expect(slow.map((s) => s.what)).toContain("select pg_sleep(?), ? as who");
    expect(slow[0]!.max_ms).toBeGreaterThanOrEqual(1000);
    expect(queryName("where name = 'O''Brien' and n = 42")).toBe("where name = ? and n = ?");
    /* An apostrophe in a comment opens no string (seen on the screen, 28 Sep). */
    expect(queryName("select r.id, /* a member's room */ r.ref -- the guest's\nfrom r where x = 'Mr X'"))
      .toBe("select r.id, r.ref from r where x = ?");
  });
});

describe("the System health screen's API", () => {
  it("is for exactly the owner and an administrator (D27-91)", () => {
    expect(whoMay(READ_RULES["GET /api/hotels/:code/system-health"]!)).toEqual(["owner", "admin"]);
  });

  it("refuses reception, and somebody who does not work here gets no such property", async () => {
    const desk = await get(people.desk, "/system-health");
    expect(desk.status).toBe(403);
    expect(((await desk.json()) as { reason: string }).reason).toContain("the owner or an administrator");
    expect((await get(people.nowhere, "/system-health")).status).toBe(404);
  });

  it("shows the owner and an administrator the traffic, the hotels and the server", async () => {
    await get(owner, "/stays"); // at least one request in the last hour
    await flush();
    for (const who of [owner, people.admin]) {
      const res = await get(who, "/system-health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        traffic: { hour: { requests: number; series: unknown[] }; week: { series: unknown[] } };
        hotels: { code: string; businessDate: string }[];
        pool: { max: number }; databaseBytes: number; backup: { state: string };
      };
      expect(body.traffic.hour.requests).toBeGreaterThan(0);
      expect(body.traffic.hour.series).toHaveLength(12);
      expect(body.traffic.week.series).toHaveLength(28);
      expect(body.hotels.map((h) => h.code)).toContain("5EL");
      expect(body.pool.max).toBe(20); // D27-165
      expect(body.databaseBytes).toBeGreaterThan(0);
      /* No nightly log on a laptop: said, not guessed. */
      expect(["none", "unreadable"]).toContain(body.backup.state);
    }
  });
});

describe("reading the nightly backup's log", () => {
  /* As db/verify-backup.sh and db/backup.sh print it, colours and all. */
  const night = (end: string, copy: string) =>
    "-- taking a fresh backup first -----------------------------\n"
    + "-- backing up fidato ------------------------------------------\n"
    + "\x1b[32m  ✓ fidato-20260928-030001.dump  (812 KB)\x1b[0m\n" + copy
    + "\n-- restoring into fidato_restore_check ---------------------------------\n"
    + "\x1b[32m  ✓ restored\x1b[0m\n" + end;
  const passed = "\x1b[32m  this backup has been restored and checked. It is a backup.\x1b[0m\n";
  const failed = "\x1b[31m  2 check(s) failed. RESTORING THIS FILE WOULD NOT GIVE YOU\x1b[0m\n"
    + "\x1b[31m  YOUR HOTEL BACK. Do not rely on it.\x1b[0m\n";
  const copied = "\x1b[32m  ✓ copied off the box, checksum matched\x1b[0m";
  const local = "    (no BACKUP_UPLOAD_URL - this copy is on this disk only)";

  it("reads the LAST night: passed, and where the copy went", () => {
    expect(readBackupLog(night(failed, local) + night(passed, copied), "t"))
      .toEqual({ state: "passed", at: "t", offsite: "copied" });
    expect(readBackupLog(night(passed, local), "t").offsite).toBe("this disk only");
  });

  it("says a failed night failed, even after an earlier good one", () => {
    expect(readBackupLog(night(passed, copied) + night(failed, copied), "t").state).toBe("failed");
    const noCopy = "\x1b[31m  x the copy off the box FAILED (HTTP 403). The file on this disk\x1b[0m";
    expect(readBackupLog(night(passed, noCopy), "t")).toMatchObject({ state: "failed", offsite: "failed" });
  });
});

describe("the 95% figure", () => {
  it("is the step 95 of every 100 answered within", () => {
    expect(p95([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(p95([95, 0, 0, 5, 0, 0, 0, 0, 0, 0])).toBe(25);
    expect(p95([94, 0, 0, 6, 0, 0, 0, 0, 0, 0])).toBe(250);
    expect(p95([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])).toBe(-1);
  });
});
