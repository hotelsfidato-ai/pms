import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { closePool, type Client } from "../../../src/db.ts";
import {
  runOnce, channelFor, messageFor, jobs, KIND,
  type Due, type Limits, type Run,
} from "../../../src/modules/guest-messaging/jobs.ts";
import type { Message, SendResult } from "../../../src/sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DECIDING — which booking gets a message, which way, and when not

   The two messages this system sends by itself (D18-11, D18-12). What is
   under test here is the DECIDING: the sweep's two hands — the query that
   says which bookings are owed, and the minting of the guest's own link —
   are handed in, so each rule is proved on its own. The same sweep with
   the real database functions, a real link and a fake n8n is
   sweep.test.ts; the functions alone are db/tests/modules/guest-messaging.sql.

   The refusals are the ones that matter: NOTHING HAPPENS until n8n is
   connected AND the owner has given the pace, NOTHING is minted for a
   booking with nowhere to send, WhatsApp goes only where the guest agreed,
   and NO ROW IS EVER WRITTEN here — the sender writes its own.

   No database is touched. `client` is never used by any path under test,
   because every statement belongs to a hand that is injected.
   ══════════════════════════════════════════════════════════════════ */

afterAll(async () => { await closePool(); });

/** A transaction that is not one: every hand here is injected, so no
    statement ever reaches a client. */
const NOWHERE: Run = (fn) => fn(null as unknown as Client);

const aBooking = (over: Partial<Due> = {}): Due => ({
  kind: KIND.confirmation,
  /* The way, as the database decides it (D27-235). */
  channel: "whatsapp",
  reservationId: "11111111-2222-3333-4444-555555555555",
  reference: "FH-2609-5001",
  hotel: { id: "aaaa", code: "5EL", name: "5 Elements Akkalkot", phone: "+911234567890" },
  guest: { name: "Mr Sharma", phone: "+919876543210", email: "sharma@example.com" },
  whatsappAgreed: true,
  checkIn: "2026-09-21",
  checkOut: "2026-09-23",
  nights: 2,
  held: false,
  ...over,
});

/** The one door out, replaced. Every call is remembered; nothing leaves. */
function aReceiver(answer: SendResult = { ok: true, id: "1" }) {
  const seen: Message[] = [];
  return {
    seen,
    send: async (_client: Client, message: Message): Promise<SendResult> => {
      seen.push(message);
      return answer;
    },
  };
}

/** Mints a link, and counts how often it was asked to. */
function aLinkMaker() {
  const asked: string[] = [];
  return {
    asked,
    make: async (_client: Client, due: Due) => {
      asked.push(due.reference);
      return `http://localhost:5173/g/token-for-${due.reference}`;
    },
  };
}

/** Switched on, as stage 3 will (D21-76): the two sending settings, and
    the owner's pace. */
const connected = (perMinute = "100") => {
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = "http://127.0.0.1:1/pms-send";
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = "not-used-here-nothing-is-really-sent";
  process.env["GUEST_MESSAGES_PER_MINUTE"] = perMinute;
};

beforeEach(() => {
  delete process.env["CRS_N8N_URL"];
  delete process.env["M2R_N8N_URL"];
  delete process.env["CRS_N8N_SECRET"];
  delete process.env["M2R_N8N_SECRET"];
  delete process.env["GUEST_MESSAGES_PER_MINUTE"];
});

describe("nothing sends until it is switched on", () => {
  it("does not even ask which bookings are due while n8n is not connected", async () => {
    const link = aLinkMaker();
    const post = aReceiver();
    let asked = false;

    const out = await runOnce(
      NOWHERE,
      async () => { asked = true; return [aBooking()]; },
      link.make, post.send,
    );

    expect(asked).toBe(false);
    expect(link.asked).toEqual([]);
    expect(post.seen).toEqual([]);
    expect(out).toEqual({ due: 0, attempted: 0, sent: 0, nowhereToSend: 0, waiting: 0 });
  });

  /* ⚠ D21-34: "that pace is the owner's number to give; nobody guesses
     it". Connected with no pace, the sweep must not fall back to sending
     everything at once - on switch-on day that is every future booking. */
  it("nor until the owner has given the pace, even connected", async () => {
    connected();
    delete process.env["GUEST_MESSAGES_PER_MINUTE"];
    let asked = false;
    const post = aReceiver();
    const ask = async () => { asked = true; return [aBooking()]; };

    expect((await runOnce(NOWHERE, ask, aLinkMaker().make, post.send)).attempted).toBe(0);
    for (const junk of ["0", "-5", "2.5", "lots"]) {
      connected(junk);
      await runOnce(NOWHERE, ask, aLinkMaker().make, post.send);
    }

    expect(asked).toBe(false);
    expect(post.seen).toEqual([]);
  });
});

