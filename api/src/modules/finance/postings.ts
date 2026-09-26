import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { resolveDate } from "../../businessDate.ts";
import { folioFor } from "../../folio.ts";

/* Split out of api/src/routes/operations.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: finance.
   Posting a charge, reversing one and taking a payment. The endpoints are
   unchanged; `hotelIdFor`, `Outcome` and `refuse` are copies of the front
   desk's, and `folioFor` comes from the core (../../folio.ts). */

export const postings = new Hono<{ Variables: { subject: string } }>();

async function hotelIdFor(client: Client, code: string) {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = upper($1) and is_active",
    [code],
  );
  return rows[0]?.id ?? null;
}

/** Rule 6's shape, all the way down. Refused is a result, not an error. */
type Outcome<T = unknown> =
  | { ok: true; data?: T }
  /* `needs` names WHAT WOULD SATISFY the refusal, for the refusals that
     have an answer. A screen can then open the right dialog instead of
     matching on the prose — which is a string somebody will reword one
     day, at which point the way through silently disappears. Most
     refusals have no `needs`: "the room is occupied" is not a form to
     fill in. */
  | { ok: false; reason: string; needs?: "late-reason" | "early-reason" };

const refuse = (
  reason: string, needs?: "late-reason" | "early-reason",
): Outcome => (needs ? { ok: false, reason, needs } : { ok: false, reason });


/* ══════════════════════════════════════════════════════════════════
   THE LEDGER

   Append-only, enforced by a trigger — `folio_postings_append_only`.
   A wrong charge is REVERSED with a second row; nothing is edited and
   nothing is deleted. That means `count(*)` goes UP when something is
   undone, which is the opposite of what most people expect and exactly
   what makes the ledger auditable.

   Every posting needs a folio. A reservation has one from check-in, so
   `folioFor` opens one on demand rather than failing on a stay that has
   not been billed yet — an empty folio is a normal state.
   ══════════════════════════════════════════════════════════════════ */

/** The interface's categories, and the schema's. */
const CATEGORY: Record<string, string> = {
  Room: "room", "Room posting": "room",
  Food: "food", Beverage: "beverage", Beverages: "beverage",
  Spa: "spa", Laundry: "laundry", Minibar: "minibar",
  Telephone: "telephone", Miscellaneous: "misc", Misc: "misc",
  Discount: "discount", Payment: "payment", Refund: "refund",
};

const PAYMENT_METHOD: Record<string, string> = {
  Cash: "cash", UPI: "upi", "Credit Card": "card", "Debit Card": "card",
  "Net Banking": "netbanking", Wallet: "wallet", Cheque: "cheque",
  "Bank Transfer": "bank_transfer", "Bill to company": "city_ledger",
  "Room Posting": "city_ledger",
};

/* ── Post a charge ───────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
   THE DOOR A CHARGE REACHES A ROOM BILL THROUGH

   Exported from `api/src/modules/finance/index.ts`, written 18 September
   because the laundry and the spa both need D18-7 — "straight onto the
   room bill as its own charge line" — and there was nothing to call.
   Posting a charge existed only as the HTTP route below, and a service
   that cannot reach a door writes the table itself, which is how a
   ledger ends up with two sets of rules about what may be posted.

   So the route's body is HERE now and the route calls it. There is still
   ONE insert into `folio_postings` for a charge, in one place, and the
   checks in front of it cannot be skipped by whoever calls: a cancelled
   booking, a closed folio, a charge with no description and a charge of
   nothing are refused for the desk and for a service alike.

   A REFUSAL RETURNED INSIDE `withSession` IS A COMMIT (MEMORY 243), so
   this answers `{ok:false, reason}` and never throws for a refusal — the
   caller decides what to do with its own transaction.
   ══════════════════════════════════════════════════════════════════ */
export interface ChargeToPost {
  /** What the guest reads on the bill. Required: a line with no words is
      an amount nobody can query at check-out. */
  description: string;
  amount: number;
  /** The interface's word — "Laundry", "Spa", "Miscellaneous"… */
  category?: string | undefined;
  /** false where somebody has determined the charge bears no GST. That is
      a decision and it is recorded as one; there is no silent default. */
  taxable?: boolean | undefined;
  businessDate?: string | undefined;
  /** WHICH TAX RULE THE CHARGE FOLLOWS, asked of `app.gst_rate`.
      "room" unless the service has its own, which the SPA does — the
      owner's D18-21, 18 September: a treatment bills under the spa's own
      rule per property, so a property that has not set one cannot bill a
      treatment at all rather than billing it at the room's rate. Laundry
      has no rule of its own and stays on "room". */
  taxKind?: string;
}

