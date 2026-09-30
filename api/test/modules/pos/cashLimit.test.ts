import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";
import { PAN_NEEDED } from "../../../src/modules/finance/cashLimit.ts";

/* ══════════════════════════════════════════════════════════════════
   CASH AT THE TILL, PER BILL (the owner's D25-40, 26 September)

   ₹2,00,000 or more in cash on one bill is refused (Income-tax Act 2025
   s.186); more than ₹1,00,000 in cash asks for the PAN, Form 97, or "guest
   from abroad" (Rule 159). A refused bill stays open with nothing taken.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CASHTEST";
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

/** An open bill of `qty` Paneer Tikka (₹320 + 5%), and what it comes to. */
async function bill(label: string, qty: number): Promise<{ id: string; payable: number }> {
  const opened = await post("/till/orders", { outlet: "REST", table: `${TAG} ${label}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  const added = await post(`/till/orders/${id}/lines`, { itemId: tikka, qty });
  expect(added.status, await added.clone().text()).toBe(200);
  const [t] = await sql<{ payable: string }>("select payable::text from app.pos_order_total($1)", [id]);
  return { id, payable: Number(t!.payable) };
}

const order = async (id: string) => (await sql<{
  status: string; pan: string | null; form_97: boolean; non_resident: boolean; tenders: number;
}>(`select o.status, o.pan, o.form_97, o.non_resident,
           (select count(*)::int from pos_order_tenders t where t.order_id = o.id) as tenders
      from pos_orders o where o.id = $1`, [id]))[0]!;

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

describe("cash on one restaurant bill", () => {
  it("is refused at ₹2,00,000 or more, and the bill stays open with nothing taken", async () => {
    const b = await bill("two lakh", 600);                        // 600 x 336 = 2,01,600
    const res = await post(`/till/orders/${b.id}/settle`, { method: "cash", pan: "ABCDE1234F" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(
      "Cash of ₹2,00,000 or more from one guest is not allowed (Income-tax Act s.186). "
      + "Take less than ₹2,00,000 in cash. Take the rest by card or UPI, or charge the bill to the room.");
    expect(await order(b.id)).toMatchObject({ status: "open", tenders: 0 });
  });

  it("takes part in cash with the PAN and the rest by card", async () => {
    const b = await bill("split", 600);
    const res = await post(`/till/orders/${b.id}/settle`, {
      tenders: [{ method: "cash", amount: 150000 }, { method: "card", amount: b.payable - 150000 }],
      pan: "abcde1234f",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await order(b.id)).toMatchObject({ status: "settled", pan: "ABCDE1234F", tenders: 2 });
  });

  it("above ₹1,00,000 asks for the PAN, and takes Form 97 or a guest from abroad instead", async () => {
    const b = await bill("pan", 330);                            // 330 x 336 = 1,10,880
    const asked = await post(`/till/orders/${b.id}/settle`, { method: "cash" });
    expect(asked.status).toBe(409);
    expect(await asked.json()).toMatchObject({ ok: false, reason: PAN_NEEDED, needs: "pan" });
    expect(await order(b.id)).toMatchObject({ status: "open", tenders: 0 });

    expect((await post(`/till/orders/${b.id}/settle`, { method: "cash", nonResident: true })).status)
      .toBe(200);
    expect(await order(b.id)).toMatchObject({ status: "settled", pan: null, non_resident: true });

    const c = await bill("form 97", 330);
    expect((await post(`/till/orders/${c.id}/settle`, { method: "cash", form97: true })).status)
      .toBe(200);
    expect(await order(c.id)).toMatchObject({ status: "settled", form_97: true });
  });

  it("does not ask below ₹1,00,000, and never for a card", async () => {
    const b = await bill("small", 10);
    expect((await post(`/till/orders/${b.id}/settle`, { method: "cash" })).status).toBe(200);
    const c = await bill("card", 330);
    expect((await post(`/till/orders/${c.id}/settle`, { method: "card" })).status).toBe(200);
    expect(await order(c.id)).toMatchObject({ status: "settled", pan: null, form_97: false });
  });
});
