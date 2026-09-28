import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { PAN_NEEDED, PAN_SHAPE } from "../../../src/modules/finance/cashLimit.ts";
import { openDrawer } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   CASH AT THE DESK: ₹2 LAKH REFUSED, A PAN ABOVE ₹1 LAKH (D25-40)

   Income-tax Act 2025 s.186 and Rule 159, as the owner decided them on
   26 September: counted over the stay, its group and the guest's day;
   refunds do not bring it down; above ₹1,00,000 at once a PAN, or Form 97,
   or a guest from abroad. Every refusal is proved to have written nothing -
   no payment and no line on the bill (root MEMORY 243). The group and a reversed payment are proved in the
   database (db/tests/modules/front-desk.sql), on app.cash_taken itself.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const tag = `CASH-${process.pid}`;
const run = String(process.pid % 10000).padStart(4, "0");

let owner = "";
let closeDrawer: () => Promise<void> = async () => {};
let source = "";
let roomType = "";
const stays: Record<"a" | "b" | "c" | "d" | "e" | "f" | "g", string> =
  { a: "", b: "", c: "", d: "", e: "", f: "", g: "" };

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function book(name: string, phone: string, guestId?: string): Promise<string> {
  const [night] = await sql<{ d: string; e: string }>(
    `select app.business_date(id)::text as d, (app.business_date(id) + 1)::text as e
       from hotels where code = '5EL'`);
  const res = await call("/bookings", {
    guestName: `${tag} ${name}`, phone, checkIn: night!.d, checkOut: night!.e,
    bookingSourceId: source, ...(guestId ? { guestId } : {}),
    lines: [{ roomTypeId: roomType, adults: 1, rooms: 1, agreedRate: 3000 }],
  });
  const out = (await res.json()) as { bookings?: { reference: string }[]; reason?: string };
  expect(res.status, JSON.stringify(out)).toBe(200);
  const [row] = await sql<{ id: string }>(
    "select id::text from reservations where reference = $1", [out.bookings![0]!.reference]);
  return row!.id;
}

/* These stays have no bill, so every payment here is more than the bill and
   is held as credit (D27-4) - confirmed, since that is not what most of this
   file is about. The last describe asks it. */
const pay = async (stay: string, body: Record<string, unknown>) => {
  const res = await call(`/stays/${stay}/payments`, { heldAsCredit: true, ...body });
  return { status: res.status, out: (await res.json()) as { ok: boolean; reason?: string; needs?: string } };
};
const payments = (stay: string) => sql<{ amount: string; pan: string | null; form_97: boolean }>(
  `select p.amount::text, p.pan, p.form_97 from payments p
     join folio_postings fp on fp.id = p.posting_id
     join folios f on f.id = fp.folio_id
    where f.reservation_id = $1 order by p.created_at`, [stay]);
const lines = async (stay: string) => (await sql(
  `select 1 from folio_postings fp join folios f on f.id = fp.folio_id
    where f.reservation_id = $1`, [stay])).length;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  source = (await sql<{ id: string }>(
    "select id::text from booking_sources where is_active and kind = 'direct' order by name limit 1"))[0]!.id;
  roomType = (await sql<{ id: string }>(
    `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`))[0]!.id;

  const phone = `6${run}00001`;
  stays.a = await book("Meena Joshi", phone);
  const [guest] = await sql<{ id: string }>("select guest_id::text as id from reservations where id = $1", [stays.a]);
  stays.b = await book("Meena Joshi", phone, guest!.id);          // her second room, same day
  stays.c = await book("Form 97 Guest", `6${run}00002`);
  stays.d = await book("Guest From Abroad", `6${run}00003`);
  stays.e = await book("Exactly Two Lakh", `6${run}00004`);
  stays.f = await book("Two Clerks At Once", `6${run}00005`);
  stays.g = await book("Pays Too Much", `6${run}00006`);
  await sql(
    "update guests set nationality = 'GB' where id = (select guest_id from reservations where id = $1)",
    [stays.d]);
  /* D27-118: cash goes only into an open drawer - the owner's, for this file. */
  closeDrawer = await openDrawer("5EL", owner);
});

