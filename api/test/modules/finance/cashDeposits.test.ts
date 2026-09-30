import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import * as storage from "../../../src/storage.ts";

/* ══════════════════════════════════════════════════════════════════
   THE FLOAT KEPT AND THE CASH DEPOSITS LOG - D27-190, D27-191

   A close keeps a float and the rest is cash to deposit, plus what went to
   the safe, less change brought from it. The GM records each deposit
   against the day it banks; only the owner or the accountant verifies,
   and only with the slip's photo and once the day adds up or is explained.
   Append-only. Everything is tagged CASHDEP and put away afterwards; the
   days used are 200 days back, which nothing else in the suite touches.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CASHDEP";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const as = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const people: Record<string, string> = {};
let hotel = "";
let day = "";       // a closed day with the float kept at every close
let before = "";    // a close from before the release: no float kept
let restaurant = "";

type Day = { date: string; points: { point: string; amount: number | null }[];
             toDeposit: number | null; deposited: number; difference: number | null; red: boolean };
type View = { canRecord: boolean; canVerify: boolean; days: Day[];
              deposits: { id: string; amount: number; verifiedAt: string | null; reversed: boolean }[] };
const view = async (who = people["gm"]!) => (await (await as(who, "GET", "/cash-deposits")).json()) as View;
const dayOf = async (date = day) => (await view()).days.find((d) => d.date === date);

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  const [dates] = await sql<{ d: string; b: string }>(
    `select (app.business_date($1) - 200)::text as d, (app.business_date($1) - 201)::text as b`, [hotel]);
  day = dates!.d;
  before = dates!.b;
  people["owner"] = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const role of ["gm", "hotel_manager", "front_desk", "finance", "read_only"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`cashdep-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-cashdep-${role}`]);
    people[role] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [p!.id, hotel, role]);
  }
  const gm = people["gm"]!;
  const [outlet] = await sql<{ id: string; name: string }>(
    "select id::text, name from pos_outlets where hotel_id = $1 and code = 'REST'", [hotel]);
  restaurant = outlet!.name;
  for (const d of [day, before]) {
    await sql("delete from cashier_shifts where hotel_id = $1 and business_date = $2::date", [hotel, d]);
    await sql("delete from pos_cash_movements where hotel_id = $1 and business_date = $2::date", [hotel, d]);
    await sql("delete from pos_day_ends where hotel_id = $1 and business_date = $2::date", [hotel, d]);
  }

  /* The desk: 11,000 counted, 1,000 kept, 3,000 sent to the safe, 500 of
     change brought from it = 12,500. A handover keeps the whole drawer = 0. */
  const [shift] = await sql<{ id: string }>(
    `insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, counted_cash,
                                 kept_cash, closed_by, closed_at)
     values ($1, $2, $3::date, 1000, 11000, 1000, $2, now()) returning id::text`, [hotel, gm, day]);
  await sql(`insert into cashier_movements (hotel_id, shift_id, kind, amount, reason, recorded_by)
             values ($1, $2, 'withdrawal', 3000, '${TAG} to the safe', $3),
                    ($1, $2, 'top_up', 500, '${TAG} change', $3)`, [hotel, shift!.id, gm]);
  await sql(`insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, counted_cash,
                                         kept_cash, handed_to, closed_by, closed_at)
             values ($1, $2, $3::date, 0, 2000, 2000, $4, $4, now())`,
    [hotel, people["hotel_manager"], day, gm]);
  /* The restaurant: 6,000 counted, 1,000 kept = 5,000. */
  await sql(`insert into pos_day_ends (hotel_id, outlet_id, business_date, opening_cash, counted_cash,
                                       kept_cash, closed_by, closed_at)
             values ($1, $2, $3::date, 1000, 6000, 1000, $4, now())`, [hotel, outlet!.id, day, gm]);
  /* Before the release: a close with no float kept. */
  await sql(`insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, counted_cash,
                                         closed_by, closed_at)
             values ($1, $2, $3::date, 0, 4000, $2, now())`, [hotel, gm, before]);
});

