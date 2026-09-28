import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LAUNDRY — the door, the price list and the dockets

   Four of the service's rules are refusals, and a refusal is not a guard
   until it has refused something. Each one below is tried, not asserted:

     THE SWITCH (D17-54). The routes refuse at a property that has not
       switched laundry on, independently of the menu hiding it - because
       a hidden entry is still a URL anybody can type.
     WHOSE IT IS (D18-5). A docket with no owner is refused; a guest's
       docket with no stay is refused; the hotel's own linen carrying a
       stay is refused.
     NO DEFAULT PRICES. An item nobody has priced answers `null`, never 0,
       and a bag containing one has NO total - not a part-total.
     THE HOTEL'S LINEN IS NEVER CHARGED. Refused before anything else is
       considered.

   Everything is made through the API, at a property this file provisions
   and removes, so nothing it does can be confused with somebody's data.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let hotelId: string;
let stayId: string;

const CODE = `LD${String(process.pid).slice(-1)}${String(process.pid).slice(-2, -1)}`;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const get = (path: string) => as(path);
const post = (path: string, body?: unknown) =>
  as(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const setLaundry = async (on: boolean) => {
  const db = await admin();
  await db.query(
    `insert into hotel_modules (hotel_id, module, is_enabled)
     values ($1,'laundry',$2)
     on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`,
    [hotelId, on]);
  await db.end();
};

beforeAll(async () => {
  const db = await admin();
  ownerStaffId = (await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;

  await db.query("select set_config('app.user_id', $1, false)", [ownerStaffId]);
  hotelId = (await db.query<{ id: string }>(
    "select app.provision_property_unchecked($1,'Laundry Test','Nowhere') as id",
    [CODE])).rows[0]!.id;

  /* One stay to charge to, written directly: making a booking is the
     reservations service's, and this file is about the laundry. */
  const guest = (await db.query<{ id: string }>(
    "insert into guests (full_name) values ('Laundry Guest') returning id")).rows[0]!.id;
  stayId = (await db.query<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2,
             (select id from room_types where hotel_id = $1 limit 1),
             current_date, current_date + 1, 2000, 'checked_in')
     returning id`, [hotelId, guest])).rows[0]!.id;
  await db.end();
});

afterAll(async () => {
  const db = await admin();
  await db.query("select set_config('app.user_id', $1, false)", [ownerStaffId]);
  await db.query("alter table folio_postings disable trigger folio_postings_append_only");
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotelId]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  await db.end();
  await closePool();
});

describe("the laundry, at a property that has not switched it on", () => {
  it("refuses every route, and says how to turn it on", async () => {
    await setLaundry(false);
    const res = await get(`/${CODE}/laundry/price-list`);
    expect(res.status).toBe(403);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/does not run a laundry/i);
  });

  it("refuses a write as well, not only a read", async () => {
    const res = await post(`/${CODE}/laundry/price-list`,
      { name: "Shirt", service: "wash", price: 60 });
    expect(res.status).toBe(403);
  });
});

describe("the price list", () => {
  beforeAll(() => setLaundry(true));

  it("a new property has nothing on it", async () => {
    const body = await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("an item nobody has priced comes back as null, never 0", async () => {
    expect((await post(`/${CODE}/laundry/price-list`,
      { name: "Saree", service: "dry_clean" })).status).toBe(200);

    const body = await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ name: string; price: number | null }> };
    const saree = body.items.find((i) => i.name === "Saree")!;
    expect(saree.price).toBeNull();
    /* The distinction this whole rule exists for. */
    expect(saree.price).not.toBe(0);
  });

  it("refuses a service it does not do", async () => {
    const res = await post(`/${CODE}/laundry/price-list`,
      { name: "Curtain", service: "steam" });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/wash, press or dry-clean/i);
  });

  it("refuses the same item and service twice, whatever the capitals", async () => {
    expect((await post(`/${CODE}/laundry/price-list`,
      { name: "Shirt", service: "wash", price: 60 })).status).toBe(200);
    const res = await post(`/${CODE}/laundry/price-list`,
      { name: "  shirt  ", service: "wash", price: 80 });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/already on the list/i);
  });

  it("0 is kept only when it is ticked Free (D27-120)", async () => {
    const bare = await post(`/${CODE}/laundry/price-list`,
      { name: "Napkin", service: "wash", price: 0 });
    expect(bare.status).toBe(409);
    expect((await bare.json() as { reason: string }).reason).toMatch(/ticked Free/);
    expect((await post(`/${CODE}/laundry/price-list`,
      { name: "Napkin", service: "wash", price: 0, free: true })).status).toBe(200);
    const body = await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ name: string; price: number | null }> };
    expect(body.items.find((i) => i.name === "Napkin")!.price).toBe(0);
  });
});

describe("a docket says whose it is (D18-5)", () => {
  beforeAll(() => setLaundry(true));

  const lines = async () => {
    const body = await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string; service: string }> };
    return body.items;
  };

  it("refuses a docket that does not say", async () => {
    const shirt = (await lines()).find((i) => i.name === "Shirt")!;
    const res = await post(`/${CODE}/laundry/dockets`, {
      lines: [{ priceItemId: shirt.id, quantity: 2 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/whose this is/i);
  });

  it("refuses a guest's docket with no stay on it", async () => {
    const shirt = (await lines()).find((i) => i.name === "Shirt")!;
    const res = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "guest",
      lines: [{ priceItemId: shirt.id, quantity: 2 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/names the stay/i);
  });

  it("refuses the hotel's own linen carrying a stay", async () => {
    const shirt = (await lines()).find((i) => i.name === "Shirt")!;
    const res = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "hotel", stayId,
      lines: [{ priceItemId: shirt.id, quantity: 2 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/does not belong to a stay/i);
  });

  it("refuses an empty bag", async () => {
    const res = await post(`/${CODE}/laundry/dockets`, { belongsTo: "hotel", lines: [] });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/at least one thing/i);
  });
});

describe("a guest's bag, and what it comes to", () => {
  let docketId: string;

  beforeAll(async () => {
    await setLaundry(true);
    const items = (await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string }> }).items;
    const shirt = items.find((i) => i.name === "Shirt")!;
    const saree = items.find((i) => i.name === "Saree")!;

    const res = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "guest", stayId,
      lines: [
        { priceItemId: shirt.id, quantity: 2 },
        { priceItemId: saree.id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(200);
    docketId = (await res.json() as { data: { id: string } }).data.id;
  });

  it("is numbered LD-0001 at a property's first docket", async () => {
    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { number: string };
    expect(body.number).toBe("LD-0001");
  });

  it("names the stay, and the guest, and the room", async () => {
    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { belongsTo: string; stayId: string; guestName: string };
    expect(body.belongsTo).toBe("guest");
    expect(body.stayId).toBe(stayId);
    expect(body.guestName).toBe("Laundry Guest");
  });

  it("has NO total while anything in it is unpriced - not a part-total", async () => {
    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { total: number | null; unpricedLines: number };
    expect(body.total).toBeNull();
    expect(body.unpricedLines).toBe(1);
    /* The shirts alone come to 120. Quoting that would look like the bill. */
    expect(body.total).not.toBe(120);
  });

  it("refuses the charge while that is true, and says why", async () => {
    const res = await post(`/${CODE}/laundry/dockets/${docketId}/charge`);
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/no price yet/i);
  });

  it("gets a total once the missing price is set on a NEW bag", async () => {
    const items = (await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string }> }).items;
    const saree = items.find((i) => i.name === "Saree")!;
    expect((await post(`/${CODE}/laundry/price-list/${saree.id}`,
      { price: 150 })).status).toBe(200);

    const shirt = items.find((i) => i.name === "Shirt")!;
    const made = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "guest", stayId,
      lines: [
        { priceItemId: shirt.id, quantity: 2 },
        { priceItemId: saree.id, quantity: 1 },
      ],
    });
    const id = (await made.json() as { data: { id: string } }).data.id;

    const body = await (await get(`/${CODE}/laundry/dockets/${id}`)).json() as
      { total: number | null };
    expect(body.total).toBe(270);
  });

  it("re-pricing the list does NOT rewrite a docket already written", async () => {
    const items = (await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string }> }).items;
    const shirt = items.find((i) => i.name === "Shirt")!;
    expect((await post(`/${CODE}/laundry/price-list/${shirt.id}`,
      { price: 999 })).status).toBe(200);

    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { lines: Array<{ description: string; unitPrice: number | null }> };
    expect(body.lines.find((l) => l.description === "Shirt")!.unitPrice).toBe(60);
  });
});

describe("the hotel's own linen - counts only", () => {
  let docketId: string;
  let lineId: string;

  beforeAll(async () => {
    await setLaundry(true);
    const items = (await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string }> }).items;
    const napkin = items.find((i) => i.name === "Napkin")!;

    const res = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "hotel",
      lines: [{ priceItemId: napkin.id, quantity: 40 }],
    });
    docketId = (await res.json() as { data: { id: string } }).data.id;
    lineId = ((await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { lines: Array<{ id: string }> }).lines)[0]!.id;
  });

  it("is never charged to anybody - refused before anything else", async () => {
    const res = await post(`/${CODE}/laundry/dockets/${docketId}/charge`);
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/not charged to anybody/i);
  });

  it("counts what came back, and what is still out", async () => {
    const res = await post(`/${CODE}/laundry/dockets/${docketId}/return`,
      { returned: [{ lineId, quantity: 37 }] });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { stillOut: number } }).data.stillOut).toBe(3);

    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { status: string; stillOut: number };
    expect(body.status).toBe("open");
    expect(body.stillOut).toBe(3);
  });

  it("refuses more back than ever went out", async () => {
    const res = await post(`/${CODE}/laundry/dockets/${docketId}/return`,
      { returned: [{ lineId, quantity: 41 }] });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason)
      .toMatch(/more has come back/i);
  });

  it("is returned once nothing is still out - worked out, never typed", async () => {
    expect((await post(`/${CODE}/laundry/dockets/${docketId}/return`,
      { returned: [{ lineId, quantity: 40 }] })).status).toBe(200);

    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { status: string; stillOut: number; returnedAt: string | null };
    expect(body.status).toBe("returned");
    expect(body.stillOut).toBe(0);
    expect(body.returnedAt).not.toBeNull();
  });
});

describe("the list a screen reads", () => {
  beforeAll(() => setLaundry(true));

  it("separates the hotel's linen from the guests' bags", async () => {
    const guests = await (await get(`/${CODE}/laundry/dockets?whose=guest`)).json() as
      { dockets: Array<{ belongsTo: string }> };
    expect(guests.dockets.length).toBeGreaterThan(0);
    expect(guests.dockets.every((d) => d.belongsTo === "guest")).toBe(true);

    const hotel = await (await get(`/${CODE}/laundry/dockets?whose=hotel`)).json() as
      { dockets: Array<{ belongsTo: string }> };
    expect(hotel.dockets.every((d) => d.belongsTo === "hotel")).toBe(true);
  });

  it("offers the next docket number rather than making the desk guess", async () => {
    const body = await (await get(`/${CODE}/laundry/dockets`)).json() as
      { nextNumber: string };
    expect(body.nextNumber).toMatch(/^LD-\d{4,}$/);
  });
});

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S BAG REACHES THE ROOM BILL (D18-7)

   ⚠ NO TEST COULD PROVE THIS BEFORE 21 SEPTEMBER, because the route
   could not do it. Every test above proves a REFUSAL — unpriced, the
   hotel's own linen — and they all passed while the one thing the route
   exists for was impossible: it ended in "finance's door does not hand
   out a way to post a charge", three days after that door was built for
   it. A suite made only of refusals cannot tell a guard from a wall.

   This is the half that was missing: a priced guest docket is charged,
   the line lands on THAT stay's bill with the laundry category the Extra
   Charges report reads, and the same bag cannot be charged twice.

   This file provisions its own property and removes it afterwards, so the
   line it posts is taken away with it and nothing reaches a real bill.
   ══════════════════════════════════════════════════════════════════ */
describe("a guest's bag, charged to the room", () => {
  let docketId: string;
  let total: number;

  beforeAll(async () => {
    await setLaundry(true);
    /* A freshly provisioned property has NO tax rule — nothing ships a
       price (032) — and finance refuses to post without one. Laundry
       follows the room's rule. The rate here is this fixture's own. */
    const db = await admin();
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'laundry test fixture')
       on conflict (hotel_id, kind, over_amount) do nothing`, [hotelId]);
    await db.end();

    const items = (await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string; price: number | null }> }).items;
    const priced = items.find((i) => i.price !== null && i.price > 0)!;
    expect(priced, "the test property has a priced item to bag").toBeTruthy();

    const made = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "guest", stayId,
      lines: [{ priceItemId: priced.id, quantity: 3 }],
    });
    docketId = (await made.json() as { data: { id: string } }).data.id;
    total = (await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { total: number }).total;
    expect(total, "the bag has a total to charge").toBeGreaterThan(0);
  });

  it("puts the bag on the guest's own bill, as its own laundry line", async () => {
    const res = await post(`/${CODE}/laundry/dockets/${docketId}/charge`);
    expect(res.status, await res.clone().text()).toBe(200);
    const { data } = await res.json() as { data: { postingId: string } };

    const db = await admin();
    const { rows } = await db.query<{
      category: string; amount: string; reservation_id: string; description: string;
    }>(
      `select fp.category, fp.amount::text, f.reservation_id::text, fp.description
         from folio_postings fp join folios f on f.id = fp.folio_id
        where fp.id = $1`, [data.postingId]);
    await db.end();

    expect(rows[0], "a line was posted").toBeTruthy();
    /* The Extra Charges report reads category 'laundry' — land anywhere
       else and the report's Laundry row stays empty (D18-7). */
    expect(rows[0]!.category).toBe("laundry");
    expect(Number(rows[0]!.amount)).toBe(total);
    expect(rows[0]!.reservation_id, "on THIS stay's bill").toBe(stayId);
    expect(rows[0]!.description).toMatch(/^Laundry LD-/);
  });

  it("shows the docket as charged, and will not charge it twice", async () => {
    const body = await (await get(`/${CODE}/laundry/dockets/${docketId}`)).json() as
      { charged: boolean };
    expect(body.charged).toBe(true);

    const again = await post(`/${CODE}/laundry/dockets/${docketId}/charge`);
    expect(again.status).toBe(409);
    expect((await again.json() as { reason: string }).reason)
      .toMatch(/already on the bill/i);
  });
});

