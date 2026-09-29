import { createHash } from "node:crypto";

/* ══════════════════════════════════════════════════════════════════
   TELLING THE CRS THE HOTEL'S ANSWER (D27-102, D27-106)

   Confirmed, refused, or full: written into the CRS's booking register by
   a NEW workflow on the CRS's n8n (deploy/n8n/crs-pms-answer.json), which
   the salesperson already reads on the Register screen. The PMS decides
   what and when; the workflow only writes it (D27-98).

   Not a guest message, so not `sending.ts`: nothing goes to a guest and
   there is no address to send to. Its own workflow, with its own address
   and its own `x-fidato-secret`, both only in the server's settings:

     CRS_ANSWER_N8N_URL      the workflow's Production URL
     CRS_ANSWER_N8N_SECRET   its secret

   Until both are there `canTell()` is false, the reader leaves every
   answer owed, and the first run after they are set sends them.

   THE SAME ANSWER HAS THE SAME ID on every try, so the workflow writes it
   once even when the PMS never heard its first reply.
   ══════════════════════════════════════════════════════════════════ */

export interface CrsAnswer {
  /** The CRS document id, and the number the register row carries. */
  crsId: string;
  crsReference: string;
  answer: "confirmed" | "refused" | "full";
  /** The PMS's booking reference(s): the hotel's confirmation number. */
  hotelConfirmationNumber: string | null;
  /** The sentence for the register's notes. Null when nothing needs saying. */
  note: string | null;
  hotel: { code: string; name: string };
}

export type Told = { ok: true } | { ok: false; reason: string };

function target(): { url: string; secret: string } | null {
  const url = process.env["CRS_ANSWER_N8N_URL"];
  const secret = process.env["CRS_ANSWER_N8N_SECRET"];
  return url && secret ? { url, secret } : null;
}

/** The same for every try of one answer, shaped like the messaging lane's
    message ids (sending.ts messageIdFor) so both workflows read one form. */
export function answerId(a: Pick<CrsAnswer, "crsId" | "answer">): string {
  const h = createHash("sha256").update(`crs-answer:${a.crsId}:${a.answer}`, "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function post(answer: CrsAnswer): Promise<Told> {
  const to = target();
  if (!to) return { ok: false, reason: "The CRS answer workflow is not in the server's settings." };
  try {
    const reply = await fetch(to.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fidato-secret": to.secret },
      body: JSON.stringify({ messageId: answerId(answer), ...answer }),
      signal: AbortSignal.timeout(20_000),
    });
    if (reply.ok) return { ok: true };
    /* Shown on the CRS bookings screen: trimmed, and never parsed. */
    const said = (await reply.text().catch(() => "")).slice(0, 200).trim();
    return { ok: false, reason: `The CRS workflow refused it (${reply.status}). ${said}`.trim() };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.name === "TimeoutError"
        ? "The CRS workflow did not answer within twenty seconds."
        : `Could not reach the CRS workflow. ${(error as Error)?.message ?? ""}`.trim(),
    };
  }
}

let sender: ((answer: CrsAnswer) => Promise<Told>) | null = null;

/** The tests stand a sender in; nothing in `src/` calls this. */
export function useSenderForTests(next: ((answer: CrsAnswer) => Promise<Told>) | null): void {
  sender = next;
}

export const canTell = (): boolean => sender !== null || target() !== null;

export const tell = (answer: CrsAnswer): Promise<Told> => (sender ?? post)(answer);
