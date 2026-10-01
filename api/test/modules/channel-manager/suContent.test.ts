import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { useTransportForTests } from "../../../src/modules/channel-manager/su/runtime.ts";
import type { SuRequest } from "../../../src/modules/channel-manager/su/http.ts";
import { TOKEN_SANDBOX, ok200 } from "./suExamples.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 2 OF THE SU CONNECTION — THE HOTEL, ITS ROOM TYPES, ITS RATE PLANS

   What must hold:
   1. Nothing is sent while anything SU requires is missing, and every
      missing thing is named at once. Nothing missing is invented.
   2. The requests SU receives are the ones SU's documents describe: a
      property first (New, then Overlay), room types (Initial, Modify,
      Deactivated), rate plans (New, Overlay, Remove).
   3. SU's state moves only on an answer SU accepted, so a refused create
      is created again next time rather than "modified" into nothing.
   4. An SU id cannot change once SU has it.
   5. The live account is not reached for a hotel that is not switched on.
   6. Only the owner.
   7. The postcode and the map point are the HOTEL's (D27-214, migration
      168), set in Settings: SU's setup no longer writes them, and what a
      hotel typed there before is still sent until its profile has its own.

   The demo's 5 Elements: Superior (SUP, sleeps 2, rack ₹4,099) and Deluxe
   (DLX, sleeps 3, rack ₹3,699), from the real eZee exports.
   ══════════════════════════════════════════════════════════════════ */

const SU_SUCCESS = { Status: "Success" };
const ROOM_EXISTS = {
  Status: "Fail",
  Errors: [{ Code: "906", ShortText: "Requested room does not qualify. Room with id 'DLX' already exists" }],
};

let ownerId: string;
let gmId: string;
let hotelId: string;
let superiorId: string;
let deluxeId: string;
let saved: {
  phone: string | null; address_line: string | null; email: string | null;
  pin: string | null; latitude: string | null; longitude: string | null;
};

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    const h = (await db.query<{ id: string } & typeof saved>(
      `select id::text, phone, address_line, email::text, pin, latitude::text, longitude::text
         from hotels where code = '5EL'`)).rows[0]!;
    hotelId = h.id;
    saved = h;
    const types = (await db.query<{ id: string; code: string }>(
      "select id::text, code from room_types where hotel_id = $1", [hotelId])).rows;
    superiorId = types.find((t) => t.code === "SUP")!.id;
    deluxeId = types.find((t) => t.code === "DLX")!.id;

    const { rows } = await db.query<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ('cm2-gm@fidato.in', 'CMTEST2 gm', 'test-uid-cm2gm')
       on conflict (email) do update set is_active = true returning id::text`);
    gmId = rows[0]!.id;
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'gm')
       on conflict (staff_id, hotel_id) do update set role = 'gm'`, [gmId, hotelId]);
  } finally { await db.end(); }
});

const wipe = async () => {
  const db = await admin();
  try {
    await db.query("delete from channel_room_types where hotel_id = $1", [hotelId]);
    await db.query("delete from channel_rate_plans where hotel_id = $1", [hotelId]);
    await db.query("delete from channel_hotels where hotel_id = $1", [hotelId]);
    await db.query(
      "update hotels set phone = $2, address_line = $3, email = $4, pin = $5, latitude = $6, longitude = $7 where id = $1",
      [hotelId, saved.phone, saved.address_line, saved.email, saved.pin, saved.latitude, saved.longitude]);
  } finally { await db.end(); }
};

