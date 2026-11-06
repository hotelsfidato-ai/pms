import type { Client } from "../../../db.ts";
import { col, row, total, band, round2, type ReportDoc, type ReportRow } from "../document.ts";
import { heading, LIVE, type Property } from "../figures.ts";
import { sacOf } from "../../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   GST: THE GSTR-1 FILE, INPUT TAX CREDIT, GST ON ADVANCES (D27-383 item 4)

   Reports only. Nothing here issues, numbers or changes an invoice, a
   credit note or a payment: every figure is read from what was issued.

   GSTR-1 follows the GST Returns Offline Tool's JSON, version 3.2.2 (the
   tool's current release; Table 12's HSN summary split into B2B and B2C,
   and Table 13 mandatory, from the May 2025 return period - GSTN advisory
   of 1 May 2025). GSTN publishes no schema of its own; the key names are
   the offline tool's. The file is opened in the offline tool, or uploaded,
   by the CA - this system files nothing.
   ══════════════════════════════════════════════════════════════════ */

const sum = (list: number[]) => round2(list.reduce((t, n) => t + n, 0));
/** CGST and SGST: half each, the odd paisa to CGST - as the invoice splits it (finance/invoices.ts).
    A negative (a credit note) is the positive one turned round, so the two always cancel. */
export const halves = (tax: number) => {
  const paise = Math.round(Math.abs(tax) * 100);
  const c = Math.ceil(paise / 2);
  const sign = tax < 0 ? -1 : 1;
  return { camt: (sign * c) / 100 + 0, samt: (sign * (paise - c)) / 100 + 0 };
};
/** Months as the return names them: "2026-11" is period "112026". */
const period = (month: string) => `${month.slice(5, 7)}${month.slice(0, 4)}`;
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("-");
const monthFacts = (month: string) => [
  { label: "Month", value: `${month}-01`, kind: "date" as const },
  { label: "Return period", value: period(month), kind: "text" as const },
];

/* ── GSTR-1 ────────────────────────────────────────────────────────── */

interface RateLine { rt: number; txval: number; tax: number }
interface Gstr1Doc {
  number: string; day: string; ctin: string | null; name: string | null;
  val: number; credit: boolean; credits: string | null;
  rates: RateLine[];
  sacs: Array<{ sac: string | null; rt: number; txval: number; tax: number }>;
}
interface Bucket { rt: number; txval: number; camt: number; samt: number }
export interface Gstr1 {
  gstin: string | null;
  month: string;
  /** The supplier's state, the first two digits of its GSTIN: a hotel's place of supply (IGST Act s.12(3)). */
  pos: string | null;
  invoices: Gstr1Doc[];
  creditNotes: Gstr1Doc[];
  b2cs: Bucket[];
  hsnB2b: Array<Bucket & { sac: string }>;
  hsnB2c: Array<Bucket & { sac: string }>;
  docs: Array<{ doc: number; what: string; from: string; to: string; total: number; cancelled: number }>;
  /** Why the file cannot be made as it stands, in sentences. Empty: it can. */
  problems: string[];
}

/** One bucket per rate: each document's own halves added up. */
function addTo(map: Map<number, Bucket>, rt: number, txval: number, tax: number) {
  const b = map.get(rt) ?? { rt, txval: 0, camt: 0, samt: 0 };
  const h = halves(tax);
  b.txval = round2(b.txval + txval);
  b.camt = round2(b.camt + h.camt);
  b.samt = round2(b.samt + h.samt);
  map.set(rt, b);
}

