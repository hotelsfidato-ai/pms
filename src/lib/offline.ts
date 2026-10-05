import { enqueue, list, remove, update, subscribe, NO_STORE, type OutboxEntry } from "./outbox";

/* ══════════════════════════════════════════════════════════════════
   WHAT MAY HAPPEN WITH NO NETWORK

   ONE LIST, HERE. Not a decision each screen makes for itself — that
   is how a rule written in four places comes to be wrong in one
   (defect 96), and here "wrong" means a GST invoice number issued
   twice.

   THREE TIERS, because a hotel is not a notes app.

   ── queue ────────────────────────────────────────────────────────
   No scarce resource, and last-writer-wins is genuinely the right
   answer. Two housekeepers marking 204 clean is not a conflict; it is
   two people agreeing.

   ── queue, and warn ──────────────────────────────────────────────
   Check-in. The desk keeps working, which is the point — a front
   office that cannot admit anyone during an outage is worse than a
   rare conflict. But `ra_no_double_booking` is an exclusion
   constraint, so two clerks CAN both put someone in 204 and the
   server refuses the second when signal returns, with both guests
   already upstairs. The clerk is told at the time that this is held
   rather than done, and a rejection is loud.

   ── refuse ───────────────────────────────────────────────────────
   Not "queue it and hope". Refused, with a reason: a write that
   silently does nothing is the exact defect this project keeps finding.

   A GST INVOICE NUMBER IS STATUTORY. `5EL/2026-27/00042` comes from a
   per-property, per-financial-year series. Two clerks offline both
   minting 00042 hands two guests the same invoice number, and you
   cannot re-number an invoice a guest has driven away with. There is
   no repair, so there is no queueing it.

   MONEY RECONCILES AGAINST A DRAWER. A settlement taken offline and
   applied later moves the expected cash after the count.

   THE NIGHT AUDIT MOVES THE WHOLE PROPERTY'S DATE. It is not one
   person's act.
   ══════════════════════════════════════════════════════════════════ */

export type Tier = "queue" | "queue-warn" | "refuse";

interface Rule {
  test: RegExp;
  methods?: string[];
  tier: Tier;
  /** What a person would call it, for the pending list. */
  label: string;
  /** Only for `refuse`: the sentence the clerk reads. It says why, and
      what they can do instead. */
  reason?: string;
}

/* ORDER MATTERS — first match wins, so the specific refusals sit above
   the general queues. `/till/orders/:id/settle` must be found before
   `/till/orders`, or a settlement would queue. */
