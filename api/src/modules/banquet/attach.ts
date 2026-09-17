import type { PoolClient as Client } from "pg";
import { businessDateFor } from "../../businessDate.ts";

/* ══════════════════════════════════════════════════════════════════
   WHICH FUNCTIONS A RESTAURANT ORDER MAY BE ATTACHED TO

   The owner's decision of 17 September (D17-21): the restaurant's food
   reaches a banquet function's bill. The till attaches an order to a
   function (`pos_orders.event_id`, 061); this file says which functions
   it may attach one to. The owner chose the rule the same day:

     CONFIRMED     an enquiry holds nothing and has no bill to charge;
                   a cancelled function has nobody left to feed
     BILL OPEN     confirming opens it (060), and the food lands on it
     RUNNING       on the property's business date, from the day the
                   function starts to the day it ends. A three-day
                   wedding is running on each of its three days. The
                   list stays short, so the wrong wedding is hard to pick

   ONE DEFINITION, READ TWICE. The till's screen asks for the list, and
   the till's server asks `whyNotAttachable` before it writes
   `event_id`. Two queries would let the screen offer a function the
   server refuses, or the server accept one the screen never offered.

   DAYS ARE THE PROPERTY'S. A function's first and last day are read in
   the hotel's own time zone, because "running today" means today at
   the hotel. A function that ends at midnight has ended: its last day
   is the day before the stroke of twelve, not the day after it.
   ══════════════════════════════════════════════════════════════════ */

export interface AttachableFunction {
  id: string;
  reference: string;
  title: string;
  venueName: string;
  hostName: string;
  /** Local to the property, `YYYY-MM-DDTHH:MM`, as the diary sends them. */
  startsAt: string;
  endsAt: string;
}

export interface AttachableFunctions {
  /** False at a property whose banquet module is off. The till shows no
      way to attach an order there at all. */
  enabled: boolean;
  businessDate: string;
  functions: AttachableFunction[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function banquetIsOn(client: Client, hotelId: string): Promise<boolean> {
  const { rows } = await client.query<{ enabled: boolean }>(
    `select app.module_enabled($1, 'banquet') as enabled`, [hotelId]);
  return rows[0]!.enabled;
}

/* The rule itself. `$3` narrows it to one function for the check. */
const RULE = `
  select e.id::text, e.reference, e.title, v.name as venue_name, e.host_name,
         to_char(e.starts_at at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI') as starts_at,
         to_char(e.ends_at   at time zone h.timezone, 'YYYY-MM-DD"T"HH24:MI') as ends_at
    from banquet_events e
    join hotels h         on h.id = e.hotel_id
    join banquet_venues v on v.id = e.venue_id
    join folios f         on f.event_id = e.id and f.status = 'open'
   where e.hotel_id = $1
     and e.status = 'confirmed'
     and (e.starts_at at time zone h.timezone)::date <= $2::date
     and ((e.ends_at at time zone h.timezone) - interval '1 second')::date >= $2::date
     and ($3::uuid is null or e.id = $3::uuid)
   order by e.starts_at, e.title`;

/** The functions an order at this property may be attached to right now. */
export async function attachableFunctions(
  client: Client, hotelId: string,
): Promise<AttachableFunctions> {
  const businessDate = await businessDateFor(client, hotelId);
  if (!(await banquetIsOn(client, hotelId))) {
    return { enabled: false, businessDate, functions: [] };
  }

  const { rows } = await client.query<{
    id: string; reference: string; title: string; venue_name: string;
    host_name: string; starts_at: string; ends_at: string;
  }>(RULE, [hotelId, businessDate, null]);

  return {
    enabled: true,
    businessDate,
    functions: rows.map((r) => ({
      id: r.id, reference: r.reference, title: r.title,
      venueName: r.venue_name, hostName: r.host_name,
      startsAt: r.starts_at, endsAt: r.ends_at,
    })),
  };
}

/**
 * Null when an order at this property may be attached to `eventId` now;
 * otherwise the sentence to refuse with. Ask it BEFORE the first write:
 * inside `withSession` a refusal returned after a write keeps the write
 * (root MEMORY.md 243).
 */
export async function whyNotAttachable(
  client: Client, hotelId: string, eventId: string,
): Promise<string | null> {
  if (!(await banquetIsOn(client, hotelId))) {
    return "This property has no banquet hall, so an order cannot be charged to a function.";
  }
  if (!UUID.test(eventId)) return "There is no such function at this property.";

  const businessDate = await businessDateFor(client, hotelId);
  const { rows: ok } = await client.query(RULE, [hotelId, businessDate, eventId]);
  if (ok[0]) return null;

  /* Not attachable. Say which part of the rule it fails, so the person at
     the till knows whether to ask the GM to confirm it or pick another. */
  const { rows } = await client.query<{
    title: string; status: string; bill_open: boolean;
    first_day: string; last_day: string;
  }>(
    `select e.title, e.status,
            exists (select 1 from folios f
                     where f.event_id = e.id and f.status = 'open') as bill_open,
            to_char((e.starts_at at time zone h.timezone)::date, 'FMDD Mon YYYY') as first_day,
            to_char(((e.ends_at at time zone h.timezone) - interval '1 second')::date,
                    'FMDD Mon YYYY') as last_day
       from banquet_events e
       join hotels h on h.id = e.hotel_id
      where e.id = $1 and e.hotel_id = $2`,
    [eventId, hotelId]);
  const e = rows[0];

  if (!e) return "There is no such function at this property.";
  if (e.status === "cancelled") return `${e.title} is cancelled.`;
  if (e.status === "completed") return `${e.title} has finished.`;
  if (e.status !== "confirmed") {
    return `${e.title} is not confirmed yet, so it has no bill to charge. `
      + "The general manager confirms it first.";
  }
  if (!e.bill_open) return `The bill for ${e.title} is closed.`;
  return e.first_day === e.last_day
    ? `${e.title} is on ${e.first_day}, not today.`
    : `${e.title} runs from ${e.first_day} to ${e.last_day}, not today.`;
}
