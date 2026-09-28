import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { connected } from "./sync.ts";

/* ══════════════════════════════════════════════════════════════════
   LEADS AND WHATSAPP, READ ONLY (D27-100, D27-168)

     GET /:code/leads       the hotel's leads, newest message first,
                            and whether the leads app is connected
     GET /:code/leads/:id   one lead: its conversation, the link to
                            reply in the leads app, and what New
                            booking pre-fills from it

   WHO is the role gate's before this runs (roleGate.ts READ_RULES,
   `customer` view: whoever may see guests), and the database's behind
   it: `leads` answers only the hotels the person works at. Nothing here
   writes; the sync is the only writer (sync.ts, app.leads_apply).

   `:id` is the PMS's own id. The app's id holds the guest's number, so
   it never leaves the server except inside the link back to the app.
   ══════════════════════════════════════════════════════════════════ */

export const leads = new Hono<{ Variables: { subject: string } }>();

/** How many leads the list carries: the newest by last message.
    ponytail: a fixed window; page by last_message_at if a hotel's
    active leads outgrow it. */
export const LIST_LIMIT = 500;

const HOTEL = "select id from hotels where code = upper($1) and id in (select app.auth_hotel_ids())";

const LEAD_COLUMNS = `id, name, phone, status, category, source, campaign_id as "campaignId",
  booking_ref as "bookingRef", booking_value::text as "bookingValue", do_not_contact as "doNotContact",
  received_at as "receivedAt", last_message_at as "lastMessageAt", last_message as "lastMessage"`;

leads.get("/:code/leads", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    const hotel = await client.query<{ id: string }>(HOTEL, [c.req.param("code")]);
    if (hotel.rowCount !== 1) return null;
    const rows = await client.query(
      `select ${LEAD_COLUMNS} from leads where hotel_id = $1
        order by last_message_at desc nulls last limit ${LIST_LIMIT}`, [hotel.rows[0]!.id]);
    const sync = await client.query<{ last_run: Date | null; last_error: string | null }>(
      "select last_run, last_error from app.leads_sync_state()");
    return { leads: rows.rows, lastRead: sync.rows[0]?.last_run ?? null, lastError: sync.rows[0]?.last_error ?? null };
  });
  if (!found) return c.json({ error: "No such property." }, 404);
  return c.json({ connected: connected(), ...found });
});

leads.get("/:code/leads/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "No such lead." }, 404);
  const found = await withSession(c.get("subject"), async (client) => {
    const hotel = await client.query<{ id: string }>(HOTEL, [c.req.param("code")]);
    if (hotel.rowCount !== 1) return undefined;
    const lead = await client.query<Record<string, unknown> & { remote_id: string }>(
      `select ${LEAD_COLUMNS}, remote_id from leads where hotel_id = $1 and id = $2`, [hotel.rows[0]!.id, id]);
    if (lead.rowCount !== 1) return null;
    const messages = await client.query(
      "select direction, kind, body, at from lead_messages where lead_id = $1 order by at, remote_id", [id]);
    const { remote_id, ...rest } = lead.rows[0]!;
    const app = process.env["M2R_APP_URL"]?.trim().replace(/\/+$/, "");
    return { ...rest, messages: messages.rows, replyUrl: app ? `${app}/inbox/${encodeURIComponent(remote_id)}` : null };
  });
  if (found === undefined) return c.json({ error: "No such property." }, 404);
  if (found === null) return c.json({ error: "No such lead." }, 404);
  return c.json(found);
});
