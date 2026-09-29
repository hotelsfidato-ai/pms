import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { resolveDate } from "../../businessDate.ts";
import { folioFor } from "../../folio.ts";
import { inr } from "../../reportRender.ts";
import { overCashLimit, panFor } from "./cashLimit.ts";
import { FOLIO_SELECT, folioBalance } from "./folios.ts";
import { can, type Role } from "../../permissions.ts";

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
  | { ok: false; reason: string; needs?: Needs };
type Needs = "late-reason" | "early-reason" | "pan" | "credit";

const PAYMENT_REVERSAL_WHO =
  "Reversing a payment is for the owner, an administrator, the general manager or the accountant. Ask one of them.";

const refuse = (reason: string, needs?: Needs): Outcome =>
  (needs ? { ok: false, reason, needs } : { ok: false, reason });


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
  /** The desk's `idempotency-key` (011's column): a repeat of one press. */
  idempotencyKey?: string | null;
}

export async function postCharge(
  client: Client, hotelId: string, stayId: string, input: ChargeToPost,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
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

  const refused = await chargeRefused(client, hotelId, input);
  if (refused) return { ok: false, reason: refused };

  /* The FIRST WRITE: `folioFor` opens a folio where the stay has none. It
     sat above the rate check, so a charge refused for a missing rate left
     an empty folio behind, committed (MEMORY 243) - through this route, the
     laundry's and the spa's alike. Every refusal is above it now. */
  const folioId = await folioFor(client, hotelId, stayId);
  if (!folioId) return { ok: false, reason: "Could not open a folio for this stay." };

  return { ok: true, id: await insertCharge(client, hotelId, folioId, input) };
}

/** THE SAME DOOR, BY THE BILL (round E, 28 September): a banquet
    function's bill is a folio with no stay, so its hall and courses are
    posted by the folio's own id - the same checks and the same insert as a
    stay's charge. Whether that folio may take a charge (open, the
    function not cancelled) is the caller's to ask first. */
export async function postFolioCharge(
  client: Client, hotelId: string, folioId: string, input: ChargeToPost,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const { rows } = await client.query(
    "select 1 from folios where id = $1::uuid and hotel_id = $2", [folioId, hotelId]);
  if (!rows.length) return { ok: false, reason: "No such bill." };
  const refused = await chargeRefused(client, hotelId, input);
  if (refused) return { ok: false, reason: refused };
  return { ok: true, id: await insertCharge(client, hotelId, folioId, input) };
}

/** Why a charge may not be posted, or null. Reads only - it sits above
    every write (MEMORY 243). */
async function chargeRefused(
  client: Client, hotelId: string, input: ChargeToPost,
): Promise<string | null> {
  const description = input.description?.trim();
  if (!description) return "A charge needs a description.";
  if (!input.amount) return "A charge of zero is not a charge.";
  /* NO MONEY OFF A BILL BY A MINUS SIGN (QA FI-4): a −₹50 "charge" was a
     discount nobody approved, outside the reversal and its reason. */
  if (!(input.amount > 0)) {
    return "A charge is more than zero. To take money off a bill, reverse the charge it corrects.";
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
      return `This property has no GST rule for ${taxKind}. Set it in the GST card, under Rooms and rates → Room types or Finance → Invoices. `
           + "A missing rate is not zero - nothing is billed until somebody sets it.";
    }
  }
  return null;
}

/** The one insert of a charge. Only after chargeRefused has said nothing. */
async function insertCharge(
  client: Client, hotelId: string, folioId: string, input: ChargeToPost,
): Promise<string> {
  const amount = Math.round(input.amount * 100) / 100;
  const taxKind = input.taxKind ?? "room";
  const taxable = input.taxable ?? true;
  const { rows: made } = await client.query<{ id: string }>(
    `insert into folio_postings
       (hotel_id, folio_id, business_date, category, description,
        amount, tax_rate, tax_amount, idempotency_key)
     select $1::uuid, $2::uuid, $3::date, $4::text, $5::text, $6::numeric,
            t.rate, round($6::numeric * t.rate / 100.0, 2), $9::uuid
       from (select case when $7::boolean
                         then app.gst_rate($1, $8::text, $6::numeric)
                         else 0::numeric end as rate) t
     returning id::text`,
    [hotelId, folioId, await resolveDate(client, hotelId, input.businessDate),
     CATEGORY[input.category ?? "Miscellaneous"] ?? "misc",
     input.description.trim(), amount, taxable, taxKind, input.idempotencyKey ?? null],
  );

  return made[0]!.id;
}

/** The line already posted under this key, if any: asked before anything is
    written or refused, so a repeat gets the first answer (folio_postings_idem_idx,
    011, is the guarantee behind it). */
