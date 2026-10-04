import { withUser } from "../../db.ts";
import { send, type Message, type SendResult } from "../../sending.ts";
import {
  alertAddress, hotelFacts, judge, serverFacts, PER_HOTEL,
  type HotelFacts, type Key, type Row, type ServerFacts,
} from "./health.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ALERT: ONE EMAIL WHEN A CONNECTION TURNS RED (D27-276, point 3)

   Every 5 minutes the sweep judges every connection at every active
   hotel, as the page does (health.ts). A connection red at any hotel is
   red. When one goes from not-red to red, the owner gets ONE email:

     by EMAIL ONLY        kind "health-alert", through the one door out
                          (sending.ts) and the n8n workflow's EMAILS draft
                          (deploy/n8n/pms-send-crs.json)
     to                   HEALTH_ALERT_EMAIL, the server's setting. Empty:
                          no alerts at all
     at most once an hour per connection - counted from messages_sent,
                          where the email itself is recorded, so a restart
                          does not lose the count
     never while emails are themselves red: that email could not go. A
                          connection that turned red meanwhile is told
                          once emails work again (still not twice an hour)

   What "turned red" remembers lives in this process: after a restart a
   connection still red is told again, unless it was told within the hour.
   ══════════════════════════════════════════════════════════════════ */

export const SWEEP_EVERY_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

/** The connections red at the last pass. */
const wasRed = new Set<string>();

const when = (at: string | Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(at));

/** What n8n receives. The words are the workflow's (D17-87); these are facts. */
export function alertFor(hotel: HotelFacts, row: Row, to: string, now: Date): Message {
  return {
    channel: "email",
    kind: "health-alert",
    hotel: { id: hotel.hotelId, code: hotel.code, name: hotel.name },
    to: { email: to },
    data: {
      connection: row.label,
      problem: row.summary,
      /* Only where the fact is one hotel's: the backups are the server's. */
      hotelName: PER_HOTEL.has(row.key) ? hotel.name : "",
      at: when(now, hotel.timezone),
      lastSuccess: row.lastSuccess ? when(row.lastSuccess, hotel.timezone) : "",
      lastError: row.lastError?.detail ?? "",
    },
    about: { kind: "connection", id: row.key },
    sentBy: null,
  };
}

export interface Deps {
  hotels?: () => Promise<HotelFacts[]>;
  server?: () => Promise<ServerFacts>;
  send?: (message: Message) => Promise<SendResult>;
  memory?: Set<string>;
  now?: Date;
}

/** One pass: the connections it emailed about. */
export async function runOnce({
  hotels = () => withUser("", (client) => hotelFacts(client, null)),
  server = serverFacts,
  send: sender = (message) => withUser("", (client) => send(client, message)),
  memory = wasRed,
  now = new Date(),
}: Deps = {}): Promise<{ sent: Key[] }> {
  const to = alertAddress();
  if (!to) return { sent: [] };
  const [all, facts] = await Promise.all([hotels(), server()]);

  /* Red anywhere is red; told about from the first hotel where it is. */
  const red = new Map<Key, { hotel: HotelFacts; row: Row }>();
  for (const hotel of all) {
    for (const row of judge(hotel, facts, now)) {
      if (row.status === "red" && !red.has(row.key)) red.set(row.key, { hotel, row });
    }
  }

  const sent: Key[] = [];
  if (facts.sending && !red.has("email")) {
    for (const [key, { hotel, row }] of red) {
      if (memory.has(key)) continue;
      const told = Math.max(0, ...all.map((h) => Date.parse(h.alerted[key] ?? "") || 0));
      if (now.getTime() - told < HOUR_MS) continue;
      await sender(alertFor(hotel, row, to, now));
      sent.push(key);
    }
    memory.clear();
    for (const key of red.keys()) memory.add(key);
  } else {
    /* Nothing can go: forget only what is no longer red, so what turned
       red meanwhile still counts as turning red when emails are back. */
    for (const key of [...memory]) if (!red.has(key as Key)) memory.delete(key);
  }
  return { sent };
}

/* ── The timer ─────────────────────────────────────────────────────
   Started by `server.ts` after the port is open, never under the tests;
   a pass never overlaps the one before. The market-rates shape. */
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = runOnce()
        .catch((error) => console.error("[connections-health] sweep failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, SWEEP_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    await running;
  },
};
