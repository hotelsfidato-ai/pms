import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A CASH EXPENSE WAITS FOR A YES - the owner's D27-239 and D27-242

   Every paid-out from a drawer - the desk's or an outlet's tin - waits in
   the approvals inbox for the GM's or the owner's yes (not an
   administrator's; nobody approves their own). While it waits it is not
   taken off the drawer's expected cash; the close asks a reason only for
   what the waiting paid-outs do not explain. A yes makes it count, even
   after the close; a refusal leaves it a shortage, and nothing more.
   Everything is tagged CASHEXP and put away afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CASHEXP";
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
const move = (who: string, kind: string, amount: number, reason: string) =>
  as(who, "POST", "/cashier-shift/movements",
    { kind, amount, reason: `${TAG} ${reason}`, ...(kind === "expense" ? { category: "Office" } : {}) });
const drawer = async (who: string) => (await (await as(who, "GET", "/cashier-shift")).json()) as {
  shift: { id: string; expected: number; waiting: number;
           movements: { reason: string; approval: string | null; approvalNote: string | null }[] } | null;
};
const approvalFor = async (reason: string) => (await sql<{ id: string; status: string; reason: string }>(
  `select a.id::text, a.status, a.reason from approvals a
     join cashier_movements m on m.id = a.subject_id and a.subject_table = 'cashier_movements'
    where m.reason = $1`, [`${TAG} ${reason}`]))[0];
const decide = (who: string, id: string, decision: string, note?: string) =>
  as(who, "POST", `/approvals/${id}/${decision}`, note ? { note } : {});
const expectedOf = async (shiftId: string) => Number((await sql<{ e: string }>(
  "select app.cashier_expected_cash($1)::text as e", [shiftId]))[0]!.e);

beforeAll(async () => {
  for (const role of ["front_desk", "gm", "admin"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`cashexp-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-cashexp-${role}`]);
    people[role] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
      [p!.id, role]);
  }
});

afterAll(async () => {
  const ids = Object.values(people);
  await sql(`delete from approvals where subject_id in (
               select id from cashier_movements where reason like $1
               union all select id from pos_cash_movements where reason like $1)`, [`${TAG}%`]);
  await sql("delete from cashier_shifts where staff_id = any($1)", [ids]);
  await sql("delete from pos_cash_movements where reason like $1", [`${TAG}%`]);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("a paid-out from the desk's drawer (D27-242)", () => {
  let shiftId = "";

  it("waits for a yes, and is not taken off the drawer meanwhile", async () => {
    const desk = people["front_desk"]!;
    expect((await move(desk, "top_up", 1000, "change from the safe")).status).toBe(200);
    expect((await move(desk, "expense", 200, "taxi")).status).toBe(200);
    const d = (await drawer(desk)).shift!;
    shiftId = d.id;
    expect([d.expected, d.waiting]).toEqual([1000, 200]);
    expect(d.movements.find((m) => m.reason === `${TAG} taxi`)!.approval).toBe("pending");
    /* Money in needs nobody's yes. */
    expect(d.movements.find((m) => m.reason === `${TAG} change from the safe`)!.approval).toBeNull();
    const ap = await approvalFor("taxi");
    expect(ap!.reason).toBe(`Front desk drawer: ${TAG} taxi`);
  });

  it("asks a reason at the close only for what the waiting paid-out does not explain", async () => {
    const desk = people["front_desk"]!;
    /* 700 in the drawer: 1000 - 200 waiting = 800, so 100 is unexplained. */
    expect((await as(desk, "POST", "/cashier-shift/count",
      { denominations: [{ value: 500, count: 1 }, { value: 100, count: 2 }] })).status).toBe(200);
    const short = await as(desk, "POST", "/cashier-shift/close", { keptCash: 0 });
    expect(short.status).toBe(409);
    expect(((await short.json()) as { reason: string }).reason).toMatch(/short by 100\.00, beyond the paid-outs/);
    /* 800: the waiting 200 explains the whole difference. */
    expect((await as(desk, "POST", "/cashier-shift/count",
      { denominations: [{ value: 500, count: 1 }, { value: 100, count: 3 }] })).status).toBe(200);
    const closed = await as(desk, "POST", "/cashier-shift/close", { keptCash: 0 });
    expect(closed.status, await closed.clone().text()).toBe(200);
  });

  it("is not an administrator's to approve; the GM's yes makes it count, even after the close", async () => {
    const ap = await approvalFor("taxi");
    expect((await decide(people["admin"]!, ap!.id, "approved")).status).toBe(409);
    expect(await expectedOf(shiftId)).toBe(1000);
    const yes = await decide(people["gm"]!, ap!.id, "approved");
    expect(yes.status, await yes.clone().text()).toBe(200);
    expect(await expectedOf(shiftId)).toBe(800);
  });

  it("refused, stays a shortage and is shown with the refusal's words", async () => {
    const desk = people["front_desk"]!;
    expect((await move(desk, "expense", 150, "lunch")).status).toBe(200);
    const ap = await approvalFor("lunch");
    const no = await decide("dev-owner", ap!.id, "rejected", "Not a hotel expense");
    expect(no.status, await no.clone().text()).toBe(200);
    const d = (await drawer(desk)).shift!;
    const line = d.movements.find((m) => m.reason === `${TAG} lunch`)!;
    expect([line.approval, line.approvalNote]).toEqual(["rejected", "Not a hotel expense"]);
    /* Not taken off, and not waiting either: a shortage at the count. */
    expect([d.expected, d.waiting]).toEqual([0, 0]);
  });

  it("is never approved by the person who paid it: the GM's own goes to the owner", async () => {
    const gm = people["gm"]!;
    expect((await move(gm, "expense", 80, "courier")).status).toBe(200);
    const ap = await approvalFor("courier");
    expect((await decide(gm, ap!.id, "approved")).status).toBe(409);
    expect((await decide("dev-owner", ap!.id, "approved")).status).toBe(200);
  });
});

describe("a paid-out from a restaurant's tin (D27-242)", () => {
  it("waits for a yes too, and the day's expected leaves it out until then", async () => {
    /* The GM: reception's use of the till is a per-hotel switch (14 Sep). */
    const desk = people["gm"]!;
    const before = (await (await as(desk, "GET", "/till/day-end?outlet=REST")).json()) as
      { cash: { expected: number; waiting: number } };
    const res = await as(desk, "POST", "/till/day-end/movements",
      { outlet: "REST", kind: "expense", amount: 120, reason: `${TAG} vegetables`, category: "Kitchen" });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = (await (await as(desk, "GET", "/till/day-end?outlet=REST")).json()) as
      { cash: { expected: number; waiting: number } };
    expect(after.cash.expected).toBe(before.cash.expected);
    expect(after.cash.waiting).toBe(before.cash.waiting + 120);
    const [ap] = await sql<{ id: string; reason: string }>(
      `select a.id::text, a.reason from approvals a
         join pos_cash_movements m on m.id = a.subject_id and a.subject_table = 'pos_cash_movements'
        where m.reason = $1`, [`${TAG} vegetables`]);
    expect(ap!.reason).toMatch(new RegExp(`tin: ${TAG} vegetables$`));
    /* The GM paid it, so the owner says yes. */
    expect((await decide("dev-owner", ap!.id, "approved")).status).toBe(200);
    const yes = (await (await as(desk, "GET", "/till/day-end?outlet=REST")).json()) as
      { cash: { expected: number } };
    expect(yes.cash.expected).toBe(before.cash.expected - 120);
  });
});