afterEach(async () => {
  for (const n of ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"]) delete process.env[n];
  useTransportForTests(null);
  await wipe();
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from staff_hotels where staff_id = $1", [gmId]);
    await db.query("update staff set is_active = false where id = $1", [gmId]);
  } finally { await db.end(); }
  await closePool();
});

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/5EL/channel-manager${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const setUpSu = (environment: "sandbox" | "live" = "sandbox") => {
  process.env["SU_ENVIRONMENT"] = environment;
  process.env["SU_CLIENT_ID"] = "test-client";
  process.env["SU_CLIENT_SECRET"] = "test-secret";
};

/* A pretend SU that answers the token call, then whatever `reply` says. */
const pretendSu = (reply: (req: SuRequest, body: Record<string, unknown>) => unknown = () => SU_SUCCESS) => {
  const calls: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
  useTransportForTests(async (req) => {
    if (req.url.endsWith("/auth/generate-access-token")) return ok200(TOKEN_SANDBOX);
    const body = JSON.parse(req.body ?? "{}") as Record<string, unknown>;
    calls.push({ endpoint: new URL(req.url).pathname, body });
    return ok200(reply(req, body));
  });
  return calls;
};

const HOTEL_DETAILS = {
  suHotelId: "FIDATO-5EL", countryCode: "IN",
  contactFirstName: "Test", contactLastName: "Contact",
};

/* Everything a full send needs: the hotel's record made SU-shaped, its SU
   details, both room types on, and two meal plans on. */
const readyToSend = async () => {
  const db = await admin();
  try {
    await db.query(
      /* Written the way a person writes a number: SU gets it without the
         spaces and hyphen, and the hotel record keeps it as typed. */
      `update hotels set phone = '+91 0000-000 000', address_line = 'Test Road', email = 'test@example.com',
              pin = '413216', latitude = 17.5236, longitude = 76.2036
        where id = $1`,
      [hotelId]);
  } finally { await db.end(); }
  expect((await call(ownerId, "/hotel", "PUT", HOTEL_DETAILS)).status).toBe(200);
  expect((await call(ownerId, `/room-types/${superiorId}`, "PUT",
    { suRoomId: "SUP", suRoomType: 9, maxChildren: 1, isConnected: true })).status).toBe(200);
  expect((await call(ownerId, `/room-types/${deluxeId}`, "PUT",
    { suRoomId: "DLX", suRoomType: 7, maxChildren: 2, isConnected: true })).status).toBe(200);
  expect((await call(ownerId, "/rate-plans/EP", "PUT",
    { suRatePlanId: "EP", suMealPlan: 15, isConnected: true })).status).toBe(200);
  expect((await call(ownerId, "/rate-plans/CP", "PUT",
    { suRatePlanId: "CP", suMealPlan: 2, isConnected: true })).status).toBe(200);
};

describe("who may", () => {
  it("refuses the GM every route, by the server", async () => {
    expect((await call(gmId, "/content")).status).toBe(403);
    expect((await call(gmId, "/hotel", "PUT", HOTEL_DETAILS)).status).toBe(403);
    expect((await call(gmId, `/room-types/${deluxeId}`, "PUT",
      { suRoomId: "DLX", suRoomType: 7, maxChildren: 2, isConnected: true })).status).toBe(403);
    expect((await call(gmId, "/content/send", "POST")).status).toBe(403);
  });
});

describe("the mapping", () => {
  it("refuses children that fill the room, and a room type SU does not list", async () => {
    const tooMany = await call(ownerId, `/room-types/${deluxeId}`, "PUT",
      { suRoomId: "DLX", suRoomType: 7, maxChildren: 3, isConnected: true });
    expect(tooMany.status).toBe(409);
    expect((await tooMany.json() as { reason: string }).reason).toContain("less than 3");

    const unknown = await call(ownerId, `/room-types/${deluxeId}`, "PUT",
      { suRoomId: "DLX", suRoomType: 2, maxChildren: 1, isConnected: true });
    expect(unknown.status).toBe(409);
  });

  it("refuses one SU room id for two room types, and an id SU would not take", async () => {
    await call(ownerId, `/room-types/${deluxeId}`, "PUT", { suRoomId: "DLX", suRoomType: 7, maxChildren: 1, isConnected: true });
    const twice = await call(ownerId, `/room-types/${superiorId}`, "PUT", { suRoomId: "dlx", suRoomType: 9, maxChildren: 1, isConnected: true });
    expect(twice.status).toBe(409);
    const spaced = await call(ownerId, `/room-types/${superiorId}`, "PUT", { suRoomId: "SUP ROOM", suRoomType: 9, maxChildren: 1, isConnected: true });
    expect(spaced.status).toBe(409);
  });

  it("reads back what was saved, with SU's lists, and invents nothing for what was not", async () => {
    const res = await call(ownerId, "/content");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      channel: unknown; problems: string[]; roomTypes: Array<{ code: string; mapping: unknown; rackRate: string | null }>;
      suRoomTypes: unknown[]; suMealPlans: unknown[]; switchedOn: boolean;
    };
    expect(body.channel).toBeNull();
    expect(body.problems).toHaveLength(1);
    expect(body.roomTypes.map((t) => t.code).sort()).toEqual(["DLX", "SUP"]);
    expect(body.roomTypes.every((t) => t.mapping === null)).toBe(true);
    expect(body.suRoomTypes.length).toBeGreaterThan(10);
    expect(body.suMealPlans.length).toBeGreaterThan(10);
    expect(body.switchedOn).toBe(false);
  });
});

