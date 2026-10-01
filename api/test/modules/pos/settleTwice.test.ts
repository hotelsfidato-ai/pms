import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE BILL, TWO SETTLE PRESSES AT ONCE (28 September, the release review)

   Both used to read the order as open and both wrote their payments: one
   bill, two sets of tenders. The order is now locked where it is read, so
   the second press waits, finds it settled, and writes nothing. Sent
   together, not one after the other: in sequence the second always saw
   "settled" and the bug never showed - and the first version of this
   test passed on the broken code for that reason (see the warm-up).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "SETTLETWICE";
let owner = "";
let tikka = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const post = (path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const res = await app.request("/api/hotels/5EL/till/menu", { headers: { "x-dev-staff-id": owner } });
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  /* Cash only once the day is open, its float counted (D27-190). */
  putAwayTillDay = await openTillDay("5EL");
});
let putAwayTillDay: () => Promise<void>;

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.end();
  }
  await closePool();
});

describe("two Settle presses on one bill", () => {
  it("take the money once: one is settled, the other refused, one tender", async () => {
    const opened = await post("/till/orders", { outlet: "REST", table: `${TAG} 1` });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { id } = (await opened.json()) as { id: string };
    expect((await post(`/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);

    /* Connections open and idle first. Otherwise the first press takes the
       one idle connection and settles while the second is still opening
       its own - one after the other, which is the case that always passed. */
    await Promise.all([1, 2, 3, 4].map(() =>
      app.request("/api/hotels/5EL/till/menu", { headers: { "x-dev-staff-id": owner } })));

    const [a, b] = await Promise.all([
      post(`/till/orders/${id}/settle`, { method: "cash" }),
      post(`/till/orders/${id}/settle`, { method: "card" }),
    ]);
    const answers = [
      { status: a.status, body: (await a.json()) as { reason?: string } },
      { status: b.status, body: (await b.json()) as { reason?: string } },
    ].sort((x, y) => x.status - y.status);

    expect(answers.map((x) => x.status)).toEqual([200, 409]);
    expect(answers[1]!.body.reason).toBe("This order is already settled.");
    const [t] = await sql<{ n: number }>(
      "select count(*)::int as n from pos_order_tenders where order_id = $1", [id]);
    expect(t!.n, "two sets of payments for one bill").toBe(1);
  });
});
