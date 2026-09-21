import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import {
  SPA_READ_ROLES, SPA_BOOK_ROLES, SPA_LIST_ROLES,
} from "../../../src/modules/spa/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SPA — the switch, the clock, who may do what, and the overlap

   ⚠ EVERY QUERY HERE RUNS WITH THE SESSION IN UTC, the way the hotel's
   own server runs it (root MEMORY 297). This laptop is Asia/Kolkata, so
   a bare timestamp written anywhere in this service would mean the
   hotel's clock BY ACCIDENT here and be five and a half hours out in
   Akkalkot. Asking in the server's worst case is the only way the fault
   fails on the machine it is written on.

   ⚠ AND THE REFUSALS ARE THE POINT. A file that only proved the owner
   can book passes with no guard at all.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

/** A connection that thinks it is in GMT, as the hotel's server does. */
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("set time zone 'UTC'");
    return await db.query(text, params);
  } finally { await db.end(); }
};

const HOTEL = "5EL";
const TAG = "SPATEST";

let ownerId: string;
let stayId: string;
let hotelId: string;
let massageId: string;
let unpricedId: string;
let priyaId: string;
let sunitaId: string;
const byRole = new Map<string, string>();

const get = (staffId: string, path: string) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    headers: { "x-dev-staff-id": staffId },
  });

const send = (staffId: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const post = (staffId: string, path: string, body?: unknown) =>
  send(staffId, "POST", path, body);

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true
     returning id::text`,
    [`spa-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-spa-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  byRole.set(role, id);
  return id;
};

const setModule = (on: boolean) => sql(
  `insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'spa',$2)
   on conflict (hotel_id, module) do update set is_enabled = $2`, [hotelId, on]);

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text from hotels where code = $1", [HOTEL])).rows[0].id;
  stayId = (await sql(
    `select id::text from reservations
      where hotel_id = $1 and status = 'checked_in' order by check_in limit 1`,
    [hotelId])).rows[0].id;

  for (const role of ["front_desk", "housekeeping", "gm", "chef"]) {
    await person(role, role);
  }
});

afterAll(async () => {
  /* Everything this file made, and the switch back to where it was: OFF
     at every property until somebody turns it on (115). A fixture's
     damage always lands in somebody else's test (root MEMORY 292). */
  /* ⚠ THE BILL LINES A CLOSE POSTED, FIRST — and only those. This file
     runs at 5EL, the real demo property, against a real in-house stay,
     and a treatment that closes puts a real line on that guest's bill.
     A test once left ₹2,734.50 on the demo property's bills (root MEMORY
     292). The ledger is append-only, so the trigger is lifted for exactly
     these rows — found by this file's own tag in the line's words — and
     put straight back. The appointments go next, which releases their
     reference to the line. */
  await sql("update spa_appointments set posting_id = null where hotel_id = $1", [hotelId]);
  await sql("alter table folio_postings disable trigger folio_postings_append_only");
  await sql("delete from folio_postings where description like $1", [`%${TAG}%`]);
  await sql("alter table folio_postings enable trigger folio_postings_append_only");
  await sql("delete from spa_appointments where hotel_id = $1", [hotelId]);
  await sql("delete from spa_treatments where name like $1", [`${TAG}%`]);
  await sql("delete from spa_therapists where name like $1", [`${TAG}%`]);
  await sql("delete from tax_rules where hotel_id = $1 and kind = 'spa'", [hotelId]);
  await sql("delete from hotel_modules where hotel_id = $1 and module = 'spa'", [hotelId]);
  await closePool();
});


describe("the switch (D17-54, migration 115)", () => {
  it("refuses every spa route at a property that has not turned it on", async () => {
    await setModule(false);

    for (const path of ["/spa", "/spa/treatments", "/spa/therapists"]) {
      const r = await get(ownerId, path);
      expect(r.status, `${path} answered while the spa is off`).toBe(403);
      /* WHICH refusal, never the status alone — a request that slips a
         gate is refused further in with a status too (root MEMORY 295). */
      expect(((await r.json()) as { reason: string }).reason)
        .toContain("This property has no spa");
    }

    /* And the writing end, because a hidden screen is still a URL. */
    const booked = await post(ownerId, "/spa/appointments", { stayId });
    expect(booked.status).toBe(403);
  });

  it("answers once the property is switched on", async () => {
    await setModule(true);
    const r = await get(ownerId, "/spa/treatments");
    expect(r.status, await r.clone().text()).toBe(200);
  });
});