describe("the postcode and the map point are the hotel's (D27-214)", () => {
  type Read = { hotel: { postalCode: string | null; latitude: string | null; longitude: string | null } };
  const place = async () => ((await (await call(ownerId, "/content")).json()) as Read).hotel;
  const setHotel = async (pin: string | null, latitude: number | null, longitude: number | null) => {
    const db = await admin();
    try {
      await db.query("update hotels set pin = $2, latitude = $3, longitude = $4 where id = $1",
        [hotelId, pin, latitude, longitude]);
    } finally { await db.end(); }
  };
  /* A row as the SU setup wrote it before 168. */
  const oldSuRow = async (postalCode: string) => {
    const db = await admin();
    try {
      await db.query(
        `insert into channel_hotels (hotel_id, su_hotel_id, postal_code, country_code, latitude, longitude,
                                     contact_first_name, contact_last_name)
         values ($1, 'FIDATO-5EL', $2, 'IN', 17.5236, 76.2036, 'Test', 'Contact')`, [hotelId, postalCode]);
    } finally { await db.end(); }
  };

  it("SU's setup no longer writes them: the hotel's own are read, whatever is sent there", async () => {
    await setHotel("413216", 17.5236, 76.2036);
    const res = await call(ownerId, "/hotel", "PUT",
      { ...HOTEL_DETAILS, postalCode: "999999", latitude: 1, longitude: 1 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await place()).toMatchObject({ postalCode: "413216", latitude: "17.523600", longitude: "76.203600" });
    const db = await admin();
    try {
      const { rows } = await db.query(
        "select postal_code, latitude, longitude from channel_hotels where hotel_id = $1", [hotelId]);
      expect(rows[0]).toEqual({ postal_code: null, latitude: null, longitude: null });
    } finally { await db.end(); }
  });

  it("a hotel already on SU still sends its point, until its profile has its own", async () => {
    setUpSu();
    await readyToSend();
    await setHotel(null, null, null);
    const db = await admin();
    try {
      await db.query(
        "update channel_hotels set postal_code = '413217', latitude = 17.5, longitude = 76.2 where hotel_id = $1",
        [hotelId]);
    } finally { await db.end(); }

    const calls = pretendSu();
    expect((await call(ownerId, "/content/send", "POST")).status).toBe(200);
    const property = (calls[0]!.body as any).HotelDescriptiveContents.HotelDescriptiveContent;
    expect(property.HotelInfo.Position).toEqual({ Latitude: "17.500000", Longitude: "76.200000" });
    expect(property.ContactInfos.ContactInfo[0].Addresses.Address.PostalCode).toBe("413217");
  });

  it("keeps a postcode 168 could not copy into a six-digit PIN", async () => {
    await setHotel(null, null, null);
    await oldSuRow("SW1A 1AA");
    expect(await place()).toMatchObject({ postalCode: "SW1A 1AA", latitude: "17.523600", longitude: "76.203600" });
    /* And saving the SU details again does not wipe it. */
    expect((await call(ownerId, "/hotel", "PUT", HOTEL_DETAILS)).status).toBe(200);
    expect((await place()).postalCode).toBe("SW1A 1AA");
  });
});

describe("sending", () => {
  it("sends nothing while SU is not set up", async () => {
    await readyToSend();
    const calls = pretendSu();
    const res = await call(ownerId, "/content/send", "POST");
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing while anything is missing, and names every missing thing at once", async () => {
    setUpSu();
    const calls = pretendSu();
    await call(ownerId, "/hotel", "PUT", { suHotelId: "FIDATO-5EL" });
    const db = await admin();
    try {
      await db.query(
        "update hotels set phone = '02181 220011', address_line = null, pin = null, latitude = null, longitude = null where id = $1",
        [hotelId]);
    } finally { await db.end(); }

    const res = await call(ownerId, "/content/send", "POST");
    expect(res.status).toBe(409);
    const body = await res.json() as { problems: string[] };
    const all = body.problems.join(" ");
    for (const word of ["street address", "postcode", "country", "latitude", "longitude",
                        "first name", "last name", "+ and the country code"]) {
      expect(all).toContain(word);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a room type with no rack rate rather than send a price nobody set", async () => {
    setUpSu();
    await readyToSend();
    const db = await admin();
    try {
      await db.query("update room_types set base_rate = null where id = $1", [deluxeId]);
      const calls = pretendSu();
      const res = await call(ownerId, "/content/send", "POST");
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toContain("Deluxe has no rack rate");
      expect(calls).toHaveLength(0);
    } finally {
      await db.query("update room_types set base_rate = 3699.00 where id = $1", [deluxeId]);
      await db.end();
    }
  });

  it("sends the property, then room types, then rate plans, as SU's documents describe", async () => {
    setUpSu();
    await readyToSend();
    const calls = pretendSu();
    const res = await call(ownerId, "/content/send", "POST");
    const text = await res.text();
    expect(res.status, text).toBe(200);

    expect(calls.map((c) => c.endpoint)).toEqual([
      "/SUAPI/jservice/OTA_HotelDescriptiveContentNotif",
      "/SUAPI/jservice/OTA_HotelRoom", "/SUAPI/jservice/OTA_HotelRoom",
      "/SUAPI/jservice/OTA_HotelRatePlan", "/SUAPI/jservice/OTA_HotelRatePlan",
    ]);

    const property = (calls[0]!.body as any).HotelDescriptiveContents.HotelDescriptiveContent;
    expect(property).toMatchObject({
      hotelid: "FIDATO-5EL", HotelDescriptiveContentNotifType: "New", CurrencyCode: "INR",
      HotelInfo: { Position: { Latitude: "17.523600", Longitude: "76.203600" } },
    });
    expect(property.ContactInfos.ContactInfo[0].Addresses.Address).toEqual({
      AddressLine: "Test Road", CityName: "Akkalkot", PostalCode: "413216", CountryName: "IN",
    });
    expect(property.ContactInfos.ContactInfo[1].Phones.Phone).toEqual([
      { PhoneNumber: "+910000000000", PhoneTechType: "1" },
    ]);
    const stored = await admin();
    try {
      const { rows } = await stored.query<{ phone: string }>("select phone from hotels where id = $1", [hotelId]);
      expect(rows[0]!.phone).toBe("+91 0000-000 000");
    } finally { await stored.end(); }

    const rooms = calls.slice(1, 3).map((c) => (c.body as any).SellableProducts.SellableProduct[0]);
    const deluxe = rooms.find((r) => r.GuestRoom.Room.roomid === "DLX");
    expect(deluxe).toEqual({
      InvStatusType: "Initial",
      GuestRoom: {
        Occupancy: { MaxOccupancy: "3", MaxChildOccupancy: "2" },
        Room: { roomid: "DLX", RoomRate: "3699.00", Quantity: "8", RoomType: "7" },
        Description: { Text: "Deluxe" },
      },
    });

    const plans = calls.slice(3).map((c) => (c.body as any).RatePlans.RatePlan[0]);
    expect(plans).toContainEqual({
      RatePlanNotifType: "New", rateplanid: "EP", MealPlanID: "15",
      Description: { Name: "European Plan", Text: "Room only" },
    });

    /* The second send updates: nothing is created twice. */
    const again = pretendSu();
    expect((await call(ownerId, "/content/send", "POST")).status).toBe(200);
    expect((again[0]!.body as any).HotelDescriptiveContents.HotelDescriptiveContent.HotelDescriptiveContentNotifType).toBe("Overlay");
    expect(again.slice(1, 3).map((c) => (c.body as any).SellableProducts.SellableProduct[0].InvStatusType)).toEqual(["Modify", "Modify"]);
    expect(again.slice(3).map((c) => (c.body as any).RatePlans.RatePlan[0].RatePlanNotifType)).toEqual(["Overlay", "Overlay"]);
  });

  it("creates again next time what SU refused to create, and says what SU said", async () => {
    setUpSu();
    await readyToSend();
    pretendSu((_req, body) =>
      JSON.stringify(body).includes("\"DLX\"") && JSON.stringify(body).includes("Initial") ? ROOM_EXISTS : SU_SUCCESS);
    const res = await call(ownerId, "/content/send", "POST");
    expect(res.status).toBe(502);
    const body = await res.json() as { results: Array<{ name: string; ok: boolean; reason: string | null }> };
    expect(body.results.find((r) => r.name === "Deluxe")).toMatchObject({ ok: false });
    expect(body.results.find((r) => r.name === "Deluxe")!.reason).toContain("already exists");
    /* The others still went. */
    expect(body.results.filter((r) => r.ok)).toHaveLength(4);

    const next = pretendSu();
    await call(ownerId, "/content/send", "POST");
    const deluxe = next.map((c) => (c.body as any).SellableProducts?.SellableProduct[0])
      .find((p) => p?.GuestRoom?.Room?.roomid === "DLX");
    expect(deluxe.InvStatusType).toBe("Initial");
  });

  it("takes a room type off SU with Deactivated, and never changes an id SU already has", async () => {
    setUpSu();
    await readyToSend();
    pretendSu();
    await call(ownerId, "/content/send", "POST");

    const renamed = await call(ownerId, `/room-types/${deluxeId}`, "PUT",
      { suRoomId: "DELUXE", suRoomType: 7, maxChildren: 2, isConnected: true });
    expect(renamed.status).toBe(409);
    expect((await renamed.json() as { reason: string }).reason).toContain("cannot change");

    await call(ownerId, `/room-types/${deluxeId}`, "PUT", { suRoomId: "DLX", suRoomType: 7, maxChildren: 2, isConnected: false });
    const calls = pretendSu();
    expect((await call(ownerId, "/content/send", "POST")).status).toBe(200);
    const off = calls.map((c) => (c.body as any).SellableProducts?.SellableProduct[0]).filter(Boolean)
      .find((p) => p.roomid === "DLX");
    expect(off).toEqual({ InvNotifType: "Overlay", InvStatusType: "Deactivated", roomid: "DLX" });

    const db = await admin();
    try {
      const { rows } = await db.query<{ on_su: string }>(
        "select on_su from channel_room_types where room_type_id = $1", [deluxeId]);
      expect(rows[0]!.on_su).toBe("deactivated");
    } finally { await db.end(); }
  });

  it("does not reach the live account for a hotel that is not switched on", async () => {
    setUpSu("live");
    await readyToSend();
    const calls = pretendSu();
    const res = await call(ownerId, "/content/send", "POST");
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toContain("not switched on");
    expect(calls).toHaveLength(0);
  });
});
