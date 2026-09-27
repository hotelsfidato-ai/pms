import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   FORM III AT THE DESK (D27-25)

   Immigration and Foreigners Rules 2025, Rule 17 and Form III, and the
   owner's answers of 27 September:

     · a foreign guest is not checked in without the law's own fields -
       visa or OCI number and type, phone in India, arrived from,
       purpose, previous place of stay - and nothing is written when
       refused; a citizen of Nepal or Bhutan is not asked for a visa
     · the recorded nationality counts when the screen sends none
     · a walk-in is asked what check-in asks, and lands on the register
     · a foreign guest is not checked out without a next destination
     · the departure is filed after the guest leaves; each person in
       the room gets their own number
     · "Complete details" fills in the portal's other boxes later

   Run at PUNE with guests this file makes, as identity.test.ts is.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let puneId: string;
const tag = `F3-${process.pid}`;

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/* The arrival hour is not what these test (identity.test.ts, EARLY). */
const CLOCK = {
  earlyReason: "Form III fixture - the hour is not what this tests",
  waiveEarly: true,
};

const VISIT = {
  phoneInIndia: "+91 98000 00146",
  arrivedFrom: "Delhi",
  purpose: "tourism",
  previousStay: "Hotel in Delhi",
};

const passport = (n: string, extra: Record<string, string> = {}) => ({
  idType: "passport", idNumber: `P${process.pid}${n}`, nationality: "GB",
  visaNumber: `V${process.pid}${n}`, visaType: "e-Tourist", ...extra,
});

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    puneId = (await db.query<{ id: string }>(
      "select id from hotels where code = 'PUN'")).rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    /* By guest: a walk-in's reference is the property's, not this tag. */
    const mine = `${tag} %`;
    const stays = `select id from reservations where guest_id in (
                     select id from guests where full_name like $1)`;
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(
      `delete from folio_postings where folio_id in (
         select id from folios where reservation_id in (${stays}))`, [mine]);
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query(`delete from folios where reservation_id in (${stays})`, [mine]);
    /* Every room taken here was clean (room()); the check-out dirtied one. */
    await db.query(
      `update rooms set housekeeping_status = 'clean' where id in (
         select room_id from room_assignments where reservation_id in (${stays}))`, [mine]);
    await db.query(`delete from room_assignments where reservation_id in (${stays})`, [mine]);
    await db.query(`delete from form_c_filings where reservation_id in (${stays})`, [mine]);
    await db.query(`delete from form_iii_stays where reservation_id in (${stays})`, [mine]);
    await db.query(
      `delete from guest_documents where guest_id in (
         select id from guests where full_name like $1)`, [`${tag} %`]);
    await db.query(`delete from reservations where id in (${stays})`, [mine]);
    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [`${tag} %`]);
    await db.query("alter table guests enable trigger guests_no_delete");
  } finally {
    await db.end();
  }
  await closePool();
});

/** A clean free room at Pune, and optionally a confirmed arrival today for
    a guest of the given nationality in it. */
async function room(): Promise<{ number: string; typeId: string }> {
  const db = await admin();
  try {
    const { rows } = await db.query<{ number: string; type_id: string }>(
      `select rm.number, rm.room_type_id::text as type_id
         from rooms rm
        where rm.hotel_id = $1 and rm.is_active and rm.housekeeping_status = 'clean'
          and not exists (select 1 from room_assignments ra
                           where ra.room_id = rm.id and ra.released_at is null)
        order by rm.number limit 1`, [puneId]);
    if (!rows[0]) throw new Error("No clean, free room at Pune - rebuild the database.");
    return { number: rows[0].number, typeId: rows[0].type_id };
  } finally {
    await db.end();
  }
}

async function arrival(nationality: string) {
  const r = await room();
  const db = await admin();
  try {
    const bd = (await db.query<{ d: string }>(
      "select app.business_date($1)::text as d", [puneId])).rows[0]!.d;
    const guest = (await db.query<{ id: string }>(
      `insert into guests (full_name, nationality) values ($1, $2) returning id::text`,
      [`${tag} guest ${Date.now()}`, nationality])).rows[0]!.id;
    const stay = (await db.query<{ id: string }>(
      `insert into reservations
         (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
          adults, status, source, agreed_rate)
       values ($1,$2,$3::uuid,$4,$5::date,$5::date + 2,1,'confirmed','direct',2500)
       returning id::text`,
      [puneId, guest, r.typeId, `${tag}-${Date.now()}`, bd])).rows[0]!.id;
    return { stay, guest, room: r.number };
  } finally {
    await db.end();
  }
}

/** Pune has ten rooms and later files need them: a check-in proven here
    gives its room straight back. Releasing marks it dirty (070, a room
    somebody slept in), and nobody slept in it - so it is clean again, or
    the next test finds no room once earlier files have used Pune's. */
async function release(stay: string): Promise<void> {
  const db = await admin();
  try {
    await db.query(
      `update room_assignments set released_at = now()
        where reservation_id = $1 and released_at is null`, [stay]);
    await db.query(
      `update rooms set housekeeping_status = 'clean'
        where id in (select room_id from room_assignments where reservation_id = $1)`,
      [stay]);
  } finally {
    await db.end();
  }
}