describe("which booking is due", () => {
  it("asks the query for the owner's rules rather than deciding them here", async () => {
    connected();
    let limits: Limits | null = null;

    await runOnce(
      NOWHERE,
      async (_c, given) => { limits = given; return []; },
      aLinkMaker().make, aReceiver().send,
    );

    /* D21-33: EVERY future booking, however long ago it was made - no
       window. The recommendation was 48 hours; the owner said no.
       D22-39: the reminder from 10:00. D22-42: a catch-up confirmation
       from 09:00 until 21:00. All on the property's own clock. */
    expect(limits).toEqual({
      withinHours: null, mostAttempts: 3, remindFrom: "10:00",
      catchUpFrom: "09:00", catchUpUntil: "21:00",
    });
  });

  it("sends the confirmation and the reminder, each to its own booking", async () => {
    connected();
    const link = aLinkMaker();
    const post = aReceiver();

    const out = await runOnce(
      NOWHERE,
      async () => [
        aBooking({ kind: KIND.confirmation, reference: "FH-2609-5001" }),
        aBooking({ kind: KIND.reminder, reference: "FH-2609-5002" }),
      ],
      link.make, post.send,
    );

    expect(out).toEqual({ due: 2, attempted: 2, sent: 2, nowhereToSend: 0, waiting: 0 });
    expect(post.seen.map((m) => m.kind))
      .toEqual(["booking-confirmation", "arrival-reminder"]);
  });
});

describe("which way it goes", () => {
  it("takes the number where the guest agreed to WhatsApp", () => {
    expect(channelFor(aBooking())).toBe("whatsapp");
  });

  /* ⚠ D21-72: Meta's own rule, that a business may start a conversation
     only with somebody who agreed. A number on the booking is not
     agreement - a channel booking arrives with one and no tick. */
  it("sends an unticked booking by email, number or no number", () => {
    expect(channelFor(aBooking({ whatsappAgreed: false }))).toBe("email");
  });

  it("sends an unticked booking with only a number nothing at all", () => {
    expect(channelFor(aBooking({
      whatsappAgreed: false,
      guest: { name: "Mr Sharma", phone: "+919876543210", email: null },
    }))).toBe(null);
  });

  it("falls back to the address where the booking carries no number", () => {
    expect(channelFor(aBooking({
      guest: { name: "Mr Sharma", phone: null, email: "sharma@example.com" },
    }))).toBe("email");
  });

  it("treats a number of spaces as no number at all", () => {
    expect(channelFor(aBooking({
      guest: { name: "Mr Sharma", phone: "   ", email: null },
    }))).toBe(null);
  });

  /* D27-235 (2.1, replacing D21-35's one or the other): the confirmation
     goes BOTH ways. The database owes one row per way; each is its own
     message, with its own id, so neither way's retry is taken for the other. */
  it("sends each way the database owes, as its own message with its own id", async () => {
    connected();
    const post = aReceiver();
    await runOnce(NOWHERE, async () => [aBooking({ channel: "whatsapp" }), aBooking({ channel: "email" })],
      aLinkMaker().make, post.send);

    expect(post.seen.map((m) => m.channel)).toEqual(["whatsapp", "email"]);
    expect(new Set(post.seen.map((m) => m.id)).size, "one id per way").toBe(2);
  });

  /* D27-241 (Q1): the CRS's voucher template with the PDF is a second
     WhatsApp, after the confirmation - it carries no link, so none is made. */
  it("mints no link for the WhatsApp voucher, and sends it as its own kind", async () => {
    connected();
    const link = aLinkMaker();
    const post = aReceiver();
    await runOnce(NOWHERE, async () => [aBooking({ kind: KIND.voucher, reference: "FH-V" })], link.make, post.send);

    expect(link.asked).toEqual([]);
    expect(post.seen[0]).toMatchObject({ kind: "booking-voucher", channel: "whatsapp" });
    expect(post.seen[0]!.data).not.toHaveProperty("link");
  });
});

describe("a booking with nowhere to send", () => {
  it("mints no link and attempts nothing", async () => {
    connected();
    const link = aLinkMaker();
    const post = aReceiver();

    const out = await runOnce(
      NOWHERE,
      async () => [aBooking({
        reference: "FH-2609-5003", channel: null,
        guest: { name: "Walk-in", phone: null, email: null },
      })],
      link.make, post.send,
    );

    /* ⚠ THE LINK IS THE POINT OF THIS ONE. A private page minted for a
       booking nobody can be told about sits in `guest_links` until it
       expires - the fault MEMORY 304 records, where the guest door burned
       a live code above the check that decided whether it was worth
       spending. */
    expect(link.asked).toEqual([]);
    expect(post.seen).toEqual([]);
    expect(out).toEqual({ due: 1, attempted: 0, sent: 0, nowhereToSend: 1, waiting: 0 });
  });
});

