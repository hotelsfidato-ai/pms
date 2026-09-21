import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";
import { canSend, send, NOT_CONNECTED } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   REVIEWS - asking after check-out, and recording who was asked

   The owner's D18-14: after check-out, a message asking for a review
   with the group's own review link, and a screen showing who was asked,
   who has not been, and what came back.

   FOUR THINGS ARE TRUE OF EVERY LINE BELOW.

     THE LINK DOES NOT EXIST YET, and nothing here pretends it does.
       There is no default, no placeholder and no example Google address
       anywhere in this service. A property with no link has no row in
       `review_links` (migration 120), the screen shows a dash, and `ask`
       refuses by name BEFORE it reaches the sender - so not even a failed
       attempt is recorded for a message that could never have carried a
       link. It is the no-default-prices rule applied to a sentence.

     AFTER CHECK-OUT, NEVER BEFORE. `ask` refuses any stay that is not
       `checked_out`. A review asked of somebody still in the room is
       asked about a stay that has not finished.

     ONE DOOR OUT. Everything leaves through `api/src/sending.ts` and
       nothing else - this file never calls n8n, never holds the secret
       and never writes `messages_sent`. The sender records the attempt
       itself, and records NOTHING when nothing was attempted.

     NOTHING IS PULLED IN. No Google, no booking sites (D18-14). The
       reply column is empty at every property and the screen says so
       where a person would go looking for it. There is no route here
       that reads a review, because there is nothing to read.

   THE WORDING THE GUEST READS LIVES IN N8N. This sends `data.link` and
   `data.reference`; the sentence around them is the owner's to change
   without a deploy.
   ══════════════════════════════════════════════════════════════════ */

export const reputation = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

/* ── Who may do what ──────────────────────────────────────────────
   A COPY of `src/lib/permissions.ts`, because the server does not import
   the website's code - the shape `purchasingGrants.ts` and
   `stockGrants.ts` already use. The two are held together by
   `api/test/modules/reputation/reputation.test.ts`, which fails the moment
   they differ.

   REVIEWS SITS ON THE GUESTS PERMISSION (`customer`), the owner's answer
   of 19 September. It widens NOBODY: everybody below can already open the
   Guests screen and read the same names, numbers and stays. Three
   questions, three lists, three answers - one list would be STO-1 again. */

/** `customer: view` - who may LOOK at the screen. */
export const VIEW_ROLES: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "front_desk", "finance", "read_only",
];

/** `customer: create` - who may ASK a guest for a review. The accountant
    and a viewer read the list and send nothing. */
export const ASK_ROLES: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "front_desk",
];

/** `hotel: edit` - who may type the link in. The owner's answer of 19
    September: the same two who may edit a property. It is the group's own
    link and it goes to every departing guest, so a wrong one is wrong
    seven properties wide. */
export const LINK_ROLES: readonly string[] = ["owner", "admin"];

export const REVIEWS_REFUSED = {
  view:
    "Reviews is not open to your role. The owner, an administrator, the "
    + "general manager, the hotel manager, reception, the accountant and a "
    + "viewer can see it.",
  ask:
    "Asking a guest for a review is for the owner, an administrator, the "
    + "general manager, the hotel manager or reception.",
  link:
    "Setting this property's review link is for the owner or an "
    + "administrator. Ask one of them.",
  /* ⚠ THE SENTENCE THE WHOLE SERVICE WAS WRITTEN AROUND. It says the true
     thing - there is no link - and it names who can put one there. It
     never suggests a link, and there is none to suggest. */
  noLink:
    "This property has no review link yet, so there is nowhere to send the "
    + "guest. The owner or an administrator can add it on this screen. The "
    + "group's own review link has not been given yet.",
  notCheckedOut:
    "A guest is asked for a review after they have left, never before. This "
    + "stay has not been checked out.",
} as const;

/** Does the signed-in person hold one of these roles at this property? A
    group administrator holds everything everywhere, as they do throughout
    this system. */
async function hasRoleAt(
  client: Client, hotelId: string, roles: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ may: boolean }>(
    `select exists (
              select 1 from staff s
               where s.id = app.current_user_id() and s.is_active and s.is_group_admin
            )
         or exists (
              select 1 from staff_hotels sh
                join staff s on s.id = sh.staff_id
               where sh.staff_id = app.current_user_id()
                 and sh.hotel_id = $1
                 and s.is_active
                 and sh.role = any($2::text[])
            ) as may`,
    [hotelId, roles],
  );
  return rows[0]?.may === true;
}

