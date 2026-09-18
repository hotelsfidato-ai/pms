import { describe, it, expect, afterAll } from "vitest";
import { app, SERVICE_MOUNTS } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { inbound } from "../src/modules/channel-manager/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE GATE UNDER /api — who may pass without a person (D17-79)

   Everything under /api needs a subject, so a new route is authenticated by
   existing rather than by remembering. There are two exceptions, and each is
   a machine with its own key: /api/pos (an outside till) and /api/channel
   (SU pushing bookings, part 4).

   This file exists so the second one stays exactly one door. A router
   mounted under /api/channel by mistake would be reachable from the
   internet with no sign-in at all.
   ══════════════════════════════════════════════════════════════════ */

afterAll(async () => { await closePool(); });

describe("what passes the gate without a person", () => {
  it("is one router under /api/channel, and it is the SU door", () => {
    const channel = SERVICE_MOUNTS.filter(([prefix]) => prefix === "/api/channel");
    expect(channel).toHaveLength(1);
    expect(channel[0]![1]).toBe(inbound);
  });

  it("is one door at /api/guest, and a guest sees nothing without a link", async () => {
    /* The guest's door is the master's (routes/guestDoor.ts), not a service's,
       so it is not in SERVICE_MOUNTS - which is the point: no chat can mount a
       second thing beside it. What can be proved from out here is that the
       prefix answers ONLY about a link, and says the same nothing without one. */
    const bare = await app.request("/api/guest");
    expect([404, 405]).toContain(bare.status);

    const made_up = await app.request(`/api/guest/${"z".repeat(43)}`);
    expect(made_up.status, "a token nobody was given").toBe(404);
    const body = (await made_up.json()) as { error?: string };
    expect(body.error, "and the gate never answered for it").not.toBe("No bearer token.");
  });

  it("does not let the guest's exemption leak to a staff route that starts the same", async () => {
    /* /api/guests is the guests SERVICE - people's records - and needs a
       person. One letter apart from the guest's own door. */
    const res = await app.request("/api/hotels/5EL/guests");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(GATE);
  });

  /* THE GATE's OWN SENTENCE, not merely a 401. A request that slips past the
     gate is refused further in - by withSession, with "No active staff record
     for this account." - and that is also a 401. Asserting the status alone
     passes on a route that was never gated at all, which is exactly the bug
     this file was written for. */
  const GATE = "No bearer token.";

  it("refuses a person's route with no sign-in, as the gate", async () => {
    const res = await app.request("/api/hotels/5EL/reports/monthly-statistics");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(GATE);
  });

  it("does not let the exemption leak to a route that merely starts the same", async () => {
    /* /api/channel-manager/su is the owner's SU settings and needs a person.
       With the exemption written as a bare prefix it matched this too. */
    const res = await app.request("/api/channel-manager/su");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error?: string }).error).toBe(GATE);
  });

  it("lets SU's door answer for itself, and it refuses a push with no key", async () => {
    const res = await app.request("/api/channel/su/reservations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hotelid: "nobody", Reservations: [] }),
    });
    /* 401 because the door refused it, not because the gate did: the answer
       is SU's shape, which only the door writes. 503 is the same refusal on
       a server where the owner has not set the key yet. */
    expect([401, 503]).toContain(res.status);
    const body = (await res.json()) as { Status?: string; error?: string };
    expect(body.Status).toBe("Fail");
    expect(body.error, "the gate never answered").toBeUndefined();
  });
});
