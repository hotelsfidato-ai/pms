import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   PURCHASING, END TO END — asked for, approved, ordered, delivered

   One purchase, all the way through, with every refusal tried on the way:

     raised          → waiting for the GM (D18-4)
     ordered too early → refused, because nobody has approved it
     approved by the requester → refused (076, nobody approves their own)
     approved by the GM, still unpriced → STILL refused to send
     priced, sent    → the PDF exists and carries the order's reference
     delivered short → the Store gains what CAME, and what was ORDERED stays
     delivered twice → refused

   The last one is the one worth the file: the delivery goes into the
   STORE's ledger, through the Store's own door, and the quantities that
   arrive sit BESIDE the ones ordered rather than over them.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "PUETEST";

let keeperId: string;
let gmId: string;
let storeId: string;
let storeName: string;
let supplierId: string;
let riceId: string;
let oilId: string;

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true
     returning id::text`,
    [`pue-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-pue-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  return id;
};

const item = async (name: string, unit: string) => (await sql(
  `insert into stock_items (hotel_id, name, unit)
   select id, $2, $3 from hotels where code = $1
   on conflict (hotel_id, name) do update set is_active = true
   returning id::text`, [HOTEL, name, unit])).rows[0].id as string;

const onHandIn = async (itemId: string) => Number((await sql(
  "select app.stock_on_hand($1, $2)::text as n", [itemId, storeId])).rows[0].n);

beforeAll(async () => {
  keeperId = await person("keeper", "stores");
  gmId = await person("gm", "gm");

  const { rows: stores } = await sql(
    `select l.id::text, l.name from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.kind = 'store' and l.name = 'Main store'`, [HOTEL]);
  storeId = stores[0].id as string;
  storeName = stores[0].name as string;

  const { rows: sup } = await sql(
    `insert into suppliers (hotel_id, name, phone, gstin)
     select id, $2, '9999900000', '27AAGCF5655F1ZI' from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true
     returning id::text`, [HOTEL, `${TAG} Traders`]);
  supplierId = sup[0].id as string;

  riceId = await item(`${TAG} rice`, "kg");
  oilId = await item(`${TAG} oil`, "litre");
});

