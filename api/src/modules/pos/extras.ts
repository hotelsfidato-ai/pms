import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   ADD-ONS AS LINES OF THEIR OWN (the owner's D27-291, 9 October)

   "A guest wants something we don't offer: type its name and price and
   add it to the dish, even a dish already sent." A CUSTOM add-on is typed
   by staff; on a dish the kitchen already has, a NUMBERED one (208's list)
   goes on the same way. Either is its own line under the dish - "Veg Thali
   300 / + Extra papad 40" - with ITS OWN QUANTITY, at the dish's own tax
   rate, waiting for the next Send like any new dish (210).

   Before Send a numbered add-on still folds into the dish (numberedAddons.ts,
   D27-289); this is the other door, and both check before anything is
   written (root MEMORY 243).

   Nothing here imports till.ts: till.ts imports this.
   ══════════════════════════════════════════════════════════════════ */

/** What a screen sends for one add-on line: from the list, or typed. */
export interface ExtraInput {
  /** One of the numbered list (D27-289), as a line of its own. */
  numberedId?: string;
  /** A custom one: its name, and a price or Free (no default, D27-291). */
  name?: string;
  price?: number | string | null;
  free?: boolean;
  /** How many: its own, starting at 1 (the owner). */
  qty?: number;
}

/** One add-on line, checked and priced, ready to write. */
export interface ExtraRow {
  kind: "custom" | "numbered";
  numberedId: string | null;
  name: string;
  /** One of it, in rupees, as text: 0.00 when ticked Free. */
  price: string;
  qty: number;
}

/** More of one is a typing slip, not a plate. */
export const MOST_OF_AN_EXTRA = 99;
/** A name a docket can print on one line. */
export const LONGEST_EXTRA_NAME = 60;
/** A typed price above this is a slip of the finger, not an add-on. */
export const DEAREST_EXTRA = 100000;
/** At once, on one dish. */
const MOST_EXTRAS = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });

/** A price a person typed: a number or a string holding one, or null for a
    blank or a word - never zero (POS-14). */
function typed(raw: unknown): number | null {
  const text = typeof raw === "number" ? String(raw)
    : typeof raw === "string" ? raw.replace(/[,\s₹]/g, "") : "";
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * The add-on lines asked for, as this hotel has them now, or why not - in
 * a sentence, before anything is written. Kept in the order given.
 */
export async function extrasFor(
  client: Client, hotelId: string, wanted: unknown,
): Promise<{ ok: true; extras: ExtraRow[] } | { ok: false; reason: string }> {
  if (wanted === undefined || wanted === null) return { ok: true, extras: [] };
  if (!Array.isArray(wanted)) return refuse("Which add-ons?");
  if (wanted.length > MOST_EXTRAS) return refuse("That is more add-ons than one dish takes at once.");

  const rows: (ExtraRow | { numberedId: string; qty: number })[] = [];
  for (const raw of wanted as ExtraInput[]) {
    if (!raw || typeof raw !== "object") return refuse("Which add-on?");
    const qty = raw.qty === undefined ? 1 : Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1) return refuse("An add-on is one or more of it.");
    if (qty > MOST_OF_AN_EXTRA) return refuse(`At most ${MOST_OF_AN_EXTRA} of one add-on.`);

    if (raw.numberedId !== undefined) {
      if (raw.name !== undefined) return refuse("An add-on is from the list or typed, not both.");
      if (typeof raw.numberedId !== "string" || !UUID.test(raw.numberedId)) {
        return refuse("Which add-on?");
      }
      rows.push({ numberedId: raw.numberedId, qty });
      continue;
    }

    const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
    if (!name) return refuse("Type the add-on's name.");
    if (name.length > LONGEST_EXTRA_NAME) {
      return refuse(`Keep the add-on's name to ${LONGEST_EXTRA_NAME} letters, so the KOT can print it.`);
    }
    /* No default price (the owner's rule): a figure typed, or Free ticked. */
    const price = typed(raw.price);
    if (raw.free === true) {
      if (price !== null && price !== 0) return refuse(`${name}: Free, or a price - not both.`);
      rows.push({ kind: "custom", numberedId: null, name, price: "0.00", qty });
      continue;
    }
    if (price === null) return refuse(`${name}: type a price, or tick Free. A blank is not zero.`);
    if (price < 0) return refuse(`${name}: a price cannot be less than nothing.`);
    if (price === 0) return refuse(`${name}: a price of 0 is Free - tick Free.`);
    if (price > DEAREST_EXTRA) return refuse(`${name}: that price looks like a slip. Check it.`);
    /* 40.10 × 100 is 4010.0000000000005 in floating point: near enough. */
    if (Math.abs(Math.round(price * 100) - price * 100) > 1e-6) {
      return refuse(`${name}: a price is in rupees and paise.`);
    }
    rows.push({ kind: "custom", numberedId: null, name, price: price.toFixed(2), qty });
  }

  /* The numbered ones, as the list has them now: named, never dropped - an
     add-on the guest asked for that does not reach the kitchen is a
     complaint at the table. */
  const ids = [...new Set(rows.flatMap((r) => ("kind" in r ? [] : [r.numberedId])))];
  const listed = new Map<string, { number: number; name: string; price: string }>();
  if (ids.length > 0) {
    const { rows: found } = await client.query<{
      id: string; number: number; name: string; price: string;
      off_until: string | null; off_reason: string | null;
    }>(
      `select id::text, number, name, price::text, off_until::text, off_reason
         from pos_numbered_addons
        where id = any($1::uuid[]) and hotel_id = $2 and is_active`,
      [ids, hotelId],
    );
    if (found.length !== ids.length) {
      return refuse("One of those add-ons is not on this menu any more.");
    }
    const off = found.find((r) => r.off_until && Date.parse(r.off_until) > Date.now());
    if (off) {
      return refuse(`Add-on ${off.number}, ${off.name}, is off${
        off.off_reason ? ` - ${off.off_reason}` : ""}.`);
    }
    for (const r of found) listed.set(r.id, r);
  }

  return {
    ok: true,
    extras: rows.map((r) => {
      if ("kind" in r) return r;
      const a = listed.get(r.numberedId)!;
      return {
        kind: "numbered" as const, numberedId: r.numberedId, name: a.name,
        price: Number(a.price).toFixed(2), qty: r.qty,
      };
    }),
  };
}

/** Writes the add-on lines under a dish, at the DISH's tax rate and scheme
    (the owner: the dish's own GST rate) - pending, for the next Send. */
export async function insertExtras(
  client: Client,
  at: {
    orderId: string; hotelId: string; parentId: string;
    taxRate: string; taxScheme: string; staffId: string;
  },
  extras: readonly ExtraRow[],
): Promise<void> {
  for (const e of extras) {
    await client.query(
      `insert into pos_order_lines
         (order_id, hotel_id, parent_line_id, extra_kind, numbered_addon_id,
          name, qty, unit_price, tax_rate, tax_scheme, added_by)
       values ($1, $2, $3, $4, $5::uuid, $6, $7, $8, $9, $10, $11)`,
      [at.orderId, at.hotelId, at.parentId, e.kind, e.numberedId,
       e.name, e.qty, e.price, at.taxRate, at.taxScheme, at.staffId],
    );
  }
}
