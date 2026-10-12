import { describe, it, expect } from "vitest";
import { ruleFor } from "./offline";

/* ══════════════════════════════════════════════════════════════════
   WHAT MAY HAPPEN WITH NO NETWORK

   This list is the only thing standing between an outage and two
   guests holding the same GST invoice number. It is worth more
   assertions than most code in this repository, because the failure is
   silent, statutory, and cannot be repaired after the guest has left.

   The rules are ordered and first-match-wins, so half of what is
   checked here is ORDERING: `/till/orders/:id/settle` must be found
   before `/till/orders`, or settling a bill would queue.
   ══════════════════════════════════════════════════════════════════ */

const P = "/api/hotels/5EL";

describe("what must never happen offline", () => {
  it("refuses to raise an invoice", () => {
    const r = ruleFor(`${P}/stays/abc/invoice`, "POST");
    expect(r.tier).toBe("refuse");
    /* The refusal has to explain, or a clerk retries it all afternoon.
       This project's rule: a blocked action is shown with its reason. */
    expect(r.reason).toMatch(/statutory/i);
    expect(r.reason).toMatch(/same one/i);
  });

  it("refuses a credit note, which is also an invoice number", () => {
    expect(ruleFor(`${P}/invoices/5EL%2F2026-27%2F00042/credit-note`, "POST").tier)
      .toBe("refuse");
  });

  it("refuses the night audit", () => {
    expect(ruleFor(`${P}/night-audit/run`, "POST").tier).toBe("refuse");
  });

  it("refuses a payment", () => {
    const r = ruleFor(`${P}/stays/abc/payments`, "POST");
    expect(r.tier).toBe("refuse");
    expect(r.reason).toMatch(/drawer/i);
  });

  /* D27-307 (4): a group's master bill takes money and is invoiced too;
     each says why, in the stay's words, not "cannot be done offline yet". */
  it("refuses a group's payment and its invoice, with the Payment and Invoice reasons", () => {
    expect(ruleFor(`${P}/groups/abc/payments`, "POST").label).toBe("Payment");
    expect(ruleFor(`${P}/groups/abc/invoice`, "POST").label).toBe("Invoice");
  });

  it("refuses every cashier shift action", () => {
    for (const path of ["open", "count", "close", "movements"]) {
      expect(ruleFor(`${P}/cashier-shift/${path}`, "POST").tier).toBe("refuse");
    }
  });

  it("refuses settling a bill, but NOT taking the order", () => {
    /* The ordering test that matters most. A restaurant cannot stop
       serving; it can stop taking money. */
    expect(ruleFor(`${P}/till/orders/abc/settle`, "POST").tier).toBe("refuse");
    expect(ruleFor(`${P}/till/orders`, "POST").tier).toBe("queue");
    expect(ruleFor(`${P}/till/orders/abc/lines`, "POST").tier).toBe("queue");
    /* Customise is refused, never held: a held change could reach the dish
       after the kitchen has it (D27-289; the audit of 9 October). Ordering
       again: found before \`/till/orders\`. */
    const customise = ruleFor(`${P}/till/orders/abc/lines/42/numbered-addons`, "POST");
    expect(customise.tier).toBe("refuse");
    expect(customise.reason).toMatch(/Customise again when the connection is back/);
    /* An add-on on a dish from the Till (D27-291): held, a retry adds it
       twice. The pad's go with its round, through the batch, and queue. */
    expect(ruleFor(`${P}/till/orders/abc/lines/42/extras`, "POST").tier).toBe("refuse");
    expect(ruleFor(`${P}/till/orders/batch`, "POST").tier).toBe("queue");
  });

  it("refuses confirming a banquet function, but not the enquiry", () => {
    /* Confirming TAKES the hall — an exclusion constraint, so two
       desks offline could both take the same evening. */
    expect(ruleFor(`${P}/banquet/events/abc/confirm`, "POST").tier).toBe("refuse");
    expect(ruleFor(`${P}/banquet/events`, "POST").tier).toBe("queue");
  });

  it("refuses moving or reversing a charge", () => {
    expect(ruleFor(`${P}/postings/abc/transfer`, "POST").tier).toBe("refuse");
    expect(ruleFor(`${P}/stays/abc/charges/def/reverse`, "POST").tier).toBe("refuse");
  });
});

describe("what is safe to hold", () => {
  it("queues housekeeping, which is genuinely last-writer-wins", () => {
    /* BOTH paths. The room one ENDS with the word and the assignment
       one continues past it, and the first version of the rule matched
       neither -- the tap fell through to the unlisted default and was
       refused. Found by tapping it with the API stopped. */
    expect(ruleFor(`${P}/rooms/208/housekeeping`, "POST").tier).toBe("queue");
    expect(ruleFor(`${P}/housekeeping/assignments/204`, "PUT").tier).toBe("queue");
  });

  it("queues a work order", () => {
    expect(ruleFor(`${P}/work-orders`, "POST").tier).toBe("queue");
    expect(ruleFor(`${P}/work-orders/abc`, "PATCH").tier).toBe("queue");
  });

  it("queues a VIP flag", () => {
    expect(ruleFor(`${P}/guests/abc/vip`, "POST").tier).toBe("queue");
  });

  it("warns on check-in rather than queueing it silently", () => {
    /* The desk keeps working — but a room is a scarce resource, and
       the clerk is told this is held rather than done. */
    for (const path of ["stays/abc/check-in", "stays/abc/assign", "stays/abc/unassign"]) {
      expect(ruleFor(`${P}/${path}`, "POST").tier).toBe("queue-warn");
    }
  });
});

