import { vi } from "vitest";
import {
  property, roomInventory, PROPERTY_CODE,
  dailyAvailableRooms, nightsSoldPerDay,
} from "@/data/fixtures/property";
import { stays, folios, groups } from "@/data/fixtures/reservations";
import { setBusinessDate } from "@/data/repositories/businessDate";
import { FIXTURE_BUSINESS_DATE } from "@/data/fixtures/property";

/* ══════════════════════════════════════════════════════════════════
   TEST SETUP — the transport, stubbed once

   CP9 moved the repositories from an in-memory store onto HTTP. These
   tests run in jsdom with no server and no token, so the transport is
   stubbed here rather than in each file that happens to touch it.

   THE SPLIT THIS ENFORCES, and why it matters:

     these tests      the SEAM'S CONTRACT — scoping, cloning, the shape
                      a screen receives, and that no screen reaches
                      around it. A stub can answer all of that.

     api/test         whether the SQL is right, against real Postgres,
                      as pms_app, with RLS in force.

   A mock cannot tell you a query is correct, and a test that pretends
   otherwise is a green light sitting on top of a broken database. So
   the stub answers exactly what the live routes were observed to
   answer — verified with curl and by the API's own suite — and nothing
   more inventive than that.
   ══════════════════════════════════════════════════════════════════ */

class StubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isUnauthenticated() {
    return this.status === 401;
  }
}

