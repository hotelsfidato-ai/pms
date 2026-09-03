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

describe("a walk-in records where it came from", () => {
  let made: string | null = null;

  afterAll(async () => {
    if (!made) return;
    const db = await admin();
    try {
      await db.query(
        `delete from room_assignments where reservation_id = $1`, [made]);
      await db.query(
        "alter table folio_postings disable trigger folio_postings_append_only");
      try {
        await db.query(
          `delete from folio_postings where folio_id in
             (select id from folios where reservation_id = $1)`, [made]);
      } finally {
        await db.query(
          "alter table folio_postings enable trigger folio_postings_append_only");
      }
      await db.query(`delete from folios where reservation_id = $1`, [made]);
      await db.query(`delete from reservations where id = $1`, [made]);
      await db.query("alter table guests disable trigger guests_no_delete");
      try {
        await db.query(
          `delete from guests where full_name = 'Source Test Guest'`);
      } finally {
        await db.query("alter table guests enable trigger guests_no_delete");
      }
    } finally {
      await db.end();
    }
  });

  it("stores the segment, the source and the seller", async () => {
    const db = await admin();
    let room: string;
    try {
      /* A room nobody is in, so the walk-in is not fighting the demo. */
      const { rows } = await db.query<{ number: string }>(
        `select rm.number from rooms rm
           join hotels h on h.id = rm.hotel_id
          where h.code = '5EL'
            and not exists (
              select 1 from room_assignments a
               where a.room_id = rm.id and a.released_at is null)
          limit 1`);
      expect(rows[0], "the demo has no free room").toBeTruthy();
      room = rows[0]!.number;
    } finally {
      await db.end();
    }

    const res = await post("/5EL/walk-ins", {
      guestName: "Source Test Guest",
      roomNumber: room, nights: 1, adults: 1, children: 0,
      ratePlan: "CP", rackTariff: 4000, offeredTariff: 4000,
      overrideReason: "", businessDate: "2026-08-25", user: "test",
      businessSource: "Sharma Travels",
      marketSegment: "Corporate",
      salesPerson: "R Patil",
      isSingleLady: true,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    made = ((await res.json()) as { data: { id: string } }).data.id;

    const check = await admin();
    try {
      const { rows } = await check.query<{
        business_source: string | null; market_segment: string | null;
        sales_person: string | null; is_single_lady: boolean;
      }>(
        `select business_source, market_segment, sales_person, is_single_lady
           from reservations where id = $1`, [made]);

      expect(rows[0]!.business_source).toBe("Sharma Travels");
      expect(rows[0]!.market_segment).toBe("Corporate");
      expect(rows[0]!.sales_person).toBe("R Patil");
      expect(rows[0]!.is_single_lady).toBe(true);
    } finally {
      await check.end();
    }
  });

  it("leaves an unanswered field NULL, not an empty string", async () => {
    const res = await as(`/5EL/stays/${made}`);
    expect(res.status).toBe(200);

    /* The distinction matters downstream. An empty string sorts and
       groups as its own category in a source-mix report and reads as a
       real answer somebody gave; null renders as a dash. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from reservations
          where business_source = '' or market_segment = ''
             or sales_person = ''`);
      expect(rows[0]!.n).toBe("0");
    } finally {
      await db.end();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   MOVING A GUEST

   Room 203 to 305 on night three. The thing that has to be right is
   the seam: 203 free FROM the move date and not a night either side,
   because both mistakes are invisible until somebody cannot book an
   empty room, or two guests are sent to the same door.

   And the money. The audit posts `reservations.agreed_rate`,
   snapshotted at booking, so a move reprices nothing on its own —
   that is a decision somebody makes, not a side effect.
   ══════════════════════════════════════════════════════════════════ */

describe("moving a guest between rooms", () => {
  /* A stay of its own, so this cannot disturb the calibration the
     inventory grid is checked against. */
  let stayId: string;
  let firstRoom: string;
  let secondRoom: string;
  let guestId: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows: h } = await db.query<{ id: string }>(
        "select id from hotels where code = '5EL'");
      const hotel = h[0]!.id;

      const { rows: rooms } = await db.query<{ id: string; number: string }>(
        `select id::text, number from rooms
          where hotel_id = $1 and is_active
            and housekeeping_status <> 'out_of_service'
          order by number limit 2`, [hotel]);
      firstRoom = rooms[0]!.number;
      secondRoom = rooms[1]!.number;

      const { rows: g } = await db.query<{ id: string }>(
        `insert into guests (full_name) values ('Move Test Guest')
         returning id::text`);
      guestId = g[0]!.id;

      const { rows: r } = await db.query<{ id: string }>(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                   check_in, check_out, agreed_rate, status)
         select $1, $2, rm.room_type_id, 'MOVETEST-1',
                date '2027-03-01', date '2027-03-06', 3000, 'checked_in'
           from rooms rm where rm.id = $3
         returning id::text`, [hotel, guestId, rooms[0]!.id]);
      stayId = r[0]!.id;

      await db.query(
        `insert into room_assignments (hotel_id, reservation_id, room_id,
                                       from_date, to_date, reason)
         values ($1,$2,$3,date '2027-03-01',date '2027-03-06','arrival')`,
        [hotel, stayId, rooms[0]!.id]);
    } finally { await db.end(); }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query("delete from room_assignments where reservation_id = $1", [stayId]);
      await db.query("delete from reservations where id = $1", [stayId]);
      await db.query("alter table guests disable trigger guests_no_delete");
      await db.query("delete from guests where id = $1", [guestId]);
      await db.query("alter table guests enable trigger guests_no_delete");
    } finally { await db.end(); }
  });

  const liveRooms = async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ number: string; from: string; to: string }>(
        `select rm.number, ra.from_date::text as from, ra.to_date::text as to
           from room_assignments ra join rooms rm on rm.id = ra.room_id
          where ra.reservation_id = $1 and ra.released_at is null
          order by ra.from_date`, [stayId]);
      return rows;
    } finally { await db.end(); }
  };

  it("splits the stay at the move date", async () => {
    const res = await post(`/5EL/stays/${stayId}/move`, {
      roomNumber: secondRoom, from: "2027-03-03", reason: "move",
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      from: string; to: string; nightsBefore: number; nightsAfter: number;
    };
    expect(body.from).toBe(firstRoom);
    expect(body.to).toBe(secondRoom);
    expect(body.nightsBefore).toBe(2);
    expect(body.nightsAfter).toBe(3);

    const live = await liveRooms();
    expect(live).toHaveLength(2);
    /* The seam. 203 is given up ON the 3rd — half-open, so somebody may
       check into it that night. */
    expect(live[0]).toMatchObject({ number: firstRoom, to: "2027-03-03" });
    expect(live[1]).toMatchObject({ number: secondRoom, from: "2027-03-03" });
  });

  it("leaves the agreed rate alone", async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ rate: string }>(
        "select agreed_rate::text as rate from reservations where id = $1",
        [stayId]);
      /* A move is not a repricing. The audit posts this number, and
         nights already posted are history either way. */
      expect(Number(rows[0]!.rate)).toBe(3000);
    } finally { await db.end(); }
  });

  it("changes it only when asked", async () => {
    const res = await post(`/5EL/stays/${stayId}/move`, {
      roomNumber: firstRoom, from: "2027-03-04",
      reason: "downgrade", agreedRate: 2400,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { rateChanged: boolean }).rateChanged).toBe(true);

    const db = await admin();
    try {
      const { rows } = await db.query<{ rate: string }>(
        "select agreed_rate::text as rate from reservations where id = $1",
        [stayId]);
      expect(Number(rows[0]!.rate)).toBe(2400);
    } finally { await db.end(); }
  });

  it("refuses the room they are already in, by name", async () => {
    const res = await post(`/5EL/stays/${stayId}/move`, {
      roomNumber: firstRoom, from: "2027-03-05",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/already in/i);
  });

  it("refuses a date outside the stay", async () => {
    const res = await post(`/5EL/stays/${stayId}/move`, {
      roomNumber: secondRoom, from: "2027-04-20",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/outside the stay/i);
  });

  it("refuses a room that does not exist here", async () => {
    const res = await post(`/5EL/stays/${stayId}/move`, {
      roomNumber: "9999", from: "2027-03-05",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/no room 9999/i);
  });

  it("takes them out of the room, and says which", async () => {
    const res = await post(`/5EL/stays/${stayId}/unassign`, {});
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { room: string }).room).toBeTruthy();

    expect(await liveRooms()).toHaveLength(0);

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from room_assignments
          where reservation_id = $1`, [stayId]);
      /* Releasing is not deleting. "Who was in that room last Tuesday"
         has to keep an answer. */
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    } finally { await db.end(); }
  });

  it("and refuses to do it twice", async () => {
    const res = await post(`/5EL/stays/${stayId}/unassign`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/not in a room/i);
  });
});

/* ══════════════════════════════════════════════════════════════════
   AMENDING A STAY

   The room hold moving WITH the booking is the assertion that
   matters. A booking claiming six nights while the room is held for
   four is invisible on every screen until somebody opens an occupied
   door.
   ══════════════════════════════════════════════════════════════════ */

describe("amending a stay", () => {
  let stayId: string;
  let guestId: string;
  let roomId: string;

  const patch = (body: unknown) =>
    app.request(`/api/hotels/5EL/stays/${stayId}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  const held = async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ to: string }>(
        `select to_date::text as to from room_assignments
          where reservation_id = $1 and released_at is null`, [stayId]);
      return rows[0]?.to ?? null;
    } finally { await db.end(); }
  };

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows: h } = await db.query<{ id: string }>(
        "select id from hotels where code = '5EL'");
      const { rows: rm } = await db.query<{ id: string }>(
        `select id::text from rooms
          where hotel_id = $1 and is_active
            and housekeeping_status <> 'out_of_service'
          order by number desc limit 1`, [h[0]!.id]);
      roomId = rm[0]!.id;

      const { rows: g } = await db.query<{ id: string }>(
        `insert into guests (full_name) values ('Amend Test Guest')
         returning id::text`);
      guestId = g[0]!.id;

      const { rows: r } = await db.query<{ id: string }>(
        `insert into reservations (hotel_id, guest_id, room_type_id, reference,
                                   check_in, check_out, adults, children,
                                   agreed_rate, status)
         select $1, $2, rm.room_type_id, 'AMENDTEST-1',
                date '2027-05-01', date '2027-05-05', 2, 0, 3000, 'confirmed'
           from rooms rm where rm.id = $3
         returning id::text`, [h[0]!.id, guestId, roomId]);
      stayId = r[0]!.id;

      await db.query(
        `insert into room_assignments (hotel_id, reservation_id, room_id,
                                       from_date, to_date, reason)
         values ($1,$2,$3,date '2027-05-01',date '2027-05-05','arrival')`,
        [h[0]!.id, stayId, roomId]);
    } finally { await db.end(); }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query("delete from room_assignments where reservation_id = $1", [stayId]);
      await db.query("delete from reservations where id = $1", [stayId]);
      await db.query("alter table guests disable trigger guests_no_delete");
      await db.query("delete from guests where id = $1", [guestId]);
      await db.query("alter table guests enable trigger guests_no_delete");
    } finally { await db.end(); }
  });

  it("extends the stay and the room hold together", async () => {
    const res = await patch({ checkOut: "2027-05-08" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      nightsBefore: number; nightsAfter: number; roomHeld: string | null;
    };
    expect(body.nightsBefore).toBe(4);
    expect(body.nightsAfter).toBe(7);
    expect(body.roomHeld).toBeTruthy();

    /* The assertion this whole feature exists for. */
    expect(await held()).toBe("2027-05-08");
  });

  it("treats a missing field as unchanged, not as null", async () => {
    /* A PATCH that read a missing key as null would shorten the stay to
       nothing because a form did not send a field. */
    const res = await patch({ adults: 3 });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { checkOut: string; adults: number };
    expect(body.checkOut).toBe("2027-05-08");
    expect(body.adults).toBe(3);
  });

  it("refuses more people than the room type sleeps, by name", async () => {
    const res = await patch({ adults: 9, children: 4 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/will not fit|sleeps/i);
  });

  it("refuses a departure before the arrival", async () => {
    const res = await patch({ checkOut: "2027-04-01" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/ends after it starts/i);
  });

  it("leaves everything alone when it refuses", async () => {
    expect(await held()).toBe("2027-05-08");
    const db = await admin();
    try {
      const { rows } = await db.query<{ out: string }>(
        `select check_out::text as out from reservations where id = $1`, [stayId]);
      expect(rows[0]!.out).toBe("2027-05-08");
    } finally { await db.end(); }
  });
});

/* ══════════════════════════════════════════════════════════════════
   GROUPS — twelve rooms and one host

   The refusals matter more than the happy path here, because both
   failure modes are silent: a tick that does nothing, and a charge
   that lands nowhere.
   ══════════════════════════════════════════════════════════════════ */

describe("group billing", () => {
  let groupId: string;
  let routedStay: string;
  let loneStay: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ id: string; group_id: string }>(
        `select r.id::text, r.group_id::text as group_id
           from reservations r
           join hotels h on h.id = r.hotel_id
          where h.code = '5EL' and r.group_id is not null
          limit 1`);
      routedStay = rows[0]!.id;
      groupId = rows[0]!.group_id;

      const { rows: lone } = await db.query<{ id: string }>(
        `select r.id::text from reservations r
           join hotels h on h.id = r.hotel_id
          where h.code = '5EL' and r.group_id is null limit 1`);
      loneStay = lone[0]!.id;
    } finally { await db.end(); }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query("update reservations set route_room_to_group = false");
      await db.query("delete from folios where group_id is not null");
    } finally { await db.end(); }
  });

  it("refuses to route a booking that is in no group, by name", async () => {
    const res = await post(`/5EL/stays/${loneStay}/routing`, { toGroup: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/not in a group/i);
  });

  it("refuses to route when the group has no master yet", async () => {
    const db = await admin();
    try { await db.query("delete from folios where group_id = $1", [groupId]); }
    finally { await db.end(); }

    /* app.folio_for_room_charge WOULD fall back to the stay's own folio —
       deliberately, because a charge landing nowhere is worse than one on
       the wrong account. But a clerk who ticked "host pays" and got a
       silent fallback would never know the tick did nothing. */
    const res = await post(`/5EL/stays/${routedStay}/routing`, { toGroup: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/no open master folio/i);
  });

  it("opens the master, and opening it twice is not an error", async () => {
    const first = await post(`/5EL/groups/${groupId}/master`, {});
    expect(first.status, await first.clone().text()).toBe(200);
    expect(((await first.json()) as { created: boolean }).created).toBe(true);

    const again = await post(`/5EL/groups/${groupId}/master`, {});
    expect(again.status).toBe(200);
    const body = (await again.json()) as { created: boolean; id: string };
    expect(body.created).toBe(false);
    expect(body.id).toBeTruthy();
  });

  it("routes the room once there is somewhere to route it to", async () => {
    const res = await post(`/5EL/stays/${routedStay}/routing`, { toGroup: true });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { routed: boolean }).routed).toBe(true);
  });

  it("keeps the two balances apart", async () => {
    const res = await as(`/5EL/groups/${groupId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rooms: { routed: boolean }[];
      master: { balance: number } | null;
      guestBalance: number;
    };
    expect(body.master).not.toBeNull();
    expect(body.rooms.some((r) => r.routed)).toBe(true);
    /* Two figures, never summed into one. What the host owes and what the
       guests owe are collected from different people. */
    expect(typeof body.guestBalance).toBe("number");
    expect(typeof body.master!.balance).toBe("number");
  });
});