export async function gstr1Data(client: Client, property: Property, month: string): Promise<Gstr1> {
  const problems: string[] = [];
  const gstin = property.gstin?.trim() || null;
  if (!gstin) problems.push("This property has no GSTIN. Enter it on the Properties screen.");
  const pos = gstin ? gstin.slice(0, 2) : null;

  /* Every invoice and credit note of the month, by its business date (the
     GST sales register's rule), with the document its lines come from: its
     own folio for an invoice, the invoice it cancels for a credit note. */
  const { rows: issued } = await client.query<{
    id: string; number: string; day: string; gstin: string | null; ctin: string | null; name: string | null;
    total: string; taxable: string; tax: string; credits: string | null; src: string;
  }>(
    `select i.id::text, i.number, to_char(coalesce(i.business_date, i.issued_at::date), 'YYYY-MM-DD') as day,
            i.gstin,
            nullif(btrim(case when i.credits_id is null then i.recipient_gstin else o.recipient_gstin end), '') as ctin,
            i.recipient_name as name, i.total::text, i.taxable_value::text as taxable, i.tax_total::text as tax,
            o.number as credits, coalesce(o.id, i.id)::text as src
       from invoices i left join invoices o on o.id = i.credits_id
      where i.hotel_id = $1 and coalesce(i.business_date, i.issued_at::date) >= $2::date
        and coalesce(i.business_date, i.issued_at::date) < ($2::date + interval '1 month')::date
      order by 3, i.number`,
    [property.id, `${month}-01`]);

  /* The lines each source invoice was made from, AS THEY STOOD WHEN IT WAS
     ISSUED: posted by then and not reversed by then. The invoice keeps its
     totals, not its lines (finance/invoices.ts), and a credited bill may
     have been corrected since. Checked against the stored totals below. */
  const { rows: lines } = await client.query<{
    src: string; category: string; kind: string | null; rate: string; amount: string; tax: string;
    sac_by_kind: Record<string, string> | null; sac_code: string;
  }>(
    `select s.id::text as src, fp.category, fp.tax_kind as kind, fp.tax_rate::text as rate,
            fp.amount::text, fp.tax_amount::text as tax, s.sac_by_kind, s.sac_code
       from invoices s
       join folio_postings fp on fp.folio_id = s.folio_id
      where s.id = any($1::uuid[])
        and fp.category not in ('payment', 'refund') and fp.tax_scheme = 'gst'
        and fp.reverses_id is null and fp.created_at <= s.issued_at
        and not exists (select 1 from folio_postings rev
                         where rev.reverses_id = fp.id and rev.created_at <= s.issued_at)`,
    [[...new Set(issued.map((d) => d.src))]]);

  const docs: Gstr1Doc[] = issued.map((d) => {
    const mine = lines.filter((l) => l.src === d.src);
    const sign = d.credits ? -1 : 1;
    const label = d.credits ? `Credit note ${d.number}` : `Invoice ${d.number}`;
    if (d.gstin && gstin && d.gstin !== gstin) problems.push(`${label} carries GSTIN ${d.gstin}, not this property's ${gstin}.`);
    if (mine.some((l) => l.category === "tax")) {
      problems.push(`${label} has its tax as a line of its own (an import), so its rates cannot be read. Enter it by hand.`);
    }
    const rates = new Map<number, RateLine>();
    const sacs = new Map<string, { sac: string | null; rt: number; txval: number; tax: number }>();
    for (const l of mine.filter((x) => x.category !== "tax")) {
      const rt = Number(l.rate);
      const r = rates.get(rt) ?? { rt, txval: 0, tax: 0 };
      r.txval = round2(r.txval + sign * Number(l.amount));
      r.tax = round2(r.tax + sign * Number(l.tax));
      rates.set(rt, r);
      const sac = sacOf(l.kind ?? (l.category === "room" ? "room" : null), l.sac_by_kind, l.sac_code);
      const k = `${sac}|${rt}`;
      const s = sacs.get(k) ?? { sac, rt, txval: 0, tax: 0 };
      s.txval = round2(s.txval + sign * Number(l.amount));
      s.tax = round2(s.tax + sign * Number(l.tax));
      sacs.set(k, s);
    }
    const list = [...rates.values()].sort((a, b) => a.rt - b.rt);
    if (Math.abs(sum(list.map((r) => r.txval)) - Number(d.taxable)) > 0.005
        || Math.abs(sum(list.map((r) => r.tax)) - Number(d.tax)) > 0.005) {
      problems.push(`${label}: its bill's lines no longer add up to its taxable value and tax. Enter it by hand.`);
    }
    if ([...sacs.values()].some((s) => s.sac === null)) {
      problems.push(`${label} has a line with no HSN/SAC. Set the code for each kind on Settings, Taxes.`);
    }
    return { number: d.number, day: d.day, ctin: d.ctin, name: d.name, val: Number(d.total),
      credit: Boolean(d.credits), credits: d.credits, rates: list, sacs: [...sacs.values()] };
  });
  const invoices = docs.filter((d) => !d.credit);
  const creditNotes = docs.filter((d) => d.credit);

  /* The restaurant's bills paid at the outlet: B2C documents of their own
     series, by rate as the till resolved them (app.pos_order_by_tax, the
     Manager report's). A bill charged to a room or a function is on that
     folio's invoice instead (posSales' rule); an NC or voided bill is no sale. */
  const { rows: outlet } = await client.query<{
    rate: string; taxable: string; tax: string; sacs: string[] | null; missing: number;
  }>(
    `select r.tax_rate::text as rate, r.taxable::text, r.tax::text, s.sacs, s.missing::int
       from pos_orders o
       cross join lateral app.pos_order_by_tax(o.id) r
       cross join lateral (
         select array_agg(distinct ts.sac_code) filter (where ts.sac_code is not null) as sacs,
                count(*) filter (where ts.sac_code is null) as missing
           from pos_order_lines l
           left join pos_menu_items mi on mi.id = l.item_id
           left join pos_menu_categories c on c.id = mi.category_id
           left join tax_sac ts on ts.hotel_id = l.hotel_id and ts.kind = c.tax_kind
          where l.order_id = o.id and not l.voided and l.tax_scheme = 'gst' and l.tax_rate = r.tax_rate) s
      where o.hotel_id = $1 and o.status = 'settled'
        and o.payment_method is distinct from 'room' and o.payment_method is distinct from 'function'
        and o.business_date >= $2::date and o.business_date < ($2::date + interval '1 month')::date
        and r.tax_scheme = 'gst' and r.taxable <> 0`,
    [property.id, `${month}-01`]);

  /* B2CS (Table 7): B2C invoices, their credit notes (netted here: CDNUR is
     for B2C large and exports only), and the outlet's bills, by rate. */
  const b2cs = new Map<number, Bucket>();
  for (const d of docs.filter((x) => !x.ctin)) for (const r of d.rates) addTo(b2cs, r.rt, r.txval, r.tax);
  for (const o of outlet) addTo(b2cs, Number(o.rate), Number(o.taxable), Number(o.tax));

  /* HSN/SAC summary (Table 12), B2B and B2C apart. */
  const hsn = (list: Gstr1Doc[], extra: Array<{ sac: string | null; rt: number; txval: number; tax: number }> = []) => {
    const map = new Map<string, Bucket & { sac: string }>();
    for (const s of [...list.flatMap((d) => d.sacs), ...extra]) {
      if (s.sac === null) continue;
      const k = `${s.sac}|${s.rt}`;
      const b = map.get(k) ?? { sac: s.sac, rt: s.rt, txval: 0, camt: 0, samt: 0 };
      const h = halves(s.tax);
      b.txval = round2(b.txval + s.txval); b.camt = round2(b.camt + h.camt); b.samt = round2(b.samt + h.samt);
      map.set(k, b);
    }
    return [...map.values()].sort((a, b) => a.sac.localeCompare(b.sac) || a.rt - b.rt);
  };
  const outletSacs = outlet.map((o) => ({
    sac: o.missing === 0 && o.sacs?.length === 1 ? o.sacs[0]! : null,
    rt: Number(o.rate), txval: Number(o.taxable), tax: Number(o.tax),
  }));
  if (outletSacs.some((s) => s.sac === null)) {
    problems.push("A restaurant bill sells a dish whose kind has no HSN/SAC, or two codes at one rate. "
      + "Set the code for each kind on Settings, Taxes.");
  }

  /* Documents issued (Table 13): the invoice series, which credit notes share
     (finance numbers both with app.next_invoice_number), and the restaurant's. */
  const { rows: series } = await client.query<{
    doc: number; what: string; first: string; last: string; total: number; cancelled: number;
  }>(
    `with docs as (
       select case when credits_id is null then 1 else 5 end as doc,
              case when credits_id is null then 'Tax invoices' else 'Credit notes' end as what,
              number, issued_at as at, false as void
         from invoices
        where hotel_id = $1 and coalesce(business_date, issued_at::date) >= $2::date
          and coalesce(business_date, issued_at::date) < ($2::date + interval '1 month')::date
       union all
       -- A bill printed NC is a document issued; a voided one is cancelled; an
       -- order closed unpaid never had a bill.
       select 1, 'Restaurant bills', order_no, opened_at, status = 'void'
         from pos_orders
        where hotel_id = $1 and status in ('settled', 'void', 'no_charge')
          and business_date >= $2::date and business_date < ($2::date + interval '1 month')::date
     )
     select doc, what,
            (array_agg(number order by at, number))[1] as first,
            (array_agg(number order by at desc, number desc))[1] as last,
            count(*)::int as total, (count(*) filter (where void))::int as cancelled
       from docs
      group by doc, what
      order by doc, what desc`,
    [property.id, `${month}-01`]);

  return {
    gstin, month, pos, invoices, creditNotes,
    b2cs: [...b2cs.values()].sort((a, b) => a.rt - b.rt),
    hsnB2b: hsn(docs.filter((d) => d.ctin)),
    hsnB2c: hsn(docs.filter((d) => !d.ctin), outletSacs),
    docs: series.map((s) => ({ doc: s.doc, what: s.what, from: s.first, to: s.last, total: s.total, cancelled: s.cancelled })),
    problems: [...new Set(problems)],
  };
}

