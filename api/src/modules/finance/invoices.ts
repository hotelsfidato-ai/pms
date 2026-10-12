import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import { businessDateFor } from "../../businessDate.ts";
import type { Client } from "../../db.ts";

/* ══════════════════════════════════════════════════════════════════
   TAX INVOICES AND FORM C

   `invoice_series` and app.next_invoice_number() have existed since
   migration 011 and had never been called by anything. The schema was
   right and unused — which looks finished, and is not.

   WHAT IS AND IS NOT DECIDED HERE

   Nothing about tax is computed in this file. Every rate and every
   amount comes from the postings that were made when the charges were
   raised, each carrying the rate it was charged at. An invoice states
   what was charged; it does not get a second opinion. If the invoice
   recalculated tax and disagreed with the ledger, the ledger would be
   right and the guest would have the wrong document.

   Since 067 one bill can hold more than one rate — a room under the
   tariff threshold at 5% beside a suite above it at 18% — so the
   header names a single rate only when the lines agree on one.

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

/* Split on 15 September in the service-folder move
   (docs/SERVICE-FOLDERS-PLAN.md). Invoices, credit notes and the invoice
   series stay here, in finance. The two Form C endpoints went to guests
   (formC.ts). Nothing inside an endpoint changed. */

export const invoices = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const, reason, ...extra,
});

/** The owner's words, 28 September: where the GSTIN is typed is Properties. */
export const noGstin = (document: string, it: string) =>
  `This property has no GSTIN, and ${document} must carry one. Enter it on the `
  + `Properties screen, then issue ${it}.`;

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
        /* GST SUPPLIES ONLY. Alcohol is VAT (D21-91): it stays on the
           guest's bill as its own "VAT 10%" line and is kept out of the
           GST invoice, and so out of the GST sales register that is read
           from these invoices. */
        and fp.tax_scheme = 'gst'
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

/** Who a tax invoice is addressed to: printed as they are, never made up. */
export interface InvoiceRecipient {
  name: string;
  gstin: string | null;
  address: string | null;
}

/* WHO ONE BILL OF A STAY IS ADDRESSED TO (QA FI-1, 28 September).
   A company's bill: that company. A guest's bill: the booking's company only
   while the stay has no company bill of its own - a corporate booking with
   one bill is invoiced to the company, as before; once the bill is split,
   the guest's own lines are the guest's. It read the booking's company for
   whichever bill it met first, so a split stay's invoice went to Agoda
   carrying the guest's coffee.
   Aliases: f (folios), r (reservations). The Invoices list reads the same
   expression, so the row and the document name the same party. */
export const RECIPIENT_COMPANY = `
  case when f.bill_to = 'company' then f.company_id
       when not exists (select 1 from folios o
                         where o.reservation_id = f.reservation_id
                           and o.bill_to = 'company') then r.company_id
  end`;

/* ══════════════════════════════════════════════════════════════════
   THE DOOR A TAX INVOICE IS ISSUED THROUGH (28 September)

   One invoice per BILL (folio). The stay's route below chooses the bill and
   its recipient; a banquet function (round E) calls this with its own, and
   with its own SAC (996334 or 997212 - banquet's choice). Everything else is
   here once: the per-bill turn, "already invoiced", nothing under GST, the
   hotel's GSTIN, the number, the VAT bill. A refusal is returned, never
   thrown, and every refusal is above the number (MEMORY 243).
   ══════════════════════════════════════════════════════════════════ */