const RULES: Rule[] = [
  /* ── refuse ─────────────────────────────────────────────────── */
  {
    test: /\/invoices(\/|$)|\/stays\/[^/]+\/invoice$/,
    tier: "refuse",
    label: "Invoice",
    reason:
      "An invoice cannot be raised offline. Its number comes from a "
      + "statutory series, and two desks offline would issue the same one "
      + "to different guests. Check the guest out and raise it when the "
      + "connection is back.",
  },
  {
    test: /\/night-audit(\/|$|\?)/,
    tier: "refuse",
    label: "Night audit",
    reason:
      "The night audit closes the day for the whole property and moves "
      + "the business date. It needs the server.",
  },
  {
    test: /\/stays\/[^/]+\/payments$|^\/api\/hotels\/[^/]+\/payments$|\/cashier-shift(\/|$)/,
    tier: "refuse",
    label: "Payment",
    reason:
      "A receipt cannot be taken offline - the drawer is counted against "
      + "what the server knows, and money applied later moves the count "
      + "after it was made. Take it on paper and enter it when the "
      + "connection is back.",
  },
  {
    /* ⚠ CASH, CARD AND UPI ONLY. A room charge reaches this file through
       the branch at the top of `ruleFor` and never gets here — see the
       long note there for why the owner decided those may be held. */
    test: /\/till\/orders\/[^/]+\/settle$|\/till\/day-end/,
    tier: "refuse",
    label: "Bill settlement",
    reason:
      "A bill cannot be settled offline unless it is charged to a room; "
      + "a bill for a banquet function waits for the connection too. "
      + "The order is saved and the kitchen has it; take cash on paper "
      + "and enter it when the connection is back.",
  },
  {
    test: /\/banquet\/events\/[^/]+\/confirm$/,
    tier: "refuse",
    label: "Confirm a function",
    reason:
      "Confirming takes the hall, and two desks offline could both take "
      + "it for the same evening. The enquiry is saved. Confirm when the "
      + "connection is back.",
  },
  {
    test: /\/postings\/[^/]+\/transfer$|\/charges\/[^/]+\/reverse$|\/stays\/[^/]+\/charges$/,
    tier: "refuse",
    label: "Charge",
    reason:
      "The ledger is append-only and a correction has to land in the "
      + "right order. This one needs the server.",
  },
  {
    test: /\/stays\/[^/]+\/(check-out|void|move|folios|routing)$|\/form-c/,
    tier: "refuse",
    label: "This change",
    reason:
      "This settles or re-shapes a bill, which has to happen in the right "
      + "order against the server. It cannot be held.",
  },

  /* ── queue, and warn ────────────────────────────────────────── */
  {
    test: /\/stays\/[^/]+\/(check-in|assign|unassign)$/,
    tier: "queue-warn",
    label: "Check-in",
  },

  /* ── queue ──────────────────────────────────────────────────── */
  /* `(\/|$)` on both, because the room path ENDS with the word and the
     assignment path continues past it:

       /rooms/208/housekeeping              mark a room clean
       /housekeeping/assignments/208        who is cleaning it

     The first version required a trailing slash and matched neither the
     one that matters nor, therefore, anything at all — the tap fell
     through to the unlisted default and was refused. Found by tapping
     it with the API stopped, which is the only way it could have been. */
  { test: /\/housekeeping(\/|$)/, tier: "queue", label: "Housekeeping" },
  { test: /\/rooms\/[^/]+\/housekeeping$/, tier: "queue", label: "Housekeeping" },
  { test: /\/work-orders(\/|$)/, tier: "queue", label: "Work order" },
  { test: /\/guests\/[^/]+\/vip$/, tier: "queue", label: "VIP" },
  { test: /\/till\/orders(\/|$)/, tier: "queue", label: "Order" },
  { test: /\/till\/menu\/items\/[^/]+\/(on|off|toggle)$/, tier: "queue", label: "Menu availability" },
  /* HOW LONG A DISH TAKES. No scarce resource and no money: two managers
     setting different times is last-writer-wins, which is genuinely the
     right answer. Named here rather than left to fall through to the
     refusal, because "nobody has thought about it" and "we thought about
     it and it queues" must not look the same in this table. */
  { test: /\/till\/menu\/(items|categories)\/[^/]+\/prep$/, tier: "queue", label: "Preparation time" },
  { test: /\/kitchen(\/|$)/, tier: "queue", label: "Kitchen" },
  { test: /\/banquet\/events$/, methods: ["POST"], tier: "queue", label: "Function enquiry" },
];

/** Everything not named above. A write nobody has thought about is
    refused rather than queued: queueing it guesses that replaying it
    later is safe, and that guess is exactly what this list exists to
    stop being made per-screen. */
const UNLISTED: Rule = {
  test: /.*/,
  tier: "refuse",
  label: "This change",
  reason:
    "This cannot be done offline yet. It has not been checked as safe to "
    + "hold and send later, and guessing is how a guest gets charged twice.",
};

/* ── The one write whose tier depends on its BODY ─────────────────
   Every other decision in this file is made from the path, deliberately:
   a tier chosen per screen is a rule written forty times, and defect 96
   is what that costs. This is the single exception, and it earns it.

   `/till/orders/:id/settle` is one address carrying four different acts.
   Cash, card and UPI reconcile against a drawer that is counted at close,
   and money applied after the count moves it — so those stay refused.

   A ROOM CHARGE MOVES NO DRAWER. It is a posting to a folio, and the
   owner decided on 8 September that a waiter in a hill station must be
   able to take one with the line down. What makes that safe is not this
   file — it is `app.pos_day_end_blockers`, which refuses to close the
   day while any bill is still open. A held charge means the settle never
   reached the server, so the bill IS still open, so the day cannot close
   until it syncs. That guard lives in the database and holds across
   every device, which no client-side check could.

   ⚠ THE RISK THE OWNER ACCEPTED, written down so nobody rediscovers it:
   a guest can check out and close their folio while a charge is still
   held. The server refuses it on drain — "nobody is checked in there, or
   the folio is closed" — and the outbox KEEPS a refusal and shows it to
   a person rather than dropping it. So the money is not lost silently;
   it is lost loudly, and somebody must chase it. That is the trade for a
   till that works on a bad line. */
function isRoomCharge(body: string | undefined): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as {
      method?: string; tenders?: { method?: string }[];
    };
    /* A split bill is a room charge only if EVERY part is one. Half a
       payment held and half refused would settle nothing and reconcile
       to nothing. */
    if (Array.isArray(parsed.tenders)) {
      return parsed.tenders.length > 0
        && parsed.tenders.every((t) => t.method === "room");
    }
    return parsed.method === "room";
  } catch {
    /* Unreadable body: fall through to the path rules, which refuse.
       Refusing something that might have been safe is the direction to
       fail in. */
    return false;
  }
}

