import type { PoolClient as Client } from "pg";

/* ══════════════════════════════════════════════════════════════════
   NUMBERED ADD-ONS ON A DISH (the owner's D27-289, 9 October)

   "Add-on 2 = Kebab, ₹120": a numbered list any dish can take. A waiter
   taps Customise beside the dish, then 2, and the dish becomes ONE line,
   "Veg Biryani with add-on Kebab", priced as the dish and the add-on
   together, taxed at the dish's own rate. Not the Sides (045's add-on
   groups), which are linked dish by dish and go on as lines of their own.

   The rules live here so the two doors that put them on a dish - a new
   line (`addOneLine`) and Customise on a line not yet sent - cannot price
   or name it differently. ⚠ THE PRICE AND THE NAME ARE ALSO WORKED IN THE
   BROWSER (src/modules/pos/lib/pricing.ts), so a waiter sees the figure
   before Send; api/test/modules/pos/padTotal.test.ts prices the same
   choices both ways and fails if the two ever disagree.

   Nothing here imports till.ts: till.ts imports this.
   ══════════════════════════════════════════════════════════════════ */

/** What a screen sends: which add-on, and how many on ONE of the dish. */
export interface NumberedChoice { id: string; qty?: number }

/** One add-on as a line keeps it - copied, as the line's own price is. */
export interface NumberedOnLine {
  id: string; number: number; name: string; price: number; qty: number;
}

/** What 208's `numbered_addons` holds on a dish's line. */
export interface LineAddons {
  /** The dish as named before its add-ons: "Veg Biryani", "Bhaaji Pau (Butter)". */
  dish: string;
  /** One of it before its add-ons, in rupees. */
  base: number;
  addons: NumberedOnLine[];
}

/** The most of one add-on on one dish: more is a typing slip, not a plate. */
export const MOST_OF_ONE = 9;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });

/**
 * The add-ons asked for, as this hotel has them now - or why not, in a
 * sentence, BEFORE anything is written (root MEMORY 243). The same add-on
 * sent twice is one add-on, twice. In number order, so the same choice
 * always reads, and matches, the same way.
 */
export async function numberedFor(
  client: Client, hotelId: string, wanted: NumberedChoice[] | undefined,
): Promise<{ ok: true; addons: NumberedOnLine[] } | { ok: false; reason: string }> {
  if (wanted === undefined) return { ok: true, addons: [] };
  if (!Array.isArray(wanted)) return refuse("Which add-ons?");

  const counts = new Map<string, number>();
  for (const w of wanted) {
    if (!w || typeof w.id !== "string" || !UUID.test(w.id)) return refuse("Which add-on?");
    const qty = w.qty === undefined ? 1 : Number(w.qty);
    if (!Number.isInteger(qty) || qty < 1) return refuse("An add-on is one or more of it.");
    counts.set(w.id, (counts.get(w.id) ?? 0) + qty);
  }
  if (counts.size === 0) return { ok: true, addons: [] };
  if ([...counts.values()].some((q) => q > MOST_OF_ONE)) {
    return refuse(`At most ${MOST_OF_ONE} of one add-on on a dish.`);
  }

  const { rows } = await client.query<{
    id: string; number: number; name: string; price: string;
    off_until: string | null; off_reason: string | null;
  }>(
    `select id::text, number, name, price::text, off_until::text, off_reason
       from pos_numbered_addons
      where id = any($1::uuid[]) and hotel_id = $2 and is_active`,
    [[...counts.keys()], hotelId],
  );
  /* Named, never dropped: an add-on the guest asked for that does not reach
     the kitchen is a complaint at the table. */
  if (rows.length !== counts.size) {
    return refuse("One of those add-ons is not on this menu any more.");
  }
  const off = rows.find((r) => r.off_until && Date.parse(r.off_until) > Date.now());
  if (off) {
    return refuse(`Add-on ${off.number}, ${off.name}, is off${
      off.off_reason ? ` - ${off.off_reason}` : ""}.`);
  }

  return {
    ok: true,
    addons: rows
      .map((r) => ({
        id: r.id, number: r.number, name: r.name,
        price: Number(r.price), qty: counts.get(r.id)!,
      }))
      .sort((a, b) => a.number - b.number),
  };
}

/** "Veg Biryani with add-on Kebab"; "… with add-ons Kebab ×2, Raita". */
export function nameWithAddons(dish: string, addons: readonly NumberedOnLine[]): string {
  if (addons.length === 0) return dish;
  const parts = addons.map((a) => (a.qty > 1 ? `${a.name} ×${a.qty}` : a.name));
  return `${dish} with add-on${addons.length > 1 ? "s" : ""} ${parts.join(", ")}`;
}

/** One of the dish with its add-ons, worked in paise; rupees as text. */
export function priceWithAddons(
  base: string | number, addons: readonly NumberedOnLine[],
): string {
  const paise = (rupees: string | number) => Math.round(Number(rupees) * 100);
  return ((paise(base) + addons.reduce((sum, a) => sum + paise(a.price) * a.qty, 0))
    / 100).toFixed(2);
}

/** What the line keeps, or null when the dish has none. */
export function lineAddons(
  dish: string, base: string | number, addons: readonly NumberedOnLine[],
): LineAddons | null {
  return addons.length === 0 ? null : { dish, base: Number(base), addons: [...addons] };
}
