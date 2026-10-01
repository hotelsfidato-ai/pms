import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { maySwitchModules, MODULE_SWITCH_REFUSED } from "./grants.ts";

/* ══════════════════════════════════════════════════════════════════
   THE MODULES A PROPERTY CAN SWITCH ON — ONE LIST, READ BY BOTH ENDS

   ⚠ IT WAS TWO LISTS, AND THEY DISAGREED (LAU-3, found by the laundry
   chat on 19 September). The GET offered six modules and the POST
   accepted three, so the Settings screen drew a switch for `laundry`,
   `spa` and `channel_manager` and every one of them answered
   `409 There is no "laundry" module.` when somebody used it.

   Nothing in the database refused it — `hotel_modules_known` has known
   all six since migration 115 — so the fault was entirely these two
   literals drifting apart. `channel_manager` had been live in that state
   since 108.

   The list is declared HERE and both ends read it, so they cannot drift
   again, and `moduleSwitches.test.ts` holds it to `hotel_modules_known`
   as well: a module the database has never heard of must not be
   offered, and a module the database knows must not be silently
   unswitchable.
   ══════════════════════════════════════════════════════════════════ */
export const SWITCHABLE = [
  "pos", "banquet", "reception_pos", "channel_manager", "laundry", "spa",
  /* D21-90, 22 September: "serves alcohol", per property, off by default.
     It opens the Alcohol heading on the tax card - VAT, not GST (D21-91) -
     and lets the till sell a dish in a section taxed as alcohol. */
  "alcohol",
  /* D27-163, 29 September: New booking's fold-open sections, per property,
     ON until turned off (159). GST folded into Company and Extras left the
     page (D27-187, D27-193): their switches went with them. */
  "booking_company", "booking_notes",
] as const;


/* ══════════════════════════════════════════════════════════════════
   THE MODULE SWITCHES

   Split out of api/src/routes/property.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: admin.
   Both endpoints are unchanged, byte for byte, and the router keeps the
   name it had there.

   `HotelRow` and `resolve` are copies of the ones in api/src/routes/
   property.ts, whose header says why a code the caller may not see
   answers 404 — each route file keeps its own.
   ══════════════════════════════════════════════════════════════════ */

const property = new Hono<{ Variables: { subject: string } }>();
export { property as moduleSwitches };

interface HotelRow {
  id: string;
  code: string;
  name: string;
  address_line: string | null;
  city: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  currency: string;
  check_in_time: string;
  check_out_time: string;
}

/* The flat `cgst_rate`/`sgst_rate` pair left this copy on 17 September
   (ADM-2): tax is `tax_rules` since 067, and nothing here read them. */
async function resolve(client: Client, code: string) {
  const { rows } = await client.query<HotelRow>(
    `select id, code, name, address_line, city, phone, email, gstin, currency,
            to_char(check_in_time,  'HH24:MI') as check_in_time,
            to_char(check_out_time, 'HH24:MI') as check_out_time
       from hotels
      where code = upper($1) and is_active`,
    [code],
  );
  return rows[0] ?? null;
}

/* ── Modules ──────────────────────────────────────────────────────
   Which of them this property has. Not every hotel in the group runs
   a restaurant, and a property with no kitchen should not be showing
   its staff a menu screen that will never have anything in it. */

property.get("/:code/modules", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;
    const hotelId = hotel.id;

    /* Read through app.module_enabled rather than the table, so this
       answers exactly what the gate on the routes answers. Reading the
       rows directly would report "no row" as off and disagree with the
       API that is still serving the till. */
    const { rows } = await client.query<{ module: string; enabled: boolean }>(
      `select m.module, app.module_enabled($1, m.module) as enabled
         from unnest($2::text[]) as m(module)`,
      [hotelId, [...SWITCHABLE]],
    );
    return { modules: rows.map((r) => ({ module: r.module, enabled: r.enabled })) };
  });

  if (!body) return c.json({ error: "No such property." }, 404);
  return c.json(body);
});

property.post("/:code/modules/:module", async (c) => {
  type Body = { enabled?: boolean };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const module = c.req.param("module");

  if (!(SWITCHABLE as readonly string[]).includes(module)) {
    return c.json({ reason: `There is no "${module}" module.` }, 409);
  }
  if (typeof input.enabled !== "boolean") {
    return c.json({ reason: "On or off?" }, 409);
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotel = await resolve(client, c.req.param("code"));
    if (!hotel) return null;
    const hotelId = hotel.id;

    /* ⚠ THE OWNER'S AND THE ADMINISTRATOR'S SWITCH, NOT ANYBODY'S.
       This had no check at all until 14 September: the table's policy is
       hotel isolation, so any clerk rostered here could close the till
       for the whole property — and a receptionist could turn their own
       POS access back on. It then asked app.manages_hotel (084): a GM
       here or a group administrator.

       D17-36, 17 September: "the module switches stay owner and admin
       only". So the GM is refused now, and the administrator — whom
       manages_hotel never counted — is let in. Asked BEFORE the write:
       inside withSession a refusal below the insert keeps the insert
       (MEMORY 243). */
    if (!(await maySwitchModules(client, hotelId))) {
      return { ok: false as const, reason: MODULE_SWITCH_REFUSED };
    }

    /* Who and when. A module that quietly stopped working is a support
       call; one somebody switched off on a date is an answer. */
    await client.query(
      `insert into hotel_modules (hotel_id, module, is_enabled, changed_by)
       values ($1,$2,$3,$4)
       on conflict (hotel_id, module) do update
          set is_enabled = excluded.is_enabled,
              changed_by = excluded.changed_by,
              changed_at = now()`,
      [hotelId, module, input.enabled, session.staffId],
    );

    return { ok: true as const, module, enabled: input.enabled };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  /* A refusal is not a 200 — defect 231. */
  return c.json(result, result.ok ? 200 : 403);
});