/** The offline tool's JSON. Credit notes carry positive values; `ntty: "C"` says what they are. */
export function gstr1Json(g: Gstr1) {
  const itms = (rates: RateLine[], sign = 1) => rates.map((r, i) => ({
    num: i + 1,
    itm_det: { rt: r.rt, txval: round2(sign * r.txval), iamt: 0, ...halves(sign * r.tax), csamt: 0 },
  }));
  const byCtin = <T>(list: Gstr1Doc[], make: (d: Gstr1Doc) => T) =>
    [...new Set(list.map((d) => d.ctin!))].map((ctin) => ({ ctin, list: list.filter((d) => d.ctin === ctin).map(make) }));
  const hsnRows = (list: Gstr1["hsnB2b"]) => list.map((h, i) => ({
    num: i + 1, hsn_sc: h.sac, desc: "", uqc: "NA", qty: 0, rt: h.rt,
    txval: h.txval, iamt: 0, camt: h.camt, samt: h.samt, csamt: 0,
  }));
  return {
    gstin: g.gstin, fp: period(g.month), version: "GST3.2.2", hash: "hash",
    b2b: byCtin(g.invoices.filter((d) => d.ctin), (d) => ({
      inum: d.number, idt: ddmmyyyy(d.day), val: d.val, pos: g.pos, rchrg: "N", inv_typ: "R", itms: itms(d.rates),
    })).map(({ ctin, list }) => ({ ctin, inv: list })),
    b2cl: [],
    b2cs: g.b2cs.map((b) => ({ sply_ty: "INTRA", pos: g.pos, typ: "OE", rt: b.rt, txval: b.txval,
      iamt: 0, camt: b.camt, samt: b.samt, csamt: 0 })),
    cdnr: byCtin(g.creditNotes.filter((d) => d.ctin), (d) => ({
      ntty: "C", nt_num: d.number, nt_dt: ddmmyyyy(d.day), val: Math.abs(d.val), pos: g.pos, rchrg: "N",
      inv_typ: "R", itms: itms(d.rates, -1),
    })).map(({ ctin, list }) => ({ ctin, nt: list })),
    cdnur: [],
    hsn: { hsn_b2b: hsnRows(g.hsnB2b), hsn_b2c: hsnRows(g.hsnB2c) },
    doc_issue: {
      doc_det: [1, 5].filter((n) => g.docs.some((d) => d.doc === n)).map((n) => ({
        doc_num: n,
        docs: g.docs.filter((d) => d.doc === n).map((d, i) => ({
          num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled,
        })),
      })),
    },
  };
}

