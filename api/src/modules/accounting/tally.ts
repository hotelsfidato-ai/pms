import type { Client } from "../../db.ts";
import { dailyPayments, posSales, round2, type PosDay, type Property } from "../reports/index.ts";
import { dayBook, type DayBook, type DayBookRow } from "./dayBook.ts";
import { ledgerNames, type Ledger } from "./ledgers.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TWO TALLY FILES (ACC-4, the owner's D18-16 and D27-382)

   ONE SALES VOUCHER A DAY, not one per bill. The day book counts the ledger
   by day and the bills are another basis (ACC-6), so only a day's voucher is
   the same figures as the day book. A voucher per bill would also need a
   ledger per guest in the hotel's Tally. Each company receipt is its own
   voucher: it has its own party and reference.

   Per closed day: a Sales voucher; a Receipt voucher for what was paid on
   bills; a Payment voucher for what was refunded; a Journal voucher for bills
   moved to a company. Each company receipt: a Receipt voucher.

   THE FILE CARRIES VOUCHERS ONLY, NEVER A LEDGER MASTER. A name that does not
   match the hotel's Tally is refused there (LINEERROR "Ledger '...' does not
   exist!", CREATED 0, seen on TallyPrime 7.2), and no ledger is created.

   IT REFUSES, IN A SENTENCE, RATHER THAN BALANCE A DAY BY ITSELF. Tally answers
   a voucher that does not balance with EXCEPTIONS 1 and no reason at all, so the
   day and the difference have to be named here. There is never a hidden line.

   A DAY THE NIGHT AUDIT HAS NOT CLOSED IS REFUSED. Tonight's room is an estimate
   at the booking's rate until it is posted, and a voucher is a booked entry.

   A VOUCHER'S REMOTEID IS STABLE, so a corrected day exported again replaces its
   vouchers (ALTERED 1, seen on TallyPrime 7.2). Tally numbers a voucher itself
   and ignores VOUCHERNUMBER, so the reference is in the narration too.
   ══════════════════════════════════════════════════════════════════ */

export type TallyVersion = "prime" | "erp9";

/** Plus is a debit, minus a credit. */
interface Entry { ledger: string; amount: number }

export interface Voucher {
  type: "Sales" | "Receipt" | "Payment" | "Journal";
  /** Stable from one export to the next: the same day and kind, the same id. */
  id: string;
  date: string;
  narration: string;
  entries: Entry[];
}

export class TallyRefused extends Error {
  constructor(sentence: string) {
    super(sentence);
    this.name = "TallyRefused";
  }
}

const paise = (n: number) => Math.round(n * 100);
const rupees = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A date stays text here, as everywhere in this service. */
const day = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/** A voucher's lines must come to nothing, to the paisa, or the day is refused. */
function balanced(voucher: Voucher): Voucher {
  const debit = voucher.entries.filter((e) => e.amount > 0).reduce((t, e) => t + paise(e.amount), 0);
  const credit = -voucher.entries.filter((e) => e.amount < 0).reduce((t, e) => t + paise(e.amount), 0);
  if (debit !== credit) {
    throw new TallyRefused(
      `${day(voucher.date)} cannot be exported: its ${voucher.type} voucher has debits of ${rupees(debit / 100)} `
      + `and credits of ${rupees(credit / 100)}, a difference of ${rupees(Math.abs(debit - credit) / 100)}.`);
  }
  return voucher;
}

/** GST is one figure a day: half SGST as the Manager report halves it, the rest CGST. */
const halves = (tax: number) => {
  const sgst = round2(tax / 2);
  return { sgst, cgst: round2(tax - sgst) };
};

function salesVoucher(
  code: string, d: DayBookRow, outlet: PosDay | undefined, name: (key: string) => string,
): Voucher | null {
  const { sgst, cgst } = halves(d.tax);
  const tenders = Object.entries(outlet?.tenders ?? {});
  /* What the day charged to bills: the day's sales and tax, less what the
     outlets sold themselves, which they took there and then. */
  const onBills = round2(d.sales + d.tax + d.vat - (outlet?.net ?? 0) - (outlet?.tax ?? 0));
  const roundOff = outlet?.roundOff ?? 0;

  const entries: Entry[] = [
    { ledger: "guests", amount: onBills },
    ...tenders.map(([method, amount]) => ({ ledger: method, amount })),
    { ledger: "discount", amount: d.discount },
    { ledger: "room", amount: -d.room },
    { ledger: "food", amount: -d.food },
    { ledger: "other", amount: -d.otherExtra },
    { ledger: "restaurant", amount: -d.pos },
    { ledger: "alcohol", amount: -d.alcohol },
    { ledger: "cgst", amount: -cgst },
    { ledger: "sgst", amount: -sgst },
    { ledger: "vat", amount: -d.vat },
    { ledger: "round_off", amount: -roundOff },
  ].filter((e) => e.amount !== 0).map((e) => ({ ...e, ledger: name(e.ledger) }));
  if (!entries.length) return null;

  return balanced({
    type: "Sales", id: `${code}-${d.date}-sales`, date: d.date,
    narration: `${code} day book ${d.date}: sales`, entries,
  });
}