describe("the owner's pace (D21-34)", () => {
  it("sends no more in one sweep than the pace, in the order the database gave", async () => {
    connected("2");
    const post = aReceiver();

    const out = await runOnce(
      NOWHERE,
      async () => ["FH-1", "FH-2", "FH-3"].map((reference) => aBooking({ reference })),
      aLinkMaker().make, post.send,
    );

    expect(post.seen.map((m) => m.data?.["reference"])).toEqual(["FH-1", "FH-2"]);
    expect(out).toEqual({ due: 3, attempted: 2, sent: 2, nowhereToSend: 0, waiting: 0 });
  });

  /* ⚠ A booking nobody can reach is never attempted, so it is owed for
     ever. Counted against the pace, the soonest few of them would take
     every place every minute and nobody else would ever be sent to. */
  it("does not let a booking nobody can reach take a place", async () => {
    connected("1");
    const post = aReceiver();
    const nobody = { name: "Walk-in", phone: null, email: null };

    const out = await runOnce(
      NOWHERE,
      async () => [
        aBooking({ reference: "FH-1", guest: nobody, channel: null }),
        aBooking({ reference: "FH-2", guest: nobody, channel: null }),
        aBooking({ reference: "FH-3" }),
      ],
      aLinkMaker().make, post.send,
    );

    expect(post.seen.map((m) => m.data?.["reference"])).toEqual(["FH-3"]);
    expect(out).toEqual({ due: 3, attempted: 1, sent: 1, nowhereToSend: 2, waiting: 0 });
  });
});

/* ⚠ D22-42: a confirmation owed to a booking made before sending was
   switched on goes only between 09:00 and 21:00. The database marks it
   held outside those hours; the sweep must leave it - and not let it take a
   place a booking made five minutes ago is waiting for. */
describe("the catch-up hours (D22-42)", () => {
  it("leaves a held confirmation for the morning, and mints it no link", async () => {
    connected("1");
    const link = aLinkMaker();
    const post = aReceiver();

    const out = await runOnce(
      NOWHERE,
      async () => [
        aBooking({ reference: "FH-OLD", held: true }),
        aBooking({ reference: "FH-NEW" }),
      ],
      link.make, post.send,
    );

    expect(link.asked).toEqual(["FH-NEW"]);
    expect(post.seen.map((m) => m.data?.["reference"])).toEqual(["FH-NEW"]);
    expect(out).toEqual({ due: 2, attempted: 1, sent: 1, nowhereToSend: 0, waiting: 1 });
  });
});

describe("what n8n receives", () => {
  it("carries the guest's own link, the booking, and no prose", () => {
    const message = messageFor(aBooking(), "http://localhost:5173/g/abc")!;

    expect(message.data).toEqual({
      reference: "FH-2609-5001",
      guestName: "Mr Sharma",
      hotelName: "5 Elements Akkalkot",
      checkIn: "2026-09-21",
      checkOut: "2026-09-23",
      checkInText: "21/09/2026",
      checkOutText: "23/09/2026",
      nights: "2",
      link: "http://localhost:5173/g/abc",
    });
    /* THE WORDING LIVES IN n8n (D17-87). Nothing this file sends is a
       sentence a guest reads - if one ever appears here, it is a sentence
       the owner can no longer change without a deploy. */
    expect(JSON.stringify(message.data)).not.toMatch(/Dear|Thank|Welcome|your booking/i);
  });

  it("says the system sent it, not a person", () => {
    expect(messageFor(aBooking(), "http://x")!.sentBy).toBe(null);
  });

  it("is about the booking, so the desk can ask 'was it sent?'", () => {
    expect(messageFor(aBooking(), "http://x")!.about)
      .toEqual({ kind: "reservation", id: "11111111-2222-3333-4444-555555555555" });
  });
});

describe("one booking's fault does not stop the others", () => {
  it("carries on after a link that could not be minted", async () => {
    connected();
    const post = aReceiver();

    const out = await runOnce(
      NOWHERE,
      async () => [
        aBooking({ reference: "FH-2609-5001" }),
        aBooking({ reference: "FH-2609-5002" }),
      ],
      async (_c, due) => {
        if (due.reference === "FH-2609-5001") throw new Error("no link");
        return "http://localhost:5173/g/ok";
      },
      post.send,
    );

    expect(post.seen.map((m) => m.data?.["reference"])).toEqual(["FH-2609-5002"]);
    expect(out).toEqual({ due: 2, attempted: 1, sent: 1, nowhereToSend: 0, waiting: 0 });
  });

  it("counts a refusal as attempted and not as sent", async () => {
    connected();
    const post = aReceiver({ ok: false, reason: "The receiver refused it (500)." });

    const out = await runOnce(NOWHERE, async () => [aBooking()], aLinkMaker().make, post.send);

    expect(out).toEqual({ due: 1, attempted: 1, sent: 0, nowhereToSend: 0, waiting: 0 });
  });
});

describe("the timer", () => {
  it("starts one timer however often it is started, and stops it", async () => {
    vi.useFakeTimers();
    try {
      jobs.start();
      jobs.start();
      /* Two would be two sweeps a minute, each sending the same bookings. */
      expect(vi.getTimerCount()).toBe(1);
      await jobs.stop();
      await jobs.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
