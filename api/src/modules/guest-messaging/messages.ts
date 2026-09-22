import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { canSend, NOT_CONNECTED } from "../../sending.ts";
import { channelFor, dueFromDatabase, LIMITS, type Due } from "./jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   WHAT WAS SENT TO THIS GUEST — the reading side, and nothing else

   § 4 of docs/BUILD-PLAN-2026-09-18.md, the owner's D18-11 and D18-12.

   "Did the guest get their confirmation?" is asked at the desk, the day
   after, by somebody who was not there. Migration 117 keeps one row per
   attempt so that question has an answer; this is the screen behind it.

   ⚠ THIS FILE READS `messages_sent` AND NEVER WRITES IT. The row is
   written by the sender itself (api/src/sending.ts), which is the one
   door out of this system, and by nothing else. A second writer would be
   a second account of what went.

   ⚠ AND IT IS HONEST ABOUT BEING SWITCHED OFF. Until the owner's n8n
   steps are done (docs/briefs/n8n-sending.md), `canSend()` is false,
   NOTHING has ever been sent, and the list is empty because the system
   never tried — not because anything failed. The screen says which of
   those two it is, in the sender's own words, so the desk is never left
   reading an empty table and guessing.
   ══════════════════════════════════════════════════════════════════ */

export const guestMessages = new Hono<{ Variables: { subject: string } }>();

/* ── Who may look ──────────────────────────────────────────────────
   WHAT WENT TO A GUEST IS PART OF THAT GUEST'S BOOKING, so it is filed
   under `reservation` and gives nothing away that the booking screen
   does not already show: the guest's name, their number, their address.
   Nobody gains a screen by this, which is the test the master applied
   when laundry and spa needed resources of their own and could not
   borrow one (D18-8).

   ⚠ A COPY of `grantsFor(role, "reservation")` in src/lib/permissions.ts.
   The server does not import the website's code, so the two are held
   together by this module's own grants test, which fails the moment they
   differ — the shape purchasingGrants.ts and stockGrants.ts both use. */
export const VIEW_ROLES: readonly string[] = [
  "owner", "admin", "gm", "hotel_manager", "revenue_manager", "kitchen_manager",
  "front_desk", "pos", "housekeeping", "finance", "read_only",
];

export const MESSAGES_REFUSED =
  "What was sent to a guest is part of their booking, and your role cannot "
  + "open bookings at this property.";

/** Group admins answer for every property; everybody else for the ones
    they hold a role at. The same question purchasing and the Store ask. */