afterAll(async () => {
  const files = await sql<{ storage_key: string }>(
    "select storage_key from attachments where subject_table = 'cash_deposits'");
  for (const f of files) await storage.remove(f.storage_key);
  await sql("delete from attachments where subject_table = 'cash_deposits'");
  await sql("delete from cash_deposit_notes where hotel_id = $1", [hotel]);
  await sql("delete from cash_deposits where reverses_id is not null and hotel_id = $1", [hotel]);
  await sql("delete from cash_deposits where hotel_id = $1", [hotel]);
  for (const d of [day, before]) {
    await sql("delete from cashier_shifts where hotel_id = $1 and business_date = $2::date", [hotel, d]);
    await sql("delete from pos_day_ends where hotel_id = $1 and business_date = $2::date", [hotel, d]);
  }
  const ids = Object.entries(people).filter(([r]) => r !== "owner").map(([, id]) => id);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("cash to deposit (D27-191)", () => {
  it("is each close's count less its float kept, plus the safe, less the change from it", async () => {
    const d = await dayOf();
    expect(d, "the closed day is listed").toBeTruthy();
    expect(d!.points).toEqual([
      { point: "Front desk", amount: 12500 },
      { point: restaurant, amount: 5000 },
    ]);
    expect(d!.toDeposit).toBe(17500);
    expect(d!.red, "nothing deposited yet").toBe(true);
    /* The log starts from the release: a day whose closes kept no figure is not listed. */
    expect(await dayOf(before)).toBeUndefined();
  });

  it("is not for reception or the hotel manager, who neither see nor record it", async () => {
    expect((await as(people["front_desk"]!, "GET", "/cash-deposits")).status).toBe(403);
    const res = await as(people["hotel_manager"]!, "POST", "/cash-deposits",
      { businessDate: day, amount: 100, depositedOn: day, bank: "SBI", slipNo: "X1" });
    expect(res.status, await res.clone().text()).toBe(403);
    expect(await sql("select 1 from cash_deposits where hotel_id = $1", [hotel])).toHaveLength(0);
    const viewer = await view(people["read_only"]!);
    expect([viewer.canRecord, viewer.canVerify]).toEqual([false, false]);
  });
});

describe("a deposit, recorded and verified (D27-190, D27-191)", () => {
  let id = "";
  it("is recorded by the GM against the day it banks", async () => {
    const res = await as(people["gm"]!, "POST", "/cash-deposits",
      { businessDate: day, amount: 15000, depositedOn: day, bank: "SBI Akkalkot", slipNo: "45021" });
    expect(res.status, await res.clone().text()).toBe(200);
    id = ((await res.json()) as { id: string }).id;
    const d = await dayOf();
    expect([d!.deposited, d!.difference, d!.red]).toEqual([15000, 2500, true]);
  });

  it("is verified by neither the GM, nor anybody without the slip's photo, nor on a red day", async () => {
    expect((await as(people["gm"]!, "POST", `/cash-deposits/${id}/verify`, {})).status).toBe(403);
    const noPhoto = await as(people["finance"]!, "POST", `/cash-deposits/${id}/verify`, {});
    expect(((await noPhoto.json()) as { reason: string }).reason).toMatch(/photo of the bank's slip/);

    const form = new FormData();
    form.set("table", "cash_deposits");
    form.set("id", id);
    form.set("file", new File([new Uint8Array(PNG)], "slip.png", { type: "image/png" }));
    const up = await app.request("/api/hotels/5EL/attachments",
      { method: "POST", headers: { "x-dev-staff-id": people["gm"]! }, body: form });
    expect(up.status, await up.clone().text()).toBe(200);

    const red = await as(people["finance"]!, "POST", `/cash-deposits/${id}/verify`, {});
    expect(red.status).toBe(409);
    expect(((await red.json()) as { reason: string }).reason).toMatch(/nobody has explained/);
  });

  it("is verified by the accountant once the day is explained, once, and never reversed after", async () => {
    const why = await as(people["gm"]!, "POST", `/cash-deposits/days/${day}/explain`,
      { reason: "2,500 kept back for the week's petty cash" });
    expect(why.status, await why.clone().text()).toBe(200);
    expect((await dayOf())!.red).toBe(false);

    const ok = await as(people["finance"]!, "POST", `/cash-deposits/${id}/verify`, {});
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await as(people["owner"]!, "POST", `/cash-deposits/${id}/verify`, {})).status).toBe(409);
    const back = await as(people["gm"]!, "POST", `/cash-deposits/${id}/reverse`, { reason: "wrong" });
    expect(((await back.json()) as { reason: string }).reason).toMatch(/verified deposit cannot be reversed/);
  });

  it("is reversed by a line of its own, once; a later entry asks for the day's explanation again", async () => {
    const more = await as(people["gm"]!, "POST", "/cash-deposits",
      { businessDate: day, amount: 1000, depositedOn: day, bank: "SBI Akkalkot", slipNo: "45022" });
    const extra = ((await more.json()) as { id: string }).id;
    expect((await dayOf())!.red, "explained before this entry").toBe(true);

    expect((await as(people["gm"]!, "POST", `/cash-deposits/${extra}/reverse`, {})).status).toBe(409);
    const rev = await as(people["gm"]!, "POST", `/cash-deposits/${extra}/reverse`, { reason: "typed twice" });
    expect(rev.status, await rev.clone().text()).toBe(200);
    expect((await as(people["gm"]!, "POST", `/cash-deposits/${extra}/reverse`, { reason: "again" })).status).toBe(409);
    const d = await dayOf();
    expect(d!.deposited).toBe(15000);
    expect((await view()).deposits.find((x) => x.id === extra)!.reversed).toBe(true);
  });
});

describe("the log is append-only in the database", () => {
  it("refuses an edit and a delete, even from the app's own connection", async () => {
    const [row] = await sql<{ id: string }>(
      "select id::text from cash_deposits where hotel_id = $1 and reverses_id is null limit 1", [hotel]);
    await expect(withUser(people["gm"]!, (c) =>
      c.query("update cash_deposits set amount = 1 where id = $1", [row!.id]))).rejects.toThrow();
    await expect(withUser(people["gm"]!, (c) =>
      c.query("delete from cash_deposits where id = $1", [row!.id]))).rejects.toThrow();
  });
});

describe("the float kept at every close (D27-191)", () => {
  it("is typed at the desk's close, with a name or without, and only that much is kept (D27-202)", async () => {
    const clerk = people["front_desk"]!;
    await sql("delete from cashier_shifts where staff_id = $1 and closed_at is null", [clerk]);
    expect((await as(clerk, "POST", "/cashier-shift/open", { opening: 0 })).status).toBe(200);
    expect((await as(clerk, "POST", "/cashier-shift/count",
      { denominations: [{ value: 500, count: 2 }] })).status).toBe(200);
    const blank = await as(clerk, "POST", "/cashier-shift/close", { varianceReason: `${TAG} found` });
    expect(blank.status).toBe(409);
    expect(((await blank.json()) as { reason: string }).reason).toMatch(/float is kept/);
    /* A name alone keeps nothing by itself: the figure is typed. */
    const named = await as(clerk, "POST", "/cashier-shift/close",
      { varianceReason: `${TAG} found`, handOverTo: people["gm"] });
    expect(named.status).toBe(409);
    const handed = await as(clerk, "POST", "/cashier-shift/close",
      { varianceReason: `${TAG} found`, handOverTo: people["gm"], keptCash: 600 });
    expect(handed.status, await handed.clone().text()).toBe(200);
    const [s] = await sql<{ kept: string }>(
      "select kept_cash::text as kept from cashier_shifts where staff_id = $1 order by closed_at desc limit 1", [clerk]);
    expect(Number(s!.kept)).toBe(600);
    await sql("delete from cashier_shifts where staff_id = $1", [clerk]);
  });
});
