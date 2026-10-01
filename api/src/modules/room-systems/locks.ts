/* ══════════════════════════════════════════════════════════════════
   THE LOCK SYSTEM, WHICHEVER IT TURNS OUT TO BE (D27-178)

   Nobody has named the lock at 5 Elements yet, so the PMS talks to a
   DRIVER, and a driver is two acts: the two every hotel lock system takes
   from a PMS. Oracle's FIAS (IFC8 FIAS Specification 2.20.25, May 2022),
   which Salto, VingCard, Saflok, Onity and several budget brands speak,
   calls them KR and KD:

     issue    cut N cards for a room, valid until a moment. A NEW issue
              (FIAS key type N): cards cut before for that room stop working
     cancel   the stay's cards stop working (FIAS KD). An offline lock
              hears of it only when a newer card is used at its door

   PLUGGING IN THE REAL VENDOR IS ONE MORE ENTRY IN `DRIVERS`: a cloud API
   (Vostio, Onity CloudConnect, Ambiance Cloud), or a bridge to a small
   program at the hotel for a lock server or a USB encoder. A driver bounds
   its own calls: the check-out waits for `cancel`.

   Switched on per property by the server's settings, never by a screen:
     ROOM_SYSTEMS_DRIVER   which driver ("stand-in" is the only one today)
     ROOM_SYSTEMS_HOTELS   the property codes it serves, e.g. "5EL"
   Anything else, or nothing, is "not connected": no calls, no record.
   ══════════════════════════════════════════════════════════════════ */

export type KeyOrder = {
  /** The room number, as the lock system knows the door. */
  room: string;
  /** The booking's reference (FIAS G#). The lock needs no guest's name. */
  stay: string;
  cards: number;
  until: Date;
};

/** What the lock system said, in its own words. Never a throw. */
export type LockAnswer = { ok: boolean; answer: string };

export type LockDriver = {
  readonly name: string;
  issue(order: KeyOrder): Promise<LockAnswer>;
  cancel(order: { room: string; stay: string }): Promise<LockAnswer>;
};

/* Development and tests only: answers at once and cuts nothing. `failNext`
   makes its next answer a refusal, for the tests that prove a lock that
   says no is recorded and never stops a check-out. */
export const standIn: LockDriver & { failNext: boolean } = {
  name: "stand-in",
  failNext: false,
  async issue(o) {
    return standInSays(`${o.cards} ${o.cards === 1 ? "card" : "cards"} for room ${o.room}`);
  },
  async cancel(o) {
    return standInSays(`cards for room ${o.room} cancelled`);
  },
};

function standInSays(words: string): LockAnswer {
  if (!standIn.failNext) return { ok: true, answer: `Stand-in: ${words}.` };
  standIn.failNext = false;
  return { ok: false, answer: "Stand-in: the lock system refused, as the test asked." };
}

const DRIVERS: Readonly<Record<string, LockDriver>> = { "stand-in": standIn };

/** The lock system serving this property, or null: not connected. */
export function lockFor(code: string, e: NodeJS.ProcessEnv = process.env): LockDriver | null {
  const served = (e["ROOM_SYSTEMS_HOTELS"] ?? "").split(",").map((c) => c.trim().toUpperCase());
  if (!served.includes(code.toUpperCase())) return null;
  const name = e["ROOM_SYSTEMS_DRIVER"] ?? "";
  /* A stand-in on the live server would tell the desk a card was cut when
     none was: it is refused there, the way the test sign-ins are. */
  if (name === standIn.name && e["NODE_ENV"] === "production") return null;
  return DRIVERS[name] ?? null;
}
