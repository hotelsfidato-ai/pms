import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { totp, stepAt, base32 } from "../../../src/modules/admin/twoStep.ts";

/* ══════════════════════════════════════════════════════════════════
   TWO-STEP SIGN-IN (D27-396) - each refusal seen

   A sign-in is one Firebase auth_time; under the development sign-in a test
   names it with x-dev-sign-in. Every scenario uses a sign-in of its own, so
   the gate's minute of "nothing owed" for one cannot stand in for another.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const RUN = Date.now();
let owner: string;
const ids: Record<string, string> = {};
let signIn = Math.floor(RUN / 1000);
/** A sign-in nobody has used yet. */
const fresh = () => ++signIn;

const as = (who: string, at: number, path: string, init: { method?: string; body?: unknown } = {}) =>
  app.request(path, {
    method: init.method ?? "GET",
    headers: { "x-dev-staff-id": who, "x-dev-sign-in": String(at), "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
const code = (who: string, at: number, typed: string) =>
  as(who, at, "/api/me/two-step", { method: "POST", body: { code: typed } });
const now = (secret: string) => totp(secret, stepAt(Date.now()));
/** Ready for another right code (a code's step is never taken twice). */
const forgetStep = () => sql("update staff_two_step set last_step = null where staff_id = $1", [ids["gm"]]);

let secret = "";
let recovery: string[] = [];

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  for (const [who, role] of [["gm", "gm"], ["admin", "admin"], ["clerk", "front_desk"]] as const) {
    ids[who] = (await sql(
      `insert into staff (email, full_name) values ($1, $2) returning id::text`,
      [`ts-${who}-${RUN}@fidato.in`, `TS ${who}`])).rows[0].id;
    await sql(`insert into staff_hotels (staff_id, hotel_id, role)
               select $1, id, $2 from hotels where code = '5EL'`, [ids[who], role]);
  }
  /* A group administrator of this file's own: the shared owner stays without two-step. */
  ids["boss"] = (await sql(
    `insert into staff (email, full_name, is_group_admin) values ($1, 'TS boss', true) returning id::text`,
    [`ts-boss-${RUN}@fidato.in`])).rows[0].id;
});

afterAll(async () => {
  const all = Object.values(ids);
  await sql("update group_settings set two_step_required = false");
  await sql("delete from two_step_log where staff_id = any($1::uuid[])", [all]);
  await sql("delete from staff_two_step where staff_id = any($1::uuid[])", [all]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [all]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [all]);
  await closePool();
});

describe("the code", () => {
  it("is RFC 6238's: the published SHA-1 test vector", () => {
    const key = base32(Buffer.from("12345678901234567890"));
    expect(totp(key, Math.floor(59 / 30))).toBe("287082");
    expect(totp(key, Math.floor(1111111109 / 30))).toBe("081804");
  });
});

describe("setting it up", () => {
  it("asks nothing of somebody without it", async () => {
    expect((await as(ids["gm"]!, fresh(), "/api/hotels")).status).toBe(200);
  });

  it("hands a key, takes one right code, and gives ten recovery codes once", async () => {
    const at = fresh();
    const setup = await as(ids["gm"]!, at, "/api/me/two-step/setup", { method: "POST" });
    expect(setup.status).toBe(200);
    const body = await setup.json() as { key: string; uri: string };
    secret = body.key.replace(/ /g, "");
    expect(body.uri).toContain(`secret=${secret}`);

    expect((await code(ids["gm"]!, at, "000000")).status, "a wrong code").toBe(409);
    const ok = await code(ids["gm"]!, at, now(secret));
    expect(ok.status).toBe(200);
    const done = await ok.json() as { recoveryCodes: string[]; recoveryLeft: number };
    recovery = done.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(done.recoveryLeft).toBe(10);
    /* That sign-in has passed; and setting up again is refused. */
    expect((await as(ids["gm"]!, at, "/api/hotels")).status).toBe(200);
    expect((await as(ids["gm"]!, at, "/api/me/two-step/setup", { method: "POST" })).status).toBe(409);
    const kept = (await sql("select recovery from staff_two_step where staff_id = $1", [ids["gm"]])).rows[0];
    expect(kept.recovery.some((h: string) => recovery.includes(h)), "only hashes are kept").toBe(false);
    expect((await sql("select count(*)::int as n from audit_log where action = 'TWO_STEP_ON' and row_id = $1",
      [ids["gm"]])).rows[0].n).toBe(1);
  });
});

describe("a new sign-in", () => {
  it("is refused everything but the two-step routes until a code", async () => {
    const at = fresh();
    for (const path of ["/api/hotels", "/api/admin/staff", "/api/hotels/5EL/rooms"]) {
      const res = await as(ids["gm"]!, at, path);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toMatchObject({ twoStep: "code" });
    }
    const me = await (await as(ids["gm"]!, at, "/api/me/two-step")).json();
    expect(me).toMatchObject({ state: "code", on: true, recoveryLeft: 10 });
  });

  it("stays refused after a wrong code, and goes on after a right one", async () => {
    const at = fresh();
    expect((await code(ids["gm"]!, at, "123456")).status).toBe(409);
    expect((await as(ids["gm"]!, at, "/api/hotels")).status).toBe(403);
    await forgetStep();
    expect((await code(ids["gm"]!, at, now(secret))).status).toBe(200);
    expect((await as(ids["gm"]!, at, "/api/hotels")).status).toBe(200);
    expect((await as(ids["gm"]!, fresh(), "/api/hotels")).status, "and only that sign-in").toBe(403);
  });

  it("never takes the same code twice", async () => {
    await forgetStep();
    const typed = now(secret);
    const first = fresh();
    expect((await code(ids["gm"]!, first, typed)).status).toBe(200);
    const second = fresh();
    expect((await code(ids["gm"]!, second, typed)).status).toBe(409);
    expect((await as(ids["gm"]!, second, "/api/hotels")).status).toBe(403);
  });
});

describe("a recovery code", () => {
  it("works once", async () => {
    const at = fresh();
    const res = await code(ids["gm"]!, at, recovery[0]!.toUpperCase());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ recoveryLeft: 9 });
    expect((await as(ids["gm"]!, at, "/api/hotels")).status).toBe(200);

    const again = fresh();
    expect((await code(ids["gm"]!, again, recovery[0]!)).status, "used").toBe(409);
    expect((await as(ids["gm"]!, again, "/api/hotels")).status).toBe(403);
  });
});

