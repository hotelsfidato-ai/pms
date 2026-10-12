import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES, whoMay } from "../../../src/roleGate.ts";
import { ROLES } from "../../../src/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   LOYALTY THROUGH THE DESK'S OWN DOORS (D27-179)

   The rules are proved in db/tests/modules/loyalty.sql. This proves the
   routes and the one line in the front desk's check-out: a member joins
   with their yes, points come off the room charge as a discount line,
   and the real check-out earns on what the bill kept - before GST and
   after the points.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "LYT";
let hotelId = "";
let guestId = "";
let stayId = "";
let before: { name: string | null; rate: string | null } = { name: null, rate: null };
/** One person per role, rostered at LYT (D27-305). */
const people = new Map<string, string>();
const as = (role: string) => ({ "x-dev-staff-id": people.get(role)! });

const call =(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner", ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ok = async (res: Response) => expect(res.status, await res.clone().text()).toBe(200);

beforeAll(async () => {
  const owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Loyalty Test','Nowhere')::text as id", [CODE])).rows[0]!.id;
    /* Rooms ready from midnight and leaving until 23:59, so the wall clock
       never makes this an early arrival or a late departure. */
    await db.query("update hotels set check_in_time = '00:00', check_out_time = '23:59' where id = $1", [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,101)", [hotelId]);
    await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate, note) values ($1,'room',0,5,'Test')", [hotelId]);
    guestId = (await db.query<{ id: string }>(
      "insert into guests (full_name, phone) values ('Loyalty API Guest', '+91 70000 55509') returning id::text")).rows[0]!.id;
    stayId = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
       values ($1, 'LYT-1', $2, (select id from room_types where hotel_id = $1 and code = 'STD'),
               app.business_date($1), app.business_date($1) + 1, 2000, 'confirmed')
       returning id::text`, [hotelId, guestId])).rows[0]!.id;
    const g = (await db.query<{ name: string | null; rate: string | null }>(
      "select loyalty_name as name, loyalty_points_per_100::text as rate from group_settings where id = 1")).rows[0];
    if (g) before = g;
    for (const role of ROLES.filter((r) => r !== "automation")) {
      const id = (await db.query<{ id: string }>(
        `insert into staff (email, full_name) values ($1, $2)
         on conflict (email) do update set is_active = true returning id::text`,
        [`lyt-${role}@fidato.in`, `Loyalty ${role}`])).rows[0]!.id;
      await db.query("delete from staff_hotels where staff_id = $1", [id]);
      await db.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
      people.set(role, id);
    }
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("update group_settings set loyalty_name = $1, loyalty_points_per_100 = $2::numeric where id = 1",
      [before.name, before.rate]);
    await db.query("alter table loyalty_points disable trigger loyalty_points_append_only");
    await db.query("delete from loyalty_points where hotel_id = $1", [hotelId]);
    await db.query("alter table loyalty_points enable trigger loyalty_points_append_only");
    await db.query("delete from loyalty_members where hotel_id = $1", [hotelId]);
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where id = $1", [guestId]);
    await db.query("alter table guests enable trigger guests_no_delete");
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[...people.values()]]);
    await db.query("update staff set is_active = false where id = any($1::uuid[])", [[...people.values()]]);
  } finally { await db.end(); }
  await closePool();
});

describe("loyalty through the desk's doors", () => {
  it("joins with a yes, takes points off the room as a discount, and the check-out earns", async () => {
    await ok(await call("/modules/loyalty", "POST", { enabled: true }));
    await ok(await call("/loyalty/rules", "PUT", { name: "Test Rewards", pointsPer100: 5 }));

    /* No tick, no member (L4). */
    expect((await call(`/loyalty/guests/${guestId}/join`, "POST", {})).status).toBe(409);
    await ok(await call(`/loyalty/guests/${guestId}/join`, "POST", { agreed: true }));

    await ok(await call(`/stays/${stayId}/check-in`, "POST", { roomNumber: "101", adults: 1, idSkipReason: "Test" }));
    /* The check-in posts the first night itself, at the booking's 2000. */
    await ok(await call(`/loyalty/guests/${guestId}/adjust`, "POST", { points: 600, reason: "Test balance" }));

    /* D27-305: redeeming is its own right. The accountant is refused at the
       door and told who may; the screen hides Use points from them. */
    const refused = await call(`/loyalty/stays/${stayId}/redeem`, "POST", { points: 500 }, as("finance"));
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { reason: string }).reason).toBe(
      "Using a guest's loyalty points is for the owner, an administrator, the general manager, "
      + "the hotel manager or reception. Ask one of them.");
    expect(((await (await call("/loyalty", "GET", undefined, as("finance"))).json()) as { mayRedeem: boolean })
      .mayRedeem).toBe(false);
    expect(((await (await call("/loyalty", "GET", undefined, as("front_desk"))).json()) as { mayRedeem: boolean })
      .mayRedeem).toBe(true);

    /* Reception takes them. */
    const key = crypto.randomUUID();
    await ok(await call(`/loyalty/stays/${stayId}/redeem`, "POST", { points: 500 },
      { ...as("front_desk"), "idempotency-key": key }));
    /* A double tap: the same key takes nothing more. */
    await ok(await call(`/loyalty/stays/${stayId}/redeem`, "POST", { points: 500 },
      { ...as("front_desk"), "idempotency-key": key }));

    const lines = await sql<{ category: string; amount: string; tax_amount: string }>(
      `select fp.category, fp.amount::text, fp.tax_amount::text from folio_postings fp
         join folios f on f.id = fp.folio_id where f.reservation_id = $1 and fp.category = 'discount'`, [stayId]);
    expect(lines).toEqual([{ category: "discount", amount: "-500.00", tax_amount: "-25.00" }]);

    /* 2000 + 100 GST - 500 - 25 = 1575 to settle, then the real check-out. */
    await ok(await call(`/stays/${stayId}/payments`, "POST", { method: "UPI", amount: 1575 }));
    await ok(await call(`/stays/${stayId}/check-out`, "POST", {}));

    const card = await (await call(`/loyalty/guests/${guestId}`)).json() as {
      points: number; statement: { kind: string; points: number }[];
    };
    /* 600 - 500 + (2000 - 500) x 5 / 100 = 175. */
    expect(card.points).toBe(175);
    expect(card.statement.find((l) => l.kind === "earn")?.points).toBe(75);
  });

  it("the right to redeem is the same five at the door and in the database (D27-305)", async () => {
    const door = whoMay(WRITE_RULES["POST /api/hotels/:code/loyalty/stays/:id/redeem"]!);
    expect(door).toEqual(["owner", "admin", "gm", "hotel_manager", "front_desk"]);

    const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
    const inDatabase: string[] = [];
    try {
      for (const [role, id] of people) {
        await db.query("select set_config('app.user_id', $1, false)", [id]);
        const { rows } = await db.query<{ may: boolean }>("select app.redeems_loyalty_points($1) as may", [hotelId]);
        if (rows[0]!.may) inDatabase.push(role);
      }
    } finally { await db.end(); }
    expect(inDatabase).toEqual(door);
  });
});