/** The Tally vouchers of a closed range, every one balanced, or a refusal. */
export async function tallyVouchers(
  client: Client, property: Property, from: string, to: string,
): Promise<Voucher[]> {
  const { ledgers, missing } = await ledgerNames(client, property.id);
  if (missing.length) {
    throw new TallyRefused(`Type these ledger names first: ${missing.join(", ")}.`);
  }
  const book: DayBook = await dayBook(client, property, from, to);
  if (book.openDays.length) {
    throw new TallyRefused(
      `The night audit has not closed ${book.openDays.map(day).join(", ")}. `
      + "A Tally file holds closed days only: end the range before them, or close them.");
  }

  const name = named(ledgers);
  const outlets = new Map((await posSales(client, property.id, from, to)).map((p) => [p.date, p]));
  const payments = await dailyPayments(client, property.id, from, to);
  const code = property.code;
  const vouchers: Voucher[] = [];

  for (const d of book.days) {
    const sales = salesVoucher(code, d, outlets.get(d.date), name);
    if (sales) vouchers.push(sales);

    const today = payments.filter((p) => p.date === d.date);
    const unrecorded = today.find((p) => p.method === "unrecorded");
    if (unrecorded) {
      throw new TallyRefused(
        `${day(d.date)} cannot be exported: ${rupees(Math.abs(unrecorded.amount))} has no way of paying recorded, so it has no ledger.`);
    }

    const received = today.filter((p) => !p.refund && p.method !== "city_ledger");
    const refunded = today.filter((p) => p.refund);
    const net = received.reduce((t, p) => t + paise(p.amount), 0) + refunded.reduce((t, p) => t + paise(p.amount), 0);
    if (net !== paise(d.receipt)) {
      throw new TallyRefused(
        `${day(d.date)} cannot be exported: the day book's receipts are ${rupees(d.receipt)} and its payments `
        + `by way of paying come to ${rupees(net / 100)}, a difference of ${rupees(Math.abs(net / 100 - d.receipt))}.`);
    }
    const total = (lines: typeof today) => round2(lines.reduce((t, p) => t + Math.abs(p.amount), 0));

    if (received.length) {
      vouchers.push(balanced({
        type: "Receipt", id: `${code}-${d.date}-receipt`, date: d.date,
        narration: `${code} day book ${d.date}: paid on bills`,
        entries: [
          ...received.map((p) => ({ ledger: name(p.method), amount: p.amount })),
          { ledger: name("guests"), amount: -total(received) },
        ],
      }));
    }
    if (refunded.length) {
      vouchers.push(balanced({
        type: "Payment", id: `${code}-${d.date}-refund`, date: d.date,
        narration: `${code} day book ${d.date}: refunded`,
        entries: [
          { ledger: name("guests"), amount: total(refunded) },
          ...refunded.map((p) => ({ ledger: name(p.method), amount: p.amount })),
        ],
      }));
    }
    const moved = total(today.filter((p) => !p.refund && p.method === "city_ledger"));
    if (moved) {
      vouchers.push(balanced({
        type: "Journal", id: `${code}-${d.date}-company`, date: d.date,
        narration: `${code} day book ${d.date}: bills moved to a company`,
        entries: [{ ledger: name("companies"), amount: moved }, { ledger: name("guests"), amount: -moved }],
      }));
    }
  }

  for (const r of book.companyReceipts) {
    vouchers.push(balanced({
      type: "Receipt", id: `${code}-company-receipt-${r.id}`, date: r.date,
      narration: `${code} received from ${r.account} by ${r.method}${r.reference ? `, ${r.reference}` : ""}`,
      entries: [{ ledger: name(r.kind), amount: r.amount }, { ledger: name("companies"), amount: -r.amount }],
    }));
  }
  /* D27-296: nothing from a test hotel passes for the real thing. */
  return property.test
    ? vouchers.map((v) => ({ ...v, narration: `TEST - NOT VALID. ${v.narration}` }))
    : vouchers;
}

/** The hotel's name for a ledger. `ledgerNames` lists what the hotel has ever
    used and `missing` stops the export first, so a line with no ledger here is
    a fault: refused, so that it is never written as "undefined" in a voucher. */
const named = (ledgers: readonly Ledger[]) => (key: string): string => {
  const typed = ledgers.find((l) => l.key === key)?.name;
  if (!typed) throw new TallyRefused(`This range needs a ledger that has no name: ${key}.`);
  return typed;
};

/* ── The file ──────────────────────────────────────────────────────── */

/** Pure ASCII, so the file reads the same whatever encoding it is opened in. A
    character XML 1.0 cannot carry at all is dropped. */
const xml = (s: string) => s
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;")
  .replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`);

/** Debit: deemed positive, a negative amount. Credit: not, a positive one. */
const entryXml = (e: Entry) => `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${xml(e.ledger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>${e.amount > 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
       <AMOUNT>${(-e.amount).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;

const voucherXml = (v: Voucher, version: TallyVersion) => {
  const view = version === "prime" ? ` OBJVIEW="Accounting Voucher View"` : "";
  return `    <TALLYMESSAGE>
     <VOUCHER REMOTEID="${xml(v.id)}" VCHTYPE="${v.type}" ACTION="Create"${view}>
      <DATE>${v.date.replace(/-/g, "")}</DATE>
      <VOUCHERTYPENAME>${v.type}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${xml(v.id)}</VOUCHERNUMBER>
      <NARRATION>${xml(v.narration)}</NARRATION>
${version === "prime" ? "      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>\n      <ISINVOICE>No</ISINVOICE>\n" : ""}${v.entries.map(entryXml).join("\n")}
     </VOUCHER>
    </TALLYMESSAGE>`;
};

/** The file: Tally's own import envelope, naming no company, so it goes into
    the company open in Tally. Vouchers only, never a ledger master. */
export const tallyXml = (vouchers: readonly Voucher[], version: TallyVersion) => `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
   </REQUESTDESC>
   <REQUESTDATA>
${vouchers.map((v) => voucherXml(v, version)).join("\n")}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
