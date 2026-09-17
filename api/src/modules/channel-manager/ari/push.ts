import type { Client } from "../../../db.ts";
import type { SuClient } from "../su/client.ts";
import { SU_ENDPOINTS } from "../su/codes.ts";
import { firstSellableDate, readAri } from "./source.ts";
import {
  ariCells, ariRequests, cellKey, type AriCell, type AriPolicy,
} from "./payloads.ts";

/* ══════════════════════════════════════════════════════════════════
   A PUSH OF RATES AND AVAILABILITY — the part that talks to SU

   One push, for one hotel:

   1. read what the PMS says for the window (a year from the first date SU
      will take: SU requires a year at connection),
   2. turn it into cells, and — for a 'changes' push — keep only the cells
      that differ from what SU was last sent (`channel_ari_sent`),
   3. send them in SU's requests, one after another,
   4. after EACH request SU accepted, record its cells as sent; a refused or
      unanswered request's cells stay unrecorded, so the next push sends them
      again,
   5. log the push (`channel_ari_pushes`) with what SU said.

   The database work happens in sessions the caller opens (`inSession`), so
   a person's push runs as that person under row-level security, and the
   network call to SU is never made while a database transaction is open.

   SU's limit is 5,000 requests an hour a property (200 on the test account).
   A year for two room types and two meal plans is a handful of requests; a
   'changes' push is usually one.
   ══════════════════════════════════════════════════════════════════ */

const WINDOW_DAYS = 365;

export type InSession = <T>(fn: (client: Client, staffId: string | null) => Promise<T>) => Promise<T>;

export interface PushOutcome {
  ok: boolean;
  kind: "all" | "changes";
  from: string;
  to: string;
  requests: number;
  dates: number;
  unpricedDates: number;
  rackOnlyDates: number;
  results: Array<{ ok: boolean; ticketId: string | null; reason: string | null }>;
  reason: string;
}

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function pushAri(
  inSession: InSession, su: SuClient, hotelId: string,
  kind: "all" | "changes", policy: AriPolicy,
  /* A few dates instead of the year: a booking SU sent for a room that is no
     longer free is refused, and those dates go back to SU as 0 rooms left at
     once (D17-80) rather than waiting for the minute job. */
  window?: { from: string; to: string },
): Promise<PushOutcome | null> {
  const prepared = await inSession(async (client) => {
    const first = await firstSellableDate(client, hotelId);
    if (!first) return null;
    const from = window ? (window.from < first ? first : window.from) : first;
    const to = window ? window.to : addDays(first, WINDOW_DAYS - 1);
    if (to < from) return null;
    const snapshot = await readAri(client, hotelId, from, to);
    if (!snapshot) return null;

    const summary = ariCells(snapshot, policy);
    let cells = summary.cells;
    if (kind === "changes") {
      const { rows } = await client.query<{ room_type_id: string; meal_plan: string; for_date: string; value: string }>(
        `select room_type_id::text, meal_plan, for_date::text, value::text
           from channel_ari_sent where hotel_id = $1 and for_date between $2 and $3`,
        [hotelId, from, to]);
      const sent = new Map(rows.map((r) => [
        cellKey({ roomTypeId: r.room_type_id, mealPlan: r.meal_plan === "-" ? null : r.meal_plan, date: r.for_date }),
        canonical(JSON.parse(r.value)),
      ]));
      cells = cells.filter((c) => sent.get(cellKey(c)) !== canonical(c.value));
    }
    return { from, to, suHotelId: snapshot.suHotelId, summary, cells };
  });
  if (!prepared) return null;

  const { from, to, suHotelId, summary, cells } = prepared;
  const requests = ariRequests(suHotelId, cells);
  const results: PushOutcome["results"] = [];

  for (const request of requests) {
    const sent = await su.post<{ TicketId?: string | number }>(SU_ENDPOINTS.availability, request.payload);
    if (sent.ok) {
      const ticket = sent.data?.TicketId != null ? String(sent.data.TicketId) : null;
      results.push({ ok: true, ticketId: ticket, reason: null });
      await inSession((client) => recordSent(client, hotelId, request.cells));
    } else {
      results.push({ ok: false, ticketId: null, reason: sent.reason });
      /* The keys, SU's hourly limit or no answer: the next request meets the same. */
      if (sent.kind !== "refused") break;
    }
  }

  const ok = results.every((r) => r.ok) && results.length === requests.length;
  const reason = requests.length === 0
    ? "Nothing to send: SU already has what the PMS says."
    : ok
      ? `SU accepted ${requests.length} request${requests.length === 1 ? "" : "s"} for ${cells.length} dates.`
      : results.find((r) => !r.ok)?.reason ?? "Not every request reached SU.";

  await inSession((client, staffId) => client.query(
    `insert into channel_ari_pushes
       (hotel_id, kind, started_by, window_from, window_to, requests, dates, ok, result,
        ticket_ids, unpriced, rack_only)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [hotelId, kind, staffId, from, to, requests.length, cells.length, ok, reason,
     results.flatMap((r) => (r.ticketId ? [r.ticketId] : [])),
     summary.unpricedDates, summary.rackOnlyDates]));

  return {
    ok, kind, from, to, requests: requests.length, dates: cells.length,
    unpricedDates: summary.unpricedDates, rackOnlyDates: summary.rackOnlyDates,
    results, reason,
  };
}

async function recordSent(client: Client, hotelId: string, cells: AriCell[]): Promise<void> {
  if (cells.length === 0) return;
  await client.query(
    `insert into channel_ari_sent (hotel_id, room_type_id, meal_plan, for_date, value, sent_at)
     select $1, c.room_type_id, c.meal_plan, c.for_date, c.value, now()
       from jsonb_to_recordset($2::jsonb)
            as c(room_type_id uuid, meal_plan text, for_date date, value jsonb)
     on conflict (hotel_id, room_type_id, meal_plan, for_date) do update
        set value = excluded.value, sent_at = excluded.sent_at`,
    [hotelId, JSON.stringify(cells.map((c) => ({
      room_type_id: c.roomTypeId, meal_plan: c.mealPlan ?? "-", for_date: c.date, value: c.value,
    })))]);
}

/* jsonb does not keep key order, so a value read back is compared by its
   keys sorted, not by the text it was written as. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
