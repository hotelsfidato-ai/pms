import { Hono } from "hono";
import { withSession } from "../auth.ts";
import { businessDateFor } from "../businessDate.ts";
import type { Client } from "../db.ts";

/* ══════════════════════════════════════════════════════════════════
   TAX INVOICES AND FORM C

   `invoice_series` and app.next_invoice_number() have existed since
   migration 011 and had never been called by anything. The schema was
   right and unused — which looks finished, and is not.

   WHAT IS AND IS NOT DECIDED HERE

   Nothing about tax is computed in this file. The CGST and SGST rates
   come from the property, and the tax AMOUNT comes from the postings
   that were made when the charges were raised. An invoice states what
   was charged; it does not get a second opinion. If the invoice
   recalculated tax and disagreed with the ledger, the ledger would be
   right and the guest would have the wrong document.

   PLACE OF SUPPLY IS THE HOTEL, ALWAYS

   IGST Act s.12(3)(b): accommodation is supplied where the property
   is. So every hotel invoice is intra-state — CGST + SGST, never IGST
   — even for a guest who flew in from Delhi. Charging IGST to
   out-of-state guests is the most common GST error in Indian
   hospitality and takes years to unwind.

   AN ISSUED INVOICE IS NEVER EDITED

   A trigger refuses UPDATE and DELETE at every privilege level. A
   wrong invoice is corrected by a CREDIT NOTE with its own number —
   the same shape as a reversal in the ledger, for the same reason.
   ══════════════════════════════════════════════════════════════════ */

export const invoices = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const, reason, ...extra,
});

async function hotelIdFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── What the folio owes, as an invoice states it ─────────────────── */

interface Totals {
  taxable: number;
  tax: number;
  total: number;
}

/**
 * The invoiceable value of a folio.
 *
 * Excludes payments — an invoice is what is OWED, not what has been
 * settled — and excludes anything reversed or reversing, because a
 * charge that was cancelled was never a supply.
 */
