import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { lockFor, type LockAnswer, type LockDriver } from "./locks.ts";

/* ══════════════════════════════════════════════════════════════════
   KEY CARDS, RECORDED AGAINST THE STAY (D27-178)

   GET  /:code/stays/:id/keys   the stay's record, and the cards live now
   POST /:code/stays/:id/keys   cut cards: { cards, lost? }

   THE ROOM AND THE VALIDITY COME FROM HERE, never from the screen: the room
   the stay holds tonight, and the booking's departure date at the
   property's check-out time. A card that opens a door is not a field in a
   POST body anybody can send.

   A LOST CARD is a cancel and a new issue in one go. The new issue is what
   stops the lost card on an offline lock (a newer card, used at the door);
   the cancel is what stops it at once on an online one.

   Every act is recorded, the lock system's refusals too: "tried at 22:01,
   the encoder did not answer" is what the next clerk needs to read.
   ══════════════════════════════════════════════════════════════════ */

export const keys = new Hono<{ Variables: { subject: string } }>();

/** ponytail: the owner's cap is question Q4 (30 Sep); 4 is the recommendation. */
export const MAX_CARDS = 4;

type Why = "check_in" | "reissue" | "lost" | "check_out" | "move";
type Live = { room_id: string; room: string; cards: number; valid_until: Date };

const refuse = (reason: string) => ({ ok: false as const, reason });

/** The stay's cards that open a door now: its last act the lock accepted,
    when that act was an issue. */
async function liveCards(client: Client, stayId: string): Promise<Live | null> {
  const { rows } = await client.query<Live & { act: string }>(
    `select k.act, k.room_id::text, rm.number as room, k.cards, k.valid_until
       from key_cards k join rooms rm on rm.id = k.room_id
      where k.reservation_id = $1 and k.outcome = 'done'
      order by k.id desc limit 1`, [stayId]);
  return rows[0]?.act === "issue" ? rows[0] : null;
}

/** Asks the lock system and never throws: a lock that is down is an answer. */
async function ask(call: () => Promise<LockAnswer>): Promise<LockAnswer> {
  try {
    return await call();
  } catch (e) {
    return { ok: false, answer: (e as Error)?.message || "The lock system did not answer." };
  }
}