export function ruleFor(path: string, method: string, body?: string): Rule {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") {
    return { test: /.*/, tier: "queue", label: "Read" };
  }

  if (/\/till\/orders\/[^/]+\/settle$/.test(path) && isRoomCharge(body)) {
    return {
      test: /.*/,
      tier: "queue-warn",
      label: "Room charge",
    };
  }

  for (const r of RULES) {
    if (!r.test.test(path)) continue;
    if (r.methods && !r.methods.includes(m)) continue;
    return r;
  }
  return UNLISTED;
}

/* ══════════════════════════════════════════════════════════════════
   IS THERE A CONNECTION?

   `navigator.onLine` is necessary and not sufficient, and defect 49
   paid for that: it reports TRUE on a wifi with no route out, which is
   the most common failure in a hotel — the access point is up and the
   line is down.

   So the truth is the LAST REQUEST. `navigator.onLine === false` is
   believed immediately; `true` only means "worth trying".
   ══════════════════════════════════════════════════════════════════ */

let lastFailed = false;
const watchers = new Set<() => void>();

export function isOnline(): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  return !lastFailed;
}

export function noteReachable() {
  if (lastFailed) {
    lastFailed = false;
    ping();
  }
}

export function noteUnreachable() {
  if (!lastFailed) {
    lastFailed = true;
    ping();
  }
}

export function watchConnection(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function ping() {
  for (const fn of watchers) {
    try {
      fn();
    } catch {
      /* One listener must not stop the rest. */
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    /* The browser thinks it is back. It is only a reason to TRY —
       the drain decides. */
    lastFailed = false;
    ping();
  });
  window.addEventListener("offline", () => {
    lastFailed = true;
    ping();
  });
}

/* ══════════════════════════════════════════════════════════════════
   THE DRAIN
   ══════════════════════════════════════════════════════════════════ */

export interface DrainResult {
  sent: number;
  rejected: number;
  /** Entries belonging to somebody else who was using this machine.
      Not an error and not a failure — they go when that person signs
      in again. */
  heldForOthers: number;
  /** True when the network gave out again part way. */
  stopped: boolean;
}

let draining = false;

/**
 * Sends the outbox, oldest first, and STOPS at the first network
 * failure rather than skipping past it.
 *
 * Stopping is deliberate. A check-in and the charge that follows it are
 * not independent, and sending the second without the first fails for a
 * reason nobody would connect to ordering.
 *
 * A REFUSAL IS NOT A FAILURE. If the server answers 4xx it has decided,
 * and retrying gets the same answer forever. Those are marked rejected,
 * kept, and shown to a person — that is the room-already-taken case the
 * check-in tier exists to surface.
 */
export async function drain(
  send: (entry: OutboxEntry) => Promise<Response>,
  /** Only this person's held work is sent. Everything else waits for
      them to sign in again. */
  subject: string,
): Promise<DrainResult> {
  if (draining) return { sent: 0, rejected: 0, heldForOthers: 0, stopped: false };
  draining = true;
  const result: DrainResult = { sent: 0, rejected: 0, heldForOthers: 0, stopped: false };

  try {
    for (const entry of await list()) {
      if (entry.status === "rejected") continue;

      /* SOMEBODY ELSE'S ACT. A shared front-desk machine has one
         browser profile and four clerks; sending the morning clerk's
         check-in under the evening clerk's token would put the wrong
         name on it forever, and an append-only ledger does not forget.

         It waits. `heldForOthers` tells the screen to say so, rather
         than leaving a count that never goes down and never explains
         itself. */
      if (subject && entry.subject && entry.subject !== subject) {
        result.heldForOthers += 1;
        continue;
      }

      let response: Response;
      try {
        response = await send(entry);
      } catch {
        /* The network, not the server. Keep it and stop — everything
           behind it stays in order. */
        noteUnreachable();
        result.stopped = true;
        return result;
      }

      noteReachable();

      if (response.ok) {
        await remove(entry.id);
        result.sent += 1;
        continue;
      }

      if (response.status >= 500) {
        /* The server is there and broken. Not the person's fault and
           not settled — leave it and stop. */
        result.stopped = true;
        return result;
      }

      const body = (await response.json().catch(() => null)) as
        | { reason?: string; error?: string }
        | null;
      await update({
        ...entry,
        status: "rejected",
        attempts: entry.attempts + 1,
        error: body?.reason ?? body?.error ?? `Refused (${response.status}).`,
      });
      result.rejected += 1;
    }
  } finally {
    draining = false;
  }

  return result;
}

export { enqueue, list, remove, update, subscribe, NO_STORE };
export type { OutboxEntry };
