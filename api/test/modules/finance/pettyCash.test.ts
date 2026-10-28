import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { EXPENSE_CATEGORIES } from "../../../src/modules/finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK - the owner's D27-370

   A paid-out from the desk's drawer or a restaurant's tin: a category of
   five, required of a new one; a photo of its bill, optional, stored and
   read back; and the Petty cash report, both places together, its totals
   counting what the drawer counts (approved, D27-242). Tagged PETTY.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "PETTY";
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
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const upload = (who: string, path: string, bytes: Buffer, type: string) => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "bill.png", { type }));
  return app.request(`/api/hotels/5EL${path}`, { method: "POST", headers: { "x-dev-staff-id": who }, body: form });
};
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const people: Record<string, string> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  for (const role of ["front_desk", "gm", "housekeeping", "revenue_manager", "finance"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`petty-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-petty-${role}`]);
    people[role] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
      [p!.id, role]);
  }
});

afterAll(async () => {
  const staff = Object.values(people);
  const moved = `select id from cashier_movements where reason like $1 union all select id from pos_cash_movements where reason like $1`;
  await sql(`delete from approvals where subject_id in (${moved})`, [`${TAG}%`]);
  await sql(`delete from attachments where subject_id in (${moved})`, [`${TAG}%`]);
  await sql("delete from cashier_shifts where staff_id = any($1)", [staff]);
  await sql("delete from pos_cash_movements where reason like $1", [`${TAG}%`]);
  await sql("delete from staff_hotels where staff_id = any($1)", [staff]);
  await sql("update staff set is_active = false where id = any($1)", [staff]);
  await closePool();
});

