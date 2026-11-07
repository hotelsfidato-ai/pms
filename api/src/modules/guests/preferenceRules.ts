/* ══════════════════════════════════════════════════════════════════
   A GUEST'S PREFERENCES - WHAT MAY BE KEPT (D27-383 item 10)

   One list of choices and lengths, read by the desk's route, the guest's
   page's route and the website's form (which imports this file, as Edit
   guest imports validate.ts), so the form cannot offer what the server
   refuses. The database holds the same shape as its last word
   (app.guest_preferences_ok, migration "a guest's preferences").

   Imports nothing: the website bundles it.
   ══════════════════════════════════════════════════════════════════ */

export const FLOORS = ["low", "high"] as const;
export const BEDS = ["double", "twin"] as const;
export const FOODS = ["veg", "jain"] as const;
/** The free-text ones, and how long each may be. */
export const TEXTS = { allergies: 200, pillow: 60, newspaper: 60, notes: 300 } as const;

export interface Preferences {
  floor?: (typeof FLOORS)[number];
  bed?: (typeof BEDS)[number];
  quiet?: true;
  smoking?: true;
  food?: (typeof FOODS)[number];
  allergies?: string;
  pillow?: string;
  newspaper?: string;
  notes?: string;
}

const LABEL: Record<keyof typeof TEXTS, string> = {
  allergies: "Allergies", pillow: "Pillow", newspaper: "Newspaper", notes: "Other notes",
};

/** What is stored: only what says something - no false, no blank - or the
    sentence saying what is wrong. Absent and blank are the same: nothing. */
export function cleanPreferences(input: unknown):
  { ok: true; value: Preferences } | { ok: false; reason: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "Preferences are a list of choices." };
  }
  const p = input as Record<string, unknown>;
  const out: Preferences = {};
  const pick = <T extends string>(key: "floor" | "bed" | "food", allowed: readonly T[], what: string) => {
    const v = p[key];
    if (v === undefined || v === null || v === "") return null;
    if (!allowed.includes(v as T)) return `${what} is ${allowed.join(" or ")}, or none.`;
    (out as Record<string, unknown>)[key] = v;
    return null;
  };
  const wrong = pick("floor", FLOORS, "A floor") ?? pick("bed", BEDS, "A bed") ?? pick("food", FOODS, "Food");
  if (wrong) return { ok: false, reason: wrong };
  if (p["quiet"] === true) out.quiet = true;
  if (p["smoking"] === true) out.smoking = true;
  for (const key of Object.keys(TEXTS) as (keyof typeof TEXTS)[]) {
    const v = p[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return { ok: false, reason: `${LABEL[key]} is words.` };
    const t = v.trim();
    if (t.length > TEXTS[key]) return { ok: false, reason: `${LABEL[key]}: ${TEXTS[key]} characters at most.` };
    if (t) out[key] = t;
  }
  return { ok: true, value: out };
}
