import { createHash, randomBytes } from "node:crypto";
import { withUser, type Client } from "../../db.ts";
import { env } from "../../env.ts";
import { canSend, send, type Message, type SendResult } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TWO MESSAGES THIS SYSTEM SENDS BY ITSELF (D18-11, D18-12)

     booking-confirmation   the booking's details and the guest's own
                            link, when a booking is confirmed
     arrival-reminder       the same link again, the day before arrival

   n8n turns these kinds into the two WhatsApp templates the owner is
   putting to Meta (docs/go-live/whatsapp-templates.md):
   booking-confirmation → `booking_confirmation`, arrival-reminder →
   `stay_reminder`. The fields each template reads are all in `data`.

   ⚠ A SWEEP, NOT A HOOK INSIDE `makeBooking`, and both halves of that
   are deliberate.

   THE OWNER ASKED FOR "CONFIRMED FROM ANYWHERE" — the desk, the CRS, a
   booking site. All of them end at the same row in `reservations`
   (api/src/modules/reservations/book.ts is the one place a booking is
   created, and the channel manager goes through it too), so a sweep
   covers every path there is, including one written next month, without
   an edit in anybody else's file.

   AND A CONFIRMATION MUST NEVER BE ABLE TO FAIL A BOOKING. A send inside
   that transaction either swallows its own failure or hangs a clerk's
   booking on an HTTP call to n8n going out to Meta. Outside it, the
   worst a bad send can do is be tried again next minute.

   The cost, said out loud: the message follows the booking by up to a
   sweep rather than leaving the instant Save is pressed.

   ⚠ NOBODY IS SIGNED IN AT THREE IN THE MORNING. `reservations`,
   `guests`, `messages_sent` and `guest_links` are all FORCE row-secured
   on `app.auth_hotel_ids()`, so the sweep reads and mints through the two
   SECURITY DEFINER functions of "what the guest is owed"
   (`app.guest_messages_due`, `app.guest_booking_link_issue`) and nothing
   else — the shape `app.record_message_sent` gave the sender.

   ⚠ NOTHING HAPPENS UNTIL IT IS SWITCHED ON (D21-76), and that takes two
   things, both in the server's settings: the owner's n8n steps
   (`canSend()`), and the owner's pace (`perSweep()`, D21-34). Without
   either, the sweep does not even ask which bookings are due and no row
   is written.
   ══════════════════════════════════════════════════════════════════ */

export const KIND = {
  confirmation: "booking-confirmation",
  reminder: "arrival-reminder",
} as const;

export type MessageKind = (typeof KIND)[keyof typeof KIND];

/* ── The owner's rules, each named so an answer is a one-line change ──

   1. D21-33 (21 September): EVERY future booking gets its confirmation,
      however long ago it was made — not the recommended 48 hours. So no
      window: null.
   2. Three attempts and no more. A number that is wrong is wrong every
      minute, and a row per minute for ever is a log of one fault.
   3. The reminder goes the day before arrival (D18-11) from this time on
      the PROPERTY's clock. RECOMMENDED, NOT DECIDED — asked of the owner
      on 22 September: without an hour it would leave at one minute past
      midnight, the first sweep of "the day before". */
export const CONFIRM_WITHIN_HOURS: number | null = null;
export const MOST_ATTEMPTS = 3;
export const REMIND_FROM = "10:00";

/** How often the sweep runs. The owner's pace is per sweep, so per minute. */
export const SWEEP_EVERY_MS = 60_000;

/** One booking owed one of the two messages, as the database answers it.
    Everything the message needs is here, because a second query per
    booking is a second thing to go wrong in a loop. */
export interface Due {
  kind: MessageKind;
  reservationId: string;
  reference: string;
  hotel: { id: string; code: string; name: string; phone: string | null };
  guest: { name: string; phone: string | null; email: string | null };
  /** The desk's "guest agreed to WhatsApp" tick (D21-72). False for a
      channel booking, and for anybody the desk did not ask. */
  whatsappAgreed: boolean;
  checkIn: string;
  checkOut: string;
  nights: number;
}

/* ── Which way it goes (D21-35, D21-72) ────────────────────────────
   WhatsApp only to a booking TICKED "guest agreed to WhatsApp" that has a
   number — Meta's own rule, that a business may start a conversation only
   with somebody who agreed. Otherwise email where there is an address.
   Never both: one message per guest.

   Neither, and NOTHING IS ATTEMPTED — so nothing is recorded, which is
   migration 117's own rule. The sender refuses the same way one step
   later; this just does not waste the call. The desk's screen lists
   those bookings (MSG-3) through this same function. */