async function postedWith(client: Client, hotelId: string, key: string | null) {
  if (!key) return null;
  const { rows } = await client.query<{ id: string }>(
    "select id::text from folio_postings where hotel_id = $1 and idempotency_key = $2",
    [hotelId, key]);
  return rows[0]?.id ?? null;
}

postings.post("/:code/stays/:id/charges", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    category?: string; description?: string; amount?: number;
    taxable?: boolean; businessDate?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* ONE PRESS, ONE CHARGE (28 September, the release review): a repeat
       of a press the ledger already holds answers with that line. */
    const key = c.req.header("idempotency-key") ?? null;
    const done = await postedWith(client, hotelId, key);
    if (done) return { ok: true, data: { id: done } };

    const posted = await postCharge(client, hotelId, c.req.param("id"), {
      description: body.description ?? "",
      amount: body.amount as number,
      category: body.category,
      taxable: body.taxable,
      businessDate: body.businessDate,
      idempotencyKey: key,
    });
    return posted.ok ? { ok: true, data: { id: posted.id } } : refuse(posted.reason);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Reverse one ─────────────────────────────────────────────────── */

postings.post("/:code/stays/:id/charges/:postingId/reverse", async (c) => {
  /* D27-117: "Are you sure?", with a REQUIRED reason - asked here too, not
     only by the dialog. It went at once on one click (QA FI-5). */
  const reason = ((await c.req.json().catch(() => ({}))) as { reason?: string }).reason?.trim();

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const done = await reverseFolioCharge(client, hotelId, c.req.param("postingId"), reason,
      { reservationId: c.req.param("id") });
    return done.ok ? { ok: true, data: { id: done.id } } : refuse(done.reason);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});

/**
 * Takes one line off a bill: its own reversal line, pointing at it, with the
 * reason on it (D27-117). The ↺ route and a function's reopened bill
 * (banquet, D27-154) both come here, so there is one insert for a reversal.
 * `within` is the bill the line must be on: a stay's, or one folio.
 *
 * Answers {ok:false, reason} for a refusal and never throws for one: a
 * refusal returned inside `withSession` is a COMMIT (MEMORY 243), so a
 * caller that has already written must throw on it.
 */
export async function reverseFolioCharge(
  client: Client, hotelId: string, postingId: string, reason: string | undefined,
  within: { reservationId: string } | { folioId: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const [column, value] = "folioId" in within
    ? ["f.id", within.folioId] : ["f.reservation_id", within.reservationId];
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
      where f.hotel_id = $1 and ${column} = $2 and fp.id = $3::bigint`,
    [hotelId, value, postingId],
  );
  const no = (why: string) => ({ ok: false as const, reason: why });

  const p = rows[0];
  if (!p) return no("Posting not found.");
  if (p.already) return no("That posting has already been reversed.");
  if (p.reverses_id) return no("A reversal cannot itself be reversed.");
  /* A line on a closed day reverses on its own day, which the database
     refuses (012), and this said "Something went wrong". The owner's D24-9
     and D25-11: every charge is corrected on Closed days (the night audit's
     CORRECTABLE); a payment, refund or discount is not changed at all. */
  if (p.day_closed) {
    return no(["payment", "refund", "discount", "tax"].includes(p.category)
      ? "This day is closed. Its payments, refunds and discounts are not changed - put the difference right today."
      : "This day is closed - correct it on Closed days.");
  }

  if (!reason) return no("Say why it is being reversed. The reason stays on the line.");
  /* A PAYMENT IS UNDONE BY A MANAGER (the owner's D27-125, QA FI-5): a
     clerk could take cash and reverse the receipt. The owner, an
     administrator, the GM or the accountant - `approve` on an invoice,
     the four who cancel an invoice. A charge stays reception's. */
  if (p.category === "payment") {
    const { rows: me } = await client.query<{ role: string | null }>(
      `select case when exists (select 1 from staff s
                                 where s.id = app.current_user_id() and s.is_group_admin)
                   then 'owner'
                   else (select sh.role from staff_hotels sh
                          where sh.staff_id = app.current_user_id() and sh.hotel_id = $1)
              end as role`, [hotelId]);
    if (!can((me[0]?.role ?? "") as Role, "approve", "invoice")) {
      return no(PAYMENT_REVERSAL_WHO);
    }
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
       /* The reason rides on the reversal's own line, which the desk
          reads and the guest's bill and invoice never print (both
          leave a reversed pair out). */
       `Reversal - ${p.description} (why: ${reason})`,
       -Number(p.amount), p.tax_rate, -Number(p.tax_amount), postingId],
    );
    return { ok: true, id: made[0]!.id };
  } catch (error) {
    /* The index caught a second reversal. That is a refusal a clerk
       can act on, not a server error — somebody else got there
       first, and the credit is already on the folio. */
    if ((error as { code?: string }).code === "23505") {
      return no("That posting has already been reversed.");
    }
    throw error;
  }
}

/* ── Take a payment ──────────────────────────────────────────────── */

/** What is paid, as the desk (or a service) hands it over. */
export interface PaymentToTake {
  method?: string | undefined;
  amount?: number | undefined;
  businessDate?: string | undefined;
  /* D25-40: asked when more than ₹1,00,000 is paid in cash at once. */
  pan?: string | undefined;
  form97?: boolean | undefined;
  /* D27-4: the desk confirmed a payment larger than the bill. */
  heldAsCredit?: boolean | undefined;
  /* One press, one payment (28 September). */
  idempotencyKey?: string | null | undefined;
}

/** WHO IS PAYING - the caller's part. The stay route: the guest's and the
    group's turns, the cash this guest has already paid (app.cash_taken), the
    guest's nationality. A banquet function (round E): its own turn and the
    cash taken on that function's bill (s.269ST's "one event"). */
export interface Payer {
  /** Advisory locks, taken in this order, before anything is counted. */
  locks: string[];
  /** Cash already received from this payer, read AFTER the locks. */
  cashTaken: () => Promise<number>;
  /** A payer from abroad is not asked for a PAN (D25-40). */
  foreign: boolean;
  /** What the bill owes, for D27-4. Default: the folio's own balance. */
  owed?: () => Promise<number>;
  /** Only where `folioId` is null: open the bill the payment goes on. It is a
      write, so it runs after every refusal (MEMORY 243, FIN-7). */
  openFolio?: () => Promise<string | null>;
}

/* ══════════════════════════════════════════════════════════════════
   THE DOOR A PAYMENT REACHES A BILL THROUGH (28 September)

   Keyed by the FOLIO, not the stay. A split bill's Settle paid the stay's
   first folio whichever bill was open (QA FI-2), and a banquet function's
   bill has no stay at all. So the route below and the banquet both call
   this, and there is still one insert for a payment, with the same checks
   in front of it. Every refusal is above the first write (MEMORY 243);
   a refusal is returned, never thrown.
   ══════════════════════════════════════════════════════════════════ */
export async function takeFolioPayment(
  client: Client, hotelId: string, folioId: string | null,
  input: PaymentToTake, payer: Payer,
): Promise<{ ok: true; id: string } | { ok: false; reason: string; needs?: Needs }> {
  if (!input.amount || input.amount <= 0) {
    return { ok: false, reason: "A payment must be greater than zero." };
  }
  const method = PAYMENT_METHOD[input.method ?? "Cash"];
  if (!method) return { ok: false, reason: `"${input.method}" is not a payment method.` };
  const amount = Math.round(input.amount * 100) / 100;

  if (folioId) {
    const { rows } = await client.query(
      "select 1 from folios where id = $1::uuid and hotel_id = $2", [folioId, hotelId]);
    if (!rows.length) return { ok: false, reason: "No such bill." };
  }
  const businessDate = await resolveDate(client, hotelId, input.businessDate);

  /* ONE PAYER'S PAYMENTS TAKE TURNS (the owner's D27-2): two clerks taking
     cash for one guest in the same second both read the cash already taken
     before either wrote, and both passed. Held to the end of this
     transaction; the counts below are read after it. Every payment waits,
     not only cash: the bill read for D27-4 has the same race. */
  for (const key of payer.locks) {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }

  /* ONE PRESS, ONE PAYMENT (28 September): after the payer's turn, so two
     presses cannot both miss it, and before the cash counts, which would
     otherwise count the first press against the repeat. */
  const done = await postedWith(client, hotelId, input.idempotencyKey ?? null);
  if (done) return { ok: true, id: done };

  /* D25-40 - asked BEFORE any folio is opened (MEMORY 243). */
  let pan: string | null = null;
  let form97 = false;
  if (method === "cash") {
    /* EVERY RUPEE BELONGS TO A SHIFT (the owner's D27-118, QA FI-13): cash
       taken with no drawer open showed "Cash taken ₹0" on the drawer opened
       later. The person taking it must hold an open drawer here - the drawer
       counts what its holder took (app.cashier_expected_cash). */
    const { rows: drawer } = await client.query(
      `select 1 from cashier_shifts
        where hotel_id = $1 and staff_id = app.current_user_id() and closed_at is null`,
      [hotelId]);
    if (!drawer.length) {
      return {
        ok: false,
        reason: "Open your cash drawer first (Cashiering): cash is taken only into an open drawer, so every rupee belongs to a shift. Card, UPI and the rest need no drawer.",
      };
    }
    const over = overCashLimit(await payer.cashTaken(), amount,
      "card, UPI, cheque or bank transfer");
    if (over) return { ok: false, reason: over };
    const kept = panFor(amount, { pan: input.pan, form97: input.form97, foreign: payer.foreign });
    if (!kept.ok) return { ok: false, reason: kept.reason, needs: "pan" };
    ({ pan, form97 } = kept);
  }

  /* MORE THAN THE BILL (the owner's D27-4): taken only once the desk has
     confirmed it is held as the guest's credit. */
  const owed = payer.owed ? await payer.owed()
    : folioId ? (await folioBalance(client, folioId))?.balance ?? 0 : 0;
  const extra = Math.round((amount - Math.max(owed, 0)) * 100) / 100;
  if (extra > 0 && input.heldAsCredit !== true) {
    return {
      ok: false, needs: "credit",
      reason: `This is ₹${inr(extra)} more than the bill; it will be held as the guest's credit.`,
    };
  }

  const folio = folioId ?? (await payer.openFolio?.()) ?? null;
  if (!folio) return { ok: false, reason: "There is no bill to take this payment on." };

  /* A payment is a NEGATIVE posting. The balance is the sum of the
     ledger, so money received reduces it by being part of the sum —
     there is no separate "paid" column to keep in step. */
  const { rows: made } = await client.query<{ id: string }>(
    `insert into folio_postings
       (hotel_id, folio_id, business_date, category, description,
        amount, tax_rate, tax_amount, idempotency_key)
     values ($1,$2,$3,'payment',$4,$5,0,0,$6)
     returning id::text`,
    [hotelId, folio, businessDate,
     method === "city_ledger" ? "Transferred to city ledger" : `Received - ${input.method ?? "Cash"}`,
     -amount, input.idempotencyKey ?? null],
  );

  await client.query(
    `insert into payments (hotel_id, posting_id, method, amount, pan, form_97)
     values ($1, $2::bigint, $3, $4, $5, $6)`,
    [hotelId, made[0]!.id, method, amount, pan, form97],
  );

  return { ok: true, id: made[0]!.id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

postings.post("/:code/stays/:id/payments", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as PaymentToTake & {
    /* Which bill, when the stay's is split (QA FI-2). Without it, the
       stay's first bill, as before. */
    folioId?: string;
  };

  const result = await withSession(c.get("subject"), async (client): Promise<Outcome | null> => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const stayId = c.req.param("id");

    const { rows: stay } = await client.query<{
      guest_id: string; group_id: string | null; foreign: boolean;
    }>(
      `select r.guest_id::text, r.group_id::text, g.nationality <> 'IN' as foreign
         from reservations r join guests g on g.id = r.guest_id
        where r.hotel_id = $1 and r.id = $2`,
      [hotelId, stayId]);
    if (!stay[0]) return refuse("Reservation not found.");

    if (body.folioId !== undefined && !UUID.test(String(body.folioId))) {
      return refuse("That bill is not on this stay.");
    }
    const { rows: bills } = await client.query<{ id: string }>(
      `select id::text from folios
        where hotel_id = $1 and reservation_id = $2 and ($3::uuid is null or id = $3::uuid)
        order by opened_at, id limit 1`,
      [hotelId, stayId, body.folioId ?? null]);
    if (body.folioId && !bills[0]) return refuse("That bill is not on this stay.");

    const taken = await takeFolioPayment(client, hotelId, bills[0]?.id ?? null, {
      ...body, idempotencyKey: c.req.header("idempotency-key") ?? null,
    }, {
      /* The guest's turn, then the group's - always in that order, so two
         payments never wait on each other. */
      locks: [`payment-guest:${stay[0].guest_id}`,
              ...(stay[0].group_id ? [`payment-group:${stay[0].group_id}`] : [])],
      cashTaken: async () => {
        const { rows: cash } = await client.query<{ taken: string }>(
          "select app.cash_taken($1, $2::date)::text as taken",
          [stayId, await resolveDate(client, hotelId, body.businessDate)]);
        return Number(cash[0]!.taken);
      },
      foreign: stay[0].foreign,
      /* A named bill owes its own balance. Unnamed, the stay's, as the Settle
         dialog showed it - which counts a group master folio's lines for
         this stay too. */
      ...(body.folioId ? {} : {
        owed: async () => {
          const { rows: bill } = await client.query<{ balance: string }>(
            `${FOLIO_SELECT} having l.reservation_id = $2`, [hotelId, stayId]);
          return Number(bill[0]?.balance ?? 0);
        },
      }),
      openFolio: () => folioFor(client, hotelId, stayId),
    });
    return taken.ok ? { ok: true, data: { id: taken.id } } : refuse(taken.reason, taken.needs);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, result.ok ? 200 : 409);
});