afterAll(async () => {
  /* The stock the delivery put on the shelf goes the way the ledger allows
     — the append-only trigger is lifted for the fixture rows only, in the
     scratch database this run owns. */
  await sql("alter table stock_movements disable trigger stock_movements_append_only");
  await sql("delete from stock_movements where item_id in ($1, $2)", [riceId, oilId]);
  await sql("alter table stock_movements enable trigger stock_movements_append_only");
  await sql(
    "delete from purchase_request_lines where request_id in (select id from purchase_requests where reason like $1)",
    [`${TAG}%`]);
  /* THE ORDER MATTERS: a request POINTS AT its approval, so the request goes
     first. The other way round the foreign key refuses, the teardown dies,
     and one red assertion reads as a broken suite (MEMORY 289).
     The ids are read out into here rather than into a temp table: every call
     of `sql` opens its own pool and closes it, so a temp table would not
     survive to the next line. */
  const { rows: gone } = await sql(
    "select approval_id::text as id from purchase_requests where reason like $1 and approval_id is not null",
    [`${TAG}%`]);
  await sql("delete from purchase_requests where reason like $1", [`${TAG}%`]);
  for (const row of gone) {
    await sql("delete from approvals where id = $1", [row.id as string]);
  }
  await sql("delete from stock_items where name like $1", [`${TAG}%`]);
  await sql("delete from suppliers where name like $1", [`${TAG}%`]);
  for (const id of [keeperId, gmId]) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("a purchase, end to end", () => {
  it("goes from asked for to delivered, and refuses every shortcut on the way", async () => {
    /* ── asked for, one line priced and one not ─────────────────── */
    const raised = await call(keeperId, "/purchasing/requests", "POST", {
      storeId,
      reason: `${TAG} the rice is down to two days`,
      lines: [
        { itemId: riceId, quantity: 50 },
        { itemId: oilId, quantity: 10, unitPrice: 140 },
      ],
    });
    expect(raised.status).toBe(200);
    const made = await raised.json() as {
      request: { id: string; reference: string; state: string; total: string | null; unpriced: number };
    };
    const id = made.request.id;

    expect(made.request.state).toBe("waiting");
    expect(made.request.reference).toMatch(/^PO-5EL-\d{4}-\d{4,}$/);
    /* NO TOTAL while a line is unpriced — a part of the bill shown as the
       whole is the invented figure this project refuses. */
    expect(made.request.total).toBeNull();
    expect(made.request.unpriced).toBe(1);

    /* ── it cannot be ordered before anybody approves it (D18-4) ── */
    const tooEarly = await call(keeperId, `/purchasing/requests/${id}/order`, "POST",
      { supplierId });
    expect(tooEarly.status).toBe(409);
    expect((await tooEarly.json() as { reason: string }).reason)
      .toContain("approvals inbox");

    /* ── and the person who asked cannot approve it (076) ───────── */
    const { rows: ap } = await sql(
      "select approval_id::text as id from purchase_requests where id = $1", [id]);
    const approvalId = ap[0].id as string;
    expect(approvalId).not.toBeNull();

    const ownApproval = await app.request(
      `/api/hotels/${HOTEL}/approvals/${approvalId}/approved`,
      { method: "POST", headers: { "x-dev-staff-id": keeperId, "content-type": "application/json" }, body: "{}" });
    expect(ownApproval.status).toBe(409);
    expect((await ownApproval.json() as { reason: string }).reason)
      .toContain("cannot be the person who approves");

    /* ── the GM approves it, in the ONE inbox ───────────────────── */
    const approved = await app.request(
      `/api/hotels/${HOTEL}/approvals/${approvalId}/approved`,
      { method: "POST", headers: { "x-dev-staff-id": gmId, "content-type": "application/json" }, body: "{}" });
    expect(approved.status).toBe(200);

    /* ── and it STILL cannot be sent, because a line has no price ─ */
    const unpriced = await call(keeperId, `/purchasing/requests/${id}/order`, "POST",
      { supplierId });
    expect(unpriced.status).toBe(409);
    expect((await unpriced.json() as { reason: string }).reason)
      .toContain("agreed price");

    /* ── priced ─────────────────────────────────────────────────── */
    const detail = await call(keeperId, `/purchasing/requests/${id}`);
    const { lines } = await detail.json() as {
      lines: { id: string; item: string; unitPrice: string | null }[];
    };
    const riceLine = lines.find((l) => l.item.endsWith("rice"))!;
    const oilLine = lines.find((l) => l.item.endsWith("oil"))!;
    expect(riceLine.unitPrice).toBeNull();

    const priced = await call(keeperId,
      `/purchasing/requests/${id}/lines/${riceLine.id}`, "PUT", { unitPrice: 62 });
    expect(priced.status).toBe(200);

    /* ── sent ───────────────────────────────────────────────────── */
    const sent = await call(keeperId, `/purchasing/requests/${id}/order`, "POST",
      { supplierId });
    expect(sent.status).toBe(200);
    const after = await sent.json() as { request: { state: string; total: string | null } };
    expect(after.request.state).toBe("ordered");
    /* Now every line has a price, so the total is a real figure: 50 x 62
       plus 10 x 140 = 4,500. */
    expect(Number(after.request.total)).toBe(4500);

    /* ── a second send is refused ───────────────────────────────── */
    const twice = await call(keeperId, `/purchasing/requests/${id}/order`, "POST",
      { supplierId });
    expect(twice.status).toBe(409);
    expect((await twice.json() as { reason: string }).reason).toContain("already");

    /* ── the price cannot be moved once the supplier has been told ─ */
    const late = await call(keeperId,
      `/purchasing/requests/${id}/lines/${riceLine.id}`, "PUT", { unitPrice: 55 });
    expect(late.status).toBe(409);
    expect((await late.json() as { reason: string }).reason)
      .toContain("already gone to the supplier");

    /* ── the order on paper (D18-3) ─────────────────────────────── */
    const pdf = await call(keeperId, `/purchasing/orders/${id}.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition"))
      .toContain(`${made.request.reference}.pdf`);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    /* A real PDF, not an error page rendered as one. */
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);

    /* ── the delivery: FIVE KILOS SHORT, and both figures stay ──── */
    const riceBefore = await onHandIn(riceId);
    const oilBefore = await onHandIn(oilId);

    const delivered = await call(keeperId, `/purchasing/requests/${id}/delivery`, "POST", {
      note: `${TAG} five kilos short, agreed with the driver`,
      lines: [
        { lineId: riceLine.id, receivedQuantity: 45, receivedUnitCost: 64 },
        { lineId: oilLine.id, receivedQuantity: 10, receivedUnitCost: 138 },
      ],
    });
    expect(delivered.status).toBe(200);
    const landed = await delivered.json() as {
      received: { item: string; quantity: number; store: string }[];
    };
    expect(landed.received).toHaveLength(2);
    expect(landed.received[0]!.store).toBe(storeName);

    /* THE STOCK IS IN THE STORE — written by the Store, through its door. */
    expect(await onHandIn(riceId)).toBe(riceBefore + 45);
    expect(await onHandIn(oilId)).toBe(oilBefore + 10);

    /* WHAT WAS ORDERED IS NOT WRITTEN OVER. */
    const closed = await call(keeperId, `/purchasing/requests/${id}`);
    const done = await closed.json() as {
      request: { state: string; deliveryNote: string | null };
      lines: { item: string; quantity: string; receivedQuantity: string | null }[];
    };
    expect(done.request.state).toBe("received");
    expect(done.request.deliveryNote).toContain("five kilos short");
    const rice = done.lines.find((l) => l.item.endsWith("rice"))!;
    expect(Number(rice.quantity)).toBe(50);
    expect(Number(rice.receivedQuantity)).toBe(45);

    /* ── and it cannot be received twice ────────────────────────── */
    const again = await call(keeperId, `/purchasing/requests/${id}/delivery`, "POST", {
      lines: [{ lineId: riceLine.id, receivedQuantity: 5 }],
    });
    expect(again.status).toBe(409);
    expect(await onHandIn(riceId)).toBe(riceBefore + 45);
  });

  it("records nothing coming as 0, not as a receipt of nothing", async () => {
    const raised = await call(keeperId, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} nothing turned up`,
      lines: [{ itemId: riceId, quantity: 20, unitPrice: 60 }],
    });
    const { request } = await raised.json() as { request: { id: string } };

    const { rows } = await sql(
      "select approval_id::text as id from purchase_requests where id = $1", [request.id]);
    await app.request(`/api/hotels/${HOTEL}/approvals/${rows[0].id}/approved`,
      { method: "POST", headers: { "x-dev-staff-id": gmId, "content-type": "application/json" }, body: "{}" });
    await call(keeperId, `/purchasing/requests/${request.id}/order`, "POST", { supplierId });

    const detail = await call(keeperId, `/purchasing/requests/${request.id}`);
    const { lines } = await detail.json() as { lines: { id: string }[] };

    const before = await onHandIn(riceId);
    const res = await call(keeperId, `/purchasing/requests/${request.id}/delivery`, "POST", {
      note: `${TAG} the lorry never came`,
      lines: [{ lineId: lines[0]!.id, receivedQuantity: 0 }],
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { received: unknown[] }).received).toHaveLength(0);
    /* No movement at all: a receipt of nothing is not a receipt. */
    expect(await onHandIn(riceId)).toBe(before);

    /* But it IS on the order, as 0 rather than as a blank. */
    const closed = await call(keeperId, `/purchasing/requests/${request.id}`);
    const done = await closed.json() as {
      request: { state: string };
      lines: { quantity: string; receivedQuantity: string | null }[];
    };
    expect(done.request.state).toBe("received");
    expect(Number(done.lines[0]!.receivedQuantity)).toBe(0);
    expect(Number(done.lines[0]!.quantity)).toBe(20);
  });

  it("refuses a cancellation with no reason, and keeps the order when it does", async () => {
    const raised = await call(keeperId, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} to be cancelled`,
      lines: [{ itemId: oilId, quantity: 2 }],
    });
    const { request } = await raised.json() as { request: { id: string } };

    const blank = await call(keeperId, `/purchasing/requests/${request.id}/cancel`,
      "POST", { reason: "   " });
    expect(blank.status).toBe(409);
    const still = await call(keeperId, `/purchasing/requests/${request.id}`);
    expect((await still.json() as { request: { state: string } }).request.state)
      .toBe("waiting");

    const done = await call(keeperId, `/purchasing/requests/${request.id}/cancel`,
      "POST", { reason: "Bought locally instead" });
    expect(done.status).toBe(200);
    const closed = await call(keeperId, `/purchasing/requests/${request.id}`);
    const body = await closed.json() as {
      request: { state: string; cancelledReason: string | null };
    };
    expect(body.request.state).toBe("cancelled");
    expect(body.request.cancelledReason).toBe("Bought locally instead");
  });

  it("refuses two lines for the same item, and writes nothing", async () => {
    const { rows: before } = await sql(
      "select count(*)::int as n from purchase_requests where reason like $1", [`${TAG}%`]);
    const res = await call(keeperId, "/purchasing/requests", "POST", {
      storeId, reason: `${TAG} the same rice twice`,
      lines: [{ itemId: riceId, quantity: 5 }, { itemId: riceId, quantity: 6 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toContain("twice");
    const { rows: after } = await sql(
      "select count(*)::int as n from purchase_requests where reason like $1", [`${TAG}%`]);
    expect(after[0].n).toBe(before[0].n);
  });

  it("refuses a request with no reason, and writes nothing", async () => {
    const { rows: before } = await sql(
      "select count(*)::int as n from purchase_requests", []);
    const res = await call(keeperId, "/purchasing/requests", "POST", {
      storeId, reason: "   ", lines: [{ itemId: riceId, quantity: 5 }],
    });
    expect(res.status).toBe(409);
    const { rows: after } = await sql(
      "select count(*)::int as n from purchase_requests", []);
    expect(after[0].n).toBe(before[0].n);
  });
});