export function channelFor(due: Due): "whatsapp" | "email" | null {
  if (due.whatsappAgreed && due.guest.phone?.trim()) return "whatsapp";
  if (due.guest.email?.trim()) return "email";
  return null;
}

/* The hotel's own way round, the way the desk writes it. The same rule as
   `reportDate` in api/src/modules/reports/document.ts, which is not on that
   service's front door; one line here rather than a request to widen a door
   for a date.
   ponytail: duplicated one-liner — fold into a shared helper if a third
   caller appears. */
const asWritten = (iso: string) => iso.split("-").reverse().join("/");

/** What n8n receives. THE WORDING IS NOT HERE: the owner writes the
    sentence in n8n and changes it without a deploy (D17-87), so this
    sends named values and no prose. Both spellings of each date go, so
    the owner drags the one their template wants instead of writing an
    expression. */
export function messageFor(due: Due, link: string): Message | null {
  const channel = channelFor(due);
  if (!channel) return null;
  return {
    channel,
    kind: due.kind,
    hotel: due.hotel,
    to: { name: due.guest.name, phone: due.guest.phone, email: due.guest.email },
    data: {
      reference: due.reference,
      guestName: due.guest.name,
      hotelName: due.hotel.name,
      checkIn: due.checkIn,
      checkOut: due.checkOut,
      checkInText: asWritten(due.checkIn),
      checkOutText: asWritten(due.checkOut),
      nights: String(due.nights),
      link,
    },
    about: { kind: "reservation", id: due.reservationId },
    /* NOBODY PRESSED A BUTTON. Migration 117 keeps `sent_by` null for
       exactly this, so the screen can say the system sent it. */
    sentBy: null,
  };
}

/** The owner's rules, as the query is asked them. PASSED rather than read
    where the query lives, so there is one place an answer lands (MEMORY
    304: a name only one file uses is a name nothing sets). */
export interface Limits {
  withinHours: number | null;
  mostAttempts: number;
  remindFrom: string;
}

export const LIMITS: Limits = {
  withinHours: CONFIRM_WITHIN_HOURS,
  mostAttempts: MOST_ATTEMPTS,
  remindFrom: REMIND_FROM,
};

/* ── The pace (D21-34) ─────────────────────────────────────────────
   On switch-on day every future booking is owed at once, and the owner
   said: spread out, soonest arrival first, at the pace the WhatsApp
   account allows — "that pace is the owner's number to give; nobody
   guesses it". So there is no default. Until the server's settings carry
   GUEST_MESSAGES_PER_MINUTE the sweep sends nothing at all, rather than
   everything at once.

   A SETTING, not a constant, because stage 3 is a switch-on and not a
   release (D21-76): the owner's number goes in beside the two sending
   settings, without a deploy. Read at call time, as `sendingTarget()`
   reads its two. */