/* ══════════════════════════════════════════════════════════════════
   BOOKING SEVERAL ROOMS AT ONCE

   Four Deluxes and two Superiors for the same three nights. The
   refusals matter: a rate quietly guessed for a party the room type
   has not been priced for is discovered at check-out.
   ══════════════════════════════════════════════════════════════════ */

describe("booking several rooms", () => {
  let typeId: string;
  let smallType: string;
  let smallMax: number;
  const made: string[] = [];

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ id: string; max: number }>(
        `select rt.id::text, rt.max_occupancy as max
           from room_types rt join hotels h on h.id = rt.hotel_id
          where h.code = '5EL' and rt.max_occupancy > rt.base_occupancy
          order by rt.sort_order limit 1`);
      typeId = rows[0]!.id;

      const { rows: small } = await db.query<{ id: string; max: number }>(
        `select rt.id::text, rt.max_occupancy as max
           from room_types rt join hotels h on h.id = rt.hotel_id
          where h.code = '5EL' order by rt.max_occupancy limit 1`);
      smallType = small[0]!.id;
      smallMax = small[0]!.max;
    } finally { await db.end(); }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `delete from reservations where reference = any($1)`, [made]);
      await db.query(
        `delete from reservation_groups where name like 'BOOKTEST%'`);
      await db.query("alter table guests disable trigger guests_no_delete");
      await db.query("delete from guests where full_name = 'Booking Test'");
      await db.query("alter table guests enable trigger guests_no_delete");
    } finally { await db.end(); }
  });

  const book = (body: unknown) => post("/5EL/bookings", body);

  it("creates one group and several rooms", async () => {
    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-01", checkOut: "2027-09-04",
      groupName: "BOOKTEST wedding",
      lines: [
        { roomTypeId: typeId, mealPlan: "EP", adults: 2, rooms: 3 },
        { roomTypeId: typeId, mealPlan: "EP", adults: 1, rooms: 1 },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      groupId: string | null; rooms: number;
      bookings: { reference: string; rate: number }[];
    };
    expect(body.rooms).toBe(4);
    expect(body.groupId).toBeTruthy();
    expect(body.bookings).toHaveLength(4);
    for (const b of body.bookings) made.push(b.reference);
  });

  it("does not invent a group for a single room", async () => {
    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-10", checkOut: "2027-09-12",
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, rooms: 1 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      groupId: string | null; bookings: { reference: string }[];
    };
    /* A group of one puts a row in every group list that nobody means. */
    expect(body.groupId).toBeNull();
    for (const b of body.bookings) made.push(b.reference);
  });

  it("refuses a party the room type cannot sleep", async () => {
    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-01", checkOut: "2027-09-03",
      lines: [{ roomTypeId: smallType, adults: smallMax + 3, rooms: 1 }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/will not fit|sleeps/i);
  });

  it("refuses a departure before the arrival", async () => {
    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-10", checkOut: "2027-09-01",
      lines: [{ roomTypeId: typeId, adults: 2, rooms: 1 }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/ends after it starts/i);
  });

  it("refuses a quantity that looks like a typo", async () => {
    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-01", checkOut: "2027-09-03",
      lines: [{ roomTypeId: typeId, adults: 2, rooms: 400 }],
    });
    expect(res.status).toBe(409);
    /* Not a policy — a guard against four hundred reservations nobody can
       undo one at a time. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/looks like a mistake/i);
  });

  it("refuses when the party has no price, and says what is missing", async () => {
    const db = await admin();
    try {
      await db.query(
        "update room_types set extra_adult_rate = null where id = $1", [typeId]);
    } finally { await db.end(); }

    const res = await book({
      guestName: "Booking Test",
      checkIn: "2027-09-01", checkOut: "2027-09-03",
      /* Three adults in a room that sleeps three, with no extra-adult rate.
         Charging the couple's price here is discovered at check-out. */
      lines: [{ roomTypeId: typeId, adults: 3, rooms: 1 }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/extra adult/i);
  });
});
