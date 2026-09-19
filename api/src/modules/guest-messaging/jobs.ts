import type { Client } from "../../db.ts";
import { canSend, send, type Message, type SendResult } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TWO MESSAGES THIS SYSTEM SENDS BY ITSELF (D18-11, D18-12)

     booking-confirmation   the booking's details and the guest's own
                            link, when a booking is confirmed
     arrival-reminder       the same link again, the day before arrival

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

   ⚠ NOTHING HAPPENS UNTIL THE OWNER'S n8n STEPS ARE DONE. `canSend()`
   is false, this does not run, and no row is written — the same shape
   the channel manager's jobs take while SU is not set up.

   ⚠ WHAT IS NOT WIRED YET, AND WHY. Both `listDue` and `makeLink` are
   parameters rather than imports. A sweep has no staff session — nobody
   is signed in at three in the morning — and `reservations` and
   `guest_links` are both FORCE row-secured on `app.auth_hotel_ids()`,
   which answers for a signed-in person. So both need a SECURITY DEFINER
   function, exactly as `messages_sent` needed `app.record_message_sent`
   in migration 117. That migration is asked for and not yet given, so
   what is here is the deciding — which bookings are due, which way each
   goes, when to stop trying — and it is proved against fakes. Nothing
   pretends to run.
   ══════════════════════════════════════════════════════════════════ */

export const KIND = {
  confirmation: "booking-confirmation",
  reminder: "arrival-reminder",
} as const;

export type MessageKind = (typeof KIND)[keyof typeof KIND];

/* ── Two rules that are the OWNER'S and are recommended, not decided ──
   Asked on 19 September, through the master, and named here so that
   either answer is a one-line change rather than a hunt.

   1. A booking made BEFORE sending was switched on gets no confirmation
      after the fact. The day the owner finishes their n8n steps, every
      future booking already in the system would otherwise become due at
      once, and a guest who booked three weeks ago and has their voucher
      does not want a confirmation now. The reminder reaches them anyway.
   2. Three attempts and no more. A number that is wrong is wrong every
      minute, and a row per minute for ever is a log of one fault. */
export const CONFIRM_WITHIN_HOURS = 48;
export const MOST_ATTEMPTS = 3;

/** One booking that has not had one of the two messages yet, as the
    database answers it. Everything the message needs is here, because a
    second query per booking is a second thing to go wrong in a loop. */
export interface Due {
  kind: MessageKind;
  reservationId: string;
  reference: string;
  hotel: { id: string; code: string; name: string; phone: string | null };
  guest: { name: string; phone: string | null; email: string | null };
  checkIn: string;
  checkOut: string;
  nights: number;
}

/* ── Which way it goes ─────────────────────────────────────────────
   RECOMMENDED, NOT DECIDED (asked 19 September). WhatsApp is the channel
   in this market and is the number the booking already carries (D17-89);
   email is the fallback for a booking that has only an address. Sending
   BOTH would be the same message twice to the same person.

   Neither, and NOTHING IS ATTEMPTED — so nothing is recorded, which is
   migration 117's own rule. The sender refuses the same way one step
   later; this just does not waste the call. */
export function channelFor(due: Due): "whatsapp" | "email" | null {
  if (due.guest.phone?.trim()) return "whatsapp";
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

/** The two rules above, as the query will be asked them. They are PASSED
    rather than read where the query lives, so there is one place the
    owner's answer lands and nothing here is a constant nobody reads
    (MEMORY 304: a name only one file uses is a name nothing sets). */
export interface Limits {
  withinHours: number;
  mostAttempts: number;
}

/** Where the bookings come from. A function because it needs the definer
    the migration will add; the tests hand in their own. */
export type ListDue = (client: Client, limits: Limits) => Promise<Due[]>;

/** Mints the guest's own private page for this booking and answers the
    link (api/src/routes/guestDoor.ts, migration 114 — `origin` there
    already has a `'confirmation'` value waiting for this). A function for
    the same reason: it writes a row no unsigned-in caller may write. */
export type MakeLink = (client: Client, due: Due) => Promise<string>;

export interface SweepResult {
  /** Bookings the database said were due. */
  due: number;
  /** Messages handed to the one door out. */
  attempted: number;
  /** Of those, the ones the receiver took. */
  sent: number;
  /** Due, but with no number and no address, so nothing was attempted. */
  nowhereToSend: number;
}

/* ── One pass ──────────────────────────────────────────────────────
   Everything leaves through `api/src/sending.ts` and nothing else, and
   `send` records its own attempt — this file never writes `messages_sent`.

   ONE BOOKING'S FAULT DOES NOT STOP THE OTHERS. The next sweep tries
   again, up to MOST_ATTEMPTS, which `listDue` counts. */
export async function runOnce(
  client: Client,
  listDue: ListDue,
  makeLink: MakeLink,
  sender: (client: Client, message: Message) => Promise<SendResult> = send,
): Promise<SweepResult> {
  const result: SweepResult = { due: 0, attempted: 0, sent: 0, nowhereToSend: 0 };
  if (!canSend()) return result;

  const due = await listDue(client, {
    withinHours: CONFIRM_WITHIN_HOURS, mostAttempts: MOST_ATTEMPTS,
  });
  result.due = due.length;

  for (const booking of due) {
    /* ASKED BEFORE THE LINK IS MINTED. A link made for a booking with
       nowhere to send it is a private page handed to nobody, and it
       would sit in `guest_links` until it expired. The same rule the
       guest door learned the hard way (MEMORY 304): do not spend
       something irreversible above the check that decides whether it
       was worth spending. */
    if (!channelFor(booking)) {
      result.nowhereToSend += 1;
      continue;
    }

    try {
      const message = messageFor(booking, await makeLink(client, booking));
      if (!message) continue;
      result.attempted += 1;
      const answer = await sender(client, message);
      if (answer.ok) result.sent += 1;
    } catch (error) {
      console.error("[guest-messaging] could not send for booking",
        booking.reference, error instanceof Error ? error.message : error);
    }
  }

  return result;
}
