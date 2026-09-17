import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   PHASE 1 — EACH PERSON'S FIRST SCREEN, AND RECEPTION ON THE POS

   The owner's decisions of 14 September:

     · the GM sets each person's first screen after sign-in (Dashboard,
       Rooms or Calendar), and the person can change their own
     · a per-hotel switch decides whether Reception may use the POS,
       set by the GM, enforced by the server and not only the menu

   ⚠ THE REFUSALS ARE THE POINT. A GM who can set anybody's screen, a
   clerk who can switch their own POS access back on, a till that only
   the menu keeps reception out of — each would pass a file that only
   proved the happy paths.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let gmId: string;
let clerkId: string;

const as = (id: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api${path}`, {
    method,
    headers: { "x-dev-staff-id": id, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const scopeOf = async (id: string) =>
  ((await (await as(id, "/hotels")).json()) as {
    scope: { homeScreen: string; roomGrouping: string; startHereDismissed: boolean };
  }).scope;

const receptionPos = async (enabled: boolean | null) => {
  const db = await admin();
  try {
    if (enabled === null) {
      await db.query(
        `delete from hotel_modules
          where module = 'reception_pos'
            and hotel_id = (select id from hotels where code = '5EL')`);
    } else {
      await db.query(
        `insert into hotel_modules (hotel_id, module, is_enabled)
         select id, 'reception_pos', $1 from hotels where code = '5EL'
         on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`,
        [enabled]);
    }
  } finally { await db.end(); }
};

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;

    const mk = async (email: string, name: string, role: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid)
         values ($1, $2, $3)
         on conflict (email) do update
           set is_active = true, full_name = excluded.full_name,
               home_screen = null, room_grouping = 'type',
               start_here_dismissed = false
         returning id::text`,
        [email, name, `test-uid-${email.replace(/\W/g, "")}`]);
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         select $1, id, $2 from hotels where code = '5EL'
         on conflict (staff_id, hotel_id) do update set role = excluded.role`,
        [rows[0]!.id, role]);
      return rows[0]!.id;
    };
    gmId = await mk("fs-gm@fidato.in", "FSTEST Manager", "gm");
    clerkId = await mk("fs-desk@fidato.in", "FSTEST Reception", "front_desk");
  } finally { await db.end(); }
});

afterAll(async () => {
  await receptionPos(null);
  const db = await admin();
  try {
    await db.query("delete from staff_hotels where staff_id = any($1)", [[gmId, clerkId]]);
    await db.query(
      `update staff set is_active = false, home_screen = null, room_grouping = 'type',
                        start_here_dismissed = false
        where id = any($1)`, [[gmId, clerkId]]);
    await db.query("update staff set home_screen = null where id = $1", [ownerId]);
  } finally { await db.end(); }
  await closePool();
});

describe("the first screen after sign-in", () => {
  it("is the Dashboard for somebody nobody has set, grouped by room type", async () => {
    /* NULL is the Dashboard — what everybody got before 087. */
    const scope = await scopeOf(clerkId);
    expect(scope.homeScreen).toBe("dashboard");
    expect(scope.roomGrouping).toBe("type");
  });

  it("a person sets their own, and it follows them — the server keeps it", async () => {
    const res = await as(clerkId, "/me/preferences", "PUT",
      { homeScreen: "rooms", roomGrouping: "floor" });
    expect(res.status, await res.clone().text()).toBe(200);

    const scope = await scopeOf(clerkId);
    expect(scope.homeScreen).toBe("rooms");
    expect(scope.roomGrouping).toBe("floor");
  });

  it("refuses a screen that does not exist, and changes nothing", async () => {
    const res = await as(clerkId, "/me/preferences", "PUT", { homeScreen: "kitchen" });
    expect(res.status).toBe(409);
    expect((await scopeOf(clerkId)).homeScreen).toBe("rooms");
  });

  it("the GM sets it for their own staff", async () => {
    const res = await as(gmId, `/admin/staff/${clerkId}/home-screen`, "PUT",
      { homeScreen: "calendar" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await scopeOf(clerkId)).homeScreen).toBe("calendar");
  });

  it("⚠ A CLERK CANNOT SET SOMEBODY ELSE'S", async () => {
    const res = await as(clerkId, `/admin/staff/${gmId}/home-screen`, "PUT",
      { homeScreen: "rooms" });
    expect(res.status).toBe(403);
    expect((await scopeOf(gmId)).homeScreen).toBe("dashboard");
  });

  it("⚠ A GM CANNOT SET A GROUP ADMINISTRATOR'S", async () => {
    /* app.may_manage_person (084): never a group administrator by a GM. */
    const res = await as(gmId, `/admin/staff/${ownerId}/home-screen`, "PUT",
      { homeScreen: "rooms" });
    expect(res.status).toBe(403);
    expect((await scopeOf(ownerId)).homeScreen).toBe("dashboard");
  });
});

/* 089 — the clarity plan's step 4. The card of first jobs goes when the
   person taps "Got it" and comes back from the account menu; the owner
   chose "remembered per person", so it is the server's to keep. */
describe("the Start here card", () => {
  it("a new person has it", async () => {
    expect((await scopeOf(clerkId)).startHereDismissed).toBe(false);
  });

  it("\"Got it\" puts it away, for them only, and leaves their first screen alone", async () => {
    const before = (await scopeOf(clerkId)).homeScreen;
    const res = await as(clerkId, "/me/preferences", "PUT", { startHereDismissed: true });
    expect(res.status, await res.clone().text()).toBe(200);

    const scope = await scopeOf(clerkId);
    expect(scope.startHereDismissed).toBe(true);
    expect(scope.homeScreen).toBe(before);
    expect((await scopeOf(gmId)).startHereDismissed).toBe(false);
  });

  it("refuses anything but yes or no, and changes nothing", async () => {
    const res = await as(clerkId, "/me/preferences", "PUT", { startHereDismissed: "yes" });
    expect(res.status).toBe(409);
    expect((await scopeOf(clerkId)).startHereDismissed).toBe(true);
  });

  it("the account menu brings it back", async () => {
    const res = await as(clerkId, "/me/preferences", "PUT", { startHereDismissed: false });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await scopeOf(clerkId)).startHereDismissed).toBe(false);
  });
});

describe("reception on the POS, per hotel", () => {
  it("is listed with the property's modules", async () => {
    const res = await as(ownerId, "/hotels/5EL/modules");
    const body = (await res.json()) as { modules: { module: string }[] };
    expect(body.modules.map((m) => m.module)).toContain("reception_pos");
  });

  it("⚠ ONLY THE OWNER OR AN ADMIN CAN FLIP A MODULE — a clerk cannot", async () => {
    /* Before 14 September nothing checked: any clerk could close the
       till, and a receptionist could have switched their own POS access
       back on. */
    await receptionPos(false);
    const res = await as(clerkId, "/hotels/5EL/modules/reception_pos", "POST",
      { enabled: true });
    expect(res.status).toBe(403);

    const db = await admin();
    try {
      const { rows } = await db.query<{ on: boolean }>(
        `select app.module_enabled(id, 'reception_pos') as on
           from hotels where code = '5EL'`);
      expect(rows[0]!.on, "the refusal was cosmetic — the switch moved").toBe(false);
    } finally { await db.end(); }
  });

  it("the GM cannot flip it — D17-36, 17 September: owner and admin only", async () => {
    /* It said "the GM can flip it" until the owner's answer of 17
       September. Every role is tried in
       api/test/modules/admin/moduleSwitches.test.ts; this one stays
       because it is the switch the GM used to own. */
    await receptionPos(true);
    const res = await as(gmId, "/hotels/5EL/modules/reception_pos", "POST",
      { enabled: false });
    expect(res.status, await res.clone().text()).toBe(403);

    const db = await admin();
    try {
      const { rows } = await db.query<{ on: boolean }>(
        `select app.module_enabled(id, 'reception_pos') as on
           from hotels where code = '5EL'`);
      expect(rows[0]!.on, "the refusal was cosmetic — the switch moved").toBe(true);
    } finally { await db.end(); }
  });

  it("⚠ WITH THE SWITCH OFF, THE SERVER REFUSES RECEPTION AT THE TILL, AND SAYS WHY", async () => {
    await receptionPos(false);
    const res = await as(clerkId, "/hotels/5EL/till/floor");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/general manager can turn it on/);

    /* Everybody else is answered as before. */
    expect((await as(gmId, "/hotels/5EL/till/floor")).status).toBe(200);
    expect((await as(ownerId, "/hotels/5EL/till/floor")).status).toBe(200);
  });

  it("with the switch on, reception uses the till", async () => {
    await receptionPos(true);
    const res = await as(clerkId, "/hotels/5EL/till/floor");
    expect(res.status, await res.clone().text()).toBe(200);
  });
});
