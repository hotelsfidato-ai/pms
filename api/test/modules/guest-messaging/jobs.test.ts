import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closePool, type Client } from "../../../src/db.ts";
import {
  runOnce, channelFor, messageFor, KIND,
  CONFIRM_WITHIN_HOURS, MOST_ATTEMPTS,
  type Due, type Limits,
} from "../../../src/modules/guest-messaging/jobs.ts";
import type { Message, SendResult } from "../../../src/sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DECIDING — which booking gets a message, which way, and when not

   The two messages this system sends by itself (D18-11, D18-12). What is
   under test here is the DECIDING and not the sending: the sweep's two
   hands — the query that says which bookings are due, and the minting of
   the guest's own link — both need a SECURITY DEFINER function that the
   migration has not been given a number for yet, so they are parameters
   and this file hands in its own.

   That is not a weaker test. It is the test that can be written today,
   and the refusals in it are the ones that matter: NOTHING HAPPENS while
   n8n is not connected, NOTHING is minted for a booking with nowhere to
   send, and NO ROW IS EVER WRITTEN here — the sender writes its own.

   No database is touched. `client` is never used by any path under test,
   because every statement belongs to a hand that is injected.
   ══════════════════════════════════════════════════════════════════ */

afterAll(async () => { await closePool(); });

const NOWHERE = null as unknown as Client;

const aBooking = (over: Partial<Due> = {}): Due => ({
  kind: KIND.confirmation,
  reservationId: "11111111-2222-3333-4444-555555555555",
  reference: "FH-2609-5001",
  hotel: { id: "aaaa", code: "5EL", name: "5 Elements Akkalkot", phone: "+911234567890" },
  guest: { name: "Mr Sharma", phone: "+919876543210", email: "sharma@example.com" },
  checkIn: "2026-09-21",
  checkOut: "2026-09-23",
  nights: 2,
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

const connected = () => {
  process.env["N8N_SEND_URL"] = "http://127.0.0.1:1/pms-send";
  process.env["N8N_SEND_SECRET"] = "not-used-here-nothing-is-really-sent";
};

beforeEach(() => {
  delete process.env["N8N_SEND_URL"];
  delete process.env["N8N_SEND_SECRET"];
});

describe("nothing sends until the owner has connected n8n", () => {
  it("does not even ask which bookings are due", async () => {
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
    expect(out).toEqual({ due: 0, attempted: 0, sent: 0, nowhereToSend: 0 });
  });
});

describe("which booking is due", () => {
  it("asks the query for the owner's two rules rather than deciding them here", async () => {
    connected();
    let limits: Limits | null = null;

    await runOnce(
      NOWHERE,
      async (_c, given) => { limits = given; return []; },
      aLinkMaker().make, aReceiver().send,
    );

    expect(limits).toEqual({
      withinHours: CONFIRM_WITHIN_HOURS, mostAttempts: MOST_ATTEMPTS,
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

    expect(out).toEqual({ due: 2, attempted: 2, sent: 2, nowhereToSend: 0 });
    expect(post.seen.map((m) => m.kind))
      .toEqual(["booking-confirmation", "arrival-reminder"]);
  });
});

describe("which way it goes", () => {
  it("takes the number where there is one - WhatsApp is the channel here", () => {
    expect(channelFor(aBooking())).toBe("whatsapp");
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

  it("sends once, not twice, to a guest who has both", async () => {
    connected();
    const post = aReceiver();
    await runOnce(NOWHERE, async () => [aBooking()], aLinkMaker().make, post.send);

    expect(post.seen).toHaveLength(1);
    expect(post.seen[0]!.channel).toBe("whatsapp");
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
        reference: "FH-2609-5003",
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
    expect(out).toEqual({ due: 1, attempted: 0, sent: 0, nowhereToSend: 1 });
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
    expect(out).toEqual({ due: 2, attempted: 1, sent: 1, nowhereToSend: 0 });
  });

  it("counts a refusal as attempted and not as sent", async () => {
    connected();
    const post = aReceiver({ ok: false, reason: "The receiver refused it (500)." });

    const out = await runOnce(NOWHERE, async () => [aBooking()], aLinkMaker().make, post.send);

    expect(out).toEqual({ due: 1, attempted: 1, sent: 0, nowhereToSend: 0 });
  });
});
