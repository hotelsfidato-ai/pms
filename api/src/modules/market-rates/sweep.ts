import { withUser, type Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   RIVALS' PRICES: THE CHECK (the owner's D27-269, D27-270)

   Each nearby hotel's lowest public price per night, as Google Hotels
   shows it, read through SerpApi: one search per night, for the next 30
   nights, on Mondays and Thursdays from 06:00 on the property's clock.
   About 260 searches a month per hotel.

   ⚠ NOTHING HAPPENS UNTIL BOTH ARE THERE: the server's SERPAPI_KEY (the
   owner types it, D27-270) and the hotel's "Rivals' prices" switch, off
   by default. Without the key the sweep does not even ask the database;
   without a switched-on hotel it asks SerpApi nothing.

   ⚠ A HOTEL IS MARKED CHECKED BEFORE IT IS SEARCHED (app.market_rates_begin),
   so a failed search is logged and waits for the next check day - never
   tried again sooner, because every try is a paid search.

   NOBODY IS SIGNED IN AT SIX IN THE MORNING. Both tables are FORCE
   row-secured, so the sweep works only through migration 196's two
   SECURITY DEFINER functions, as `withUser("")`.

   Nothing here is a price this system sells at, and nothing here
   changes one. Revenue management reads it beside its suggestions.
   ══════════════════════════════════════════════════════════════════ */

/** ISO days: 1 is Monday, 4 is Thursday. */
export const CHECK_DAYS = [1, 4];
/** From this hour on the property's own clock. */
export const CHECK_FROM = "06:00";
/** The nights checked, from the property's own today. */
export const NIGHTS_AHEAD = 30;
/** How often the timer looks whether a hotel is due. A look costs one query. */
export const LOOK_EVERY_MS = 15 * 60_000;

/** The owner's SerpApi key, read when asked so that typing it on the
    server needs a restart and nothing else. */
export const serpApiKey = (): string | null => process.env["SERPAPI_KEY"]?.trim() || null;

export interface Seen { competitor: string; price: number; source: string | null }

/** One night's Google Hotels answer, as SerpApi gives it. */
export type Search = (q: string, checkIn: string, checkOut: string, key: string) => Promise<unknown>;

type Run = <T>(fn: (client: Client) => Promise<T>) => Promise<T>;

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function serpApi(q: string, checkIn: string, checkOut: string, key: string): Promise<unknown> {
  const url = new URL("https://serpapi.com/search.json");
  url.search = new URLSearchParams({
    engine: "google_hotels", q, check_in_date: checkIn, check_out_date: checkOut,
    gl: "in", hl: "en", currency: "INR", api_key: key,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  /* The key is in the address, so the address is never in a message. */
  if (!res.ok) throw new Error(`SerpApi answered ${res.status}`);
  return res.json();
}

/* ── The hotel itself, matched loosely ─────────────────────────────
   Google may write "Hotel 5 Elements" for "5 Elements Akkalkot". So: the
   hotel's own words, less the city's and a few every hotel shares, must
   all be in the other name. */
const SHARED = new Set(["hotel", "hotels", "the", "resort", "resorts", "inn", "and", "by"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !SHARED.has(w));

export function isOwnHotel(own: string, city: string, theirs: string): boolean {
  const town = new Set(words(city));
  const mine = words(own).filter((w) => !town.has(w));
  const other = new Set(words(theirs));
  if (mine.length === 0) return words(own).join(" ") === words(theirs).join(" ");
  return mine.every((w) => other.has(w));
}

interface Property {
  name?: string;
  type?: string;
  rate_per_night?: { extracted_lowest?: number };
  prices?: Array<{ source?: string; rate_per_night?: { extracted_lowest?: number } }>;
}

/** The rivals in one answer: hotels only, each with a price, never the
    hotel itself. The source is the site whose price is the lowest one. */
export function rivalsIn(answer: unknown, own: string, city: string): Seen[] {
  const properties = ((answer as { properties?: Property[] } | null)?.properties) ?? [];
  return properties.flatMap((p) => {
    const price = p.rate_per_night?.extracted_lowest;
    if (!p.name || p.type !== "hotel" || typeof price !== "number" || !(price > 0)) return [];
    if (isOwnHotel(own, city, p.name)) return [];
    const source = p.prices?.find((x) => x.rate_per_night?.extracted_lowest === price)?.source ?? null;
    return [{ competitor: p.name, price, source }];
  });
}

interface Due { hotelId: string; code: string; name: string; city: string; today: string }

export async function dueNow(client: Client, now: Date): Promise<Due[]> {
  const { rows } = await client.query<{ hotel_id: string; code: string; name: string; city: string; today: string }>(
    `select hotel_id::text, code, name, city, today::text
       from app.market_rates_begin($1::integer[], $2::time, $3::timestamptz)`,
    [CHECK_DAYS, CHECK_FROM, now]);
  return rows.map((r) => ({ hotelId: r.hotel_id, code: r.code, name: r.name, city: r.city, today: r.today }));
}

export interface SweepResult { hotels: number; searches: number; kept: number; failed: number }

/* ── One pass ──────────────────────────────────────────────────────
   One transaction per night kept, so a failure loses that night only. */
export async function runOnce(
  run: Run = (fn) => withUser("", fn),
  search: Search = serpApi,
  now: Date = new Date(),
): Promise<SweepResult> {
  const result: SweepResult = { hotels: 0, searches: 0, kept: 0, failed: 0 };
  const key = serpApiKey();
  if (!key) return result;

  for (const hotel of await run((client) => dueNow(client, now))) {
    result.hotels += 1;
    for (let i = 0; i < NIGHTS_AHEAD; i += 1) {
      const night = addDays(hotel.today, i);
      try {
        result.searches += 1;
        const seen = rivalsIn(await search(`hotels in ${hotel.city}`, night, addDays(night, 1), key),
          hotel.name, hotel.city);
        if (seen.length === 0) continue;
        result.kept += await run(async (client) => (await client.query<{ kept: number }>(
          "select app.market_rates_record($1::uuid, $2::date, $3::jsonb) as kept",
          [hotel.hotelId, night, JSON.stringify(seen)])).rows[0]?.kept ?? 0);
      } catch (error) {
        result.failed += 1;
        console.error("[market-rates] could not check", hotel.code, night,
          error instanceof Error ? error.message : error);
      }
    }
  }
  return result;
}

/* ── The timer ─────────────────────────────────────────────────────
   Started by `server.ts` after the port is open, never under the tests;
   a pass never overlaps the one before. The CRS reader's shape. */
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = runOnce()
        .catch((error) => console.error("[market-rates] sweep failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, LOOK_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    await running;
  },
};
