/* ══════════════════════════════════════════════════════════════════
   TELLING THE CRS THE HOTEL'S ANSWER (D27-102, D27-106)

   Confirmed, refused, or full: written into the CRS's booking register by
   a NEW workflow on the CRS's n8n (deploy/n8n/crs-pms-answer.json), which
   the salesperson already reads on the Register screen. The PMS decides
   what and when; the workflow only writes it (D27-98).

   THE SENDER IS THE MESSAGING LANE'S (D27-168 lane 1): the PMS's one way
   out to the CRS's n8n, with its own address and key. Until it lands this
   file stands in for it, and says so: `canTell()` is false, the reader
   leaves every answer owed, and the first run after the sender exists
   sends them. Swapping the stand-in is this file and nothing else.
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

let sender: ((answer: CrsAnswer) => Promise<Told>) | null = null;

/** The tests stand a sender in; nothing in `src/` calls this. */
export function useSenderForTests(next: ((answer: CrsAnswer) => Promise<Told>) | null): void {
  sender = next;
}

export const canTell = (): boolean => sender !== null;

export async function tell(answer: CrsAnswer): Promise<Told> {
  if (!sender) return { ok: false, reason: "The sender to the CRS's n8n is not built yet." };
  return sender(answer);
}
