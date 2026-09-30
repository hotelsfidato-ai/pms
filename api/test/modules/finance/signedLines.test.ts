import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withDrawer } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   TWO OF THE THREE FINANCE RULE-BREAKERS (D22-9)

   · A refusal after a write is a commit (MEMORY 243). `postCharge` opened
     the stay's folio BEFORE it asked for a GST rule, so a charge refused
     for a missing rate left an empty folio behind. Asked through the
     route, at a property of this file's own that has set no rule.

   · A bill line is signed by the person, not "front desk". The Bill tab
     sent `const USER = "front desk"`, which the server never read, and
     printed the posting's uuid (or "admin" for nobody). It now prints
     `app.posted_by_name` - the person signed in when the line was made.
     So does the Payments list's "Taken by", which printed "admin" for
     every receipt (the owner, 24 September).

   Its own property (RBW), deleted afterwards, so no demo figure moves.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "RBW";
let hotelId = "";
let stayId = "";
let ownerName = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string; name: string }>(
      "select id::text, full_name as name from staff where email = 'owner@fidato.in'")).rows[0]!;
    ownerName = owner.name;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Refusal Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query("insert into guests (full_name) values ('Refusal test guest')");
    /* A booking with NO folio yet: the first charge would open one. */
    stayId = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1),
               (select id from guests where full_name = 'Refusal test guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               app.business_date($1), app.business_date($1) + 1, 2000, 'confirmed')
       returning id::text`, [hotelId])).rows[0]!.id;
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("a charge refused for a missing GST rule", () => {
  it("writes nothing - not even the folio it would have gone on", async () => {
    const res = await call(`/${CODE}/stays/${stayId}/charges`, "POST", {
      category: "Laundry", description: "Refused: no GST rule", amount: 500, taxable: true,
    });
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(res.status).toBe(409);
    expect(body.reason).toMatch(/no GST rule for room/);
    expect(body.reason, "says where the rate is set").toMatch(/Configuration or Finance → Invoices/);

    const [folios] = await sql<{ n: number }>(
      "select count(*)::int as n from folios where reservation_id = $1", [stayId]);
    expect(folios!.n, "the refusal committed an empty folio").toBe(0);
  });
});

describe("a bill line", () => {
  it("names the person signed in when it was posted, \"Night audit\" for the audit's line, and a dash for nobody", async () => {
    /* Set the way a person sets it: the tax card's route (MEMORY 313). */
    const rule = await call(`/${CODE}/tax/room`, "PUT", { slabs: [{ overAmount: 0, rate: 5 }] });
    expect(rule.status, await rule.clone().text()).toBe(200);
    const res = await call(`/${CODE}/stays/${stayId}/charges`, "POST", {
      category: "Laundry", description: "Signed by the owner", amount: 500, taxable: true,
    });
    expect(res.status, await res.clone().text()).toBe(200);

    /* A line nobody was signed in for: a bulk load, or one from before 101. */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, business_date, category,
                                   description, amount, tax_rate, tax_amount)
       select $1, f.id, app.business_date($1), 'misc', 'Nobody signed in', 100, 0, 0
         from folios f where f.reservation_id = $2`, [hotelId, stayId]);

    /* The night's room charge, as the audit writes it: signed by whoever
       pressed Run, and read as "Night audit" (the owner, 24 September). */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                   amount, tax_rate, tax_amount, source_type, posted_by)
       select $1, f.id, app.business_date($1), 'room', 'Room 101 · 1 night', 2000, 5, 100,
              'night_audit', (select id from staff where email = 'owner@fidato.in')
         from folios f where f.reservation_id = $2`, [hotelId, stayId]);

    const lines = await (await call(`/${CODE}/stays/${stayId}/postings`)).json() as
      Array<{ description: string; user: string | null }>;
    expect(lines.find((l) => l.description === "Signed by the owner")?.user).toBe(ownerName);
    expect(lines.find((l) => l.description === "Nobody signed in")?.user).toBeNull();
    expect(lines.find((l) => l.description === "Room 101 · 1 night")?.user).toBe("Night audit");
  });
});

describe("a payment on the Payments list", () => {
  it("names the person who took it, not \"admin\"", async () => {
    const res = await withDrawer(CODE, "dev-owner", () => call(`/${CODE}/stays/${stayId}/payments`, "POST", {
      method: "Cash", amount: 250,
    }));
    expect(res.status, await res.clone().text()).toBe(200);
    const id = (await res.json() as { data: { id: string } }).data.id;

    const list = await (await call(`/${CODE}/payments`)).json() as
      Array<{ id: string; user: string | null }>;
    expect(list.find((p) => p.id === id)?.user).toBe(ownerName);
  });
});