export async function postCharge(
  client: Client, hotelId: string, stayId: string, input: ChargeToPost,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const description = input.description?.trim();
  if (!description) return { ok: false, reason: "A charge needs a description." };
  if (!input.amount) return { ok: false, reason: "A charge of zero is not a charge." };

  const { rows } = await client.query<{ status: string }>(
    "select status from reservations where hotel_id = $1 and id = $2",
    [hotelId, stayId],
  );
  const stay = rows[0];
  if (!stay) return { ok: false, reason: "Reservation not found." };
  if (stay.status === "cancelled") return { ok: false, reason: "This booking was cancelled." };
  if (stay.status === "checked_out") {
    return { ok: false, reason: "This folio is closed. Reopen the stay to post to it." };
  }

  /* THE RATE COMES FROM THE RULE, AND ZERO IS STILL A DECISION.
     This read `(cgst_rate + sgst_rate) ?? 5` — a property rate with a
     hardcoded 5% behind it, which is a shipped price in a project
     whose first rule is that nothing ships a price. A property that
     had never set a rate billed at five percent and looked correct.

     `taxable: false` stays: a clerk saying a charge bears no GST is
     making a determination, and it is recorded as one. What is gone
     is the silent fallback for the case where nobody said anything.

     Everything the front desk posts follows the ROOM rule — laundry,
     transport, a damage charge are ancillary to the accommodation and
     carry its rate. The till's own outlets follow theirs, and since
     D18-21 so does the spa: `taxKind` names which, and it is "room"
     for every caller that does not say otherwise. */
  const amount = Math.round(input.amount * 100) / 100;
  const taxKind = input.taxKind ?? "room";
  const taxable = input.taxable ?? true;

  /* ASK BEFORE POSTING, BECAUSE `app.gst_rate` RAISES.
     A property with no rule for this kind is a real and ordinary state —
     the spa's own rule (D18-21) is one somebody sets once, and until they
     do, a treatment cannot be billed at all. `gst_rate` answers that by
     raising, which ABORTS THE TRANSACTION: a caller that meant to refuse
     politely would instead lose everything else it had done, and a
     refusal returned after an abort is a commit of nothing (MEMORY 243).

     So the rate is asked for with `gst_rate_or_null` first and the
     refusal carries the sentence that says what to do. The raise stays
     where it is as the backstop for anybody who posts without asking. */
  if (taxable) {
    const { rows: rate } = await client.query<{ rate: string | null }>(
      "select app.gst_rate_or_null($1, $2, $3::numeric) as rate",
      [hotelId, taxKind, amount],
    );
    if (rate[0]?.rate === null || rate[0]?.rate === undefined) {
      return {
        ok: false,
        reason: `This property has no GST rule for ${taxKind}. Set it in the GST card, under Rooms and rates → Room types or Finance → Invoices. `
              + "A missing rate is not zero - nothing is billed until somebody sets it.",
      };
    }
  }

  /* The FIRST WRITE: `folioFor` opens a folio where the stay has none. It
     sat above the rate check, so a charge refused for a missing rate left
     an empty folio behind, committed (MEMORY 243) - through this route, the
     laundry's and the spa's alike. Every refusal is above it now. */
  const folioId = await folioFor(client, hotelId, stayId);
  if (!folioId) return { ok: false, reason: "Could not open a folio for this stay." };

  const { rows: made } = await client.query<{ id: string }>(
    `insert into folio_postings
       (hotel_id, folio_id, business_date, category, description,
        amount, tax_rate, tax_amount)
     select $1::uuid, $2::uuid, $3::date, $4::text, $5::text, $6::numeric,
            t.rate, round($6::numeric * t.rate / 100.0, 2)
       from (select case when $7::boolean
                         then app.gst_rate($1, $8::text, $6::numeric)
                         else 0::numeric end as rate) t
     returning id::text`,
    [hotelId, folioId, await resolveDate(client, hotelId, input.businessDate),
     CATEGORY[input.category ?? "Miscellaneous"] ?? "misc",
     description, amount, taxable, taxKind],
  );

  return { ok: true, id: made[0]!.id };
}

