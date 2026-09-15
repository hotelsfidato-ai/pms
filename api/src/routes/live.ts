import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { PoolClient as Client } from "pg";
import { withSession } from "../auth.ts";
import { watch, isListening } from "../realtime.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LIVE STREAM

   One long-lived request per screen. The screen is told that something
   in its property moved and re-reads through the ordinary endpoint —
   nothing but a signal crosses this wire, so row level security still
   decides what anybody sees. See realtime.ts for why it is built that
   way round.

   ⚠ NOT `EventSource`. The browser's own SSE client cannot send
   headers, and this API is authenticated by one — a Firebase bearer
   token, or the dev staff header. The only way to use EventSource
   would be to put the token in the query string, where it lands in
   nginx's access log, in the browser's history and in any referrer.
   A token in a URL is a token you have published.

   So the client opens this with `fetch` and reads the stream itself.
   That costs a hand-written reconnect, which is a dozen lines in
   useLiveOrders.ts, and it keeps the credential in the header where it
   belongs.
   ══════════════════════════════════════════════════════════════════ */

export const live = new Hono<{ Variables: { subject: string } }>();

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/** Long enough to be cheap, short enough to beat any idle timeout in
    front of it. nginx defaults to 60s; a proxy nobody told us about
    might be lower. */
const HEARTBEAT_MS = 20_000;

live.get("/:code/live", async (c) => {
  /* Resolve and authorise BEFORE opening the stream. `hotelFor` runs
     under the caller's own session, so a code they may not see comes
     back null and this is a 404 — the same answer every other route
     gives, rather than an open stream that never sends anything. */
  const hotelId = await withSession(c.get("subject"), (client) =>
    hotelFor(client, c.req.param("code")),
  );
  if (!hotelId) return c.json({ error: "No such property." }, 404);

  /* Proxies buffer by default and a buffered stream is not a stream —
     it arrives in one lump when the request ends, which for this one is
     never. deploy/nginx.conf turns buffering off for this path; this
     header says the same thing to anything else in the way. */
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-store");

  return streamSSE(c, async (stream) => {
    let alive = true;

    /* Said on connect so the screen can show whether it is genuinely
       live or has fallen back to its poll. A stream that is open but
       deaf — the listener lost its database connection — looks
       identical to a working one from the outside, and that is the
       failure mode worth naming rather than hiding. */
    await stream.writeSSE({
      event: "ready",
      data: JSON.stringify({ live: isListening() }),
    });

    const unwatch = watch(hotelId, () => {
      if (!alive) return;
      /* No await: this runs from the notification handler, and one slow
         socket must not hold up telling the other screens. */
      void stream
        .writeSSE({ event: "changed", data: "1" })
        .catch(() => { alive = false; });
    });

    stream.onAbort(() => {
      alive = false;
      unwatch();
    });

    /* Hold the request open. The heartbeat is a comment line, which SSE
       ignores and every proxy counts as traffic. It doubles as the way
       this loop notices the client has gone when onAbort did not
       fire — a laptop lid closing does not always produce one. */
    while (alive) {
      await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
      if (!alive) break;
      try {
        await stream.writeSSE({ event: "beat", data: String(Date.now()) });
      } catch {
        alive = false;
      }
    }

    unwatch();
  });
});