async function status(stay: string): Promise<string> {
  const db = await admin();
  try {
    return (await db.query<{ s: string }>(
      "select status as s from reservations where id = $1", [stay])).rows[0]!.s;
  } finally {
    await db.end();
  }
}

type Row = Record<string, unknown> & { reservationId: string };
const register = async (): Promise<Row[]> =>
  ((await (await call("/PUN/form-c")).json()) as { rows: Row[] }).rows;

/* ── Check-in ─────────────────────────────────────────────────────── */

describe("a foreign guest's check-in", () => {
  it("is refused without the law's Form III fields, and nothing is written", async () => {
    const a = await arrival("GB");
    const res = await call(`/PUN/stays/${a.stay}/check-in`, "POST", {
      roomNumber: a.room, ...CLOCK,
      identity: { idType: "passport", idNumber: `P${process.pid}X`, nationality: "GB" },
    });
    expect(res.status).toBe(409);
    const { reason } = (await res.json()) as { reason: string };
    for (const field of ["visa or OCI number", "visa type", "phone in India",
                         "arrived from", "purpose of visit", "previous place of stay"]) {
      expect(reason).toContain(field);
    }
    expect(await status(a.stay), "a refused check-in checked the guest in").toBe("confirmed");
  });

  it("goes through with them, and the register carries the visit", async () => {
    const a = await arrival("GB");
    const res = await call(`/PUN/stays/${a.stay}/check-in`, "POST", {
      roomNumber: a.room, ...CLOCK,
      identity: passport("A", { gender: "female", dateOfBirth: "1990-05-01" }),
      visit: { ...VISIT, arrivalPort: "Delhi airport", employedInIndia: false,
               mobileInIndia: "+91 98000 00147", phoneAbroad: "+44 20 0000 0146",
               mobileAbroad: "+44 7700 000146" },
    });
    expect(res.status, await res.text()).toBe(200);
    await release(a.stay);

    const mine = (await register()).find((r) => r.reservationId === a.stay);
    expect(mine, "the guest is not on the register").toBeTruthy();
    expect(mine).toMatchObject({
      arrivedFrom: "Delhi", purpose: "tourism", previousStay: "Hotel in Delhi",
      phoneInIndia: "+91 98000 00146", visaType: "e-Tourist", gender: "female",
      dateOfBirth: "1990-05-01", arrivalPort: "Delhi airport", employedInIndia: false,
      /* The portal's four numbers (the owner, 27 September). */
      mobileInIndia: "+91 98000 00147", phoneAbroad: "+44 20 0000 0146",
      mobileAbroad: "+44 7700 000146",
      filed: false, departureDueBy: null,
    });
    /* 24 hours from the moment of check-in, which the register has. */
    expect(mine!["arrivedAt"]).toBeTruthy();
    expect(mine!["dueBy"]).toBeTruthy();
  });

  it("does not ask a citizen of Nepal for a visa (Exemption Order 2025)", async () => {
    const a = await arrival("NP");
    const res = await call(`/PUN/stays/${a.stay}/check-in`, "POST", {
      roomNumber: a.room, ...CLOCK,
      identity: { idType: "other", idNumber: `NP${process.pid}`, nationality: "NP" },
      visit: VISIT,
    });
    await release(a.stay);
    expect(res.status, await res.text()).toBe(200);
  });

  it("with the ID skipped, still asks the visit's questions but not the visa", async () => {
    const a = await arrival("GB");
    const skip = { roomNumber: a.room, ...CLOCK, idSkipReason: "Passport at the bank",
                   identity: { nationality: "GB" } };
    const refused = await call(`/PUN/stays/${a.stay}/check-in`, "POST", skip);
    const { reason } = (await refused.json()) as { reason: string };
    expect(reason).toContain("arrived from");
    expect(reason).not.toContain("visa");

    const ok = await call(`/PUN/stays/${a.stay}/check-in`, "POST", { ...skip, visit: VISIT });
    await release(a.stay);
    expect(ok.status, await ok.text()).toBe(200);
  });

  it("uses the nationality on file when the screen sends none", async () => {
    const a = await arrival("GB");
    const res = await call(`/PUN/stays/${a.stay}/check-in`, "POST", {
      roomNumber: a.room, ...CLOCK,
      identity: { idType: "passport", idNumber: `P${process.pid}F` },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/Form III/);
  });
});

/* ── Walk-in ──────────────────────────────────────────────────────── */

describe("a foreign walk-in", () => {
  const walkIn = async (extra: Record<string, unknown>) => {
    const r = await room();
    return call("/PUN/walk-ins", "POST", {
      guestName: `${tag} walk-in ${Date.now()}`, roomNumber: r.number, nights: 1,
      adults: 1, children: 0, ratePlan: "Room Only", offeredTariff: 2500,
      ...extra,
    });
  };

  it("is asked what check-in asks", async () => {
    const res = await walkIn({ nationality: "US" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/ID document/);

    const noVisit = await walkIn({ nationality: "US", identity: passport("W") });
    expect(((await noVisit.json()) as { reason: string }).reason).toMatch(/arrived from/);
  });

  it("lands on the register as a foreigner, with the document and the visit", async () => {
    const res = await walkIn({ nationality: "US", identity: passport("W2"), visit: VISIT });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    const { data } = JSON.parse(text) as { data: { id: string } };
    await release(data.id);

    const mine = (await register()).find((r) => r.reservationId === data.id);
    expect(mine, "a foreign walk-in is missing from the register").toBeTruthy();
    expect(mine).toMatchObject({
      nationality: "US", passport: `P${process.pid}W2`, arrivedFrom: "Delhi",
    });
  });

  it("keeps a returning foreign guest foreign when the form says IN", async () => {
    /* The form's default must not take somebody off the register. */
    const phone = `+44 7700 ${process.pid}`;
    const db = await admin();
    let guestId: string;
    try {
      guestId = (await db.query<{ id: string }>(
        `insert into guests (full_name, phone, nationality) values ($1, $2, 'GB')
         returning id::text`, [`${tag} returning ${Date.now()}`, phone])).rows[0]!.id;
    } finally {
      await db.end();
    }
    const res = await walkIn({ guestId, phone, nationality: "IN" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/ID document/);
  });
});

/* ── Check-out and the departure ──────────────────────────────────── */

describe("a foreign guest's departure", () => {
  let stay: string;

  beforeAll(async () => {
    const a = await arrival("GB");
    stay = a.stay;
    const res = await call(`/PUN/stays/${a.stay}/check-in`, "POST", {
      roomNumber: a.room, ...CLOCK, identity: passport("D"), visit: VISIT,
    });
    expect(res.status, await res.text()).toBe(200);
  });

  const LATE = { lateReason: "Form III fixture - the hour is not what this tests",
                 waiveLate: true };

  it("is not filed before the guest leaves", async () => {
    const res = await call(`/PUN/form-c/${stay}`, "POST",
      { reference: `DEP-${tag}`, kind: "departure" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/not checked out/);
  });

  it("needs a next destination to check out, and nothing is written without it", async () => {
    const res = await call(`/PUN/stays/${stay}/check-out`, "POST", LATE);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/next destination/);
    expect(await status(stay)).toBe("checked_in");
  });

  it("checks out with it, and the departure's clock starts", async () => {
    const res = await call(`/PUN/stays/${stay}/check-out`, "POST",
      { ...LATE, nextDestination: "Jaipur" });
    expect(res.status, await res.text()).toBe(200);

    const mine = (await register()).find((r) => r.reservationId === stay);
    expect(mine).toMatchObject({ nextDestination: "Jaipur", status: "checked_out" });
    expect(mine!["departedAt"]).toBeTruthy();
    expect(mine!["departureDueBy"]).toBeTruthy();
  });

  it("takes a number per person for each, never one twice", async () => {
    for (const reference of [`A1-${tag}`, `A2-${tag}`]) {
      expect((await call(`/PUN/form-c/${stay}`, "POST", { reference })).status).toBe(200);
    }
    expect((await call(`/PUN/form-c/${stay}`, "POST",
      { reference: `DEP-${tag}`, kind: "departure" })).status).toBe(200);
    const twice = await call(`/PUN/form-c/${stay}`, "POST", { reference: `A1-${tag}` });
    expect(twice.status).toBe(409);

    const mine = (await register()).find((r) => r.reservationId === stay);
    expect(mine).toMatchObject({
      arrivalNumbers: [`A1-${tag}`, `A2-${tag}`], departureNumbers: [`DEP-${tag}`],
      filed: true, overdue: false, departureOverdue: false,
    });
  });

  it("completes the portal's other boxes later, and the report reads them", async () => {
    const res = await call(`/PUN/form-c/${stay}/details`, "PUT", {
      identity: { gender: "male", passportIssuePlace: "London" },
      visit: { refAddress: "12 MG Road", refPincode: "411001" },
    });
    expect(res.status, await res.text()).toBe(200);

    const mine = (await register()).find((r) => r.reservationId === stay);
    /* Only what was typed is written: the check-in's answers survive. */
    expect(mine).toMatchObject({
      gender: "male", passportIssuePlace: "London", refAddress: "12 MG Road",
      refPincode: "411001", arrivedFrom: "Delhi", nextDestination: "Jaipur",
    });

    const report = (await (await call("/PUN/reports/c-form?from=2020-01-01&to=2099-12-31"))
      .json()) as { rows: Array<Record<string, unknown>> };
    expect(report.rows.find((r) => r["passport"] === `P${process.pid}D`)).toMatchObject({
      arrivedFrom: "Delhi", purpose: "Tourism", nextDestination: "Jaipur",
      reference: `A1-${tag}, A2-${tag}`, departureReference: `DEP-${tag}`,
    });
  });

  it("refuses Complete details for an Indian guest", async () => {
    const a = await arrival("IN");
    const res = await call(`/PUN/form-c/${a.stay}/details`, "PUT", { visit: VISIT });
    expect(res.status).toBe(409);
  });
});
