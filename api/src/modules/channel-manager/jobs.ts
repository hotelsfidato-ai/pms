import { withUser } from "../../db.ts";
import { suConnection } from "./su/runtime.ts";
import { pushAri } from "./ari/push.ts";
import { THE_OWNERS_POLICY } from "./ari/payloads.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CHANNEL MANAGER'S JOBS — "whenever they change" (part 3)

   Once a minute, for every hotel that is due (app.channel_manager_due():
   SU has it, it is switched on for the channel manager, and it has an
   active service account to run as), a 'changes' push: what the PMS says
   for the coming year is compared with what SU last accepted, and only the
   dates that differ are sent. A booking taken at the desk, a room put out
   of service, a price typed on the Rate calendar: each reaches SU within a
   minute or so, with no trigger on another service's tables.

   STARTED BY THE SERVER, not by importing this file. `server.ts` (the
   master's) calls `jobs.start()` after the server is listening and never
   under the tests; `jobs.stop()` waits for a run in progress to finish.

   A run never overlaps the one before it: if a minute's push is still
   going, the next minute is skipped rather than stacked.

   Nothing runs while SU is not set up on the server, and nothing runs for a
   hotel that is not due, so until the master's switch and a service account
   exist this does nothing at all. Every push is logged in
   channel_ari_pushes as the service account, like the owner's.
   ══════════════════════════════════════════════════════════════════ */

export const PUSH_EVERY_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

export async function dueHotels(): Promise<Array<{ hotelId: string; runAs: string }>> {
  /* No session yet: the account to run as is what this looks up. The same
     shape as the POS key (pos.ts, outletFor): withUser with nobody, and a
     security-definer function that answers which hotel and which account,
     nothing else. */
  return withUser("", async (client) => {
    const { rows } = await client.query<{ hotel_id: string; run_as: string }>(
      "select hotel_id::text, run_as::text from app.channel_manager_due()");
    return rows.map((r) => ({ hotelId: r.hotel_id, runAs: r.run_as }));
  });
}

export async function runOnce(
  /* The hotels due. The tests hand in their own, because no hotel can be
     switched on for the channel manager until the master's switch exists. */
  listDue: () => Promise<Array<{ hotelId: string; runAs: string }>> = dueHotels,
): Promise<void> {
  const su = suConnection();
  if (!su.ok) return;

  for (const { hotelId, runAs } of await listDue()) {
    try {
      await pushAri(
        (fn) => withUser(runAs, (client) => fn(client, runAs)),
        su.client, hotelId, "changes", THE_OWNERS_POLICY,
      );
    } catch (error) {
      /* One hotel's fault does not stop the others; the next minute tries again. */
      console.error("[channel-manager] push failed for hotel", hotelId,
        error instanceof Error ? error.message : error);
    }
  }
}

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = runOnce(dueHotels)
        .catch((error) => console.error("[channel-manager] run failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, PUSH_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
