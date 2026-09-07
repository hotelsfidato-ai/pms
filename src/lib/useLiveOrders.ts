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

export function useLiveOrders(hotelId: string | null | undefined): {
  live: boolean;
} {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);

  /* Held in a ref so the effect below depends on the hotel alone. With
     `live` in the dependency list the effect would tear down and
     rebuild the stream every time it changed — which is every
     reconnect, which is a loop. */
  const stopped = useRef(false);

  useEffect(() => {
    if (!hotelId) return;

    stopped.current = false;
    let controller: AbortController | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1_000;

    const invalidate = () => {
      for (const key of AFFECTED) void qc.invalidateQueries({ queryKey: key });
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
        invalidate();

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
            if (frame.includes("event: changed")) invalidate();
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
      controller?.abort();
    };
  }, [hotelId, qc]);

  return { live };
}