describe("the price list", () => {
  it("takes a treatment with no price, and says nobody has priced it", async () => {
    const made = await post(ownerId, "/spa/treatments",
      { name: `${TAG} Aromatherapy`, minutes: 90 });
    expect(made.status, await made.clone().text()).toBe(200);
    unpricedId = ((await made.json()) as { id: string }).id;

    const list = await get(ownerId, "/spa/treatments");
    const { treatments } = (await list.json()) as {
      treatments: Array<{ id: string; price: number | null }>;
    };
    const mine = treatments.find((t) => t.id === unpricedId)!;

    /* NULL, NEVER 0. `toBeNull` and not `toBeFalsy`: 0 is falsy, and 0 is
       exactly the wrong answer this project keeps having to take back
       out. A treatment nobody has priced is a dash. */
    expect(mine.price).toBeNull();
  });

  it("keeps a price that was typed", async () => {
    const made = await post(ownerId, "/spa/treatments",
      { name: `${TAG} Swedish massage`, minutes: 60, price: 2500 });
    expect(made.status, await made.clone().text()).toBe(200);
    massageId = ((await made.json()) as { id: string }).id;

    const list = await get(ownerId, "/spa/treatments");
    const { treatments } = (await list.json()) as {
      treatments: Array<{ id: string; price: number | null; minutes: number }>;
    };
    const mine = treatments.find((t) => t.id === massageId)!;
    expect(mine.price).toBe(2500);
    expect(mine.minutes).toBe(60);
  });

  it("refuses a treatment with no length — the diary places a booking by it", async () => {
    const r = await post(ownerId, "/spa/treatments", { name: `${TAG} No length` });
    /* 409, not 403: the owner MAY set the list, and this one cannot be
       done. The two are kept apart all the way to the status line so a
       screen can tell "ask your manager" from "you left a field out". */
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason)
      .toContain("How long does it take");
  });

  it("refuses a second treatment of the same name", async () => {
    const r = await post(ownerId, "/spa/treatments",
      { name: `${TAG} Swedish massage`, minutes: 60 });
    expect(((await r.json()) as { reason: string }).reason)
      .toContain("already sells");
  });

  it("can UNPRICE something that was priced — null is an instruction, not a silence", async () => {
    const r = await send(ownerId, "PATCH", `/spa/treatments/${massageId}`,
      { price: null });
    expect(r.status, await r.clone().text()).toBe(200);

    const list = await get(ownerId, "/spa/treatments");
    const { treatments } = (await list.json()) as {
      treatments: Array<{ id: string; price: number | null }>;
    };
    expect(treatments.find((t) => t.id === massageId)!.price).toBeNull();

    await send(ownerId, "PATCH", `/spa/treatments/${massageId}`, { price: 2500 });
  });
});


describe("who may do what (the owner, 18 September)", () => {
  it("lets reception book and refuses reception the price list", async () => {
    const reception = byRole.get("front_desk")!;

    const added = await post(reception, "/spa/therapists", { name: `${TAG} Nobody` });
    expect(added.status).toBe(403);
    expect(((await added.json()) as { reason: string }).reason)
      .toContain("owner, an administrator or the general manager");

    /* And reception CAN reach the diary — a guard that only refuses is a
       guard that has locked everybody out. */
    const diary = await get(reception, "/spa");
    expect(diary.status, await diary.clone().text()).toBe(200);
  });

  it("lets housekeeping look at the diary and not touch it", async () => {
    const hk = byRole.get("housekeeping")!;

    const diary = await get(hk, "/spa");
    expect(diary.status, await diary.clone().text()).toBe(200);

    const booked = await post(hk, "/spa/appointments",
      { stayId, treatmentId: massageId, therapistId: priyaId,
        startsAt: "2027-04-01T11:00" });
    expect(booked.status).toBe(403);
    expect(((await booked.json()) as { reason: string }).reason)
      .toContain("Taking a spa booking is for reception");
  });

  it("refuses a chef the diary altogether", async () => {
    const r = await get(byRole.get("chef")!, "/spa");
    expect(r.status).toBe(403);
  });

  it("holds the server's lists and the menu's rule to the same shape", () => {
    /* These three are the server's copy of what the menu applies in
       `src/modules/spa/nav.ts`. The server does not import the website's
       code, so this is the thing that fails when the two drift apart. */
    expect(SPA_READ_ROLES).toContain("housekeeping");
    expect(SPA_BOOK_ROLES).not.toContain("housekeeping");
    expect(SPA_LIST_ROLES).not.toContain("front_desk");
    /* Everybody who may book may also see what they booked. */
    for (const role of SPA_BOOK_ROLES) expect(SPA_READ_ROLES).toContain(role);
    for (const role of SPA_LIST_ROLES) expect(SPA_READ_ROLES).toContain(role);
  });
});


