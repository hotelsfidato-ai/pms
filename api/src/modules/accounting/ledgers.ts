import type { Client } from "../../db.ts";
import { COMPANY_PAYMENT_METHODS, PAYMENT_KINDS } from "../finance/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE LEDGER NAMES IN A HOTEL'S TALLY (the owner's D27-382)

   "A small page per hotel where the Accountant types each ledger name
   exactly as in their Tally; the export stays off until all are filled; no
   name is ever invented."

   NO DEFAULT NAME, EVER. A ledger nobody has named has no row and reads as
   null, and the Tally files stay off (tally.ts). The labels below are this
   system's words for what a ledger is FOR, for the Accountant to read. They
   are never written into a voucher.

   Which ledgers a hotel needs follows how it is set up: alcohol only where
   the hotel serves it (D21-91), the restaurant's only where it has one, the
   owner's allowance only where it is set, and each way of paying the hotel
   uses. What it has used and since switched off is asked for too: its days
   still have to be exported. No IGST: a hotel's supply is always intra-state,
   so this system never issues it (finance/invoices.ts).
   ══════════════════════════════════════════════════════════════════ */

export interface Ledger {
  key: string;
  label: string;
  what: string;
  /** As typed, or null: blank stays blank. */
  name: string | null;
}

export interface LedgerNames {
  ledgers: Ledger[];
  /** The labels of those still blank. The Tally files stay off until none is. */
  missing: string[];
}

export type LedgerKey =
  | "room" | "food" | "other" | "restaurant" | "alcohol"
  | "cgst" | "sgst" | "vat" | "discount" | "round_off"
  | "guests" | "companies" | "allowance";

type Fixed = readonly [key: LedgerKey, label: string, what: string];

const SOLD: readonly Fixed[] = [
  ["room", "Room rent", "Room charges, night by night"],
  ["food", "Food charged to a room", "Food on a bill, from the desk or the restaurant"],
  ["other", "Other services", "Laundry, the spa, late check-out and the other extras"],
];
const RESTAURANT: Fixed = ["restaurant", "Restaurant sales", "What the restaurant took in cash, by card or UPI"];
const ALCOHOL: Fixed = ["alcohol", "Alcohol sales", "Alcohol, at the restaurant or on a bill"];
const GST: readonly Fixed[] = [
  ["cgst", "CGST", "Half the GST on everything sold"],
  ["sgst", "SGST", "The other half"],
];
const VAT: Fixed = ["vat", "VAT on alcohol", "Never split into CGST and SGST"];
const DISCOUNT: Fixed = ["discount", "Discount given", "Discounts on bills"];
const ROUND_OFF: Fixed = ["round_off", "Round off", "Restaurant bills rounded to the rupee"];
const OWED: readonly Fixed[] = [
  ["guests", "What guests owe", "Charges on bills, until they are paid"],
  ["companies", "What companies owe", "Bills moved to a company or booking site"],
];
const ALLOWANCE: Fixed = ["allowance", "Owner's allowance", "The free part of a bill on the owner's allowance"];

/** Every ledger this hotel needs, with the name typed for it, if any. */
export async function ledgerNames(client: Client, hotelId: string): Promise<LedgerNames> {
  const { rows: [h] } = await client.query<{
    alcohol: boolean; restaurant: boolean; allowance: boolean; ways: string[];
  }>(
    `select app.module_enabled($1, 'alcohol')
              or exists (select 1 from folio_postings where hotel_id = $1 and tax_scheme = 'vat')
              or exists (select 1 from pos_order_lines where hotel_id = $1 and tax_scheme = 'vat') as alcohol,
            app.module_enabled($1, 'pos')     as restaurant,
            (select owner_allowance_monthly is not null from hotels where id = $1)
              or exists (select 1 from pos_order_tenders where hotel_id = $1 and method = 'allowance') as allowance,
            /* The ways it offers, and any it has taken and since switched off. */
            array(select kind from payment_methods where hotel_id = $1 and is_active
                  union
                  select method from payments where hotel_id = $1) as ways`,
    [hotelId]);
  const { rows } = await client.query<{ ledger: string; name: string }>(
    "select ledger, name from tally_ledger_names where hotel_id = $1", [hotelId]);
  const typed = new Map(rows.map((r) => [r.ledger, r.name]));

  /* A company pays by these whichever the desk offers; the restaurant takes
     cash, card and UPI. `city_ledger` is no money: it is What companies owe. */
  const ways = new Set([
    ...h!.ways, ...Object.keys(COMPANY_PAYMENT_METHODS),
    ...(h!.restaurant ? ["cash", "card", "upi"] : []),
  ]);
  const paid = Object.entries(PAYMENT_KINDS)
    .filter(([kind]) => kind !== "city_ledger" && ways.has(kind))
    .map(([kind, label]): readonly [string, string, string] => [kind, label, "Money received this way"]);

  const fixed: readonly (readonly [string, string, string])[] = [
    ...SOLD,
    ...(h!.restaurant ? [RESTAURANT] : []),
    ...(h!.alcohol ? [ALCOHOL] : []),
    ...GST,
    ...(h!.alcohol ? [VAT] : []),
    DISCOUNT,
    ...(h!.restaurant ? [ROUND_OFF] : []),
    ...OWED,
    ...(h!.allowance ? [ALLOWANCE] : []),
    ...paid,
  ];
  const ledgers = fixed.map(([key, label, what]) => ({ key, label, what, name: typed.get(key) ?? null }));
  return { ledgers, missing: ledgers.filter((l) => l.name === null).map((l) => l.label) };
}

/** Why these names cannot be saved, in a sentence, or null. Nothing is written first. */
export function namesProblem(body: unknown, known: readonly Ledger[]): string | null {
  const names = (body as { names?: unknown } | null)?.names;
  if (typeof names !== "object" || names === null) return "Send the ledger names.";
  for (const [key, value] of Object.entries(names)) {
    const ledger = known.find((l) => l.key === key);
    if (!ledger) return `This hotel has no ledger called ${key}.`;
    if (typeof value !== "string") return `The name for ${ledger.label} must be text.`;
    if (value.trim().length > 200) return `The name for ${ledger.label} is longer than 200 characters.`;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(value.trim())) {
      return `The name for ${ledger.label} holds a character that cannot be typed. Type it again.`;
    }
  }
  return null;
}

/** Each name as typed, trimmed at the two ends and nothing else. Blank removes it. */
export async function saveLedgerNames(
  client: Client, hotelId: string, names: Record<string, string>,
): Promise<void> {
  for (const [ledger, value] of Object.entries(names)) {
    const name = value.trim();
    if (!name) {
      await client.query(
        "delete from tally_ledger_names where hotel_id = $1 and ledger = $2", [hotelId, ledger]);
      continue;
    }
    await client.query(
      `insert into tally_ledger_names (hotel_id, ledger, name) values ($1, $2, $3)
       on conflict (hotel_id, ledger) do update set name = excluded.name
        where tally_ledger_names.name is distinct from excluded.name`,
      [hotelId, ledger, name]);
  }
}
