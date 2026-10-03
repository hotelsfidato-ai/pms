import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { CATCH_UP_FROM, CATCH_UP_UNTIL, REMIND_FROM } from "./jobs.ts";
import { REPORT_TITLES } from "./reportEmails.ts";

/* ══════════════════════════════════════════════════════════════════
   SETTINGS → MESSAGES (Settings phase 6; the owner's D27-261)

     GET  /:code/guest-message-settings         each switchable message, on or
                                                off here, and the reminder's timing
     PUT  /:code/guest-message-settings/:kind   switch one; the reminder's days
                                                (1 to 7) and the time it starts
     GET  /:code/report-emails                  the six reports, the hotel's
                                                people, and who gets which
     PUT  /:code/report-emails                  who gets which, as a whole

   The owner, an administrator or the GM (the role gate's room_config; the
   database's app.manages_hotel). No saved switch is today's behaviour: on,
   the reminder 1 day before from 10:00 - the invoice off until switched on.
   The check-in code and the desk's check-in link have no switch (Q1).
   ══════════════════════════════════════════════════════════════════ */

export const messageSettings = new Hono<{ Variables: { subject: string } }>();

export const SWITCHES = [
  { kind: "booking-confirmation", label: "Booking confirmation", on: true,
    when: "At once when a booking is confirmed, on WhatsApp and by email." },
  { kind: "booking-voucher", label: "Voucher PDF on WhatsApp", on: true,
    when: "Right after the confirmation, on WhatsApp." },
  { kind: "arrival-reminder", label: "Reminder before arrival", on: true,
    when: "Before arrival, at the time below, one way." },
  { kind: "invoice", label: "Tax invoice", on: false,
    when: "When the invoice is issued, on WhatsApp and by email. Only invoices issued after it is switched on." },
  { kind: "review", label: "Review request", on: true,
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
      kind: string; is_on: boolean; days_before: number | null; send_from: string | null;
      switched_on_at: string | null; changed_by: string | null; changed_at: string;
    }>(
      `select s.kind, s.is_on, s.days_before, to_char(s.send_from, 'HH24:MI') as send_from,
              s.switched_on_at, p.full_name as changed_by, s.changed_at
         from guest_message_settings s left join staff p on p.id = s.changed_by
        where s.hotel_id = $1`, [hotelId]);
    const saved = new Map(rows.map((r) => [r.kind, r]));
    return {
      messages: SWITCHES.map((m) => {
        const s = saved.get(m.kind);
        return {
          kind: m.kind, label: m.label, when: m.when,
          isOn: s ? s.is_on : m.on,
          ...(m.kind === "arrival-reminder"
            ? { daysBefore: s?.days_before ?? 1, sendFrom: s?.send_from ?? REMIND_FROM } : {}),
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
  const reminder = kind === "arrival-reminder";
  const days = input["daysBefore"];
  const from = input["sendFrom"];
  if (!reminder && (days !== undefined || from !== undefined)) {
    return c.json({ error: "Only the reminder has a timing." }, 400);
  }
  if (days !== undefined && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 7)) {
    return c.json({ error: "The reminder goes 1 to 7 days before arrival." }, 400);
  }
  if (from !== undefined && !(typeof from === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(from))) {
    return c.json({ error: "The time it starts is HH:MM, for example 10:00." }, 400);
  }
  const done = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return false;
    /* THE INVOICE'S MOMENT: set each time it goes from off to on, so an
       invoice issued while it was off never goes by itself (Q3). */
    await client.query(
      `insert into guest_message_settings
         (hotel_id, kind, is_on, days_before, send_from, switched_on_at, changed_by, changed_at)
       values ($1, $2, $3, $4, $5::time, case when $2 = 'invoice' and $3 then now() end, $6, now())
       on conflict (hotel_id, kind) do update set
         is_on = excluded.is_on,
         days_before = coalesce(excluded.days_before, guest_message_settings.days_before),
         send_from = coalesce(excluded.send_from, guest_message_settings.send_from),
         switched_on_at = case
           when excluded.kind = 'invoice' and excluded.is_on and not guest_message_settings.is_on then now()
           else guest_message_settings.switched_on_at end,
         changed_by = excluded.changed_by, changed_at = now()`,
      [hotelId, kind, input["isOn"], days ?? null, from ?? null, session.staffId]);
    return true;
  });
  return done ? c.json({ ok: true }) : c.json(NO_SUCH, 404);
});

messageSettings.get("/:code/report-emails", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return null;
    const { rows: people } = await client.query<{ id: string; name: string; email: string }>(
      `select s.id::text, s.full_name as name, s.email::text as email
         from staff s
        where s.is_active
          and (s.is_group_admin or exists (select 1 from staff_hotels sh
                                            where sh.staff_id = s.id and sh.hotel_id = $1))
        order by s.full_name`, [hotelId]);
    const { rows: chosen } = await client.query<{ report: string; staff_id: string }>(
      "select report, staff_id::text from report_emails where hotel_id = $1 order by report", [hotelId]);
    return {
      reports: Object.entries(REPORT_TITLES).map(([key, title]) => ({ key, title })),
      people,
      chosen: chosen.map((r) => ({ report: r.report, staffId: r.staff_id })),
    };
  });
  return body ? c.json(body) : c.json(NO_SUCH, 404);
});

messageSettings.put("/:code/report-emails", async (c) => {
  const input = await c.req.json<{ chosen?: unknown }>().catch(() => ({}) as { chosen?: unknown });
  const list = Array.isArray(input.chosen) ? input.chosen : null;
  if (!list || list.some((x) => typeof x !== "object" || x === null
    || !(String((x as Record<string, unknown>)["report"]) in REPORT_TITLES)
    || typeof (x as Record<string, unknown>)["staffId"] !== "string")) {
    return c.json({ error: "A list of reports and people, please." }, 400);
  }
  const wanted = list as { report: string; staffId: string }[];
  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelManaged(client, c.req.param("code"));
    if (!hotelId) return 404 as const;
    /* Only the hotel's own people: their sign-in email, nobody typed (Q7). */
    const { rows: ok } = await client.query<{ id: string }>(
      `select s.id::text from staff s
        where s.id = any($2::uuid[]) and s.is_active
          and (s.is_group_admin or exists (select 1 from staff_hotels sh
                                            where sh.staff_id = s.id and sh.hotel_id = $1))`,
      [hotelId, [...new Set(wanted.map((w) => w.staffId))].filter((id) => /^[0-9a-f-]{36}$/i.test(id))]);
    const allowed = new Set(ok.map((r) => r.id));
    if (wanted.some((w) => !allowed.has(w.staffId))) return 400 as const;
    await client.query(
      `delete from report_emails e where e.hotel_id = $1
          and not exists (select 1 from jsonb_to_recordset($2::jsonb) as w(report text, "staffId" uuid)
                           where w.report = e.report and w."staffId" = e.staff_id)`,
      [hotelId, JSON.stringify(wanted)]);
    await client.query(
      `insert into report_emails (hotel_id, report, staff_id, added_by)
       select $1, w.report, w."staffId", $3
         from jsonb_to_recordset($2::jsonb) as w(report text, "staffId" uuid)
       on conflict do nothing`,
      [hotelId, JSON.stringify(wanted), session.staffId]);
    return 200 as const;
  });
  if (result === 404) return c.json(NO_SUCH, 404);
  if (result === 400) return c.json({ error: "Only this hotel's own people can be chosen." }, 400);
  return c.json({ ok: true });
});
