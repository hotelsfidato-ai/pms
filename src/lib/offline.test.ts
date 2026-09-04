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
    for (const path of ["stays/abc/check-in", "stays/abc/assign", "walk-ins"]) {
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
    expect(ruleFor(`${P}/night-audit/can-run`, "GET").tier).toBe("queue");
  });
});
