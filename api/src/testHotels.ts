import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { withUser, type Client } from "./db.ts";

/* ══════════════════════════════════════════════════════════════════
   NOTHING LEAVES A TEST HOTEL (D27-296 (4), the owner, 10 October)

   "No WhatsApp, email, report emails, channel manager, CRS, rivals'
   prices, Drive uploads or alerts, enforced in code; KOT and bill
   printing still work."

   ONE CHECK, `app.is_test_hotel`, asked in these places and nowhere else:

     the database    SU, the CRS, rivals' prices and the daily report emails
                     cannot be set up for a test hotel, and loyalty and the
                     channel manager cannot be switched on there - so their
                     sweeps never meet one (migration "test hotels")
     sending.ts      the one door out (WhatsApp and email): refuses, and
                     writes the refusal down as the attempt's outcome, so
                     the message and invoice sweeps stop at their limit
     OUTSIDE below   every desk button that would send or reach outside,
                     answered 409 with one sentence before its route runs
     health alerts   the sweep looks at real hotels only (alertHotels)
     the guest door  the ID photo (Drive) and DigiLocker, which a link
                     reaches without an address that names the hotel
   ══════════════════════════════════════════════════════════════════ */

export const NOTHING_SENT = "This is a test hotel: nothing is sent from it.";

/** Is this hotel a test hotel? */
export async function isTestHotelId(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ test: boolean }>(
    "select app.is_test_hotel($1::uuid) as test", [hotelId]);
  return rows[0]?.test === true;
}

/** Is the hotel with this code a test hotel, asked in a session already
    open - through the definer, so it answers for a hotel the caller cannot
    read (a GM asking to add somebody to a test hotel is refused 403). */
export async function isTestHotelCodeIn(client: Client, code: string): Promise<boolean> {
  const { rows } = await client.query<{ test: boolean }>(
    "select app.is_test_hotel_code($1) as test", [code]);
  return rows[0]?.test === true;
}

/** Is the hotel with this code a test hotel? Asked as nobody, through the
    definer: a guest's link and a sweep have no session to read hotels with. */
export async function isTestHotelCode(code: string): Promise<boolean> {
  return withUser("", async (client) => {
    const { rows } = await client.query<{ test: boolean }>(
      "select app.is_test_hotel_code($1) as test", [code]);
    return rows[0]?.test === true;
  });
}

/* Every person's route that would send, or reach a system outside the PMS,
   by its pattern as Hono reports it. A test hotel's request to one of them is
   answered 409 before the route runs. api/test/modules/admin/testHotels.test.ts
   holds every pattern here to a route the server mounts, and asks each one
   for a test hotel. */
export const OUTSIDE: Readonly<Record<string, string>> = {
  /* WhatsApp and email (guest messaging, reviews) */
  "POST /api/hotels/:code/stays/:id/confirmation": NOTHING_SENT,
  "POST /api/hotels/:code/stays/:id/checkin-link": NOTHING_SENT,
  "POST /api/hotels/:code/invoices/:number{.+}/send": NOTHING_SENT,
  "POST /api/hotels/:code/reviews/:id/ask": NOTHING_SENT,
  "PUT /api/hotels/:code/report-emails": NOTHING_SENT,
  /* SU, the CRS, rivals' prices */
  "POST /api/hotels/:code/channel-manager/availability/send": NOTHING_SENT,
  "POST /api/hotels/:code/channel-manager/content/send": NOTHING_SENT,
  "PUT /api/hotels/:code/channel-manager/hotel": NOTHING_SENT,
  "PUT /api/hotels/:code/channel-manager/room-types/:roomTypeId": NOTHING_SENT,
  "PUT /api/hotels/:code/channel-manager/rate-plans/:mealPlan": NOTHING_SENT,
  "PUT /api/hotels/:code/crs/setup": NOTHING_SENT,
  "PUT /api/hotels/:code/market-rates/switch": NOTHING_SENT,
  /* Google Drive: a guest's ID photo, and the bills' mirror */
  "POST /api/hotels/:code/stays/:id/id-photo": NOTHING_SENT,
  "POST /api/hotels/:code/online-checkin/id-photos/:id/remove": NOTHING_SENT,
  "GET /api/hotels/:code/attachments/awaiting-mirror": NOTHING_SENT,
  "POST /api/hotels/:code/attachments/:id/mirrored": NOTHING_SENT,
  /* The door locks: a test hotel's rooms carry the real hotel's numbers, and
     a key cut for one would open a real door. */
  "POST /api/hotels/:code/stays/:id/keys": NOTHING_SENT,
  /* (11) kept out of the accounting export. */
  "GET /api/hotels/:code/accounting/:file{day-book(?:\\.xlsx)?}":
    "This is a test hotel: its figures never go to the accounts.",
};

export const nothingLeavesTestHotels: MiddlewareHandler = async (c, next) => {
  const method = c.req.method === "HEAD" ? "GET" : c.req.method;
  const route = matchedRoutes(c).find((r) => r.method === method);
  const sentence = route ? OUTSIDE[`${route.method} ${route.path}`] : undefined;
  if (!sentence) return next();
  const code = decodeURIComponent(c.req.path.split("/")[3] ?? "");
  if (code && await isTestHotelCode(code)) {
    return c.json({ ok: false, reason: sentence, error: sentence }, 409);
  }
  return next();
};

/** The hotels in a list that are real - for a sweep, which never works for
    a test hotel. */
export async function realHotelsOnly<T extends { hotelId: string }>(
  client: Client, list: T[],
): Promise<T[]> {
  if (list.length === 0) return list;
  const { rows } = await client.query<{ id: string }>(
    "select id::text from unnest($1::uuid[]) id where not app.is_test_hotel(id)",
    [list.map((h) => h.hotelId)]);
  const real = new Set(rows.map((r) => r.id));
  return list.filter((h) => real.has(h.hotelId));
}
