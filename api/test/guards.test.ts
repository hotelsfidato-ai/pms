import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT THE API REFUSES

   Two guards that only matter because they are enforced on the SERVER.

   · A property with no restaurant should not show its staff a till.
     Hiding the nav entry is not disabling it — the URL still exists,
     and the endpoint behind it would answer happily. So the API
     refuses independently of the interface.

   · Void is not cancel. Cancelled HAPPENED and was undone; void NEVER
     HAPPENED. The line between them is whether money reached the
     folio, and the server is what holds it.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  const staff = await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'",
  );
  ownerStaffId = staff.rows[0]!.id;
  await db.end();
});

afterAll(async () => {
  /* The gate is a ROW, and a row left behind turns the demo's till off
     for everyone afterwards. Removed rather than set back to true, so
     the property returns to "no row", which is the state it started in. */
  const db = await admin();
  try {
    await db.query("delete from hotel_modules where module = 'pos'");

    /* In dependency order, and the ledger's guard lifted rather than
       weakened. Deleting reservations first fails on the foreign key from
       room_assignments — which is the constraint doing its job, and is
       why the first version of this teardown cleaned up nothing at all
       and left GUARD-1 behind to collide with the next run. */
    const { rows: mine } = await db.query<{ id: string }>(
      `select id::text from reservations where reference like 'GUARD-%'`);

    if (mine.length) {
      const ids = mine.map((r) => r.id);
      await db.query(
        `delete from room_assignments where reservation_id = any($1::uuid[])`,
        [ids]);

      await db.query(
        "alter table folio_postings disable trigger folio_postings_append_only");
      try {
        await db.query(
          `delete from folio_postings where folio_id in
             (select id from folios where reservation_id = any($1::uuid[]))`,
          [ids]);
      } finally {
        await db.query(
          "alter table folio_postings enable trigger folio_postings_append_only");
      }

      await db.query(
        `delete from folios where reservation_id = any($1::uuid[])`, [ids]);
      await db.query(
        `delete from reservations where id = any($1::uuid[])`, [ids]);
    }

    await db.query("alter table guests disable trigger guests_no_delete");
    try {
      await db.query(
        `delete from guests where full_name = 'Guard test guest'`);
    } finally {
      await db.query("alter table guests enable trigger guests_no_delete");
    }
  } finally {
    await db.end();
  }
  await closePool();
});

const as = (path: string) =>
  app.request(`/api/hotels${path}`, {
    headers: { "x-dev-staff-id": ownerStaffId },
  });

const post = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: "POST",
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("the module gate", () => {
  it("reports POS on and banquet off when no row exists", async () => {
    const res = await as("/5EL/modules");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      modules: { module: string; enabled: boolean }[];
    };

    /* Absent means ENABLED for pos. If this ever flips, deploying 041
       would close the till at a property that was using it. */
    expect(body.modules.find((m) => m.module === "pos")!.enabled).toBe(true);
    expect(body.modules.find((m) => m.module === "banquet")!.enabled).toBe(false);
  });

  it("refuses the till on the SERVER once the module is off", async () => {
    const off = await post("/5EL/modules/pos", { enabled: false });
    expect(off.status).toBe(200);

    const menu = await as("/5EL/till/menu");
    /* 403, not 404 and not an empty list. An empty menu would read as
       "this restaurant has no dishes yet" and send somebody looking for
       a data problem that does not exist. */
    expect(menu.status).toBe(403);
    expect(((await menu.json()) as { reason: string }).reason)
      .toMatch(/no point of sale/i);

    const orders = await as("/5EL/till/orders");
    expect(orders.status).toBe(403);

    const kitchen = await as("/5EL/kitchen");
    expect(kitchen.status).toBe(403);
  });

  it("does not reach another property", async () => {
    /* 5EL is off from the test above. AGR must be untouched — a group
       setting that leaked across properties would be the worst kind of
       bug here, because it looks like the feature working. */
    const res = await as("/AGR/modules");
    const body = (await res.json()) as {
      modules: { module: string; enabled: boolean }[];
    };
    expect(body.modules.find((m) => m.module === "pos")!.enabled).toBe(true);
  });

  it("comes back when turned on", async () => {
    const on = await post("/5EL/modules/pos", { enabled: true });
    expect(on.status).toBe(200);

    const menu = await as("/5EL/till/menu");
    expect(menu.status).toBe(200);
  });

  it("refuses a module nobody has heard of", async () => {
    const res = await post("/5EL/modules/spa", { enabled: true });
    expect(res.status).toBe(409);
  });
});

