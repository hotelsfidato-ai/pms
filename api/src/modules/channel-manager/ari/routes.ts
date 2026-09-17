import { Hono } from "hono";
import { withSession } from "../../../auth.ts";
import { maySetUpSuAt, SU_REFUSED } from "../access.ts";
import { suConnection } from "../su/runtime.ts";
import { hotelIdFor } from "../content/store.ts";
import { pushAri, type InSession } from "./push.ts";
import { THE_OWNERS_POLICY } from "./payloads.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 3 OF THE SU CONNECTION — RATES AND AVAILABILITY, ON DEMAND

   GET  /:code/channel-manager/availability        the last pushes and what SU said
   POST /:code/channel-manager/availability/send   { kind: "all" | "changes" }
        all      every date for a year: a hotel's first load, which SU
                 requires, or a full resend on demand
        changes  only the dates that differ from what SU was last sent

   The owner and an administrator at the hotel (D17-85), like the rest of the
   connection. Only room types and meal plans SU already has (part 2) are sent.

   "WHENEVER THEY CHANGE" is the same 'changes' push run without a person,
   every minute, for hotels switched on: `jobs.ts`. The master starts it with
   the server; the hotel names the service account it runs as
   (`channel_hotels.run_as`), because a push writes what it sent under
   row-level security, which needs somebody.

   THE LIVE ACCOUNT is used only for a hotel switched on for the channel
   manager (D17-45), as for the content.
   ══════════════════════════════════════════════════════════════════ */

export const availability = new Hono<{ Variables: { subject: string } }>();

availability.get("/:code/channel-manager/availability", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUpSuAt(client, hotelId))) return { ok: false as const, reason: SU_REFUSED };
    const { rows } = await client.query<{
      kind: string; window_from: string; window_to: string; requests: number; dates: number;
      ok: boolean; result: string; unpriced: number; rack_only: number; sent_at: string;
    }>(
      `select kind, window_from::text, window_to::text, requests, dates, ok, result,
              unpriced, rack_only, sent_at::text
         from channel_ari_pushes where hotel_id = $1 order by sent_at desc limit 10`,
      [hotelId]);
    return {
      pushes: rows.map((r) => ({
        kind: r.kind, from: r.window_from, to: r.window_to, requests: r.requests, dates: r.dates,
        ok: r.ok, result: r.result, unpricedDates: r.unpriced, rackOnlyDates: r.rack_only, at: r.sent_at,
      })),
      policy: THE_OWNERS_POLICY,
    };
  });
  if (result === null) return c.json({ error: "No such property." }, 404);
  if ("ok" in result) return c.json(result, 403);
  return c.json(result);
});

availability.post("/:code/channel-manager/availability/send", async (c) => {
  const input = await c.req.json<{ kind?: unknown }>().catch(() => ({} as { kind?: unknown }));
  const kind = input.kind === "all" ? "all" : input.kind === "changes" ? "changes" : null;
  if (!kind) {
    return c.json({ ok: false, reason: "Send all dates, or only the dates that changed." }, 409);
  }
  const subject = c.get("subject");

  const checked = await withSession(subject, async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await maySetUpSuAt(client, hotelId))) return { refused: SU_REFUSED, status: 403 as const };
    const { rows } = await client.query<{ set_up: boolean; switched_on: boolean; rooms: number; plans: number }>(
      `select exists (select 1 from channel_hotels where hotel_id = $1 and on_su) as set_up,
              app.module_enabled($1, 'channel_manager') as switched_on,
              (select count(*) from channel_room_types
                where hotel_id = $1 and is_connected and on_su = 'active')::int as rooms,
              (select count(*) from channel_rate_plans
                where hotel_id = $1 and is_connected and on_su = 'active')::int as plans`,
      [hotelId]);
    return { hotelId, ...rows[0]! };
  });
  if (checked === null) return c.json({ error: "No such property." }, 404);
  if ("refused" in checked) return c.json({ ok: false, reason: checked.refused }, checked.status);

  const su = suConnection();
  if (!su.ok) return c.json({ ok: false, reason: su.reason, missing: su.missing }, 409);
  if (su.settings.environment === "live" && !checked.switched_on) {
    return c.json({
      ok: false,
      reason: "The live SU account is used only for a hotel switched on for the channel manager, "
        + "and this hotel is not switched on. Nothing was sent.",
    }, 409);
  }
  if (!checked.set_up || checked.rooms === 0) {
    return c.json({
      ok: false,
      reason: "SU does not have this hotel and at least one of its room types yet. Send the hotel's "
        + "content to SU first.",
    }, 409);
  }

  const inSession: InSession = (fn) =>
    withSession(subject, (client, session) => fn(client, session.staffId));
  const outcome = await pushAri(inSession, su.client, checked.hotelId, kind, THE_OWNERS_POLICY);
  if (!outcome) return c.json({ error: "No such property." }, 404);
  return c.json(outcome, outcome.ok ? 200 : 502);
});
