import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S FSSAI LICENCE NUMBER (the audit's A16; the owner, 26 Sep)

   Typed by the owner, an administrator or the GM; 14 digits or refused;
   blank clears it. It rides with every restaurant bill and with a stay's
   tax invoice, which print it (or a dash) - the screens' half is
   src/modules/pos/billFssai.test.tsx.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "FSSAITEST";
const people: Record<"gm" | "desk", string> = { gm: "", desk: "" };
let was: string | null = null;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const stored = async () =>
  (await sql<{ n: string | null }>("select fssai_number as n from hotels where code = '5EL'"))[0]!.n;

beforeAll(async () => {
  was = await stored();
  for (const [who, role] of [["gm", "gm"], ["desk", "front_desk"]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`fssai-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
      [row!.id, role]);
  }
});

afterAll(async () => {
  await sql("update hotels set fssai_number = $1 where code = '5EL'", [was]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("the FSSAI licence number", () => {
  it("is refused to reception, in the gate's words, and nothing changes", async () => {
    const res = await call(people.desk, "PUT", "/fssai", { fssai: "12345678901234" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe(
      "Setting the FSSAI licence number is for the owner, an administrator or the general "
      + "manager. Ask one of them.");
    expect(await stored()).toBe(was);
  });

  it("is kept as its 14 digits when the GM types it with spaces", async () => {
    const res = await call(people.gm, "PUT", "/fssai", { fssai: "1234 5678 9012 34" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await stored()).toBe("12345678901234");
  });

  it("refuses anything that is not 14 digits, and keeps what was there", async () => {
    const res = await call(people.gm, "PUT", "/fssai", { fssai: "1234" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("An FSSAI licence number is 14 digits.");
    expect(await stored()).toBe("12345678901234");
  });

  it("travels with a restaurant bill and a tax invoice", async () => {
    const opened = await call(people.gm, "POST", "/till/orders", { outlet: "REST", table: `${TAG} bill` });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const { id } = (await opened.json()) as { id: string };
    const order = await call(people.gm, "GET", `/till/orders/${id}`);
    expect(((await order.json()) as { hotelFssai: string | null }).hotelFssai).toBe("12345678901234");
    await sql("delete from pos_orders where id = $1", [id]);

    /* A demo stay, invoiced the way the finance tests invoice one - and
       never one with a standalone tax line, which invoices.test.ts needs for
       itself. The number rides on every invoice; the page prints it when
       the invoice carries food. */
    const [stay] = await sql<{ id: string }>(
      `select r.id::text from reservations r
         join hotels h on h.id = r.hotel_id and h.code = '5EL'
         join folios f on f.reservation_id = r.id
        where exists (select 1 from folio_postings fp where fp.folio_id = f.id and fp.category = 'room')
          and not exists (select 1 from folio_postings fp where fp.folio_id = f.id and fp.category = 'tax')
          and not exists (select 1 from invoices i where i.folio_id = f.id)
        limit 1`);
    expect(stay, "the demo has an un-invoiced stay").toBeTruthy();
    const issued = await call(people.gm, "POST", `/stays/${stay!.id}/invoice`);
    const { number } = (await issued.json()) as { number: string };
    expect(number, "an invoice was issued").toBeTruthy();
    const res = await call(people.gm, "GET", `/invoices/${number}`);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { supplier: { fssai: string | null } }).supplier.fssai)
      .toBe("12345678901234");
  });

  it("is cleared by a blank, and then nothing is invented", async () => {
    expect((await call(people.gm, "PUT", "/fssai", { fssai: " " })).status).toBe(200);
    expect(await stored()).toBeNull();
  });
});