describe("one list of five, and the database's the same five", () => {
  it("the server's list is the database's check, word for word", async () => {
    for (const table of ["pos_cash_movements", "cashier_movements"]) {
      const [c] = await sql<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`, [`${table}_category_known`]);
      expect(c, table).toBeTruthy();
      expect([...c!.def.matchAll(/'(\w+)'::text/g)].map((m) => m[1]).filter((w) => w !== "expense"))
        .toEqual([...EXPENSE_CATEGORIES]);
    }
  });

  it("the restaurant's tin refuses any other word, and a category on money in", async () => {
    const [o] = await sql<{ id: string; hotel: string }>(
      "select o.id::text, o.hotel_id::text as hotel from pos_outlets o join hotels h on h.id = o.hotel_id where h.code = '5EL' limit 1");
    for (const [kind, category] of [["expense", "Food"], ["top_up", "Office"]]) {
      await expect(sql(
        `insert into pos_cash_movements (hotel_id, outlet_id, business_date, kind, amount, reason, recorded_by, category)
         values ($1, $2, current_date, $3, 1, $4, $5, $6)`, [o!.hotel, o!.id, kind, `${TAG} db`, people["gm"], category]))
        .rejects.toThrow(/category_known/);
    }
  });
});

describe("the front desk's paid-out (Cashiering)", () => {
  it("is refused without a category, or with another word, and nothing is written", async () => {
    const desk = people["front_desk"]!;
    const none = await as(desk, "POST", "/cashier-shift/movements", { kind: "expense", amount: 90, reason: `${TAG} none` });
    expect(none.status).toBe(409);
    expect(await reasonOf(none)).toMatch(/Which kind of expense/);
    const food = await as(desk, "POST", "/cashier-shift/movements",
      { kind: "expense", amount: 90, reason: `${TAG} none`, category: "Food" });
    expect(food.status).toBe(409);
    const cashIn = await as(desk, "POST", "/cashier-shift/movements",
      { kind: "top_up", amount: 90, reason: `${TAG} none`, category: "Office" });
    expect(await reasonOf(cashIn)).toMatch(/Only money paid out/);
    expect(await sql("select 1 from cashier_movements where reason = $1", [`${TAG} none`])).toHaveLength(0);
  });

  it("is recorded with its category, and shown with it", async () => {
    const desk = people["front_desk"]!;
    const res = await as(desk, "POST", "/cashier-shift/movements",
      { kind: "expense", amount: 250, reason: `${TAG} courier`, category: "Office" });
    expect(res.status, await res.clone().text()).toBe(200);
    ids["desk"] = ((await res.json()) as { id: string }).id;
    const d = (await (await as(desk, "GET", "/cashier-shift")).json()) as
      { shift: { movements: { id: string; category: string | null; photo: boolean }[] } };
    expect(d.shift.movements.find((m) => m.id === ids["desk"])).toMatchObject({ category: "Office", photo: false });
  });

  it("takes a photo of its bill afterwards, and gives the same bytes back", async () => {
    const desk = people["front_desk"]!;
    const path = `/cashier-shift/movements/${ids["desk"]}/photo`;
    expect((await upload(desk, path, Buffer.from("not a bill"), "text/plain")).status).toBe(409);
    const put = await upload(desk, path, PNG, "image/png");
    expect(put.status, await put.clone().text()).toBe(200);
    const got = await app.request(`/api/hotels/5EL${path}`, { headers: { "x-dev-staff-id": people["gm"]! } });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    const d = (await (await as(desk, "GET", "/cashier-shift")).json()) as
      { shift: { movements: { id: string; photo: boolean }[] } };
    expect(d.shift.movements.find((m) => m.id === ids["desk"])!.photo).toBe(true);
  });

  it("refuses the photo to who does not run a drawer, and on money in", async () => {
    const path = `/cashier-shift/movements/${ids["desk"]}/photo`;
    expect((await upload(people["housekeeping"]!, path, PNG, "image/jpeg")).status).toBe(403);
    const cashIn = await as(people["front_desk"]!, "POST", "/cashier-shift/movements",
      { kind: "top_up", amount: 10, reason: `${TAG} change` });
    const { id } = (await cashIn.json()) as { id: string };
    const res = await upload(people["front_desk"]!, `/cashier-shift/movements/${id}/photo`, PNG, "image/png");
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/No such expense/);
  });

  it("the desk's drawer refuses any other word, and a category on money in", async () => {
    const [shift] = await sql<{ id: string; hotel: string }>(
      "select id::text, hotel_id::text as hotel from cashier_shifts where staff_id = $1", [people["front_desk"]]);
    for (const [kind, category] of [["expense", "Food"], ["top_up", "Office"]]) {
      await expect(sql(
        `insert into cashier_movements (hotel_id, shift_id, kind, amount, reason, recorded_by, category)
         values ($1, $2, $3, 1, $4, $5, $6)`, [shift!.hotel, shift!.id, kind, `${TAG} db`, people["front_desk"], category]))
        .rejects.toThrow(/category_known/);
    }
  });
});

describe("the restaurant's paid-out (Close restaurant day, Cash)", () => {
  it("is refused without a category, and recorded with one, with its photo", async () => {
    const gm = people["gm"]!;
    const none = await as(gm, "POST", "/till/day-end/movements",
      { outlet: "REST", kind: "expense", amount: 80, reason: `${TAG} veg` });
    expect(none.status).toBe(409);
    expect(await reasonOf(none)).toMatch(/Which kind of expense/);
    expect(await sql("select 1 from pos_cash_movements where reason = $1", [`${TAG} veg`])).toHaveLength(0);

    const res = await as(gm, "POST", "/till/day-end/movements",
      { outlet: "REST", kind: "expense", amount: 80, reason: `${TAG} veg`, category: "Kitchen" });
    expect(res.status, await res.clone().text()).toBe(200);
    ids["till"] = ((await res.json()) as { id: string }).id;
    const path = `/till/day-end/movements/${ids["till"]}/photo`;
    expect((await upload(gm, path, PNG, "image/png")).status).toBe(200);
    const got = await app.request(`/api/hotels/5EL${path}`, { headers: { "x-dev-staff-id": gm } });
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    const day = (await (await as(gm, "GET", "/till/day-end?outlet=REST")).json()) as
      { movements: { id: string; category: string | null; photo: boolean }[] };
    expect(day.movements.find((m) => m.id === ids["till"])).toMatchObject({ category: "Kitchen", photo: true });
  });
});

type Doc = { sections: { key: string; rows: { kind: string; cells: Record<string, string | number | null> }[] }[] };

describe("the Petty cash report", () => {
  it("lists both places, and its totals count only what is approved", async () => {
    /* The desk's courier is approved by the GM; the tin's veg waits. */
    const [ap] = await sql<{ id: string }>(
      "select id::text from approvals where subject_id = $1", [ids["desk"]]);
    expect((await as(people["gm"]!, "POST", `/approvals/${ap!.id}/approved`, {})).status).toBe(200);

    const res = await as(people["finance"]!, "GET", "/reports/petty-cash");
    expect(res.status, await res.clone().text()).toBe(200);
    const doc = (await res.json()) as Doc;
    const byDay = doc.sections.find((s) => s.key === "by-day")!.rows;
    const courier = byDay.find((r) => r.cells["reason"] === `${TAG} courier`)!;
    const veg = byDay.find((r) => r.cells["reason"] === `${TAG} veg`)!;
    expect(courier.cells).toMatchObject({ place: "Front desk", category: "Office", amount: 250, approval: "Approved", photo: "Yes" });
    expect(veg.cells).toMatchObject({ category: "Kitchen", amount: 80, approval: "Waiting", photo: "Yes" });
    expect(veg.cells["place"]).not.toBe("Front desk");

    /* The grand total is the counted lines' sum: the waiting veg is out. */
    const lines = byDay.filter((r) => r.kind === "row");
    const counted = lines.filter((r) => r.cells["approval"] === "Approved" || r.cells["approval"] === "Not asked")
      .reduce((s, r) => s + Number(r.cells["amount"]), 0);
    const grand = byDay.find((r) => r.kind === "total" && r.cells["date"] === "Total")!;
    expect(grand.cells["amount"]).toBeCloseTo(counted, 2);
    expect(lines.reduce((s, r) => s + Number(r.cells["amount"]), 0) - counted).toBeGreaterThanOrEqual(80);

    const byCat = doc.sections.find((s) => s.key === "by-category")!.rows;
    const kitchen = byCat.find((r) => r.cells["category"] === "Kitchen")!;
    expect(Number(kitchen.cells["waiting"])).toBeGreaterThanOrEqual(80);
    const all = byCat.find((r) => r.kind === "total")!;
    expect(all.cells["counted"]).toBeCloseTo(counted, 2);
  });

  it("is refused to the revenue manager, on screen and as a file (D27-147, as Cashier shift)", async () => {
    expect((await as(people["revenue_manager"]!, "GET", "/reports/petty-cash")).status).toBe(403);
    expect((await as(people["revenue_manager"]!, "GET", "/reports/petty-cash.csv")).status).toBe(403);
    const csv = await as(people["finance"]!, "GET", "/reports/petty-cash.csv");
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain(`${TAG} courier`);
  });
});