export async function issueFolioInvoice(
  client: Client, hotelId: string, folioId: string,
  recipient: InvoiceRecipient, sac?: string,
) {
  const { rows: known } = await client.query(
    "select 1 from folios where id = $1::uuid and hotel_id = $2", [folioId, hotelId]);
  if (!known.length) return refuse("No such bill.");

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
    [folioId]);

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
    [folioId],
  );
  if (existing[0]) {
    return { ok: true as const, duplicate: true, number: existing[0].number };
  }

  const totals = await totalsFor(client, folioId);
  if (totals.total <= 0) {
    return refuse(
      "There is nothing to invoice - the folio carries no charges under GST. "
      + "Alcohol is billed under VAT and is not on a GST invoice.",
    );
  }

  const businessDate = await businessDateFor(client, hotelId);

  /* Only the state, now. This also selected `cgst_rate` and
     `sgst_rate` and did nothing with them — the split below is
     computed from the tax the postings actually carry, and has been
     since it was written. Two dead columns that looked like the
     source of the numbers under them. */
  const { rows: hotel } = await client.query<{ state: string | null; gstin: string | null }>(
    "select state, gstin from hotels where id = $1",
    [hotelId],
  );
  /* NO GSTIN, NO TAX INVOICE (CGST Rule 46(a); 28 September, the release
     review): it printed "-" as the supplier's GSTIN. Above the number,
     which is the first write (MEMORY 243). */
  if (!hotel[0]?.gstin?.trim()) return refuse(noGstin("a tax invoice", "the invoice"));

  /* CGST and SGST are half the total tax each, by statute — they are
     levied at the same rate on the same value. Split from the tax
     ALREADY POSTED rather than recomputed from the rate, so the
     invoice and the ledger cannot disagree by a rounding paisa.

     The odd paisa goes to CGST. Somewhere has to take it, and saying
     which, once, is better than letting the two halves round
     independently and produce a total that is not the total.

     IN WHOLE PAISE (the review of 1 October): this rounded a float
     `tax * 50`, which gave the odd paisa to SGST - ₹0.05 of tax printed CGST
     0.02 / SGST 0.03 while the bill (app.stay_bill) printed 0.03 / 0.02. */
  const taxPaise = Math.round(totals.tax * 100);
  const cgstPaise = Math.ceil(taxPaise / 2);
  const cgst = cgstPaise / 100;
  const sgst = (taxPaise - cgstPaise) / 100;

  const finYear = await client.query<{ y: string }>(
    "select app.current_fin_year($1) as y", [hotelId],
  );

  const number = await client.query<{ n: string }>(
    "select app.next_invoice_number($1, $2) as n",
    [hotelId, finYear.rows[0]!.y],
  );

  /* The SAC only when the caller names one: otherwise the column's own
     default (996311, accommodation) stands, written in one place. */
  const { rows: made } = await client.query<{ id: string }>(
    `insert into invoices
       (hotel_id, folio_id, fin_year, number, gstin, fssai_number,
        recipient_name, recipient_gstin, recipient_address,
        place_of_supply, taxable_value, cgst_total, sgst_total,
        tax_total, total, business_date, issued_by, sac_by_kind${sac ? ", sac_code" : ""})
     values ($1,$2,$3,$4,
             (select gstin from hotels where id = $1),
             (select fssai_number from hotels where id = $1),
             $5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             app.current_user_id(),
             /* Each kind's SAC as it is now, frozen with the invoice (D27-258 Q6, 197). */
             (select coalesce(jsonb_object_agg(t.kind, t.sac_code), '{}'::jsonb)
                from tax_sac t where t.hotel_id = $1)${sac ? ", $15" : ""})
     returning id::text`,
    [hotelId, folioId, finYear.rows[0]!.y, number.rows[0]!.n,
     recipient.name, recipient.gstin, recipient.address,
     hotel[0]?.state, totals.taxable, cgst, sgst, totals.tax,
     totals.total, businessDate, ...(sac ? [sac] : [])],
  );

  /* D22-44: the folio's alcohol gets its own VAT bill, in this same
     transaction - both documents exist, or neither does. Null when the
     folio carries no VAT. */
  const { rows: vat } = await client.query<{ n: string | null }>(
    "select app.issue_vat_bill($1, null) as n", [made[0]!.id],
  );

  return {
    ok: true as const,
    id: made[0]!.id,
    number: number.rows[0]!.n,
    vatBill: vat[0]!.n,
    taxableValue: totals.taxable,
    cgst, sgst,
    taxTotal: totals.tax,
    total: totals.total,
    placeOfSupply: hotel[0]?.state,
    recipient: recipient.name,
    businessDate,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

invoices.post("/:code/stays/:id/invoice", async (c) => {
  /* WHICH BILL (QA FI-1): a split stay has one invoice per bill. It took
     the stay's first folio in no order, so a stay with two bills was
     invoiced from either (FIN-10). */
  const body = await c.req.json<{ folioId?: string }>().catch(() => ({} as { folioId?: string }));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    if (body.folioId !== undefined && !UUID.test(String(body.folioId))) {
      return refuse("That bill is not on this stay.");
    }

    const { rows: bills } = await client.query<{
      id: string; name: string; gstin: string | null; address: string | null;
      charged: boolean;
    }>(
      `select f.id::text,
              coalesce(co.name, g.full_name) as name,
              nullif(co.gstin, '') as gstin,
              /* The recipient's name and address come from the same party
                 (CGST Rule 46(e)): a company's line and city, never the
                 guest's home under the company's name. */
              case when co.id is not null
                   then nullif(concat_ws(', ', nullif(co.address_line, ''),
                                               nullif(co.city, '')), '')
                   else gd.address_line end as address,
              exists (select 1 from folio_postings fp
                       where fp.folio_id = f.id
                         and fp.category not in ('payment', 'refund')
                         and fp.reverses_id is null
                         and not exists (select 1 from folio_postings rev
                                          where rev.reverses_id = fp.id)) as charged
         from folios f
         join reservations r on r.id = f.reservation_id
         join guests g on g.id = r.guest_id
         left join companies co on co.id = ${RECIPIENT_COMPANY}
         left join guest_documents gd on gd.guest_id = g.id
        where f.hotel_id = $1 and f.reservation_id = $2
          and ($3::uuid is null or f.id = $3::uuid)
        order by f.opened_at, f.id`,
      [hotelId, c.req.param("id"), body.folioId ?? null],
    );

    if (!bills[0]) {
      return refuse(body.folioId ? "That bill is not on this stay." : "No folio for that reservation.");
    }
    /* Unnamed, an empty second bill is not a choice (FIN-10): only the bills
       that carry a charge are. Two of those is a split stay - say which. */
    const charged = bills.filter((b) => b.charged);
    if (!body.folioId && charged.length > 1) {
      return refuse("This stay's bill is split: each bill is its own tax invoice. Say which bill to invoice.");
    }
    const { id, charged: _, ...recipient } = (body.folioId ? bills[0] : charged[0] ?? bills[0])!;
    return issueFolioInvoice(client, hotelId, id, recipient);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* A GROUP'S MASTER BILL (the owner's D27-305 (10)): its tax invoice through
   the same door and series. Addressed as a stay's: the company the master is
   billed to, else the person who leads the group (D22-52), else the group's
   own name. Not sent by itself (D27-284): app.guest_invoices_owed reads only
   a stay's bills. */
invoices.post("/:code/groups/:id/invoice", async (c) => {
  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const groupId = c.req.param("id");
    if (!UUID.test(groupId)) return refuse("No such group.");

    const { rows: [master] } = await client.query<{
      id: string; name: string; gstin: string | null; address: string | null;
    }>(
      `select f.id::text,
              coalesce(co.name, gu.full_name, g.name) as name,
              nullif(co.gstin, '') as gstin,
              case when co.id is not null
                   then nullif(concat_ws(', ', nullif(co.address_line, ''),
                                               nullif(co.city, '')), '')
                   else gd.address_line end as address
         from folios f
         join reservation_groups g on g.id = f.group_id
         left join companies co on co.id = f.company_id
         left join reservations r on r.id = app.group_lead(g.id)
         left join guests gu on gu.id = r.guest_id
         left join guest_documents gd on gd.guest_id = gu.id
        where f.hotel_id = $1 and f.group_id = $2 and f.status = 'open'`,
      [hotelId, groupId]);
    if (!master) return refuse("This group has no host account to invoice.");

    const { id, ...recipient } = master;
    return issueFolioInvoice(client, hotelId, id, recipient);
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/** A line's SAC: its kind's, frozen on the invoice; a room line falls back to
    the invoice's own code; anything else unsaid is null (a dash). */
export function sacOf(kind: string | null, byKind: Record<string, string> | null, invoiceSac: string): string | null {
  if (kind && byKind?.[kind]) return byKind[kind]!;
  return kind === "room" ? invoiceSac : null;
}

/* ── Read one, with the lines it was made from ────────────────────── */


/** Half of the invoice's tax rate, for the CGST and SGST columns of the
    header — or null when the lines do not share one rate, because then
    there is no single rate the header can honestly name. */
function halfRate(lines: { tax_rate: string }[]): number | null {
  const rates = new Set(lines.map((l) => Number(l.tax_rate)));
  if (rates.size !== 1) return null;
  const [only] = [...rates];
  return Math.round((only! / 2) * 100) / 100;
}

invoices.get("/:code/invoices/:number{.+}", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    return hotelId ? invoiceFacts(client, hotelId, c.req.param("number")) : null;
  });

  return body ? c.json(body) : c.json({ error: "No such invoice." }, 404);
});

/** One invoice as the printed document shows it - the screen's route above
    and the invoice sent to the guest (guest-messaging, D27-252) read this
    one query, so the two cannot disagree. Null: no such invoice that this
    person may read. */
export async function invoiceFacts(client: Client, hotelId: string, number: string) {
  const { rows } = await client.query<Record<string, string | null>>(
    `select i.id::text, i.number, i.fin_year,
            to_char(i.issued_at, 'DD Mon YYYY, HH24:MI') as issued_at,
            to_char(i.business_date, 'YYYY-MM-DD') as business_date,
            i.gstin, i.recipient_name, i.recipient_gstin,
            i.recipient_address, i.place_of_supply, i.sac_code, i.sac_by_kind,
            i.taxable_value::text, i.cgst_total::text, i.sgst_total::text,
            i.tax_total::text, i.total::text,
            i.credits_id::text, i.reason,
            -- The NUMBER of the invoice this note cancels. The id is a
            -- uuid, and "cancels 7f3a-..." on a printed document tells
            -- a guest nothing.
            (select o.number from invoices o where o.id = i.credits_id)
              as credits_number,
            -- D22-44: the VAT bill issued with it, for the alcohol - or,
            -- on an invoice issued again after a credit note, the VAT bill
            -- still standing for the same bill, which was not issued twice
            -- (the owner, 24 September). A credit note names none.
            coalesce(
              (select v.number from vat_bills v where v.invoice_id = i.id),
              (select v.number from vat_bills v
                where i.credits_id is null and v.folio_id = i.folio_id
                  and not exists (select 1 from vat_bills c where c.cancels_id = v.id)))
              as vat_bill,
            i.folio_id::text,
            h.name as hotel_name, h.address_line as hotel_address,
            h.city as hotel_city, h.state as hotel_state,
            i.fssai_number,
            s.full_name as issued_by
       from invoices i
       join hotels h on h.id = i.hotel_id
       left join staff s on s.id = i.issued_by
      where i.hotel_id = $1 and i.number = $2`,
    [hotelId, number],
  );

  const i = rows[0];
  if (!i) return null;

  /* The lines. Read from the ledger rather than stored on the
     invoice, because they ARE the ledger — and an invoice that
     carried its own copy could drift from the folio it bills. The
     totals are stored; the detail is derived from immutable rows. */
  const { rows: lines } = await client.query<{
    description: string; category: string; amount: string;
    tax_rate: string; tax_amount: string; business_date: string; tax_kind: string | null;
  }>(
    `select fp.description, fp.category, fp.amount::text,
            fp.tax_rate::text, fp.tax_amount::text, fp.tax_kind,
            to_char(fp.business_date,'YYYY-MM-DD') as business_date
       from folio_postings fp
      where fp.folio_id = $1
        and fp.category not in ('payment','refund')
        -- The invoice's own supplies: GST only, as its totals (D21-91).
        and fp.tax_scheme = 'gst'
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
      /* A16: printed when the invoice carries food - the number the
         invoice was issued with, frozen like the GSTIN (D27-3). */
      fssai: i["fssai_number"],
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
        /* The SAC of the kind it was taxed under, as the invoice was issued
           (D27-258 Q6): a room line with none is the invoice's own (996311);
           any other with none - or an invoice from before - is null, a dash. */
        sac: sacOf(l.tax_kind ?? (l.category === "room" ? "room" : null),
                   i["sac_by_kind"] as Record<string, string> | null, i["sac_code"] as string),
      })),
    taxableValue: Number(i["taxable_value"]),
    /* THE HEADER RATE COMES FROM THE LINES, OR IT IS NOT SHOWN.
       This used to print `hotels.cgst_rate` and `hotels.sgst_rate` —
       the property's single configured pair — beside totals summed
       from postings that each carry their own rate. That was already
       a second source of truth; since 067 it is also wrong in a way a
       guest can see, because a bill can now hold a ₹4,000 room at 5%
       and a ₹9,000 suite at 18%.

       One rate across every line is the ordinary case and is shown.
       Where they differ there is no single rate to name, and a GST
       invoice states the rate-wise breakdown instead — which the
       lines above already carry, each with its own. Null here, and
       the document shows the split rather than inventing an average
       nobody was charged. */
    cgst: { rate: halfRate(lines), amount: Number(i["cgst_total"]) },
    sgst: { rate: halfRate(lines), amount: Number(i["sgst_total"]) },
    taxTotal: Number(i["tax_total"]),
    total: Number(i["total"]),
    /* A credit note has these; a tax invoice does not. */
    creditsInvoiceId: i["credits_id"],
    creditsNumber: i["credits_number"],
    reason: i["reason"],
    creditedBy: credit[0]?.number ?? null,
    vatBill: i["vat_bill"],
  };
}

export type InvoiceFacts = NonNullable<Awaited<ReturnType<typeof invoiceFacts>>>;

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

/* ── The series itself ────────────────────────────────────────────── */

invoices.get("/:code/invoice-series", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      fin_year: string; prefix: string; next_number: string; issued: string;
    }>(
      `select s.fin_year, s.prefix, s.next_number::text,
              (select count(*) from invoices i
                where i.hotel_id = s.hotel_id and i.fin_year = s.fin_year)::text
                as issued
         from invoice_series s
        where s.hotel_id = $1
        order by s.fin_year desc`,
      [hotelId],
    );

    return rows.map((r) => ({
      prefix: r.prefix,
      finYear: r.fin_year,
      /* The number the NEXT invoice will carry, formatted exactly as
         app.next_invoice_number() will format it. Two spellings of the
         same number is how a series appears to skip one. */
      next: `${r.prefix}/${r.fin_year}/${String(r.next_number).padStart(5, "0")}`,
      issued: Number(r.issued),
      note:
        Number(r.issued) === 0
          ? "Nothing issued in this year yet."
          : `${r.issued} issued in ${r.fin_year}.`,
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

    /* A credit note carries the supplier's GSTIN too (CGST Rule 53; the
       owner, 28 September). Above the number, as the invoice's. */
    const { rows: gstin } = await client.query<{ gstin: string | null }>(
      "select gstin from hotels where id = $1", [hotelId]);
    if (!gstin[0]?.gstin?.trim()) return refuse(noGstin("a credit note", "the credit note"));

    const number = await client.query<{ n: string }>(
      "select app.next_invoice_number($1, $2) as n", [hotelId, inv.fin_year],
    );

    /* Every figure NEGATED. A credit note is not a smaller invoice; it
       is the same supply with the opposite sign, so the two together
       sum to nothing — which is what "this invoice was wrong" means in
       a GST return. */
    await client.query(
      `insert into invoices
         (hotel_id, folio_id, fin_year, number, gstin, fssai_number,
          recipient_name, recipient_gstin, recipient_address,
          place_of_supply, taxable_value, cgst_total, sgst_total,
          tax_total, total, business_date, credits_id, reason, issued_by)
       values ($1,$2,$3,$4,
               (select gstin from hotels where id = $1),
               (select fssai_number from hotels where id = $1),
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

/* ══════════════════════════════════════════════════════════════════
   VAT BILLS FOR ALCOHOL (the owner's D22-44)

   Issued by app.issue_vat_bill beside the GST document of the same sale:
   the stay's tax invoice above, or the restaurant's settlement (pos
   till.ts). Numbered from their own series, VAT/5EL/2026-27/0001, which
   never shares a number with a GST invoice. Read and cancelled here, the
   way an invoice is: a cancellation is its own numbered bill, every
   figure negated, with a reason.
   ══════════════════════════════════════════════════════════════════ */

invoices.get("/:code/vat-bills", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      number: string; recipient_name: string | null; total: string;
      vat_total: string; issued_at: string; is_cancellation: boolean;
      cancelled_by: string | null;
    }>(
      `select v.number, v.recipient_name, v.total::text, v.vat_total::text,
              to_char(v.issued_at, 'DD Mon YYYY') as issued_at,
              v.cancels_id is not null as is_cancellation,
              (select c.number from vat_bills c where c.cancels_id = v.id) as cancelled_by
         from vat_bills v
        where v.hotel_id = $1
        order by v.issued_at desc, v.number desc
        limit 200`,
      [hotelId],
    );

    return rows.map((r) => ({
      number: r.number,
      recipient: r.recipient_name,
      total: Number(r.total),
      vatTotal: Number(r.vat_total),
      issuedAt: r.issued_at,
      isCancellation: r.is_cancellation,
      cancelledBy: r.cancelled_by,
    }));
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

invoices.get("/:code/vat-bills/:number{.+}", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* A cancellation carries no sale of its own: it is read through the
       bill it cancels (`o`), as a credit note names its invoice. */
    const { rows } = await client.query<Record<string, string | null>>(
      `select v.number, v.fin_year,
              to_char(v.issued_at, 'DD Mon YYYY, HH24:MI') as issued_at,
              to_char(v.business_date, 'YYYY-MM-DD') as business_date,
              v.recipient_name, v.taxable_value::text, v.vat_total::text,
              v.total::text, v.reason, o.number as cancels_number,
              (select c.number from vat_bills c where c.cancels_id = v.id)
                as cancelled_by,
              coalesce(v.folio_id, o.folio_id)::text as folio_id,
              coalesce(v.pos_order_id, o.pos_order_id)::text as order_id,
              i.number as invoice_number, po.order_no,
              h.name as hotel_name, h.address_line as hotel_address,
              h.city as hotel_city, h.state as hotel_state,
              s.full_name as issued_by
         from vat_bills v
         left join vat_bills o on o.id = v.cancels_id
         left join invoices i on i.id = coalesce(v.invoice_id, o.invoice_id)
         left join pos_orders po on po.id = coalesce(v.pos_order_id, o.pos_order_id)
         join hotels h on h.id = v.hotel_id
         left join staff s on s.id = v.issued_by
        where v.hotel_id = $1 and v.number = $2`,
      [hotelId, c.req.param("number")],
    );

    const v = rows[0];
    if (!v) return null;

    /* The lines, from what was charged - the order's VAT lines, or the
       folio's live VAT postings - as the GST invoice reads its own. */
    type Line = { description: string; qty: string | null; amount: string; rate: string };
    const { rows: lines } = v["order_id"]
      ? await client.query<Line>(
          `select l.name as description, l.qty::text as qty,
                  round(l.qty * l.unit_price, 2)::text as amount, l.tax_rate::text as rate
             from pos_order_lines l
            where l.order_id = $1 and l.tax_scheme = 'vat' and not l.voided
            order by l.id`,
          [v["order_id"]])
      : await client.query<Line>(
          `select fp.description, null as qty, fp.amount::text as amount,
                  fp.tax_rate::text as rate
             from folio_postings fp
            where fp.folio_id = $1 and fp.tax_scheme = 'vat'
              and fp.category not in ('payment', 'refund')
              and fp.reverses_id is null
              and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)
            order by fp.business_date, fp.id`,
          [v["folio_id"]]);

    /* A restaurant bill's discount is shared across GST and VAT; the VAT
       part's share is what took its lines down to the taxable value. */
    const { rows: disc } = v["order_id"]
      ? await client.query<{ d: string }>(
          `select coalesce(sum(discount), 0)::text as d
             from app.pos_order_by_tax($1) where tax_scheme = 'vat'`,
          [v["order_id"]])
      : { rows: [{ d: "0" }] };

    const rates = new Set(lines.map((l) => Number(l.rate)));

    return {
      number: v["number"],
      finYear: v["fin_year"],
      issuedAt: v["issued_at"],
      issuedBy: v["issued_by"],
      businessDate: v["business_date"],
      supplier: {
        name: v["hotel_name"], address: v["hotel_address"],
        city: v["hotel_city"], state: v["hotel_state"],
      },
      recipient: v["recipient_name"],
      /* The GST document of the same sale, which names this bill back. */
      invoice: v["invoice_number"],
      order: v["order_no"],
      lines: lines.map((l) => ({
        description: l.description,
        qty: l.qty === null ? null : Number(l.qty),
        amount: Number(l.amount),
      })),
      discount: Number(disc[0]!.d),
      taxableValue: Number(v["taxable_value"]),
      /* One rate when the lines agree on one; otherwise none is named -
         never an average nobody was charged. */
      vatRate: rates.size === 1 ? [...rates][0]! : null,
      vatTotal: Number(v["vat_total"]),
      total: Number(v["total"]),
      cancelsNumber: v["cancels_number"],
      reason: v["reason"],
      cancelledBy: v["cancelled_by"],
    };
  });

  return body ? c.json(body) : c.json({ error: "No such VAT bill." }, 404);
});

invoices.post("/:code/vat-bills/:number{.+}/cancel", async (c) => {
  const body = await c.req.json<{ reason?: string }>()
    .catch(() => ({} as { reason?: string }));

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelIdFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const reason = body.reason?.trim();
    if (!reason) return refuse("A VAT bill's cancellation must say why it was wrong.");

    const { rows } = await client.query<{
      id: string; fin_year: string; recipient_name: string | null;
      taxable_value: string; vat_total: string; total: string;
      cancels_id: string | null; cancelled_by: string | null;
    }>(
      `select v.id::text, v.fin_year, v.recipient_name, v.taxable_value::text,
              v.vat_total::text, v.total::text, v.cancels_id::text,
              (select c.number from vat_bills c where c.cancels_id = v.id) as cancelled_by
         from vat_bills v where v.hotel_id = $1 and v.number = $2`,
      [hotelId, c.req.param("number")],
    );

    const bill = rows[0];
    if (!bill) return refuse("No such VAT bill.");
    if (bill.cancels_id) {
      return refuse("That is already a cancellation. It cannot be cancelled.");
    }
    /* Idempotent, as a credit note is; a unique index backs it. */
    if (bill.cancelled_by) {
      return { ok: true, duplicate: true, number: bill.cancelled_by };
    }

    const number = await client.query<{ n: string }>(
      "select app.next_vat_bill_number($1, $2) as n", [hotelId, bill.fin_year],
    );

    await client.query(
      `insert into vat_bills
         (hotel_id, fin_year, number, recipient_name, taxable_value, vat_total,
          total, business_date, cancels_id, reason, issued_by)
       values ($1,$2,$3,$4,$5,$6,$7, app.business_date($1), $8::uuid, $9,
               app.current_user_id())`,
      [hotelId, bill.fin_year, number.rows[0]!.n, bill.recipient_name,
       -Number(bill.taxable_value), -Number(bill.vat_total), -Number(bill.total),
       bill.id, reason],
    );

    return {
      ok: true, number: number.rows[0]!.n, cancels: c.req.param("number"),
      total: -Number(bill.total), reason,
    };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
