import type { Client } from "./db.ts";

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
   is what a webhook is. Every call carries `x-fidato-secret` and n8n
   drops anything without it (docs/briefs/n8n-sending.md, step 5). It
   lives ONLY in the server's settings — never in the repository, a
   screen, a test file or a chat.

   UNTIL THE OWNER HAS BUILT THE WORKFLOW, nothing sends. `canSend()` is
   false, every screen says so plainly rather than offering a button that
   fails, and NO ROW IS WRITTEN: a record of what was never attempted is
   a log of the system's own unfinished state, not of anything anybody
   did.
   ══════════════════════════════════════════════════════════════════ */

/** Read at CALL time, not at import. `api/src/env.ts` reads once and
    freezes, which is right for everything that must be true at boot —
    but these two are allowed to be absent, and the test starts a fake
    receiver on a random port and points them at it. */
export function sendingTarget(): { url: string; secret: string } | null {
  const url = process.env["N8N_SEND_URL"];
  const secret = process.env["N8N_SEND_SECRET"];
  return url && secret ? { url, secret } : null;
}

/** Whether anything can be sent at all. A screen asks this BEFORE it
    offers to send, so nobody presses a button that was never going to
    work. */
export const canSend = (): boolean => sendingTarget() !== null;

/** The sentence every screen shows where it cannot send. One wording, so
    the desk reads the same thing wherever it meets this. */
export const NOT_CONNECTED =
  "Sending is not set up yet. Bills and vouchers print and download as usual; "
  + "nothing goes by WhatsApp or email until the workflow and its secret are "
  + "in the server's settings.";

export interface SendableFile {
  /** What the guest sees the attachment called. */
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface Message {
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

export async function send(client: Client, message: Message): Promise<SendResult> {
  const target = sendingTarget();
  if (!target) return { ok: false, reason: NOT_CONNECTED };

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
    channel: message.channel,
    kind: message.kind,
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

  let status: "sent" | "failed";
  let detail: string;
  try {
    const answer = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-fidato-secret": target.secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = answer.ok ? "sent" : "failed";
    /* THE RECEIVER'S ANSWER IS SHOWN TO A CLERK, so it is trimmed to a
       sentence rather than pasted whole. It is also UNTRUSTED: it goes
       into a text column and is never parsed or executed. */
    detail = answer.ok
      ? `The receiver took it (${answer.status}).`
      : `The receiver refused it (${answer.status}). `
        + (await answer.text().catch(() => "")).slice(0, 200).trim();
  } catch (error) {
    status = "failed";
    detail = error instanceof Error && error.name === "TimeoutError"
      ? "The receiver did not answer within twenty seconds."
      : `Could not reach the receiver. ${(error as Error)?.message ?? ""}`.trim();
  }

  const { rows } = await client.query<{ id: string }>(
    `insert into messages_sent
       (hotel_id, channel, kind, to_name, to_phone, to_email,
        about_kind, about_id, document_name, document_bytes,
        status, detail, sent_by)
     values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid)
     returning id::text`,
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
