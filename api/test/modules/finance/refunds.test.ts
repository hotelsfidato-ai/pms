import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A REFUND ON A GUEST'S OWN BILL (the owner's D27-315 Part B)

   A property of its own (RFD), so every report figure here is this
   file's. The stay: a room of ₹3,000, paid ₹25,000 in cash and ₹2,000
   by UPI - ₹24,000 owed back.

   - only the owner, an administrator, the GM or the accountant (403 for
     reception and the hotel manager, and nothing written);
   - back by the way paid: never by card when nothing was paid by card,
     never more by UPI than UPI paid;
   - cash only below ₹20,000 on the bill, a bank transfer above;
   - a reference for anything but cash, and a reason always;
   - a cash refund comes out of the drawer of whoever gives it;
   - the Manager report, the Night audit report, the cashier report and
     the Folios page (money owed) all move by the same money out;
   - a plain refund receipt.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "RFD";
let hotelId = "";
let today = "";
let stay = "";
let folio = "";
const people: Record<string, string> = {};

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": who,
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const refund = (who: string, body: Record<string, unknown>) =>
  call(who, `/stays/${stay}/refunds`, "POST", { reason: "Left a day early", ...body });

const refundRows = async () =>
  (await sql<{ n: number }>(
    `select count(*)::int as n from folio_postings where folio_id = $1 and category = 'refund'`, [folio]))[0]!.n;

type Row = { kind: string; cells: Record<string, unknown> };
type Doc = { sections: { key: string; rows: Row[] }[] };
const report = async (name: string) => {
  const res = await call("dev-owner", `/reports/${name}?asOn=${today}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Doc;
};

/** The money each report says the hotel kept today, by way: Manager
    (Payment, today), Night audit (Receipt by payment method), cashier. */
async function figures() {
  const manager = await report("manager");
  const pay = manager.sections.find((s) => s.key === "payment")!.rows;
  const gl = manager.sections.find((s) => s.key === "guest-ledger")!.rows;
  const m = (label: string) => Number(pay.find((r) => r.cells["label"] === label)?.cells["today"] ?? 0);
  const night = await report("night-audit");
  const by = night.sections.find((s) => s.key === "receipt-by-method")!.rows;
  const n = (label: string) => Number(by.find((r) => r.cells["method"] === label)?.cells["amount"] ?? 0);
  const cashierRes = await call("dev-owner", `/reports/cashier-shift?from=${today}&to=${today}`);
  const cashier = (await cashierRes.json()) as { rows: { method: string; amount: number }[] };
  const c = (method: string) => cashier.rows.filter((r) => r.method === method).reduce((t, r) => t + r.amount, 0);
  const foliosRes = await call("dev-owner", "/folios");
  const list = (await foliosRes.json()) as { stayId: string; balance: number }[];
  return {
    manager: { cash: m("Cash"), upi: m("UPI"), transfer: m("Bank Transfer"),
               settled: Number(gl.find((r) => r.cells["label"] === "Settlement by Guest")!.cells["today"]),
               closing: Number(gl.find((r) => String(r.cells["label"]).startsWith("Closing Balance"))!.cells["today"]) },
    night: { cash: n("Cash"), upi: n("UPI"), transfer: n("Bank Transfer") },
    cashier: { cash: c("cash"), upi: c("upi"), transfer: c("bank_transfer") },
    owed: list.find((f) => f.stayId === stay)?.balance ?? null,
  };
}

let before: Awaited<ReturnType<typeof figures>>;

beforeAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!;
    people["owner"] = owner.id;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1, 'Refund Test', 'Nowhere')::text as id", [CODE])).rows[0]!.id;
    await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 0)", [hotelId]);
    /* The hotel gives back above the cash ceiling by transfer. */
    await db.query(
      "insert into payment_methods (hotel_id, label, kind, sort_order) values ($1, 'Bank transfer', 'bank_transfer', 60)",
      [hotelId]);
    today = (await db.query<{ d: string }>("select app.business_date($1)::text as d", [hotelId])).rows[0]!.d;
    const guest = (await db.query<{ id: string }>(
      "insert into guests (full_name, nationality) values ('RFD Guest', 'IN') returning id::text")).rows[0]!.id;
    stay = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, status, source)
       values ($1, app.next_reference($1), $2,
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               app.business_date($1), app.business_date($1) + 1, 3000, 'checked_in', 'walk_in')
       returning id::text`, [hotelId, guest])).rows[0]!.id;
    folio = (await db.query<{ id: string }>(
      "insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text", [hotelId, stay])).rows[0]!.id;
    await db.query(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                   amount, tax_rate, tax_amount)
       values ($1, $2, app.business_date($1), 'room', 'Room', 3000, 0, 0)`, [hotelId, folio]);
    for (const role of ["front_desk", "hotel_manager", "gm", "finance"]) {
      const [p] = (await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true returning id::text`,
        [`rfd-${role}@fidato.in`, `RFD ${role}`, `test-uid-rfd-${role}`])).rows;
      people[role] = p!.id;
      await db.query("delete from staff_hotels where staff_id = $1", [p!.id]);
      await db.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)",
        [p!.id, hotelId, role]);
    }
    /* The GM's drawer holds a float of ₹20,000; the owner takes the cash in. */
    await db.query(
      `insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_by, opened_at)
       values ($1, $2, app.business_date($1), 20000, $2, now() - interval '1 hour')`, [hotelId, people["gm"]]);
    await db.query(
      `insert into cashier_shifts (hotel_id, staff_id, business_date, opening_cash, opened_by)
       values ($1, $2, app.business_date($1), 0, $2)`, [hotelId, owner.id]);
  } finally { await db.end(); }

  for (const [method, amount, pan] of [["Cash", 25000, undefined], ["UPI", 2000, undefined]] as const) {
    const res = await call(people["owner"]!, `/stays/${stay}/payments`, "POST",
      { method, amount, heldAsCredit: true, ...(pan ? { pan } : {}) });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  before = await figures();
}, 180_000);

