import { Hono } from "hono";
import { openedHere, refused, ask } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   IN-ROOM DINING, THE GUEST'S SIDE (D27-224, D27-225; the in-stay plan, A)

   Behind the code, mounted with one line in guestDoor.ts. Every route asks
   `openedHere` first and answers a refusal as an unknown link answers; each
   calls its OWN definer (migration "in-room dining"), which finds the stay
   only through app.guest_unlocked - never a wider guest_link_open.

   The guest taps: dishes, their choices and quantities; the only typing is
   one note for the order. The price on each line is worked out in the
   database, as the guest sees it, and kept (Q1).

   GET  /:token/menu                what the restaurant takes now; empty hides it
   GET  /:token/orders              the guest's own, newest first
   POST /:token/orders              { lines, note } - a submission a person accepts
   POST /:token/orders/:id/cancel   taken back while nobody has accepted it
   ══════════════════════════════════════════════════════════════════ */
export const guestDining = new Hono();

guestDining.get("/:token/menu", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{ section: string; item: Record<string, unknown> }>(
    "select * from app.guest_menu($1, $2)", [door.hash, door.unlock]);
  const sections: { name: string; items: Record<string, unknown>[] }[] = [];
  for (const r of rows) {
    let s = sections.find((x) => x.name === r.section);
    if (!s) sections.push(s = { name: r.section, items: [] });
    s.items.push(r.item);
  }
  return c.json({ sections });
});

guestDining.get("/:token/orders", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const rows = await ask<{
    id: string; basket: unknown; note: string | null; status: string;
    reason: string | null; created_at: string;
  }>("select * from app.guest_food_orders_mine($1, $2)", [door.hash, door.unlock]);
  return c.json({
    orders: rows.map((r) => ({
      id: r.id, lines: r.basket, note: r.note, status: r.status,
      reason: r.reason, createdAt: r.created_at,
    })),
  });
});

guestDining.post("/:token/orders", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<{ lines?: unknown; note?: unknown }>()
    .catch(() => ({}) as { lines?: unknown; note?: unknown });
  const note = typeof b.note === "string" ? b.note : "";
  if (!Array.isArray(b.lines) || note.length > 200) {
    return c.json({ error: "Choose a dish, and keep the note short." }, 400);
  }
  const rows = await ask<{ id: string | null }>(
    "select app.guest_food_order_make($1, $2, $3::jsonb, $4) as id",
    [door.hash, door.unlock, JSON.stringify(b.lines), note]);
  /* Unlocked, so a plain sentence is safe: the kitchen is not taking orders
     now, a dish has gone off, or three are already waiting. */
  if (!rows[0]?.id) {
    return c.json({ error: "That cannot be ordered just now. Ask the desk." }, 409);
  }
  return c.json({ id: rows[0].id });
});

guestDining.post("/:token/orders/:id/cancel", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return refused(c);
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_food_order_cancel($1, $2, $3::uuid) as ok", [door.hash, door.unlock, id]);
  if (!rows[0]?.ok) {
    return c.json({ error: "The restaurant has already answered this order." }, 409);
  }
  return c.json({ cancelled: true });
});
