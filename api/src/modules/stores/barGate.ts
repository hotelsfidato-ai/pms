import type { Context, Next } from "hono";
import { withSession } from "../../auth.ts";

/* ══════════════════════════════════════════════════════════════════
   BAR STOCK, SWITCHED OFF (the owner's D27-367)

   Every route under /:code/bar/ - the sheet and its counts, the drinks,
   what each dish takes, the counter's requests (this service) and the bar
   bills (purchasing, through the front door) - is refused at a property
   whose Bar stock switch is off. Laundry's gate, for this module. The menu
   hides the screens too; this is the half that holds when an address is
   typed. The reports and the night audit ask app.module_enabled themselves.
   ══════════════════════════════════════════════════════════════════ */
export const BAR_STOCK_OFF =
  "Bar stock is switched off at this property. The owner or an administrator turns it on in Admin, Properties.";

export async function barStockGate(c: Context<{ Variables: { subject: string } }>, next: Next) {
  const code = c.req.param("code");
  if (!code) return c.json({ error: "No such property." }, 404);
  const on = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ on: boolean | null }>(
      "select app.module_enabled(h.id, 'bar_stock') as on from hotels h where h.code = $1", [code]);
    return rows[0]?.on ?? null;
  });
  if (on === null) return c.json({ error: "No such property." }, 404);
  if (!on) return c.json({ ok: false, reason: BAR_STOCK_OFF }, 403);
  await next();
}
