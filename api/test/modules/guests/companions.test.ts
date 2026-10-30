import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { WRITE_RULES } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   EVERY ADULT IN A ROOM (the owner's D27-382, GUE-6)

   A companion is a guest record tied to the stay. Name, nationality, ID type
   and number; a foreigner also the full Form III details and a row of their
   own; entered at check-in or later; CHECK-IN IS NEVER BLOCKED, a missing
   person is a warning. And what a stay does afterwards leaves them right.

   Run at PUNE with guests this file makes, as formIII.test.ts is.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () => new (await import("pg")).default.Pool({ connectionString: SUPER });
const PID = String(process.pid).padStart(6, "0");
const tag = `C6-${process.pid}`;
const AADHAAR = "789012345674";

let ownerId: string;
let puneId: string;

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/PUN${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async <T = Record<string, unknown>>(path: string) => (await (await call(path)).json()) as T;

const CLOCK = { earlyReason: "Companions fixture - the hour is not what this tests", waiveEarly: true };
const LEAVE = { lateReason: "Companions fixture", waiveLate: true, earlyReason: "Companions fixture" };
const VISIT = { phoneInIndia: "+91 98000 00146", arrivedFrom: "Delhi", purpose: "tourism",
                previousStay: "Hotel in Delhi" };

type Row = Record<string, unknown> & { reservationId: string; guestId: string };
const register = async () => (await json<{ rows: Row[]; due: number; unrecorded: { room: string }[] }>("/form-c"));
const people = (stay: string) => json<{
  adults: number; recorded: number; lead: string; open: boolean;
  companions: (Record<string, unknown> & { guestId: string })[];
}>(`/stays/${stay}/companions`);

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

async function freeRoom(): Promise<{ number: string; typeId: string }> {
  const [r] = await sql<{ number: string; type_id: string }>(
    `select rm.number, rm.room_type_id::text as type_id from rooms rm
      where rm.hotel_id = $1 and rm.is_active and rm.housekeeping_status = 'clean'
        and not exists (select 1 from room_assignments ra where ra.room_id = rm.id and ra.released_at is null)
      order by rm.number limit 1`, [puneId]);
  if (!r) throw new Error("No clean, free room at Pune.");
  return { number: r.number, typeId: r.type_id };
}

/** A confirmed arrival today for two adults, the lead of the given nationality. */
async function arrival(nationality: string, adults = 2) {
  const r = await freeRoom();
  const [d] = await sql<{ d: string }>("select app.business_date($1)::text as d", [puneId]);
  const [g] = await sql<{ id: string }>(
    "insert into guests (full_name, nationality) values ($1, $2) returning id::text",
    [`${tag} lead ${Date.now()}`, nationality]);
  const [s] = await sql<{ id: string }>(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                               adults, occupancy, status, source, agreed_rate)
     values ($1,$2,$3::uuid,$4,$5::date,$5::date + 2,$6,$6,'confirmed','direct',2500) returning id::text`,
    [puneId, g!.id, r.typeId, `${tag}-${Date.now()}`, d!.d, adults]);
  return { stay: s!.id, guest: g!.id, room: r.number };
}

const add = (stay: string, name: string, nationality: string, extra: Record<string, unknown> = {}) =>
  call(`/stays/${stay}/companions`, "POST",
    { fullName: `${tag} ${name}`, nationality, ...extra });
const addOk = async (stay: string, name: string, nationality: string, extra: Record<string, unknown> = {}) => {
  const res = await add(stay, name, nationality, extra);
  const body = (await res.json()) as { guestId: string };
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.guestId;
};
const checkIn = async (a: { stay: string; room: string }, nationality: string) => {
  const res = await call(`/stays/${a.stay}/check-in`, "POST", {
    roomNumber: a.room, ...CLOCK,
    identity: nationality === "IN"
      ? { idType: "aadhaar", idNumber: AADHAAR, nationality }
      : { idType: "passport", idNumber: `P${PID}L`, nationality, visaNumber: "V1", visaType: "e-Tourist" },
    ...(nationality === "IN" ? {} : { visit: VISIT }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
};
/** Rooms are few at Pune: give this one back clean. */
async function release(stay: string) {
  await sql("update room_assignments set released_at = now() where reservation_id = $1 and released_at is null", [stay]);
  await sql(`update rooms set housekeeping_status = 'clean'
              where id in (select room_id from room_assignments where reservation_id = $1)`, [stay]);
}

beforeAll(async () => {
  [{ id: ownerId }] = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'")) as [{ id: string }];
  [{ id: puneId }] = (await sql<{ id: string }>(
    "select id::text from hotels where code = 'PUN'")) as [{ id: string }];
});

afterAll(async () => {
  const db = await admin();
  try {
    const mine = `${tag} %`;
    const stays = `select id from reservations where guest_id in (select id from guests where full_name like $1)`;
    await db.query(`delete from payments where posting_id in (
       select fp.id from folio_postings fp join folios f on f.id = fp.folio_id
        where f.reservation_id in (${stays}))`, [mine]);
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(`delete from folio_postings where folio_id in (
       select id from folios where reservation_id in (${stays}))`, [mine]);
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query(`delete from folios where reservation_id in (${stays})`, [mine]);
    await db.query(`update rooms set housekeeping_status = 'clean' where id in (
       select room_id from room_assignments where reservation_id in (${stays}))`, [mine]);
    await db.query(`delete from room_assignments where reservation_id in (${stays})`, [mine]);
    await db.query(`delete from form_c_filings where reservation_id in (${stays})`, [mine]);
    await db.query(`delete from form_iii_stays where reservation_id in (${stays})`, [mine]);
    await db.query(`delete from stay_companions where reservation_id in (${stays})`, [mine]);
    await db.query("delete from guest_documents where guest_id in (select id from guests where full_name like $1)", [mine]);
    await db.query(`delete from reservations where id in (${stays})`, [mine]);
    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [mine]);
    await db.query("alter table guests enable trigger guests_no_delete");
  } finally {
    await db.end();
  }
  await closePool();
});

/* ── Entered, and never in the way ────────────────────────────────── */

describe("the other adults on a stay", () => {
  it("are recorded with a name, a nationality and an ID, and counted", async () => {
    const a = await arrival("IN");
    expect(await people(a.stay)).toMatchObject({ adults: 2, recorded: 1, companions: [], open: true });

    const id = await addOk(a.stay, "Asha", "in", { identity: { idType: "aadhaar", idNumber: AADHAAR } });
    const after = await people(a.stay);
    expect(after).toMatchObject({ adults: 2, recorded: 2 });
    /* Masked where the guest's is: the registration card's own rule. */
    expect(after.companions[0]).toMatchObject({
      guestId: id, nationality: "IN", idType: "aadhaar", idNumber: "XXXX XXXX 5674", filed: false,
    });
  });

  it("with a name and no ID, are on the stay and not yet recorded", async () => {
    const a = await arrival("IN");
    await addOk(a.stay, "NoId", "IN");
    const after = await people(a.stay);
    expect(after.companions).toHaveLength(1);
    expect(after.recorded).toBe(1);
  });

  it("are refused by the desk's own rules, and nothing is written", async () => {
    const a = await arrival("IN");
    for (const [body, words] of [
      [{ fullName: " ", nationality: "IN" }, /has a name/],
      [{ fullName: `${tag} X`, nationality: "" }, /two-letter/],
      [{ fullName: `${tag} X`, nationality: "ZZ" }, /not a country code/],
      [{ fullName: `${tag} X`, nationality: "IN", identity: { idType: "aadhaar", idNumber: "1234" } }, /Aadhaar/],
      [{ fullName: `${tag} X`, nationality: "IN", identity: { idType: "passport" } }, /needs its number/],
      [{ fullName: `${tag} X`, nationality: "GB", identity: { dateOfBirth: "2999-01-01" } }, /in the future/],
    ] as const) {
      const res = await call(`/stays/${a.stay}/companions`, "POST", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(words);
    }
    expect((await people(a.stay)).companions).toEqual([]);
    expect(await sql("select 1 from guests where full_name = $1", [`${tag} X`])).toEqual([]);
  });

  it("never hold up a check-in, and the stay still says who is missing", async () => {
    const a = await arrival("IN", 3);
    await checkIn(a, "IN");
    expect(await people(a.stay)).toMatchObject({ adults: 3, recorded: 1 });
    expect((await register()).unrecorded.map((u) => u.room)).toContain(a.room);

    /* Later on the stay. */
    await addOk(a.stay, "Later One", "IN", { identity: { idType: "passport", idNumber: `A${PID}1` } });
    await addOk(a.stay, "Later Two", "IN", { identity: { idType: "passport", idNumber: `A${PID}2` } });
    expect(await people(a.stay)).toMatchObject({ adults: 3, recorded: 3 });
    expect((await register()).unrecorded.map((u) => u.room)).not.toContain(a.room);
    await release(a.stay);
  });

  it("can be added and corrected, and taken off unfiled", async () => {
    const a = await arrival("IN");
    const id = await addOk(a.stay, "Typo", "IN");
    const res = await call(`/stays/${a.stay}/companions/${id}`, "PUT",
      { fullName: `${tag} Fixed`, nationality: "GB",
        identity: { idType: "passport", idNumber: `F${PID}9` }, visit: { arrivedFrom: "Goa" } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await people(a.stay)).companions[0]).toMatchObject({
      name: `${tag} Fixed`, nationality: "GB", idType: "passport", arrivedFrom: "Goa",
    });

    const off = await call(`/stays/${a.stay}/companions/${id}`, "DELETE");
    expect(off.status, await off.clone().text()).toBe(200);
    expect((await people(a.stay)).companions).toEqual([]);
    expect(await sql("select 1 from guest_documents where guest_id = $1", [id])).toEqual([]);
    expect((await call(`/stays/${a.stay}/companions/${id}`, "DELETE")).status).toBe(404);
    expect((await call(`/stays/${a.stay}/companions/${id}`, "PUT",
      { fullName: "Nobody", nationality: "IN" })).status).toBe(404);
  });

  it("are not added to a booking that did not go ahead, and what was there is kept", async () => {
    const a = await arrival("IN");
    await addOk(a.stay, "Voided", "IN");
    const voided = await call(`/stays/${a.stay}/void`, "POST", { reason: "Companions fixture" });
    expect(voided.status, await voided.clone().text()).toBe(200);
    const res = await add(a.stay, "Too Late", "IN");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/did not go ahead/);
    expect(await people(a.stay)).toMatchObject({ open: false });
    expect((await people(a.stay)).companions).toHaveLength(1);
  });

  it("answer 404 for a stay that is not there, or an id that is not one", async () => {
    expect((await call("/stays/not-a-stay/companions")).status).toBe(404);
    expect((await call("/stays/00000000-0000-0000-0000-000000000000/companions")).status).toBe(404);
    const a = await arrival("IN");
    expect((await call(`/stays/${a.stay}/companions/not-a-guest`, "DELETE")).status).toBe(404);
  });

  it("are the check-in roles' alone: every route has the gate's rule", () => {
    for (const key of ["POST /api/hotels/:code/stays/:id/companions",
      "PUT /api/hotels/:code/stays/:id/companions/:guestId",
      "DELETE /api/hotels/:code/stays/:id/companions/:guestId"]) {
      expect(WRITE_RULES[key], key).toBeTruthy();
    }
  });
});

/* ── The register ─────────────────────────────────────────────────── */

describe("a foreigner in the room", () => {
  it("has their own row under an Indian lead, with their own numbers and details", async () => {
    const a = await arrival("IN");
    const bo = await addOk(a.stay, "Bo", "BR", {
      identity: { idType: "passport", idNumber: `B${PID}1`, visaNumber: "V9", visaType: "e-Tourist" },
      visit: VISIT,
    });
    const asha = await addOk(a.stay, "Asha", "IN", { identity: { idType: "aadhaar", idNumber: AADHAAR } });
    await checkIn(a, "IN");

    const mine = () => register().then((r) => r.rows.filter((x) => x.reservationId === a.stay));
    let rows = await mine();
    expect(rows.map((r) => r.guestId), "the Indian lead and companion have no row").toEqual([bo]);
    expect(rows[0]).toMatchObject({
      companion: true, guest: `${tag} Bo`, passport: `B${PID}1`, visaNumber: "V9", arrivedFrom: "Delhi",
      adults: 2, status: "checked_in", arrivalNumbers: [],
    });

    /* The 24 hours count them. */
    const before = (await register()).due;
    const filed = await call(`/form-c/${a.stay}`, "POST", { reference: `BO-${PID}`, guestId: bo });
    expect(filed.status, await filed.clone().text()).toBe(200);
    expect((await register()).due).toBe(before - 1);
    rows = await mine();
    expect(rows[0]).toMatchObject({ arrivalNumbers: [`BO-${PID}`], filed: true });

    /* Complete details, and only theirs. */
    const details = await call(`/form-c/${a.stay}/details`, "PUT",
      { guestId: bo, identity: { gender: "male" }, visit: { refCity: "Pune" } });
    expect(details.status, await details.clone().text()).toBe(200);
    expect((await mine())[0]).toMatchObject({ gender: "male", refCity: "Pune", arrivedFrom: "Delhi" });

    /* Somebody who is not on the stay, or is Indian. */
    const [other] = await sql<{ id: string }>(
      "insert into guests (full_name, nationality) values ($1, 'GB') returning id::text", [`${tag} Other`]);
    expect((await call(`/form-c/${a.stay}`, "POST", { reference: `XX-${PID}`, guestId: other!.id })).status).toBe(409);
    expect((await call(`/form-c/${a.stay}/details`, "PUT",
      { guestId: asha, visit: { refCity: "Pune" } })).status).toBe(409);
    expect((await call(`/form-c/${a.stay}`, "POST", { reference: `XY-${PID}`, guestId: "nonsense" })).status).toBe(409);

    /* Filed: they stay, and corrections are the register's. */
    const off = await call(`/stays/${a.stay}/companions/${bo}`, "DELETE");
    expect(off.status).toBe(409);
    expect(((await off.json()) as { reason: string }).reason).toMatch(/kept for a year/);
    const edit = await call(`/stays/${a.stay}/companions/${bo}`, "PUT", { fullName: "New Name", nationality: "IN" });
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { reason: string }).reason).toMatch(/Form III register/);
    expect((await people(a.stay)).companions.find((c) => c.guestId === bo)).toMatchObject({ filed: true });
    await release(a.stay);
  });

  it("gives the lead's saved visit answers for Same as the guest, and none before they are saved", async () => {
    const a = await arrival("GB", 2);
    expect((await json<{ leadVisit: unknown }>(`/stays/${a.stay}/companions`)).leadVisit).toBeNull();
    await checkIn(a, "GB");
    const { leadVisit } = await json<{ leadVisit: Record<string, unknown> }>(`/stays/${a.stay}/companions`);
    expect(leadVisit).toMatchObject({ arrivedFrom: VISIT.arrivedFrom, purpose: VISIT.purpose });
    expect(leadVisit, "their phones are their own").not.toHaveProperty("phoneInIndia");
    await release(a.stay);
  });

  it("beside a foreign lead: two rows, the warning on both, and the lead's own numbers", async () => {
    const a = await arrival("GB", 3);
    await checkIn(a, "GB");
    const bo = await addOk(a.stay, "Bo", "BR", { identity: { idType: "passport", idNumber: `B${PID}2` } });
    const rows = (await register()).rows.filter((r) => r.reservationId === a.stay);
    expect(rows.map((r) => r.companion).sort()).toEqual([false, true]);
    expect(rows[0]).toMatchObject({ adults: 3, recorded: 2 });

    expect((await call(`/form-c/${a.stay}`, "POST", { reference: `LD-${PID}` })).status).toBe(200);
    const after = (await register()).rows.filter((r) => r.reservationId === a.stay);
    expect(after.find((r) => r.guestId === bo)).toMatchObject({ arrivalNumbers: [] });
    expect(after.find((r) => r.guestId === a.guest)).toMatchObject({ arrivalNumbers: [`LD-${PID}`] });
    await release(a.stay);
  });

  it("reaches the C-Form report, as a row of their own", async () => {
    const a = await arrival("IN");
    await addOk(a.stay, "Report", "BR", { identity: { idType: "passport", idNumber: `R${PID}1` } });
    await checkIn(a, "IN");
    const report = await json<{ rows: Record<string, unknown>[] }>("/reports/c-form?from=2020-01-01&to=2099-12-31");
    expect(report.rows.find((r) => r["passport"] === `R${PID}1`)).toMatchObject({ guest: `${tag} Report` });
    await release(a.stay);
  });
});

/* ── What the stay does next ──────────────────────────────────────── */

describe("what a stay does, with people on it", () => {
  it("prints them on the registration card, an Aadhaar masked as the guest's is", async () => {
    const a = await arrival("IN");
    await addOk(a.stay, "Card", "IN", { identity: { idType: "aadhaar", idNumber: AADHAAR } });
    await checkIn(a, "IN");
    const card = await json<{ companions: Record<string, unknown>[] }>(`/stays/${a.stay}/registration-card`);
    expect(card.companions).toEqual([
      { name: `${tag} Card`, nationality: "IN", idType: "aadhaar", idNumber: "XXXX XXXX 5674" },
    ]);
    await release(a.stay);
  });

  it("a room move and a longer stay carry them along", async () => {
    const a = await arrival("GB");
    await checkIn(a, "GB");
    const bo = await addOk(a.stay, "Mover", "BR");
    const target = await freeRoom();
    const [d] = await sql<{ d: string }>("select app.business_date($1)::text as d", [puneId]);
    const moved = await call(`/stays/${a.stay}/move`, "POST", { roomNumber: target.number, from: d!.d });
    expect(moved.status, await moved.clone().text()).toBe(200);
    const stretched = await call(`/stays/${a.stay}`, "PATCH", { adults: 1 });
    expect(stretched.status, await stretched.clone().text()).toBe(200);

    const row = (await register()).rows.find((r) => r.guestId === bo);
    expect(row).toMatchObject({ room: target.number, adults: 1 });
    /* Fewer adults than people: nothing is taken off, and no warning. */
    expect((await people(a.stay)).companions).toHaveLength(1);
    await release(a.stay);
  });

  it("check-out asks where a foreign companion goes under an Indian lead, and it reaches them", async () => {
    const a = await arrival("IN");
    const bo = await addOk(a.stay, "Leaver", "BR");
    const own = await addOk(a.stay, "Own Way", "FR", { visit: { nextDestination: "Goa" } });
    await checkIn(a, "IN");

    const res = await call(`/stays/${a.stay}/check-out`, "POST", LEAVE);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needs: "next-destination" });
    const [s] = await sql<{ status: string }>("select status from reservations where id = $1", [a.stay]);
    expect(s!.status).toBe("checked_in");

    const paid = await call(`/stays/${a.stay}/payments`, "POST", { method: "UPI", amount: 2625 });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const out = await call(`/stays/${a.stay}/check-out`, "POST", { ...LEAVE, nextDestination: "Jaipur" });
    expect(out.status, await out.clone().text()).toBe(200);

    const rows = (await register()).rows;
    expect(rows.find((r) => r.guestId === bo)).toMatchObject({
      nextDestination: "Jaipur", status: "checked_out",
    });
    expect(rows.find((r) => r.guestId === bo)!["departureDueBy"]).toBeTruthy();
    expect(rows.find((r) => r.guestId === own), "their own answer stands")
      .toMatchObject({ nextDestination: "Goa" });

    /* Added after they left: the register can still be put right. */
    await addOk(a.stay, "Forgotten", "BR");
    expect((await people(a.stay)).companions).toHaveLength(3);
  });

  it("an Indian room checks out as it always has", async () => {
    const a = await arrival("IN");
    await addOk(a.stay, "Plain", "IN");
    await checkIn(a, "IN");
    const paid = await call(`/stays/${a.stay}/payments`, "POST", { method: "UPI", amount: 2625 });
    expect(paid.status, await paid.clone().text()).toBe(200);
    const out = await call(`/stays/${a.stay}/check-out`, "POST", LEAVE);
    expect(out.status, await out.clone().text()).toBe(200);
  });
});
