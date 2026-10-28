import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   BILL HISTORY (the owner's D27-370, 27 October)

   The Till's earlier-bills route over a range of dates, narrowed by
   number, table, guest (name or phone), payment mode, waiter and outlet:
   paid, VOID and NC bills, capped and saying so. The old `date` and `no`
   still answer. Everything is named BILLHIST and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "BILLHIST";
let owner = "";
let gm = "";
let waiter = "";
let outsider = "";
let accountant = "";
let reception = "";
let viewer = "";
let tikka = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : {
        method: "POST",
        headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

interface Bill {
  id: string; orderNo: string; status: string; table: string | null; businessDate: string;
  payable: number; modes: string[]; waiter: string | null; guest: string | null; phone: string | null;
  outlet: string; settledAt: string | null; stayGuest: string | null; room: string | null;
}
interface Answer { bills: Bill[]; capped: boolean; cap: number; outlets: { code: string; name: string }[] }
const history = async (query: string, who = owner): Promise<Answer> => {
  const res = await call(who, `/till/bills?${query}&table=${TAG}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Answer;
};
const nos = (a: Answer) => a.bills.map((b) => b.table!.replace(`${TAG} `, "")).sort();

/** A bill of one Paneer Tikka on `table`, opened by `by`, with a guest if given. */
async function bill(table: string, by: string, guest?: [string, string]): Promise<{ id: string; orderNo: string }> {
  const opened = await call(by, "/till/orders", { outlet: "REST", table: `${TAG} ${table}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(by, `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  expect((await call(by, `/till/orders/${id}/kot`, {})).status).toBe(200);
  if (guest) {
    await sql("update pos_orders set customer_name = $2, customer_phone = $3 where id = $1", [id, guest[0], guest[1]]);
  }
  const [o] = await sql<{ order_no: string }>("select order_no from pos_orders where id = $1", [id]);
  return { id, orderNo: o!.order_no };
}
const pay = async (id: string, body: Record<string, unknown>) => {
  const res = await call(owner, `/till/orders/${id}/settle`, body);
  expect(res.status, await res.clone().text()).toBe(200);
};
const moveBack = (id: string, days: number) =>
  sql("update pos_orders set business_date = business_date - $2::int where id = $1", [id, days]);

let today = "";
const day = async (back: number) =>
  (await sql<{ d: string }>("select to_char($1::date - $2::int, 'YYYY-MM-DD') as d", [today, back]))[0]!.d;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true, full_name = excluded.full_name returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("billhist-gm@fidato.in", `${TAG} Manager`, "gm");
  waiter = await person("billhist-waiter@fidato.in", `${TAG} Waiter`, "pos");
  outsider = await person("billhist-outsider@fidato.in", `${TAG} Outsider`, "housekeeping");
  accountant = await person("billhist-accountant@fidato.in", `${TAG} Accountant`, "finance");
  reception = await person("billhist-reception@fidato.in", `${TAG} Reception`, "front_desk");
  viewer = await person("billhist-viewer@fidato.in", `${TAG} Viewer`, "read_only");
  const menu = (await (await call(owner, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
  today = (await sql<{ d: string }>("select to_char(app.business_date(id), 'YYYY-MM-DD') as d from hotels where code = '5EL'"))[0]!.d;
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query(
      "delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)", [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, outsider, accountant, reception, viewer]]);
  } finally {
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("Bill history: the Till's earlier-bills route over a range", () => {
  let a: { id: string; orderNo: string };
  let b: { id: string; orderNo: string };
  let c: { id: string; orderNo: string };
  let d: { id: string; orderNo: string };

  it("lists paid, VOID and NC bills of a range, with who, how and how much", async () => {
    a = await bill("a", owner, ["Asha Rao", "98765 43210"]);
    b = await bill("b", waiter, ["Bilal Khan", "+91 91234 56789"]);
    c = await bill("c", owner);
    d = await bill("d", owner);
    await pay(a.id, { method: "upi" });
    const owed = ((await (await call(owner, `/till/orders/${b.id}`)).json()) as { payable: number }).payable;
    await pay(b.id, { method: "split", tenders: [
      { method: "card", amount: 100 }, { method: "cash", amount: owed - 100, tendered: owed - 100 },
    ] });
    expect((await call(gm, `/till/orders/${c.id}/no-charge`, { reason: "Staff meal" })).status).toBe(200);
    await pay(d.id, { method: "card" });
    expect((await call(gm, `/till/orders/${d.id}/void`, { reason: "Wrong table", reference: "APPR 1" })).status).toBe(200);
    /* a, b and c go to earlier days. */
    await moveBack(a.id, 3);
    await moveBack(b.id, 8);
    await moveBack(c.id, 12);

    const all = await history(`from=${await day(30)}&to=${today}`);
    expect(nos(all)).toEqual(["a", "b", "c", "d"]);
    const by = (t: string) => all.bills.find((x) => x.table === `${TAG} ${t}`)!;
    expect(by("a")).toMatchObject({ status: "settled", modes: ["upi"], waiter: expect.any(String), guest: "Asha Rao",
      phone: "98765 43210", outlet: "REST", businessDate: await day(3) });
    expect(by("a").payable).toBeGreaterThan(0);
    /* The time it was settled, not opened (D27-372); an NC bill's is when it was given. */
    for (const t of ["a", "b", "c", "d"]) expect(by(t).settledAt, t).toMatch(/^\d\d:\d\d$/);
    expect(by("a")).toMatchObject({ stayGuest: null, room: null });
    expect(by("b")).toMatchObject({ modes: ["card", "cash"], waiter: `${TAG} Waiter` });
    expect(by("c").status).toBe("no_charge");
    expect(by("d")).toMatchObject({ status: "void", modes: ["card"] });
    expect(all.outlets.map((o) => o.code)).toContain("REST");
    expect(all.capped).toBe(false);
  });

  it("takes a range: either end may be left off, a day alone is that day, the old date= still answers", async () => {
    expect(nos(await history(`from=${await day(9)}&to=${await day(2)}`))).toEqual(["a", "b"]);
    expect(nos(await history(`from=${await day(4)}`))).toEqual(["a", "d"]);
    expect(nos(await history(`to=${await day(10)}`))).toEqual(["c"]);
    expect(nos(await history(`date=${await day(8)}`))).toEqual(["b"]);
    expect(nos(await history(`date=${await day(8)}&from=${await day(30)}`)), "date wins, as the Till has it").toEqual(["b"]);
  });

  it("keeps the Till's own two ways: a day alone, a bill number alone", async () => {
    const byDay = await call(owner, `/till/bills?date=${await day(12)}`);
    const found = ((await byDay.json()) as Answer).bills.find((x) => x.id === c.id);
    expect(found).toMatchObject({ orderNo: c.orderNo, status: "no_charge", gross: expect.any(Number), openedAt: expect.any(String) });
    const byNo = await call(owner, `/till/bills?no=${encodeURIComponent(a.orderNo.slice(-5))}`);
    expect(((await byNo.json()) as Answer).bills.map((x) => x.id)).toContain(a.id);
    const neither = await call(owner, "/till/bills");
    expect(neither.status).toBe(409);
    expect(((await neither.json()) as { reason: string }).reason).toBe("Pick a day, or type the bill's number.");
  });

  it("narrows by bill number, table, guest name, guest phone however it was typed, mode, waiter and outlet", async () => {
    const wide = `from=${await day(30)}&to=${today}`;
    expect(nos(await history(`${wide}&no=${encodeURIComponent(b.orderNo)}`))).toEqual(["b"]);
    const tbl = await call(owner, `/till/bills?${wide}&table=${encodeURIComponent(TAG + " c")}`);
    expect(((await tbl.json()) as Answer).bills.map((x) => x.id)).toEqual([c.id]);
    expect(nos(await history(`${wide}&guest=asha`))).toEqual(["a"]);
    expect(nos(await history(`${wide}&guest=KHAN`))).toEqual(["b"]);
    expect(nos(await history(`${wide}&guest=${encodeURIComponent("98765 43210")}`))).toEqual(["a"]);
    expect(nos(await history(`${wide}&guest=9876543210`)), "digits, however the phone was stored").toEqual(["a"]);
    expect(nos(await history(`${wide}&guest=${encodeURIComponent("91234 56789")}`))).toEqual(["b"]);
    expect(nos(await history(`${wide}&mode=upi`))).toEqual(["a"]);
    expect(nos(await history(`${wide}&mode=cash`)), "a split bill is found by either part").toEqual(["b"]);
    expect(nos(await history(`${wide}&mode=card`))).toEqual(["b", "d"]);
    expect(nos(await history(`${wide}&waiter=${waiter}`))).toEqual(["b"]);
    expect(nos(await history(`${wide}&waiter=${owner}`))).toEqual(["a", "c", "d"]);
    expect(nos(await history(`${wide}&outlet=rest`))).toEqual(["a", "b", "c", "d"]);
    expect(nos(await history(`${wide}&outlet=BAR`))).toEqual([]);
    expect(nos(await history(`${wide}&mode=card&waiter=${owner}`))).toEqual(["d"]);
    /* Typed % and _ are letters, not wildcards. */
    expect(nos(await history(`${wide}&guest=${encodeURIComponent("%")}`))).toEqual([]);
  });

  it("refuses what makes no sense, with a sentence", async () => {
    const refused = async (q: string) => {
      const res = await call(owner, `/till/bills?${q}`);
      expect(res.status).toBe(409);
      return ((await res.json()) as { reason: string }).reason;
    };
    expect(await refused("from=2026-02-31")).toBe("Dates are written 2026-10-27.");
    expect(await refused("from=2026-10-20&to=2026-10-01")).toBe("The first date is after the last.");
    expect(await refused(`from=${today}&mode=cheque`)).toBe("Not a way of paying.");
    expect(await refused(`from=${today}&waiter=not-an-id`)).toBe("Not a waiter.");
    expect(await refused(`from=${today}&guest=${"x".repeat(61)}`)).toBe("That is too long to search for.");
    expect(await refused("outlet=REST"), "a filter alone is not a question").toBe("Pick a day, or type the bill's number.");
  });

  it("stops at its cap and says so", async () => {
    const wide = `from=${await day(30)}&to=${today}`;
    const cut = await history(`${wide}&limit=3`);
    expect(cut.bills).toHaveLength(3);
    expect([cut.capped, cut.cap]).toEqual([true, 3]);
    const exact = await history(`${wide}&limit=4`);
    expect([exact.bills.length, exact.capped]).toEqual([4, false]);
    expect((await history(`${wide}&limit=99999`)).cap, "limit can only ask for fewer").toBe(500);
  });

  it("is for the people who may list the Till's bills, not a housekeeper", async () => {
    const res = await call(outsider, `/till/bills?from=${today}&to=${today}`);
    expect(res.status).toBe(403);
  });

  it("a range or a filter is the managers', the Accountant's and Reception's only (D27-372)", async () => {
    /* Reception where the hotel lets Reception use the POS (087), as for the Till. */
    const [was] = await sql<{ on: boolean }>(
      `select is_enabled as on from hotel_modules where module = 'reception_pos'
          and hotel_id = (select id from hotels where code = '5EL')`);
    await sql(`insert into hotel_modules (hotel_id, module, is_enabled) select id, 'reception_pos', true from hotels where code = '5EL'
               on conflict (hotel_id, module) do update set is_enabled = true`);
    try {
      for (const who of [owner, gm, accountant, reception]) {
        expect((await call(who, `/till/bills?from=${today}&to=${today}`)).status, who).toBe(200);
      }
    } finally {
      await (was
        ? sql(`update hotel_modules set is_enabled = $1 where module = 'reception_pos'
                 and hotel_id = (select id from hotels where code = '5EL')`, [was.on])
        : sql(`delete from hotel_modules where module = 'reception_pos'
                 and hotel_id = (select id from hotels where code = '5EL')`));
    }
    const WHO = "Bill history is for the managers, the Accountant and Reception. On the Till, look up one day's bills or a bill's number.";
    for (const q of [`from=${today}&to=${today}`, `to=${today}`, `date=${today}&table=${TAG}`, `date=${today}&guest=asha`,
                     `date=${today}&mode=cash`, `date=${today}&waiter=${waiter}`, `date=${today}&outlet=REST`]) {
      for (const who of [waiter, viewer]) {
        const r = await call(who, `/till/bills?${q}`);
        expect(r.status, `${who} ${q}`).toBe(403);
        expect(((await r.json()) as { error: string }).error).toBe(WHO);
      }
    }
    /* The waiter keeps the Till's own two: a day, and a bill's number. */
    expect((await call(waiter, `/till/bills?date=${today}`)).status).toBe(200);
    const byNo = await call(waiter, `/till/bills?no=${encodeURIComponent(d.orderNo)}`);
    expect(byNo.status).toBe(200);
    expect(((await byNo.json()) as Answer).bills.map((x) => x.id)).toContain(d.id);
  });

  it("a bill charged to a room shows the stay's guest and room, and is found by either (D27-372)", async () => {
    const rooms = (await (await call(owner, "/till/rooms")).json()) as {
      rooms: { room: string; guest: string; folioId: string }[] };
    const target = rooms.rooms[0]!;
    const r = await bill("room", owner);
    await pay(r.id, { method: "room", room: target.room, folioId: target.folioId });
    const wide = `from=${today}&to=${today}`;
    const [found] = (await history(wide)).bills.filter((x) => x.id === r.id);
    expect(found).toMatchObject({ stayGuest: target.guest, room: target.room, guest: null, modes: ["room"] });
    expect(found!.settledAt).toMatch(/^\d\d:\d\d$/);
    expect((await history(`${wide}&guest=${encodeURIComponent(target.guest.slice(0, 4))}`)).bills.map((x) => x.id)).toContain(r.id);
    expect((await history(`${wide}&guest=${encodeURIComponent(target.room)}`)).bills.map((x) => x.id)).toContain(r.id);
  });
});