describe("the default", () => {
  it("refuses a write nobody has classified", () => {
    /* The important one. A new route added next year must not silently
       inherit "queue" — queueing guesses that replaying it later is
       safe, and that guess is what this whole list exists to stop
       being made casually. */
    const r = ruleFor(`${P}/something-invented-later`, "POST");
    expect(r.tier).toBe("refuse");
    expect(r.reason).toMatch(/has not been checked/i);
  });

  it("never refuses a read", () => {
    /* Reads are answered from the query cache, which can say how old
       the answer is. A read is never queued and never refused here. */
    expect(ruleFor(`${P}/invoices`, "GET").tier).toBe("queue");
    expect(ruleFor(`${P}/night-audit`, "GET").tier).toBe("queue");
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE ONE WRITE WHOSE TIER DEPENDS ON ITS BODY

   `/till/orders/:id/settle` is one address carrying four different
   acts. Cash reconciles against a drawer counted at close, and money
   applied after the count moves it — refused. A room charge moves no
   drawer; the owner decided on 8 September that a waiter on a hill
   station must be able to take one with the line down.

   These assertions are the whole of that distinction. If they stop
   holding, either a cash settlement starts queueing — which breaks the
   drawer — or a room charge stops, which puts a waiter back to walking
   downhill for signal.
   ══════════════════════════════════════════════════════════════════ */

const settle = `${P}/till/orders/abc/settle`;
const body = (v: unknown) => JSON.stringify(v);

describe("settling a bill offline", () => {
  it("holds a charge to a room, and warns", () => {
    const r = ruleFor(settle, "POST", body({ method: "room", room: "201" }));
    expect(r.tier).toBe("queue-warn");
    /* Named for the pending list. "Bill settlement" would read as though
       the money had been taken. */
    expect(r.label).toBe("Room charge");
  });

  it("still refuses cash, card and UPI", () => {
    for (const method of ["cash", "card", "upi"]) {
      const r = ruleFor(settle, "POST", body({ method }));
      expect(r.tier, `${method} must not queue`).toBe("refuse");
      expect(r.reason).toMatch(/drawer|cash on paper/i);
    }
  });

  it("holds a split bill only when EVERY part is a room charge", () => {
    expect(ruleFor(settle, "POST", body({
      tenders: [{ method: "room" }, { method: "room" }],
    })).tier).toBe("queue-warn");

    /* Half held and half refused would settle nothing and reconcile to
       nothing — the bill would be neither paid nor open. */
    expect(ruleFor(settle, "POST", body({
      tenders: [{ method: "room" }, { method: "cash" }],
    })).tier).toBe("refuse");

    expect(ruleFor(settle, "POST", body({ tenders: [] })).tier).toBe("refuse");
  });

  it("refuses when the body is missing or unreadable", () => {
    /* Fail towards refusing. Holding something that should not have been
       held is the direction that loses money. */
    expect(ruleFor(settle, "POST").tier).toBe("refuse");
    expect(ruleFor(settle, "POST", "not json").tier).toBe("refuse");
    expect(ruleFor(settle, "POST", body({})).tier).toBe("refuse");
  });

  it("does not let the room branch swallow the day end", () => {
    /* `/till/day-end` shares the rule that settling uses. A body naming
       a room must not reach past it — closing the day is not a payment
       and there is no version of it that may be held. */
    expect(ruleFor(`${P}/till/day-end`, "POST", body({ method: "room" })).tier)
      .toBe("refuse");
  });
});

describe("preparation times", () => {
  /* Queued rather than refused, and that was a decision: no scarce
     resource, no money, and two managers disagreeing is last-writer-wins
     — which is genuinely right here. The assertion exists so that
     decision cannot be undone by somebody reordering the table. */
  it("queues a dish's time and a category default", () => {
    for (const path of [
      `${P}/till/menu/items/abc/prep`,
      `${P}/till/menu/categories/abc/prep`,
    ]) {
      const r = ruleFor(path, "POST");
      expect(r.tier, path).toBe("queue");
      expect(r.label).toBe("Preparation time");
    }
  });

  it("does not let that rule reach the menu import", () => {
    /* `/till/menu/import` replaces a whole menu and must not queue —
       two imports held offline would fight, and the loser's prices
       would be silently gone. */
    expect(ruleFor(`${P}/till/menu/import`, "POST").tier).toBe("refuse");
  });
});
