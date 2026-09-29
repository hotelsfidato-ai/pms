import { Hono, type Context } from "hono";
import { withSession } from "../../auth.ts";
import { LeadsAppError } from "./firestore.ts";
import {
  AtCap, appHotelOf, cached, campaignOf, channelOf, leadBehind, leadFrom,
  messageFrom, openReader, settings, SOURCE_BY_CHANNEL, tokenFor,
} from "./live.ts";

/* ══════════════════════════════════════════════════════════════════
   LEADS AND WHATSAPP, READ LIVE (D27-100, D27-168, D27-170)

     GET /:code/leads                 the hotel's leads, newest message
                                      first, 50 at a time (?before=)
     GET /:code/leads/:ref            one lead's conversation, and the
                                      link to reply in the leads app
     GET /:code/leads/:ref/booking    what New booking pre-fills: name,
                                      phone, booking source, campaign

   WHO is the role gate's before this runs (roleGate.ts READ_RULES,
   `customer` view: whoever may see guests, D27-170). Nothing here
   writes, and nothing read is kept beyond 60 seconds in memory (live.ts).
   `:ref` is a token (live.ts), never the app's id: that holds the
   guest's number.
   ══════════════════════════════════════════════════════════════════ */

export const leads = new Hono<{ Variables: { subject: string } }>();

/** Leads a list reads at once, and the newest messages a conversation shows. */
export const PAGE = 50;
export const THREAD = 100;

const NO_LEAD = "This enquiry is no longer in the leads app, or its link has expired. Open it again from Leads and WhatsApp.";

/** Whether the person is at this hotel: the database's answer. */
const here = (c: Context<{ Variables: { subject: string } }>, code: string) =>
  withSession(c.get("subject"), async (client) =>
    (await client.query("select 1 from hotels where code = upper($1) and id in (select app.auth_hotel_ids())", [code])).rowCount === 1);

/** A refusal from the app or the cap, in the screen's words. */
function failed(c: Context, error: unknown) {
  if (error instanceof AtCap) return c.json({ error: error.message, atCap: true }, 429);
  if (error instanceof LeadsAppError) {
    return c.json({ error: `The leads app did not answer (${error.status}). Nothing was changed there. Try again in a few minutes.` }, 502);
  }
  throw error;
}

leads.get("/:code/leads", async (c) => {
  const code = c.req.param("code");
  if (!(await here(c, code))) return c.json({ error: "No such property." }, 404);
  const s = settings();
  if (!s) return c.json({ connected: false, inApp: false, leads: [], more: null });
  const appHotel = appHotelOf(s, code);
  if (!appHotel) return c.json({ connected: true, inApp: false, leads: [], more: null });

  const before = c.req.query("before");
  if (before !== undefined && Number.isNaN(Date.parse(before))) return c.json({ error: "That is not a time." }, 400);
  try {
    const page = await cached(`list:${appHotel}:${before ?? ""}`, async () => {
      const { reader, left } = await openReader(s, "leads");
      const limit = Math.min(PAGE, left);
      const docs = await reader.query("", {
        from: [{ collectionId: "conversations" }],
        where: { fieldFilter: { field: { fieldPath: "hotelId" }, op: "EQUAL", value: { stringValue: appHotel } } },
        /* The app's own index (hotelId, lastMessageAt). */
        orderBy: [{ field: { fieldPath: "lastMessageAt" }, direction: "DESCENDING" }],
        limit,
        ...(before ? { startAt: { before: false, values: [{ timestampValue: before }] } } : {}),
      });
      const list = docs.map((d) => leadFrom(d, tokenFor(code, d.id)));
      return { leads: list, more: docs.length === limit ? list.at(-1)?.lastMessageAt ?? null : null };
    });
    return c.json({ connected: true, inApp: true, ...page });
  } catch (error) {
    return failed(c, error);
  }
});

leads.get("/:code/leads/:ref", async (c) => {
  const code = c.req.param("code");
  if (!(await here(c, code))) return c.json({ error: "No such property." }, 404);
  const s = settings();
  const id = leadBehind(code, c.req.param("ref"));
  if (!s || !id) return c.json({ error: NO_LEAD }, 404);
  try {
    const messages = await cached(`thread:${id}`, async () => {
      const { reader, left } = await openReader(s, "conversation");
      const docs = await reader.query(`conversations/${encodeURIComponent(id)}`, {
        from: [{ collectionId: "messages" }],
        orderBy: [{ field: { fieldPath: "receivedAt" }, direction: "DESCENDING" }],
        limit: Math.min(THREAD, left),
      });
      return docs.map(messageFrom).filter((m) => m !== null).reverse();
    });
    return c.json({ messages, replyUrl: s.appUrl ? `${s.appUrl}/inbox/${encodeURIComponent(id)}` : null });
  } catch (error) {
    return failed(c, error);
  }
});

leads.get("/:code/leads/:ref/booking", async (c) => {
  const code = c.req.param("code");
  if (!(await here(c, code))) return c.json({ error: "No such property." }, 404);
  const s = settings();
  const id = leadBehind(code, c.req.param("ref"));
  const appHotel = s && appHotelOf(s, code);
  if (!s || !id || !appHotel) return c.json({ error: NO_LEAD }, 404);
  try {
    /* Read again, live: an erased guest never pre-fills a booking (D27-108). */
    const { reader } = await openReader(s, "booking");
    const { found } = await reader.get([`conversations/${id}`, `hotels/${appHotel}/marketing/campaigns`]);
    const lead = found.find((d) => d.name.endsWith(`/conversations/${id}`));
    if (!lead || lead.fields["hotelId"] !== appHotel) return c.json({ error: NO_LEAD }, 404);
    const catalogue = (found.find((d) => d !== lead)?.fields["campaigns"] ?? {}) as Record<string, Record<string, unknown>>;
    const channel = channelOf(lead.fields);
    const sourceName = SOURCE_BY_CHANNEL[channel] ?? null;
    const sourceId = sourceName === null ? null : await withSession(c.get("subject"), async (client) =>
      (await client.query<{ id: string }>(
        "select id from booking_sources where lower(btrim(name)) = lower($1) and is_active", [sourceName])).rows[0]?.id ?? null);
    const { name, phone } = leadFrom(lead, "");
    return c.json({ name, phone, channel, bookingSourceId: sourceId, campaign: campaignOf(lead.fields, catalogue) });
  } catch (error) {
    return failed(c, error);
  }
});