async function totalsFor(client: Client, folioId: string): Promise<Totals> {
  const { rows } = await client.query<{
    taxable: string; tax: string;
  }>(
    /* TAX IS NOT A SUPPLY.
       A posting of category 'tax' carries the tax in `amount`, not in
       `tax_amount` — that is how the real eZee export records tax on
       extras, and how the fixtures reproduce it. The first version of
       this summed every non-payment row into `taxable`, which put ₹925
       of tax into the taxable value of an invoice and then charged CGST
       and SGST on it. Tax on tax, on a document a guest could take to
       their accountant.

       So the two columns are separated by category, not by which field
       happens to be populated:
         taxable  the supplies — room, food, misc and the rest, with
                  `discount` reducing it as a negative, which is what a
                  discount does to a taxable value
         tax      the tax posted alongside each supply, PLUS any
                  standalone 'tax' posting */
    `select coalesce(sum(fp.amount)
              filter (where fp.category <> 'tax'), 0)::text   as taxable,
            (coalesce(sum(fp.tax_amount), 0)
              + coalesce(sum(fp.amount)
                  filter (where fp.category = 'tax'), 0))::text as tax
       from folio_postings fp
      where fp.folio_id = $1
        and fp.category not in ('payment', 'refund')
        and fp.reverses_id is null
        and not exists (
          select 1 from folio_postings rev where rev.reverses_id = fp.id
        )`,
    [folioId],
  );

  const taxable = Number(rows[0]?.taxable ?? 0);
  const tax = Number(rows[0]?.tax ?? 0);
  return {
    taxable: Math.round(taxable * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total: Math.round((taxable + tax) * 100) / 100,
  };
}

/* ── Issue ────────────────────────────────────────────────────────── */

invoices.post("/:code/stays/:id/invoice", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: folio } = await client.query<{
      id: string; guest: string; company: string | null;
      company_gstin: string | null; guest_address: string | null;
      status: string;
    }>(
      `select f.id, g.full_name as guest, co.name as company,
              co.gstin as company_gstin, gd.address_line as guest_address,
              f.status
         from folios f
         join reservations r on r.id = f.reservation_id
         join guests g on g.id = r.guest_id
         left join companies co on co.id = r.company_id
         left join guest_documents gd on gd.guest_id = g.id
        where f.hotel_id = $1 and f.reservation_id = $2`,
      [hotelId, c.req.param("id")],
    );

    if (!folio[0]) return refuse("No folio for that reservation.");
    const f = folio[0];

    /* Serialise issuing for THIS folio, for the length of this
       transaction. Two clicks a hundred milliseconds apart would
       otherwise both find no invoice and both insert one, producing two
       consecutive numbers for the same money — which breaks the series
       as surely as skipping a number does and is far harder to spot.

       A unique index on folio_id was the first attempt and was too
       strict: once an invoice is credited, GST requires a corrected one
       to be issued, and an index predicate cannot see other rows to
       express "one invoice that has not been credited".

       xact-scoped, so it releases on commit or rollback with no
       unlock to forget. */
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [f.id]);

    /* Already invoiced? Answer with the invoice rather than an error.
       A retried request and a second click want the same thing, and a
       unique index below is what actually guarantees it. */
    const { rows: existing } = await client.query<{ number: string }>(
      `select i.number from invoices i
        where i.folio_id = $1
          and i.credits_id is null
          -- ...and has not been credited. A credited invoice is spent:
          -- the money came off, and the guest is owed a correct
          -- document, so the folio may be invoiced again.
          and not exists (
            select 1 from invoices c where c.credits_id = i.id
          )`,
      [f.id],
    );
    if (existing[0]) {
      return { ok: true, duplicate: true, number: existing[0].number };
    }

    const totals = await totalsFor(client, f.id);
    if (totals.total <= 0) {
      return refuse(
        "There is nothing to invoice — the folio carries no charges.",
      );
    }

    const businessDate = await businessDateFor(client, hotelId);

    const { rows: hotel } = await client.query<{
      state: string | null; cgst: string; sgst: string;
    }>(
      `select state, cgst_rate::text as cgst, sgst_rate::text as sgst
         from hotels where id = $1`,
      [hotelId],
    );

    /* CGST and SGST are half the total tax each, by statute — they are
       levied at the same rate on the same value. Split from the tax
       ALREADY POSTED rather than recomputed from the rate, so the
       invoice and the ledger cannot disagree by a rounding paisa.

       The odd paisa goes to CGST. Somewhere has to take it, and saying
       which, once, is better than letting the two halves round
       independently and produce a total that is not the total. */
    const sgst = Math.round(totals.tax * 50) / 100;
    const cgst = Math.round((totals.tax - sgst) * 100) / 100;

    const finYear = await client.query<{ y: string }>(
      "select app.current_fin_year($1) as y", [hotelId],
    );

    const number = await client.query<{ n: string }>(
      "select app.next_invoice_number($1, $2) as n",
      [hotelId, finYear.rows[0]!.y],
    );

    const { rows: made } = await client.query<{ id: string }>(
      `insert into invoices
         (hotel_id, folio_id, fin_year, number, gstin,
          recipient_name, recipient_gstin, recipient_address,
          place_of_supply, taxable_value, cgst_total, sgst_total,
          tax_total, total, business_date, issued_by)
       values ($1,$2,$3,$4,
               (select gstin from hotels where id = $1),
               $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
               app.current_user_id())
       returning id::text`,
      [hotelId, f.id, finYear.rows[0]!.y, number.rows[0]!.n,
       /* The COMPANY is the recipient when there is one — a corporate
          booking's invoice is addressed to the company, and only the
          company can claim the input credit. */
       f.company ?? f.guest, f.company_gstin, f.guest_address,
       hotel[0]?.state, totals.taxable, cgst, sgst, totals.tax,
       totals.total, businessDate],
    );

    return {
      ok: true,
      id: made[0]!.id,
      number: number.rows[0]!.n,
      taxableValue: totals.taxable,
      cgst, sgst,
      taxTotal: totals.tax,
      total: totals.total,
      placeOfSupply: hotel[0]?.state,
      recipient: f.company ?? f.guest,
      businessDate,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Read one, with the lines it was made from ────────────────────── */

invoices.get("/:code/invoices/:number{.+}", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<Record<string, string | null>>(
      `select i.id::text, i.number, i.fin_year,
              to_char(i.issued_at, 'DD Mon YYYY, HH24:MI') as issued_at,
              to_char(i.business_date, 'YYYY-MM-DD') as business_date,
              i.gstin, i.recipient_name, i.recipient_gstin,
              i.recipient_address, i.place_of_supply, i.sac_code,
              i.taxable_value::text, i.cgst_total::text, i.sgst_total::text,
              i.tax_total::text, i.total::text,
              i.credits_id::text, i.reason,
              i.folio_id::text,
              h.name as hotel_name, h.address_line as hotel_address,
              h.city as hotel_city, h.state as hotel_state,
              (h.cgst_rate)::text as cgst_rate, (h.sgst_rate)::text as sgst_rate,
              s.full_name as issued_by
         from invoices i
         join hotels h on h.id = i.hotel_id
         left join staff s on s.id = i.issued_by
        where i.hotel_id = $1 and i.number = $2`,
      [hotelId, c.req.param("number")],
    );

    const i = rows[0];
    if (!i) return null;

    /* The lines. Read from the ledger rather than stored on the
       invoice, because they ARE the ledger — and an invoice that
       carried its own copy could drift from the folio it bills. The
       totals are stored; the detail is derived from immutable rows. */
    const { rows: lines } = await client.query<{
      description: string; category: string; amount: string;
      tax_rate: string; tax_amount: string; business_date: string;
    }>(
      `select fp.description, fp.category, fp.amount::text,
              fp.tax_rate::text, fp.tax_amount::text,
              to_char(fp.business_date,'YYYY-MM-DD') as business_date
         from folio_postings fp
        where fp.folio_id = $1
          and fp.category not in ('payment','refund')
          and fp.reverses_id is null
          and not exists (
            select 1 from folio_postings rev where rev.reverses_id = fp.id
          )
        order by fp.business_date, fp.id`,
      [i["folio_id"]],
    );

    const { rows: credit } = await client.query<{ number: string }>(
      "select number from invoices where credits_id = $1::uuid", [i["id"]],
    );

    return {
      number: i["number"],
      finYear: i["fin_year"],
      issuedAt: i["issued_at"],
      issuedBy: i["issued_by"],
      businessDate: i["business_date"],
      supplier: {
        name: i["hotel_name"], address: i["hotel_address"],
        city: i["hotel_city"], state: i["hotel_state"], gstin: i["gstin"],
      },
      recipient: {
        name: i["recipient_name"], gstin: i["recipient_gstin"],
        address: i["recipient_address"],
      },
      /* Printed on the document. It is the property's state, always. */
      placeOfSupply: i["place_of_supply"],
      sacCode: i["sac_code"],
      /* A 'tax' posting is shown as tax, not as a line of supply —
         the same split the totals use. Presenting it as a taxable line
         would make the printed document disagree with its own footer. */
      lines: lines
        .filter((l) => l.category !== "tax")
        .map((l) => ({
          description: l.description,
          category: l.category,
          amount: Number(l.amount),
          taxRate: Number(l.tax_rate),
          taxAmount: Number(l.tax_amount),
          date: l.business_date,
        })),
      taxableValue: Number(i["taxable_value"]),
      cgst: { rate: Number(i["cgst_rate"]), amount: Number(i["cgst_total"]) },
      sgst: { rate: Number(i["sgst_rate"]), amount: Number(i["sgst_total"]) },
      taxTotal: Number(i["tax_total"]),
      total: Number(i["total"]),
      /* A credit note has these; a tax invoice does not. */
      creditsInvoiceId: i["credits_id"],
      reason: i["reason"],
      creditedBy: credit[0]?.number ?? null,
    };
  });

  return body ? c.json(body) : c.json({ error: "No such invoice." }, 404);
});

