import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { CATCH_UP_FROM, CATCH_UP_UNTIL } from "./jobs.ts";
import { canSend, NOT_CONNECTED } from "../../sending.ts";
import { DAILY_REPORTS, isDailyReport } from "./reportEmails.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES (Settings phase 6; the owner's D27-261)

     GET  /:code/guest-message-settings         each switchable message, on or
                                                off here
     PUT  /:code/guest-message-settings/:kind   switch one
     GET  /:code/report-emails                  the four daily report emails:
                                                each on or off, its addresses
     PUT  /:code/report-emails                  all four, as a whole (D27-280)

   The owner, an administrator or the GM (the role gate's room_config; the
   database's app.manages_hotel). No saved switch: the voucher and online
   check-in on (D27-281); the invoice and the review request off until
   switched on (D27-266). The voucher IS the confirmation, one
   switch for both ways; there is no reminder (D27-264). The check-in code and
   the desk's button (which resends the voucher) have no switch (Q1).
   ══════════════════════════════════════════════════════════════════ */

export const messageSettings = new Hono<{ Variables: { subject: string } }>();

export const SWITCHES = [
  { kind: "booking-voucher", label: "Booking voucher", on: true,
    when: "Once, when a booking is confirmed: the voucher PDF, on WhatsApp and by email. It carries the check-in link only while Online check-in is on." },
  { kind: "online-checkin", label: "Online check-in", on: true,
    when: "The guest's own check-in page: its link and QR code in the voucher, and the desk's Send check-in link." },
  { kind: "invoice", label: "Tax invoice", on: false,
    when: "When the invoice is issued, by email, if it is made out to the guest. "
      + "Only invoices issued after it is switched on; one made out to a company, "
      + "an agent or a booking site goes by Send invoice." },
  { kind: "review", label: "Review request", on: false,
    when: "When a clerk presses Ask for a review, after check-out." },
] as const;

const NO_SUCH = { error: "No such property, or it is not yours to set up." };

async function hotelManaged(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string; may: boolean }>(
    "select id::text, app.manages_hotel(id) as may from hotels where code = upper($1)", [code]);
  return rows[0]?.may ? rows[0].id : null;
}

messageSettings.get("/:code/guest-message-settings", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      kind: string; is_on: boolean; switched_on_at: string | null; changed_by: string | null; changed_at: string;
    }>(
      `select s.kind, s.is_on, s.switched_on_at, p.full_name as changed_by, s.changed_at
         from guest_message_settings s left join staff p on p.id = s.changed_by
        where s.hotel_id = $1`, [hotelId]);
    const saved = new Map(rows.map((r) => [r.kind, r]));
    return {
      messages: SWITCHES.map((m) => {
        const s = saved.get(m.kind);
        return {
          kind: m.kind, label: m.label, when: m.when,
          isOn: s ? s.is_on : m.on,
          ...(m.kind === "invoice" ? { switchedOnAt: s?.switched_on_at ?? null } : {}),
          changedBy: s?.changed_by ?? null, changedAt: s?.changed_at ?? null,
        };
      }),
      /* Shown, not changed (Q2): a booking made before sending began. */
      catchUp: { from: CATCH_UP_FROM, until: CATCH_UP_UNTIL },
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

messageSettings.put("/:code/guest-message-settings/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (!SWITCHES.some((m) => m.kind === kind)) return c.json({ error: "No such message." }, 404);
  const input = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (typeof input["isOn"] !== "boolean") return c.json({ error: "Say whether it is on or off." }, 400);
  const done = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return false;
    /* THE INVOICE'S MOMENT: set each time it goes from off to on, so an
       invoice issued while it was off never goes by itself (Q3). */
    await client.query(
      `insert into guest_message_settings
         (hotel_id, kind, is_on, switched_on_at, changed_by, changed_at)
       values ($1, $2, $3, case when $2 = 'invoice' and $3 then now() end, $4, now())
       on conflict (hotel_id, kind) do update set
         is_on = excluded.is_on,
         switched_on_at = case
           when excluded.kind = 'invoice' and excluded.is_on and not guest_message_settings.is_on then now()
           else guest_message_settings.switched_on_at end,
         changed_by = excluded.changed_by, changed_at = now()`,
      [hotelId, kind, input["isOn"], session.staffId]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});

/* ── Daily report emails (D27-280) ──────────────────────────────────
   Each report On/Off and its own addresses, for this hotel. No saved row:
   the night audit report on, the rest off, and no address - so nothing
   goes until somebody types one. Saved as a whole; a report whose switch
   and addresses did not change keeps who saved it and when. */

/** One address: the workflow's own test, and nothing that separates two. */
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const MOST_ADDRESSES = 20;

messageSettings.get("/:code/report-emails", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows } = await client.query<{
      report: string; is_on: boolean; addresses: string[]; changed_by: string | null; changed_at: string;
    }>(
      `select e.report, e.is_on, e.addresses, p.full_name as changed_by, e.changed_at
         from daily_report_emails e left join staff p on p.id = e.changed_by
        where e.hotel_id = $1`, [hotelId]);
    const saved = new Map(rows.map((r) => [r.report, r]));
    return {
      reports: DAILY_REPORTS.map((r) => {
        const s = saved.get(r.key);
        return {
          key: r.key, title: r.title, contains: r.contains,
          isOn: s ? s.is_on : r.on, addresses: s?.addresses ?? [],
          changedBy: s?.changed_by ?? null, changedAt: s?.changed_at ?? null,
        };
      }),
      notConnected: canSend() ? null : NOT_CONNECTED,
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

messageSettings.put("/:code/report-emails", async (c) => {
  const input = await c.req.json<{ reports?: unknown }>().catch(() => ({}) as { reports?: unknown });
  const list = Array.isArray(input.reports) ? (input.reports as Record<string, unknown>[]) : null;
  if (!list || list.some((r) => typeof r !== "object" || r === null || !isDailyReport(r["key"])
    || typeof r["isOn"] !== "boolean" || !Array.isArray(r["addresses"])
    || (r["addresses"] as unknown[]).some((a) => typeof a !== "string"))
    || new Set(list.map((r) => r["key"])).size !== list.length) {
    return c.json({ error: "A list of reports, each switched on or off with its addresses, please." }, 400);
  }
  const wanted = list.map((r) => ({
    key: r["key"] as string, isOn: r["isOn"] as boolean,
    addresses: [...new Set((r["addresses"] as string[]).map((a) => a.trim().toLowerCase()).filter(Boolean))],
  }));
  const bad = wanted.flatMap((w) => w.addresses).find((a) => !EMAIL.test(a));
  if (bad !== undefined) return c.json({ error: `"${bad}" is not an email address.` }, 400);
  if (wanted.some((w) => w.addresses.length > MOST_ADDRESSES)) {
    return c.json({ error: `At most ${MOST_ADDRESSES} addresses for one report.` }, 400);
  }
  const done = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return false;
    for (const w of wanted) {
      await client.query(
        `insert into daily_report_emails (hotel_id, report, is_on, addresses, changed_by)
         values ($1, $2, $3, $4::text[], $5)
         on conflict (hotel_id, report) do update set
           is_on = excluded.is_on, addresses = excluded.addresses,
           changed_by = excluded.changed_by, changed_at = now()
         where daily_report_emails.is_on is distinct from excluded.is_on
            or daily_report_emails.addresses is distinct from excluded.addresses`,
        [hotelId, w.key, w.isOn, w.addresses, session.staffId]);
    }
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});
