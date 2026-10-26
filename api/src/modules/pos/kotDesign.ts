import type { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KOT'S DESIGN (the owner's D27-368, 26 October)

   One design for each hotel, chosen by the GM, the owner or an Admin in
   Restaurant setup's KOT section, with a live preview: the size of the
   dishes, and of the KOT number and table; which lines print; a heading line
   of the hotel's own words; the paper, 58 or 80 mm. Stored on the hotel
   (migration 242); blank is today's KOT, and every field not stored reads as
   today's. The KOT itself is drawn by the printing computer from this design
   (DocketSlip.tsx).

   PUT /:code/till/kot-setup/design   the whole design
   ══════════════════════════════════════════════════════════════════ */

type App = Hono<{ Variables: { subject: string } }>;
type HotelFor = (client: Client, code: string) => Promise<string | null>;
const refuse = (reason: string) => ({ ok: false as const, reason });

const SIZES = ["small", "normal", "large"] as const;
type Size = typeof SIZES[number];
const LINES = ["waiter", "covers", "time", "kind", "notes", "orderNo"] as const;
type Line = typeof LINES[number];
export interface KotDesign {
  dishSize: Size; numberSize: Size; show: Record<Line, boolean>; heading: string | null; widthMm: 58 | 80;
}

/** Today's KOT: what a hotel with no design prints. */
export const KOT_TODAY: KotDesign = {
  dishSize: "normal", numberSize: "normal",
  show: { waiter: false, covers: false, time: true, kind: true, notes: true, orderNo: true },
  heading: null, widthMm: 80,
};
export const KOT_DESIGNERS: readonly string[] = ["owner", "admin", "gm"];
const DESIGN_REFUSED = "The KOT's design is set by the GM, the owner or an Admin.";
const HEADING_MAX = 40;

/** A stored design over today's: a field not stored, or not understood, is today's. */
export function readDesign(raw: unknown): KotDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<string, unknown>>;
  const show = (d["show"] && typeof d["show"] === "object" ? d["show"] : {}) as Partial<Record<string, unknown>>;
  const size = (v: unknown, today: Size) => (SIZES as readonly unknown[]).includes(v) ? v as Size : today;
  return {
    dishSize: size(d["dishSize"], KOT_TODAY.dishSize),
    numberSize: size(d["numberSize"], KOT_TODAY.numberSize),
    show: Object.fromEntries(LINES.map((l) =>
      [l, typeof show[l] === "boolean" ? show[l] : KOT_TODAY.show[l]])) as Record<Line, boolean>,
    heading: typeof d["heading"] === "string" && d["heading"].trim() ? d["heading"].trim().slice(0, HEADING_MAX) : null,
    widthMm: d["widthMm"] === 58 ? 58 : 80,
  };
}

/** What is wrong with a design sent to be saved, in a sentence; null when nothing is. */
export function designProblem(b: unknown): string | null {
  if (!b || typeof b !== "object") return "Send the KOT's design.";
  const d = b as Record<string, unknown>;
  if (!(SIZES as readonly unknown[]).includes(d["dishSize"]) || !(SIZES as readonly unknown[]).includes(d["numberSize"])) {
    return "A size is small, normal or large.";
  }
  const show = d["show"];
  if (!show || typeof show !== "object" || !LINES.every((l) => typeof (show as Record<string, unknown>)[l] === "boolean")) {
    return "Say for each line whether it prints: waiter, covers, time sent, the KOT kind, notes, the order number.";
  }
  if (d["heading"] !== null && d["heading"] !== undefined && typeof d["heading"] !== "string") return "The heading is words.";
  if (typeof d["heading"] === "string" && d["heading"].trim().length > HEADING_MAX) {
    return `The heading is at most ${HEADING_MAX} letters.`;
  }
  if (d["widthMm"] !== 58 && d["widthMm"] !== 80) return "The paper is 58 or 80 mm wide.";
  return null;
}

/** The hotel's design, for the KOT section's read. */
export async function kotDesignOf(client: Client, hotelId: string): Promise<KotDesign> {
  const { rows } = await client.query<{ d: unknown }>("select kot_design as d from hotels where id = $1", [hotelId]);
  return readDesign(rows[0]?.d);
}

export function registerKotDesign(till: App, hotelFor: HotelFor) {
  till.put("/:code/till/kot-setup/design", async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    const wrong = designProblem(body);
    if (wrong) return c.json(refuse(wrong), 409);
    const out = await withSession(c.get("subject"), async (client) => {
      const hotelId = await hotelFor(client, c.req.param("code"));
      if (!hotelId) return null;
      const { rows } = await client.query<{ ok: boolean }>(
        `select exists (select 1 from staff_hotels sh where sh.staff_id = app.current_user_id()
                          and sh.hotel_id = $1 and sh.role = any($2::text[]))
                or app.is_group_admin() as ok`, [hotelId, KOT_DESIGNERS]);
      if (!rows[0]!.ok) return refuse(DESIGN_REFUSED);
      const design = readDesign(body);
      await client.query("update hotels set kot_design = $2::jsonb where id = $1", [hotelId, JSON.stringify(design)]);
      return { ok: true as const, design };
    });
    if (!out) return c.json({ error: "No such property." }, 404);
    return c.json(out, out.ok ? 200 : 403);
  });
}
