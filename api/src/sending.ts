import { createHash, randomUUID } from "node:crypto";
import type { Client } from "./db.ts";
import { NOTHING_SENT } from "./testHotels.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ONE DOOR OUT OF THE PMS

   Every message the hotel sends a guest — a bill, a voucher, a booking
   confirmation, a review request, an offer — leaves through this file
   and through nothing else. Three services are built on it (guest
   messaging, reviews, marketing) and none of them may call n8n itself:
   a second caller is a second set of rules about what may be sent, a
   second place the secret lives, and a second record of what went.

   THE SHAPE, and it is the owner's (D17-87): the PMS sends the DATA as
   JSON and n8n writes the message. The wording, the mailbox, the
   signature and the WhatsApp template all live in n8n, where the owner
   changes them without a deploy. This file knows nothing about them.

   THE DOCUMENT GOES WITH IT (D18-20, 18 September): the exact A4 the
   desk prints, base64 inside the same POST. Not a link — a link would
   need a public address for a private document and a token to expire,
   which is a second guest door built for a machine that is already
   sitting on this server. One POST carries it.

   THE SECRET. The webhook address is open to the internet, because that
   is what a webhook is. Every call carries `x-fidato-secret` and each
   workflow's webhook refuses anything without it (deploy/n8n/IMPORT.md).
   Each workflow has its own. They live ONLY in the server's settings -
   never in the repository, a screen, a test file or a chat.

   UNTIL THE OWNER HAS BUILT THE WORKFLOW, nothing sends. `canSend()` is
   false, every screen says so plainly rather than offering a button that
   fails, and NO ROW IS WRITTEN: a record of what was never attempted is
   a log of the system's own unfinished state, not of anything anybody
   did.
   ══════════════════════════════════════════════════════════════════ */

/* ── ONE SENDER (D27-186, 30 September) ─────────────────────────────
   The PMS runs no n8n of its own for guests. It decides what and when,
   as before; the sending is done by ONE new workflow in the CRS's n8n
   (deploy/n8n/pms-send-crs.json): the voucher, every email, and on
   WhatsApp the check-in code, the check-in link, the stay reminder and
   the review request.

   It sends from the ONE Fidato WhatsApp number (D27-101), a setting here
   and not in the workflow's file: WHATSAPP_PHONE_NUMBER_ID travels in
   every WhatsApp message as `from.phoneNumberId`.

   THE MARKET-TO-REVENUE APP'S WORKFLOW IS NOT USED FOR NOW. It sent the
   other WhatsApp messages until 30 September (D27-98); the owner keeps
   that app separate, and the PMS only shows its leads. One job of it is
   kept for the day its two settings are filled in: telling the sales
   inbox that a guest is booked (D27-104, `send` below). Without them that
   step is skipped - not tried, and not written down as failed.

   Read at CALL time, not at import. `api/src/env.ts` reads once and
   freezes, which is right for everything that must be true at boot -
   but these are allowed to be absent, and the tests start a fake
   receiver on a random port and point them at it. */
function target(urlName: string, secretName: string): { url: string; secret: string } | null {
  const url = process.env[urlName];
  const secret = process.env[secretName];
  return url && secret ? { url, secret } : null;
}
const crsTarget = () => target("CRS_N8N_URL", "CRS_N8N_SECRET");
const m2rTarget = () => target("M2R_N8N_URL", "M2R_N8N_SECRET");

const whatsappNumberId = () => process.env["WHATSAPP_PHONE_NUMBER_ID"] || null;

/** Whether anything can be sent at all: the CRS's workflow and the
    number. One answer for every screen - half a setup would send the
    emails and not the check-in code, which nobody could explain at the
    desk. A screen asks this BEFORE it offers to send, so nobody presses a
    button that was never going to work. */
export const canSend = (): boolean => crsTarget() !== null && whatsappNumberId() !== null;

/** A message id that is the same every time it is worked out from the
    same parts - the sweep's third try at one booking's confirmation is
    the SAME message as its first. The workflow drops an id it has sent
    already, so a retry after a timeout (sent, but the answer was lost)
    never reaches the guest twice. */