describe("void is not cancel", () => {
  async function bookingWith(reference: string, status = "confirmed") {
    const db = await admin();
    try {
      const { rows: g } = await db.query<{ id: string }>(
        `insert into guests (full_name, phone)
         values ('Guard test guest', '9000000009') returning id`);
      const { rows: h } = await db.query<{ id: string }>(
        `select id from hotels where code = '5EL'`);
      const { rows: rt } = await db.query<{ id: string }>(
        `select id from room_types where hotel_id = $1 limit 1`, [h[0]!.id]);
      const { rows: r } = await db.query<{ id: string }>(
        `insert into reservations
           (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
            adults, status, source, created_by, agreed_rate)
         values ($1,$2,$3,$4, current_date + 30, current_date + 32,
                 1, $5, 'direct', $6, 2500.00)
         returning id`,
        [h[0]!.id, g[0]!.id, rt[0]!.id, reference, status, ownerStaffId]);
      return { id: r[0]!.id, hotelId: h[0]!.id };
    } finally {
      await db.end();
    }
  }

  it("refuses a void with no reason", async () => {
    const b = await bookingWith("GUARD-1");
    const res = await post(`/5EL/stays/${b.id}/void`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/why/i);
  });

  it("refuses to void a stay that already happened", async () => {
    const b = await bookingWith("GUARD-2", "checked_in");
    const res = await post(`/5EL/stays/${b.id}/void`, { reason: "oops" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/cannot be made not to have happened/i);
  });

  it("refuses to void a booking with money on its folio", async () => {
    const b = await bookingWith("GUARD-3");
    const db = await admin();
    try {
      const { rows: f } = await db.query<{ id: string }>(
        `insert into folios (hotel_id, reservation_id, status)
         values ($1, $2, 'open') returning id`, [b.hotelId, b.id]);
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, posted_by)
         values ($1,$2, current_date, 'room', 'Night 1',
                 2500.00, 12, 300.00, $3)`,
        [b.hotelId, f[0]!.id, ownerStaffId]);
    } finally {
      await db.end();
    }

    const res = await post(`/5EL/stays/${b.id}/void`, { reason: "duplicate" });
    expect(res.status).toBe(409);
    /* Money on the folio means the booking was real enough to be billed.
       Erasing it would take a posting out of an append-only ledger by
       the back door. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/cancellation, not a void/i);
  });

  it("voids a clean booking, and lets the room go", async () => {
    const b = await bookingWith("GUARD-4");
    const db = await admin();
    try {
      const { rows: room } = await db.query<{ id: string }>(
        `select id from rooms where hotel_id = $1 limit 1`, [b.hotelId]);
      await db.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, created_by)
         values ($1,$2,$3, current_date + 30, current_date + 32, $4)`,
        [b.hotelId, b.id, room[0]!.id, ownerStaffId]);
    } finally {
      await db.end();
    }

    const res = await post(`/5EL/stays/${b.id}/void`, {
      reason: "entered twice",
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const check = await admin();
    try {
      const { rows } = await check.query<{ status: string; held: string }>(
        `select r.status,
                (select count(*)::text from room_assignments a
                  where a.reservation_id = r.id and a.released_at is null) as held
           from reservations r where r.id = $1`, [b.id]);
      expect(rows[0]!.status).toBe("void");
      /* A voided booking holding a room out of inventory is found weeks
         later, by a clerk who cannot sell a room that looks empty. */
      expect(rows[0]!.held).toBe("0");
    } finally {
      await check.end();
    }
  });
});