export async function gstr1Report(client: Client, property: Property, month: string): Promise<ReportDoc> {
  const g = await gstr1Data(client, property, month);
  const rateRows = (d: Gstr1Doc, first: Record<string, string | number | null>) => d.rates.map((r, i) => row({
    ...(i === 0 ? first : {}), rt: r.rt, txval: r.txval, ...halves(r.tax),
  }));
  const bucketTotal = (label: string, key: string, list: Array<{ txval: number; camt: number; samt: number }>) =>
    total({ [key]: label, txval: sum(list.map((b) => b.txval)), camt: sum(list.map((b) => b.camt)), samt: sum(list.map((b) => b.samt)) });
  const b2b = g.invoices.filter((d) => d.ctin);
  const cdnr = g.creditNotes.filter((d) => d.ctin);
  const money = [col("rt", "Rate %", "ratio"), col("txval", "Taxable value"), col("camt", "CGST"), col("samt", "SGST")];
  const hsnSection = (key: string, title: string, list: Gstr1["hsnB2b"]) => ({
    key, title,
    columns: [col("sac", "HSN/SAC", "text"), ...money],
    rows: list.length ? [...list.map((h) => row({ sac: h.sac, rt: h.rt, txval: h.txval, camt: h.camt, samt: h.samt })),
      bucketTotal("Total", "sac", list)] : [],
    empty: "Nothing to summarise.",
  });

  return {
    report: "gstr-1",
    title: "GSTR-1",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "GSTIN", value: g.gstin, kind: "text" }, ...monthFacts(month)],
    sections: [
      ...(g.problems.length ? [{
        key: "problems", title: "To put right before the file is made",
        columns: [col("problem", "What", "text")],
        rows: g.problems.map((p) => row({ problem: p })),
      }] : []),
      {
        key: "b2b", title: "4A - B2B: invoices to registered recipients",
        columns: [col("ctin", "Recipient GSTIN", "text"), col("name", "Recipient", "text"),
          col("number", "Invoice", "text"), col("day", "Date", "date"), col("val", "Invoice value"), ...money],
        rows: b2b.length ? [...b2b.flatMap((d) => rateRows(d, { ctin: d.ctin, name: d.name, number: d.number, day: d.day, val: d.val })),
          total({ ctin: "Total", val: sum(b2b.map((d) => d.val)), txval: sum(b2b.flatMap((d) => d.rates.map((r) => r.txval))),
            camt: sum(b2b.flatMap((d) => d.rates.map((r) => halves(r.tax).camt))),
            samt: sum(b2b.flatMap((d) => d.rates.map((r) => halves(r.tax).samt))) })] : [],
        empty: "No invoice to a registered recipient this month.",
      },
      {
        key: "b2cl", title: "5 - B2C large", columns: [col("what", "What", "text")], rows: [],
        empty: "None, and never for a hotel: B2C large is an invoice to another state over Rs 1,00,000 "
          + "(Notification 12/2024-CT), and a hotel's place of supply is always its own state (IGST Act s.12(3)).",
      },
      {
        key: "b2cs", title: "7 - B2C small: by rate, within the state",
        columns: money,
        rows: g.b2cs.length ? [...g.b2cs.map((b) => row({ rt: b.rt, txval: b.txval, camt: b.camt, samt: b.samt })),
          bucketTotal("Total", "rt", g.b2cs)] : [],
        empty: "No supply to an unregistered recipient this month.",
        note: "Invoices without a GSTIN, less their credit notes, and the restaurant's bills paid at the outlet.",
      },
      {
        key: "cdnr", title: "9B - Credit notes to registered recipients",
        columns: [col("ctin", "Recipient GSTIN", "text"), col("number", "Credit note", "text"), col("day", "Date", "date"),
          col("credits", "Cancels invoice", "text"), col("val", "Note value"), ...money],
        rows: cdnr.flatMap((d) => d.rates.map((r, i) => row({
          ...(i === 0 ? { ctin: d.ctin, number: d.number, day: d.day, credits: d.credits, val: Math.abs(d.val) } : {}),
          rt: r.rt, txval: -r.txval, ...halves(-r.tax),
        }))),
        empty: "No credit note to a registered recipient this month.",
      },
      hsnSection("hsn-b2b", "12 - HSN/SAC summary, B2B", g.hsnB2b),
      hsnSection("hsn-b2c", "12 - HSN/SAC summary, B2C", g.hsnB2c),
      {
        key: "docs", title: "13 - Documents issued",
        columns: [col("what", "Documents", "text"), col("from", "From", "text"), col("to", "To", "text"),
          col("total", "Total", "count"), col("cancelled", "Cancelled", "count"), col("net", "Net issued", "count")],
        rows: g.docs.map((d) => row({ what: d.what, from: d.from, to: d.to, total: d.total, cancelled: d.cancelled, net: d.total - d.cancelled })),
        empty: "No document was issued this month.",
      },
    ],
    footnotes: [
      "From the tax invoices and credit notes issued this month, by their business date, and the restaurant's bills paid at the outlet. VAT bills for alcohol are not GST and are not here.",
      "A hotel's supply is within its own state, so every figure is CGST and SGST; IGST is nil. Rates are each line's own, as charged.",
      "The GSTR-1 file is in the GST Returns Offline Tool's JSON (version 3.2.2). The CA opens it in the tool or uploads it; this system files nothing.",
      "For the CA to confirm: credit notes share the invoice series; a credited invoice is not counted as cancelled in Table 13; advances (Table 11) are on the GST on advances report, not in this file.",
    ],
  };
}