vi.mock("@/lib/api", () => ({
  ApiError: StubApiError,
  /* Thrown by api() when a write is held in the outbox. Repositories
     rethrow it BECAUSE it is not an ApiError, so the stub has to be a
     distinct class here too or a held write would look like a refusal. */
  HeldError: class StubHeldError extends Error {},
  devAuth: false,
  setDevSubject: () => {},
  getDevSubject: () => null,
  /* The shell renders OfflineBar, which asks who is signed in so it
     only drains this person's held work. Missing from the mock it took
     out fifteen tests that have nothing to do with offline. */
  currentSubject: () => "stub-staff",
  apiBase: async () => "",
  authHeaders: async () => ({}),
  /* A screen's Download button: the real one is proved in src/lib/download.test.ts. */
  downloadFile: async () => "stub-file",
  filenameFrom: () => null,

  getSession: async () => ({
    scope: {
      staffId: "stub-staff",
      email: "owner@fidato.in",
      fullName: "Group Owner",
      isGroupAdmin: true,
      hotels: [],
    },
    hotels: [{ id: "uuid-5el", code: PROPERTY_CODE, name: property.name }],
  }),

  api: async (url: string) => {
    /* A QUERY STRING IS NOT PART OF A ROUTE.
       Every branch below matches with `===`, against the full string it
       was handed. So the day `listGroups` started sending `?scope=current`
       — a change with nothing to do with this file — the groups branch
       stopped matching and the seam test failed with "no group in
       fixture", which reads as missing data rather than a stale mock.

       Split once, here, so the next repository function that learns a
       parameter does not break a test three directories away. */
    const path = url.split("?")[0]!;

    if (path === "/api/hotels") {
      return {
        scope: { isGroupAdmin: true, hotels: [] },
        hotels: [{ id: "uuid-5el", code: PROPERTY_CODE }],
      };
    }

    /* A person's own preferences — the first screen (087) and the Start
       here card (089). The live route answers { ok: true }; api/test/
       firstScreen.test.ts proves that against Postgres. */
    if (path === "/api/me/preferences") return { ok: true };

    /* ⚠ WITHOUT THIS BRANCH THE MODULES TEST PASSES VACUOUSLY.
       `getModules` catches its own failure and returns {}, so the
       settings screen renders ZERO switches — and "no switch is
       disabled" is trivially true of no switches. The guard for the
       banquet defect would have proved nothing.

       Both modules ON, because that is the state a real property is in
       and the assertion is about the CONTROL, not the value. */
    if (path === `/api/hotels/${PROPERTY_CODE}/modules`) {
      return {
        modules: [
          { module: "pos", enabled: true },
          { module: "banquet", enabled: true },
        ],
      };
    }

    if (path === `/api/hotels/${PROPERTY_CODE}`) {
      return {
        id: PROPERTY_CODE,
        name: property.name,
        address: property.address,
        phone: property.phone,
        email: property.email,
        gstin: property.gstin,
        currency: property.currency,
        checkInTime: property.checkInTime,
        checkOutTime: property.checkOutTime,
        rooms: property.rooms,
        roomTypes: property.roomTypes,
        rateTypes: property.rateTypes,
        tax: property.tax,
        paymentMethods: property.paymentMethods,
      };
    }

    /* Calibrated to the demo, matching RACK in load-demo.ts. */
    const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };

    if (path === `/api/hotels/${PROPERTY_CODE}/rooms`) {
      return roomInventory.map((r) => ({
        number: r.number,
        type: r.type,
        floor: r.floor,
        status: r.status,
        maxOccupancy: r.maxOccupancy,
        /* The rack rate the real endpoint now returns from
           room_types.base_rate. The demo property's calibrated rates,
           the same ones load-demo.ts sets. Nullable in the schema — a
           type nobody has priced yet — and the chart prints a dash for
           that rather than a zero. */
        rackRate: RACK[r.type] ?? null,
          /* The block ranges the real endpoint returns, derived here
             from the same six dates the tape chart used to read out of
             a fixture. 308 is out of service except 8-13 August, which
             is what the real Monthly Statistics export shows.

             INCLUSIVE on both ends, matching app.sellable_rooms: the
             room is out THROUGH 7 August and again from the 14th. */
          blocks:
            r.status === "out-of-service"
              ? [
                  { from: "2026-01-01", to: "2026-08-07", reason: "out_of_service" },
                  { from: "2026-08-14", to: null, reason: "out_of_service" },
                ]
              : [],
      }));
    }


    /* Stays, folios and groups come back as the FIXTURES define them —
       including their `stay-*` ids rather than the uuids Postgres
       hands out. That is deliberate: these tests assert the seam's
       FILTERING (who is arriving, who is in house, which folio is
       overpaid), and naming a stay by a readable id is what makes a
       failure legible. Whether the SQL behind the real route is right
       is api/test's job, against a real database. */
    if (path === `/api/hotels/${PROPERTY_CODE}/stays`) {
      return stays.map((s) => ({ ...s, hotelId: PROPERTY_CODE }));
    }

    const one = path.match(
      new RegExp(`^/api/hotels/${PROPERTY_CODE}/stays/([^/]+)$`),
    );
    if (one) {
      const found = stays.find((s) => s.id === one[1]);
      if (!found) throw new StubApiError(404, "Not found.");
      return { ...found, hotelId: PROPERTY_CODE };
    }

    const folioOf = path.match(
      new RegExp(`^/api/hotels/${PROPERTY_CODE}/stays/([^/]+)/folio$`),
    );
    if (folioOf) {
      const found = folios.find((f) => f.stayId === folioOf[1]);
      if (!found) throw new StubApiError(404, "Not found.");
      return { ...found, status: found.balance === 0 ? "settled" : "open" };
    }

    if (path === `/api/hotels/${PROPERTY_CODE}/folios`) {
      return folios
        .filter((f) => f.balance !== 0)
        .map((f) => ({ ...f, status: "open" }))
        .sort((a, b) => a.balance - b.balance);
    }

    if (path === `/api/hotels/${PROPERTY_CODE}/groups`) {
      return groups.map((g) => ({ ...g, hotelId: PROPERTY_CODE }));
    }

    /* One group and its rooms. Built from the SAME fixture stays the
       tape chart draws, so the panel cannot show a group whose rooms
       disagree with the chart behind it. */
    const oneGroup = path.match(
      new RegExp(`^/api/hotels/${PROPERTY_CODE}/groups/([^/]+)$`),
    );
    if (oneGroup) {
      const found = groups.find((g) => g.id === oneGroup[1]);
      if (!found) throw new StubApiError(404, "No such group.");
      const members = stays.filter((s) => s.groupId === found.id);
      return {
        id: found.id,
        name: found.name,
        blockCode: found.reference,
        company: null,
        notes: null,
        rooms: members.map((s) => ({
          reservationId: s.id,
          reference: s.reference,
          guest: s.guest,
          room: s.roomNumber ?? null,
          roomType: s.roomType,
          checkIn: s.arrival,
          checkOut: s.departure,
          nights: s.nights,
          status: s.status,
          agreedRate: s.offeredTariff,
          routed: false,
          balance: 0,
          adults: s.adults,
          children: s.children,
        })),
        master: null,
        guestBalance: 0,
      };
    }


    /* Statistics. The real route derives these in SQL — sellable rooms
       from `room_blocks`, sold nights from reservations, revenue from
       the folios. The stub reproduces the same ANSWERS from the same
       calibrated fixtures, so the assertions about 431/132/30.63 keep
       meaning something here while api/test proves the SQL against a
       real database. */
    const statsRange = path.match(
      new RegExp(`^/api/hotels/${PROPERTY_CODE}/statistics/(daily|period)`),
    );
    if (statsRange) {
      const url = new URL(path, "http://x");
      const from = url.searchParams.get("from") ?? "2026-08-01";
      const to = url.searchParams.get("to") ?? "2026-08-25";

      const days = Object.keys(dailyAvailableRooms)
        .filter((d) => d >= from && d <= to)
        .sort()
        .map((date) => {
          const available = dailyAvailableRooms[date] ?? 0;
          const sold = nightsSoldPerDay[date] ?? 0;
          return {
            date,
            availableRooms: available,
            roomsSold: sold,
            occupancyPct: available
              ? Math.round((sold / available) * 10000) / 100
              : 0,
          };
        });

      if (statsRange[1] === "daily") return days;

      const availableRoomNights = days.reduce((t, d) => t + d.availableRooms, 0);
      const roomsSold = days.reduce((t, d) => t + d.roomsSold, 0);
      const roomRevenue = property._calibration.roomRevenue;

      /* Rates from the TOTALS, never averaged from daily averages. */
      return {
        from, to, availableRoomNights, roomsSold,
        occupancyPct: availableRoomNights
          ? Math.round((roomsSold / availableRoomNights) * 10000) / 100 : 0,
        adr: roomsSold ? Math.round((roomRevenue / roomsSold) * 100) / 100 : 0,
        revpar: availableRoomNights
          ? Math.round((roomRevenue / availableRoomNights) * 100) / 100 : 0,
        roomRevenue,
      };
    }

    const snapshot = path.match(
      new RegExp(`^/api/hotels/${PROPERTY_CODE}/statistics/snapshot`),
    );
    if (snapshot) {
      const date =
        new URL(path, "http://x").searchParams.get("date") ?? "2026-08-25";
      const available = dailyAvailableRooms[date] ?? 0;
      const sold = nightsSoldPerDay[date] ?? 0;
      return {
        date, available, sold,
        vacant: available - sold,
        occupancyPct: available
          ? Math.round((sold / available) * 10000) / 100 : 0,
      };
    }

    /* Every other property answers 404 — the same reply a code the
       caller may not see gets, deliberately. Telling someone a property
       exists but is not theirs is still telling them it exists. */
    throw new StubApiError(404, "No such property.");
  },
}));

/* ── The business date, which the session normally supplies ───────── */

/*
   In the running app `src/lib/session.ts` calls `setBusinessDate()`
   with the value the API returned for the selected property, and it
   does so before any screen renders. Tests have no session, so the
   harness plays that part.

   The value is the FIXTURE date, and that is the point: every figure
   these tests assert — 431 available room-nights, 132 sold, ADR
   ₹3,178.63 — is calibrated to the real eZee export for 1–25 August
   2026. A test running against a different business date would be
   asserting numbers derived from one window against a dataset built
   for another.

   Setting it here rather than defaulting it in the module is
   deliberate. The default is the empty string, so a screen that ever
   renders without a session shows blank dates and throws on date
   arithmetic — loudly wrong, at the point of the mistake. When this
   line was missing, 26 tests failed with `Invalid time value` inside
   `addDays`, which is exactly the alarm a silent fallback to
   "2026-08-25" would have suppressed.
*/
setBusinessDate(FIXTURE_BUSINESS_DATE);