async function record(client: Client, r: {
  hotelId: string; stayId: string; roomId: string; act: "issue" | "cancel"; why: Why;
  lock: LockDriver; said: LockAnswer; cards?: number; until?: Date;
}) {
  await client.query(
    `insert into key_cards (hotel_id, reservation_id, room_id, act, cards, valid_until,
                            why, outcome, answer, driver)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [r.hotelId, r.stayId, r.roomId, r.act, r.cards ?? null, r.until ?? null, r.why,
     r.said.ok ? "done" : "failed", r.said.answer.slice(0, 500), r.lock.name]);
}

/* ── For the front desk: the one call at check-out, a move and an exchange ──
   Cancels the stay's live cards when they no longer open the room the stay
   holds tonight: the guest has checked out, or moved (or swapped) from
   tonight. A move for a later night leaves them, and so does a stay with
   no cards, so the callers ask nothing first.

   NEVER STOPS THE CALLER. A lock system that refuses or is down is recorded
   as "failed" and the check-out goes ahead: an offline lock stops the card
   anyway when the next guest's card is used at the door. Called inside the
   caller's transaction, after its last refusal (root MEMORY 243). */
export async function cancelStaleKeys(client: Client, hotelId: string, stayId: string): Promise<void> {
  const live = await liveCards(client, stayId);
  if (!live) return;

  const { rows } = await client.query<{ code: string; reference: string; out: boolean; still: boolean }>(
    `select h.code, r.reference, r.status <> 'checked_in' as out,
            app.room_for(r.id, app.business_date(r.hotel_id)) is not distinct from $3 as still
       from reservations r join hotels h on h.id = r.hotel_id
      where r.hotel_id = $1 and r.id = $2`, [hotelId, stayId, live.room]);
  const stay = rows[0];
  if (!stay || (!stay.out && stay.still)) return;

  /* Switched off since the cards were cut: there is nobody to ask. */
  const lock = lockFor(stay.code);
  if (!lock) return;

  const said = await ask(() => lock.cancel({ room: live.room, stay: stay.reference }));
  await record(client, {
    hotelId, stayId, roomId: live.room_id, act: "cancel",
    why: stay.out ? "check_out" : "move", lock, said });
}

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/* The moment a card cut now for this stay should stop: its departure date
   at the property's check-out time, on the property's clock. */
const STAY_ENDS =
  `app.hotel_moment(r.hotel_id, r.check_out::text || ' ' || h.check_out_time::text)`;

keys.get("/:code/stays/:id/keys", async (c) => {
  const code = c.req.param("code");
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{ ends: Date }>(
      `select ${STAY_ENDS} as ends
         from reservations r join hotels h on h.id = r.hotel_id
        where r.hotel_id = $1 and r.id = $2`, [hotelId, stayId]);
    if (!stay[0]) return null;

    const live = await liveCards(client, stayId);
    const { rows: acts } = await client.query<{
      act: string; why: string; cards: number | null; valid_until: Date | null; room: string;
      outcome: string; answer: string | null; by: string | null; at: Date;
    }>(
      `select k.act, k.why, k.cards, k.valid_until, rm.number as room, k.outcome, k.answer,
              app.colleague_name(k.by_staff, k.hotel_id) as by, k.at
         from key_cards k join rooms rm on rm.id = k.room_id
        where k.hotel_id = $1 and k.reservation_id = $2
        order by k.id desc`, [hotelId, stayId]);

    return {
      connected: lockFor(code) !== null,
      maxCards: MAX_CARDS,
      stayEnds: stay[0].ends,
      live: live && { room: live.room, cards: live.cards, validUntil: live.valid_until },
      acts: acts.map((a) => ({
        act: a.act, why: a.why, cards: a.cards, validUntil: a.valid_until, room: a.room,
        outcome: a.outcome, answer: a.answer, by: a.by, at: a.at })),
    };
  });
  return body ? c.json(body) : c.json({ error: "No such stay." }, 404);
});

keys.post("/:code/stays/:id/keys", async (c) => {
  type Body = { cards?: unknown; lost?: unknown };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const cards = input.cards;
  if (typeof cards !== "number" || !Number.isInteger(cards) || cards < 1 || cards > MAX_CARDS) {
    return c.json(refuse(`Between 1 and ${MAX_CARDS} cards.`), 409);
  }
  const lost = input.lost === true;
  const code = c.req.param("code");

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, code);
    if (!hotelId) return null;
    const lock = lockFor(code);
    if (!lock) return refuse("No lock system is connected at this property.");
    const stayId = c.req.param("id");

    /* FOR UPDATE: two clerks cutting cards for one stay, or a lost card
       beside a check-out, take turns rather than interleave. */
    const { rows } = await client.query<{
      reference: string; status: string; room_id: string | null; room: string | null;
      until: Date; past: boolean;
    }>(
      `select r.reference, r.status, rm.id::text as room_id, rm.number as room,
              ${STAY_ENDS} as until, ${STAY_ENDS} <= now() as past
         from reservations r
         join hotels h on h.id = r.hotel_id
         left join rooms rm on rm.hotel_id = r.hotel_id
                           and rm.number = app.room_for(r.id, app.business_date(r.hotel_id))
        where r.hotel_id = $1 and r.id = $2
          for update of r`, [hotelId, stayId]);
    const stay = rows[0];
    if (!stay) return refuse("No such stay.");
    if (stay.status !== "checked_in") return refuse("Cards are cut for a guest who is checked in.");
    if (!stay.room_id || !stay.room) return refuse("This stay has no room tonight.");
    if (stay.past) {
      return refuse("This stay's departure has passed. Change its dates, or check the guest out.");
    }

    const live = await liveCards(client, stayId);
    if (lost && live) {
      const said = await ask(() => lock.cancel({ room: live.room, stay: stay.reference }));
      await record(client, {
        hotelId, stayId, roomId: live.room_id, act: "cancel", why: "lost", lock, said });
    }

    const said = await ask(() => lock.issue({
      room: stay.room!, stay: stay.reference, cards, until: stay.until }));
    await record(client, {
      hotelId, stayId, roomId: stay.room_id, act: "issue",
      why: lost ? "lost" : live ? "reissue" : "check_in", lock, said, cards, until: stay.until });

    /* A refusal still commits the record above it: that is the point. */
    return said.ok
      ? { ok: true as const, answer: said.answer }
      : refuse(`The lock system said: ${said.answer}`);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