/* ── Input tax credit ──────────────────────────────────────────────── */

/* The GST on the Store's deliveries (purchase orders land there too:
   receiveIntoStore), as recorded at the delivery: rate, amount and whether
   it is claimable (migration 180, D27-238 6.2). Bar bills record no GST:
   liquor is outside GST. Claimable is what the person receiving marked;
   whether it may be claimed is the CA's (GSTR-2B, s.16 and s.17(5)). */
export async function inputTaxCreditReport(client: Client, property: Property, month: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    day: string; supplier: string | null; gstin: string | null; item: string; reference: string | null;
    value: string | null; rate: string | null; gst: string | null; claimable: boolean | null;
  }>(
    `select to_char(m.business_date, 'YYYY-MM-DD') as day, nullif(btrim(m.supplier), '') as supplier,
            (select s.gstin from suppliers s
              where s.hotel_id = m.hotel_id and lower(btrim(s.name)) = lower(btrim(m.supplier))
                and s.gstin is not null limit 1) as gstin,
            i.name as item, m.reference, round(m.quantity * m.unit_cost, 2)::text as value,
            m.gst_rate::text as rate, m.gst_amount::text as gst, m.gst_claimable as claimable
       from stock_movements m
       join stock_items i on i.id = m.item_id
      where m.hotel_id = $1 and m.kind = 'receipt' and not m.empty
        and m.business_date >= $2::date and m.business_date < ($2::date + interval '1 month')::date
        and m.reverses_id is null
        and not exists (select 1 from stock_movements r where r.reverses_id = m.id)
      order by m.business_date, m.id`,
    [property.id, `${month}-01`]);

  const own = property.gstin?.slice(0, 2) ?? null;
  const line = (r: (typeof rows)[number]) => {
    const gst = Number(r.gst);
    /* Same state: CGST and SGST; another: IGST; no GSTIN on record: a dash. */
    const split = !r.gstin || !own ? { camt: null, samt: null, iamt: null }
      : r.gstin.slice(0, 2) === own ? { ...halves(gst), iamt: 0 } : { camt: 0, samt: 0, iamt: gst };
    return { day: r.day, supplier: r.supplier ?? "Not named", gstin: r.gstin, item: r.item, reference: r.reference,
      value: r.value === null ? null : Number(r.value), rate: Number(r.rate), gst, ...split };
  };
  const section = (key: string, title: string, list: typeof rows, empty: string) => {
    const lines = list.map(line);
    const knownOr = (k: "camt" | "samt" | "iamt") =>
      lines.every((l) => l[k] === null) ? null : sum(lines.map((l) => l[k] ?? 0));
    return {
      key, title,
      columns: [col("day", "Date", "date"), col("supplier", "Supplier", "text"), col("gstin", "Supplier GSTIN", "text"),
        col("item", "Item", "text"), col("reference", "Reference", "text"), col("value", "Value before GST"),
        col("rate", "Rate %", "ratio"), col("gst", "GST"), col("camt", "CGST"), col("samt", "SGST"), col("iamt", "IGST")],
      rows: lines.length ? [...lines.map((l) => row(l)),
        total({ day: "Total", value: lines.some((l) => l.value === null) ? null : sum(lines.map((l) => l.value ?? 0)),
          gst: sum(lines.map((l) => l.gst)), camt: knownOr("camt"), samt: knownOr("samt"), iamt: knownOr("iamt") })] : [],
      empty,
    };
  };
  const recorded = rows.filter((r) => r.gst !== null);
  const notRecorded = rows.length - recorded.length;

  return {
    report: "input-tax-credit",
    title: "Input tax credit",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "GSTIN", value: property.gstin, kind: "text" }, ...monthFacts(month)],
    sections: [
      section("claimable", "GST marked claimable", recorded.filter((r) => r.claimable), "No delivery this month recorded GST marked claimable."),
      section("not-claimable", "GST marked not claimable", recorded.filter((r) => !r.claimable), "No delivery this month recorded GST marked not claimable."),
    ],
    footnotes: [
      "The GST on each delivery as the supplier's bill said it, recorded when it was received in the Store; purchase orders are received there too.",
      `${notRecorded} deliver${notRecorded === 1 ? "y" : "ies"} this month recorded no GST, and ${notRecorded === 1 ? "is" : "are"} not here. Bar bills record none: liquor is outside GST.`,
      "CGST and SGST where the supplier's GSTIN is in this state, IGST where it is in another; a dash where the supplier's GSTIN is not on record.",
      "For the CA: claimable is what the person receiving marked. Credit is taken only as GSTR-2B shows it (s.16), and is blocked on food and on supplies taxed without credit, such as rooms at Rs 7,500 or less and restaurant service at 5% (s.17(5)).",
    ],
  };
}