afterAll(async () => {
  await closePool();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    }
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    }
    const mine = Object.entries(people).filter(([k]) => k !== "owner").map(([, v]) => v);
    await db.query("delete from staff_hotels where staff_id = any($1)", [mine]);
    await db.query("update staff set is_active = false where id = any($1)", [mine]);
    await db.end();
  }
}, 120_000);

describe("a refund on a guest's own bill", () => {
  it("starts ₹24,000 owed back, by the bill and the Folios page", async () => {
    expect(before.owed).toBe(-24000);
    const res = await call(people["gm"]!, `/stays/${stay}/refunds`);
    const body = (await res.json()) as { may: boolean; bills: { credit: number; ways: { label: string; upTo: number }[] }[] };
    expect(body.may).toBe(true);
    expect(body.bills[0]!.credit).toBe(24000);
    expect(body.bills[0]!.ways.map((w) => [w.label, w.upTo])).toEqual([
      ["Cash", 19999.99], ["UPI", 2000], ["Bank transfer", 24000]]);
  });

  it("is refused to reception and the hotel manager - 403, and nothing written", async () => {
    for (const role of ["front_desk", "hotel_manager"]) {
      const res = await refund(people[role]!, { method: "UPI", amount: 100, reference: "UPI 1" });
      expect(res.status, role).toBe(403);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/owner, an administrator, the general manager or the accountant/);
      const options = (await (await call(people[role]!, `/stays/${stay}/refunds`)).json()) as { may: boolean };
      expect(options.may, role).toBe(false);
    }
    expect(await refundRows()).toBe(0);
  });

  it("goes back the way it was paid: not by card, not more than UPI paid", async () => {
    const card = await refund(people["gm"]!, { method: "Credit Card", amount: 100, reference: "AUTH 1" });
    expect(card.status).toBe(409);
    expect(((await card.json()) as { reason: string }).reason).toMatch(/not paid by Credit Card.*never cash for a card or UPI/);
    const upi = await refund(people["gm"]!, { method: "UPI", amount: 2500, reference: "UPI 1" });
    expect(((await upi.json()) as { reason: string }).reason).toBe("At most ₹2,000.00 goes back by UPI on this bill.");
    expect(await refundRows()).toBe(0);
  });

  it("gives cash only below ₹20,000 on the bill, and says why", async () => {
    const res = await refund(people["gm"]!, { method: "Cash", amount: 20000 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/^Cash is given back only below ₹20,000 on a bill; give the rest by bank transfer\. This limit stands until the hotel's CA confirms it\.$/);
    expect(await refundRows()).toBe(0);
  });

  it("asks a reference for anything but cash, and a reason always", async () => {
    const noRef = await refund(people["finance"]!, { method: "UPI", amount: 2000 });
    expect(((await noRef.json()) as { reason: string }).reason).toMatch(/Give the reference/);
    const noWhy = await refund(people["finance"]!, { method: "UPI", amount: 2000, reference: "UPI 9", reason: " " });
    expect(((await noWhy.json()) as { reason: string }).reason).toMatch(/Say why/);
    expect(await refundRows()).toBe(0);
  });

  it("is given by the GM in cash and by the accountant by UPI", async () => {
    const cash = await refund(people["gm"]!, { method: "Cash", amount: 19000 });
    expect(cash.status, await cash.clone().text()).toBe(200);
    const upi = await refund(people["finance"]!, { method: "UPI", amount: 2000, reference: "UPI 4471" });
    expect(upi.status, await upi.clone().text()).toBe(200);
    const [line] = await sql<{ amount: string; description: string; method: string; reason: string; by: string }>(
      `select fp.amount::text, fp.description, rf.method, rf.reason, rf.refunded_by::text as by
         from folio_postings fp join refunds rf on rf.posting_id = fp.id
        where fp.folio_id = $1 and rf.method = 'upi'`, [folio]);
    expect(line).toEqual({ amount: "2000.00", description: "Refunded - UPI (UPI 4471)", method: "upi",
                           reason: "Left a day early", by: people["finance"] });
  });

  it("takes the cash out of the GM's drawer", async () => {
    const [d] = await sql<{ e: string }>(
      `select app.cashier_expected_cash(id)::text as e from cashier_shifts
        where staff_id = $1 and closed_at is null`, [people["gm"]]);
    expect(Number(d!.e)).toBe(1000);
  });

  it("keeps counting the cash already given back against the ceiling", async () => {
    const res = await refund(people["gm"]!, { method: "Cash", amount: 1000 });
    expect(((await res.json()) as { reason: string }).reason).toMatch(/^Cash is given back only below ₹20,000/);
  });

  it("gives the rest by transfer, and the bill owes nothing", async () => {
    const res = await refund(people["owner"]!, { method: "Bank transfer", amount: 3000, reference: "UTR 88123" });
    expect(res.status, await res.clone().text()).toBe(200);
    const more = await refund(people["owner"]!, { method: "Bank transfer", amount: 1, reference: "UTR 2" });
    expect(((await more.json()) as { reason: string }).reason).toBe("Nothing is owed back on this bill.");
  });

  it("moves the Manager report, the Night audit report, the cashier report and money owed alike", async () => {
    const after = await figures();
    const moved = {
      manager: { cash: after.manager.cash - before.manager.cash, upi: after.manager.upi - before.manager.upi,
                 transfer: after.manager.transfer - before.manager.transfer },
      night: { cash: after.night.cash - before.night.cash, upi: after.night.upi - before.night.upi,
               transfer: after.night.transfer - before.night.transfer },
      cashier: { cash: after.cashier.cash - before.cashier.cash, upi: after.cashier.upi - before.cashier.upi,
                 transfer: after.cashier.transfer - before.cashier.transfer },
    };
    const out = { cash: -19000, upi: -2000, transfer: -3000 };
    expect(moved).toEqual({ manager: out, night: out, cashier: out });
    /* Settled by guests falls by the ₹24,000 given back; the guest ledger
       closes ₹24,000 higher - the bill went from -₹24,000 to ₹0. */
    expect(after.manager.settled - before.manager.settled).toBe(-24000);
    expect(after.manager.closing - before.manager.closing).toBe(24000);
    /* Settled: off the money-owed list, which shows only what is owed. */
    expect(after.owed).toBeNull();
  });

  it("prints a plain refund receipt", async () => {
    const [p] = await sql<{ id: string }>(
      `select fp.id::text from folio_postings fp join refunds rf on rf.posting_id = fp.id
        where fp.folio_id = $1 and rf.method = 'upi'`, [folio]);
    const res = await call(people["front_desk"]!, `/stays/${stay}/refunds/${p!.id}`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({
      number: p!.id, date: today, amount: 2000, method: "UPI", reference: "UPI 4471",
      reason: "Left a day early", givenBy: "RFD finance", guest: "RFD Guest",
      hotel: { name: "Refund Test" }, takenBack: false,
    });
  });
});