afterAll(async () => {
  await closeDrawer();
  const ids = Object.values(stays).filter(Boolean);
  const guests = (await sql<{ id: string }>(
    "select id::text from guests where full_name like $1", [`${tag} %`])).map((g) => g.id);
  await sql(
    `delete from payments where posting_id in (select fp.id from folio_postings fp
       join folios f on f.id = fp.folio_id where f.reservation_id = any($1::uuid[]))`, [ids]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(
      `delete from folio_postings where folio_id in
         (select id from folios where reservation_id = any($1::uuid[]))`, [ids]);
  } finally {
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.end();
  }
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  const db2 = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db2.query("alter table guests disable trigger guests_no_delete");
    await db2.query("delete from guests where id = any($1::uuid[])", [guests]);
  } finally {
    await db2.query("alter table guests enable trigger guests_no_delete");
    await db2.end();
  }
  await closePool();
});

describe("more than ₹1,00,000 in cash at once (Rule 159)", () => {
  it("asks for the PAN, and writes nothing without it", async () => {
    const { status, out } = await pay(stays.a, { method: "Cash", amount: 150000 });
    expect(status).toBe(409);
    expect(out).toMatchObject({ ok: false, reason: PAN_NEEDED, needs: "pan" });
    expect(await payments(stays.a)).toEqual([]);
    expect(await lines(stays.a)).toBe(0);
  });

  it("refuses a PAN that is not one", async () => {
    const { status, out } = await pay(stays.a, { method: "Cash", amount: 150000, pan: "12345" });
    expect(status).toBe(409);
    expect(out.reason).toBe(PAN_SHAPE);
    expect(await payments(stays.a)).toEqual([]);
  });

  it("takes it with the PAN, kept in capitals with the payment", async () => {
    const { status, out } = await pay(stays.a, { method: "Cash", amount: 150000, pan: " abcde1234f " });
    expect(status, JSON.stringify(out)).toBe(200);
    expect(await payments(stays.a)).toEqual([{ amount: "150000.00", pan: "ABCDE1234F", form_97: false }]);
  });

  it("takes Form 97 instead from a guest with no PAN", async () => {
    const { status } = await pay(stays.c, { method: "Cash", amount: 120000, form97: true });
    expect(status).toBe(200);
    expect(await payments(stays.c)).toEqual([{ amount: "120000.00", pan: null, form_97: true }]);
  });

  it("does not ask a guest from abroad", async () => {
    const { status } = await pay(stays.d, { method: "Cash", amount: 120000 });
    expect(status).toBe(200);
    expect(await payments(stays.d)).toEqual([{ amount: "120000.00", pan: null, form_97: false }]);
  });
});

describe("cash of ₹2,00,000 or more from one guest (s.186)", () => {
  it("is refused on the stay, saying what was taken and how much more can be cash", async () => {
    const { status, out } = await pay(stays.a, { method: "Cash", amount: 50000 });
    expect(status).toBe(409);
    expect(out.reason).toBe(
      "Cash of ₹2,00,000 or more from one guest is not allowed (Income-tax Act s.186). "
      + "₹1,50,000.00 has been taken in cash already, so less than ₹50,000.00 more can be cash. "
      + "Take the rest by card, UPI, cheque or bank transfer.");
    expect(await payments(stays.a)).toHaveLength(1);
  });

  it("counts the same guest's other stay on the same day", async () => {
    const { status, out } = await pay(stays.b, { method: "Cash", amount: 50000 });
    expect(status).toBe(409);
    expect(out.reason).toMatch(/₹1,50,000.00 has been taken in cash already/);
    expect(await payments(stays.b)).toEqual([]);
    expect(await lines(stays.b)).toBe(0);
  });

  it("takes less than the rest in cash, and the rest by card", async () => {
    expect((await pay(stays.b, { method: "Cash", amount: 49999.99 })).status).toBe(200);
    expect((await pay(stays.b, { method: "Credit Card", amount: 60000 })).status).toBe(200);
  });

  it("is refused at exactly ₹2,00,000 in one payment, PAN or not", async () => {
    const { status, out } = await pay(stays.e, { method: "Cash", amount: 200000, pan: "ABCDE1234F" });
    expect(status).toBe(409);
    expect(out.reason).toMatch(/^Cash of ₹2,00,000 or more from one guest is not allowed.*Take less than ₹2,00,000 in cash\./);
    expect(await payments(stays.e)).toEqual([]);
  });
});

