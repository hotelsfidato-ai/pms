import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { PoolClient as Client } from "pg";

/* Split out of api/src/routes/inventorySetup.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md). Service: admin.
   The endpoint is unchanged, byte for byte, and the router keeps the
   name it had there. `hotelFor` is a copy of the one in
   modules/inventory/inventorySetup.ts — each route file keeps its own. */

const inventorySetup = new Hono<{ Variables: { subject: string } }>();
export { inventorySetup as commissioning };

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id from hotels where code = $1", [code.toUpperCase()]);
  return rows[0]?.id ?? null;
}

/* ══════════════════════════════════════════════════════════════════
   WHAT THIS PROPERTY STILL NEEDS

   Adding a hotel gives you a row and nothing else — no room types, no
   rooms, no tariffs, no GST rule — and that is correct, because every
   property's are different and inventing them would put wrong numbers
   in front of people. What was missing is the thread: after creating
   one, nothing said what to do next, and the answer was spread across
   six screens and a document.

   EVERY LINE HERE IS DERIVED. Nothing is stored, nothing is ticked off
   by hand, and there is no "setup complete" flag to go stale. Each
   check asks the database the same question the feature it guards
   asks — so a property that says it can take a booking can take one,
   and one that says it cannot names the reason.

   THE PLACEHOLDER GSTIN IS A CHECK, not a formality. `AAAAA0000A` is
   the standard dummy PAN, it arrived through the seed template, and it
   PRINTS on the tax invoice and the restaurant bill. A guest handed one
   has a document with a made-up tax number on it.
   ══════════════════════════════════════════════════════════════════ */

interface Check {
  id: string;
  label: string;
  done: boolean;
  /** What is missing, in the words somebody can act on. Null when done. */
  detail: string | null;
  /** Nothing real can happen until this is settled. */
  blocking: boolean;
  /** Where to go and fix it, relative to the property. */
  to: string | null;
}

inventorySetup.get("/:code/commissioning", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows: h } = await client.query<{
      gstin: string | null; address: string | null; phone: string | null;
      email: string | null; name: string;
    }>(
      `select gstin, address_line as address, phone, email::text as email, name
         from hotels where id = $1`,
      [hotelId],
    );
    const hotel = h[0]!;

    const one = async (sql: string): Promise<number> => {
      const { rows } = await client.query<{ n: string }>(sql, [hotelId]);
      return Number(rows[0]?.n ?? 0);
    };

    const types      = await one("select count(*)::text as n from room_types where hotel_id = $1 and is_active");
    const unpriced   = await one("select count(*)::text as n from room_types where hotel_id = $1 and is_active and base_rate is null");
    const rooms      = await one("select count(*)::text as n from rooms where hotel_id = $1 and is_active");
    const taxRules   = await one("select count(*)::text as n from tax_rules where hotel_id = $1 and kind = 'room'");
    const series     = await one("select count(*)::text as n from invoice_series where hotel_id = $1");
    const policies   = await one("select count(*)::text as n from cancellation_policies where hotel_id = $1 and is_active");
    const staff      = await one("select count(*)::text as n from staff_hotels where hotel_id = $1");
    const menuItems  = await one("select count(*)::text as n from pos_menu_items where hotel_id = $1 and is_active");
    const untaxedCat = await one("select count(*)::text as n from pos_menu_categories where hotel_id = $1 and is_active and tax_kind is null");

    /* The dummy PAN the seed template ships. Matched on the PAN block
       rather than the whole string so a different state code or entity
       number is still caught. */
    const placeholderGstin =
      !!hotel.gstin && /AAAAA0000A|BBBBB0000B|ZZZZZ0000Z/i.test(hotel.gstin);

    const checks: Check[] = [
      {
        id: "gstin",
        label: "A real GSTIN",
        done: !!hotel.gstin && !placeholderGstin,
        detail: !hotel.gstin
          ? "Not set. Every invoice this property issues carries it."
          : placeholderGstin
            ? `${hotel.gstin} is the standard dummy number. It PRINTS on the `
              + "tax invoice and the restaurant bill — a guest handed one has "
              + "a document with a made-up tax number on it."
            : null,
        blocking: true,
        to: null,
      },
      {
        id: "tax-rules",
        label: "A GST rule for rooms",
        done: taxRules > 0,
        detail: taxRules > 0 ? null
          : "Without one a room charge has no rate to carry, and nothing "
            + "assumes a figure. The night audit will not run.",
        blocking: true,
        to: "/room-types",
      },
      {
        id: "room-types",
        label: "Room types",
        done: types > 0,
        detail: types > 0 ? null
          : "What the property sells — Standard, Deluxe, Suite. Rooms are of "
            + "a type and rates are set against one.",
        blocking: true,
        to: "/room-types",
      },
      {
        id: "tariffs",
        label: "A tariff on every room type",
        done: types > 0 && unpriced === 0,
        detail: types === 0 ? "No room types yet."
          : unpriced === 0 ? null
            : `${unpriced} of ${types} have no price, so they show a dash and `
              + "cannot be sold. That is deliberate — an unpriced room is not "
              + "a free one.",
        blocking: true,
        to: "/room-types",
      },
      {
        id: "rooms",
        label: "Rooms",
        done: rooms > 0,
        detail: rooms > 0 ? null
          : "A property with no rooms sells nothing and divides by zero in "
            + "every occupancy figure.",
        blocking: true,
        to: "/room-types",
      },
      {
        id: "contact",
        label: "Address, phone and email",
        done: !!hotel.address && !!hotel.phone && !!hotel.email,
        detail: (!!hotel.address && !!hotel.phone && !!hotel.email) ? null
          : "These print on the invoice as the supplier's details.",
        blocking: false,
        to: null,
      },
      {
        id: "series",
        label: "An invoice series",
        done: series > 0,
        detail: series > 0 ? null
          : "Created with the property. If this one is missing, invoices "
            + "cannot be numbered.",
        blocking: true,
        to: null,
      },
      {
        id: "staff",
        label: "Somebody who works here",
        done: staff > 0,
        detail: staff > 0 ? null
          : "Nobody has been given this property, so only a group "
            + "administrator can see it.",
        blocking: false,
        to: null,
      },
      {
        id: "cancellation",
        label: "Cancellation terms",
        done: policies > 0,
        detail: policies > 0 ? null
          : "Without terms a no-show is charged nothing — the night audit "
            + "counts it and says it could not bill, which is honest and is "
            + "not what most properties want.",
        blocking: false,
        to: "/cancellation-terms",
      },
      /* The restaurant only counts once there IS one. A property with no
         menu is not incomplete; it is a hotel without a kitchen. */
      ...(menuItems > 0 ? [{
        id: "menu-tax",
        label: "A tax heading on every menu section",
        done: untaxedCat === 0,
        detail: untaxedCat === 0 ? null
          : `${untaxedCat} sections have none, and the till refuses their `
            + "items rather than billing them at nothing.",
        blocking: false,
        to: "/room-types",
      } as Check] : []),
    ];

    const blocking = checks.filter((x) => x.blocking && !x.done);

    return {
      property: hotel.name,
      checks,
      done: checks.filter((x) => x.done).length,
      total: checks.length,
      /* Not a percentage. "80% ready" invites somebody to open for
         business on the strength of a number that says nothing about
         WHICH fifth is missing — and here the missing fifth is usually
         the tax number that prints on every bill. */
      canTakeABooking: blocking.length === 0,
      blockedBy: blocking.map((x) => x.label),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});