describe("the day diary", () => {
  beforeAll(async () => {
    const p = await post(ownerId, "/spa/therapists", { name: `${TAG} Priya` });
    priyaId = ((await p.json()) as { id: string }).id;
    const s = await post(ownerId, "/spa/therapists", { name: `${TAG} Sunita` });
    sunitaId = ((await s.json()) as { id: string }).id;
  });

  it("stores a time on the PROPERTY's clock, not the server's (MEMORY 297)", async () => {
    const made = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: massageId, therapistId: priyaId,
      startsAt: "2027-04-01T11:00",     // as a clerk at Akkalkot types it
    });
    expect(made.status, await made.clone().text()).toBe(200);
    const id = ((await made.json()) as { id: string }).id;

    /* The stored moment, asked in UTC. Eleven at Akkalkot is 05:30 UTC.
       A bare timestamp would have stored 11:00 UTC, and that is the
       difference between a massage at eleven and one at half past four. */
    const { rows } = await sql(
      `select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as utc,
              to_char(ends_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as utc_end
         from spa_appointments where id = $1`, [id]);
    expect(rows[0].utc).toBe("2027-04-01T05:30");
    /* And the length came from the treatment, not the caller. */
    expect(rows[0].utc_end).toBe("2027-04-01T06:30");

    /* And it reads back as the clerk typed it. */
    const diary = await get(ownerId, "/spa?from=2027-04-01&to=2027-04-01");
    const { therapists } = (await diary.json()) as {
      therapists: Array<{ id: string; appointments: Array<{ startsAt: string; endsAt: string }> }>;
    };
    const mine = therapists.find((t) => t.id === priyaId)!.appointments[0]!;
    expect(mine.startsAt).toBe("2027-04-01T11:00");
    expect(mine.endsAt).toBe("2027-04-01T12:00");
  });

  it("refuses the same therapist at the same hour, and NAMES what is in the way", async () => {
    const clash = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: unpricedId, therapistId: priyaId,
      startsAt: "2027-04-01T11:30",
    });
    expect(clash.status).toBe(409);

    /* The sentence, not the status. "conflicting key value violates
       exclusion constraint" is true and useless on a telephone. */
    const reason = ((await clash.json()) as { reason: string }).reason;
    expect(reason).toContain("Priya");
    expect(reason).toContain("Swedish massage");
    expect(reason).not.toContain("exclusion constraint");
  });

  it("takes the same hour for a second therapist", async () => {
    const r = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: massageId, therapistId: sunitaId,
      startsAt: "2027-04-01T11:00",
    });
    expect(r.status, await r.clone().text()).toBe(200);
  });

  it("keeps a therapist with an empty day in the diary", async () => {
    const diary = await get(ownerId, "/spa?from=2027-04-05&to=2027-04-05");
    const { therapists } = (await diary.json()) as {
      therapists: Array<{ id: string; appointments: unknown[] }>;
    };
    /* "Who is free" is the question being asked, so an empty day is an
       answer and not an omission. */
    expect(therapists.find((t) => t.id === priyaId)?.appointments).toEqual([]);
  });

  it("shows an unpriced treatment as a dash, never as free", async () => {
    const made = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: unpricedId, therapistId: sunitaId,
      startsAt: "2027-04-02T09:00",
    });
    expect(made.status, await made.clone().text()).toBe(200);

    const diary = await get(ownerId, "/spa?from=2027-04-02&to=2027-04-02");
    const { therapists } = (await diary.json()) as {
      therapists: Array<{ id: string; appointments: Array<{ amount: number | null }> }>;
    };
    expect(therapists.find((t) => t.id === sunitaId)!.appointments[0]!.amount)
      .toBeNull();
  });

  it("refuses a booking against a stay that cannot be billed", async () => {
    const { rows } = await sql(
      `select id::text from reservations
        where hotel_id = $1 and status = 'checked_out' limit 1`, [hotelId]);
    const r = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId: rows[0].id, treatmentId: massageId, therapistId: priyaId,
      startsAt: "2027-04-03T11:00",
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason)
      .toContain("checked out");
  });

  it("refuses a cancellation with no reason, and takes one with", async () => {
    const made = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: massageId, therapistId: priyaId,
      startsAt: "2027-04-04T15:00",
    });
    const id = ((await made.json()) as { id: string }).id;

    const bare = await post(byRole.get("front_desk")!,
      `/spa/appointments/${id}/cancel`, {});
    expect(bare.status).toBe(409);
    expect(((await bare.json()) as { reason: string }).reason)
      .toContain("Why is it cancelled");

    const given = await post(byRole.get("front_desk")!,
      `/spa/appointments/${id}/cancel`, { reason: "Guest went out" });
    expect(given.status, await given.clone().text()).toBe(200);

    /* And the hour comes back — a cancellation releases the therapist. */
    const again = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: massageId, therapistId: priyaId,
      startsAt: "2027-04-04T15:00",
    });
    expect(again.status, await again.clone().text()).toBe(200);
  });
});