export function messageIdFor(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join(":"), "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The sentence every screen shows where it cannot send. One wording, so
    the desk reads the same thing wherever it meets this. */
export const NOT_CONNECTED =
  "Sending is not set up yet. Bills and vouchers print and download as usual; "
  + "nothing goes by WhatsApp or email until the sending workflow's address, its "
  + "secret and the WhatsApp number are in the server's settings.";

export interface SendableFile {
  /** What the guest sees the attachment called. */
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface Message {
  /** The same on every try of the same message (`messageIdFor`), so the
      workflow sends it once. Absent: a new message, a new id. */
  id?: string;
  /** The PMS decides per message; n8n branches on the same word. */
  channel: "whatsapp" | "email";
  /** bill, voucher, confirmation, review, offer… a word, not an enum:
      a new kind of message is not a migration. */
  kind: string;
  hotel: { id: string; code: string; name: string; phone?: string | null };
  to: { name?: string | null; phone?: string | null; email?: string | null };
  /** Everything n8n needs to write the message, as the owner asked. */
  document?: {
    number?: string | null;
    date?: string | null;
    total?: string | null;
    currency?: string | null;
    lines?: Array<{ label: string; amount: string }>;
  } | null;
  /** The A4 the desk prints (D18-20). */
  file?: SendableFile | null;
  /** Values this KIND of message needs and a document does not — the guest
      link's six-digit code is the first, read in n8n as `{{$json.data.code}}`.
      Kept as plain named strings rather than a second shape per kind: the
      wording lives in n8n, and a new kind of message should not be a change
      to this file. */
  data?: Record<string, string> | undefined;
  /** What it is about, so the desk can answer "was it sent?" */
  about?: { kind: string; id: string } | null;
  /** Null where the system sent it by itself. */
  sentBy?: { id: string; name: string } | null;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; reason: string };

/** The receiver gets twenty seconds. Beyond that a clerk is standing at a
    desk watching a spinner, and n8n taking longer than that means it is
    not going to answer at all. */
const TIMEOUT_MS = 20_000;

/** A guest without the address for the way it is going cannot be sent to.
    Said plainly, because the answer is to fill it in on the booking. */
function addressFor(message: Message): string | null {
  const to = message.channel === "whatsapp" ? message.to.phone : message.to.email;
  return to?.trim() || null;
}

/** One POST to one workflow, and what to write down about it. */
async function post(
  to: { url: string; secret: string }, body: unknown, timeoutMs: number, inWords: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const answer = await fetch(to.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fidato-secret": to.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    /* THE RECEIVER'S ANSWER IS SHOWN TO A CLERK, so it is trimmed to a
       sentence rather than pasted whole. It is also UNTRUSTED: it goes
       into a text column and is never parsed or executed. */
    return answer.ok
      ? { ok: true, detail: `The receiver took it (${answer.status}).` }
      : {
          ok: false,
          detail: `The receiver refused it (${answer.status}). `
            + (await answer.text().catch(() => "")).slice(0, 200).trim(),
        };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error && error.name === "TimeoutError"
        ? `The receiver did not answer within ${inWords} seconds.`
        : `Could not reach the receiver. ${(error as Error)?.message ?? ""}`.trim(),
    };
  }
}

/** The inbox is told first, and briefly: a guest who replies at once finds
    themselves already a booked guest. Ten seconds, because a clerk is
    waiting on the voucher behind it. */
const MARK_TIMEOUT_MS = 10_000;

export async function send(client: Client, message: Message): Promise<SendResult> {
  /* ⚠ D27-296: NOTHING LEAVES A TEST HOTEL - asked first, whatever is set up.
     Written down as the attempt's outcome (failed, in these words), so a
     sweep that counts its tries stops at its limit and the desk reads why. */
  const { rows: test } = await client.query<{ test: boolean }>(
    "select app.is_test_hotel($1::uuid) as test", [message.hotel.id]);
  if (test[0]?.test) {
    await client.query(
      `select app.record_message_sent(
         $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::integer, $11, $12, $13::uuid
       )`,
      [message.hotel.id, message.channel, message.kind,
       message.to.name ?? null, message.to.phone ?? null, message.to.email ?? null,
       message.about?.kind ?? null, message.about?.id ?? null,
       message.file?.name ?? null, message.file?.bytes.byteLength ?? null,
       "failed", NOTHING_SENT, message.sentBy?.id ?? null]);
    return { ok: false, reason: NOTHING_SENT };
  }

  if (!canSend()) return { ok: false, reason: NOT_CONNECTED };
  const crs = crsTarget()!;

  const to = addressFor(message);
  if (!to) {
    return {
      ok: false,
      reason: message.channel === "whatsapp"
        ? "This booking has no telephone number, so there is nowhere to send it."
        : "This booking has no email address, so there is nowhere to send it.",
    };
  }

  const body = {
    messageId: message.id ?? randomUUID(),
    /* The CRS workflow reads no action; "mark" is the sales inbox being
       told about a guest, below. */
    action: "send" as "send" | "mark",
    channel: message.channel,
    kind: message.kind,
    ...(message.channel === "whatsapp" ? { from: { phoneNumberId: whatsappNumberId() } } : {}),
    hotel: {
      code: message.hotel.code, name: message.hotel.name,
      phone: message.hotel.phone ?? null,
    },
    to: {
      name: message.to.name ?? null,
      phone: message.to.phone ?? null,
      email: message.to.email ?? null,
    },
    document: message.document ?? null,
    ...(message.data ? { data: message.data } : {}),
    /* base64, and named, so the workflow forwards it without knowing what
       is in it. Absent rather than null when there is no document, so a
       workflow can branch on its presence. */
    ...(message.file
      ? {
          file: {
            name: message.file.name,
            contentType: message.file.contentType,
            base64: Buffer.from(message.file.bytes).toString("base64"),
          },
        }
      : {}),
    sentBy: message.sentBy?.name ?? null,
  };

  /* A WHATSAPP STILL REACHES THE SALES INBOX when the guest replies - one
     number for both apps (D27-101) - so that inbox is told first that this
     is a booked guest, or their reply starts the greeting bot (D27-104).
     Without the document: the inbox needs the guest, not the PDF. A failed
     mark does not stop the message; it is written down.

     ONLY WHERE THE INBOX'S WORKFLOW IS SET UP (D27-186). It is not, for
     now: then nothing is asked of it, and nothing is written about it. */
  let marked = "";
  const inbox = m2rTarget();
  if (inbox && message.channel === "whatsapp") {
    const { file: _file, ...rest } = body as typeof body & { file?: unknown };
    const mark = await post(inbox, { ...rest, action: "mark" }, MARK_TIMEOUT_MS, "ten");
    if (!mark.ok) marked = ` The sales inbox was not told the guest is booked: ${mark.detail}`;
  }

  const answer = await post(crs, body, TIMEOUT_MS, "twenty");
  const status: "sent" | "failed" = answer.ok ? "sent" : "failed";
  const detail = answer.detail + marked;

  /* ⚠ THROUGH THE DEFINER FUNCTION, NOT A BARE INSERT (migration 117).
     `messages_sent` is FORCE row-secured and scoped to
     `app.auth_hotel_ids()`, which answers for a signed-in member of
     staff — and most messages have no staff behind them at all. The
     guest's own door was the first caller and was refused outright; the
     confirmation the CRS triggers, the reminder the day before and the
     review request after check-out would all have been refused the same
     way. Found by this file's own test, 19 September.

     The hotel is named by a caller that already reached the booking
     legitimately. Reading what was sent is still governed by the
     policy on the table, unchanged. */
  const { rows } = await client.query<{ id: string }>(
    `select app.record_message_sent(
       $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::integer, $11, $12, $13::uuid
     )::text as id`,
    [message.hotel.id, message.channel, message.kind,
     message.to.name ?? null, message.to.phone ?? null, message.to.email ?? null,
     message.about?.kind ?? null, message.about?.id ?? null,
     message.file?.name ?? null, message.file?.bytes.byteLength ?? null,
     status, detail.slice(0, 500), message.sentBy?.id ?? null],
  );

  return status === "sent"
    ? { ok: true, id: rows[0]!.id }
    : { ok: false, reason: detail };
}
