import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiBase, authHeaders } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN HEARS THE TILL

   A waiter adds a dish and the pass sees it. Before this, the kitchen
   polled every ten seconds — and a pass screen sits in a background
   tab for most of a service, where the browser throttles timers to
   about once a minute. The board somebody turned to look at was up to
   a minute behind, which is exactly long enough to stop trusting it.

   WHY `fetch` AND NOT `EventSource`.

   The browser's own SSE client cannot send headers, and this API is
   authenticated by one. Using EventSource would mean putting the
   Firebase token in the query string — where it lands in nginx's
   access log, the browser's history and any referrer. A token in a URL
   is a token you have published. So this reads the stream by hand,
   which costs the reconnect below and keeps the credential in a
   header.

   THE POLL STAYS. Every screen using this keeps a slow refetch as a
   floor. A live channel that fails quietly is worse than no live
   channel, because nobody goes looking — they just stop believing the
   screen. `live` comes back false the moment the stream drops, so a
   screen can say so out loud.
   ══════════════════════════════════════════════════════════════════ */

/** What a change should invalidate. Every screen that reads an order,
    always — the kitchen shows the till's orders and the till shows the
    kitchen's statuses, so refreshing only one half is the same
    staleness pointing the other way.

    ⚠ THESE ARE PREFIXES AND THEY ARE MATCHED ELEMENT BY ELEMENT.
    `["till"]` does NOT match `["till-orders", …]` — the first elements
    are different strings, so React Query invalidates nothing and the
    till silently keeps its old data while the kitchen updates. Written
    from the keys the pages actually use, not from what they look like
    they should be called. */
const AFFECTED = [
  ["kitchen"],
  ["till-orders"],
  ["till-order"],
  ["floor"],
];

/** The topic a `changed` frame names. Before topics the server sent "1",
    which was always the POS — read as `orders`, so a newer screen still
    works against an older server during a deploy. */
function topicOf(frame: string): string {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  const data = line ? line.slice(5).trim() : "";
  return data === "" || data === "1" ? "orders" : data;
}

export function useLiveOrders(hotelId: string | null | undefined): {
  live: boolean;
} {
  return useLive(hotelId, "orders", AFFECTED);
}

/* ══ A SCREEN'S TOPIC (HK-1, the owner's D17-39, 17 September) ══════
   The stream says WHICH part of the hotel moved: `orders` (the POS) or
   `housekeeping` (the board). A screen invalidates its own keys only when
   its own topic moves — one reader, one reconnect and one debounce for
   every screen, never a second copy of them. */
export function useLive(
  hotelId: string | null | undefined,
  topic: string,
  keys: readonly (readonly unknown[])[],
): { live: boolean } {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  /* Held in a ref so the effect below depends on the hotel alone. With
     `live` in the dependency list the effect would tear down and
     rebuild the stream every time it changed — which is every
     reconnect, which is a loop. */
  const stopped = useRef(false);
  /* The debounce timer, held across renders so teardown cancels it. */
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* The keys by ref: a caller's array literal is a new array every render,
     and in the effect's dependencies it would rebuild the stream each time. */
  const keysRef = useRef(keys);
  keysRef.current = keys;

  useEffect(() => {
    if (!hotelId) return;

    stopped.current = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000;

    /* ⚠ DEBOUNCED, BECAUSE A WAITER TAPPING FAST IS A BURST.
       The notification fires on every row change, so six dishes added
       to a table send six events within a second -- and each one was
       invalidating four query keys on a screen the mutation's own reply
       had already updated.

       Not just wasted traffic: refetches queue behind one another, so
       the till got SLOWER the faster somebody worked, which is exactly
       backwards.

       350ms collapses a burst into one refetch -- far below the ten
       seconds this replaced, far above the gap between two taps.

       TRAILING, deliberately: the last event in a burst is the one
       whose state is worth fetching. */
    const invalidate = () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        for (const key of keysRef.current) void qc.invalidateQueries({ queryKey: key });
      }, 350);
    };

    /* On connect there is nothing to collapse, and the screen may be
       showing whatever it had when the line dropped. Straight through. */
    const invalidateNow = () => {
      for (const key of keysRef.current) void qc.invalidateQueries({ queryKey: key });
    };

    const connect = async () => {
      if (stopped.current) return;
      controller = new AbortController();

      try {
        const base = await apiBase();
        const res = await fetch(`${base}/api/hotels/${hotelId}/live`, {
          headers: await authHeaders(),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        setLive(true);
        backoff = 1_000;

        /* Whatever was missed while disconnected. Reconnecting without
           this leaves the screen showing whatever it had when the line
           went — correct-looking and wrong, which is the failure this
           file exists to remove. */
        invalidateNow();

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          /* SSE frames are separated by a blank line. Split on that and
             keep the tail — a frame can arrive in two chunks, and
             parsing half of one is how a stream appears to work and
             silently drops every other message. */
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            if (frame.includes("event: changed") && topicOf(frame) === topic) invalidate();
          }
        }
        throw new Error("stream ended");
      } catch (error) {
        if (stopped.current) return;
        /* An abort is this component going away, not a failure. */
        if (error instanceof DOMException && error.name === "AbortError") return;

        setLive(false);
        const wait = backoff;
        backoff = Math.min(backoff * 2, 30_000);
        retry = setTimeout(() => void connect(), wait);
      }
    };

    void connect();

    return () => {
      stopped.current = true;
      setLive(false);
      if (retry) clearTimeout(retry);
      if (pendingRef.current) clearTimeout(pendingRef.current);
      controller?.abort();
    };
  }, [hotelId, qc, topic]);

  return { live };
}