describe("only a guest in the house (BQ-2, QA 28 September)", () => {
  let arriving: string;

  beforeAll(async () => {
    await setLaundry(true);
    const db = await admin();
    const guest = (await db.query<{ id: string }>(
      "insert into guests (full_name) values ('Laundry Arriving') returning id")).rows[0]!.id;
    arriving = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                                 check_in, check_out, agreed_rate, status)
       values ($1, app.next_reference($1), $2,
               (select id from room_types where hotel_id = $1 limit 1),
               current_date + 5, current_date + 6, 2000, 'confirmed')
       returning id`, [hotelId, guest])).rows[0]!.id;
    await db.end();
  });

  it("refuses a bag for a booking still to arrive, and writes no docket", async () => {
    const list = await (await get(`/${CODE}/laundry/price-list`)).json() as
      { items: Array<{ id: string; name: string; price: number | null }> };
    const shirt = list.items.find((i) => i.name === "Shirt")!;
    const res = await post(`/${CODE}/laundry/dockets`, {
      belongsTo: "guest", stayId: arriving,
      lines: [{ priceItemId: shirt.id, quantity: 1 }],
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/not checked in yet/);

    const db = await admin();
    const { rows } = await db.query(
      "select 1 from laundry_dockets where reservation_id = $1", [arriving]);
    await db.end();
    expect(rows).toHaveLength(0);
  });
});