/* ══════════════════════════════════════════════════════════════════
   CLOSING A TREATMENT — onto the room bill (D18-22)

   The owner, 19 September: a treatment goes on the room bill, the spa
   needs no money connection of its own, and settling at the spa is set
   aside. So there is one way to close, and these prove it both ways —
   what it refuses and what it does.
   ══════════════════════════════════════════════════════════════════ */
describe("closing a treatment", () => {
  let closeId: string;

  beforeAll(async () => {
    await setModule(true);
    const made = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: massageId, therapistId: priyaId,
      startsAt: "2027-04-06T10:00",
    });
    expect(made.status, await made.clone().text()).toBe(200);
    closeId = ((await made.json()) as { id: string }).id;
  });

  it("refuses housekeeping, who sees the diary and does not close (D18-21)", async () => {
    const r = await post(byRole.get("housekeeping")!, `/spa/appointments/${closeId}/close`, {});
    expect(r.status).toBe(403);
  });

  it("refuses while the property has set no spa tax rate, and names where to set it", async () => {
    /* D18-21: a treatment bills under the spa's OWN rule, and a property
       that has not set one cannot bill a treatment at all. Finance says so
       in a sentence rather than aborting the whole transaction. */
    await sql("delete from tax_rules where hotel_id = $1 and kind = 'spa'", [hotelId]);
    const r = await post(byRole.get("front_desk")!, `/spa/appointments/${closeId}/close`, {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason).toContain("Settings");

    /* And nothing moved: still booked, nothing on the bill. */
    const { rows } = await sql(
      "select status, posting_id from spa_appointments where id = $1", [closeId]);
    expect(rows[0].status).toBe("booked");
    expect(rows[0].posting_id).toBeNull();
  });

  it("puts the treatment on the guest's bill under the spa's own rate, and closes it", async () => {
    await sql(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'spa', 0, 18, $2)
       on conflict (hotel_id, kind, over_amount) do update set rate = 18`,
      [hotelId, `${TAG} fixture`]);

    const r = await post(byRole.get("front_desk")!, `/spa/appointments/${closeId}/close`, {});
    expect(r.status, await r.clone().text()).toBe(200);
    const { postingId } = (await r.json()) as { postingId: string };

    const { rows: line } = await sql(
      `select fp.category, fp.amount::text, fp.tax_rate::text, f.reservation_id::text,
              fp.description
         from folio_postings fp join folios f on f.id = fp.folio_id
        where fp.id = $1`, [postingId]);
    /* Its own line in the Extra Charges report's Spa row (D18-7). */
    expect(line[0].category).toBe("spa");
    expect(Number(line[0].amount)).toBe(2500);
    /* The SPA's rate, not the room's — the whole point of D18-21. */
    expect(Number(line[0].tax_rate)).toBe(18);
    expect(line[0].reservation_id).toBe(stayId);
    /* On the property's clock, as a clerk reads it (D17-77). */
    expect(line[0].description).toContain("06/04/2027 10:00");

    const { rows: appt } = await sql(
      `select status, settlement, closed_by::text, posting_id::text
         from spa_appointments where id = $1`, [closeId]);
    expect(appt[0].status).toBe("completed");
    expect(appt[0].settlement).toBe("room");
    expect(appt[0].closed_by).toBe(byRole.get("front_desk"));
    expect(appt[0].posting_id).toBe(postingId);
  });

  it("will not close it twice", async () => {
    const r = await post(byRole.get("front_desk")!, `/spa/appointments/${closeId}/close`, {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason).toContain("already closed");
  });

  it("will not put an unpriced treatment on a bill", async () => {
    const made = await post(byRole.get("front_desk")!, "/spa/appointments", {
      stayId, treatmentId: unpricedId, therapistId: sunitaId,
      startsAt: "2027-04-06T14:00",
    });
    const id = ((await made.json()) as { id: string }).id;
    const r = await post(byRole.get("front_desk")!, `/spa/appointments/${id}/close`, {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { reason: string }).reason).toContain("no price");
  });
});