export function perSweep(): number | null {
  const n = Number(process.env["GUEST_MESSAGES_PER_MINUTE"]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A transaction to work in. The sweep's is `withUser("")` — nobody — and
    the tests hand in their own. */
export type Run = <T>(fn: (client: Client) => Promise<T>) => Promise<T>;

/** Where the bookings come from. */
export type ListDue = (client: Client, limits: Limits) => Promise<Due[]>;

/** Mints the guest's own private page for this booking and answers the
    link. It writes a row no unsigned-in caller may write, so it too goes
    through a definer. */
export type MakeLink = (client: Client, due: Due) => Promise<string>;

interface DueRow extends Record<string, unknown> {
  kind: MessageKind; reservation_id: string; reference: string;
  hotel_id: string; hotel_code: string; hotel_name: string; hotel_phone: string | null;
  guest_name: string; guest_phone: string | null; guest_email: string | null;
  whatsapp_agreed: boolean; check_in: string; check_out: string; nights: number;
}

/** Every booking owed a message — or, given a property, that property's.
    The desk's screen asks the same question for MSG-3, so what it lists
    is exactly what the sweep would skip. */
export async function dueFromDatabase(
  client: Client, limits: Limits, hotelId: string | null = null,
): Promise<Due[]> {
  const { rows } = await client.query<DueRow>(
    `select kind, reservation_id::text, reference,
            hotel_id::text, hotel_code, hotel_name, hotel_phone,
            guest_name, guest_phone, guest_email, whatsapp_agreed,
            check_in, check_out, nights
       from app.guest_messages_due($1::integer, $2::integer, $3::time, $4::uuid)`,
    [limits.withinHours, limits.mostAttempts, limits.remindFrom, hotelId]);
  return rows.map((r) => ({
    kind: r.kind,
    reservationId: r.reservation_id,
    reference: r.reference,
    hotel: { id: r.hotel_id, code: r.hotel_code, name: r.hotel_name, phone: r.hotel_phone },
    guest: { name: r.guest_name, phone: r.guest_phone, email: r.guest_email },
    whatsappAgreed: r.whatsapp_agreed,
    checkIn: r.check_in,
    checkOut: r.check_out,
    nights: r.nights,
  }));
}

/* ── The guest's own link, for this message ────────────────────────
   The shape of the desk's own route (api/src/routes/guestDoor.ts): 32
   random bytes, and ONLY THEIR HASH reaches the database. The token lives
   in this process for one message and then in the guest's hands, and
   nowhere else.

   The address is the server's own setting, as the desk's route writes it
   (D21-60).
   ponytail: a copy of `linkFor` in guestDoor.ts, which is not exported —
   the master's file. Import it instead once it is. */
export async function linkFromDatabase(client: Client, due: Due): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { rows } = await client.query<{ made: boolean }>(
    "select app.guest_booking_link_issue($1::uuid, $2) as made",
    [due.reservationId, hash]);
  if (!rows[0]?.made) throw new Error("the booking is no longer confirmed, so it has no page");
  return `${env.corsOrigins[0] ?? "http://localhost:5173"}/g/${token}`;
}

export interface SweepResult {
  /** Bookings the database said were owed a message. */
  due: number;
  /** Messages handed to the one door out. */
  attempted: number;
  /** Of those, the ones the receiver took. */
  sent: number;
  /** Owed, but with nowhere to send, so nothing was attempted. */
  nowhereToSend: number;
}

/* ── One pass ──────────────────────────────────────────────────────
   Everything leaves through `api/src/sending.ts` and nothing else, and
   `send` records its own attempt — this file never writes `messages_sent`.

   ⚠ ONE TRANSACTION PER STEP, NOT ONE FOR THE PASS. In one transaction a
   single failed statement aborts every statement after it, and the
   rollback takes with it the record of every message already sent this
   pass — so the next minute sends them all again. The link commits on its
   own, and the send and its record commit together, booking by booking.

   ONE BOOKING'S FAULT DOES NOT STOP THE OTHERS. The next sweep tries
   again, up to MOST_ATTEMPTS, which the database counts. */
export async function runOnce(
  run: Run,
  listDue: ListDue = dueFromDatabase,
  makeLink: MakeLink = linkFromDatabase,
  sender: (client: Client, message: Message) => Promise<SendResult> = send,
): Promise<SweepResult> {
  const result: SweepResult = { due: 0, attempted: 0, sent: 0, nowhereToSend: 0 };
  const pace = perSweep();
  if (!canSend() || pace === null) return result;

  const due = await run((client) => listDue(client, LIMITS));
  /* ASKED BEFORE THE LINK IS MINTED — and before the pace is counted. A
     link made for a booking with nowhere to send it is a private page
     handed to nobody (MEMORY 304: do not spend something irreversible
     above the check that decides whether it was worth spending). And a
     booking nobody can reach is owed for ever, so counted against the
     pace it would take a place every minute and starve the ones that can
     be reached. */
  const reachable = due.filter((booking) => channelFor(booking));
  result.due = due.length;
  result.nowhereToSend = due.length - reachable.length;

  for (const booking of reachable.slice(0, pace)) {
    try {
      const link = await run((client) => makeLink(client, booking));
      const message = messageFor(booking, link);
      if (!message) continue;
      result.attempted += 1;
      const answer = await run((client) => sender(client, message));
      if (answer.ok) result.sent += 1;
    } catch (error) {
      console.error("[guest-messaging] could not send for booking",
        booking.reference, error instanceof Error ? error.message : error);
    }
  }

  return result;
}

/* ── The timer ─────────────────────────────────────────────────────
   STARTED BY THE SERVER, not by importing this file: `server.ts` (the
   master's) calls `jobs.start()` after the port is open and never under
   the tests; `jobs.stop()` waits for a pass in progress. A pass never
   overlaps the one before it. The channel manager's shape, exactly. */
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = runOnce((fn) => withUser("", fn))
        .catch((error) => console.error("[guest-messaging] sweep failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, SWEEP_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