describe("one guest's payments take turns (D27-2)", () => {
  it("lets only one of two same-second cash payments pass the limit", async () => {
    /* The stay's folio, held by another transaction: each payment's line
       waits on it, so both requests are in flight together before either can
       write. Without the turn both read "nothing taken yet" and both land. */
    const charge = await call(`/stays/${stays.f}/charges`,
      { category: "Laundry", description: `${tag} laundry`, amount: 100, taxable: false });
    expect(charge.status, await charge.clone().text()).toBe(200);
    const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
    const holder = await db.connect();
    try {
      await holder.query("begin");
      await holder.query("select 1 from folios where reservation_id = $1 for update", [stays.f]);
      const [{ pid }] = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows as [{ pid: number }];

      const both = [pay(stays.f, { method: "Cash", amount: 100000 }),
                    pay(stays.f, { method: "Cash", amount: 100000 })];
      /* Both waiting: on the held folio, or on the other payment's turn.
         Asked on another connection - inside the holder's transaction
         pg_stat_activity stays as it was first read. */
      for (let waited = 0; ; waited += 50) {
        const [{ n }] = (await db.query<{ n: number }>(
          `with first as (select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid)))
           select count(*)::int as n from pg_stat_activity a
            where a.pid in (select pid from first)
               or exists (select 1 from first f where f.pid = any(pg_blocking_pids(a.pid)))`,
          [pid])).rows as [{ n: number }];
        if (n >= 2) break;
        if (waited > 10_000) throw new Error("the two payments never met");
        await new Promise((r) => setTimeout(r, 50));
      }
      await holder.query("commit");

      const results = await Promise.all(both);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)!.out.reason).toMatch(
        /₹1,00,000.00 has been taken in cash already, so less than ₹1,00,000.00 more can be cash\./);
      expect(await payments(stays.f)).toEqual([{ amount: "100000.00", pan: null, form_97: false }]);
    } finally {
      await holder.query("rollback").catch(() => {});
      holder.release();
      await db.end();
    }
  });
});

describe("a payment larger than the bill (D27-4)", () => {
  const credit = (x: string) => `This is ₹${x} more than the bill; it will be held as the guest's credit.`;

  it("is taken without a question while it is within the bill", async () => {
    const charge = await call(`/stays/${stays.g}/charges`,
      { category: "Laundry", description: `${tag} laundry`, amount: 1000, taxable: false });
    expect(charge.status, await charge.clone().text()).toBe(200);
    expect((await pay(stays.g, { method: "UPI", amount: 400, heldAsCredit: false })).status).toBe(200);
  });

  it("names how much more, and writes nothing until the desk confirms", async () => {
    const { status, out } = await pay(stays.g, { method: "Credit Card", amount: 1100, heldAsCredit: false });
    expect(status).toBe(409);
    expect(out).toMatchObject({ ok: false, reason: credit("500.00"), needs: "credit" });
    expect(await payments(stays.g)).toHaveLength(1);
  });

  it("takes it once confirmed, and asks again for any more once the bill is paid", async () => {
    expect((await pay(stays.g, { method: "Credit Card", amount: 1100 })).status).toBe(200);
    expect(await payments(stays.g)).toHaveLength(2);
    const { status, out } = await pay(stays.g, { method: "Cash", amount: 100, heldAsCredit: false });
    expect(status).toBe(409);
    expect(out.reason).toBe(credit("100.00"));
  });
});