describe("the limit", () => {
  it("stops at five wrong codes in a quarter of an hour, a right one included, and keeps them", async () => {
    await sql("delete from two_step_log where staff_id = $1 and not ok", [ids["gm"]]);
    await forgetStep();
    const at = fresh();
    for (let i = 0; i < 5; i++) expect((await code(ids["gm"]!, at, "999999")).status).toBe(409);
    const sixth = await code(ids["gm"]!, at, now(secret));
    expect(sixth.status).toBe(429);
    expect(((await sixth.json()) as { reason: string }).reason).toMatch(/^Five wrong codes in a quarter of an hour/);
    expect((await as(ids["gm"]!, at, "/api/hotels")).status).toBe(403);
    expect((await sql("select count(*)::int as n from two_step_log where staff_id = $1 and not ok",
      [ids["gm"]])).rows[0].n).toBe(5);
    await sql("delete from two_step_log where staff_id = $1 and not ok", [ids["gm"]]);
  });
});

describe("switching somebody's off (a lost phone)", () => {
  const off = (by: string, reason?: string) => as(by, fresh(), `/api/admin/staff/${ids["gm"]}/two-step/off`,
    { method: "POST", body: reason === undefined ? {} : { reason } });

  it("is refused to reception, and asks for a reason", async () => {
    expect((await off(ids["clerk"]!, "lost phone")).status).toBe(403);
    expect((await off(owner)).status).toBe(409);
  });

  it("is the hotel's Admin's, recorded with the reason; the person's next sign-in owes nothing", async () => {
    expect((await off(ids["admin"]!, "Lost phone")).status).toBe(200);
    const line = (await sql(
      "select after from audit_log where action = 'TWO_STEP_OFF' and row_id = $1", [ids["gm"]])).rows;
    expect(line).toHaveLength(1);
    expect(line[0].after).toMatchObject({ reason: "Lost phone", by: "TS admin", whose: "TS gm" });
    expect((await as(ids["gm"]!, fresh(), "/api/hotels")).status).toBe(200);
    expect((await off(ids["admin"]!, "again")).status, "not on any more").toBe(409);
  });
});

describe("the group's setting: required for owner, Admin, GM and Accountant", () => {
  const set = (by: string, required: boolean) =>
    as(by, fresh(), "/api/admin/two-step-required", { method: "PUT", body: { required } });

  it("is off by default, and not the GM's to change", async () => {
    expect((await (await as(ids["clerk"]!, fresh(), "/api/me/two-step")).json())).toMatchObject({ required: false });
    expect((await set(ids["gm"]!, true)).status).toBe(403);
  });

  it("is switched on only by somebody whose own is on", async () => {
    const res = await set(ids["admin"]!, true);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/^Set up your own two-step sign-in first/);
  });

  it("when on, sends an Admin without it to set it up, and leaves reception alone", async () => {
    /* The owner, with their own set up at this sign-in. */
    const at = fresh();
    const setup = await (await as(ids["boss"]!, at, "/api/me/two-step/setup", { method: "POST" })).json() as { key: string };
    expect((await code(ids["boss"]!, at, now(setup.key.replace(/ /g, "")))).status).toBe(200);
    const on = await as(ids["boss"]!, at, "/api/admin/two-step-required", { method: "PUT", body: { required: true } });
    expect(on.status).toBe(200);

    const res = await as(ids["admin"]!, fresh(), "/api/hotels");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ twoStep: "setup" });
    expect((await as(ids["admin"]!, fresh(), "/api/me/two-step")).status, "the two-step routes stay open").toBe(200);
    expect((await as(ids["clerk"]!, fresh(), "/api/hotels")).status).toBe(200);
    expect((await set(ids["admin"]!, false)).status, "not before their own is set up").toBe(403);

    const off = await as(ids["boss"]!, at, "/api/admin/two-step-required", { method: "PUT", body: { required: false } });
    expect(off.status).toBe(200);
    expect((await as(ids["admin"]!, fresh(), "/api/hotels")).status).toBe(200);
  });
});