async function hotelFor(client: Client, code: string) {
  const { rows } = await client.query<{
    id: string; code: string; name: string; phone: string | null;
  }>(
    "select id, code, name, phone from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0] ?? null;
}

/** The property's link, or null. NULL IS THE ANSWER, never "". */
async function linkFor(client: Client, hotelId: string) {
  const { rows } = await client.query<{
    url: string; set_at: string | null; set_by: string | null;
  }>(
    `select l.url,
            app.hotel_clock($1, l.set_at) as set_at,
            s.full_name                   as set_by
       from review_links l
       left join staff s on s.id = l.set_by
      where l.hotel_id = $1`,
    [hotelId],
  );
  return rows[0] ?? null;
}

/* A link a guest is sent is checked before it is stored, and the database
   checks it again (`review_links_is_an_https_link`). Plain http:// is
   refused with everything else: a link the hotel sends out is one the
   hotel vouches for. */
const HTTPS = /^https:\/\/\S{3,}$/;

/** How far back the list reaches. A bounded list, and the screen says the
    bound out loud rather than looking like every departure there has ever
    been. */
const DAYS_BACK = 30;

/* ══════════════════════════════════════════════════════════════════
   THE SCREEN
   Who was asked, who has not been, and what came back - one list, with
   one column filled in differently, because that is one question.
   ══════════════════════════════════════════════════════════════════ */

reputation.get("/:code/reviews", async (c) => {
  const code = c.req.param("code");

  const answer = await withSession(c.get("subject"), async (client) => {
    const hotel = await hotelFor(client, code);
    if (!hotel) return { status: 404 as const, body: { error: "No such property." } };
    if (!(await hasRoleAt(client, hotel.id, VIEW_ROLES))) {
      return { status: 403 as const, body: refuse(REVIEWS_REFUSED.view) };
    }

    const link = await linkFor(client, hotel.id);

    const { rows } = await client.query(
      `select r.id::text                                     as id,
              r.reference                                    as reference,
              to_char(r.check_in,  'YYYY-MM-DD')             as arrived,
              to_char(r.check_out, 'YYYY-MM-DD')             as departed,
              g.full_name                                    as guest,
              nullif(btrim(coalesce(g.phone, '')), '')       as phone,
              nullif(btrim(coalesce(g.email::text, '')), '') as email,
              m.status                                       as "askStatus",
              m.channel                                      as "askChannel",
              app.hotel_clock($1, m.sent_at)                 as "askedAt",
              m.detail                                       as "askDetail"
         from reservations r
         join guests g on g.id = r.guest_id
         left join lateral (
              select s.status, s.channel, s.sent_at, s.detail
                from messages_sent s
               where s.hotel_id   = r.hotel_id
                 and s.kind       = 'review'
                 and s.about_kind = 'reservation'
                 and s.about_id   = r.id::text
               order by s.sent_at desc
               limit 1
         ) m on true
        where r.hotel_id  = $1
          and r.status    = 'checked_out'
          and r.check_out >= app.hotel_day($1, now()) - $2::integer
        order by r.check_out desc, g.full_name`,
      [hotel.id, DAYS_BACK],
    );

    const connected = canSend();
    return {
      status: 200 as const,
      body: {
        link: link?.url ?? null,
        linkSetAt: link?.set_at ?? null,
        linkSetBy: link?.set_by ?? null,
        maySetLink: await hasRoleAt(client, hotel.id, LINK_ROLES),
        mayAsk: await hasRoleAt(client, hotel.id, ASK_ROLES),
        /* The screen asks this BEFORE it offers a button, so nobody
           presses one that was never going to work. */
        canSend: connected,
        notConnected: connected ? null : NOT_CONNECTED,
        daysBack: DAYS_BACK,
        departures: rows,
      },
    };
  });

  return c.json(answer.body, answer.status);
});

/* ══════════════════════════════════════════════════════════════════
   THE LINK
   No row means no link, and no link means nothing sends.
   ══════════════════════════════════════════════════════════════════ */

reputation.put("/:code/reviews/link", async (c) => {
  const code = c.req.param("code");
  const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
  const typed = typeof body.url === "string" ? body.url.trim() : "";

  const answer = await withSession(c.get("subject"), async (client) => {
    const hotel = await hotelFor(client, code);
    if (!hotel) return { status: 404 as const, body: { error: "No such property." } };
    if (!(await hasRoleAt(client, hotel.id, LINK_ROLES))) {
      return { status: 403 as const, body: refuse(REVIEWS_REFUSED.link) };
    }

    /* CLEARING IT IS ALLOWED, AND IT MEANS NOTHING SENDS. A link typed
       wrong has to be removable back to the empty state rather than only
       correctable into another wrong one. */
    if (typed === "") {
      await client.query("delete from review_links where hotel_id = $1", [hotel.id]);
      return { status: 200 as const, body: { ok: true as const, link: null } };
    }

    if (!HTTPS.test(typed)) {
      return {
        status: 400 as const,
        body: refuse(
          "A review link has to be a full web address beginning with "
          + "https://. Paste the one the guest should open."),
      };
    }

    const { rows } = await client.query<{ url: string }>(
      `insert into review_links (hotel_id, url, set_by)
            values ($1, $2, app.current_user_id())
       on conflict (hotel_id) do update
            set url = excluded.url, set_at = now(), set_by = excluded.set_by
        returning url`,
      [hotel.id, typed],
    );

    return { status: 200 as const, body: { ok: true as const, link: rows[0]!.url } };
  });

  return c.json(answer.body, answer.status);
});

/* ══════════════════════════════════════════════════════════════════
   ASKING
   ══════════════════════════════════════════════════════════════════ */

reputation.post("/:code/reviews/:id/ask", async (c) => {
  const code = c.req.param("code");
  const stayId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { channel?: unknown };
  const channel =
    body.channel === "email" ? "email"
    : body.channel === "whatsapp" ? "whatsapp"
    : null;

  if (!channel) {
    return c.json(refuse("Say whether this goes by WhatsApp or by email."), 400);
  }

  const answer = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await hotelFor(client, code);
    if (!hotel) return { status: 404 as const, body: { error: "No such property." } };
    if (!(await hasRoleAt(client, hotel.id, ASK_ROLES))) {
      return { status: 403 as const, body: refuse(REVIEWS_REFUSED.ask) };
    }

    const { rows } = await client.query<{
      id: string; reference: string; status: string;
      guest: string; phone: string | null; email: string | null;
    }>(
      `select r.id::text as id, r.reference, r.status,
              g.full_name                                    as guest,
              nullif(btrim(coalesce(g.phone, '')), '')       as phone,
              nullif(btrim(coalesce(g.email::text, '')), '') as email
         from reservations r
         join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and r.id = $2::uuid`,
      [hotel.id, stayId],
    );
    const stay = rows[0];
    if (!stay) {
      return { status: 404 as const, body: { error: "No such stay at this property." } };
    }

    /* AFTER CHECK-OUT, NEVER BEFORE. */
    if (stay.status !== "checked_out") {
      return { status: 409 as const, body: refuse(REVIEWS_REFUSED.notCheckedOut) };
    }

    /* ⚠ THE LINK IS CHECKED BEFORE THE SENDER IS TOUCHED. The sender
       writes one row per ATTEMPT; a message that could never have carried
       a link is not an attempt anybody made, and a row saying it failed
       would read as if the hotel had tried and the guest had missed it. */
    const link = await linkFor(client, hotel.id);
    if (!link) {
      return { status: 409 as const, body: refuse(REVIEWS_REFUSED.noLink) };
    }

    /* And nothing sends at all until the owner's n8n steps are done.
       Asked here as well as on the screen, because a button a screen does
       not draw is still a URL anybody can post to. */
    if (!canSend()) {
      return { status: 503 as const, body: refuse(NOT_CONNECTED) };
    }

    const result = await send(client, {
      channel,
      kind: "review",
      hotel: { id: hotel.id, code: hotel.code, name: hotel.name, phone: hotel.phone },
      to: { name: stay.guest, phone: stay.phone, email: stay.email },
      data: { link: link.url, reference: stay.reference },
      about: { kind: "reservation", id: stay.id },
      /* A clerk pressed this, so the record names them. Without it the
         Guest messages screen filed every review request under "The system"
         (audit, 21 September). */
      sentBy: { id: session.staffId, name: session.fullName },
    });

    return result.ok
      ? { status: 200 as const, body: { ok: true as const, id: result.id } }
      : { status: 502 as const, body: refuse(result.reason) };
  });

  return c.json(answer.body, answer.status);
});