postings.post("/:code/stays/:id/charges", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    category?: string; description?: string; amount?: number;
    taxable?: boolean; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const posted = await postCharge(client, hotelId, c.req.param("id"), {
      description: body.description ?? "",
      amount: body.amount as number,
      category: body.category,
      taxable: body.taxable,
      businessDate: body.businessDate,
    });
    return posted.ok ? { ok: true, data: { id: posted.id } } : refuse(posted.reason);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Reverse one ─────────────────────────────────────────────────── */

postings.post("/:code/stays/:id/charges/:postingId/reverse", async (c) => {
  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const postingId = c.req.param("postingId");

    const { rows } = await client.query<{
      id: string; folio_id: string; business_date: string; category: string;
      description: string; amount: string; tax_rate: string; tax_amount: string;
      reverses_id: string | null; already: boolean;
      day_closed: boolean;
    }>(
      `select fp.id::text, fp.folio_id, fp.business_date::text, fp.category,
              fp.description, fp.amount, fp.tax_rate, fp.tax_amount,
              fp.reverses_id::text,
              exists (select 1 from folio_postings r where r.reverses_id = fp.id) as already,
              exists (select 1 from night_audit_runs na
                       where na.hotel_id = fp.hotel_id
                         and na.business_date = fp.business_date
                         and na.status = 'completed') as day_closed
         from folio_postings fp
         join folios f on f.id = fp.folio_id
        where f.hotel_id = $1 and f.reservation_id = $2 and fp.id = $3::bigint`,
      [hotelId, c.req.param("id"), postingId],
    );

    const p = rows[0];
    if (!p) return refuse("Posting not found.");
    if (p.already) return refuse("That posting has already been reversed.");
    if (p.reverses_id) return refuse("A reversal cannot itself be reversed.");
    /* A line on a closed day reverses on its own day, which the database
       refuses (012), and this said "Something went wrong". The owner's D24-9
       and D25-11: every charge is corrected on Closed days (the night audit's
       CORRECTABLE); a payment, refund or discount is not changed at all. */
    if (p.day_closed) {
      return refuse(["payment", "refund", "discount", "tax"].includes(p.category)
        ? "This day is closed. Its payments, refunds and discounts are not changed - put the difference right today."
        : "This day is closed - correct it on Closed days.");
    }

    /* The reversal is its OWN row, pointing at what it undoes. The
       original stays exactly as it was — that is the whole point of an
       append-only ledger, and it is why the posting count goes UP.

       No lock. `pms_app` has no UPDATE on this table (append-only), so
       `SELECT ... FOR UPDATE` is refused outright — the permission was
       telling me the lock was the wrong tool. Migration 021 puts a
       unique index on `reverses_id` instead, so two concurrent
       reversals leave one inserted and one refused by the database. */
    try {
      const { rows: made } = await client.query<{ id: string }>(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, reverses_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint)
         returning id::text`,
        [hotelId, p.folio_id, p.business_date, p.category,
         `Reversal - ${p.description}`,
         -Number(p.amount), p.tax_rate, -Number(p.tax_amount), postingId],
      );
      return { ok: true, data: { id: made[0]?.id } };
    } catch (error) {
      /* The index caught a second reversal. That is a refusal a clerk
         can act on, not a server error — somebody else got there
         first, and the credit is already on the folio. */
      if ((error as { code?: string }).code === "23505") {
        return refuse("That posting has already been reversed.");
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Take a payment ──────────────────────────────────────────────── */

postings.post("/:code/stays/:id/payments", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    method?: string; amount?: number; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (!body.amount || body.amount <= 0) {
      return refuse("A payment must be greater than zero.");
    }
    const method = PAYMENT_METHOD[body.method ?? "Cash"];
    if (!method) return refuse(`"${body.method}" is not a payment method.`);

    const folioId = await folioFor(client, hotelId, c.req.param("id"));
    if (!folioId) return refuse("Reservation not found.");

    /* A payment is a NEGATIVE posting. The balance is the sum of the
       ledger, so money received reduces it by being part of the sum —
       there is no separate "paid" column to keep in step. */
    const { rows: made } = await client.query<{ id: string }>(
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description,
          amount, tax_rate, tax_amount)
       values ($1,$2,$3,'payment',$4,$5,0,0)
       returning id::text`,
      [hotelId, folioId,
       await resolveDate(client, hotelId, body.businessDate),
       method === "city_ledger"
         ? "Transferred to city ledger"
         : `Received - ${body.method}`,
       -Math.round(body.amount * 100) / 100],
    );

    await client.query(
      `insert into payments (hotel_id, posting_id, method, amount)
       values ($1, $2::bigint, $3, $4)`,
      [hotelId, made[0]?.id, method, Math.round(body.amount * 100) / 100],
    );

    return { ok: true, data: { id: made[0]?.id } };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