/* ── GST on advances ───────────────────────────────────────────────── */

/* Time of supply of a SERVICE is the earlier of the invoice and the payment
   (CGST Act s.13(2)); Notification 66/2017-CT took advances off GST for
   goods only. So money taken on a bill before its tax invoice is an advance
   on which GST falls due in the month it was received - reported in GSTR-1
   Table 11A when no invoice follows in the same month, and adjusted in
   Table 11B in the month the invoice is issued. The advance includes its
   tax. Its rate is the room's rule at the booking's rate; where it is not
   known when paid (a function, a group's bill, a free room), 18% (CGST
   Rule 50, proviso). "Bill to company" is not money received (D17-74).
   Nothing about invoices changes: this only reports. */
export async function gstAdvancesReport(client: Client, property: Property, month: string): Promise<ReportDoc> {
  const { rows } = await client.query<{
    reference: string | null; guest: string | null; invoice: string | null; rate: string | null;
    received: string; back: string; adjusted: string;
  }>(
    `with bills as (
       select f.id, f.reservation_id,
              (select min(coalesce(i.business_date, i.issued_at::date)) from invoices i
                where i.folio_id = f.id and i.credits_id is null) as invoiced_on,
              (select i.number from invoices i where i.folio_id = f.id and i.credits_id is null
                order by i.issued_at limit 1) as invoice
         from folios f where f.hotel_id = $1
     ),
     money as (
       select fp.folio_id, fp.business_date as day,
              case when fp.category = 'payment' then -fp.amount else 0 end as received,
              case when fp.category = 'refund' then fp.amount else 0 end as back
         from folio_postings fp
        where fp.hotel_id = $1 and fp.category in ('payment', 'refund') and ${LIVE}
          and not exists (select 1 from payments p where p.posting_id = fp.id and p.method = 'city_ledger')
          and fp.business_date < ($2::date + interval '1 month')::date
     ),
     per_bill as (
       select b.id, b.reservation_id, b.invoice,
              coalesce(sum(m.received) filter (where m.day >= $2::date
                and (b.invoiced_on is null or b.invoiced_on >= ($2::date + interval '1 month')::date)), 0) as received,
              coalesce(sum(m.back) filter (where m.day >= $2::date
                and (b.invoiced_on is null or b.invoiced_on >= ($2::date + interval '1 month')::date)), 0) as back,
              coalesce(sum(m.received - m.back) filter (where m.day < $2::date
                and b.invoiced_on >= $2::date and b.invoiced_on < ($2::date + interval '1 month')::date), 0) as adjusted
         from money m join bills b on b.id = m.folio_id
        group by b.id, b.reservation_id, b.invoice
     )
     select r.reference, g.full_name as guest, pb.invoice,
            case when r.agreed_rate > 0 and not r.is_complimentary
                 then app.gst_rate_or_null($1, 'room', r.agreed_rate) end::text as rate,
            pb.received::text, pb.back::text, pb.adjusted::text
       from per_bill pb
       left join reservations r on r.id = pb.reservation_id
       left join guests g on g.id = r.guest_id
      where pb.received <> 0 or pb.back <> 0 or pb.adjusted <> 0
      order by r.reference nulls last`,
    [property.id, `${month}-01`]);

  const bills = rows.map((r) => {
    const known = r.rate !== null;
    const rt = known ? Number(r.rate) : 18;
    /* Tax inside an amount that includes it, at rt. */
    const split = (amount: number) => {
      const txval = round2((amount * 100) / (100 + rt));
      return { txval, ...halves(round2(amount - txval)) };
    };
    return { ...r, rt, known, received: Number(r.received), back: Number(r.back), adjusted: Number(r.adjusted), split };
  });
  const cols = [col("booking", "Booking", "text"), col("guest", "Guest", "text"), col("rt", "Rate %", "ratio"),
    col("amount", "Amount"), col("txval", "Taxable value"), col("camt", "CGST"), col("samt", "SGST")];
  const part = (key: string, title: string, pick: "received" | "back" | "adjusted", empty: string, extra?: (b: (typeof bills)[number]) => string | null) => {
    const mine = bills.filter((b) => b[pick] !== 0);
    const lines = mine.map((b) => ({ booking: [b.reference ?? "A bill with no booking", extra?.(b)].filter(Boolean).join(", "),
      guest: b.guest, rt: b.rt, amount: b[pick], ...b.split(b[pick]) }));
    return {
      key, title, columns: cols,
      rows: lines.length ? [...lines.map((l) => row(l)), total({ booking: "Total", amount: sum(lines.map((l) => l.amount)),
        txval: sum(lines.map((l) => l.txval)), camt: sum(lines.map((l) => l.camt)), samt: sum(lines.map((l) => l.samt)) })] : [],
      empty,
    };
  };
  /* Table 11A and 11B by rate, from the lines above. */
  const byRate: ReportRow[] = [];
  for (const [label, pick] of [["11A - Advances received", "received"], ["Given back before an invoice", "back"],
    ["11B - Advances adjusted", "adjusted"]] as const) {
    const mine = bills.filter((b) => b[pick] !== 0);
    if (!mine.length) continue;
    byRate.push(band("rt", label));
    for (const rt of [...new Set(mine.map((b) => b.rt))].sort((a, b) => a - b)) {
      const at = mine.filter((b) => b.rt === rt).map((b) => b.split(b[pick]));
      byRate.push(row({ rt, txval: sum(at.map((s) => s.txval)), camt: sum(at.map((s) => s.camt)), samt: sum(at.map((s) => s.samt)) }, { indent: 1 }));
    }
  }
  const guessed = bills.filter((b) => !b.known).length;

  return {
    report: "gst-advances",
    title: "GST on advances",
    property: heading(property),
    orientation: "landscape",
    facts: [{ label: "GSTIN", value: property.gstin, kind: "text" }, ...monthFacts(month)],
    sections: [
      { key: "by-rate", title: "By rate, for GSTR-1 Table 11", columns: [col("rt", "Rate %", "ratio"),
        col("txval", "Taxable value"), col("camt", "CGST"), col("samt", "SGST")], rows: byRate,
        empty: "No advance was received or adjusted this month." },
      part("received", "Advances received this month, no tax invoice by its end", "received", "No advance was received this month without its invoice."),
      part("back", "Given back this month before an invoice", "back", "Nothing was given back before an invoice this month."),
      part("adjusted", "Advances of earlier months, adjusted against invoices issued this month", "adjusted",
        "No invoice this month was against an advance of an earlier month.", (b) => b.invoice ? `invoice ${b.invoice}` : null),
    ],
    footnotes: [
      "An advance is money taken on a bill before its tax invoice: GST falls due when it is received (CGST Act s.13(2)). Advances for goods are free of it (Notification 66/2017-CT); a hotel's rooms and food are services.",
      "Received and invoiced in the same month is not an advance in GSTR-1 and is not here. The amount includes its tax. \"Bill to company\" is not money received.",
      `The rate is the room's rule at the booking's rate. ${guessed ? `${guessed} bill${guessed === 1 ? "" : "s"} had no rate known when paid (a function, a group or a free room): 18%, CGST Rule 50.` : "Where it is not known when paid: 18%, CGST Rule 50."}`,
      "For the CA to confirm: whether a deposit is an advance; how money given back is reported (a refund voucher, Rule 51); and Table 11 in the return.",
    ],
  };
}
