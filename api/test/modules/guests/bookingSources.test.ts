import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   BOOKING SOURCES — a group list with a per-property rate

   Two things are being proved, and only one of them is about routes.

   THE SPLIT IS REAL. A source added while standing in one property
   appears in another; a commission set in one does NOT. That is the
   whole shape of 082, and it is the kind of thing that looks obviously
   true and is obviously false the first time somebody joins on the
   wrong column.

   NOTHING INVENTS A COMMISSION. A source nobody has agreed a rate with
   comes back `commissionPct: null`, all the way from the LEFT JOIN to
   the JSON. This project has shipped a default price before — defect
   63 — and every layer between the database and the screen is a place
   to accidentally turn a null into a nought.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let clerkStaffId: string;
const made: string[] = [];

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const { rows } = await db.query<{ id: string; email: string }>(
      `select id::text, email from staff
        where email in ('owner@fidato.in', 'pune@fidato.in')`);
    ownerStaffId = rows.find((r) => r.email === "owner@fidato.in")!.id;
    clerkStaffId = rows.find((r) => r.email === "pune@fidato.in")!.id;
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    /* The rates first — they point at the sources. A teardown is a
       migration run backwards. */
    await db.query(
      `delete from booking_source_rates where booking_source_id in (
         select id from booking_sources where name = any($1))`, [made]);
    await db.query("delete from booking_sources where name = any($1)", [made]);
  } finally { await db.end(); }
  await closePool();
});

const call = (path: string, method = "GET", body?: unknown,
              staff = () => ownerStaffId) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: {
      "x-dev-staff-id": staff(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Source = {
  id: string; name: string; kind: string;
  channelCode: string | null; isActive: boolean;
  commissionPct: number | null; bookings: number;
};

describe("the booking sources list", () => {
  it("carries the sources 082 seeded, with no commission against them", async () => {
    const res = await call("/5EL/booking-sources");
    expect(res.status, await res.clone().text()).toBe(200);
    const list = (await res.json()) as Source[];

    const agoda = list.find((s) => s.name === "Agoda");
    expect(agoda, "Agoda is not on the list").toBeTruthy();
    expect(agoda!.kind).toBe("ota");
    expect(agoda!.channelCode).toBe("AGODA");

    /* ⚠ NULL, NOT ZERO, AND ASSERTED AS NULL. `toBeFalsy` would pass on
       0 and this test would then agree with the exact defect it exists
       to prevent. */
    expect(agoda!.commissionPct).toBeNull();

    const walkIn = list.find((s) => s.name === "Walk-in");
    expect(walkIn!.channelCode).toBeNull();
  });

  it("shows sources this property has never dealt with", async () => {
    /* The LEFT JOIN. An inner one would hide exactly the sources a
       manager has come to this screen to set a rate against. */
    const res = await call("/5EL/booking-sources");
    const list = (await res.json()) as Source[];
    const unrated = list.filter((s) => s.commissionPct === null);
    expect(unrated.length).toBeGreaterThan(0);
  });
});

describe("adding a source", () => {
  const NAME = "Test Travel Desk";

  it("adds it for the whole group, not one property", async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: NAME, kind: "travel_agent", channelCode: "TESTTD" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; source: Source };
    expect(body.ok).toBe(true);
    made.push(NAME);

    /* ⚠ THE ASSERTION THAT MATTERS. Added while standing in 5EL, asked
       for from a different property. A per-property table here would
       pass every other test in this file and fail this one. */
    const other = await call("/AGR/booking-sources");
    expect(other.status).toBe(200);
    const list = (await other.json()) as Source[];
    expect(list.some((s) => s.name === NAME),
      "a source added at one property did not appear at another").toBe(true);
  });

  it("refuses a second source with the same name", async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: NAME.toLowerCase(), kind: "ota" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/already on the list/i);
  });

  it("refuses a second source on one channel code", async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: "Test Travel Desk Two", kind: "ota", channelCode: "testtd" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/would not know which/i);
  });

  it("refuses a kind that is not a kind", async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: "Test Pigeon Post", kind: "pigeon" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/what kind of source/i);
  });

  it("refuses a source with no name", async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: "   ", kind: "ota" });
    expect(res.status).toBe(409);
  });
});

