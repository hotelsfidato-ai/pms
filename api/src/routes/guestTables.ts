import { Hono } from "hono";
import { A_UUID, ask, openedHere, refused } from "./guestDoorKit.ts";

/* ══════════════════════════════════════════════════════════════════
   A TABLE AT THE RESTAURANT, FROM THE GUEST'S PAGE (D27-221, D27-224)

     GET   /api/guest/:token/tables              what may be asked for, and what was
     POST  /api/guest/:token/tables              { outlet, night, time, party, note? }
     POST  /api/guest/:token/tables/:id/cancel   only while nobody has answered

   The door's rules (guestDoorKit.ts): `openedHere` first, `refused` for a
   refusal of the door, and every answer from a definer that finds the stay
   only through app.guest_unlocked - the restaurant is named by its code and
   the time by the slot the offer gave, never by an id the guest could pick.
   A person at the restaurant confirms or declines (pos/tableBookings.ts).
   ══════════════════════════════════════════════════════════════════ */

export const guestTables = new Hono();

guestTables.get("/:token/tables", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const offer = await ask<{ outlet: string; outlet_name: string; night: string; slots: string[] }>(
    "select outlet, outlet_name, night::text as night, slots from app.guest_table_offer($1, $2)",
    [door.hash, door.unlock]);
  const mine = await ask<{
    id: string; outlet_name: string; night: string; at_time: string; party: number;
    note: string | null; status: string; answer: string | null;
  }>(
    `select id::text, outlet_name, night::text as night, at_time, party, note, status, answer
       from app.guest_table_bookings_mine($1, $2)`,
    [door.hash, door.unlock]);
  return c.json({
    offer: offer.map((o) => ({ outlet: o.outlet, name: o.outlet_name, night: o.night, slots: o.slots })),
    bookings: mine.map((b) => ({
      id: b.id, restaurant: b.outlet_name, night: b.night, time: b.at_time, party: b.party,
      note: b.note, status: b.status, answer: b.answer,
    })),
  });
});

guestTables.post("/:token/tables", async (c) => {
  const door = await openedHere(c);
  if (!door) return refused(c);
  const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const outlet = typeof b["outlet"] === "string" ? b["outlet"] : "";
  const night = typeof b["night"] === "string" ? b["night"] : "";
  const time = typeof b["time"] === "string" ? b["time"] : "";
  const party = Number(b["party"]);
  const note = typeof b["note"] === "string" ? b["note"] : "";
  if (!/^[A-Z0-9_-]{1,20}$/i.test(outlet) || !/^\d{4}-\d{2}-\d{2}$/.test(night)
      || !/^\d{2}:\d{2}$/.test(time) || !Number.isInteger(party) || party < 1 || party > 20
      || note.length > 200) {
    return c.json({ error: "Pick a night, a time and how many of you - up to twenty." }, 400);
  }
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_table_book($1, $2, $3, $4::date, $5, $6, $7) as ok",
    [door.hash, door.unlock, outlet, night, time, party, note || null]);
  /* Unlocked, so a plain sentence is safe: the time has gone, or three are open. */
  if (!rows[0]?.ok) {
    return c.json({ error: "That table cannot be asked for now. Pick another time, or ask the desk." }, 409);
  }
  return c.json({ sent: true });
});

guestTables.post("/:token/tables/:id/cancel", async (c) => {
  const door = await openedHere(c);
  if (!door || !A_UUID.test(c.req.param("id"))) return refused(c);
  const rows = await ask<{ ok: boolean }>(
    "select app.guest_table_cancel($1, $2, $3::uuid) as ok", [door.hash, door.unlock, c.req.param("id")]);
  if (!rows[0]?.ok) {
    return c.json({ error: "The restaurant has answered this one already. Ask the desk to change it." }, 409);
  }
  return c.json({ cancelled: true });
});