/* ── List ─────────────────────────────────────────────────────────── */

invoices.get("/:code/invoices", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      number: string; recipient_name: string | null; total: string;
      tax_total: string; issued_at: string; business_date: string | null;
      credits_id: string | null; credited_by: string | null;
    }>(
      `select i.number, i.recipient_name, i.total::text, i.tax_total::text,
              to_char(i.issued_at, 'DD Mon YYYY') as issued_at,
              to_char(i.business_date, 'YYYY-MM-DD') as business_date,
              i.credits_id::text,
              (select c.number from invoices c where c.credits_id = i.id)
                as credited_by
         from invoices i
        where i.hotel_id = $1
        order by i.issued_at desc, i.number desc
        limit 200`,
      [hotelId],
    );

    return rows.map((r) => ({
      number: r.number,
      recipient: r.recipient_name,
      total: Number(r.total),
      taxTotal: Number(r.tax_total),
      issuedAt: r.issued_at,
      businessDate: r.business_date,
      isCreditNote: r.credits_id !== null,
      creditedBy: r.credited_by,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Correct one ──────────────────────────────────────────────────── */

invoices.post("/:code/invoices/:number{.+}/credit-note", async (c) => {
  const body = await c.req.json<{ reason?: string }>()
    .catch(() => ({} as { reason?: string }));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const reason = body.reason?.trim();
    if (!reason) {
      /* Not a formality. A credit note without a stated reason is the
         document an auditor asks about first. */
      return refuse("A credit note must say why the invoice was wrong.");
    }

    const { rows } = await client.query<{
      id: string; folio_id: string; number: string; fin_year: string;
      recipient_name: string; recipient_gstin: string | null;
      recipient_address: string | null; place_of_supply: string | null;
      taxable_value: string; cgst_total: string; sgst_total: string;
      tax_total: string; total: string; credits_id: string | null;
    }>(
      `select id::text, folio_id::text, number, fin_year, recipient_name,
              recipient_gstin, recipient_address, place_of_supply,
              taxable_value::text, cgst_total::text, sgst_total::text,
              tax_total::text, total::text, credits_id::text
         from invoices where hotel_id = $1 and number = $2`,
      [hotelId, c.req.param("number")],
    );

    const inv = rows[0];
    if (!inv) return refuse("No such invoice.");
    if (inv.credits_id) {
      return refuse("That is already a credit note. It cannot be credited.");
    }

    const { rows: already } = await client.query<{ number: string }>(
      "select number from invoices where credits_id = $1::uuid", [inv.id],
    );
    if (already[0]) {
      /* Idempotent: a retried request must not issue a second credit
         note, which would refund the guest twice on paper. A unique
         index enforces it if two arrive at once. */
      return { ok: true, duplicate: true, number: already[0].number };
    }

    const number = await client.query<{ n: string }>(
      "select app.next_invoice_number($1, $2) as n", [hotelId, inv.fin_year],
    );

    /* Every figure NEGATED. A credit note is not a smaller invoice; it
       is the same supply with the opposite sign, so the two together
       sum to nothing — which is what "this invoice was wrong" means in
       a GST return. */
    await client.query(
      `insert into invoices
         (hotel_id, folio_id, fin_year, number, gstin,
          recipient_name, recipient_gstin, recipient_address,
          place_of_supply, taxable_value, cgst_total, sgst_total,
          tax_total, total, business_date, credits_id, reason, issued_by)
       values ($1,$2,$3,$4,
               (select gstin from hotels where id = $1),
               $5,$6,$7,$8,$9,$10,$11,$12,$13,
               app.business_date($1), $14::uuid, $15,
               app.current_user_id())`,
      [hotelId, inv.folio_id, inv.fin_year, number.rows[0]!.n,
       inv.recipient_name, inv.recipient_gstin, inv.recipient_address,
       inv.place_of_supply,
       -Number(inv.taxable_value), -Number(inv.cgst_total),
       -Number(inv.sgst_total), -Number(inv.tax_total), -Number(inv.total),
       inv.id, reason],
    );

    return {
      ok: true, number: number.rows[0]!.n, credits: inv.number,
      total: -Number(inv.total), reason,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Form C ───────────────────────────────────────────────────────── */

invoices.get("/:code/form-c", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      reservation_id: string; guest_name: string; nationality: string;
      passport: string | null; room_number: string; arrived: string;
      due_by: string; overdue: boolean; filed: boolean;
      reference: string | null;
    }>(
      `select reservation_id::text, guest_name, nationality, passport,
              room_number, to_char(arrived,'YYYY-MM-DD') as arrived,
              to_char(due_by,'DD Mon YYYY, HH24:MI') as due_by,
              overdue, filed, reference
         from app.form_c_due($1)`,
      [hotelId],
    );

    return {
      /* Said on the response, not only in a code comment. Anyone
         building against this must not assume filing happened. */
      note:
        "This system does not file with the FRRO. Filing happens on the " +
        "government portal; this register records who owes one and who did it.",
      due: rows.filter((r) => !r.filed).length,
      overdue: rows.filter((r) => r.overdue).length,
      rows: rows.map((r) => ({
        reservationId: r.reservation_id,
        guest: r.guest_name,
        nationality: r.nationality,
        /* Null when the guest has no document row. A blank passport on
           a register that must be filed is information, not an error to
           hide — somebody has to go and ask for it. */
        passport: r.passport,
        room: r.room_number,
        arrived: r.arrived,
        dueBy: r.due_by,
        overdue: r.overdue,
        filed: r.filed,
        reference: r.reference,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

invoices.post("/:code/form-c/:reservationId", async (c) => {
  const body = await c.req
    .json<{ reference?: string; notes?: string }>()
    .catch(() => ({} as { reference?: string; notes?: string }));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const reference = body.reference?.trim();
    if (!reference) {
      /* The portal's acknowledgement IS the evidence. Recording a
         filing without it produces a register that proves nothing,
         which is worse than an empty one — it reads as compliance. */
      return refuse(
        "The FRRO acknowledgement reference is required. Without it the " +
          "register is a claim, not evidence.",
      );
    }

    const { rows: res } = await client.query<{ guest_id: string }>(
      `select guest_id::text from reservations
        where hotel_id = $1 and id = $2::uuid`,
      [hotelId, c.req.param("reservationId")],
    );
    if (!res[0]) return refuse("No such stay at this property.");

    try {
      await client.query(
        `insert into form_c_filings
           (hotel_id, reservation_id, guest_id, reference, notes, filed_by)
         values ($1, $2::uuid, $3::uuid, $4, $5, app.current_user_id())`,
        [hotelId, c.req.param("reservationId"), res[0].guest_id,
         reference, body.notes ?? null],
      );
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error &&
          (error as { code?: string }).code === "23505") {
        return refuse("That stay has already been filed.");
      }
      throw error;
    }

    return { ok: true, reference };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