describe("the commission", () => {
  let sourceId: string;

  beforeAll(async () => {
    const res = await call("/5EL/booking-sources");
    const list = (await res.json()) as Source[];
    sourceId = list.find((s) => s.name === "Agoda")!.id;
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        "delete from booking_source_rates where booking_source_id = $1",
        [sourceId]);
    } finally { await db.end(); }
  });

  it("belongs to the property it was set at", async () => {
    const set = await call(`/5EL/booking-sources/${sourceId}/commission`,
      "PUT", { commissionPct: 18 });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(((await set.json()) as { source: Source }).source.commissionPct)
      .toBe(18);

    /* ⚠ AND NOT AT THE ONE NEXT DOOR. A contract negotiated at one
       hotel speaking for another is the defect this table's primary
       key exists to prevent, and a group-level column would sail
       through every other assertion here. */
    const other = await call("/AGR/booking-sources");
    const list = (await other.json()) as Source[];
    expect(list.find((s) => s.id === sourceId)!.commissionPct)
      .toBeNull();
  });

  it("can be cleared back to no rate agreed", async () => {
    await call(`/5EL/booking-sources/${sourceId}/commission`,
      "PUT", { commissionPct: 18 });
    const res = await call(`/5EL/booking-sources/${sourceId}/commission`,
      "PUT", { commissionPct: null });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { source: Source }).source.commissionPct)
      .toBeNull();
  });

  it("keeps zero and blank apart", async () => {
    /* Not the same statement. Blank is "nobody has agreed a rate";
       zero is "we agreed we pay them nothing", which a manager is
       allowed to say and a screen must not invent. */
    const res = await call(`/5EL/booking-sources/${sourceId}/commission`,
      "PUT", { commissionPct: 0 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { source: Source }).source.commissionPct)
      .toBe(0);
  });

  it("refuses a commission over 100 per cent", async () => {
    const res = await call(`/5EL/booking-sources/${sourceId}/commission`,
      "PUT", { commissionPct: 140 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/between 0 and 100/i);
  });

  it("refuses a source that is not on the list", async () => {
    const res = await call(
      "/5EL/booking-sources/00000000-0000-0000-0000-000000000000/commission",
      "PUT", { commissionPct: 5 });
    expect(res.status).toBe(409);
  });
});

describe("changing a source", () => {
  let sourceId: string;

  beforeAll(async () => {
    const res = await call("/5EL/booking-sources", "POST",
      { name: "Test Rename Me", kind: "other" });
    made.push("Test Rename Me");
    made.push("Test Renamed");
    sourceId = ((await res.json()) as { source: Source }).source.id;
  });

  it("renames it and takes it out of use", async () => {
    const res = await call(`/5EL/booking-sources/${sourceId}`, "PATCH",
      { name: "Test Renamed", isActive: false });
    expect(res.status, await res.clone().text()).toBe(200);
    const s = ((await res.json()) as { source: Source }).source;
    expect(s.name).toBe("Test Renamed");
    expect(s.isActive).toBe(false);
  });

  it("clears a channel code when asked, and leaves it alone otherwise", async () => {
    await call(`/5EL/booking-sources/${sourceId}`, "PATCH",
      { channelCode: "TESTRN" });
    const kept = await call(`/5EL/booking-sources/${sourceId}`, "PATCH",
      { name: "Test Renamed" });
    expect(((await kept.json()) as { source: Source }).source.channelCode)
      .toBe("TESTRN");

    const cleared = await call(`/5EL/booking-sources/${sourceId}`, "PATCH",
      { channelCode: null });
    expect(((await cleared.json()) as { source: Source }).source.channelCode)
      .toBeNull();
  });

  it("refuses a source that is not on the list", async () => {
    const res = await call(
      "/5EL/booking-sources/00000000-0000-0000-0000-000000000000",
      "PATCH", { name: "Nothing" });
    expect(res.status).toBe(409);
  });
});

describe("who may change the list", () => {
  it("refuses a front-desk clerk, and says why", async () => {
    /* ⚠ RULE 6, AND THE DATABASE IS WHAT REFUSES. `booking_sources`
       carries an insert policy of app.is_manager(), so this is blocked
       whether or not the route checks. What the route adds is the
       sentence: an RLS violation arriving as a 500 tells a manager
       nothing about what to do next. */
    const res = await call("/PUN/booking-sources", "POST",
      { name: "Test Clerk Attempt", kind: "ota" }, () => clerkStaffId);
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/manager/i);
    expect(reason).not.toMatch(/^Something went wrong/);

    const db = await admin();
    try {
      const { rows } = await db.query(
        "select 1 from booking_sources where name = 'Test Clerk Attempt'");
      expect(rows.length, "the refusal was cosmetic - the row was written")
        .toBe(0);
    } finally { await db.end(); }
  });
});
