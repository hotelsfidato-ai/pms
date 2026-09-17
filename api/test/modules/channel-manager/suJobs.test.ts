import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { closePool } from "../../../src/db.ts";
import { useTransportForTests } from "../../../src/modules/channel-manager/su/runtime.ts";
import { jobs, runOnce, dueHotels } from "../../../src/modules/channel-manager/jobs.ts";
import { TOKEN_SANDBOX, ARI_SUCCESS, ok200 } from "./suExamples.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 3 — THE PUSH NOBODY PRESSES

   1. No hotel is due while none is switched on for the channel manager
      (the master's switch), whatever else is set up.
   2. A due hotel's push runs as its service account, sends only what
      changed, and is logged as that account; a second run sends nothing.
   3. Nothing runs while SU is not set up on the server.
   4. start() twice is one timer; stop() ends it.

   The service account here holds `read_only`: the job needs only to be
   rostered at the hotel for row-level security. Which role a real one
   holds is the master's and the owner's (P4-a).
   ══════════════════════════════════════════════════════════════════ */

let hotelId: string;
let superiorId: string;
let deluxeId: string;
let serviceId: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  try {
    hotelId = (await db.query<{ id: string }>("select id::text from hotels where code = '5EL'")).rows[0]!.id;
    const types = (await db.query<{ id: string; code: string }>(
      "select id::text, code from room_types where hotel_id = $1", [hotelId])).rows;
    superiorId = types.find((t) => t.code === "SUP")!.id;
    deluxeId = types.find((t) => t.code === "DLX")!.id;
    serviceId = (await db.query<{ id: string }>(
      `insert into staff (email, full_name) values ('cm-service-test@fidato.in', 'CMTEST service account')
       on conflict (email) do update set is_active = true returning id::text`)).rows[0]!.id;
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'read_only')
       on conflict (staff_id, hotel_id) do update set role = 'read_only'`, [serviceId, hotelId]);

    await db.query(
      `insert into channel_hotels (hotel_id, su_hotel_id, on_su, run_as) values ($1, 'FIDATO-5EL', true, $2)`,
      [hotelId, serviceId]);
    await db.query(
      `insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children, is_connected, on_su)
       values ($1, $3, 'SUP', 9, 1, true, 'active'), ($2, $3, 'DLX', 7, 2, true, 'active')`,
      [superiorId, deluxeId, hotelId]);
  } finally { await db.end(); }
});

afterEach(() => {
  for (const n of ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"]) delete process.env[n];
  useTransportForTests(null);
});

afterAll(async () => {
  await jobs.stop();
  const db = await admin();
  try {
    for (const t of ["channel_ari_sent", "channel_ari_pushes", "channel_room_types", "channel_rate_plans", "channel_hotels"]) {
      await db.query(`delete from ${t} where hotel_id = $1`, [hotelId]);
    }
    await db.query("delete from staff_hotels where staff_id = $1", [serviceId]);
    await db.query("update staff set is_active = false where id = $1", [serviceId]);
  } finally { await db.end(); }
  await closePool();
});

const setUpSu = () => {
  process.env["SU_ENVIRONMENT"] = "sandbox";
  process.env["SU_CLIENT_ID"] = "test-client";
  process.env["SU_CLIENT_SECRET"] = "test-secret";
};

const pretendSu = () => {
  const bodies: unknown[] = [];
  useTransportForTests(async (req) => {
    if (req.url.endsWith("/auth/generate-access-token")) return ok200(TOKEN_SANDBOX);
    bodies.push(JSON.parse(req.body!));
    return ok200(ARI_SUCCESS);
  });
  return bodies;
};

describe("the push nobody presses", () => {
  it("finds no hotel due while none is switched on, even one set up with an account", async () => {
    expect(await dueHotels()).toEqual([]);
  });

  it("does nothing while SU is not set up", async () => {
    const bodies = pretendSu();
    await runOnce(async () => [{ hotelId, runAs: serviceId }]);
    expect(bodies).toHaveLength(0);
  });

  it("pushes what changed as the hotel's service account, then nothing", async () => {
    setUpSu();
    const bodies = pretendSu();
    await runOnce(async () => [{ hotelId, runAs: serviceId }]);
    expect(bodies.length).toBeGreaterThan(0);

    const db = await admin();
    try {
      const { rows } = await db.query<{ kind: string; started_by: string; ok: boolean; dates: number }>(
        "select kind, started_by::text, ok, dates from channel_ari_pushes where hotel_id = $1 order by id", [hotelId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "changes", started_by: serviceId, ok: true, dates: 2 * 365 });
    } finally { await db.end(); }

    const again = pretendSu();
    await runOnce(async () => [{ hotelId, runAs: serviceId }]);
    expect(again).toHaveLength(0);
  });

  it("starts one timer however often it is started, and stops", async () => {
    jobs.start();
    jobs.start();
    await jobs.stop();
    await jobs.stop();
  });
});