export async function hasRoleAt(
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

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/** The words a clerk reads instead of the word the sender files it under.
    A kind is a word and not an enum (migration 117), so an unknown one
    shows as itself rather than being hidden. */
export const KIND_WORDS: Record<string, string> = {
  "booking-confirmation": "Booking confirmation",
  "arrival-reminder": "Before arrival",
  "guest-link-code": "Their sign-in code",
  bill: "Bill",
  voucher: "Voucher",
};

export const kindWords = (kind: string): string => KIND_WORDS[kind] ?? kind;

interface SentRow extends Record<string, unknown> {
  id: string; channel: string; kind: string;
  to_name: string | null; to_phone: string | null; to_email: string | null;
  about_kind: string | null; about_id: string | null; reference: string | null;
  document_name: string | null; document_bytes: number | null;
  sent_at: string; status: string; detail: string | null;
  sent_by: string | null; by_a_person: boolean;
}

/* ⚠ `about_id` IS TEXT AND IS NOT ALWAYS A BOOKING. Migration 117 joins
   it loosely on purpose — a folio, an invoice and a purchase order all
   land in the same column — so casting it to uuid raises on the first row
   that is none of those, and it would be somebody else's purchase order
   that took this screen down.

   ⚠ AND A GUARD BESIDE THE CAST IS NOT A GUARD. This was three conditions
   in one `where`, with the regex written before the cast, and it passed —
   until the row count changed and the same query answered 500. POSTGRES
   DOES NOT PROMISE TO EVALUATE A `where` IN THE ORDER IT IS WRITTEN; it
   may try the cast first. `case` DOES promise it (its arms are only
   evaluated when their condition holds), so the cast lives inside one.

   The regex was the second half of the same fault: `[0-9a-fA-F-]{36}` also
   accepts 36 characters of hex and dashes in any arrangement, and
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-' is one of them. It is the uuid's
   actual shape now.

   ⚠ WHETHER A PERSON SENT IT IS NOT THE SAME QUESTION as whether this
   reader can see WHO. The `staff` table is row-secured, so the join below
   answers null for a colleague the reader may not see — and a null name
   read as "the system sent it", which says nobody did something a person
   did. Found by opening the screen as housekeeping, 19 September: a
   message the owner had sent read as nobody's. `by_a_person` is the half
   that is always true, off a column on `messages_sent` this reader can
   already see — it says A person did, never which, and widens nothing.

   THE TIME IS THE PROPERTY'S OWN (migration 113). A bare timestamptz is
   the server's, and the server is not the hotel (MEMORY 297).

   (Comments stay OUT of the template literal below: a backtick quoting a
   table name inside one closes the string, and the file then fails to
   parse in a way that reads as a broken suite.) */
const A_UUID =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const SENT_SELECT = `
  select m.id::text, m.channel, m.kind,
         m.to_name, m.to_phone, m.to_email,
         m.about_kind, m.about_id, r.reference,
         m.document_name, m.document_bytes,
         app.hotel_clock(m.hotel_id, m.sent_at)::text as sent_at,
         m.status, m.detail, s.full_name as sent_by,
         m.sent_by is not null as by_a_person
    from messages_sent m
    left join staff s on s.id = m.sent_by
    left join lateral (
      select res.reference
        from reservations res
       where res.id = case
                        when m.about_kind = 'reservation' and m.about_id ~ '${A_UUID}'
                        then m.about_id::uuid
                      end
    ) r on true`;

const asMessage = (row: SentRow) => ({
  id: row.id,
  channel: row.channel,
  kind: row.kind,
  kindLabel: kindWords(row.kind),
  to: { name: row.to_name, phone: row.to_phone, email: row.to_email },
  about: row.about_kind && row.about_id
    ? { kind: row.about_kind, id: row.about_id, reference: row.reference }
    : null,
  document: row.document_name
    ? { name: row.document_name, bytes: row.document_bytes }
    : null,
  sentAt: row.sent_at,
  status: row.status,
  detail: row.detail,
  /** Their name where this reader may see it, and null otherwise - which
      is NOT the same as nobody having sent it. */
  sentBy: row.sent_by,
  byAPerson: row.by_a_person,
});

/* ── The bookings no message can reach (MSG-3) ─────────────────────
   Nothing is recorded where nothing was attempted (migration 117), so a
   booking with nowhere to send left no trace at all: the desk had no way
   to see that this guest will never get a confirmation. Read from the SAME
   answer the sweep reads and filtered by the SAME `channelFor`, so this
   lists exactly what the sweep skips - one rule, not a second copy of it.

   Listed whether or not sending is switched on: a booking fixed before the
   switch-on is a guest reached on the day. */
const whyNot = (due: Due) => due.guest.phone?.trim()
  ? "Not agreed to WhatsApp, and no email address"
  : "No telephone number and no email address";

async function unreachableAt(client: Client, hotelId: string, reservation: string | null) {
  const seen = new Map<string, {
    id: string; reference: string; guest: string; checkIn: string; why: string;
  }>();
  for (const due of await dueFromDatabase(client, LIMITS, hotelId)) {
    if (channelFor(due) || seen.has(due.reservationId)) continue;
    if (reservation && due.reservationId !== reservation) continue;
    seen.set(due.reservationId, {
      id: due.reservationId, reference: due.reference, guest: due.guest.name,
      checkIn: due.checkIn, why: whyNot(due),
    });
  }
  return [...seen.values()];
}

/* ── The list ──────────────────────────────────────────────────────
   One property, newest first, and `?reservation=<id>` for one booking —
   which is the question the desk actually asks. The index migration 117
   put on (hotel_id, about_kind, about_id) is that filter's index.

   Row level security already holds this to the reader's own properties;
   the role check above is the second half, because a housekeeper holds
   `reservation:view` and a kitchen porter does not. */
guestMessages.get("/:code/guest-messages", async (c) => {
  const reservation = c.req.query("reservation") ?? null;

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!(await hasRoleAt(client, hotelId, VIEW_ROLES))) {
      return { forbidden: MESSAGES_REFUSED };
    }

    const { rows } = reservation
      ? await client.query<SentRow>(
          `${SENT_SELECT}
            where m.hotel_id = $1 and m.about_kind = 'reservation' and m.about_id = $2
            order by m.sent_at desc limit 200`,
          [hotelId, reservation])
      : await client.query<SentRow>(
          `${SENT_SELECT}
            where m.hotel_id = $1
            order by m.sent_at desc limit 200`,
          [hotelId]);

    return {
      /* ASKED AT THE MOMENT THE SCREEN IS DRAWN, not at boot: the owner
         finishes their n8n steps and restarts the API, and this answers
         differently without a deploy. */
      connected: canSend(),
      notConnected: canSend() ? null : NOT_CONNECTED,
      messages: rows.map(asMessage),
      unreachable: await unreachableAt(client, hotelId, reservation),
    };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in body) return c.json({ ok: false, reason: body.forbidden }, 403);
  return c.json(body);
});
