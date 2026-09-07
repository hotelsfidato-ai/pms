import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { startListening, stopListening, isListening } from "../src/realtime.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LIVE CHANNEL

   The kitchen polled every ten seconds and a background tab was
   throttled to about a minute. This proves the replacement actually
   carries a change, and — more importantly — that it carries it to the
   right property and no further.

   WHAT IS ASSERTED

     · the stream opens and says whether it is genuinely live
     · a change to an order reaches a watcher of THAT hotel
     · a change at another hotel reaches nobody here
     · a property the caller cannot see is a 404, not an open stream
       that never speaks
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;

beforeAll(async () => {
  const db = await admin();
  try {
    const { rows } = await db.query<{ id: string }>(
      "select firebase_uid as id from staff where email = 'owner@fidato.in'",
    );
    ownerId = rows[0]!.id;
  } finally {
    await db.end();
  }

  startListening();
  /* The listener connects asynchronously. Waiting for it rather than
     sleeping a fixed amount: a fixed sleep is how a test becomes a
     coin flip on a slow machine. */
  for (let i = 0; i < 100 && !isListening(); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
});

afterAll(async () => {
  await stopListening();
  await closePool();
});

/**
 * Open the stream and collect frames until `want` arrives or time runs
 * out. Returns everything seen, so a failure can say what DID come.
 */
async function listen(
  code: string, want: string, ms: number,
  during?: () => Promise<void>,
): Promise<{ status: number; frames: string }> {
  const controller = new AbortController();
  const res = await app.request(`/api/hotels/${code}/live`, {
    headers: { "x-dev-staff-id": ownerId },
    signal: controller.signal,
  });

  if (res.status !== 200 || !res.body) {
    controller.abort();
    return { status: res.status, frames: "" };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let frames = "";
  const deadline = Date.now() + ms;

  /* Read the first frame before acting, so the watcher is registered.
     Acting first is a race the test would lose on a fast machine and
     win on a slow one, which is worse than failing. */
  const first = await reader.read();
  if (first.value) frames += decoder.decode(first.value, { stream: true });

  if (during) await during();

  while (Date.now() < deadline && !frames.includes(want)) {
    const timer = new Promise<null>((r) =>
      setTimeout(() => r(null), Math.max(0, deadline - Date.now())));
    const chunk = await Promise.race([reader.read(), timer]);
    if (!chunk) break;
    if (chunk.done) break;
    if (chunk.value) frames += decoder.decode(chunk.value, { stream: true });
  }

  controller.abort();
  await reader.cancel().catch(() => {});
  return { status: 200, frames };
}

describe("the live channel", () => {
  it("opens, and says whether it is genuinely live", async () => {
    const { status, frames } = await listen("5EL", "event: ready", 3_000);
    expect(status).toBe(200);
    expect(frames).toContain("event: ready");
    expect(frames).toContain('"live":true');
  });

  it("carries a change made to an order at that property", async () => {
    /* ⚠ THIS FIRST ASKED THE FIXTURE FOR AN ORDER TO TOUCH, and a
       freshly built test database has no POS orders at all. The update
       matched nothing, fired nothing, and the test failed for a reason
       that had nothing to do with the channel. A test must not depend
       on data it did not create.

       It makes its own order and removes it. INSERT fires the same
       trigger as UPDATE, which is the thing being proved: the
       notification comes from the ROW, so no endpoint can be written
       that forgets to publish. */
    let orderId: string | null = null;

    const { frames } = await listen("5EL", "event: changed", 8_000, async () => {
      const db = await admin();
      try {
        const { rows } = await db.query<{ id: string }>(
          `insert into pos_orders
             (hotel_id, outlet_id, order_no, business_date, opened_by)
           select h.id, o.id, 'LIVE-TEST-' || floor(random()*100000)::text,
                  app.business_date(h.id), s.id
             from hotels h
             join pos_outlets o on o.hotel_id = h.id
             join staff s on s.email = 'owner@fidato.in'
            where h.code = '5EL'
            limit 1
           returning id::text`,
        );
        orderId = rows[0]?.id ?? null;
        expect(orderId, "5EL needs a POS outlet for this test").toBeTruthy();
      } finally {
        await db.end();
      }
    });

    const db = await admin();
    try {
      if (orderId) {
        await db.query("delete from pos_orders where id = $1", [orderId]);
      }
    } finally {
      await db.end();
    }

    expect(frames, frames).toContain("event: changed");
  });

  it("does NOT carry another property's change", async () => {
    /* The isolation this channel has to hold. It carries only a hotel
       id and the client re-reads under RLS, so a leak here costs a
       needless refetch rather than data — but a screen refreshing every
       time any hotel in the group rings up a coffee is its own fault,
       and at seven properties it would be constant. */
    const { frames } = await listen("5EL", "event: changed", 2_500, async () => {
      const db = await admin();
      try {
        await db.query(
          "select pg_notify('pos_changed', '11111111-2222-3333-4444-555555555555')",
        );
      } finally {
        await db.end();
      }
    });
    expect(frames, frames).not.toContain("event: changed");
  });

  it("refuses a property that does not exist, rather than hanging open", async () => {
    const res = await app.request("/api/hotels/ZZZ/live", {
      headers: { "x-dev-staff-id": ownerId },
    });
    expect(res.status).toBe(404);
  });
});
