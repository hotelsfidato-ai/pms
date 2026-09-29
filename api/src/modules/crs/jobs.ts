import { withUser } from "../../db.ts";
import { crsSettings } from "./firestore.ts";
import { runHotel } from "./reader.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CRS READER'S TIMER - every five minutes (D27-168)

   For each hotel that is due (app.crs_due(): switched on, with an active
   service account), one run of reader.ts. Nothing at all runs while the
   four CRS settings are missing from the server.

   STARTED BY THE SERVER, as the channel manager's jobs are: `server.ts`
   (the master's) calls `jobs.start()` after listen and never under the
   tests. A run never overlaps the one before it.
   ══════════════════════════════════════════════════════════════════ */

export const READ_EVERY_MS = 5 * 60_000;

export async function dueHotels(): Promise<Array<{ hotelId: string; runAs: string }>> {
  return withUser("", async (client) => {
    const { rows } = await client.query<{ hotel_id: string; run_as: string }>(
      "select hotel_id::text, run_as::text from app.crs_due()");
    return rows.map((r) => ({ hotelId: r.hotel_id, runAs: r.run_as }));
  });
}

export async function runOnce(
  listDue: () => Promise<Array<{ hotelId: string; runAs: string }>> = dueHotels,
): Promise<void> {
  const settings = crsSettings();
  if (!settings) return;
  for (const { hotelId, runAs } of await listDue()) {
    try {
      await runHotel(settings, hotelId, runAs);
    } catch (error) {
      console.error("[crs] read failed for hotel", hotelId,
        error instanceof Error ? error.message : error);
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = runOnce()
        .catch((error) => console.error("[crs] run failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, READ_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    await running;
  },
};
