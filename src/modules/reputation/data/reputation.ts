import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   REVIEWS — the seam

   Who was asked, who has not been, and what came back (D18-14).

   NOTHING COMES BACK YET, and this file has no shape for it. No Google,
   no booking sites, no rating and no reply (D18-14 again). A type with an
   empty `reviews: []` in it would be a promise the system has not made;
   the screen says out loud, where somebody would go looking, that nothing
   is pulled in.

   THE LINK IS `string | null` AND NULL IS A REAL ANSWER. The owner has
   not given the group's review link. Null draws a dash, and the button
   that would send is not offered at all - the no-default-prices rule,
   applied to a sentence rather than a figure.
   ══════════════════════════════════════════════════════════════════ */

/** One departure, and whether anybody asked them. */
export interface Departure {
  id: string;
  reference: string;
  arrived: string;
  departed: string;
  guest: string;
  /** Null where the booking carries none. The row then offers no button
      for that way, because the send would only refuse. */
  phone: string | null;
  email: string | null;
  /** Null means NOBODY HAS ASKED. Not "pending", which would read as if
      something were already on its way. */
  askStatus: "sent" | "failed" | null;
  askChannel: "whatsapp" | "email" | null;
  askedAt: string | null;
  askDetail: string | null;
  /** The group's lead room, null for a stay in no group. A group is asked
      once, at its lead (D22-10, D22-52), so the ask above is the GROUP's
      and only the lead's row may ask. */
  leadId: string | null;
  /** Null where the lead is at a property this reader cannot see. */
  leadReference: string | null;
}

export interface ReviewsPage {
  /** The property's review link, or null where nobody has set one. */
  link: string | null;
  linkSetAt: string | null;
  linkSetBy: string | null;
  maySetLink: boolean;
  mayAsk: boolean;
  /** False until the owner's n8n steps are done. Asked BEFORE a button is
      drawn, so nobody presses one that was never going to work. */
  canSend: boolean;
  /** The sentence to show where it cannot send. The server's wording, so
      the desk reads the same thing wherever it meets this. */
  notConnected: string | null;
  daysBack: number;
  departures: Departure[];
}

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

export async function getReviews(code: string): Promise<ReviewsPage> {
  return api<ReviewsPage>(`/api/hotels/${code}/reviews`);
}

/** Type one in, or clear it back to nothing by passing "". Clearing is
    not a mistake to guard against: a link typed wrong has to be removable
    back to the state that refuses to send. */
export async function setReviewLink(
  code: string, url: string,
): Promise<Result<{ link: string | null }>> {
  return call(`/api/hotels/${code}/reviews/link`, "PUT", { url });
}

/** Ask one departed guest. The server refuses a stay that has not checked
    out, a property with no link, and a sender that is not connected - each
    with its own sentence, which is what the screen shows. */
export async function askForReview(
  code: string, stayId: string, channel: "whatsapp" | "email",
): Promise<Result<{ id: string }>> {
  return call(`/api/hotels/${code}/reviews/${stayId}/ask`, "POST", { channel });
}

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const out = await api<T & { ok?: boolean }>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
